'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { socAssess, socPhraseScan, socKeywordMine, socHot, classifySourceProvenance } = require('../social');

const NOW = Date.parse('2025-06-01T12:00:00Z');
const mk = (text, over = {}) => Object.assign({
  text, ts: NOW - 30 * 60e3, topics: [], platform: 'x', user: 'anon'
}, over);
const byAuthors = (text, users, over = {}) => users.map((u, i) => mk(text, { ...over, user: '@' + u + i }));

test('socPhraseScan: frasa berulang >=3 author dalam window muncul', () => {
  const posts = [
    ...byAuthors('Banjir Jakarta Besar merendam ratusan rumah semalam.', ['a', 'b', 'c']),
    mk('Cuaca ekstrem menggila.', { user: 'd' }),
  ];
  const out = socPhraseScan(posts, { now: NOW });
  const hit = out.find(r => r.id === 'banjir jakarta besar');
  assert.ok(hit, 'frasa target harus ada');
  assert.equal(hit.users, 3);
  assert.equal(hit.ph, 'Banjir Jakarta Besar');
  assert.ok(hit.n >= 3);
});

test('socPhraseScan: <3 author unik tidak lolos', () => {
  const posts = [
    mk('Longsor Susulan Guncang Desa', { user: 'x' }),
    mk('Longsor Susulan Guncang Desa lagi', { user: 'y' }),
    mk('Longsor Susulan Guncang Desa juga', { user: 'x' }),
  ];
  const out = socPhraseScan(posts, { now: NOW });
  assert.ok(!out.some(r => r.id === 'longsor susulan guncang desa'));
});

test('socPhraseScan: post lebih tua dari window diabaikan', () => {
  const posts = byAuthors('Kebakaran Melanda Desa Besar', ['a', 'b', 'c'], { ts: NOW - 4 * 3600e3 });
  const out = socPhraseScan(posts, { now: NOW });
  assert.ok(!out.some(r => r.id === 'kebakaran melanda desa besar'));
});

test('socPhraseScan: exclude set memangkas frasa topik registry', () => {
  const posts = byAuthors('Banjir Jakarta Besar merendam rumah.', ['a', 'b', 'c']);
  const out = socPhraseScan(posts, { now: NOW, exclude: new Set(['banjir', 'kebakaran']) });
  assert.ok(!out.some(r => r.id === 'banjir jakarta besar'));
});

test('socPhraseScan: hashtag ikut jadi kandidat (lowercase tanpa #)', () => {
  const posts = byAuthors('Hujan deras semalaman #banjirbandang', ['a', 'b', 'c']);
  const out = socPhraseScan(posts, { now: NOW });
  const hit = out.find(r => r.id === 'banjirbandang');
  assert.ok(hit, 'hashtag harus muncul');
  assert.equal(hit.users, 3);
});

test('socPhraseScan: max membatasi hasil', () => {
  const posts = [];
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  for (let i = 0; i < 6; i++)
    posts.push(...byAuthors(`Peristiwa Langka ${names[i]} Guncang`, ['u' + i + 'a', 'u' + i + 'b', 'u' + i + 'c']));
  const out = socPhraseScan(posts, { now: NOW, max: 3 });
  assert.equal(out.length, 3);
});

test('socPhraseScan: mention & URL distrip sebelum ekstraksi', () => {
  const posts = byAuthors('@DetikCom Bilang Banjir Melanda', ['a', 'b', 'c']);
  const out = socPhraseScan(posts, { now: NOW });
  assert.ok(!out.some(r => r.id.includes('detikcom') || r.ph.toLowerCase().includes('detikcom')),
    'mention @DetikCom tidak boleh jadi kandidat');
  assert.ok(out.some(r => r.id === 'bilang banjir melanda'), 'sisa frasa setelah mention dicabut tetap kehitung');
});

test('socPhraseScan: sub-frasa kontigu dari match panjang ikut teragregasi', () => {
  const posts = [
    ...byAuthors('Banjir Jakarta Raya Melanda', ['a', 'b']),
    ...byAuthors('Banjir Jakarta Pusat Melanda', ['c', 'd']),
  ];
  const out = socPhraseScan(posts, { now: NOW, minUsers: 2 });
  assert.ok(out.some(r => r.id === 'banjir jakarta'),
    '"banjir jakarta" harus ngumpul dari dua varian ekor berbeda');
});

test('socPhraseScan: hashtag murni digit ditolak', () => {
  const posts = byAuthors('Situasi Memanas #2025', ['a', 'b', 'c']);
  const out = socPhraseScan(posts, { now: NOW });
  assert.ok(!out.some(r => r.id === '2025'));
});

test('socKeywordMine: token dari URL & mention tidak ikut term', () => {
  const posts = Array.from({ length: 4 }, (_, i) => mk(
    'kebakaran kios https://berita.com/Status/2025/Detail @DetikCom',
    { topics: ['kebakaran'], user: 'u' + i }));
  const terms = socKeywordMine(posts, 'kebakaran', { now: NOW }).map(r => r.term);
  assert.ok(terms.includes('kios'));
  for (const junk of ['status', 'detail', 'https', 'detikcom'])
    assert.ok(!terms.includes(junk), junk + ' harus ke-strip');
});

test('socKeywordMine: istilah sering & bukan stopword/query muncul', () => {
  const texts = [
    'kebakaran melanda kios dan warung, mobil warga terbakar',
    'api merambat ke kios serta warung, satu mobil hangus',
    'kebakaran besar, kios warung dan beberapa mobil musnah',
    'kobaran api menghanguskan kios warung mobil warga',
    'damai tapi kios warung mobil jadi abu',
  ];
  const posts = texts.map((t, i) => mk(t, { topics: ['kebakaran'], user: 'm' + i }));
  const out = socKeywordMine(posts, 'kebakaran', { now: NOW });
  const terms = out.map(r => r.term);
  assert.ok(terms.includes('kios'), 'kios harus jadi kandidat');
  assert.ok(terms.includes('warung'));
  assert.ok(!terms.includes('kebakaran'), 'istilah query existing harus ke-skip');
  assert.ok(!terms.includes('terbakar'), 'istilah di th[] harus ke-skip');
  assert.ok(!terms.includes('dan'), 'stopword harus ke-skip');
  const kios = out.find(r => r.term === 'kios');
  assert.equal(kios.df, 5);
});

test('socKeywordMine: post tanpa topik / di luar window tidak dihitung', () => {
  const posts = [
    mk('kios warung mobil', { topics: ['kebakaran'], user: 'x1' }),
    mk('kios warung mobil', { topics: ['kebakaran'], user: 'x2' }),
    mk('kios warung mobil', { topics: [], user: 'x3' }),
    mk('kios warung mobil', { topics: ['kebakaran'], user: 'x4', ts: NOW - 8 * 3600e3 }),
  ];
  const out = socKeywordMine(posts, 'kebakaran', { now: NOW });
  assert.equal(out.length, 0);
});

test('socKeywordMine: topik tak dikenal -> []', () => {
  assert.deepEqual(socKeywordMine([mk('apa saja')], 'topik-ngawur', { now: NOW }), []);
});

test('socPhraseScan: memangkas boilerplate BMKG/arah mata angin & subsumption sub-frasa', () => {
  const posts = [
    ...byAuthors('BMKG Disclaimer Gempa Magnitudo 3.2 Tenggara KAB Cianjur, wilayah Gayo Lues Aceh', ['a', 'b', 'c']),
  ];
  const out = socPhraseScan(posts, { now: NOW });
  assert.ok(!out.some(r => /disclaimer|tenggara|kab/i.test(r.id)), 'boilerplate BMKG/arah harus ditolak');
  assert.ok(out.some(r => r.id === 'gayo lues aceh'), 'frasa terpanjang Gayo Lues Aceh harus bertahan');
  assert.ok(!out.some(r => r.id === 'lues aceh' || r.id === 'gayo lues'), 'sub-frasa dengan users/n <= parent harus dipangkas');
});

test('socPhraseScan: exclude pakai batas kata agar demo tidak membuang Demokrasi', () => {
  const posts = byAuthors('Sidang Demokrasi Pancasila digelar hari ini.', ['a', 'b', 'c']);
  const out = socPhraseScan(posts, { now: NOW, exclude: new Set(['demo']) });
  assert.ok(out.some(r => r.id === 'sidang demokrasi pancasila'), 'Demokrasi tidak boleh terblokir oleh topic id demo');
});

test('socHot: memberi bobot lebih tinggi pada signalEligible resmi/saksi dibanding situational_context menggunakan output asli socAssess', () => {
  const mkReal = (text, opts) => {
    const a = socAssess(text);
    const prov = classifySourceProvenance({ handle: opts.user, username: opts.user, text }, a);
    return {
      topics: [opts.topic],
      platform: opts.platform,
      user: opts.user,
      ts: opts.ts,
      assessment: { ...a, provenance: prov },
    };
  };
  const posts = [
    mkReal('Banjir merendam Jalan Kemang Raya 50 cm pagi ini, warga evakuasi', { topic: 'banjir', platform: 'x', user: 'u1', ts: NOW - 10 * 60e3 }),
    mkReal('BNPB melaporkan banjir melanda Bekasi Timur pagi ini, tim evakuasi dikerahkan', { topic: 'banjir', platform: 'x', user: 'bnpb_indonesia', ts: NOW - 12 * 60e3 }),
    mkReal('Air banjir sudah masuk teras rumah kami di Pondok Gede pagi ini', { topic: 'banjir', platform: 'th', user: 'u3', ts: NOW - 15 * 60e3 }),
    mkReal('Jakarta sering kebakaran nggak sih kalau kemarau?', { topic: 'kebakaran', platform: 'x', user: 'k1', ts: NOW - 10 * 60e3 }),
    mkReal('Bandung sering kebakaran nggak sih kalau malam?', { topic: 'kebakaran', platform: 'x', user: 'k2', ts: NOW - 12 * 60e3 }),
    mkReal('Surabaya sering kebakaran nggak sih?', { topic: 'kebakaran', platform: 'x', user: 'k3', ts: NOW - 15 * 60e3 }),
  ];
  const { hot } = socHot(posts, NOW);
  const b = hot.find(x => x.id === 'banjir');
  const k = hot.find(x => x.id === 'kebakaran');
  assert.ok(b && k, 'kedua topik dengan >=3 author harus muncul');
  assert.ok(b.score > k.score * 2, `skor banjir (${b.score}) harus jauh lebih tinggi daripada situational_context (${k.score})`);
});
