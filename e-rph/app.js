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
     deploy tanpa ada yang perasan. Naikkan bersama setiap deploy.

     v45: tiada perubahan pada app.js - nombor ini naik bersama server (fungsi
     pentadbir tidak lagi memanggil semakan sesi Google) dan halaman Pages
     (penolakan dikelaskan mengikut kod [E1]-[E5]).

     v46: butang/panel "Lapor masalah" DIBUANG (markup, kod, CSS, shim, laluan
     dan endpoint server) - nombor ini naik bersama dua front end itu.

     v47: emel "Document shared with you" pada setiap muat naik DIBUANG
     (kongsi melalui Drive API dengan sendNotificationEmail=false; addViewer()
     hanya jaring keselamatan). Tiada perubahan pada app.js sendiri - nombor ini
     naik bersama SERVER sahaja.

     v48: `?action=whoami` melaporkan `kongsiSenyap` ("ya"/"TIDAK"). Tanpa itu
     tiada cara mengesahkan pembetulan v47 pada deployment sebenar: `?action=diag`
     berkunci sejak v19 (ia selepas assertAllowed_()), dan kegagalan kongsi
     senyap hanya kelihatan di peti masuk guru. Nombor ini naik bersama SERVER
     sahaja sekali lagi.

     v49: SATU PENGHANTARAN MEMBAWA BANYAK FAIL (*"让老师可以一次交多本文件"*,
     1 Okt 2026). Guru memilih beberapa fail sekali gus; setiap fail menjadi satu
     baris dengan mata pelajarannya SENDIRI, dan baris yang berkongsi mata
     pelajaran disimpan ke dalam SATU folder Drive rekod itu
     (*"自动建文件夹。laporan打开文件夹。这样就不会因为多文件变多link"*) - jadi
     lajur URL dalam sheet tetap membawa SATU pautan bagi setiap rekod, dan
     halaman Laporan membuka folder itu. Setiap fail dihantar dalam panggilan API
     sendiri, BERURUTAN, jadi saiz permintaan kekal kecil dan kegagalan separa
     boleh dilaporkan per fail. Pautan lama "kekalkan rekod sedia ada"
     (`#url` + `state.linkLama`) DIBUANG bersama perubahan ini: rekod kini
     dicipta oleh failnya, jadi menghantar tanpa fail tiada maksud.

     v50: tiada perubahan pada app.js - nombor ini naik bersama penjelasan
     "Borang di bawah kekal terbuka …" pada kad "sudah hantar" yang DIBUANG dari
     index.html atas permintaan pengguna (*"remove 'Borang di bawah kekal
     terbuka …'"*). Nombor versi mesti naik bersama setiap deploy: footer ialah
     satu-satunya cara guru tahu build mana yang sampai kepada mereka.

     v51: bebola minggu "Belum" menjadi MERAH PEPEJAL dengan teks PUTIH
     (*"红色的minggu不明显"*, kemudian *"要红底白字"*). Sebelum ini badannya
     `--red-soft` (#fdecec) dengan teks merah, dan pada kad putih - dengan kilau
     putih di atasnya - bebola itu membaca sebagai putih. Tiada perubahan pada
     app.js sendiri; nombor ini naik bersama styles.css. */
  VERSI: 'v2.51'
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
   3. (nombor 3 dibuang bersama parseLink)
   ------------------------------------------------------------
   v11-v48 menormalkan pautan yang GURU TAMPAL di sini: parseLink() mengubah
   apa-apa bentuk pautan Drive menjadi pautan 'view' yang bersih, menolak pautan
   folder, dan memberi amaran tentang hos bukan Google. v49 membuangnya bersama
   medan pautan itu sendiri (*"自动建文件夹。laporan打开文件夹。这样就不会因为多文件
   变多link"*): guru tidak lagi menampal pautan - dia memilih fail, dan PELAYAN
   menyimpannya ke dalam folder rekod. URL yang masuk ke lajur sheet kini
   dijana sepenuhnya di server (DriveApp folder.getUrl()), jadi tiada pautan
   yang perlu dinormalkan di pelayar.

   Penomboran seksyen ini SENGAJA tidak diubah semula: nombor 4..12 dipakai oleh
   banyak komen, dan menomborkan semula fail ini akan menjadikan setiap rujukan
   itu salah tanpa sebab. */

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
  /* v49: senarai fail menggantikan satu baris "fail dipilih" (file-chosen /
     file-name / file-clear) dan medan tersembunyi #url. */
  failSenarai: $('fail-senarai'),
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
  /* v46: btnLapor + panel aduan (laporPanel/laporVersi/laporMesej/laporHantar/
     laporTutup/laporMsg) DIBUANG bersama ciri itu sendiri. */
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
  /* v49: fail yang dipilih guru - SATU baris bagi setiap fail, dengan mata
     pelajarannya sendiri: [{ id, fail, subjek, pakaiUtama }]. Reka bentuk lama
     menyimpan SATU fail (state.file) ditambah pautan rekod lama
     (state.linkLama); kedua-duanya dibuang bersama ciri "kemas kini tanpa muat
     naik", kerana rekod kini dicipta oleh failnya. */
  failSenarai: [],
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
  renderFail();          /* mesti di sini juga: ia bergantung pada senarai fail
                            yang dipilih dan pada rekod minggu ini */
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
     sejarahnya sendiri, terbaru dahulu. Senarai itu dikongsi dengan setiap
     baris fail (senaraiSubjekSendiri, v49) supaya kedua-duanya tidak boleh
     menyimpang. Ia datang daripada apiMe, yang ditapis pada email pemanggil di
     server - jadi guru lain tidak pernah melihat subjek guru lain.

     v41: SEMUA subjek minggu ini disenaraikan, bukan hanya rekod terakhir -
     satu minggu menyimpan satu rekod bagi setiap mata pelajaran, dan senarai
     itu ialah cara guru memilih yang mana satu untuk dihantar pula. */
  senaraiSubjekSendiri().forEach(function (s) { addOption(el.subject, s, s); });

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

  /* Senarai rekod minggu ini; `record.subject` sebagai jaring keselamatan
     untuk pelayan lama yang belum menghantar subjekMinggu.

     v49: setiap rekod ialah SATU FOLDER Drive (RPH + RPT + bahan di dalamnya),
     jadi kad ini menyenaraikan subjek sahaja - bilangan fail dibaca dengan
     membuka folder itu dari halaman Laporan, bukan dikira di sini (ia
     memerlukan satu panggilan Drive bagi setiap rekod). */
  var senarai = state.subjekMinggu.slice();
  if (!senarai.length && state.record && state.record.subject) {
    senarai = [state.record.subject];
  }

  var bil = state.bilRekodMinggu || senarai.length || 1;
  el.alreadySubject.textContent = bil + ' rekod' +
    (senarai.length ? ': ' + senarai.join(' · ') : '');
}

/* --- 10e. Fail RPH - SENARAI fail (v49) ---
   Guru tidak lagi menaip pautan, dan tidak lagi terhad kepada SATU fail.
   Permintaan pengguna (1 Okt 2026): *"让老师可以一次交多本文件"* - dia memilih
   BEBERAPA fail sekali gus; setiap fail menjadi satu baris di bawah dengan mata
   pelajarannya SENDIRI, jadi satu penghantaran boleh merangkumi beberapa mata
   pelajaran (A) DAN beberapa fail bagi satu mata pelajaran (B).

   Baris yang berkongsi mata pelajaran menjadi SATU rekod: pelayan menambahkan
   pautan pada baris rekod yang sudah ada (submitUntuk_ v49), jadi satu rekod
   membawa RPH + RPT + bahan.

   Kenapa SATU permintaan bagi setiap fail, bukan satu permintaan besar:
     - had permintaan Apps Script: 8 fail x 10 MB sebagai base64 ialah ~107 MB
       dalam satu permintaan - jauh melebihi siling, dan kegagalannya tidak
       dapat dipulihkan separuh jalan;
     - kegagalan separa boleh dilaporkan PER FAIL: guru hanya mencuba semula
       fail yang gagal, bukan memilih semula kesemuanya. */

var MAX_FAIL_MB = 10;        /* had satu fail - sama dengan CONFIG.MAX_UPLOAD_MB */
var MAX_FAIL_HANTAR = 8;     /* had satu penghantaran (satu tekan HANTAR RPH) */
var MAX_FAIL_REKOD = 6;      /* had satu rekod - sama dengan CONFIG.MAX_FAIL_REKOD */

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

/* Kunci mata pelajaran: huruf kecil, ruang tepi dibuang.
   Peraturan yang SAMA dipakai pelayan (submitUntuk_, deleteUntuk_,
   laporanGuru_), jadi "BM" dan "bm " ialah SATU rekod di kedua-dua pihak.
   Kalau pelanggan mengira dua kumpulan dan pelayan menulisnya sebagai satu,
   guru akan melihat bilangan rekod yang berbeza daripada yang disimpannya. */
function kunciSubjek(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

/* Nombor unik bagi setiap baris fail. Ia dipakai untuk mencari baris yang
   GAGAL selepas penghantaran (dan bukan indeks array, yang beralih apabila
   baris berjaya dibuang). */
var _failId = 0;

/* Kosongkan senarai fail. Input fail juga ditetapkan semula supaya fail yang
   SAMA boleh dipilih semula - pelayar tidak mencetuskan 'change' kalau nilai
   input tidak berubah. */
function resetFile() {
  state.failSenarai = [];
  if (el.file) el.file.value = '';
  renderFail();
}

/* Subjek lalai bagi baris BAHARU: medan utama pada masa fail itu dipilih.
   Ia boleh KOSONG (guru belum pilih apa-apa) - baris itu kemudian mengikut
   medan utama sehingga ia diisi, lihat syncSubjekFail(). */
function tambahFail(fail) {
  state.failSenarai.push({
    id: 'f' + (++_failId),
    fail: fail,
    subjek: subjectValue()
  });
}

/* Terima senarai File daripada <input type="file" multiple>.
   Setiap fail disemak DI SINI supaya guru tahu serta-merta - bukan selepas
   menunggu muat naik yang akan gagal. Fail yang ditolak tidak menggagalkan
   yang lain: satu fail 20 MB tidak sepatutnya membatalkan tujuh yang sah. */
function pilihFailSenarai(senarai) {
  var had = MAX_FAIL_MB * 1048576;
  var tolak = [];
  var masuk = 0;

  Array.prototype.slice.call(senarai || []).forEach(function (f) {
    if (!f) return;

    if (state.failSenarai.length >= MAX_FAIL_HANTAR) {
      tolak.push(f.name + ' — had ' + MAX_FAIL_HANTAR + ' fail setiap penghantaran');
      return;
    }
    if (!f.size) { tolak.push(f.name + ' — fail kosong'); return; }
    if (f.size > had) {
      tolak.push(f.name + ' — ' + saizMb(f.size) + ', had ' + MAX_FAIL_MB + ' MB');
      return;
    }

    /* Fail yang SAMA dipilih dua kali = satu baris sahaja. Nama + saiz + masa
       ubah suai sudah cukup untuk mengenalinya. */
    var sudah = state.failSenarai.some(function (r) {
      return r.fail && r.fail.name === f.name && r.fail.size === f.size &&
             r.fail.lastModified === f.lastModified;
    });
    if (sudah) { tolak.push(f.name + ' — sudah ada dalam senarai'); return; }

    tambahFail(f);
    masuk++;
  });

  if (el.file) el.file.value = '';   /* supaya fail yang SAMA boleh dipilih semula */
  renderFail();
  renderSummary();

  if (tolak.length) {
    el.fileHint.className = 'hint bad';
    el.fileHint.textContent = '✕ ' + tolak.join(' · ');
  } else if (masuk) {
    el.fileHint.className = 'hint good';
    el.fileHint.textContent = '✓ ' + state.failSenarai.length +
                              ' fail sedia untuk dihantar.';
  }

  return masuk;
}

function buangFail(id) {
  state.failSenarai = state.failSenarai.filter(function (r) { return r.id !== id; });
  renderFail();
  renderSummary();
}

/* Senarai mata pelajaran yang ditawarkan kepada guru: rekod minggu ini dahulu,
   kemudian sejarahnya sendiri, terbaru dahulu. Dikongsi oleh medan utama
   (#subject) dan oleh setiap baris fail - dua senarai yang berbeza akan
   membenarkan guru memilih subjek pada satu baris yang tidak ada pada yang
   lain, dan itu hanya mengelirukan. */
function senaraiSubjekSendiri() {
  var sendiri = [];
  var dariMinggu = state.subjekMinggu.slice();

  if (state.record && state.record.subject &&
      dariMinggu.indexOf(state.record.subject) === -1) {
    dariMinggu.push(state.record.subject);
  }

  dariMinggu.forEach(function (s) { if (sendiri.indexOf(s) === -1) sendiri.push(s); });
  state.mySubjects.forEach(function (s) { if (sendiri.indexOf(s) === -1) sendiri.push(s); });

  return sendiri;
}

/* Isi satu <select> subjek bagi SATU BARIS FAIL.
   ⚠ Ia SENGAJA tidak menawarkan pilihan "Lain-lain…": kotak taip bebas hanya
   wujud untuk medan utama (#subject-lain). Kalau satu baris boleh memilih
   "Lain-lain", nilai baris itu menjadi sentinela `__LAIN__` - dan sentinela itu
   akan dihantar sebagai nama mata pelajaran yang sebenar. Subjek baharu
   diperkenalkan melalui medan utama (taip di sana), kemudian baris yang dipilih
   selepas itu mewarisinya. */
function isiPilihanSubjek(select, nilaiDipilih) {
  select.innerHTML = '';
  addOption(select, '', '— Pilih mata pelajaran —');

  senaraiSubjekSendiri().forEach(function (s) { addOption(select, s, s); });

  var v = String(nilaiDipilih == null ? '' : nilaiDipilih);
  var ada = false;
  Array.prototype.forEach.call(select.options, function (o) {
    if (v && o.value === v) ada = true;
  });

  if (ada) {
    select.value = v;
  } else if (v) {
    /* Subjek yang diwarisi daripada medan utama tidak ada dalam senarai guru
       (contohnya subjek yang baru ditaip): tambah sebagai pilihan sendiri supaya
       nilainya TIDAK hilang semasa melukis semula. Nilai itu memang sah -
       pelayan menerima apa-apa teks. */
    addOption(select, v, v);
    select.value = v;
  } else {
    select.value = '';
  }
}

/* Lukis semula senarai fail + petunjuknya. Dipanggil pada setiap perubahan
   (fail ditambah/dibuang, subjek ditukar, minggu bertukar). */
function renderFail() {
  var senarai = state.failSenarai;

  if (el.fileBtn) {
    el.fileBtn.textContent = senarai.length ? 'Tambah fail RPH…' : 'Pilih fail RPH…';
  }

  if (el.failSenarai) {
    el.failSenarai.innerHTML = '';

    if (senarai.length) {
      var frag = document.createDocumentFragment();
      var bilRekod = kumpulanMengikutSubjek(senarai).length;

      senarai.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'fail-row';
        row.dataset.id = r.id;

        var nama = document.createElement('div');
        nama.className = 'fail-nama';
        /* Nama + saiz dalam SATU nod teks: saiz ialah sebahagian daripada label
           fail itu, dan satu nod bermakna pemilih fail telefon (yang memotong
           teks panjang) tidak boleh memotong saiznya ke baris yang berasingan. */
        nama.textContent = r.fail.name + ' · ' + saizMb(r.fail.size);
        nama.title = r.fail.name;

        var sel = document.createElement('select');
        sel.className = 'fail-subjek';
        sel.setAttribute('aria-label', 'Mata pelajaran bagi ' + r.fail.name);
        isiPilihanSubjek(sel, r.subjek);

        var buang = document.createElement('button');
        buang.type = 'button';
        buang.className = 'link-btn danger fail-buang';
        buang.dataset.buang = r.id;
        buang.textContent = 'Buang';

        row.appendChild(nama);
        row.appendChild(sel);
        row.appendChild(buang);
        frag.appendChild(row);
      });

      el.failSenarai.appendChild(frag);

      el.fileHint.className = 'hint';
      el.fileHint.textContent = senarai.length + ' fail · ' + bilRekod +
        ' folder rekod akan disimpan (fail yang sama mata pelajaran masuk ke ' +
        'folder yang sama).' +
        (senarai.length < MAX_FAIL_HANTAR ? ' Boleh tambah lagi.' : '');
      return;
    }
  }

  el.fileHint.className = 'hint';
  el.fileHint.textContent = 'Pilih SATU ATAU LEBIH fail RPH daripada komputer atau ' +
                            'telefon anda - setiap fail boleh diberi mata pelajaran ' +
                            'sendiri.';
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
/* Kumpulkan baris fail mengikut mata pelajaran - SATU kumpulan = SATU rekod
   (week + subjek) yang akan ditulis. Susunan mengekalkan susunan guru memilih
   fail, jadi ringkasan tidak "melompat" selepas setiap perubahan.
   ⚠ Peraturan kunci yang SAMA ada di server (submitUntuk_): kalau kedua-duanya
   tidak sepadan, ringkasan akan menjanjikan bilangan rekod yang berbeza
   daripada yang sebenarnya disimpan. */
function kumpulanMengikutSubjek(senarai) {
  var kumpulan = [];
  var ikut = {};

  (senarai || []).forEach(function (r) {
    var k = kunciSubjek(r.subjek);
    if (!ikut[k]) {
      ikut[k] = { subjek: String(r.subjek == null ? '' : r.subjek).trim(), baris: [] };
      kumpulan.push(ikut[k]);
    }
    ikut[k].baris.push(r);
  });

  return kumpulan;
}

function renderSummary() {
  var senarai = state.failSenarai;
  var kumpulan = kumpulanMengikutSubjek(senarai);

  var rows = [
    ['Minggu', weekLabel(state.targetWeek)],
    ['Guru', guruRingkasan()]
  ];

  if (!senarai.length) {
    rows.push(['Fail RPH', '<span class="muted">Belum dipilih</span>']);
  } else {
    /* Satu baris bagi setiap REKOD yang akan disimpan, bukan satu baris bagi
       setiap fail: itulah yang perlu difahami guru sebelum dia menekan Hantar -
       "tiga fail ini menjadi dua rekod". */
    kumpulan.forEach(function (k) {
      var kunci = k.subjek
        ? escapeHtml(k.subjek)
        : '<span class="muted">Belum diisi</span>';
      rows.push([kunci, k.baris.length + ' fail']);
    });

    if (kumpulan.length > 1) {
      rows.push(['Jumlah', senarai.length + ' fail · ' + kumpulan.length + ' rekod']);
    }
  }

  var html = rows.map(function (r) {
    return '<div class="row"><span class="k">' + r[0] + '</span>' +
           '<span class="v">' + r[1] + '</span></div>';
  }).join('');

  el.summary.className = 'summary';
  el.summary.innerHTML = html;

  /* Sedia = ada sekurang-kurangnya satu fail DAN setiap baris mempunyai mata
     pelajaran DAN minggu itu sah. Semakan subjek per baris ada di sini supaya
     butang Hantar tidak pernah menghantar senarai yang separuh kosong. */
  var lengkap = senarai.length > 0 && senarai.every(function (r) {
    return !!String(r.subjek || '').trim();
  });

  var ready = lengkap &&
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

/* Ringkasan nama untuk mesej ralat. Senarai lapan nama fail akan menolak baris
   mesej keluar dari skrin telefon, jadi ia dipotong dan bakinya dikira. */
function senaraiNamaFail(baris, had) {
  var nama = baris.map(function (b) { return b.fail.name; });
  if (nama.length <= had) return nama.join(', ');
  return nama.slice(0, had).join(', ') + ' +' + (nama.length - had) + ' lagi';
}

function onSubmit(ev) {
  ev.preventDefault();
  if (state.sending) return;

  var baris = state.failSenarai.slice();

  if (!baris.length) {
    setMsg('Sila pilih fail RPH.', 'bad');
    if (el.file) el.file.focus();
    return;
  }

  /* Setiap baris mesti mempunyai mata pelajaran. Disemak sebelum satu bait pun
     dimuat naik - bukan selepas muat naik yang berjaya dan penulisan yang
     ditolak (fail sudah berada dalam Drive tanpa rekod). */
  var tiadaSubjek = baris.filter(function (r) {
    return !String(r.subjek || '').trim();
  });

  if (tiadaSubjek.length) {
    setMsg('Sila pilih mata pelajaran untuk ' +
           (tiadaSubjek.length === 1
             ? 'fail "' + tiadaSubjek[0].fail.name + '"'
             : tiadaSubjek.length + ' fail') + '.', 'bad');
    return;
  }

  /* Had SATU REKOD disemak di sini juga (pelayan menyemak semula - ini untuk
     menjimatkan muat naik yang pasti ditolak). */
  var lebih = kumpulanMengikutSubjek(baris).filter(function (k) {
    return k.baris.length > MAX_FAIL_REKOD;
  });

  if (lebih.length) {
    setMsg('Satu rekod hanya boleh menyimpan ' + MAX_FAIL_REKOD + ' fail: "' +
           lebih[0].subjek + '" mempunyai ' + lebih[0].baris.length +
           '. Hantar dalam dua kelompok, atau padam rekod itu di halaman Laporan ' +
           'terlebih dahulu.', 'bad');
    return;
  }

  state.sending = true;
  el.btnSubmit.disabled = true;
  el.btnSubmit.textContent = 'Memuat naik 1/' + baris.length + '…';
  setMsg('Sedang memuat naik ' + baris.length + ' fail…', 'wait');

  hantarSenarai(baris, 0, [], []);
}

/* Hantar SATU fail bagi setiap panggilan, BERURUTAN dari indeks i.
   Berurutan dengan sengaja: muat naik serentak akan menghantar beberapa
   permintaan besar sekali gus dari telefon, dan `state.sending` hanya menjaga
   satu tekan butang - bukan sepuluh muat naik yang berlumba.
   `berjaya` dan `gagal` diisi oleh pemanggil supaya ringkasan akhir boleh
   dilaporkan per fail. */
function hantarSenarai(baris, i, berjaya, gagal) {
  if (i >= baris.length) { selesaiHantar(berjaya, gagal); return; }

  var r = baris[i];
  var teks = 'Memuat naik ' + (i + 1) + '/' + baris.length + '…';
  el.btnSubmit.textContent = teks;
  setMsg(teks + ' ' + r.fail.name, 'wait');

  /* Fail dibaca dahulu. Kalau bacaan gagal, fail itu dilaporkan sebagai gagal
     dan yang lain diteruskan - borang kekal utuh. */
  bacaFailBase64(r.fail)
    .then(function (b64) {
      var payload = {
        /* 'teacher' sengaja TIADA di sini: server menetapkan nama dan email
           daripada akaun yang log masuk. */
        action: 'submit',
        week: state.targetWeek,
        subject: String(r.subjek).trim(),
        url: '',                 /* v49: fail sentiasa menjadi sumber pautan */
        tahun: CONFIG.TAHUN,
        file: {
          name: r.fail.name,
          mimeType: r.fail.type || 'application/octet-stream',
          dataBase64: b64
        }
      };

      /* v42: dalam mod pentadbir, penghantaran pergi ke apiPentadbirHantar dan
         membawa `sebagai` - email guru sasaran. `action` di atas tidak mengawal
         apa-apa di server (setiap laluan menetapkan tindakannya sendiri); ia
         dikekalkan kerana pelanggan lama menghantarnya.

         Baris yang ditulis membawa identiti GURU itu, bukan pentadbir: kalau
         tidak, rekod itu tidak akan muncul dalam laporannya sendiri. Tindakan
         pentadbir dicatat berasingan dalam tab LogAdmin. */
      if (state.adminOn && state.adminGuru) {
        payload.sebagai = state.adminGuru.email;
        return withTimeout(serverCall('apiPentadbirHantar', [payload]),
                           UPLOAD_SERVER_MS, UPLOAD_SERVER_MSG);
      }
      return withTimeout(serverCall('apiSubmit', [payload]),
                         UPLOAD_SERVER_MS, UPLOAD_SERVER_MSG);
    })
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal menghantar');
      berjaya.push({ baris: r, res: res });
    })
    .catch(function (err) {
      gagal.push({ baris: r, ralat: (err && err.message) ? err.message : String(err) });
    })
    .then(function () { hantarSenarai(baris, i + 1, berjaya, gagal); });
}

/* Semua fail sudah dicuba. Ini SATU-SATUNYA tempat state.sending dipulihkan -
   setiap jalan (berjaya, gagal separa, gagal penuh) melaluinya, jadi butang
   tidak boleh tersangkut pada "Memuat naik…" selepas ralat. */
function selesaiHantar(berjaya, gagal) {
  state.sending = false;
  el.btnSubmit.textContent = 'HANTAR RPH';

  /* Baris yang BERJAYA dibuang dari senarai; yang GAGAL KEKAL - guru menekan
     HANTAR RPH sekali lagi untuk mencuba yang gagal sahaja. Nama dan subjek
     yang sudah dipilihnya tidak hilang, dan itu penting: memilih semula lapan
     fail pada telefon ialah kerja yang tidak sepatutnya diulang kerana satu
     muat naik gagal. */
  var idGagal = {};
  gagal.forEach(function (g) { idGagal[g.baris.id] = true; });
  state.failSenarai = state.failSenarai.filter(function (r) { return idGagal[r.id]; });
  if (el.file) el.file.value = '';

  renderFail();
  renderSummary();

  /* Rekod minggu ini berubah (fail baharu ditambah), jadi kad "sudah hantar"
     dan peta minggu dimuatkan semula dari pelayan - bukan dikira di pelanggan. */
  refreshMe();

  if (gagal.length) {
    /* Kegagalan SEPARA: sebahagian fail sudah selamat dalam Drive dan menjadi
       rekod. Guru mesti diberitahu DUA perkara - apa yang berjaya, dan apa yang
       tinggal. */
    var mesej = [];
    if (berjaya.length) mesej.push(berjaya.length + ' fail berjaya dihantar');
    mesej.push(gagal.length + ' gagal: ' + senaraiNamaFail(gagal.map(function (g) {
      return { fail: g.baris.fail };
    }), 3));
    mesej.push('tekan HANTAR RPH untuk cuba semula yang gagal');
    setMsg(mesej.join(' · '), 'bad');
    return;
  }

  /* Semua berjaya. */
  var urlSimpan = berjaya.length ? (berjaya[0].res.url || '') : '';
  var bilRekod = kumpulanMengikutSubjek(berjaya.map(function (b) { return b.baris; })).length;
  var bilDitambah = berjaya.filter(function (b) {
    return b.res.mode === 'appended';
  }).length;
  var bilNamaSama = berjaya.filter(function (b) { return b.res.namaSama === true; }).length;
  var bilPindah = berjaya.reduce(function (n, b) {
    return n + Number(b.res.dipindah || 0);
  }, 0);
  var bilMingguLain = berjaya.reduce(function (n, b) {
    return n + Number(b.res.urlElsewhere || 0);
  }, 0);

  state.record = {
    week: state.targetWeek,
    url: urlSimpan,
    subject: String(berjaya[0].baris.subjek).trim()
  };

  var detail = weekLabel(state.targetWeek) + ' · ' + berjaya.length + ' fail · ' +
               bilRekod + ' folder rekod';
  /* v41: guru mesti NAMPAK kerjanya bertambah, bukan ditimpa - jadi apabila
     minggu itu kini menyimpan lebih banyak rekod daripada yang baru dihantar,
     jumlahnya disebut. (Teks ini yang diuji sejak v41.) */
  var rekodMingguKini = berjaya.reduce(function (n, b) {
    return Math.max(n, Number(b.res.rekodMinggu || 0));
  }, 0);
  if (rekodMingguKini > bilRekod) {
    detail += ' · minggu ini kini ada ' + rekodMingguKini + ' rekod';
  }
  /* Satu mata pelajaran sahaja: sebut namanya. Guru yang menghantar RPH Sejarah
     mesti membaca "Sejarah" pada skrin itu - dengan beberapa mata pelajaran,
     senarai nama akan menolak baris lain keluar dari skrin telefon. */
  if (kumpulanMengikutSubjek(berjaya.map(function (b) { return b.baris; })).length === 1) {
    detail += ' · ' + String(berjaya[0].baris.subjek).trim();
  }
  if (bilDitambah) {
    detail += ' · ' + bilDitambah + ' fail ditambah ke dalam folder rekod yang sudah ada';
  }
  if (bilPindah) {
    detail += ' · fail RPH yang lama dipindahkan ke dalam folder itu juga';
  }
  if (bilNamaSama) {
    detail += ' · Perhatian: ' + bilNamaSama + ' fail mempunyai nama yang sama ' +
              'dengan fail yang sudah ada dalam folder itu. Kalau ini tersalah ' +
              'tekan, padam rekod itu di halaman Laporan.';
  }
  if (bilMingguLain) {
    detail += ' · Perhatian: pautan yang sama juga ada pada ' + bilMingguLain +
              ' rekod minggu lain. Sila semak jika tersalah.';
  }

  el.doneDetail.textContent = detail;
  el.doneLink.href = urlSimpan || '#';

  resetFile();
  show('done');
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
  syncSubjekFail();
  renderSummary();
});

el.subjectLain.addEventListener('input', function () {
  /* Kotak "Lain-lain" ditaip huruf demi huruf: setiap ketikan mengemas kini
     baris fail yang masih mengikut medan utama, supaya peraturan "medan utama
     ialah subjek lalai" juga benar untuk subjek yang ditaip sendiri. */
  syncSubjekFail();
  renderSummary();
});

/* Hanya baris yang MASIH KOSONG mengikut medan utama.
   Baris yang sudah mempunyai subjek TIDAK PERNAH diubah oleh medan itu, dan
   sebabnya ialah aliran biasa v49: guru memilih dua fail BM, kemudian menukar
   medan utama kepada Sejarah untuk menambah fail Sejarah. Kalau baris yang
   sudah selesai ikut medan utama, dua fail BM itu bertukar menjadi Sejarah -
   penghantaran yang SALAH, bukan sekadar paparan yang salah, dan guru tidak
   akan perasan sehingga pentadbir membukanya.

   Guru yang hendak membetulkan subjek sesuatu baris menukarnya pada baris itu
   sendiri (setiap baris ada pemilihnya), atau membuang baris itu dan memilih
   fail semula. */
function syncSubjekFail() {
  var v = subjectValue();
  var berubah = false;

  state.failSenarai.forEach(function (r) {
    if (!String(r.subjek || '').trim() && r.subjek !== v) { r.subjek = v; berubah = true; }
  });

  if (berubah) renderFail();
}

el.file.addEventListener('change', function () {
  /* v49: `multiple` - satu pemilihan boleh membawa beberapa fail. Setiap satu
     menjadi barisnya sendiri di bawah. */
  pilihFailSenarai(this.files);
});

/* Baris fail: SATU pendengar pada bekasnya, bukan satu pada setiap baris.
   Baris dibina semula pada setiap perubahan, jadi pendengar per baris akan
   menimbun seperti yang pernah berlaku pada chip minggu (v30). Delegasi juga
   bermakna `Buang` berfungsi pada baris yang baru dilukis tanpa pendaftaran
   semula. */
el.failSenarai.addEventListener('click', function (ev) {
  var btn = ev.target && ev.target.closest ? ev.target.closest('.fail-buang') : null;
  if (!btn) return;
  buangFail(btn.dataset.buang);
});

el.failSenarai.addEventListener('change', function (ev) {
  var sel = ev.target;
  if (!sel || !sel.classList || !sel.classList.contains('fail-subjek')) return;

  var row = sel.closest ? sel.closest('.fail-row') : null;
  if (!row) return;

  var id = row.dataset.id;
  var r = state.failSenarai.filter(function (x) { return x.id === id; })[0];
  if (!r) return;

  /* Setiap baris menyimpan pilihannya sendiri. Menukar baris kembali kepada
     subjek medan utama tidak "mengikat" semula baris itu kepada medan utama -
     ikatan itu hanya wujud selagi barisnya KOSONG (lihat syncSubjekFail()). */
  r.subjek = sel.value;

  renderFail();
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
   11d. LAPOR MASALAH — DIBUANG (v46)
   ------------------------------------------------------------
   v42 menambah butang "Lapor masalah" di footer dan satu panel aduan
   (versi halaman + halaman mana + minggu + mesej + user agent) yang menulis ke
   tab LaporanMasalah. v46 membuangnya atas permintaan pengguna:
   *"去掉lapor masalah"*.

   Dua sebab pembuangannya PENUH (markup, panel, app.js, CSS, peta shim,
   laluan doPost, endpoint apiLaporMasalah, dan dua CONFIG di server), bukan
   sekadar butangnya:

     1. ia tidak pernah menulis satu baris pun. Endpoint itu memanggil
        assertAllowed_() - semakan SESI GOOGLE - pada halaman Pages yang memang
        tiada sesi Google (bug v45), jadi setiap aduan ditolak [E1]. Tab
        LaporanMasalah tidak pernah wujud dalam buku kerja.
     2. separuh pembuangan meninggalkan kod mati yang muncul semula kemudian -
        pelajaran yang sama seperti butang Log keluar v43/v44.

   Jejak sejarahnya ada dalam eRPH.md (§v42, §v45, §v46). */

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
