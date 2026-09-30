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
     identiti daripada sesi, bukan daripada permintaan).

     v41: `armedKey` (bukan `armedWeek`) - satu klik mengarm satu BARIS rekod,
     iaitu satu (minggu, subjek). Lihat lapKunci(). */
  armedKey: null,
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
  lapRenderDiag(null);

  /* `email` dihantar hanya kerana ia slot pertama tandatangan pelayan; pelayan
     MENGABAIKANNYA dan memakai identiti sesi. Menghantarnya tidak memberi
     sebarang kuasa - lihat apiLaporanGuru() dalam Code.gs.

     v42: DALAM MOD PENTADBIR sahaja, panggilan bertukar kepada
     apiPentadbirLaporan(email, tahun) - fungsi yang MEMANG menerima email lain,
     tetapi hanya selepas server mengesahkan pemanggil berada dalam
     CONFIG.PENTADBIR_EMAILS. Jadi cawangan ini tidak memberi guru biasa apa-apa:
     dia akan menerima "Akses ditolak: mod pentadbir ...". */
  var admin = (typeof state !== 'undefined' && state.adminOn && state.adminGuru)
    ? state.adminGuru : null;

  var panggil = admin
    ? serverCall('apiPentadbirLaporan', [admin.email, LAP.tahun])
    : serverCall('apiLaporanGuru', [email, LAP.tahun]);

  withTimeout(panggil, SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || 'Respons tidak sah');
      lapRenderGuru(data, !!admin);
    })
    .catch(function (err) {
      lapEl('lap-dihantar').textContent = '—';
      lapEl('lap-rows').innerHTML =
        '<tr><td colspan="5" class="lap-empty">Gagal loading: ' +
        escapeHtml(err.message) + '</td></tr>';
      lapRenderDiag(null);
    });
}

function lapRenderGuru(data, modAdmin) {
  var rows = data.rows || [];
  lapEl('lap-dihantar').textContent = data.jumlah;
  lapResetDelete();

  /* Adakah laporan yang sedang dipaparkan ini milik guru yang log masuk?
     Hanya kalau ya barulah tong sampah ditawarkan.

     v42: dalam mod pentadbir, laporan itu MILIK ORANG LAIN dengan sengaja -
     pentadbir masuk untuk membetulkan rekod yang tersekat, jadi tong sampah
     mesti ditawarkan. Ini BUKAN pelonggaran kawalan: apiPentadbirPadam memeriksa
     semula email pemanggil di server, dan guru biasa tetap ditolak. */
  var sendiri = !!modAdmin || (!!state.email && String(data.email || '').toLowerCase() ===
                String(state.email).toLowerCase());

  /* Nama pada kotak CIKGU: dalam mod pentadbir ia nama GURU SASARAN (data.nama
     datang daripada laporan itu sendiri), bukan nama pentadbir. */
  if (modAdmin && data.nama) {
    lapEl('lap-guru-nama').textContent = data.nama;
  }

  lapRenderDiag(modAdmin ? data.diagnostik : null);

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
      /* v41: sel padam menerima BARIS itu, bukan minggunya - satu minggu kini
         boleh mempunyai beberapa baris (satu bagi setiap mata pelajaran), dan
         setiap satu mesti boleh dipadam sendiri. */
      tr.appendChild(lapDeleteCell(r, sendiri));
      frag.appendChild(tr);
    });

    body.appendChild(frag);
  }

  /* Nota: jangan sembunyikan baris yang nombor minggunya tidak dapat
     ditentukan - nyatakan bilangannya supaya tidak hilang senyap.

     v41: dua nombor berbeza mesti disebut, dan kad skor di atas hanya memakai
     yang PERTAMA. `data.jumlah` = MINGGU unik (kad "Bilangan minggu telah
     dihantar" - satu minggu dikira sekali walau berapa kali dihantar);
     `rows.length` = bilangan BARIS rekod, iaitu satu bagi setiap mata pelajaran.
     Menulis "N minggu direkodkan" dengan N = bilangan baris akan bercanggah
     dengan kad skor tepat di atasnya. */
  var mingguUnik = Number(data.jumlah);
  if (!isFinite(mingguUnik)) mingguUnik = rows.length;
  var nota = mingguUnik + ' minggu direkodkan daripada ' + LAP.totalWeeks +
             ' minggu persekolahan' +
             ' · ' + rows.length + ' rekod mata pelajaran';
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
   Diagnostik pentadbir (v42)
   ------------------------------------------------------------
   Hanya diisi apabila pelayan menghantar `diagnostik`, iaitu daripada
   apiPentadbirLaporan sahaja. Ia menjawab soalan yang pentadbir sebenarnya
   datang untuk menjawab - "kenapa guru ini kata rekodnya hilang?" - dan setiap
   baris di bawah ialah satu sebab yang TIDAK kelihatan dari dalam app.
   ------------------------------------------------------------ */

function lapRenderDiag(d) {
  var card = lapEl('lap-diag');
  var body = lapEl('lap-diag-body');
  if (!card || !body) return;

  if (!d) {
    card.classList.add('hidden');
    body.innerHTML = '';
    return;
  }

  var baris = [];

  var tidakJelas = d.mingguTidakJelas || [];
  if (tidakJelas.length) {
    baris.push('<p class="bad"><strong>' + tidakJelas.length +
      ' baris minggu tidak dapat ditafsir</strong> — baris ini TIDAK dikira ' +
      'langsung, jadi minggu itu nampak "belum dihantar" walaupun guru sudah ' +
      'menghantarnya:</p><ul>' +
      tidakJelas.slice(0, 8).map(function (x) {
        return '<li>baris ' + x.baris + ': “' + escapeHtml(x.teks) + '”</li>';
      }).join('') + '</ul>');
  }

  var bertindih = d.bertindih || [];
  if (bertindih.length) {
    baris.push('<p><strong>' + bertindih.length +
      ' pasangan (minggu, subjek) bertindih</strong> — jadual menunjukkan yang ' +
      'TERBARU, sejarah penuh ada dalam sheet:</p><ul>' +
      bertindih.slice(0, 8).map(function (x) {
        return '<li>Minggu ' + x.minggu + ' · ' +
               escapeHtml(x.subjek || '(tiada subjek)') + ' × ' + x.bilangan + '</li>';
      }).join('') + '</ul>');
  }

  if (d.tiadaTahun) {
    baris.push('<p>' + d.tiadaTahun + ' baris tanpa Tahun (era borang Google) — ' +
               'masih dikira.</p>');
  }
  if (d.urlTiada) {
    baris.push('<p class="bad">' + d.urlTiada + ' baris TIADA pautan fail.</p>');
  }

  if (!baris.length) {
    baris.push('<p class="good">Tiada keanehan dikesan: setiap baris ada minggu ' +
               'yang jelas, ada pautan, dan tiada pasangan bertindih.</p>');
  }

  var sem = d.semakan || {};
  baris.push('<p class="muted small">Minggu tertinggi direkodkan: ' +
             (d.mingguMaks || '—') + ' · Semakan: ' + (sem.disemak || 0) +
             ' Disemak, ' + (sem.kosong || 0) + ' kosong, ' + (sem.lain || 0) + ' lain.</p>');

  body.innerHTML = baris.join('');
  card.classList.remove('hidden');
}

/* ------------------------------------------------------------
   Padam rekod sendiri, dari Laporan e-RPH
   ------------------------------------------------------------
   Reka bentuk yang dipilih pengguna: TIADA kemas kini di sini - kalau ada
   silap atau tersalah muat naik dua kali, guru padam sahaja dan muat naik
   semula.

   v41: tong sampah berdiri pada SATU BARIS jadual, iaitu satu (minggu, subjek).
   Sebelum v41 delete_ membuang SEMUA baris guru itu untuk minggu berkenaan -
   betul selagi satu minggu = satu baris, tetapi dengan lima mata pelajaran pada
   minggu yang sama satu klik memusnahkan empat rekod yang tidak diminta. Subjek
   baris itu kini dihantar bersama minggu, dan pelayan memadam hanya padanan itu.
   ------------------------------------------------------------ */

/* Kunci satu BARIS rekod dalam LAP.delBtns. Minggu sahaja tidak cukup: butang
   adalah satu bagi setiap baris, dan satu minggu boleh mempunyai beberapa
   baris. Subjek dilipat ke huruf kecil supaya "BM" dan "bm " - yang pelayan
   anggap mata pelajaran yang SAMA - tidak menjadi dua kunci berbeza. */
function lapKunci(minggu, subjek) {
  return String(minggu) + '|' + String(subjek == null ? '' : subjek).toLowerCase();
}

/* Label satu baris rekod untuk mesej: "Minggu 36 · BM", atau "Minggu 36" kalau
   baris itu tiada subjek. */
function lapLabel(minggu, subjek) {
  var s = String(subjek == null ? '' : subjek).trim();
  return weekLabel(minggu) + (s ? ' · ' + s : '');
}

function lapHint(text, kind) {
  var n = lapEl('lap-del-hint');
  n.textContent = text || '';
  n.className = 'hint center' + (kind ? ' ' + kind : '') + (text ? '' : ' hidden');
}

function lapResetDelete() {
  /* v41: `armedKey`, bukan `armedWeek` - butang yang "diarm" ialah satu BARIS
     rekod (minggu + subjek), kerana satu minggu boleh mempunyai beberapa baris. */
  LAP.armedKey = null;
  LAP.delBtns = {};
}

/* Klik pertama menukar butang kepada teks ini. Ikon tong sampah yang bertukar
   merah sahaja TIDAK mencukupi: penjelasannya berada di bawah jadual, dan pada
   laporan 36 baris ia jauh di luar skrin - jadi guru menekan, melihat merah,
   tidak nampak apa-apa berlaku, dan menyangka butang itu rosak. Butang itu
   sendiri mesti menyatakan apa yang dijangka daripada klik seterusnya. */
var LAP_DEL_CONFIRM = 'Padam?';

/* v36: keadaan KETIGA - sementara permintaan padam berjalan. Permintaan
   pengguna: "按了Padam？不要再显示那个垃圾桶了。变成Deleting...".
   Ikon tong sampah yang kembali serta-merta (walaupun butang sudah dilumpuhkan)
   kelihatan seperti "tidak jadi" - jadi guru menekan lagi. Teks ini kekal
   sehingga baris itu hilang, atau dipulihkan kepada ikon kalau padam GAGAL. */
var LAP_DEL_BUSY = 'Deleting…';

/* `kunci` = lapKunci(minggu, subjek), BUKAN minggu: butang yang diarm ialah satu
   BARIS rekod, dan satu minggu boleh mempunyai beberapa baris. Lihat lapKunci(). */
function lapArm(kunci, on) {
  var btn = LAP.delBtns[kunci];
  if (!btn) return;

  btn.classList.toggle('armed', !!on);
  /* Keluar dari keadaan "Deleting…" masuk kembali ke ikon atau ke "Padam?". */
  btn.classList.remove('busy');
  btn.innerHTML = on ? LAP_DEL_CONFIRM : LAP_TRASH_SVG;
  var label = btn.dataset && btn.dataset.label;
  btn.setAttribute('title', on
    ? (label ? 'Klik sekali lagi untuk padam ' + label
             : 'Klik sekali lagi untuk padam rekod ini')
    : (label ? 'Padam rekod ' + label : 'Padam rekod ini'));
}

/* Butang bertukar kepada teks "Deleting…" sebaik permintaan padam dihantar.
   TEKS, bukan tong sampah: guru yang menekan dan melihat ikon yang sama semula
   akan menekan lagi. */
function lapBusy(kunci) {
  var btn = LAP.delBtns[kunci];
  if (!btn) return;

  btn.classList.remove('armed');
  btn.classList.add('busy');
  /* innerHTML, sama seperti lapArm(): di situlah ikon tong sampah hidup, jadi
     inilah satu-satunya cara membuktikan ikon itu SUDAH TIADA (ujian membaca
     innerHTML - textContent dan innerHTML ialah dua sifat berasingan dalam
     harness, manakala dalam DOM sebenar menulis textContent juga mengosongkan
     innerHTML). */
  btn.innerHTML = LAP_DEL_BUSY;
  btn.setAttribute('title', 'Sedang memadam rekod minggu ini…');
}

function lapDisableAll(yes) {
  Object.keys(LAP.delBtns).forEach(function (k) {
    LAP.delBtns[k].disabled = !!yes;
  });
}

/* Satu sel: tong sampah untuk rekod sendiri, sengkang untuk rekod orang lain.

   v27 menambah butang UBAH SUAI (pensel) di sebelah kiri tong sampah; v28
   membuangnya semula atas permintaan pengguna - *"感觉修改键很多余。有错误叫老师删掉
   重新上载就可以了。"* Jadi sel ini kembali kepada satu tindakan, dan namanya
   kembali kepada lapDeleteCell. Aliran yang tinggal: PADAM di sini, kemudian
   muat naik semula pada halaman Hantar.

   v41: parameternya ialah BARIS rekod (objek dari pelayan: minggu + subjek),
   bukan sekadar nombor minggu. Kedua-duanya disimpan pada butang - `dataset.
   minggu` kekal supaya pembaca lama tidak pecah - dan pengekliknya membawa
   KEDUA-DUANYA, kerana itulah yang menentukan rekod mana yang dibuang. */
function lapDeleteCell(r, sendiri) {
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

  var minggu = r && r.minggu;
  var subjek = (r && r.subjek) || '';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lap-del';
  btn.innerHTML = LAP_TRASH_SVG;
  btn.dataset.minggu = String(minggu);
  btn.dataset.subjek = String(subjek);
  btn.dataset.label = lapLabel(minggu, subjek);
  btn.title = 'Padam rekod ' + lapLabel(minggu, subjek) +
              ' — anda boleh muat naik semula selepas ini';
  btn.setAttribute('aria-label', 'Padam rekod ' + lapLabel(minggu, subjek));
  btn.addEventListener('click', function () { lapDeleteClick(minggu, subjek); });

  td.appendChild(btn);
  LAP.delBtns[lapKunci(minggu, subjek)] = btn;
  return td;
}

/* Pengesahan dua langkah. Sengaja TIDAK menggunakan confirm(): dialog menyekat
   pemaparan dan itu pernah melumpuhkan portal ini. */
function lapDeleteClick(minggu, subjek) {
  if (LAP.deleting) return;

  var kunci = lapKunci(minggu, subjek);

  if (LAP.armedKey !== kunci) {
    lapArm(LAP.armedKey, false);
    LAP.armedKey = kunci;
    lapArm(kunci, true);
    /* Butang itu sendiri sudah berkata "Padam?". Nota ini menerangkan AKIBAT,
       bukan mekanisme - dan ia kekal di bawah jadual, jadi ia hanya berfungsi
       sebagai nota kaki, bukan arahan. */
    lapHint('Rekod ' + lapLabel(minggu, subjek) + ' akan dipadam. Salinan penuh ' +
            'disimpan dalam tab ResponsesDibuang dan failnya boleh dipulihkan ' +
            'oleh pentadbir, jadi anda boleh muat naik semula selepas ini.', 'bad');
    return;
  }

  lapDoDelete(minggu, subjek);
}

function lapDoDelete(minggu, subjek) {
  LAP.deleting = true;
  LAP.armedKey = null;
  /* v36: teks "Deleting…" menggantikan ikon tong sampah semasa permintaan
     berjalan (dahulunya lapArm(minggu, false) - ikon kembali serta-merta). */
  lapBusy(lapKunci(minggu, subjek));
  lapDisableAll(true);
  lapHint('Memadam ' + lapLabel(minggu, subjek) + '…');

  /* v41: subjek dihantar sebagai argumen KETIGA, jadi pelayan membuang hanya
     baris rekod ini - mata pelajaran lain pada minggu yang sama kekal.

     v42: dalam mod pentadbir, panggilan bertukar kepada apiPentadbirPadam, yang
     membawa email guru sasaran sebagai argumen KEEMPAT. Guru biasa yang memaksa
     cawangan ini ditolak di server ("Akses ditolak: mod pentadbir ..."). */
  var admin = (typeof state !== 'undefined' && state.adminOn && state.adminGuru)
    ? state.adminGuru : null;

  var panggil = admin
    ? serverCall('apiPentadbirPadam', [minggu, LAP.tahun, subjek, admin.email])
    : serverCall('apiDelete', [minggu, LAP.tahun, subjek]);

  withTimeout(panggil, SLOW_SERVER_MS, SLOW_SERVER_MSG)
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal memadam');

      LAP.flash = {
        text: 'Rekod ' + lapLabel(minggu, subjek) + ' telah dipadam. ' +
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
      /* Padam GAGAL: butang mesti kembali kepada ikon tong sampah. Kalau ia
         kekal "Deleting…" yang dilumpuhkan, guru terperangkap - tiada cara
         mencuba semula selain memuatkan semula halaman. */
      lapArm(lapKunci(minggu, subjek), false);
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
