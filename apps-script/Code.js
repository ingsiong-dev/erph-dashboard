/**
 * Data SMK Meradong — Apps Script backend
 *
 * LOGIN REQUIRED (from 17 Sep 2026). This portal used to be fully public. It now
 * sits behind a Google sign-in gate, in TWO layers, because either one alone
 * would be a hole:
 *
 *   1. doGet() needs `?token=<Google ID token>`. With no token, or one this
 *      script cannot verify, it renders LogMasuk.html (the in-app login page)
 *      instead of the portal.
 *   2. EVERY data function takes the token as its FIRST argument and calls
 *      identitiDariToken_() before it reads anything. google.script.run is
 *      reachable from any page this script serves, so the render gate alone
 *      would not be enough - a login page you can walk around is not a gate.
 *
 * The token comes from the Pages front end (https://ingsiong-dev.github.io/
 * erph-dashboard/). That is the ONLY place the Google account chooser can be
 * reached from: an Apps Script page runs in a sandboxed iframe and may not
 * navigate to accounts.google.com (see Google_login_page.md 7.5).
 *
 * Two facts to keep straight about the identity:
 *   - the token is verified by GOOGLE (tokeninfo), never by decoding it here.
 *     Decoding it locally would let anyone mint their own "token" and walk in.
 *   - a verified @moe-dl.edu.my address STILL has to be on the DELIMA roster.
 *     The domain alone is not a gate: moe-dl.edu.my covers every school in
 *     Malaysia, so it would let the whole country read this school's data.
 *
 * IMPORTANT — keep exactly ONE definition of include() and doGet() in this file.
 * A second definition of the same function name silently overrides the first
 * (JavaScript hoisting keeps the last one). That is what previously caused the
 * navbar to show an empty label for public visitors and "KOH ING SIONG-ADMIN"
 * for the owner: a duplicate include() was calling Session.getActiveUser().
 */

/** Neutral label shown in the navbar (the school code), as the user chose. */
const PUBLIC_LABEL = 'YEE6301';

// ==================== LOGIN / IDENTITY ====================
// Shared with the e-RPH teacher app: the SAME OAuth client and the SAME DELIMA
// roster. One login for the whole school, and one roster to maintain.
const OAUTH_CLIENT_ID = '314693319074-n5unk6cg17srqoe2fiu1nd67njaj5pp2.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'moe-dl.edu.my';
const PORTAL_LOGIN_URL = 'https://ingsiong-dev.github.io/erph-dashboard/';

const ROSTER_CACHE_KEY = 'PORTAL_ROSTER_V1';
// 15 minutes: a teacher added to DELIMA can log in within a quarter of an hour,
// while the whole school still costs at most 4 roster reads an hour - which
// matters, because every request runs as ONE user (executeAs USER_DEPLOYING) and
// the Sheets read quota (60/min/user) is shared across the school.
const ROSTER_TTL_SECONDS = 900;
// Last-known-good roster, so a quota spike cannot lock the whole school out.
const ROSTER_PROP_KEY = 'PORTAL_ROSTER_EMAILS';
const ROSTER_PROP_MAX = 8000;   // Script properties hold 9 KB per value
const IDENT_CACHE_PREFIX = 'PORTAL_IDENT_';

function teks_(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Errors carry a short machine-readable code in the message, so the client can
 * tell "log in again" (E_LOGIN / E_TOKEN) from "this account is not allowed"
 * (E_ROSTER) without pattern-matching Malay prose - and so one phone screenshot
 * says which check failed.
 */
function ralat_(kod, mesej) {
  const err = new Error('[' + kod + '] ' + mesej);
  err.code = kod;
  return err;
}

function kodRalat_(err) {
  const m = /\[(E_[A-Z]+)\]/.exec(teks_(err && err.message));
  return m ? m[1] : 'E_LAIN';
}

/** Reads the DELIMA tab (column A) and returns lowercase e-mail addresses. */
function bacaRosterDariSheet_() {
  // SPREADSHEET_ID is the eRPH workbook declared in DataService.js - the SAME
  // roster the teacher app uses, so there is one list to maintain, not two.
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('DELIMA');
  if (!sheet) throw new Error('Tab DELIMA tidak dijumpai');

  const values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  const out = [];
  values.forEach(function (row) {
    const email = teks_(row[0]).toLowerCase();
    if (!email || email.indexOf('@') === -1) return;   // header row, blanks
    if (out.indexOf(email) === -1) out.push(email);
  });
  return out;
}

function simpanRosterSimpanan_(list) {
  try {
    const joined = list.join(',');
    if (joined.length > ROSTER_PROP_MAX) return;
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(ROSTER_PROP_KEY) !== joined) props.setProperty(ROSTER_PROP_KEY, joined);
  } catch (e) {
    // A property write failing is not worth breaking a login over.
  }
}

function rosterSimpanan_() {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(ROSTER_PROP_KEY);
    return v ? v.split(',') : [];
  } catch (e) {
    return [];
  }
}

/**
 * The list of teachers allowed in. Cached, and backed by a last-known-good copy:
 * the roster lives in the SAME workbook as the eRPH data, read as one user for
 * the whole school, so a Sheets quota trip is a normal event. Denying every
 * teacher because of a quota spike would be worse than briefly trusting the last
 * roster we managed to read.
 */
function rosterEmails_() {
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(ROSTER_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    // cache miss / unparseable - rebuild below
  }

  try {
    const list = bacaRosterDariSheet_();
    if (list.length) {
      try { cache.put(ROSTER_CACHE_KEY, JSON.stringify(list), ROSTER_TTL_SECONDS); } catch (e) {}
      simpanRosterSimpanan_(list);
      return list;
    }
  } catch (err) {
    Logger.log('Roster read failed, falling back to the stored copy: ' + err.message);
  }

  const simpanan = rosterSimpanan_();
  if (simpanan.length) return simpanan;
  throw ralat_('E_LAIN', 'Senarai guru tidak dapat dibaca buat masa ini. Cuba lagi sebentar.');
}

function dalamRoster_(email) {
  return rosterEmails_().indexOf(teks_(email).toLowerCase()) !== -1;
}

/**
 * Verifies a Google ID token with GOOGLE and returns { email, exp }.
 *
 * Why tokeninfo and not a local JWT decode: the signature must be checked by
 * Google. Why aud: without it, a token minted for ANY other Google app would be
 * accepted. Why iss: it has to be Google that issued it. Why email_verified: an
 * unverified address is not an identity. Why muteHttpExceptions: a rejected
 * token answers HTTP 400 with a JSON error body, and that body should become a
 * readable Malay message rather than an exception with no context.
 */
function emailDariToken_(token) {
  const t = teks_(token);
  if (!t) throw ralat_('E_LOGIN', 'Log masuk diperlukan. Muat semula halaman dan log masuk.');

  // A Google ID token is three base64url segments. Checking the SHAPE first costs
  // nothing and means a stale client that passes its old first argument (a
  // boolean forceRefresh, say) is refused outright instead of being sent to
  // Google as a "token" - and refused as "not signed in", never as authorised.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) {
    throw ralat_('E_TOKEN', 'Token log masuk tidak sah. Log masuk semula.');
  }

  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(t),
    { muteHttpExceptions: true });

  let d;
  try {
    d = JSON.parse(resp.getContentText());
  } catch (err) {
    throw ralat_('E_TOKEN', 'Jawapan pengesahan token tidak boleh dibaca.');
  }

  if (d.error || d.error_description) {
    throw ralat_('E_TOKEN', 'Token tidak sah: ' + (d.error_description || d.error));
  }
  if (d.aud !== OAUTH_CLIENT_ID) {
    throw ralat_('E_TOKEN', 'Token bukan untuk aplikasi ini.');
  }
  if (d.iss !== 'accounts.google.com' && d.iss !== 'https://accounts.google.com') {
    throw ralat_('E_TOKEN', 'Pengeluar token tidak dikenali.');
  }
  if (d.email_verified !== 'true' && d.email_verified !== true) {
    throw ralat_('E_TOKEN', 'E-mel pada token tidak disahkan.');
  }

  const exp = Number(d.exp) || 0;
  if (exp * 1000 < Date.now()) {
    throw ralat_('E_TOKEN', 'Sesi log masuk telah tamat tempoh. Log masuk semula.');
  }

  const email = teks_(d.email).toLowerCase();
  if (!email) throw ralat_('E_TOKEN', 'Token tiada e-mel.');
  return { email: email, exp: exp };
}

/**
 * THE lock. Every data function calls this before reading anything: verify the
 * token with Google, then check the address against the DELIMA roster.
 *
 * The verified result is cached for up to 5 minutes - never longer than the
 * token itself has left to live, or a short-lived token could be stretched into
 * a longer session by the cache. That keeps tokeninfo off the hot path for the
 * dashboard, which makes several calls in a row.
 */
function identitiDariToken_(token) {
  const t = teks_(token);
  if (!t) throw ralat_('E_LOGIN', 'Log masuk diperlukan.');

  const cache = CacheService.getScriptCache();
  const key = IDENT_CACHE_PREFIX + kunciToken_(t);
  try {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    // cache miss - verify with Google below
  }

  const disahkan = emailDariToken_(t);
  if (!dalamRoster_(disahkan.email)) {
    throw ralat_('E_ROSTER', 'Akaun ' + disahkan.email + ' tiada dalam senarai guru sekolah ini. ' +
      'Log masuk dengan akaun @' + ALLOWED_DOMAIN + ' anda, atau hubungi pentadbir.');
  }

  const ident = { email: disahkan.email };
  const baki = Math.floor(disahkan.exp - Date.now() / 1000) - 30;
  const ttl = Math.min(300, baki);
  if (ttl > 0) {
    try { cache.put(key, JSON.stringify(ident), ttl); } catch (e) {}
  }
  return ident;
}

/** Cache key for a token: a digest, so the raw token is never a cache key. */
function kunciToken_(token) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); })
    .join('')
    .slice(0, 32);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const token = teks_(p.token);

  if (!token) return halamanLogMasuk_('E_LOGIN', '');

  let ident;
  try {
    ident = identitiDariToken_(token);
  } catch (err) {
    // Wrong account, expired token, quota outage - all of them land on the same
    // page, which NAMES which one it was instead of looking like a dead app.
    return halamanLogMasuk_(kodRalat_(err), err.message);
  }

  const template = HtmlService.createTemplateFromFile('Index');
  // The identity is handed to the page BASE64-ENCODED, so that no templating
  // escaping rule can alter it. A JSON literal inserted into an HTML attribute
  // depends on the engine escaping quotes exactly right; base64 contains only
  // A-Za-z0-9+/= , none of which any HTML (or JS) escaper touches, so the
  // attribute comes back byte-identical whatever the engine decides to do.
  // Getting this wrong would render the portal and then fail EVERY data call.
  template.identB64 = Utilities.base64Encode(
    JSON.stringify({ token: token, email: ident.email }));
  return template.evaluate()
    .setTitle('Data SMK Meradong')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** The in-app login / denial page (LogMasuk.html). */
function halamanLogMasuk_(kod, mesej) {
  const template = HtmlService.createTemplateFromFile('LogMasuk');
  template.kod = kod;
  template.mesej = mesej || '';
  template.loginUrl = PORTAL_LOGIN_URL;
  return template.evaluate()
    .setTitle('Log masuk — Data SMK Meradong')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * POST is used by the Pages gate for ONE thing: checking a freshly issued token
 * before it is allowed to load the portal, so a teacher who signed in with the
 * wrong Google account gets a denial screen with a "tukar akaun" button instead
 * of an empty frame.
 *
 * The data plane deliberately does NOT use POST: the app calls google.script.run
 * and passes the token as the first argument, which keeps ONE identity check
 * (identitiDariToken_) rather than a second, weaker door.
 */
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    body = {};
  }

  const act = teks_(body.action);
  if (act === 'whoami') {
    try {
      const ident = identitiDariToken_(body.token);
      return json_({ ok: true, callerEmail: ident.email, allowed: true });
    } catch (err) {
      return json_({ ok: false, code: kodRalat_(err), error: err.message });
    }
  }
  return json_({ ok: false, code: 'E_ACTION', error: 'Tindakan tidak dikenali: ' + act });
}

/**
 * ONE-TIME SETUP - run this from the Apps Script editor (Run -> ujianLogin ->
 * Allow). UrlFetchApp is a scope this project had never used, and ONLY a human
 * can grant it. Until it is granted, every token check fails and NOBODY can log
 * in, so this must be done BEFORE the new version is deployed.
 */
function ujianLogin() {
  Logger.log('--- ujian log masuk DATA SMK MERADONG ---');

  try {
    emailDariToken_('bukan-token-sebenar');
    Logger.log('1. tokeninfo: TIDAK DIJANGKA - token palsu sepatutnya ditolak');
  } catch (err) {
    Logger.log('1. tokeninfo berfungsi (token palsu ditolak, seperti sepatutnya): ' + err.message);
  }

  try {
    Logger.log('2. tab DELIMA: ' + bacaRosterDariSheet_().length + ' e-mel dibaca');
  } catch (err) {
    Logger.log('2. tab DELIMA GAGAL DIBACA: ' + err.message);
  }

  try {
    Logger.log('3. rosterEmails_(): ' + rosterEmails_().length + ' e-mel (cache/simpanan)');
  } catch (err) {
    Logger.log('3. rosterEmails_() GAGAL: ' + err.message);
  }

  Logger.log('--- selesai. Semua 3 baris di atas mesti nampak betul sebelum deploy. ---');
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
// LOGIN REQUIRED (17 Sep 2026): the user first chose this module to be public,
// then asked for the Google login page across the whole portal. Every function
// below therefore takes the ID token as its first argument.

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
function getEnrolmenIndex(token) {
  identitiDariToken_(token);   // the lock: verified token + DELIMA roster

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
function getEnrolmenReport(token, year, month) {
  identitiDariToken_(token);   // the lock: verified token + DELIMA roster

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

// Google Sheets displays 0.96435 as 96.44% (round half up) while JS toFixed(2)
// gives 96.43, because the stored value is really 96.43499999... . Round half up
// on the decimal value so the portal always shows the same figure as the sheet -
// a teacher comparing the two should never see a 0.01 disagreement.
function round2_(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Math.round(Number(n) * 100 + 1e-9) / 100;
}

function getKehadiranAnalysis(token) {
  identitiDariToken_(token);   // the lock: verified token + DELIMA roster

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
      return { code: code, pct: round2_(pct) };
    })
    .filter(function (m) { return m.code !== ''; });

  // month-on-month change in percentage points - computed from the values shown,
  // never read from a separate column, so the two can never disagree
  let previous = null;
  monthly.forEach(function (m) {
    m.beza = (m.pct !== null && previous !== null) ? round2_(m.pct - previous) : null;
    if (m.pct !== null) previous = m.pct;
  });

  // ---- per form (percentages) ----
  const forms = graf.getRange('C17:D21').getValues()
    .map(function (row) {
      const label = String(row[0] || '').trim().toUpperCase();
      const pct = asPct_(row[1]);
      return { form: label, pct: round2_(pct) };
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
    const entry = { name: name, pct: round2_(pct) };
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
      return { code: code, pct: round2_(pct) };
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
    yearlyAverage: round2_(yearly),
    monthly: monthly,
    forms: forms,
    classes: classes,
    classGroups: classGroups,
    monthlyT5: monthlyT5,
    t5Yearly: round2_(t5Yearly),
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
