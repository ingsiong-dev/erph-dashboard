/**
 * Data Service & Business Logic Database Layer - 方案B（智能周数对齐与姓名修复版）
 * FIX: Week number is now calculated BEFORE the cache check (and validated against
 * whatever is cached) so a stale cached payload can never "freeze" the week number.
 * Dates are also normalized to midnight to remove any time-of-day/timezone drift.
 */

const SPREADSHEET_ID = '1hMJgrjQxVVBobkgTGmZEO7BXgruIRDYlPQeT3tsg9UM';
const CACHE_KEY = 'ERPH_DASHBOARD_DATA_CACHE';
const CACHE_TTL_SECONDS = 300; // 5-minute global cache

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

    // Safety bounds: never below week 1, never above week 42
    if (currentCalculatedWeek < 1) currentCalculatedWeek = 1;
    if (currentCalculatedWeek > 42) currentCalculatedWeek = 42;

    return currentCalculatedWeek;
  },

  /**
   * Pulls master dataset from cache or recalculates it directly from the Spreadsheet engine
   */
  getDashboardMasterData: function(forceRefresh = false) {
    const cache = CacheService.getScriptCache();

    // Always compute the CURRENT week first — this must never come from cache.
    const TOTAL_WEEKS = this._calculateCurrentWeek();

    // 1. Safe Cache Retrieval — but only use the cached payload if it was built
    //    for the SAME week number we just calculated. If the week has rolled
    //    over (e.g. Monday just passed), the cache is treated as stale even if
    //    its 5-minute TTL hasn't expired yet.
    if (!forceRefresh) {
      try {
        const cachedRaw = cache.get(CACHE_KEY);
        if (cachedRaw) {
          const cachedPayload = JSON.parse(cachedRaw);
          if (cachedPayload.totalWeeks === TOTAL_WEEKS) {
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
          week: parseInt(weekStr.toString().replace(/\D/g, '')) || 0,
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
      totalWeeks: TOTAL_WEEKS, // stored so future calls can detect a stale cache
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

// Expose the method globally so google.script.run can still see it directly from the front-end
function getDashboardMasterData(forceRefresh) {
  return DataService.getDashboardMasterData(forceRefresh);
}