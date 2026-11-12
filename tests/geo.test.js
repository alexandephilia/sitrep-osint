#!/usr/bin/env node

const fs = require('fs'), path = require('path');
const GEO = require('../geocode'), { onLand, nearestLand } = require('../scripts/geo-audit');
const { VOLCANO_COORDS } = require('../src/geo-sensors');
const G = require('../geo/gazetteer.json');
let fail = 0; const bad = (m) => { fail++; console.log('GAGAL  ' + m); };

const ISLAND_OK = ['Kepulauan Seribu'];
for (const n of GEO.NODES) {
  if (ISLAND_OK.some(x => n.name.includes(x))) continue;
  if (!onLand(n.lo, n.la)) bad(`node di laut: ${n.name} (${nearestLand(n.lo, n.la).km.toFixed(1)} km dari pantai)`);
}
for (const p of G.prov) {
  const r = GEO.locate('Banjir di Provinsi ' + p.name);
  if (!r) { bad('provinsi tidak ter-geocode: ' + p.name); continue; }
  if (!onLand(r.lo, r.la)) bad(`provinsi di laut: ${p.name} (${nearestLand(r.lo, r.la).km.toFixed(1)} km)`);
}
for (const t of ['Banjir di Flores', 'Gempa di Lombok', 'Banjir di Sumba', 'Banjir di Halmahera', 'Erupsi Gunung Semeru', 'Erupsi Ili Lewotolok', 'Erupsi Gunung Merapi', 'Erupsi Gunung Karangetang', 'Demo di depan Istana Merdeka', 'Demo di Gedung DPR']) {
  const r = GEO.locate(t); if (!r) { bad('POI/region tidak ketemu: ' + t); continue; }
  if (!onLand(r.lo, r.la)) bad(`POI/region di laut: ${t} -> ${r.name} (${nearestLand(r.lo, r.la).km.toFixed(1)} km)`);
}

const GOLD = [
  ['BPBD: Semua Kecamatan di Kota Malang Rawan Terdampak Bencana', 'Malang'],
  ['Atap Aula Kelurahan Limusnunggal Sukabumi Ambruk', 'Kelurahan Limusnunggal, Kecamatan Cibeureum, Sukabumi, Jawa Barat'],
  ['Pemkab Barito Selatan Perpanjang Status Tanggap Darurat Karhutla', 'Barito Selatan'],
  ['Marapi Erupsi Sabtu pagi, sebaran abu vulkanik terpantau di Agam', 'Gunung Marapi'],
  ['Kebakaran Pasar di Kota Bandung Hanguskan 20 Kios', 'Bandung'],
  ['Banjir Rendam Kabupaten Bandung, Ratusan Warga Mengungsi', 'Kab. Bandung'],
  ['Aktivitas Erupsi Gunung Ile Lewotolok di NTT Masih Tinggi', 'Gunung Lewotolok'],
  ['Demo Buruh di Kantor Gubernur Jawa Barat Tuntut UMP Naik', 'Jawa Barat'],
  ['Gempa M5,2 Guncang Cilacap, Warga Panik', 'Cilacap'],
  ['Kecelakaan Bus di Tol Cipali Tewaskan 5 Orang', null],
  ['Metro TV Gelar Diskusi Soal Ekonomi', null],
  ['Harga Batu Bara Naik di Pasar Global', null],
  ['Serangan Balik Pemain Persija Bikin Gol', null],
  ['Jenazah korban kecelakaan helikopter dipulangkan ke Jawa Tengah', null],
  ['Korban dilarikan ke RSUD Bandung usai kecelakaan di Cilegon', 'Cilegon'],
  ['Gerak Cepat Pemerintah Tangani Banjir di Aceh dan Sumatra Utara', 'Aceh', ['Aceh', 'Sumatera Utara']],
  ['Longsor di Aceh, Jawa Tengah dan Jawa Timur Telan Korban', 'Aceh', ['Aceh', 'Jawa Tengah', 'Jawa Timur']],
  ['Pria Asal Bogor Ditangkap di Cilegon karena Curanmor', 'Cilegon'],
  ['Gempa di NTB', 'Nusa Tenggara Barat'],
  ['Banjir di DIY', 'DI Yogyakarta'],
  ['Gempa di DKI', 'Jakarta'],
  ['gibran dimakzulkan di istana', 'Istana Merdeka'],
  ['Massa Demonstran Segel Istana Wapres Gibran', 'Istana Merdeka'],
  ['Demo di DPR Tuntut Batalkan Revisi UU', 'DPR / MPR Senayan'],
  ['Aksi Buruh di Depan Gedung MK', 'Mahkamah Konstitusi'],
  ['Kebakaran di Istana Maimun Medan', 'Istana Maimun'],
  ['Demonstrasi di depan Istana Bogor', 'Istana Bogor'],
];
for (const [t, exp, multi] of GOLD) {
  const r = GEO.locate(t), got = r && r.name;
  if (got !== exp) bad(`"${t}" -> ${got} (harusnya ${exp})`);
  if (multi) { const all = (r && r.all || []).map(x => x.name); if (JSON.stringify(all) !== JSON.stringify(multi)) bad(`multi "${t}" -> ${JSON.stringify(all)} (harusnya ${JSON.stringify(multi)})`); }
}

const stats = GEO.stats();
if (GEO.NODES.length !== 514) bad(`NODES memuat ${GEO.NODES.length} titik tetap, seharusnya hanya 514 kab/kota`);
if (stats.villages !== 83529 || stats.desa !== 75034 || stats.kelurahan !== 8495) bad(`statistik BIG tidak sesuai: ${JSON.stringify(stats)}`);
const BIG_GOLD = [
  ['Kebakaran di Kelurahan Gambir, Jakarta Pusat', '31.71.01.1001', 'kelurahan', -6.176377, 106.826707],
  ['Banjir di Desa Keude Bakongan, Kecamatan Bakongan, Kabupaten Aceh Selatan', '11.01.01.2001', 'desa', 2.93109, 97.48459],
  ['Banjir di Desa Limusnunggal, Kecamatan Cileungsi, Kabupaten Bogor', '32.01.07.2011', 'desa', -6.375136, 106.96945],
  ['Banjir di Desa Limusnunggal, Kecamatan Bantargadung, Kabupaten Sukabumi', '32.02.04.2004', 'desa', -6.956538, 106.640443],
  ['Atap Aula Kelurahan Limusnunggal Sukabumi Ambruk', '32.72.07.1004', 'kelurahan', -6.947022, 106.941743],
  ['Banjir di Desa Sukamaju, Kecamatan Bantan, Kabupaten Bengkalis', '14.03.02.2015', 'desa', 1.479932, 102.400612],
];
for (const [title, code, prec, la, lo] of BIG_GOLD) {
  const r = GEO.locate(title);
  if (!r) { bad(`BIG tidak menemukan: ${title}`); continue; }
  if (r.code !== code || r.prec !== prec) bad(`BIG salah administrasi untuk "${title}": ${r.code}/${r.prec}, seharusnya ${code}/${prec}`);
  if (Math.abs(r.la - la) > 1e-9 || Math.abs(r.lo - lo) > 1e-9) bad(`BIG salah koordinat untuk "${title}": ${r.la},${r.lo}`);
  if (r.coordinateSource !== 'BIG administrative polygon centroid' || !r.boundaryStatus) bad(`metadata centroid BIG hilang untuk "${title}"`);
}
const ambiguousVillage = GEO.locate('Banjir di Desa Limusnunggal');
if (ambiguousVillage) bad(`nama desa ambigu dipilih tanpa konteks: ${JSON.stringify(ambiguousVillage)}`);
for (const title of ['Gempa di Jepang', 'Gempa di London']) {
  if (GEO.locate(title)) bad(`nama negara/kota asing tersangkut ke nama desa lokal: ${title}`);
}
const stationVillageTitle = GEO.locate('Kebakaran di Stasiun Gambir, Kelurahan Gambir');
if (!stationVillageTitle || stationVillageTitle.prec !== 'poi' || stationVillageTitle.la !== -6.1767 || stationVillageTitle.lo !== 106.8306) bad(`POI spesifik Stasiun Gambir kalah dari centroid kelurahan: ${JSON.stringify(stationVillageTitle)}`);
const kecFallback = GEO.locate('Banjir di Kecamatan Huta Bayu Raja');
if (!kecFallback || kecFallback.prec !== 'kec' || !kecFallback.name.includes('Huta Bayu Raja')) bad(`fallback kecamatan BIG hilang: ${JSON.stringify(kecFallback)}`);
const okIlir = GEO.locate('Banjir di Ogan Komering Ilir');
if (!okIlir || okIlir.prec !== 'kab' || !okIlir.name.includes('Ogan Komering Ilir')) bad(`alias kabupaten BIG hilang: ${JSON.stringify(okIlir)}`);
const provGeo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'idn-prov.geo.json'), 'utf8'));
const provNames = new Set((provGeo.features || []).map(f => f.properties && f.properties.name));
const provCodes = new Set((provGeo.features || []).map(f => f.properties && f.properties.code).filter(Boolean));
if ((provGeo.features || []).length !== 38 || provCodes.size !== 38) bad(`idn-prov.geo.json harus 38 fitur & 38 kode unik, dapat ${(provGeo.features || []).length}/${provCodes.size}`);
for (const pName of ['Kalimantan Utara', 'Papua Selatan', 'Papua Tengah', 'Papua Pegunungan', 'Papua Barat Daya']) {
  if (!provNames.has(pName)) bad(`provinsi tidak ada di idn-prov.geo.json: ${pName}`);
}
for (const [title, expLa, expLo, tol] of [
  ['Banjir di Provinsi Papua', -2.56263, 140.69263, 0.05],
  ['Banjir di Provinsi Aceh', 5.55005, 95.31783, 0.05],
  ['Banjir di Provinsi DKI Jakarta', -6.1729, 106.8187, 0.05],
  ['Banjir di Provinsi Maluku Utara', 0.73288, 127.56228, 0.05],
  ['Banjir di Provinsi Nusa Tenggara Timur', -10.1539, 123.61939, 0.05],
  ['Erupsi Gunung Kelimutu', -8.77, 121.82, 0.02],
  ['Longsor di Pelaga, Badung', -8.2918, 115.2127, 0.02],
  ['Banjir di Cakung', -6.1897, 106.9397, 0.02],
  ['Kecelakaan di Mlati, Sleman', -7.7384, 110.3443, 0.02],
  ['Erupsi Gunung Inerie', -8.875, 120.95, 0.02],
  ['Erupsi Gunung Ciremai', -6.892, 108.4, 0.02],
  ['Erupsi Gunung Salak', -6.716, 106.734, 0.02],
]) {
  const r = GEO.locate(title);
  if (!r || Math.abs(r.la - expLa) > tol || Math.abs(r.lo - expLo) > tol) bad(`koordinat tidak akurat untuk "${title}": ${JSON.stringify(r)}`);
}
for (const [title, kecCode, src, expLa, expLo, tol] of [
  ['Banjir di Kecamatan Seruyan Hulu', '62.07.05', 'BIG kecamatan village medoid', -1.1024, 112.0167, 0.05],
  ['Longsor di Kecamatan Cisarua, Kabupaten Bandung Barat', '32.17.03', 'BIG kecamatan village medoid', -6.802, 107.5475, 0.05],
  ['Banjir di Kecamatan Pamek', '95.02.33', 'Kepmendagri 2025 kecamatan center', -4.3755, 140.0006, 0.02],
]) {
  const r = GEO.locate(title);
  if (!r || r.prec !== 'kec' || r.kecCode !== kecCode || r.coordinateSource !== src || Math.abs(r.la - expLa) > tol || Math.abs(r.lo - expLo) > tol) {
    bad(`koordinat kecamatan tidak akurat untuk "${title}": ${JSON.stringify(r)}`);
  }
}
for (const [title, code, expLa, expLo, maxKm] of [
  ['Banjir di Desa Nua Nea, Kecamatan Amahai, Kabupaten Maluku Tengah', '81.01.01.2021', -3.25633, 129.09064, 0],
  ['Banjir di Desa Normal I, Kecamatan Omesuri, Kabupaten Lembata', '53.13.06.2021', -8.19139, 123.76528, 1],
  ['Banjir di Desa Buku Limau, Kecamatan Manggar, Kabupaten Belitung Timur', '19.06.01.2010', -2.8123, 108.4023, 15],
]) {
  const r = GEO.locate(title);
  const distKm = r ? (onLand(r.lo, r.la) ? 0 : nearestLand(r.lo, r.la).km) : Infinity;
  if (!r || r.code !== code || r.coordinateSource !== 'BIG village coord fix' || Math.abs(r.la - expLa) > 1e-4 || Math.abs(r.lo - expLo) > 1e-4 || distKm > maxKm) {
    bad(`fix desa tidak sesuai untuk "${title}": ${JSON.stringify(r)}`);
  }
}
if (!VOLCANO_COORDS.Ibu || VOLCANO_COORDS.Ibu[0] <= 1 || !VOLCANO_COORDS.Gamalama || VOLCANO_COORDS.Gamalama[0] <= 0 || Math.abs(VOLCANO_COORDS.Kelimutu[1] - 121.82) > 0.02) {
  bad(`VOLCANO_COORDS Ibu/Gamalama/Kelimutu masih salah: Ibu=${VOLCANO_COORDS.Ibu} Gamalama=${VOLCANO_COORDS.Gamalama} Kelimutu=${VOLCANO_COORDS.Kelimutu}`);
}
for (const v of ['Inerie', 'Ciremai', 'Salak', 'Banda Api', 'Awu', 'Talang', 'Sumbing', 'Gede', 'Ili Boleng', 'Ile Werung']) {
  if (!VOLCANO_COORDS[v]) bad(`gunung aktif tidak ada di VOLCANO_COORDS: ${v}`);
}
console.log(fail ? `\n${fail} kegagalan` : `OK: ${GEO.NODES.length} node, ${G.prov.length} provinsi, ${GOLD.length} judul emas, ${BIG_GOLD.length} koordinat BIG`);
process.exit(fail ? 1 : 0);
