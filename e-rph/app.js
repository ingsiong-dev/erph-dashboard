/* ============================================================
   e-RPH · SMK Meradong  —  logik frontend
   Reka bentuk: 3 langkah, hampir tiada taip-men-typ, tahan salah.
   ============================================================ */
'use strict';

/* ============================================================
   1. KONFIGURASI
   ============================================================ */

var CONFIG = {
  /* Tiada API_URL. Halaman ini DISAJIKAN oleh Apps Script, jadi panggilan ke
     pelayan dibuat melalui google.script.run (lihat serverCall di bawah).
     Itu membawa identiti pengguna yang sudah log masuk, tiada isu CORS, dan
     tiada URL yang perlu dikemas kini setiap kali deploy.
     Menukar backend = deploy Apps Script, bukan kemas kini GitHub. */

  TAHUN: 2026,

  /* Takwim: Minggu 1 bermula Isnin ini, setiap minggu +7 hari.
     Disahkan terhadap dokumen Takwim:
       M1  = 12/1  (dokumen: 12/1 - 16/1)
       M8  = 2/3   (dokumen: 2/3  - 5/3)
       M36 = 14/9  (submission terakhir 15/9 = Selasa M36)          */
  W1_MONDAY: '2026-01-12',
  TOTAL_WEEKS: 47,

  /* Minggu cuti. Ia HANYA menentukan warna paparan sekarang.
     Minggu cuti tetap BOLEH dihantar dan tetap dikira, supaya penyebut
     "Jumlah Minggu Persekolahan Tahun 2026" (47) benar-benar boleh dicapai -
     sama seperti tingkah laku borang Google yang digantikan. */
  HOLIDAY_WEEKS: [6, 11, 20, 21, 34],

  /* Versi yang DIPAPARKAN pada footer halaman. Ini SATU-SATUNYA tempat nombor
     itu hidup, dan verify_live.py mengesahkan ia sepadan dengan versi
     deployment - supaya footer tidak boleh diam-diam ketinggalan beberapa
     deploy tanpa ada yang perasan. Naikkan bersama setiap deploy. */
  VERSI: 'v2.28'
};

/* Nilai opsyen "Lain-lain…" dalam #subject. Huruf besar dan bergaris bawah
   supaya ia TIDAK PERNAH boleh bertembung dengan nama subjek sebenar, dan
   supaya satu carian sumber dapat membuktikan ia satu-satunya nilai khas. */
var SUBJEK_LAIN = '__LAIN__';

/* ============================================================
   2. UTILITI TARIKH
   ============================================================ */

var DAY_MS = 86400000;

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function w1Date()      { return new Date(CONFIG.W1_MONDAY + 'T00:00:00'); }

function weekFromDate(date) {
  var diff = Math.round((startOfDay(date) - w1Date()) / DAY_MS);
  return Math.floor(diff / 7) + 1;
}

function weekRange(n) {
  var mon = new Date(w1Date().getTime() + (n - 1) * 7 * DAY_MS);
  return { monday: mon, friday: new Date(mon.getTime() + 4 * DAY_MS) };
}

function fmtShort(d) { return d.getDate() + '/' + (d.getMonth() + 1); }

function weekLabel(n) {
  var r = weekRange(n);
  return 'Minggu ' + n + ' (' + fmtShort(r.monday) + ' – ' + fmtShort(r.friday) + ')';
}

function isHoliday(n) { return CONFIG.HOLIDAY_WEEKS.indexOf(n) !== -1; }

/* Semua minggu persekolahan, 1..TOTAL_WEEKS (47).
   Penyebut sengaja TIDAK menolak minggu cuti dan TIDAK dipotong pada minggu
   semasa: "Jumlah Minggu Persekolahan Tahun 2026" ialah 47 - nilai yang sama
   seperti laporan Looker Studio yang digantikan oleh halaman ini. */
function expectedWeeks() {
  var out = [];
  for (var w = 1; w <= CONFIG.TOTAL_WEEKS; w++) out.push(w);
  return out;
}

/* ============================================================
   3. PENORMALAN PAUTAN  ← bahagian paling penting untuk elak silap
   ============================================================ */

/**
 * Terima apa sahaja yang pengguna tampal, keluarkan pautan fail yang bersih.
 * @return {{ok?:boolean, url?:string, id?:string, error?:string, warn?:string}}
 */
function parseLink(raw) {
  var s = String(raw || '').trim();
  if (!s) return { error: 'Sila tampal pautan RPH.' };

  /* Buang teks tambahan — ambil URL pertama sahaja */
  var found = s.match(/https?:\/\/[^\s<>"']+/i);
  if (found) {
    s = found[0];
  } else if (/^(drive|docs)\.google\.com\//i.test(s)) {
    s = 'https://' + s;
  } else {
    return { error: 'Pautan mesti bermula dengan https://' };
  }

  var u;
  try { u = new URL(s); } catch (e) { return { error: 'Pautan tidak sah.' }; }

  var host = u.hostname.toLowerCase().replace(/^www\./, '');

  /* Folder = pasti salah */
  if (/\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) {
    return { error: 'Ini pautan FOLDER, bukan fail. Buka fail RPH anda, ' +
                    'kemudian salin pautan FAIL itu.' };
  }

  if (host !== 'drive.google.com' && host !== 'docs.google.com') {
    return {
      warn: 'Pautan ini bukan daripada Google Drive. Pastikan pengetua boleh membukanya.',
      url: s, id: ''
    };
  }

  /* Cari ID fail */
  var id = '', m;
  if ((m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{15,})/)))            id = m[1];
  else if ((m = u.pathname.match(/\/document\/d\/([A-Za-z0-9_-]{15,})/)))     id = m[1];
  else if ((m = u.pathname.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{15,})/))) id = m[1];
  else if ((m = u.pathname.match(/\/presentation\/d\/([A-Za-z0-9_-]{15,})/))) id = m[1];
  else if (u.searchParams.get('id'))                                          id = u.searchParams.get('id');

  /* Sahkan BENTUK id, bukan sekadar "ada id".
     Corak laluan di atas sudah menuntut 15+ aksara, tetapi ?id= menerima apa
     sahaja - jadi "?id=x" sebelum ini "dinormalkan" menjadi pautan yang
     kelihatan sah dan kemudian disimpan. Sekarang ia ditolak. */
  if (id && !/^[A-Za-z0-9_-]{15,}$/.test(id)) id = '';

  if (!id) {
    return { warn: 'Pautan ini tidak dapat dikenal pasti sebagai satu fail. ' +
                   'Pastikan ia pautan fail, bukan senarai fail.',
             url: s, id: '' };
  }

  /* Tukar kepada pautan 'view' yang bersih */
  var canonical;
  if (host === 'docs.google.com') {
    var kind = /\/document\//.test(u.pathname)     ? 'document'
             : /\/spreadsheets\//.test(u.pathname) ? 'spreadsheets'
             : /\/presentation\//.test(u.pathname) ? 'presentation'
             : null;
    canonical = kind
      ? 'https://docs.google.com/' + kind + '/d/' + id + '/view'
      : 'https://drive.google.com/file/d/' + id + '/view';
  } else {
    canonical = 'https://drive.google.com/file/d/' + id + '/view';
  }

  return { ok: true, url: canonical, id: id };
}

/* ============================================================
   4. DOM
   ============================================================ */

function $(id) { return document.getElementById(id); }

var el = {
  tahun: $('tahun-label'),
  scrLoad: $('scr-load'),
  scrError: $('scr-error'),
  errorMsg: $('error-msg'),
  btnRetry: $('btn-retry'),
  scrPick: $('scr-pick'),
  search: $('search'),
  pickList: $('pick-list'),
  pickEmpty: $('pick-empty'),
  scrSend: $('scr-send'),
  whoName: $('who-name'),
  btnChange: $('btn-change'),
  banner: $('banner'),
  already: $('already'),
  alreadyWeek: $('already-week'),
  alreadySubject: $('already-subject'),
  form: $('form'),
  subject: $('subject'),
  subjectLain: $('subject-lain'),
  subjectList: $('senarai-subjek'),
  file: $('rph-file'),
  fileBtn: $('rph-file-btn'),
  fileHint: $('file-hint'),
  fileChosen: $('file-chosen'),
  fileName: $('file-name'),
  fileClear: $('file-clear'),
  url: $('url'),          /* hidden: membawa pautan rekod sedia ada semasa kemas kini */
  summary: $('summary'),
  btnSubmit: $('btn-submit'),
  msg: $('msg'),
  progText: $('prog-text'),
  weeks: $('weeks'),
  scrDone: $('scr-done'),
  doneDetail: $('done-detail'),
  doneLink: $('done-link'),
  btnAgain: $('btn-again'),
  footVersi: $('foot-versi')
};

/* ============================================================
   5. KEADAAN
   ============================================================ */

var state = {
  teachers: [],
  subjects: [],
  teacher: null,
  email: null,          // email akaun yang log masuk (dari server)
  weeks: [],            // minggu yang sudah dihantar
  mySubjects: [],       // subjek yang pernah digunakan
  currentWeek: weekFromDate(new Date()),
  targetWeek: weekFromDate(new Date()),
  record: null,         // rekod sedia ada untuk targetWeek
  file: null,           // fail RPH yang dipilih (objek File), atau null
  linkLama: '',         // pautan rekod sedia ada, dikekalkan kalau tiada fail baharu
  mode: 'new',          /* v28: 'replace' pergi bersama butang pensel (v17 dahulu,
                           v27 sekali lagi), jadi ini sentiasa 'new'. Dikekalkan
                           kerana renderAlready() membacanya untuk memilih borang
                           lawan kad "sudah hantar". */
  sending: false
};

/* ============================================================
   6. SKRIN
   ============================================================ */

function show(name) {
  var map = {
    load: el.scrLoad, error: el.scrError, pick: el.scrPick,
    send: el.scrSend, done: el.scrDone
  };
  Object.keys(map).forEach(function (k) {
    map[k].classList.toggle('hidden', k !== name);
  });
  window.scrollTo(0, 0);
}

function showError(msg) {
  el.errorMsg.textContent = msg;
  show('error');
}

/* ============================================================
   8. PANGGILAN PELAYAN
   ------------------------------------------------------------
   google.script.run, bukan fetch. Halaman ini disajikan oleh Apps Script
   sendiri, jadi panggilan ini membawa identiti pengguna yang sudah log masuk
   tanpa sebarang urusan CORS atau cookie - dan itulah yang membolehkan
   kawalan akses dijalankan di server.
   ============================================================ */

function serverCall(fn, args) {
  return new Promise(function (resolve, reject) {
    var runner = google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(function (err) {
        reject(new Error((err && err.message) ? err.message : String(err)));
      });
    runner[fn].apply(runner, args || []);
  });
}

/**
 * Never let a spinner lie. google.script.run can stay pending for a long time
 * on a cold start or a heavy call, and a promise that never settles leaves the
 * loading overlay up forever - the exact bug that once locked the whole portal
 * page behind an un-clickable spinner. Every call that shows a spinner must be
 * able to fail out loud.
 */
function withTimeout(promise, ms, message) {
  return new Promise(function (resolve, reject) {
    var selesai = false;
    var jam = setTimeout(function () {
      if (selesai) return;
      selesai = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      function (v) { if (!selesai) { selesai = true; clearTimeout(jam); resolve(v); } },
      function (e) { if (!selesai) { selesai = true; clearTimeout(jam); reject(e); } }
    );
  });
}

var SLOW_SERVER_MS = 45000;
var SLOW_SERVER_MSG = 'Pelayan mengambil masa terlalu lama (lebih 45 saat). ' +
                      'Cuba muat semula halaman.';

/* ============================================================
   8. MULAKAN
   ============================================================ */

function boot() {
  el.tahun.textContent = CONFIG.TAHUN;

  /* Versi pada footer datang daripada CONFIG.VERSI sahaja. Halaman ini
     disajikan oleh Apps Script dan guru tidak boleh "clear cache", jadi nombor
     versi yang kelihatan ialah cara terpantas untuk tahu build mana yang
     sebenarnya sampai kepada mereka. */
  if (el.footVersi) el.footVersi.textContent = CONFIG.VERSI;

  show('load');

  withTimeout(serverCall('apiBootstrap'), SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || 'Respons tidak sah');

      /* Identiti datang daripada akaun yang LOG MASUK, bukan daripada senarai
         nama yang boleh diketuk. Halaman ini sengaja tidak lagi menyediakan
         "ketik nama anda": itu membenarkan sesiapa menghantar bagi pihak orang
         lain. Akaun yang bukan dalam senarai guru sudah ditolak oleh server
         sebelum halaman ini dihantar. */
      state.teachers = [data.nama];
      state.email = data.email || '';
      state.subjects = data.subjects || [];
      fillDatalist(el.subjectList, state.subjects);

      /* v22: senarai mata pelajaran dibina SEKARANG, bukan hanya selepas
         apiMe menjawab. Tanpa ini borang sempat kelihatan dengan senarai
         menurun yang KOSONG - dan senarai kosong pada satu-satunya medan
         wajib kelihatan seperti halaman yang rosak. */
      renderSubjects();

      el.btnChange.classList.add('hidden');   /* identiti tetap, tiada "bukan anda?" */
      el.whoName.title = state.email;
      selectTeacher(data.nama);
    })
    .catch(function (err) {
      showError('Tidak dapat menghubungi pelayan: ' + err.message);
    });
}

function fillDatalist(node, values) {
  node.innerHTML = '';
  var frag = document.createDocumentFragment();
  values.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    frag.appendChild(o);
  });
  node.appendChild(frag);
}

function savedTeacher() {
  try { return localStorage.getItem('erph.teacher'); } catch (e) { return null; }
}

function saveTeacher(name) {
  try { localStorage.setItem('erph.teacher', name); } catch (e) { /* abaikan */ }
}

/* ============================================================
   9. SKRIN 1 — PILIH NAMA (ketik, bukan taip)
   ============================================================ */

function initials(name) {
  var p = String(name).trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function renderPickList(query) {
  var q = String(query || '').trim().toUpperCase();
  var list = state.teachers;

  if (q) {
    list = list.filter(function (t) { return t.toUpperCase().indexOf(q) !== -1; });
  }

  el.pickList.innerHTML = '';
  el.pickEmpty.classList.toggle('hidden', list.length > 0);

  var shown = list.slice(0, 60);
  var frag = document.createDocumentFragment();

  shown.forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-item';
    b.innerHTML = '<span class="avatar"></span><span class="pick-name"></span>';
    b.querySelector('.avatar').textContent = initials(name);
    b.querySelector('.pick-name').textContent = name;
    b.addEventListener('click', function () { selectTeacher(name); });
    frag.appendChild(b);
  });

  el.pickList.appendChild(frag);
}

function selectTeacher(name) {
  state.teacher = name;
  saveTeacher(name);
  el.whoName.textContent = name;
  state.targetWeek = state.currentWeek;
  state.mode = 'new';
  show('send');
  refreshMe();
}

/* ============================================================
   10. SKRIN 2 — HANTAR
   ============================================================ */

function refreshMe() {
  if (!state.teacher) return;

  withTimeout(serverCall('apiMe', [state.targetWeek]), SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (data) {
      state.weeks = (data && data.weeks) || [];
      state.mySubjects = (data && data.subjects) || [];
      state.record = (data && data.record) || null;
      renderSend();
    })
    .catch(function (err) {
      state.weeks = [];
      state.mySubjects = [];
      state.record = null;
      renderSend();
      setMsg('Amaran: kemajuan tidak dapat dimuatkan (' + err.message + ')', 'bad');
    });
}

/* v28: butang UBAH SUAI pada halaman Laporan DIBUANG.
   Pengguna: *"感觉修改键很多余。有错误叫老师删掉重新上载就可以了。"*
   - the same call as v17, so editWeek(), adoptRecordForEdit() dan
   state.editAdopted semuanya dibuang BERSAMA butang itu; kod mati yang masih
   boleh dicapai ialah bug yang menunggu untuk berlaku. Aliran yang tinggal:
   PADAM di halaman Laporan e-RPH, kemudian muat naik semula. */

function renderSend() {
  renderBanner();
  renderSubjects();
  renderAlready();
  renderFile();          /* mesti di sini juga: ia bergantung pada state.file
                            dan state.linkLama, yang berubah mengikut minggu */
  renderSummary();
  renderProgress();
}

/* v17: kad "sudah hantar" tidak lagi mempunyai butang (permintaan 16 Sep 2026 -
   "这3个都去掉"). Membetulkan rekod kini bermakna memadamnya pada halaman
   Laporan e-RPH, kemudian menghantar semula. Sebab itu renderEditControls(),
   armDelete() dan doDelete() DIBUANG dan bukan sekadar disorok: kod mati yang
   masih boleh dicapai ialah bug yang menunggu untuk berlaku. */

/* --- 10a. Banner minggu --- */

function renderBanner() {
  var w = state.targetWeek;
  var b = el.banner;

  if (w !== state.currentWeek) {
    b.className = 'banner aktif';
    b.innerHTML = '🗓️ Anda menghantar untuk <strong>' + weekLabel(w) + '</strong>' +
                  '<small>Ini minggu lepas. Minggu semasa ialah Minggu ' +
                  state.currentWeek + '.</small>';
    return;
  }

  if (w < 1) {
    b.className = 'banner tamat';
    b.innerHTML = 'Sesi belum bermula.<small>Minggu 1 bermula 12/1/' + CONFIG.TAHUN + '.</small>';
    return;
  }

  if (w > CONFIG.TOTAL_WEEKS) {
    b.className = 'banner tamat';
    b.innerHTML = 'Sesi ' + CONFIG.TAHUN + ' telah tamat.<small>Terima kasih.</small>';
    return;
  }

  if (isHoliday(w)) {
    b.className = 'banner cuti';
    b.innerHTML = '🏖️ <strong>' + weekLabel(w) + '</strong> ialah minggu cuti.' +
                  '<small>Minggu cuti tetap dikira dalam Jumlah Minggu ' +
                  'Persekolahan Tahun ' + CONFIG.TAHUN + ', jadi anda boleh ' +
                  'hantar jika perlu.</small>';
  } else {
    b.className = 'banner aktif';
    b.innerHTML = '📌 <strong>' + weekLabel(w) + '</strong>' +
                  '<small>Sila hantar RPH sebelum hujung minggu.</small>';
  }
}

/* --- 10b. Medan mata pelajaran (SATU <select>) ---
   v22 menggantikan baris butang chip dan kotak taip dengan satu senarai
   menurun. Senarai itu mengandungi SUBJEK GURU ITU SAHAJA - sama seperti chip
   yang digantikannya, dan bukan senarai seluruh sekolah. Sebabnya: seorang guru
   mengajar 2-4 subjek, jadi senarai 30 mata pelajaran hanya memperlahankan dia.

   Tiga perkara yang tidak jelas dari kod:

   1. Sebab sebenar perubahan ini: <datalist> TIADA sokongan pada Safari iOS.
      Di telefon, kotak taip itu tidak pernah mencadangkan apa-apa - guru
      terpaksa menaip penuh setiap minggu.
   2. Subjek yang guru TAIP SENDIRI mesti terselamat. Nilai itu tidak ada dalam
      senarai, jadi ia disimpan sebagai pilihan "Lain-lain…" yang dipilih semula
      oleh selectSubject(). Tanpa itu, menukar minggu akan menukar subjek guru
      secara senyap - bukan sekadar paparan yang salah, tetapi data yang ditulis
      ke Responses.
   3. renderSubjects() mesti MENGEKALKAN pilihan semasa. Ia berjalan setiap kali
      refreshMe() selesai (iaitu setiap kali minggu bertukar), dan membina
      semula senarai tanpa memulihkan pilihan akan mengosongkan medan itu. */

function subjectIsLain() { return el.subject.value === SUBJEK_LAIN; }

/* Nilai subjek yang SEBENAR - satu-satunya pembaca yang dibenarkan. Membaca
   el.subject.value terus akan mengembalikan '__LAIN__', iaitu bug yang senyap. */
function subjectValue() {
  if (subjectIsLain()) return String(el.subjectLain.value || '').trim();
  return String(el.subject.value || '').trim();
}

function addOption(parent, value, label) {
  var o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  parent.appendChild(o);
}

/* Tunjukkan kotak taip hanya untuk "Lain-lain…". Teks yang sudah ditaip TIDAK
   dipadam apabila guru menukar kembali kepada senarai - menukar fikiran dua kali
   tidak sepatutnya memusnahkan kerja guru. */
function syncLain() {
  el.subjectLain.classList.toggle('hidden', !subjectIsLain());
}

/* Tetapkan medan kepada nilai v. Kalau v tiada dalam senarai, ia menjadi
   "Lain-lain…" - jadi tiada nilai yang boleh hilang. */
function selectSubject(v) {
  var s = String(v == null ? '' : v).trim();
  var ada = false;

  Array.prototype.forEach.call(el.subject.options, function (o) {
    if (s && o.value === s) ada = true;
  });

  if (ada) {
    el.subject.value = s;
    el.subjectLain.value = '';
  } else if (s) {
    el.subject.value = SUBJEK_LAIN;
    el.subjectLain.value = s;
  } else {
    el.subject.value = '';
    el.subjectLain.value = '';
  }

  syncLain();
}

function resetSubject() { selectSubject(''); }

function renderSubjects() {
  var dipilih = subjectValue();

  el.subject.innerHTML = '';
  addOption(el.subject, '', '— Pilih mata pelajaran —');

  /* Subjek guru INI sahaja: rekod minggu ini dahulu (kalau ada), kemudian
     sejarahnya sendiri, terbaru dahulu. Senarai datang daripada apiMe, yang
     ditapis pada email pemanggil di server - jadi guru lain tidak pernah
     melihat subjek guru lain. */
  var sendiri = [];
  if (state.record && state.record.subject) sendiri.push(state.record.subject);
  state.mySubjects.forEach(function (s) {
    if (sendiri.indexOf(s) === -1) sendiri.push(s);
  });

  sendiri.forEach(function (s) { addOption(el.subject, s, s); });

  /* Tanpa ini, guru yang BELUM PERNAH menghantar tidak mempunyai satu pilihan
     pun - dan satu-satunya medan wajib itu menjadi jalan mati. */
  addOption(el.subject, SUBJEK_LAIN, 'Lain-lain — taip sendiri…');

  selectSubject(dipilih);
}

/* --- 10c. Pilih minggu ---
   v29: pemilihnya ialah PETA KEMAJUAN sendiri. Butang "Pilih minggu lain…" dan
   <select>nya dibuang atas permintaan pengguna ("不要掉 Pilih minggu lain…
   。改成直接点击下面的第几个星期"). Yang tinggal di sini: minggu mana yang
   boleh diklik, apa statusnya, dan apa yang berlaku apabila ia diklik.

   SENARAI INI MESTI MENGANDUNGI SETIAP MINGGU 1..minggu semasa, termasuk yang
   SUDAH dihantar. Versi lama hanya menyenaraikan minggu yang BELUM dihantar
   (dan hanya 6 minggu ke belakang), jadi guru tidak dapat memilih semula
   minggu yang sudah dihantar - bermakna rekod lama tidak boleh dikemas kini
   atau dipadam sama sekali, dan selepas berpindah ke minggu lain mereka tidak
   boleh kembali ke minggu semasa. Itu bug yang dilaporkan 16 Sep 2026
   ("let teachers modify and delete any eRPH - sekarang还不能").
   Status dipaparkan pada tooltip setiap minggu, sama seperti label pada
   <option> dahulu. */
function selectableWeeks() {
  var out = [];
  for (var w = state.currentWeek; w >= 1; w--) out.push(w);
  return out;
}

/* Minggu 1..currentWeek sahaja: guru tidak boleh menghantar untuk minggu yang
   belum berlaku, jadi menawarkannya hanya menjemput data palsu. */
function weekStatusText(w) {
  return state.weeks.indexOf(w) !== -1 ? 'sudah dihantar ✓' : 'belum dihantar';
}

/* Bertukar kepada minggu yang diklik - sama seperti <select> dahulu: subjek dan
   fail direset, kemudian refreshMe() memuatkan semula rekod minggu itu.
   Minggu yang SAMA tidak melakukan apa-apa, kerana <select> dahulu hanya
   memicu 'change' - mengklik ulang minggu semasa tidak boleh memanggil pelayan. */
function pilihMinggu(w) {
  if (w === state.targetWeek) return;
  state.targetWeek = w;
  state.mode = 'new';
  resetSubject();
  resetFile();
  setMsg('');
  refreshMe();
}

/* Satu pengeklik bagi SETIAP minggu, dijana oleh kilang ini. Kalau pengeklik
   yang sama dipasang dalam gelung dengan `var w`, setiap chip akan membaca
   nilai w yang TERAKHIR - klik mana-mana minggu akan membuka minggu 47. */
function klikMinggu(w) {
  return function (ev) {
    if (ev && ev.type === 'keydown' &&
        !(ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar')) return;
    pilihMinggu(w);
  };
}

/* --- 10d. Sudah hantar? --- */

function renderAlready() {
  var submitted = state.weeks.indexOf(state.targetWeek) !== -1;
  var locked = state.mode === 'new' && submitted && !!state.record;

  el.already.classList.toggle('hidden', !locked);

  if (locked) {
    el.alreadyWeek.textContent = 'Minggu ' + state.targetWeek;
    el.alreadySubject.textContent = state.record.subject || '';
    el.form.classList.add('hidden');
  } else {
    el.form.classList.remove('hidden');
  }
}

/* --- 10e. Fail RPH (menggantikan medan pautan) ---
   Guru tidak lagi menaip pautan. Dia memilih fail; pelayan menyimpannya ke
   Drive sekolah dan menjana pautannya - sama seperti borang Google lama. */

var MAX_FAIL_MB = 10;

function saizMb(bait) {
  var mb = Number(bait || 0) / 1048576;
  if (mb >= 1) return (Math.round(mb * 10) / 10) + ' MB';
  return Math.max(1, Math.round(Number(bait || 0) / 1024)) + ' KB';
}

/* Fail -> base64 tanpa awalan data URL. google.script.run menghantar JSON,
   jadi ini cara membawa bait fail ke pelayan. */
function bacaFailBase64(fail) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || '');
      var koma = s.indexOf(',');
      if (koma < 0) { reject(new Error('Fail tidak dapat dibaca.')); return; }
      resolve(s.slice(koma + 1));
    };
    fr.onerror = function () { reject(new Error('Fail tidak dapat dibaca.')); };
    fr.readAsDataURL(fail);
  });
}

/* Kosongkan pilihan fail. Input fail juga ditetapkan semula supaya fail yang
   SAMA boleh dipilih semula - pelayar tidak mencetuskan 'change' kalau nilai
   input tidak berubah. */
function resetFile() {
  state.file = null;
  state.linkLama = '';
  el.url.value = '';
  if (el.file) el.file.value = '';
  renderFile();
}

function renderFile() {
  var f = state.file;

  /* Butang membuka pemilih fail menukar teks supaya guru tahu dia boleh
     menggantikan fail, bukan hanya menambah satu lagi. */
  if (el.fileBtn) el.fileBtn.textContent = f ? 'Tukar fail RPH…' : 'Pilih fail RPH…';

  if (f) {
    el.fileChosen.classList.remove('hidden');
    el.fileName.textContent = f.name + ' · ' + saizMb(f.size);
    el.fileClear.classList.remove('hidden');
    el.fileHint.className = 'hint good';
    el.fileHint.textContent = '✓ Fail akan dimuat naik dan disimpan oleh sekolah.';
    return;
  }

  el.fileClear.classList.add('hidden');

  if (state.linkLama) {
    el.fileChosen.classList.remove('hidden');
    el.fileName.textContent = 'Fail sedia ada dikekalkan';
    el.fileHint.className = 'hint';
    el.fileHint.textContent = 'Pilih fail baharu untuk menggantikannya, atau ' +
                              'biarkan kosong untuk mengekalkan fail asal.';
    return;
  }

  el.fileChosen.classList.add('hidden');
  el.fileName.textContent = '';
  el.fileHint.className = 'hint';
  el.fileHint.textContent = 'Pilih fail RPH daripada komputer atau telefon anda.';
}

/* Had saiz disemak DI SINI supaya guru tahu serta-merta - bukan selepas
   menunggu muat naik yang akan gagal. */
function pilihFail(fail) {
  state.file = null;

  if (!fail) { renderFile(); return; }

  var had = MAX_FAIL_MB * 1048576;

  if (!fail.size) {
    if (el.file) el.file.value = '';
    renderFile();
    el.fileHint.className = 'hint bad';
    el.fileHint.textContent = '✕ Fail itu kosong.';
    return;
  }

  if (fail.size > had) {
    if (el.file) el.file.value = '';
    renderFile();
    el.fileHint.className = 'hint bad';
    el.fileHint.textContent = '✕ Fail ini ' + saizMb(fail.size) + ' — had ialah ' +
                              MAX_FAIL_MB + ' MB. Sila pilih fail yang lebih kecil.';
    return;
  }

  state.file = fail;
  /* Fail baharu mengalahkan pautan rekod lama. */
  state.linkLama = '';
  el.url.value = '';
  renderFile();
  renderSummary();
}

/* --- 10f. Ringkasan sebelum hantar --- */

function renderSummary() {
  var subject = subjectValue();
  var f = state.file;

  var failTeks;
  if (f) {
    failTeks = escapeHtml(f.name) +
               ' <span class="muted">(' + saizMb(f.size) + ')</span>';
  } else if (state.linkLama) {
    failTeks = '<span class="muted">fail sedia ada dikekalkan</span>';
  } else {
    failTeks = '<span class="muted">belum dipilih</span>';
  }

  var rows = [
    ['Minggu', weekLabel(state.targetWeek)],
    ['Guru', state.teacher || '—'],
    ['Subjek', subject || '<span class="muted">belum diisi</span>'],
    ['Fail RPH', failTeks]
  ];

  var html = rows.map(function (r) {
    return '<div class="row"><span class="k">' + r[0] + '</span>' +
           '<span class="v">' + r[1] + '</span></div>';
  }).join('');

  el.summary.className = 'summary';
  el.summary.innerHTML = html;

  var ready = !!subject && (!!f || !!state.linkLama) &&
              state.targetWeek <= CONFIG.TOTAL_WEEKS && state.targetWeek >= 1;
  el.btnSubmit.disabled = !ready || state.sending;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* --- 10f. Kemajuan --- */

function renderProgress() {
  var expected = expectedWeeks();
  var done = expected.filter(function (w) { return state.weeks.indexOf(w) !== -1; });

  /* Tiada peratus dan tiada bar kemajuan: "47" ialah rujukan berapa minggu
     persekolahan dalam setahun, bukan markah pencapaian peribadi. */
  el.progText.textContent = done.length + ' / ' + expected.length + ' minggu';

  el.weeks.innerHTML = '';
  var frag = document.createDocumentFragment();
  var bolehPilih = selectableWeeks();

  for (var w = 1; w <= CONFIG.TOTAL_WEEKS; w++) {
    var chip = document.createElement('div');
    chip.className = 'week-chip';
    chip.textContent = w;

    if (isHoliday(w)) {
      chip.classList.add('cuti');
      chip.title = weekLabel(w) + ' — cuti';
    } else if (state.weeks.indexOf(w) !== -1) {
      chip.classList.add('done');
      chip.title = weekLabel(w) + ' — selesai';
    } else if (w <= state.currentWeek) {
      chip.classList.add('miss');
      chip.title = weekLabel(w) + ' — belum dihantar';
    } else {
      chip.title = weekLabel(w) + ' — akan datang';
    }

    if (w === state.currentWeek) chip.classList.add('now');

    /* v29: minggu itu SENDIRI yang menjadi pemilih - menggantikan butang
       "Pilih minggu lain…". Hanya minggu 1..minggu semasa boleh diklik; minggu
       yang belum berlaku kekal sebagai paparan sahaja. */
    if (bolehPilih.indexOf(w) !== -1) {
      chip.classList.add('pilih');
      chip.title += ' · ' + weekStatusText(w) + ' — klik untuk pilih';
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.addEventListener('click', klikMinggu(w));
      chip.addEventListener('keydown', klikMinggu(w));
    }

    /* Minggu yang sedang dihantar/dikemas kini. Selalunya sama dengan .now,
       tetapi TIDAK semestinya: selepas guru mengklik minggu lama, cincin itu
       mesti berpindah ke minggu itu. */
    if (w === state.targetWeek) chip.classList.add('sel');

    frag.appendChild(chip);
  }

  el.weeks.appendChild(frag);
}

/* ============================================================
   11. HANTAR
   ============================================================ */

function setMsg(text, kind) {
  el.msg.className = 'msg ' + (kind || '');
  el.msg.textContent = text || '';
}

/* Muat naik mengambil masa, jadi had masa dilonggarkan apabila ada fail.
   Pelayan sendiri mati pada 6 minit, jadi 150s masih selamat. */
var UPLOAD_SERVER_MS = 150000;
var UPLOAD_SERVER_MSG = 'Muat naik mengambil masa terlalu lama. Sila cuba fail ' +
                        'yang lebih kecil, atau periksa sambungan internet anda.';

function onSubmit(ev) {
  ev.preventDefault();
  if (state.sending) return;

  var subject = subjectValue();
  if (!subject) {
    setMsg('Sila pilih mata pelajaran.', 'bad');
    /* Fokus mesti pergi ke kawalan yang benar-benar kosong - kalau tidak guru
       melihat kursor berkelip pada senarai sambil diberitahu ia kosong. */
    (subjectIsLain() ? el.subjectLain : el.subject).focus();
    return;
  }

  var fail = state.file;

  /* Pautan rekod sedia ada mesti sah kalau tiada fail baharu dipilih. */
  var link = { url: '' };
  if (!fail) {
    if (!state.linkLama) {
      setMsg('Sila pilih fail RPH.', 'bad');
      if (el.file) el.file.focus();
      return;
    }
    link = parseLink(state.linkLama);
    if (link.error || link.warn) {
      setMsg('Fail rekod lama tidak dapat digunakan (' + (link.error || link.warn) +
             '). Sila pilih fail RPH.', 'bad');
      return;
    }
  }

  state.sending = true;
  el.btnSubmit.disabled = true;
  el.btnSubmit.textContent = fail ? 'Memuat naik…' : 'Menghantar…';
  setMsg(fail ? 'Sedang memuat naik fail…' : 'Sedang menghantar…', 'wait');

  var hadMasa = fail ? UPLOAD_SERVER_MS : SLOW_SERVER_MS;
  var mesejMasa = fail ? UPLOAD_SERVER_MSG : SLOW_SERVER_MSG;

  /* Fail dibaca dahulu. Kalau bacaan gagal, tiada apa-apa yang dihantar dan
     borang kekal utuh - guru tidak perlu menaip semula. */
  var baca = fail ? bacaFailBase64(fail)
                  : Promise.resolve('');

  baca
    .then(function (b64) {
      var payload = {
        /* 'teacher' sengaja TIADA di sini: server menetapkan nama dan email
           daripada akaun yang log masuk. */
        action: 'submit',
        week: state.targetWeek,
        subject: subject,
        url: fail ? '' : link.url,      /* fail mengalahkan pautan */
        tahun: CONFIG.TAHUN
      };
      if (b64) {
        payload.file = {
          name: fail.name,
          mimeType: fail.type || 'application/octet-stream',
          dataBase64: b64
        };
      }
      return withTimeout(serverCall('apiSubmit', [payload]), hadMasa, mesejMasa);
    })
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal menghantar');

      /* Pautan SEBENAR datang daripada pelayan (fail yang baru disimpan),
         bukan daripada apa yang ditaip guru. */
      var urlSimpan = res.url || link.url || '';
      state.record = { week: state.targetWeek, url: urlSimpan, subject: subject };
      state.mode = 'new';

      var extra = res.mode === 'updated'
        ? 'Rekod lama untuk minggu ini telah digantikan.'
        : '';
      el.doneDetail.textContent = weekLabel(state.targetWeek) + ' · ' + subject +
                                  (extra ? ' · ' + extra : '');
      el.doneLink.href = urlSimpan || '#';

      /* Amaran lembut: pautan sama pernah digunakan untuk minggu lain.
         Dengan muat naik ini tidak sepatutnya berlaku, jadi ia hanya muncul
         untuk rekod lama yang dikekalkan. */
      if (res.urlElsewhere > 0) {
        el.doneDetail.textContent +=
          ' · Perhatian: fail ini juga ada pada ' + res.urlElsewhere +
          ' rekod minggu lain. Sila semak jika tersalah.';
      }

      resetFile();
      show('done');
    })
    .catch(function (err) {
      setMsg('Gagal menghantar: ' + err.message + ' — sila cuba lagi.', 'bad');
    })
    .then(function () {
      state.sending = false;
      el.btnSubmit.textContent = 'HANTAR RPH';
      renderSummary();
    });
}

/* ============================================================
   12. PERISTIWA
   ============================================================ */

el.search.addEventListener('input', function () {
  renderPickList(el.search.value);
});

el.btnChange.addEventListener('click', function () {
  state.teacher = null;
  el.search.value = '';
  renderPickList('');
  show('pick');
  el.search.focus();
});

el.subject.addEventListener('change', function () {
  syncLain();
  /* Fokus melompat ke kotak taip supaya guru terus boleh menaip - satu ketikan
     kurang, dan jelas bahawa "Lain-lain…" meminta teks. */
  if (subjectIsLain()) el.subjectLain.focus();
  renderSummary();
});

el.subjectLain.addEventListener('input', function () { renderSummary(); });

el.file.addEventListener('change', function () {
  pilihFail(this.files && this.files[0]);
});

el.fileClear.addEventListener('click', function () {
  /* Buang fail yang dipilih. Kalau ini kemas kini rekod lama, pautan asal
     dipulihkan supaya guru boleh simpan semula tanpa memilih fail. */
  state.file = null;
  if (el.file) el.file.value = '';
  state.linkLama = (state.record && state.record.url) || '';
  el.url.value = state.linkLama;
  renderFile();
  renderSummary();
});

/* v29: pendengar #btn-other / #other-week dibuang bersama kawalan itu. Setiap
   chip minggu memasang pengekliknya sendiri dalam renderProgress(), jadi tiada
   pendengar global yang tinggal untuk dijaga di sini. */

el.btnAgain.addEventListener('click', function () {
  resetSubject();
  resetFile();
  setMsg('');
  state.targetWeek = state.currentWeek;
  state.mode = 'new';
  show('send');
  refreshMe();
});

/* ============================================================
   11b. PADAM REKOD
   ------------------------------------------------------------
   v17: butang padam pada kad "sudah hantar" DIBUANG. Padam kini hanya
   daripada tong sampah pada halaman Laporan e-RPH (laporan.js), yang
   memanggil apiDelete dengan pengesahan dua langkahnya sendiri.
   ============================================================ */

el.form.addEventListener('submit', onSubmit);
el.btnRetry.addEventListener('click', boot);

boot();
