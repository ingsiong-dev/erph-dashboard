/* ============================================================
   e-RPH · SMK Meradong  —  HALAMAN 2: Laporan e-RPH
   ------------------------------------------------------------
   Susun atur dan maksud dua kad skor adalah SAMA seperti laporan
   Looker Studio yang digantikan:

     Bilangan minggu telah dihantar        = minggu unik guru itu
     Jumlah Minggu Persekolahan Tahun 2026 = 47 (tetap)

   HALAMAN INI HANYA MEMAPARKAN LAPORAN GURU YANG LOG MASUK.
   Tiada senarai guru dan tiada kotak pilihan: nama guru dipaparkan sebagai
   teks, dan laporan diambil untuk identiti sesi sahaja. Penguncian sebenar
   ada di PELAYAN (apiLaporanGuru mengabaikan email yang dihantar), bukan di
   sini - kalau hanya di sini, sesiapa boleh memanggil fungsi itu dari konsol
   pelayar dan membaca laporan rakan sekerja.

   Data diambil melalui Apps Script (google.script.run), BUKAN terus daripada
   Google Sheet - akses gviz tanpa nama hanya memulangkan sebahagian kecil
   baris.

   Memerlukan CONFIG, state, refreshMe(), serverCall(), escapeHtml(),
   isHoliday() dan weekLabel() daripada app.js, jadi app.js mesti dimuatkan
   dahulu.
   ============================================================ */
'use strict';

var LAP = {
  loaded: false,
  loading: false,
  tahun: null,
  totalWeeks: null,
  /* Email guru yang log masuk - satu-satunya laporan yang boleh dilihat. */
  email: null,
  /* Pemadaman pada halaman ini: guru hanya boleh memadam rekod MILIKNYA.
     Server tetap menolak percubaan memadam rekod orang lain (delete_ membaca
     identiti daripada sesi, bukan daripada permintaan). */
  armedWeek: null,
  deleting: false,
  delBtns: {},
  flash: null
};

function lapEl(id) { return document.getElementById(id); }

/* Ikon tong sampah sebagai SVG SEBARIS, bukan emoji 🗑.
   Sebab: emoji bergantung pada fon sistem. Pada mesin yang tiada fon emoji ia
   muncul sebagai kotak kosong atau sengkang nipis - butang paling penting di
   halaman ini tidak boleh bergantung pada itu. SVG memakai currentColor, jadi
   ia bertukar putih sendiri apabila butang menjadi merah (.lap-del.armed). */
var LAP_TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M4 7h16M9.5 4h5M6.5 7l.9 12.1a1.6 1.6 0 0 0 1.6 1.5h6a1.6 ' +
  '1.6 0 0 0 1.6-1.5L17.5 7M10.2 11v6M13.8 11v6"/></svg>';

/* Ikon "fail RPH" - dokumen dengan penjuru berlipat. Sama sebabnya dengan tong
   sampah di atas: SVG sebaris, bukan emoji, kerana emoji bergantung pada fon
   sistem. currentColor supaya ia mengikut warna .lap-fail. */
var LAP_FILE_SVG =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 ' +
  '2-2V8.5zM13.5 3v5.5H19"/></svg>';

/* ------------------------------------------------------------
   Penukar halaman
   ------------------------------------------------------------ */

function switchPage(which) {
  var keHantar = (which === 'hantar');

  lapEl('tab-hantar').classList.toggle('on', keHantar);
  lapEl('tab-laporan').classList.toggle('on', !keHantar);
  lapEl('page-hantar').classList.toggle('hidden', !keHantar);
  lapEl('page-laporan').classList.toggle('hidden', keHantar);

  var tajuk = lapEl('hero-title');
  if (tajuk) {
    tajuk.textContent = keHantar
      ? 'Penghantaran Rancangan Pengajaran Harian'
      : 'Laporan Pemantauan Rancangan Pengajaran Harian';
  }

  window.scrollTo(0, 0);

  /* Muat malas: hanya ambil data apabila halaman ini dibuka kali pertama. */
  if (!keHantar && !LAP.loaded && !LAP.loading) lapLoad();
}

function lapShow(which) {
  ['load', 'error', 'body'].forEach(function (k) {
    lapEl('lap-' + k).classList.toggle('hidden', k !== which);
  });
}

/* ------------------------------------------------------------
   Tetapan halaman
   ------------------------------------------------------------
   Tiada lagi muatan senarai guru. Halaman ini hanya memaparkan laporan GURU
   YANG LOG MASUK, jadi:
     - nama guru datang daripada bootstrap (state.teacher), bukan senarai;
     - jumlah minggu datang daripada CONFIG, bukan pelayan;
     - apiLaporan (senarai seluruh sekolah) TIDAK dipanggil langsung.
   Selain lebih peribadi, ini membuang satu bacaan penuh buku kerja bagi setiap
   lawatan halaman - dan kuota Sheets dikongsi oleh seluruh sekolah.
   ------------------------------------------------------------ */

function lapLoad(tahun) {
  if (LAP.loading) return;

  LAP.tahun = String(tahun || LAP.tahun || CONFIG.TAHUN);
  LAP.totalWeeks = CONFIG.TOTAL_WEEKS;
  LAP.loaded = true;
  LAP.loading = false;

  lapRenderControls();
  lapShow('body');
  lapLoadGuru();
}

function lapRenderControls() {
  var setahun = lapEl('lap-tahun');
  setahun.innerHTML = '';
  var opt = document.createElement('option');
  opt.value = LAP.tahun;
  opt.textContent = LAP.tahun;
  setahun.appendChild(opt);

  lapEl('lap-tahun-lbl').textContent = LAP.tahun;
  lapEl('lap-jumlah').textContent = LAP.totalWeeks;

  /* Nama guru: teks biasa, tiada kotak pilihan. */
  lapRenderNama();
}

/* Nama dalam kotak CIKGU. Diasingkan kerana ia juga perlu disegarkan oleh
   gelung cubaan semula dalam lapLoadGuru() - identiti tiba secara tak segerak. */
function lapRenderNama() {
  var nama = lapEl('lap-guru-nama');
  if (nama) nama.textContent = (state && state.teacher) || '—';
}

/* ------------------------------------------------------------
   Butiran guru yang log masuk
   ------------------------------------------------------------ */

function lapLoadGuru(cubaan) {
  lapHint('');
  lapResetDelete();

  /* Identiti daripada sesi, bukan daripada parameter. apiLaporanGuru() di
     pelayan juga mengabaikan email yang dihantar dan mengunci kepada
     pemanggil - jadi menyembunyikan laporan orang lain di sini BUKAN satu-
     satunya kawalan. */
  var email = String((state && state.email) || '');

  /* boot() mengambil identiti secara SERENTAK dengan halaman ini. Kalau guru
     menekan tab Laporan sebelum ia selesai, tunggu sebentar daripada terus
     memaparkan ralat - guru tidak sepatutnya perlu memuat semula halaman
     hanya kerana dia menekan tabs terlalu pantas. 20 x 150ms = 3 saat. */
  if (!email) {
    var n = cubaan || 0;
    lapRenderNama();
    if (n < 20) {
      lapEl('lap-dihantar').textContent = '—';
      lapEl('lap-rows').innerHTML =
        '<tr><td colspan="5" class="lap-empty">Loading…</td></tr>';
      lapEl('lap-note').textContent = '';
      setTimeout(function () { lapLoadGuru(n + 1); }, 150);
      return;
    }
    lapEl('lap-dihantar').textContent = '0';
    lapEl('lap-rows').innerHTML =
      '<tr><td colspan="5" class="lap-empty">Akaun anda tidak dapat dikenal pasti. ' +
      'Muat semula halaman ini.</td></tr>';
    lapEl('lap-note').textContent = '';
    return;
  }

  LAP.email = email;
  /* Identiti kini diketahui, jadi isi kotak CIKGU. Ini MESTI berlaku di sini:
     kalau guru menekan tab terlalu awal, gelung cubaan semula di atas berjalan
     semasa state.teacher masih kosong - tanpa baris ini kotak itu kekal "—"
     walaupun laporan sudah dimuatkan. */
  lapRenderNama();
  lapEl('lap-dihantar').textContent = '—';
  lapEl('lap-rows').innerHTML =
    '<tr><td colspan="5" class="lap-empty">Loading…</td></tr>';
  lapEl('lap-note').textContent = '';

  /* `email` dihantar hanya kerana ia slot pertama tandatangan pelayan; pelayan
     MENGABAIKANNYA dan memakai identiti sesi. Menghantarnya tidak memberi
     sebarang kuasa - lihat apiLaporanGuru() dalam Code.gs. */
  withTimeout(serverCall('apiLaporanGuru', [email, LAP.tahun]), SLOW_SERVER_MS,
              SLOW_SERVER_MSG)
    .then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || 'Respons tidak sah');
      lapRenderGuru(data);
    })
    .catch(function (err) {
      lapEl('lap-dihantar').textContent = '—';
      lapEl('lap-rows').innerHTML =
        '<tr><td colspan="5" class="lap-empty">Gagal loading: ' +
        escapeHtml(err.message) + '</td></tr>';
    });
}

function lapRenderGuru(data) {
  var rows = data.rows || [];
  lapEl('lap-dihantar').textContent = data.jumlah;
  lapResetDelete();

  /* Adakah laporan yang sedang dipaparkan ini milik guru yang log masuk?
     Hanya kalau ya barulah tong sampah ditawarkan. */
  var sendiri = !!state.email && String(data.email || '').toLowerCase() ===
                String(state.email).toLowerCase();

  var body = lapEl('lap-rows');
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="5" class="lap-empty">Tiada penghantaran direkodkan.</td></tr>';
  } else {
    var frag = document.createDocumentFragment();

    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      /* Minggu cuti ditandakan dengan warna, tetapi tetap dikira sebagai
         "telah dihantar" - sama seperti laporan asal. */
      if (isHoliday(r.minggu)) tr.className = 'cuti';

      var tdMinggu = document.createElement('td');
      tdMinggu.className = 'num';
      tdMinggu.textContent = r.minggu;
      if (isHoliday(r.minggu)) tdMinggu.title = weekLabel(r.minggu) + ' — cuti';

      var tdSubjek = document.createElement('td');
      tdSubjek.textContent = r.subjek || '';

      var tdPautan = document.createElement('td');
      tdPautan.className = 'lap-fail-cell';
      if (r.url) {
        var a = document.createElement('a');
        a.className = 'lap-fail';
        a.href = r.url;
        a.target = '_blank';
        a.rel = 'noopener';
        /* Ikon, BUKAN teks URL. URL Drive ~74 aksara membalut tiga baris dan
           melebarkan lajur ini sehingga jadual sukar dibaca; tiada guru perlu
           membaca id fail itu - mereka hanya perlu menekannya. Teks penuh masih
           ada dalam title dan aria-label, jadi maklumat tidak hilang. */
        a.innerHTML = LAP_FILE_SVG;
        a.title = 'Buka fail RPH ' + weekLabel(r.minggu);
        a.setAttribute('aria-label', 'Buka fail RPH ' + weekLabel(r.minggu));
        tdPautan.appendChild(a);
      } else {
        /* Sama seperti lajur padam: sengkang, bukan sel kosong - sel kosong
           kelihatan seperti paparan yang rosak. */
        var tiadaFail = document.createElement('span');
        tiadaFail.className = 'lap-del-none';
        tiadaFail.textContent = '—';
        tiadaFail.title = 'Tiada fail dimuat naik untuk minggu ini.';
        tdPautan.appendChild(tiadaFail);
      }

      var tdSemakan = document.createElement('td');
      var pill = document.createElement('span');
      var status = String(r.semakan || '').trim();
      var rendah = status.toLowerCase();
      pill.className = 'pill ' +
        (rendah === 'disemak' ? 'disemak' : (rendah ? 'belum' : 'kosong'));
      pill.textContent = status || '—';
      tdSemakan.appendChild(pill);

      tr.appendChild(tdMinggu);
      tr.appendChild(tdSubjek);
      tr.appendChild(tdPautan);
      tr.appendChild(tdSemakan);
      tr.appendChild(lapDeleteCell(r.minggu, sendiri));
      frag.appendChild(tr);
    });

    body.appendChild(frag);
  }

  /* Nota: jangan sembunyikan baris yang nombor minggunya tidak dapat
     ditentukan - nyatakan bilangannya supaya tidak hilang senyap. */
  var nota = rows.length + ' minggu direkodkan daripada ' + LAP.totalWeeks +
             ' minggu persekolahan';
  var jelas = Number(data.tidakJelas) || 0;
  if (jelas) {
    nota += ' · ' + jelas + ' baris mempunyai nombor minggu yang tidak dapat ' +
            'ditentukan (cth. "20 & 21") dan tidak dikira';
  }
  lapEl('lap-note').textContent = nota;

  /* Mesej pemadaman dipaparkan SELEPAS jadual dilukis semula, kerana melukis
     semula mengosongkan petunjuk. Satu kali sahaja. */
  if (LAP.flash) {
    lapHint(LAP.flash.text, LAP.flash.kind);
    LAP.flash = null;
  }
}

/* ------------------------------------------------------------
   Padam rekod sendiri, dari Laporan e-RPH
   ------------------------------------------------------------
   Reka bentuk yang dipilih pengguna: TIADA kemas kini di sini - kalau ada
   silap atau tersalah muat naik dua kali, guru padam sahaja dan muat naik
   semula. delete_ membuang SEMUA baris guru itu untuk minggu berkenaan, jadi
   satu klik menghabiskan pertindihan sekali gus.
   ------------------------------------------------------------ */

function lapHint(text, kind) {
  var n = lapEl('lap-del-hint');
  n.textContent = text || '';
  n.className = 'hint center' + (kind ? ' ' + kind : '') + (text ? '' : ' hidden');
}

function lapResetDelete() {
  LAP.armedWeek = null;
  LAP.delBtns = {};
}

/* Klik pertama menukar butang kepada teks ini. Ikon tong sampah yang bertukar
   merah sahaja TIDAK mencukupi: penjelasannya berada di bawah jadual, dan pada
   laporan 36 baris ia jauh di luar skrin - jadi guru menekan, melihat merah,
   tidak nampak apa-apa berlaku, dan menyangka butang itu rosak. Butang itu
   sendiri mesti menyatakan apa yang dijangka daripada klik seterusnya. */
var LAP_DEL_CONFIRM = 'Padam?';

function lapArm(minggu, on) {
  var btn = LAP.delBtns[minggu];
  if (!btn) return;

  btn.classList.toggle('armed', !!on);
  btn.innerHTML = on ? LAP_DEL_CONFIRM : LAP_TRASH_SVG;
  btn.setAttribute('title', on ? 'Klik sekali lagi untuk padam rekod minggu ini'
                               : 'Padam rekod minggu ini');
}

function lapDisableAll(yes) {
  Object.keys(LAP.delBtns).forEach(function (w) {
    LAP.delBtns[w].disabled = !!yes;
  });
}

/* Satu sel: tong sampah untuk rekod sendiri, sengkang untuk rekod orang lain. */
function lapDeleteCell(minggu, sendiri) {
  var td = document.createElement('td');
  td.className = 'lap-padam';

  if (!sendiri) {
    var kosong = document.createElement('span');
    kosong.className = 'lap-del-none';
    kosong.textContent = '—';
    kosong.title = 'Hanya guru sendiri boleh memadam rekodnya.';
    td.appendChild(kosong);
    return td;
  }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lap-del';
  btn.innerHTML = LAP_TRASH_SVG;
  btn.dataset.minggu = String(minggu);
  btn.title = 'Padam rekod ' + weekLabel(minggu) +
              ' — anda boleh muat naik semula selepas ini';
  btn.setAttribute('aria-label', 'Padam rekod ' + weekLabel(minggu));
  btn.addEventListener('click', function () { lapDeleteClick(minggu); });

  td.appendChild(btn);
  LAP.delBtns[minggu] = btn;
  return td;
}

/* Pengesahan dua langkah. Sengaja TIDAK menggunakan confirm(): dialog menyekat
   pemaparan dan itu pernah melumpuhkan portal ini. */
function lapDeleteClick(minggu) {
  if (LAP.deleting) return;

  if (LAP.armedWeek !== minggu) {
    lapArm(LAP.armedWeek, false);
    LAP.armedWeek = minggu;
    lapArm(minggu, true);
    /* Butang itu sendiri sudah berkata "Padam?". Nota ini menerangkan AKIBAT,
       bukan mekanisme - dan ia kekal di bawah jadual, jadi ia hanya berfungsi
       sebagai nota kaki, bukan arahan. */
    lapHint('Rekod ' + weekLabel(minggu) + ' akan dipadam. Salinan penuh ' +
            'disimpan dalam tab ResponsesDibuang dan failnya boleh dipulihkan ' +
            'oleh pentadbir, jadi anda boleh muat naik semula selepas ini.', 'bad');
    return;
  }

  lapDoDelete(minggu);
}

function lapDoDelete(minggu) {
  LAP.deleting = true;
  LAP.armedWeek = null;
  lapArm(minggu, false);
  lapDisableAll(true);
  lapHint('Memadam ' + weekLabel(minggu) + '…');

  withTimeout(serverCall('apiDelete', [minggu, LAP.tahun]), SLOW_SERVER_MS,
              SLOW_SERVER_MSG)
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal memadam');

      LAP.flash = {
        text: 'Rekod ' + weekLabel(minggu) + ' telah dipadam. ' +
              'Anda boleh muat naik semula di halaman Hantar.',
        kind: 'good'
      };

      /* Halaman Hantar mesti berhenti menyangka minggu ini sudah dihantar -
         jika tidak, guru akan nampak "sudah hantar" untuk rekod yang baru
         dipadamnya. Laporan ini sentiasa milik pemanggil, jadi ini sentiasa
         relevan. */
      refreshMe();

      lapLoadGuru();
    })
    .catch(function (err) {
      lapHint('Gagal memadam: ' + err.message, 'bad');
    })
    .then(function () {
      LAP.deleting = false;
      lapDisableAll(false);
    });
}

/* ------------------------------------------------------------
   Peristiwa
   ------------------------------------------------------------ */

lapEl('tab-hantar').addEventListener('click', function () { switchPage('hantar'); });
lapEl('tab-laporan').addEventListener('click', function () { switchPage('laporan'); });
lapEl('lap-retry').addEventListener('click', function () { lapLoad(); });

lapEl('lap-tahun').addEventListener('change', function () {
  LAP.loaded = false;
  lapLoad(this.value);
});
