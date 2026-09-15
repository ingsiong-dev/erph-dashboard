/**
 * Data SMK Meradong — Apps Script backend
 *
 * PUBLIC MODE: no admin, no login check, no access gate. Every visitor sees the
 * same dashboard. Nothing in this project depends on who is signed in.
 *
 * IMPORTANT — keep exactly ONE definition of include() and doGet() in this file.
 * A second definition of the same function name silently overrides the first
 * (JavaScript hoisting keeps the last one). That is what previously caused the
 * navbar to show an empty label for public visitors and "KOH ING SIONG-ADMIN"
 * for the owner: a duplicate include() was calling Session.getActiveUser().
 */

/** Neutral label shown in the navbar. This app has no signed-in user. */
const PUBLIC_LABEL = 'YEE6301';

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('Data SMK Meradong')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Renders a sub-component (Sidebar, Navbar, Dashboard, TeacherList, ...) to HTML.
 * Only Navbar.html uses a template tag (<?= userEmail ?>), satisfied here so no
 * sub-file can fail to evaluate and blank the whole page.
 */
function include(filename) {
  try {
    const template = HtmlService.createTemplateFromFile(filename);
    template.userEmail = PUBLIC_LABEL;
    return template.evaluate().getContent();
  } catch (err) {
    Logger.log('Sub-component [' + filename + '] failed to render: ' + err.toString());
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }
}
// ==================== ENROLMEN MURID (Laporan Enrolmen downloads) ====================
// Monthly enrolment reports live in a Drive folder, one PDF per month, named
// "Laporan Enrolmen <Bulan> <Tahun>.pdf". Only 2026 onwards is offered; the
// 2014-2024 archive is ignored on purpose.
// NOTE: this feature is PUBLIC (no PIN) - the user chose that explicitly.

const ENROL_FOLDER_ID = '1XNecX0c2PGhdnGCRFfFQQMc7LV9toSnK';
const ENROL_YEARS = ['2026'];
const ENROL_MONTHS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
                      'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const ENROL_CACHE_KEY = 'ENROL_INDEX_V1';

function enrolFileName_(month, year) {
  return 'Laporan Enrolmen ' + month + ' ' + year + '.pdf';
}

function formatBytes_(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Lists which monthly reports exist. Called by the Kehadiran module on first open.
 * Cached for 5 minutes so switching views does not hit Drive every time.
 */
function getEnrolmenIndex() {
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(ENROL_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    // cache miss or unparseable - fall through and rebuild
  }

  const root = DriveApp.getFolderById(ENROL_FOLDER_ID);
  const years = {};

  ENROL_YEARS.forEach(function (year) {
    const months = ENROL_MONTHS.map(function (m) {
      return { month: m, available: false, sizeLabel: '-', modified: '-' };
    });

    const folderIt = root.getFoldersByName(year);
    if (folderIt.hasNext()) {
      const files = folderIt.next().getFiles();
      const byName = {};
      while (files.hasNext()) {
        const f = files.next();
        byName[f.getName()] = f;
      }
      months.forEach(function (entry) {
        const f = byName[enrolFileName_(entry.month, year)];
        if (f) {
          entry.available = true;
          entry.sizeLabel = formatBytes_(f.getSize());
          entry.modified = Utilities.formatDate(f.getLastUpdated(),
            Session.getScriptTimeZone(), 'dd/MM/yyyy');
        }
      });
    }
    years[year] = months;
  });

  const payload = {
    years: years,
    generated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
  };
  try {
    cache.put(ENROL_CACHE_KEY, JSON.stringify(payload), 300);
  } catch (e) {
    // payload too large for the cache - serve live next time
  }
  return payload;
}

/**
 * Returns one report as base64, so a visitor who is NOT signed into Google can
 * still download it (the script fetches the file as the owner).
 */
function getEnrolmenReport(year, month) {
  year = String(year || '').trim();
  month = String(month || '').trim();

  if (ENROL_YEARS.indexOf(year) === -1) throw new Error('Tahun tidak sah: ' + year);
  if (ENROL_MONTHS.indexOf(month) === -1) throw new Error('Bulan tidak sah: ' + month);

  const root = DriveApp.getFolderById(ENROL_FOLDER_ID);
  const folderIt = root.getFoldersByName(year);
  if (!folderIt.hasNext()) throw new Error('Folder ' + year + ' tidak dijumpai');

  const name = enrolFileName_(month, year);
  const files = folderIt.next().getFilesByName(name);
  if (!files.hasNext()) throw new Error('Laporan ' + month + ' ' + year + ' belum tersedia');

  const blob = files.next().getBlob();
  return {
    filename: name,
    mimeType: 'application/pdf',
    base64: Utilities.base64Encode(blob.getBytes()),
    size: blob.getBytes().length
  };
}
// ==================== KEHADIRAN (attendance analysis) ====================
// Reads the workbook "Graf kehadiran 2026". Layout facts below were VERIFIED by
// reading the workbook, not assumed:
//   'Graf kehadiran'!C3:D14   months JAN..DIS + attendance
//                             NOTE: this block stores FRACTIONS (0.9725 = 97.25%)
//                             while every other block stores PERCENTAGES (96.77).
//                             asPct_() normalises both.
//   'Graf kehadiran'!C17:D21  per-form yearly averages T1..T5 (percentages)
//   'Graf kehadiran'!A23:D52  per-class yearly averages (percentages), laid out as
//                             two side-by-side blocks with header/total rows mixed in
//   'Keseluruhan'!A17:B18     "Purata Tahunan 2026" label + value (FRACTION)
// Uses only SpreadsheetApp, so no new OAuth scope is needed.

const KEHADIRAN_SHEET_ID = '1VcMqlsOGZbzHOza5Kf6svMtR-L12HHrJaRfYdZJECMI';
const KEHADIRAN_CACHE_KEY = 'KEHADIRAN_ANALYSIS_V1';

// The workbook mixes fractions (<= 1) and percentages (> 1) for the same thing.
function asPct_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  return n <= 1.5 ? n * 100 : n;
}

function getKehadiranAnalysis() {
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(KEHADIRAN_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    // fall through and rebuild
  }

  const ss = SpreadsheetApp.openById(KEHADIRAN_SHEET_ID);
  const graf = ss.getSheetByName('Graf kehadiran');
  if (!graf) throw new Error('Tab "Graf kehadiran" tidak dijumpai');

  // ---- monthly (fractions) ----
  const monthly = graf.getRange('C3:D14').getValues()
    .map(function (row) {
      const code = String(row[0] || '').trim().toUpperCase();
      const pct = asPct_(row[1]);
      return { code: code, pct: pct === null ? null : Number(pct.toFixed(2)) };
    })
    .filter(function (m) { return m.code !== ''; });

  // month-on-month change in percentage points - computed from the values shown,
  // never read from a separate column, so the two can never disagree
  let previous = null;
  monthly.forEach(function (m) {
    m.beza = (m.pct !== null && previous !== null) ? Number((m.pct - previous).toFixed(2)) : null;
    if (m.pct !== null) previous = m.pct;
  });

  // ---- per form (percentages) ----
  const forms = graf.getRange('C17:D21').getValues()
    .map(function (row) {
      const label = String(row[0] || '').trim().toUpperCase();
      const pct = asPct_(row[1]);
      return { form: label, pct: pct === null ? null : Number(pct.toFixed(2)) };
    })
    .filter(function (f) { return f.form !== ''; });

  // ---- per class (percentages, two blocks + header/total rows) ----
  const classes = [];
  graf.getRange('A23:D52').getValues().forEach(function (row) {
    const leftLabel = String(row[0] || '').trim();
    const leftPct = asPct_(row[1]);
    const rightLabel = String(row[2] || '').trim();
    const rightPct = asPct_(row[3]);
    const isHeader = function (s) { return s.toLowerCase().indexOf('tingkatan') > -1; };
    if (leftLabel && !isHeader(leftLabel) && leftPct !== null) {
      classes.push({ kelas: leftLabel, pct: Number(leftPct.toFixed(2)) });
    }
    if (rightLabel && !isHeader(rightLabel) && rightPct !== null) {
      classes.push({ kelas: rightLabel, pct: Number(rightPct.toFixed(2)) });
    }
  });
  classes.sort(function (a, b) {
    return a.kelas.localeCompare(b.kelas, undefined, { numeric: true, sensitivity: 'base' });
  });

  // ---- yearly average from Keseluruhan ----
  let yearly = null;
  const kes = ss.getSheetByName('Keseluruhan');
  if (kes) {
    const kesValues = kes.getRange('A1:B20').getValues();
    for (let i = 0; i < kesValues.length; i++) {
      if (String(kesValues[i][0] || '').toLowerCase().indexOf('purata tahunan') > -1) {
        yearly = asPct_(kesValues[i + 1] ? kesValues[i + 1][1] : null);  // value is on the row below
        break;
      }
    }
  }
  if (yearly === null) {
    const done = monthly.filter(function (m) { return m.pct !== null; });
    if (done.length) {
      yearly = done.reduce(function (sum, m) { return sum + m.pct; }, 0) / done.length;
    }
  }

  const reported = monthly.filter(function (m) { return m.pct !== null; });
  const payload = {
    year: 2026,
    yearlyAverage: yearly === null ? null : Number(yearly.toFixed(2)),
    monthly: monthly,
    forms: forms,
    classes: classes,
    monthsReported: reported.length,
    monthsTotal: monthly.length,
    latest: reported.length ? reported[reported.length - 1] : null,
    generated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
  };

  try {
    cache.put(KEHADIRAN_CACHE_KEY, JSON.stringify(payload), 300);
  } catch (e) {
    // too large for cache - serve live next time
  }
  return payload;
}
