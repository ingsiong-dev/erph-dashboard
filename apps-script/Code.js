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
