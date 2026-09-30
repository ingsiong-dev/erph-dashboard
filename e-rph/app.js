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
  VERSI: 'v2.44'
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
  weekLoading: $('week-loading'),
  /* v42 */
  adminBanner: $('admin-banner'),
  adminGuru: $('admin-guru'),
  btnAdmin: $('btn-admin'),
  btnLapor: $('btn-lapor'),
  laporPanel: $('lapor-panel'),
  laporVersi: $('lapor-versi'),
  laporMesej: $('lapor-mesej'),
  laporHantar: $('lapor-hantar'),
  laporTutup: $('lapor-tutup'),
  laporMsg: $('lapor-msg'),
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
  record: null,         // rekod TERAKHIR untuk targetWeek
  /* v41: satu minggu boleh menyimpan BANYAK rekod (satu bagi setiap mata
     pelajaran, dan setiap muat naik semula disimpan sebagai sejarah). Dua medan
     ini memberitahu kad "Anda sudah hantar" APA yang sudah ada pada minggu itu -
     tanpanya guru hanya nampak rekod terakhir dan menyangka bakinya hilang. */
  subjekMinggu: [],     // subjek yang sudah ada pada targetWeek (terbaru dahulu)
  bilRekodMinggu: 0,    // bilangan rekod pada targetWeek
  /* v42 MOD PENTADBIR. `pentadbir` ialah keupayaan yang SERVER berikan
     (bootstrap.pentadbir); `adminOn` pula keadaan butang di footer. Butang itu
     hanya muncul apabila `pentadbir` benar, dan setiap panggilan pentadbir tetap
     diperiksa semula di server - jadi membuka `adminOn` dari konsol pelayar
     tidak membuka apa-apa. */
  pentadbir: false,
  adminOn: false,
  adminGuruList: [],    // senarai DELIMA (hanya diambil dalam mod pentadbir)
  adminGuru: null,      // {nama, email} guru yang sedang dilihat / diwakili
  file: null,           // fail RPH yang dipilih (objek File), atau null
  linkLama: '',         // pautan rekod sedia ada, dikekalkan kalau tiada fail baharu
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

      /* v42: keupayaan pentadbir datang daripada SERVER. `!== true` (bukan
         sekadar "truthy") supaya pelayan lama yang tidak menghantar medan ini
         tidak pernah membuka mod pentadbir secara tidak sengaja. */
      state.pentadbir = data.pentadbir === true;
      if (el.btnAdmin) el.btnAdmin.classList.toggle('hidden', !state.pentadbir);
      if (el.laporVersi) el.laporVersi.textContent = CONFIG.VERSI;

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
  show('send');
  refreshMe();
}

/* ============================================================
   10. SKRIN 2 — HANTAR
   ============================================================ */

function refreshMe() {
  if (!state.teacher) return;

  /* v36: setiap permintaan membawa nombor urutannya sendiri. Guru yang menekan
     dua minggu berturut-turut dengan pantas menghantar dua permintaan apiMe;
     tanpa pengawal ini jawapan LAMA boleh tiba kemudian dan menulis rekod
     minggu lama ke atas minggu yang baru dipilih - guru nampak RPH minggu yang
     salah. Respons basi hanya diabaikan; yang terbaharu sentiasa menang. */
  var seq = ++_meSeq;

  /* v42: dalam mod pentadbir, panggilan itu membawa guru SASARAN. Ia satu-satunya
     perbezaan pada pelanggan - pelayan tetap memutuskan sama ada pemanggil
     dibenarkan, dan guru biasa yang memaksa cawangan ini hanya menerima
     "Akses ditolak: mod pentadbir ...". */
  var panggil = (state.adminOn && state.adminGuru)
    ? serverCall('apiPentadbirLihat', [state.adminGuru.email, state.targetWeek])
    : serverCall('apiMe', [state.targetWeek]);

  withTimeout(panggil, SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (data) {
      if (seq !== _meSeq) return;
      state.weeks = (data && data.weeks) || [];
      state.mySubjects = (data && data.subjects) || [];
      state.record = (data && data.record) || null;
      /* v41: apa yang sudah ada pada minggu ini. Kedua-duanya diberi nilai
         lalai di sini, bukan hanya dibaca apabila ada - halaman lama yang
         bercakap dengan pelayan lama mesti tidak meletupkan kad itu. */
      state.subjekMinggu = (data && data.subjekMinggu) || [];
      state.bilRekodMinggu = Number((data && data.bilRekodMinggu) || 0);
      renderSend();
    })
    .catch(function (err) {
      if (seq !== _meSeq) return;
      state.weeks = [];
      state.mySubjects = [];
      state.record = null;
      state.subjekMinggu = [];
      state.bilRekodMinggu = 0;
      renderSend();
      setMsg('Amaran: kemajuan tidak dapat dimuatkan (' + err.message + ')', 'bad');
    });
}

/* Nombor urutan permintaan apiMe yang terakhir dihantar (lihat refreshMe()). */
var _meSeq = 0;

/* v28: butang UBAH SUAI pada halaman Laporan DIBUANG.
   Pengguna: *"感觉修改键很多余。有错误叫老师删掉重新上载就可以了。"*
   - the same call as v17, so editWeek(), adoptRecordForEdit() dan
   state.editAdopted semuanya dibuang BERSAMA butang itu; kod mati yang masih
   boleh dicapai ialah bug yang menunggu untuk berlaku. Aliran yang tinggal:
   PADAM di halaman Laporan e-RPH, kemudian muat naik semula. */

function renderSend() {
  /* v36: permintaan apiMe sudah selesai (berjaya ATAU gagal), jadi baris
     "Loading…" di bawah peta minggu mesti padam di SINI - ini satu-satunya
     tempat yang dilalui kedua-dua jalan itu. */
  setMingguLoading(false);
  renderBanner();
  renderAdmin();         /* v42: banner "mod pentadbir" ikut keadaan yang sama */
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
     melihat subjek guru lain.

     v41: SEMUA subjek minggu ini disenaraikan, bukan hanya rekod terakhir -
     satu minggu kini menyimpan satu rekod bagi setiap mata pelajaran, dan
     senarai itu ialah cara guru memilih yang mana satu untuk dihantar pula. */
  var sendiri = [];
  var dariMinggu = state.subjekMinggu.slice();
  if (state.record && state.record.subject &&
      dariMinggu.indexOf(state.record.subject) === -1) {
    dariMinggu.push(state.record.subject);
  }
  dariMinggu.forEach(function (s) {
    if (sendiri.indexOf(s) === -1) sendiri.push(s);
  });
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
  return state.weeks.indexOf(w) !== -1 ? 'Sudah dihantar ✓' : 'Belum dihantar';
}

/* v36: maklum balas SERTA-MERTA apabila guru menekan bebola minggu.
   Sebelum ini cincin .sel hanya berpindah selepas pelayan menjawab (~1 saat),
   jadi guru yang tidak nampak apa-apa berlaku menekan lagi - kadang-kadang pada
   minggu yang BERLAINAN, dan dua permintaan apiMe berlumba. Permintaan pengguna:
   "按了 minggu 的按钮，左下角显示 Loading... 避免老师一位没按到，按多次".
   Tempatnya ditentukan oleh pengguna, dan sudah berpindah dua kali:
     v36 - di bawah peta minggu ("左下角")
     v37 - slot kanan baris "Kemajuan anda", BERKONGSI slot dengan kiraan minggu
     v38 - hujung kanan baris legend, iaitu sudut bawah-kanan kad ("放右下角")
   v38: kiraan minggu TIDAK lagi disembunyikan - ia dan pemuat ini berada di
   baris yang berlainan sekarang, jadi tiada slot untuk dikongsi. (v37 menyorok
   #prog-text kerana kedua-duanya anak .progress-head yang flex space-between;
   menyoroknya di situ akan meninggalkan slot kanan kosong.) */
function setMingguLoading(on) {
  if (el.weekLoading) el.weekLoading.classList.toggle('hidden', !on);
}

/* Pindahkan cincin .sel SERTA-MERTA, tanpa menunggu pelayan dan tanpa melukis
   semula peta: membina semula chip semasa jari masih menekan akan membuang
   keadaan .tekan yang sedang dipaparkan. */
function tandakanMinggu(w) {
  var anak = el.weeks.children || [];
  for (var i = 0; i < anak.length; i++) {
    var chip = anak[i];
    if (!chip || !chip.classList) continue;
    var minggu = chip.dataset && chip.dataset.minggu;
    if (minggu === undefined || minggu === null) continue;
    chip.classList.toggle('sel', String(minggu) === String(w));
  }
}

/* Bertukar kepada minggu yang diklik - sama seperti <select> dahulu: subjek dan
   fail direset, kemudian refreshMe() memuatkan semula rekod minggu itu.
   Minggu yang SAMA tidak melakukan apa-apa, kerana <select> dahulu hanya
   memicu 'change' - mengklik ulang minggu semasa tidak boleh memanggil pelayan.
   (v41: state.mode dibuang - borang tidak lagi dikunci, jadi tiada "mod" untuk
   ditetapkan semula. Lihat renderAlready().) */
function pilihMinggu(w) {
  if (w === state.targetWeek) return;
  state.targetWeek = w;
  resetSubject();
  resetFile();
  setMsg('');
  /* v36: dua tanda serta-merta - "Loading…" di bawah peta, dan cincin pada
     minggu yang ditekan. Kedua-duanya hilang/dikonfirmasi oleh renderSend()
     apabila jawapan pelayan tiba. */
  setMingguLoading(true);
  tandakanMinggu(w);
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

/* --- 10d. Sudah hantar? ---
   v41: kad ini MEMAKLUMKAN sahaja, dan ia TIDAK lagi menyembunyikan borang.
   Sebelum v41 ia menutup borang sebaik sahaja minggu itu mempunyai satu rekod,
   jadi satu minggu = satu rekod: guru yang mengajar lima mata pelajaran tidak
   dapat menghantar yang kedua, dan rekod pertama yang sudah ada akan ditimpa
   oleh yang seterusnya. Permintaan pengguna (30 Sep 2026):
   *"需要改成一星期可以提交很多次，可是同一个星期被计算为一次"* - jadi borang
   kekal terbuka, dan kad ini menyenaraikan apa yang SUDAH ada pada minggu itu
   supaya guru nampak dia tidak kehilangan rekod sebelumnya. */
function renderAlready() {
  var submitted = state.weeks.indexOf(state.targetWeek) !== -1;
  var ada = submitted && !!state.record;

  el.already.classList.toggle('hidden', !ada);
  /* Borang SENTIASA kelihatan - itulah cara "hantar berkali-kali" berfungsi. */
  el.form.classList.remove('hidden');

  if (!ada) {
    el.alreadySubject.textContent = '';
    return;
  }

  el.alreadyWeek.textContent = 'Minggu ' + state.targetWeek;

  /* Senarai subjek minggu ini; `record.subject` sebagai jaring keselamatan
     untuk pelayan lama yang belum menghantar subjekMinggu. */
  var senarai = state.subjekMinggu.slice();
  if (!senarai.length && state.record.subject) senarai = [state.record.subject];

  var bil = state.bilRekodMinggu || senarai.length || 1;
  el.alreadySubject.textContent = bil + ' rekod' +
    (senarai.length ? ': ' + senarai.join(' · ') : '');
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

/* Nama yang dipaparkan pada ringkasan "Guru". Dalam mod pentadbir ia MESTI nama
   GURU SASARAN: kalau tidak, pentadbir melihat namanya sendiri pada penghantaran
   yang akan ditulis atas nama orang lain - satu-satunya baris pada skrin itu yang
   boleh membuat dia tersalah faham. */
function guruRingkasan() {
  if (state.adminOn && state.adminGuru) return state.adminGuru.nama;
  return state.teacher || '—';
}

/* v32: tiga teks ini ialah LABEL dalam jadual, bukan pertengahan ayat - jadi
   huruf besar pada perkataan pertama ("belum" -> "Belum", permintaan pengguna).
   Ayat penuh di tempat lain (cth. "Sesi belum bermula.") kekal seperti adanya. */
function renderSummary() {
  var subject = subjectValue();
  var f = state.file;

  var failTeks;
  if (f) {
    failTeks = escapeHtml(f.name) +
               ' <span class="muted">(' + saizMb(f.size) + ')</span>';
  } else if (state.linkLama) {
    failTeks = '<span class="muted">Fail sedia ada dikekalkan</span>';
  } else {
    failTeks = '<span class="muted">Belum dipilih</span>';
  }

  var rows = [
    ['Minggu', weekLabel(state.targetWeek)],
    ['Guru', guruRingkasan()],
    ['Subjek', subject || '<span class="muted">Belum diisi</span>'],
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
    /* v36: nombor minggu pada nod itu sendiri. tandakanMinggu() memindahkan
       cincin .sel serta-merta selepas klik dengan membacanya - tanpa ini ia
       terpaksa meneka daripada textContent. */
    chip.dataset.minggu = String(w);

    if (isHoliday(w)) {
      chip.classList.add('cuti');
      chip.title = weekLabel(w) + ' — cuti';
    } else if (state.weeks.indexOf(w) !== -1) {
      chip.classList.add('done');
      chip.title = weekLabel(w) + ' — ' + weekStatusText(w);
    } else if (w <= state.currentWeek) {
      chip.classList.add('miss');
      chip.title = weekLabel(w) + ' — ' + weekStatusText(w);
    } else {
      chip.title = weekLabel(w) + ' — akan datang';
    }

    if (w === state.currentWeek) chip.classList.add('now');

    /* v29: minggu itu SENDIRI yang menjadi pemilih - menggantikan butang
       "Pilih minggu lain…". Hanya minggu 1..minggu semasa boleh diklik; minggu
       yang belum berlaku kekal sebagai paparan sahaja. */
    if (bolehPilih.indexOf(w) !== -1) {
      chip.classList.add('pilih');
      /* v32: status TIDAK diulang di sini. Versi v29 menambah
         "· belum dihantar — klik untuk pilih" pada tajuk yang sudah berbunyi
         "— belum dihantar", jadi tooltip itu menyebut perkara yang sama dua
         kali. Status kini datang dari satu tempat sahaja (tajuk di atas). */
      chip.title += ' — klik untuk pilih';
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

      /* v42: dalam mod pentadbir, penghantaran pergi ke apiPentadbirHantar dan
         membawa `sebagai` - email guru sasaran. `action` di atas tidak mengawal
         apa-apa di server (setiap laluan menetapkan tindakannya sendiri); ia
         dikekalkan kerana pelanggan lama menghantarnya.

         Baris yang ditulis membawa identiti GURU itu, bukan pentadbir: kalau
         tidak, rekod itu tidak akan muncul dalam laporannya sendiri. Tindakan
         pentadbir dicatat berasingan dalam tab LogAdmin. */
      if (state.adminOn && state.adminGuru) {
        payload.sebagai = state.adminGuru.email;
        return withTimeout(serverCall('apiPentadbirHantar', [payload]), hadMasa, mesejMasa);
      }
      return withTimeout(serverCall('apiSubmit', [payload]), hadMasa, mesejMasa);
    })
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal menghantar');

      /* Pautan SEBENAR datang daripada pelayan (fail yang baru disimpan),
         bukan daripada apa yang ditaip guru. */
      var urlSimpan = res.url || link.url || '';
      state.record = { week: state.targetWeek, url: urlSimpan, subject: subject };

      /* v41: setiap penghantaran MENAMBAH satu baris rekod (tiada lagi
         penggantian), jadi mesejnya menyebut berapa rekod minggu itu sekarang -
         guru nampak kerjanya bertambah, bukan ditimpa. */
      var extra = Number(res.rekodMinggu) > 1
        ? 'Minggu ini kini ada ' + Number(res.rekodMinggu) + ' rekod.'
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
     dipulihkan supaya guru boleh simpan semula tanpa memilih fail.

     v41: pautan itu hanya dipulihkan apabila rekod terakhir minggu ini memakai
     SUBJEK yang sedang dipilih. Satu minggu kini menyimpan banyak rekod, jadi
     memulihkan pautan "rekod terakhir" tanpa mengira subjek akan menyimpan fail
     Matematik di bawah subjek Bahasa Inggeris - dan itu satu-satunya cara
     penghantaran tanpa fail baharu boleh menghasilkan rekod yang SALAH, bukan
     sekadar rekod tambahan. */
  state.file = null;
  if (el.file) el.file.value = '';
  var r = state.record;
  state.linkLama = (r && r.url && String(r.subject || '') === String(subjectValue()))
    ? r.url : '';
  el.url.value = state.linkLama;
  renderFile();
  renderSummary();
});

/* v29: pendengar #btn-other / #other-week dibuang bersama kawalan itu. Setiap
   chip minggu memasang pengekliknya sendiri dalam renderProgress(), jadi tiada
   pendengar global yang tinggal untuk dijaga di sini.

   v30: satu-satunya pendengar global yang ditambah ialah keadaan "ditekan".
   Ia dipasang SEKALI pada bekas #weeks, bukan satu pada setiap chip: chip
   dibina semula pada setiap render, jadi 47 pendengar setiap kali render akan
   menimbun. */
function tandaTekan(ev) {
  var n = ev && ev.target;
  if (n && n.classList && n.classList.contains('week-chip') &&
      n.classList.contains('pilih')) {
    n.classList.add('tekan');
  }
}

/* Buang .tekan daripada SEMUA chip, bukan hanya sasaran: jari yang menggelongsor
   keluar dari kekunci kemudian dilepaskan di luar #weeks tidak akan memicu
   pointerup di sini, dan kekunci itu akan kekal kelihatan tertekan. */
function bersihTekan() {
  var anak = el.weeks.children || [];
  for (var i = 0; i < anak.length; i++) {
    if (anak[i] && anak[i].classList) anak[i].classList.remove('tekan');
  }
}

el.weeks.addEventListener('pointerdown', tandaTekan);
['pointerup', 'pointercancel', 'pointerout'].forEach(function (jenis) {
  el.weeks.addEventListener(jenis, bersihTekan);
});

el.btnAgain.addEventListener('click', function () {
  resetSubject();
  resetFile();
  setMsg('');
  state.targetWeek = state.currentWeek;
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

/* ============================================================
   11c. MOD PENTADBIR (v42) — super user guru data
   ------------------------------------------------------------
   Permintaan pengguna (30 Sep 2026): *"我想开一条super user通道。以便我进入任何
   一位老师的页面来了解他所面临的问题"*, bentuknya: *"老师app里加小小的'Admin'
   不明显的在底部 … 进去了老师名那边是 drop down，我可以选择进入任何一位老师"*.

   TIGA peringkat, dan hanya yang pertama adalah kunci sebenar:
     1. SERVER: CONFIG.PENTADBIR_EMAILS - setiap api pentadbir memeriksa semula
        email pemanggil (lihat assertPentadbir_ dalam Code.gs);
     2. bootstrap.pentadbir -> butang #btn-admin hanya dibuka untuk pentadbir;
     3. keadaan halaman (state.adminOn/adminGuru) -> memilih panggilan mana yang
        dihantar. Peringkat 3 boleh dipalsukan dari konsol pelayar dan ia TIDAK
        membuka apa-apa: pelayan tetap menolak, dan guru tetap hanya melihat
        laporannya sendiri.

   Guru biasa TIDAK NAMPAK butang ini, dan sekiranya ia dipaksa kelihatan, setiap
   panggilan pentadbir ditolak dengan "Akses ditolak: mod pentadbir ...".
   ============================================================ */

function adminNama() {
  return (state.adminGuru && state.adminGuru.nama) || '';
}

/** Banner yang menyatakan dengan jelas siapa yang diwakili. */
function renderAdmin() {
  if (!el.adminBanner) return;

  if (!state.adminOn || !state.adminGuru) {
    el.adminBanner.classList.add('hidden');
    el.adminBanner.innerHTML = '';
    if (el.whoName) el.whoName.textContent = state.teacher || '—';
    return;
  }

  el.adminBanner.classList.remove('hidden');
  el.adminBanner.innerHTML = '🛠️ <strong>Mod pentadbir</strong> — ' +
    'anda melihat halaman <strong>' + escapeHtml(adminNama()) + '</strong>.' +
    '<small>Sebarang penghantaran atau pemadaman di sini ditulis atas nama ' +
    escapeHtml(adminNama()) + ', dan dicatat dalam tab LogAdmin.</small>';
  if (el.whoName) el.whoName.textContent = adminNama();
}

/** Isi <select> pentadbir pada halaman Laporan. */
function renderAdminGuru() {
  if (!el.adminGuru) return;
  el.adminGuru.innerHTML = '';
  el.adminGuru.classList.toggle('hidden', !state.adminOn);
  if (!state.adminOn) return;

  addOption(el.adminGuru, '', '— Pilih guru —');
  state.adminGuruList.forEach(function (g) {
    addOption(el.adminGuru, g.email, g.nama + ' · ' + g.email);
  });
  el.adminGuru.value = (state.adminGuru && state.adminGuru.email) || '';
}

/**
 * Hidup/matikan mod pentadbir. Senarai guru diambil SEKALI sahaja, dan hanya
 * selepas server membenarkan (apiPentadbirGuru menolak guru biasa) - ia senarai
 * penuh 125 guru, jadi ia tidak boleh diminta oleh sesiapa.
 */
function toggleAdmin() {
  if (!state.pentadbir) return;   /* butang pun tidak sepatutnya wujud */

  if (state.adminOn) {
    state.adminOn = false;
    state.adminGuru = null;
    state.adminGuruList = [];
    if (el.btnAdmin) el.btnAdmin.textContent = 'Admin';
    renderAdminGuru();
    renderAdmin();
    /* Kembali ke halaman sendiri: data yang dipaparkan mesti ikut identiti. */
    refreshMe();
    if (typeof LAP !== 'undefined' && LAP.loaded) lapLoadGuru();
    return;
  }

  if (el.btnAdmin) el.btnAdmin.textContent = 'Admin…';
  withTimeout(serverCall('apiPentadbirGuru'), SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || 'Respons tidak sah');
      state.adminGuruList = data.guru || [];
      state.adminOn = true;
      if (el.btnAdmin) el.btnAdmin.textContent = 'Keluar Admin';
      renderAdminGuru();
      renderAdmin();
      setMsg('Mod pentadbir: pilih guru pada halaman Laporan e-RPH.', '');
    })
    .catch(function (err) {
      /* Ditutup semula: butang tidak boleh kekal dalam keadaan "Admin…" yang
         menjanjikan mod yang server baru sahaja tolak. */
      state.adminOn = false;
      state.adminGuruList = [];
      if (el.btnAdmin) el.btnAdmin.textContent = 'Admin';
      renderAdminGuru();
      renderAdmin();
      setMsg('Mod pentadbir tidak dapat dibuka: ' + err.message, 'bad');
    });
}

/** Pilih guru sasaran (hanya dalam mod pentadbir). */
function pilihAdminGuru(email) {
  if (!state.adminOn) return;

  var jumpa = null;
  state.adminGuruList.forEach(function (g) {
    if (g.email === email) jumpa = g;
  });

  state.adminGuru = jumpa;
  if (!jumpa) { renderAdmin(); return; }

  /* Subjek dan fail guru sebelumnya mesti TIDAK bocor ke guru yang baru dipilih. */
  resetSubject();
  resetFile();
  state.targetWeek = state.currentWeek;
  setMsg('');
  renderAdmin();
  refreshMe();
  if (typeof LAP !== 'undefined' && LAP.loaded) lapLoadGuru();
}

if (el.btnAdmin) el.btnAdmin.addEventListener('click', toggleAdmin);
if (el.adminGuru) {
  el.adminGuru.addEventListener('change', function () { pilihAdminGuru(this.value); });
}

/* ============================================================
   11d. LAPOR MASALAH (v42)
   ------------------------------------------------------------
   Sebab yang paling kerap membuat guru berkata "tak boleh / hilang" tidak
   kelihatan dari mana-mana payload: versi halaman yang SEBENARNYA dia jalankan
   (GitHub Pages menyajikan salinan cache sehingga 10 minit), halaman mana, minggu
   mana, dan mesej ralat yang dia nampak. Semuanya ditulis ke tab LaporanMasalah,
   dan identitinya datang daripada sesi di server - bukan daripada borang ini.
   ============================================================ */

function toggleLapor(on) {
  if (!el.laporPanel) return;
  el.laporPanel.classList.toggle('hidden', !on);
  if (on && el.laporMesej) el.laporMesej.focus();
}

function hantarLapor() {
  if (!el.laporHantar) return;

  var mesej = el.laporMesej ? String(el.laporMesej.value || '').trim() : '';
  if (!mesej) {
    if (el.laporMsg) { el.laporMsg.className = 'msg bad'; el.laporMsg.textContent = 'Sila tulis apa yang berlaku.'; }
    return;
  }

  el.laporHantar.disabled = true;
  if (el.laporMsg) { el.laporMsg.className = 'msg wait'; el.laporMsg.textContent = 'Menghantar…'; }

  var laporan = {
    versi: CONFIG.VERSI,
    halaman: (typeof LAP !== 'undefined' && LAP.loaded && !document.getElementById('page-laporan').classList.contains('hidden')) ? 'laporan' : 'hantar',
    minggu: state.targetWeek,
    mesej: mesej,
    agent: (window.navigator && window.navigator.userAgent) || ''
  };

  withTimeout(serverCall('apiLaporMasalah', [laporan]), SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal menghantar');
      if (el.laporMsg) { el.laporMsg.className = 'msg good'; el.laporMsg.textContent = 'Terima kasih — laporan anda sudah sampai ke sekolah.'; }
      if (el.laporMesej) el.laporMesej.value = '';
    })
    .catch(function (err) {
      if (el.laporMsg) { el.laporMsg.className = 'msg bad'; el.laporMsg.textContent = 'Gagal menghantar: ' + err.message; }
    })
    .then(function () {
      el.laporHantar.disabled = false;
    });
}

if (el.btnLapor) el.btnLapor.addEventListener('click', function () { toggleLapor(true); });
if (el.laporTutup) el.laporTutup.addEventListener('click', function () { toggleLapor(false); });
if (el.laporHantar) el.laporHantar.addEventListener('click', hantarLapor);

/* ============================================================
   11e. LOG KELUAR — DIBUANG (v44)
   ------------------------------------------------------------
   v43 menambah butang "Log keluar" di header atas permintaan pengguna; v44
   membuangnya semula atas permintaan yang berikutnya: *"这样的话就不需要logout键了"*.

   Sebab keputusan itu masuk akal, dan sebab ia tidak boleh dikembalikan secara
   sambil lewa:
     - butang itu memutuskan sesi kekal "log masuk sekali sahaja" (v39). Guru yang
       menekannya berpatah balik ke pemilih akaun Google - pada telefon dengan
       beberapa akaun, itulah jalan menuju akaun yang SALAH (masalah v19-v21);
     - membaca halaman guru LAIN tidak memerlukan log keluar: identiti datang
       daripada email pemanggil (CONFIG.PENTADBIR_EMAILS, v42).

   Jalan keluar untuk komputer yang dikongsi KEKAL, tanpa sebarang UI:
       .../e-rph/?logkeluar=1
   `__logKeluar()` dalam blok gate memadamkan kunci sesi di pelayar DAN di server
   (membuang salinan pelayar sahaja akan meninggalkan kredensial yang masih boleh
   dipakai). Kod di sini, `apiSwitchAccount` di server, dan pemetaan shim
   `switchAccount` dibuang BERSAMA butang itu - kod mati yang masih boleh dicapai
   ialah bug yang menunggu untuk berlaku.
   ============================================================ */

boot();
