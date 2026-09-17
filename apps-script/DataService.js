/**
 * Data Service & Business Logic Database Layer - 方案B（智能周数对齐与姓名修复版）
 * FIX: Week number is now calculated BEFORE the cache check (and validated against
 * whatever is cached) so a stale cached payload can never "freeze" the week number.
 * Dates are also normalized to midnight to remove any time-of-day/timezone drift.
 */

const SPREADSHEET_ID = '1hMJgrjQxVVBobkgTGmZEO7BXgruIRDYlPQeT3tsg9UM';
const CACHE_KEY = 'ERPH_DASHBOARD_DATA_CACHE';
const CACHE_TTL_SECONDS = 300; // 5-minute global cache

/* The denominator for EVERY percentage the portal shows: the number of school
   weeks in the year. Deliberately a CONSTANT, not the current week.
   Set 16 Sep 2026 on the user's instruction so the portal, the new submit page
   and the old Looker report all show the same
   "Jumlah Minggu Persekolahan Tahun 2026" = 47.
   Consequence to be aware of: "100% Compliant" (=== 47) cannot be reached until
   week 47, and the "behind by 5 weeks" notice will flag most staff until then. */
const SCHOOL_TOTAL_WEEKS = 47;

/**
 * Tolerant week parser. Accepts only unambiguous shapes:
 *   12 | M12 | M 12 | MINGGU 12 | MINGGU KE 12 | WEEK 12
 * Anything else returns 0 and is NOT counted.
 *
 * Why not parseInt(str.replace(/\D/g,'')): that silently invented numbers from
 * ambiguous text - "20 & 21" became week 2021 and "MINGGU KE 16 SAINS TING.5"
 * became week 165 (both then discarded by the range filter, so the rows simply
 * vanished), while "3A" was counted as week 3. Real rows in the sheet use all of
 * these forms, so the row is dropped VISIBLY here rather than counted wrongly.
 */
function parseWeek_(value) {
  const s = String(value == null ? '' : value).trim().toUpperCase();
  if (!s) return 0;
  const m = s.match(/^(?:M|MINGGU|WEEK)?\s*(?:KE)?\s*(\d{1,2})$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return (n >= 1 && n <= SCHOOL_TOTAL_WEEKS) ? n : 0;
}

// Wrap everything inside this namespace object
const DataService = {

  /**
   * Calculates the current teaching week number.
   * Always uses midnight-normalized local dates so time-of-day / timezone
   * parsing quirks can never shift the day count by ±1.
   */
  _calculateCurrentWeek: function() {
    // Anchor: Monday, 12 Jan 2026 (start of school year), built from explicit
    // Y/M/D components (NOT a parsed ISO string) so it's always local midnight,
    // never UTC midnight.
    const START_DATE = new Date(2026, 0, 12); // Jan 12, 2026, local midnight

    const now = new Date();
    const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight

    const daysDiff = Math.floor((TODAY.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));

    let currentCalculatedWeek = Math.floor(daysDiff / 7) + 1;

    // Safety bounds: never below week 1, never above the school-year week count.
    if (currentCalculatedWeek < 1) currentCalculatedWeek = 1;
    if (currentCalculatedWeek > SCHOOL_TOTAL_WEEKS) currentCalculatedWeek = SCHOOL_TOTAL_WEEKS;

    return currentCalculatedWeek;
  },

  /**
   * Pulls master dataset from cache or recalculates it directly from the Spreadsheet engine
   */
  getDashboardMasterData: function(forceRefresh = false) {
    const cache = CacheService.getScriptCache();

    // Denominator for every percentage on the portal: the school-year week count.
    const TOTAL_WEEKS = SCHOOL_TOTAL_WEEKS;

    // The current week is still computed - but ONLY for the cache-rollover guard
    // below. It is never used as a denominator any more.
    const CURRENT_WEEK = this._calculateCurrentWeek();

    // 1. Safe Cache Retrieval — but only use the cached payload if it was built
    //    for the SAME current week. If the week has rolled over (e.g. Monday just
    //    passed), the cache is treated as stale even if its 5-minute TTL hasn't
    //    expired yet.
    if (!forceRefresh) {
      try {
        const cachedRaw = cache.get(CACHE_KEY);
        if (cachedRaw) {
          const cachedPayload = JSON.parse(cachedRaw);
          if (cachedPayload.currentWeek === CURRENT_WEEK) {
            return cachedPayload;
          }
          // else: week changed since this was cached -> fall through and recompute
        }
      } catch (cacheErr) {
        Logger.log("Cache read skipped: " + cacheErr.toString());
      }
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const responsesSheet = ss.getSheetByName('Responses');
    const delimaSheet = ss.getSheetByName('DELIMA');

    // 精准读取 DELIMA 表的 A 列（邮箱）和 B 列（真实姓名），建立名字映射库
    const delimaRows = delimaSheet.getRange(1, 1, delimaSheet.getLastRow(), 2).getValues();
    const nameMap = {};
    const teachersList = [];

    delimaRows.forEach(row => {
      const email = row[0].toString().trim().toLowerCase();
      const realName = row[1] ? row[1].toString().trim() : "";
      if (email && email !== "teacher email") {
        teachersList.push(email);
        nameMap[email] = realName;
      }
    });

    let responses = [];
    if (responsesSheet.getLastRow() > 1) {
      responses = responsesSheet.getRange(2, 1, responsesSheet.getLastRow() - 1, 7).getValues();
    }

    const analyticsByTeacher = {};
    teachersList.forEach(email => {
      analyticsByTeacher[email] = {
        email: email,
        // 优先使用 DELIMA 工作表里的真实姓名，找不到再用前缀保底
        name: nameMap[email] ? nameMap[email] : email.split('@')[0].toUpperCase(),
        submissions: [],
        uniqueWeeks: new Set(),
        subjects: new Set(),
        lastSubmission: null
      };
    });

    responses.forEach(row => {
      const timestamp = row[0];
      const name = row[1];
      const driveUrl = row[2];
      // 强制转换输入数据的邮箱为小写，完美对齐映射钥匙
      const email = row[3] ? row[3].toString().trim().toLowerCase() : "";
      const weekStr = row[4];
      const subject = row[5];
      const status = row[6];

      if (email && analyticsByTeacher[email]) {
        // 如果 Responses 里有填姓名，且刚才没拿到 DELIMA 的真实姓名时，允许覆盖
        if (name && (!nameMap[email] || nameMap[email] === "")) {
          analyticsByTeacher[email].name = name.toString().trim();
        }

        const submissionItem = {
          timestamp: timestamp ? new Date(timestamp).getTime() : null,
          formattedDate: timestamp ? Utilities.formatDate(new Date(timestamp), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : "",
          driveUrl: driveUrl,
          week: parseWeek_(weekStr),
          subject: subject,
          status: status
        };

        analyticsByTeacher[email].submissions.push(submissionItem);
        // 使用动态分母进行数据过滤拦截
        if (submissionItem.week >= 1 && submissionItem.week <= TOTAL_WEEKS) {
          analyticsByTeacher[email].uniqueWeeks.add(submissionItem.week);
        }
        if (subject) {
          analyticsByTeacher[email].subjects.add(subject);
        }

        if (!analyticsByTeacher[email].lastSubmission || submissionItem.timestamp > analyticsByTeacher[email].lastSubmission.timestamp) {
          analyticsByTeacher[email].lastSubmission = submissionItem;
        }
      }
    });

    const processedTeachers = Object.values(analyticsByTeacher).map(t => {
      const totalSubmission = t.uniqueWeeks.size;
      // 使用动态分母计算百分比
      const pct = Math.min(Math.round((totalSubmission / TOTAL_WEEKS) * 100), 100);

      let status = "No Submission";
      if (totalSubmission === TOTAL_WEEKS) status = "Completed";
      else if (totalSubmission >= Math.max(1, TOTAL_WEEKS - 3)) status = "Almost Complete"; // 智能动态匹配：落后不超过3周算接近完成
      else if (totalSubmission > 0) status = "Behind Schedule";

      return {
        name: t.name,
        email: t.email,
        totalSubmission: totalSubmission,
        percentage: pct,
        status: status,
        subjects: Array.from(t.subjects),
        lastSubmissionDate: t.lastSubmission ? t.lastSubmission.formattedDate : "N/A",
        submissions: t.submissions.sort((a, b) => b.week - a.week),
        weekMatrix: Array.from(t.uniqueWeeks)
      };
    });

    const payload = {
      teachers: processedTeachers,
      totalWeeks: TOTAL_WEEKS,   // 47 - what every screen divides by
      currentWeek: CURRENT_WEEK, // only used to detect a stale cache
      lastUpdated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    };

    // 2. Safe Cache Save
    try {
      cache.put(CACHE_KEY, JSON.stringify(payload), CACHE_TTL_SECONDS);
    } catch (cacheErr) {
      Logger.log("Payload exceeds 100KB limit. Serving live data directly instead.");
    }

    return payload;
  }
};

/**
 * The dashboard dataset, exposed to the client.
 *
 * LOGIN REQUIRED (17 Sep 2026): the Google ID token is the FIRST argument and is
 * checked here before anything is read. google.script.run is reachable from any
 * page this script serves, so this function must check the token itself rather
 * than trust the render gate in doGet() - a gate you can walk around is not a
 * gate. identitiDariToken_() (Code.js) verifies the token with Google and then
 * checks the address against the DELIMA roster.
 */
function getDashboardMasterData(token, forceRefresh) {
  identitiDariToken_(token);
  return DataService.getDashboardMasterData(forceRefresh);
}