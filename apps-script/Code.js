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
//   'Graf kehadiran'!A23:D52  per-class yearly averages (percentages). The A/B pair
//                             holds Tingkatan 1 and Tingkatan 4; the C/D pair holds
//                             Tingkatan 2, 3 and 5. A "Tingkatan N" row opens a group
//                             and an unlabelled row is that block's total. The groups
//                             are preserved because the workbook's charts compare
//                             classes WITHIN a form.
//   'Graf kehadiran'!C55:D66  Tingkatan 5 monthly series; D68 is its yearly average
//   'Graf kehadiran'!C2:D14   overall monthly - identical to the Keseluruhan data, so
//                             the UI deliberately does not draw a second copy
//   'Keseluruhan'!A17 / A18   "Purata Tahunan 2026" label with the value DIRECTLY
//                             BELOW it in the SAME column A (not B18)
// Uses only SpreadsheetApp, so no new OAuth scope is needed.

const KEHADIRAN_SHEET_ID = '1VcMqlsOGZbzHOza5Kf6svMtR-L12HHrJaRfYdZJECMI';
const KEHADIRAN_CACHE_KEY = 'KEHADIRAN_ANALYSIS_V2';

// The workbook mixes fractions (<= 1) and percentages (> 1) for the same thing.
// A few cells are literal strings such as "96.44%", so handle those as well.
function asPct_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    if (t.indexOf('%') > -1) {
      const p = Number(t.replace(/%/g, '').trim());
      return isNaN(p) ? null : p;          // already a percentage
    }
  }
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

  // ---- per class (percentages), grouped exactly as the workbook's own charts ----
  // Layout: the A/B pair holds Tingkatan 1 and Tingkatan 4; the C/D pair holds
  // Tingkatan 2, 3 and 5. A "Tingkatan N" row opens a group; a row with no label
  // is that block's total and is skipped. Grouping is kept because the workbook
  // charts compare classes WITHIN a form - flattening them loses that.
  const groups = {};
  const groupOrder = [];
  const classes = [];

  function isFormHeader_(s) { return s.toLowerCase().indexOf('tingkatan') > -1; }

  function addClass_(form, name, pct) {
    if (pct === null) return;
    const entry = { name: name, pct: Number(pct.toFixed(2)) };
    if (form) {
      if (!groups[form]) { groups[form] = []; groupOrder.push(form); }
      groups[form].push(entry);
    }
    classes.push({ kelas: name, pct: entry.pct, form: form });
  }

  let leftForm = '';
  let rightForm = '';
  graf.getRange('A23:D52').getValues().forEach(function (row) {
    const leftLabel = String(row[0] || '').trim();
    const rightLabel = String(row[2] || '').trim();
    if (isFormHeader_(leftLabel)) {
      leftForm = leftLabel;
    } else if (leftLabel) {
      addClass_(leftForm, leftLabel, asPct_(row[1]));
    }
    if (isFormHeader_(rightLabel)) {
      rightForm = rightLabel;
    } else if (rightLabel) {
      addClass_(rightForm, rightLabel, asPct_(row[3]));
    }
  });

  const classGroups = groupOrder
    .map(function (form) { return { form: form, classes: groups[form] }; })
    .sort(function (a, b) {
      return a.form.localeCompare(b.form, undefined, { numeric: true, sensitivity: 'base' });
    });

  classes.sort(function (a, b) {
    return a.kelas.localeCompare(b.kelas, undefined, { numeric: true, sensitivity: 'base' });
  });

  // ---- Tingkatan 5 monthly series (its own block; workbook chart C54:D66) ----
  const monthlyT5 = graf.getRange('C55:D66').getValues()
    .map(function (row) {
      const code = String(row[0] || '').trim().toUpperCase();
      const pct = asPct_(row[1]);
      return { code: code, pct: pct === null ? null : Number(pct.toFixed(2)) };
    })
    .filter(function (m) { return m.code !== ''; });
  const t5Yearly = asPct_(graf.getRange('D68').getValue());

  // ---- yearly average from Keseluruhan ----
  // The value sits directly BELOW the label and in the SAME column (A17 label,
  // A18 value). Reading column B here returned nothing and only looked correct
  // because the computed fallback below silently covered for it.
  let yearly = null;
  const kes = ss.getSheetByName('Keseluruhan');
  if (kes) {
    const kesValues = kes.getRange('A1:B20').getValues();
    for (let i = 0; i < kesValues.length; i++) {
      if (String(kesValues[i][0] || '').toLowerCase().indexOf('purata tahunan') > -1) {
        const rowBelow = kesValues[i + 1] || [];
        yearly = asPct_(rowBelow[0]);
        if (yearly === null) yearly = asPct_(rowBelow[1]);   // tolerate the other layout
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
    classGroups: classGroups,
    monthlyT5: monthlyT5,
    t5Yearly: t5Yearly === null ? null : Number(t5Yearly.toFixed(2)),
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
