'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const C = require('../public/cctv-core');
const { createGateway, makeLane, makeBucket, makeLru } = require('../cctv-gateway');

test('streamKey/dedupe: stream pantau/molecool/path sama dianggap satu kamera', () => {
  const list = [
    { n: 'A', s: 'https://pantaucctv.com/api/stream?id=molecool-8' },
    { n: 'B', s: 'https://pantaucctv.com/api/stream?id=molecool-8' },
    { n: 'C', s: 'https://h.example/cam1/index.m3u8' },
    { n: 'D', s: 'https://h.example/cam1/mono.m3u8' },
    { n: 'E', s: 'https://h.example/cam2/index.m3u8' },
  ];
  const out = C.dedupe(list);
  assert.deepEqual(out.map(c => c.n), ['A', 'C', 'E']);
});

test('sanitizeFb: fallback ke kamera lain dibuang, kamera yang sama dipertahankan', () => {
  const cam = { n: 'Bendungan Hilir 003', s: 'https://pantaucctv.com/api/stream?id=molecool-10',
    fb: ['https://jakcctv.jakarta.go.id/Bendungan-Hilir-003-700014_1/index.m3u8?proto=hls', 'https://dki-jkt.balitower.co.id:7028/503536_FLYOVER/index.m3u8'] };
  const out = C.sanitizeFb(cam);
  assert.equal(out.fb.length, 1);
  assert.match(out.fb[0], /Bendungan-Hilir-003/);
  const none = C.sanitizeFb({ n: 'Gelora 026', s: 'https://pantaucctv.com/api/stream?id=molecool-1263', fb: ['https://x.example/lain/index.m3u8'] });
  assert.equal(none.fb, undefined);
});

test('playSteps: direct dulu, proxy, fallback, varian path terakhir; d:0 melewati direct', () => {
  const px = u => 'P:' + u;
  const cam = { n: 'Cam', s: 'https://h.example/a/index.m3u8' };
  const st = C.playSteps(cam, px);
  assert.deepEqual(st.slice(0, 2).map(x => x.via), ['direct', 'proxy']);
  assert.equal(st[0].url, cam.s);
  assert.ok(st.slice(2).every(x => x.via === 'direct' && /mono|playlist/.test(x.url)), 'varian tebakan di akhir');
  const nd = C.playSteps({ ...cam, d: 0 }, px);
  assert.ok(nd.every(x => x.via === 'proxy'), 'host tanpa CORS: proxy saja');
  assert.equal(nd.length, 1);
});

test('pickStarts: maksimal perHost, round-robin antar host, hormati maxLoad & yang sedang loading', () => {
  const cands = [];
  for (let i = 0; i < 6; i++) cands.push({ key: 'b' + i, host: 'balitower' });
  cands.push({ key: 'h0', host: 'hk' }, { key: 'j0', host: 'jogja' });
  const p = C.pickStarts(cands, { maxLoad: 6, perHost: 2, loadingTotal: 0, loadingByHost: {} });
  assert.equal(p.filter(k => k.startsWith('b')).length, 2, 'balitower dibatasi 2');
  assert.ok(p.includes('h0') && p.includes('j0'), 'host lain tetap kebagian');
  const p2 = C.pickStarts(cands, { maxLoad: 3, perHost: 2, loadingTotal: 2, loadingByHost: { balitower: 2 } });
  assert.deepEqual(p2, ['h0']);
});

test('shouldDemote: hanya saat ada antrean host lain dan lewat batas lunak', () => {
  const p = { loading: true, loaded: false, t0: 1000, dem: 0 };
  assert.equal(C.shouldDemote(p, 20000, true, 12000), true);
  assert.equal(C.shouldDemote(p, 20000, false, 12000), false);
  assert.equal(C.shouldDemote(p, 5000, true, 12000), false);
  assert.equal(C.shouldDemote({ ...p, dem: 3 }, 20000, true, 12000), false);
});

test('makeLane: batas total dan per host', async () => {
  const lane = makeLane(3, 2);
  let cur = 0, maxCur = 0; const perCur = {}; let maxPer = 0;
  const job = host => lane.run(host, async () => {
    cur++; perCur[host] = (perCur[host] || 0) + 1;
    maxCur = Math.max(maxCur, cur); maxPer = Math.max(maxPer, perCur[host]);
    await new Promise(r => setTimeout(r, 15));
    cur--; perCur[host]--;
  });
  await Promise.all([...Array(8).fill('a').map(job), ...Array(4).fill('b').map(job)]);
  assert.ok(maxCur <= 3, 'total <= 3, dapat ' + maxCur);
  assert.ok(maxPer <= 2, 'per host <= 2, dapat ' + maxPer);
});

test('makeBucket: habis lalu pulih seiring waktu', () => {
  let t = 0; const b = makeBucket(2, 4, () => t);
  for (let i = 0; i < 4; i++) assert.equal(b.take('ip'), true);
  assert.equal(b.take('ip'), false);
  t += 1000;
  assert.equal(b.take('ip'), true);
  b.charge('ip', 100);
  assert.equal(b.ok('ip'), false, 'tagihan byte menahan request berikutnya');
});

test('makeLru: evict berdasar byte dan hormati TTL', () => {
  let t = 0; const c = makeLru(100, () => t);
  c.set('a', 1, 60, 1000); c.set('b', 2, 60, 1000);
  assert.equal(c.get('a'), null, 'a ter-evict');
  assert.equal(c.get('b'), 2);
  t += 2000;
  assert.equal(c.get('b'), null, 'kadaluarsa');
});

function fakeUpstream() {
  const calls = { n: 0, byUrl: {} };
  const seg = Buffer.alloc(50000, 7);
  const getRaw = async (url) => {
    calls.n++; calls.byUrl[url] = (calls.byUrl[url] || 0) + 1;
    await new Promise(r => setTimeout(r, 40));
    const ok = (body, ct) => ({ r: { ok: true, status: 200, headers: { get: k => /content-type/i.test(k) ? ct : null },
      body: new ReadableStream({ start(c) { c.enqueue(body); c.close(); } }), arrayBuffer: async () => body }, url });
    if (/bad/.test(url)) return { r: { ok: false, status: 404, headers: { get: () => null }, body: null }, url };
    if (/\.m3u8/.test(url)) return ok(Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg1.ts\n'), 'application/vnd.apple.mpegurl');
    if (/\.ts/.test(url)) return ok(seg, 'video/mp2t');
    throw new Error('x');
  };
  return { getRaw, calls, seg };
}
async function withGateway(opts, fn) {
  const up = fakeUpstream();
  const gw = createGateway({ getRaw: up.getRaw, hostAllowed: u => /^https:\/\/cam\.example\//.test(u), headersFor: () => ({}),
    rewriteUrl: async u => u, px: u => '/hls?u=' + encodeURIComponent(u), isKnown: u => /cam\.example/.test(u), ...opts });
  const srv = http.createServer((req, res) => gw.hls(new URL(req.url, 'http://x').searchParams.get('u'), req, res));
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try { await fn({ gw, up, base, hit: u => fetch(base + '/?u=' + encodeURIComponent(u)) }); }
  finally { srv.closeAllConnections && srv.closeAllConnections(); await new Promise(r => srv.close(r)); }
}

test('gateway: 20 penonton playlist yang sama = 1 fetch upstream (coalescing) + cache', async () => {
  await withGateway({}, async ({ up, hit }) => {
    const u = 'https://cam.example/a/index.m3u8';
    const rs = await Promise.all(Array.from({ length: 20 }, () => hit(u)));
    for (const r of rs) { assert.equal(r.status, 200); assert.match(await r.text(), /\/hls\?u=https%3A%2F%2Fcam\.example%2Fa%2Fseg1\.ts/); }
    assert.equal(up.calls.byUrl[u], 1);
    const again = await hit(u); assert.equal(again.status, 200);
    assert.equal(up.calls.byUrl[u], 1, 'cache hit tidak menyentuh upstream');
  });
});

test('gateway: segmen di-tee ke klien dan di-cache untuk penonton berikutnya', async () => {
  await withGateway({}, async ({ up, hit }) => {
    const u = 'https://cam.example/a/seg1.ts';
    const rs = await Promise.all(Array.from({ length: 5 }, () => hit(u)));
    for (const r of rs) { const b = Buffer.from(await r.arrayBuffer()); assert.equal(b.length, 50000); assert.equal(b[0], 7); }
    assert.equal(up.calls.byUrl[u], 1);
    assert.equal((await hit(u)).status, 200);
    assert.equal(up.calls.byUrl[u], 1);
  });
});

test('gateway: host di luar allowlist 403, status upstream diteruskan, rate limit 429', async () => {
  await withGateway({ options: { reqRate: 0.001, reqBurst: 3 } }, async ({ hit }) => {
    assert.equal((await hit('https://evil.example/x.m3u8')).status, 403);
    assert.equal((await hit('https://cam.example/bad/index.m3u8')).status, 404);
    assert.equal((await hit('https://cam.example/a/index.m3u8')).status, 200);
    assert.equal((await hit('https://cam.example/a/index.m3u8')).status, 429, 'burst habis');
  });
});

test('gateway: laporan mati butuh >=2 pelapor berbeda dan URL harus dikenal', () => {
  const gw = createGateway({ getRaw: async () => { throw new Error('x'); }, hostAllowed: () => true, headersFor: () => ({}),
    rewriteUrl: async u => u, px: u => u, isKnown: u => u === 'https://cam.example/ok.m3u8' });
  const u = 'https://cam.example/ok.m3u8';
  assert.equal(gw.report('https://evil.example/x', false, '1.1.1.1'), false, 'URL asing ditolak');
  gw.report(u, false, '1.1.1.1'); gw.report(u, false, '1.1.1.1');
  assert.equal(gw.reportedDead(u), false, 'satu pelapor tidak cukup');
  gw.report(u, false, '2.2.2.2');
  assert.equal(gw.reportedDead(u), true);
  gw.report(u, true, '3.3.3.3');
  assert.equal(gw.reportedDead(u), false, 'laporan sukses memulihkan');
});

test('gateway: RUM menolak input sampah dan menghitung persentil', () => {
  const gw = createGateway({ getRaw: async () => { throw new Error('x'); }, hostAllowed: () => true, headersFor: () => ({}), rewriteUrl: async u => u, px: u => u });
  const ev = [{ h: 'a.example', t: 1000 }, { h: 'a.example', t: 3000 }, { h: 'a.example', t: 9000 }, { h: 'a.example', f: 1 },
    { h: '<script>', t: 5 }, { h: 'a.example', t: -1 }, { h: 'a.example', t: 'x' }, null];
  gw.rumIngest(ev, '9.9.9.9');
  const s = gw.rumStats()['a.example'];
  assert.equal(s.ok, 3); assert.equal(s.fail, 1); assert.equal(s.ttff_p50, 3000); assert.equal(s.ttff_p95, 9000);
  assert.equal(Object.keys(gw.rumStats()).length, 1);
});

test('gateway: nonce/token query volatile di pantaucctv & molecool di-coalesce ke 1 fetch upstream', async () => {
  await withGateway({
    hostAllowed: u => /^https:\/\/(restreamer\.pantaucctv\.com|cctv\.molecool\.id)\//.test(u)
  }, async ({ up, hit }) => {
    const pantauUrls = Array.from({ length: 10 }, (_, i) => `https://restreamer.pantaucctv.com/cam1/index.m3u8?t=${1000 + i}`);
    const moleUrls = Array.from({ length: 10 }, (_, i) => `https://cctv.molecool.id/slug-a/index.m3u8?token=tok${i}`);
    const rs = await Promise.all([...pantauUrls, ...moleUrls].map(u => hit(u)));
    for (const r of rs) assert.equal(r.status, 200);
    assert.equal(up.calls.n, 2, '10 nonce pantaucctv + 10 token molecool = hanya 2 upstream fetch');
  });
});

test('gateway: disconnect klien terakhir membatalkan upstream signal & m.aborted bertambah', async () => {
  let seenSignal = null;
  const gw = createGateway({
    hostAllowed: () => true,
    headersFor: () => ({}),
    rewriteUrl: async u => u,
    px: u => u,
    getRaw: async (url, ms, hdrs, hostOk, signal) => {
      seenSignal = signal;
      let timer;
      const body = new ReadableStream({
        start(c) {
          c.enqueue(Buffer.alloc(4096, 3));
          timer = setInterval(() => {
            if (signal && signal.aborted) { clearInterval(timer); return; }
            try { c.enqueue(Buffer.alloc(4096, 4)); } catch { clearInterval(timer); }
          }, 25);
        },
        cancel() { clearInterval(timer); }
      });
      return { r: { ok: true, status: 200, headers: { get: k => /content-type/i.test(k) ? 'video/mp2t' : null }, body }, url };
    }
  });
  const srv = http.createServer((req, res) => gw.hls('https://cam.example/live/slow.ts', req, res));
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const ac = new AbortController();
    const res = await fetch(base + '/', { signal: ac.signal });
    const rd = res.body.getReader();
    await rd.read();
    ac.abort();
    await new Promise(r => setTimeout(r, 80));
    assert.equal(seenSignal && seenSignal.aborted, true, 'upstream signal harus aborted saat klien terakhir putus');
    assert.ok(gw.stats().aborted >= 1);
  } finally {
    srv.closeAllConnections && srv.closeAllConnections();
    await new Promise(r => srv.close(r));
  }
});

test('gateway: byteRl membatasi bandwidth per IP dengan 429', async () => {
  await withGateway({ options: { byteRate: 1, byteBurst: 20000 } }, async ({ hit }) => {
    const u = 'https://cam.example/a/seg1.ts';
    const r1 = await hit(u);
    assert.equal(r1.status, 200);
    await r1.arrayBuffer();
    const r2 = await hit(u);
    assert.equal(r2.status, 429, 'kuota byte habis harus memicu 429');
  });
});

test('gateway: segmen > segCacheMax di-fanout live ke beberapa penonton tanpa meledakkan RAM cache', async () => {
  const big = Buffer.alloc(1.5 * 1024 * 1024, 9);
  let calls = 0;
  const gw = createGateway({
    hostAllowed: () => true, headersFor: () => ({}), rewriteUrl: async u => u, px: u => u,
    options: { segCacheMax: 512 * 1024 },
    getRaw: async (url) => {
      calls++;
      await new Promise(r => setTimeout(r, 20));
      const body = new ReadableStream({
        start(c) {
          for (let off = 0; off < big.length; off += 262144) c.enqueue(big.subarray(off, off + 262144));
          c.close();
        }
      });
      return { r: { ok: true, status: 200, headers: { get: k => /content-type/i.test(k) ? 'video/mp2t' : null }, body }, url };
    }
  });
  const srv = http.createServer((req, res) => gw.hls('https://cam.example/live/big.ts', req, res));
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const rs = await Promise.all([fetch(base + '/'), fetch(base + '/')]);
    for (const r of rs) {
      assert.equal(r.status, 200);
      assert.equal((await r.arrayBuffer()).byteLength, big.length);
    }
    assert.equal(calls, 1, 'kedua penonton berbagi 1 upstream flight');
    assert.equal(gw.stats().cache.bytes, 0, 'segmen di atas segCacheMax tidak disimpan di LRU');
  } finally {
    srv.closeAllConnections && srv.closeAllConnections();
    await new Promise(r => srv.close(r));
  }
});

test('gateway: header keamanan nosniff + sandbox CSP & kondisional allowCors', async () => {
  await withGateway({ allowCors: false }, async ({ hit }) => {
    const r = await hit('https://cam.example/a/index.m3u8');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const rs = await hit('https://cam.example/a/seg1.ts');
    assert.equal(rs.status, 200);
    assert.equal(rs.headers.get('cache-control'), 'private, max-age=60');
  });
});

test('effectiveVisBounds: desktop memakai .pb, mobile memakai area di bawah header sticky', () => {
  const desktop = C.effectiveVisBounds({
    pbRect: { top: 316, bottom: 834 },
    pbOverflowY: 'auto',
    innerHeight: 900,
    stickyTop: 0,
  });
  assert.deepEqual(desktop, { top: 316, bot: 834, usePb: true });

  const mobile = C.effectiveVisBounds({
    pbRect: { top: -200, bottom: 4000 },
    pbOverflowY: 'visible',
    innerHeight: 844,
    stickyTop: 48,
  });
  assert.deepEqual(mobile, { top: 48, bot: 844, usePb: false });
});

test('pickLiveKeys: hindari sel yang terpotong/ketutupan di atas saat ada sel utuh di bawahnya', () => {
  const mkRow = (rowIdx, top, colCount = 2) => {
    const out = [];
    for (let c = 0; c < colCount; c++) {
      const idx = rowIdx * colCount + c;
      const rect = { top, bottom: top + 122, left: c * 188, width: 187, height: 122 };
      const frameRect = { top, bottom: top + 104, left: c * 188, width: 187, height: 104 };
      out.push({ key: 'c' + idx, idx, rect, frameRect, bad: false });
    }
    return out;
  };

  const deskVr = { top: 316, bot: 834 };
  const deskCells = [
    ...mkRow(0, 239),
    ...mkRow(1, 362),
    ...mkRow(2, 485),
    ...mkRow(3, 608),
    ...mkRow(4, 731),
  ];
  assert.deepEqual(C.pickLiveKeys(deskCells, deskVr, 6), ['c2', 'c3', 'c4', 'c5', 'c6', 'c7']);

  const mobVr = { top: 48, bot: 844 };
  const mobCells = [
    ...mkRow(0, -90),
    ...mkRow(1, 37),
    ...mkRow(2, 160),
    ...mkRow(3, 283),
    ...mkRow(4, 406),
    ...mkRow(5, 529),
  ];
  assert.equal(C.measureCell(mobCells[0].rect, mobCells[0].frameRect, mobVr).inView, false);
  assert.deepEqual(C.pickLiveKeys(mobCells, mobVr, 6), ['c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
});

test('pickLiveKeys: viewport pendek memprioritaskan sel dengan fraksi terlihat lebih besar & sehat', () => {
  const vr = { top: 528, bot: 702 };
  const cells = [

    { key: 'r0a', idx: 0, bad: false, rect: { top: 452, bottom: 574, left: 0, width: 170, height: 122 }, frameRect: { top: 452, bottom: 556, left: 0, width: 170, height: 104 } },

    { key: 'r1a', idx: 1, bad: false, rect: { top: 575, bottom: 697, left: 0, width: 170, height: 122 }, frameRect: { top: 575, bottom: 679, left: 0, width: 170, height: 104 } },

    { key: 'r2a', idx: 2, bad: false, rect: { top: 624, bottom: 746, left: 180, width: 170, height: 122 }, frameRect: { top: 624, bottom: 728, left: 180, width: 170, height: 104 } },

    { key: 'r3bad', idx: 3, bad: true, rect: { top: 575, bottom: 697, left: 360, width: 170, height: 122 }, frameRect: { top: 575, bottom: 679, left: 360, width: 170, height: 104 } },
  ];
  assert.deepEqual(C.pickLiveKeys(cells, vr, 6), ['r1a', 'r2a', 'r3bad']);
});

test('pickLiveKeys: sel yang bagian atasnya sudah tertutup scroll area dilarang mencuri slot LIVE', () => {

  const vr = { top: 300, bot: 800 };
  const cells = [

    { key: 'topClipped', idx: 0, bad: false, rect: { top: 275, bottom: 397, left: 0, width: 170, height: 122 }, frameRect: { top: 275, bottom: 379, left: 0, width: 170, height: 104 } },

    { key: 'clean1', idx: 1, bad: false, rect: { top: 400, bottom: 522, left: 0, width: 170, height: 122 }, frameRect: { top: 400, bottom: 504, left: 0, width: 170, height: 104 } },
    { key: 'clean2', idx: 2, bad: false, rect: { top: 530, bottom: 652, left: 0, width: 170, height: 122 }, frameRect: { top: 530, bottom: 634, left: 0, width: 170, height: 104 } },
  ];

  const picked = C.pickLiveKeys(cells, vr, 6);
  assert.deepEqual(picked, ['clean1', 'clean2']);
  assert.equal(picked.includes('topClipped'), false, 'kartu terpotong di atas tidak boleh mendapat slot Live');
});

test('pickLiveKeys: saat user scroll ke dasar (atBottom), kartu terbawah diprioritaskan mendapat slot LIVE', () => {
  const mkRow = (rowIdx, top, colCount = 2) => {
    const out = [];
    for (let c = 0; c < colCount; c++) {
      const idx = rowIdx * colCount + c;
      const rect = { top, bottom: top + 122, left: c * 188, width: 187, height: 122 };
      const frameRect = { top, bottom: top + 104, left: c * 188, width: 187, height: 104 };
      out.push({ key: 'c' + idx, idx, rect, frameRect, bad: false });
    }
    return out;
  };

  const vrBottom = { top: 300, bot: 800, atBottom: true };
  const cells = [
    ...mkRow(0, 320),
    ...mkRow(1, 440),
    ...mkRow(2, 560),
    ...mkRow(3, 680),
    ...mkRow(4, 740),
  ];

  const picked = C.pickLiveKeys(cells, vrBottom, 6);
  assert.equal(picked.includes('c8'), true, 'kartu c8 di baris terbawah harus dapat slot LIVE');
  assert.equal(picked.includes('c9'), true, 'kartu c9 di baris terbawah harus dapat slot LIVE');
  assert.equal(picked.includes('c6'), true, 'kartu c6 harus dapat slot LIVE');
  assert.equal(picked.includes('c7'), true, 'kartu c7 harus dapat slot LIVE');
});

test('pickLiveKeys: skenario Serpong Balaraja 3-kolom saat scroll mentok bawah tetap memprioritaskan baris terbawah meski bad=true atau span 2', () => {
  const vrBottom = { top: 316, bot: 860, atBottom: true, scrollDir: 'down' };
  const mk = (key, idx, top, h, fH, left, bad = false, w = 165) => ({
    key,
    idx,
    bad,
    rect: { top, bottom: top + h, left, width: w, height: h },
    frameRect: { top, bottom: top + fH, left, width: w, height: fH },
  });
  const cells = [

    mk('16+650 A', 0, 250, 110, 93, 0, false),
    mk('16+650 B', 1, 250, 110, 93, 166, false),
    mk('17+150 A', 2, 250, 110, 93, 332, false),

    mk('18+150 A', 3, 341, 110, 93, 0, false),
    mk('18+150 B', 4, 341, 110, 93, 166, false),
    mk('19+600 A', 5, 341, 110, 93, 332, false),

    mk('19+600 B', 6, 452, 110, 93, 0, false),
    mk('GT BSD Barat 1', 7, 452, 110, 93, 166, false),
    mk('GT BSD Timur 1', 8, 452, 110, 93, 332, false),

    mk('Jalan Akses On Ramp BSD Timur', 9, 563, 110, 93, 0, true),
    mk('17+150 B', 10, 563, 110, 93, 166, true),
    mk('17+700 B', 11, 563, 110, 93, 332, true),

    mk('18+700 A', 12, 674, 204, 187, 0, true, 331),
    mk('18+700 B', 13, 674, 204, 93, 332, true, 165),
  ];

  const top6 = C.pickLiveKeys(cells, vrBottom, 6);
  assert.deepEqual(top6.slice(0, 5), [
    '18+700 A',
    '18+700 B',
    'Jalan Akses On Ramp BSD Timur',
    '17+150 B',
    '17+700 B',
  ]);

  const top12 = C.pickLiveKeys(cells, vrBottom, 12);
  assert.equal(top12.length, 11);
  assert.equal(top12.includes('16+650 A'), false);
  assert.equal(top12.includes('18+700 A'), true);
  assert.equal(top12.includes('18+700 B'), true);
});

test('River and flood monitoring cameras: Kali Ciliwung, BKB, Cengkareng Drain & Cisadane are defined and proxy-allowed', () => {
  const fs = require('fs');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const m = html.match(/<script type="application\/json" id="cam-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'cam-data script tag must exist');
  const cams = JSON.parse(m[1]);

  const riverCams = cams.filter(c => c.c === 'Pantau Banjir & Kali');
  assert.ok(riverCams.length >= 20, 'Must have at least 20 flood / river monitoring cameras');

  const ciliwung = riverCams.find(c => c.n.includes('Bidara Cina'));
  assert.ok(ciliwung, 'Bidara Cina (Kali Ciliwung) must exist');
  assert.ok(ciliwung.s.includes('jakcctv.jakarta.go.id'), 'Must use active JakCCTV stream');
  assert.ok(Number.isFinite(ciliwung.la) && Number.isFinite(ciliwung.lo), 'Coordinates must be valid');

  const sarakan = riverCams.find(c => c.n.includes('Sarakan'));
  assert.ok(sarakan, 'Pintu Air Sarakan (Cirarab) must exist in flood category');
  assert.ok(sarakan.s.includes('dpuprkotang.info'), 'Must stream from dpuprkotang.info');
  assert.ok(sarakan.snap && sarakan.snap.includes('dpuprkotang.info'), 'Must have direct snapshot URL');

  const sabi = riverCams.find(c => c.n.includes('Kali Sabi') || c.n.includes('Pondok Arum'));
  assert.ok(sabi, 'Kali Sabi / Pondok Arum must exist in flood category');

  const alamanda = riverCams.find(c => c.n.includes('Alamanda'));
  assert.ok(alamanda, 'Jembatan Alamanda (Kali Ledug) must exist in flood category');

  const bkb = cams.filter(c => /Bendungan Hilir/i.test(c.n) && c.c === 'Jakarta Pusat');
  assert.ok(bkb.length >= 2, 'Bendungan Hilir relocated to Jakarta Pusat');
  assert.equal(bkb.some(c => c.flood === true), false, 'Street Bendungan Hilir cams must not stay tagged flood:true');

  const drain = cams.find(c => c.n === 'Cengkareng Barat — Sudut 1' && c.c === 'Jakarta Barat');
  assert.ok(drain && !drain.flood, 'Cengkareng Barat Sudut 1 relocated to Jakarta Barat without flood flag');
  assert.equal(cams.some(c => c.n === 'Cengkareng Barat — Sudut 2'), false, 'Broken downward sidewalk cam Cengkareng Barat Sudut 2 must be removed');

  const cisadane = cams.find(c => c.n.includes('Jembatan Cisadane') && c.c === 'Tangerang');
  assert.ok(cisadane && !cisadane.flood, 'Jembatan Cisadane relocated to Tangerang without flood flag');

  const cikoko = cams.find(c => c.n === 'Jembatan MT Haryono / Cikoko (Tebet) — Sudut 3' && c.c === 'Jakarta Selatan');
  assert.ok(cikoko && !cikoko.flood, 'Cikoko / MT Haryono Sudut 3 relocated to Jakarta Selatan without flood flag');
  assert.equal(cams.some(c => /Cikoko-006-705651_(?:1|2)\b/.test(c.s)), false, 'Broken downward sidewalk cams Cikoko Sudut 1 and 2 must be removed');

  assert.equal(/\/Kali\|Pintu Air\|Bendungan\|Drain\/i\.test\(c\.n\)/.test(html), false, 'Map cam classification must use camIsFlood instead of naive name regex matching street names');

  assert.notEqual(C.streamKey(sarakan.s), C.streamKey(sabi.s), 'dpuprkotang.info cameras must have distinct streamKey per ?src=');
  const kotangCams = riverCams.filter(c => c.s.includes('dpuprkotang.info'));
  assert.equal(C.dedupe(kotangCams).length, kotangCams.length, 'dedupe must not collapse dpuprkotang.info cameras');

  const mp4Steps = C.playSteps(sarakan, u => '/hls?u=' + encodeURIComponent(u));
  assert.deepEqual(mp4Steps, [{ url: sarakan.s, via: 'direct' }], 'progressive .mp4 stream must not route through /hls proxy or .m3u8 variants');

  assert.equal(html.includes('onclick="openLightbox('), false, 'camPopup must not use inline onclick attribute');
  assert.ok(html.includes('data-cam-open="${esc(c.s)}"'), 'camPopup must use data-cam-open delegation');
  assert.ok(html.includes('id="glb-snap"'), 'lightbox must include #glb-snap fallback image element');
  assert.ok(html.includes('p.snapProxy = true'), 'showSnap must fall back to backend /api/cctv/snap proxy when direct snapshot fails');
  assert.ok(html.includes('p.snapMode = true') && html.includes("badge(cell, 'live', 'Live')"), 'kill(cell) must preserve live mode when camera has working c.snap');
});

test('gateway snap: serves direct JPEG snapshots for dpuprkotang.info without requiring ffmpeg and isolates cache per src', async () => {
  const { EventEmitter } = require('events');
  const calls = [];
  const fakeJpegA = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x41)]);
  const fakeJpegB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x42)]);
  const gw = createGateway({
    ffmpeg: '/nonexistent/ffmpeg-binary',
    hostAllowed: u => /(^|\.)dpuprkotang\.info$/i.test(new URL(u).hostname),
    headersFor: () => ({ 'user-agent': 'test' }),
    rewriteUrl: async u => u,
    px: u => '/hls?u=' + encodeURIComponent(u),
    getRaw: async u => {
      calls.push(u);
      const src = new URL(u).searchParams.get('src');
      const payload = src === 'Sarakan' ? fakeJpegA : fakeJpegB;
      return {
        url: u,
        r: {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'image/jpeg']]),
          arrayBuffer: async () => payload,
        },
      };
    },
  });

  const runSnap = url => new Promise(resolve => {
    const req = new EventEmitter();
    req.headers = {};
    req.socket = { remoteAddress: '127.0.0.1' };
    const chunks = [];
    const res = new EventEmitter();
    res.status = 0;
    res.hdrs = {};
    res.writeHead = (code, h) => { res.status = code; res.hdrs = h || {}; };
    res.write = b => { chunks.push(Buffer.from(b)); return true; };
    res.end = b => { if (b) chunks.push(Buffer.from(b)); res.writableEnded = true; resolve({ status: res.status, hdrs: res.hdrs, body: Buffer.concat(chunks) }); };
    gw.snap(url, req, res);
  });

  const r1 = await runSnap('https://cctv.dpuprkotang.info/api/frame.jpeg?src=Sarakan&t=100');
  assert.equal(r1.status, 200);
  assert.equal(r1.hdrs['content-type'], 'image/jpeg');
  assert.deepEqual(r1.body, fakeJpegA);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://cctv.dpuprkotang.info/api/frame.jpeg?src=Sarakan');

  const r2 = await runSnap('https://cctv.dpuprkotang.info/api/stream.mp4?src=Sarakan&t=101');
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, fakeJpegA);
  assert.equal(calls.length, 1, 'cache-buster t= and stream.mp4 rewrite for same src=Sarakan must hit snapshot cache');

  const r3 = await runSnap('https://cctv.dpuprkotang.info/api/frame.jpeg?src=Alamanda&t=101');
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.body, fakeJpegB);
  assert.equal(calls.length, 2, 'different src=Alamanda must not collide with src=Sarakan');
});

test('cctv client pump re-entrancy lock and snapMode loop prevention', () => {
  const cctvSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'scripts', '07-cctv.js'), 'utf8');
  assert.ok(cctvSrc.includes('let inPump = false;'), 'must declare inPump re-entrancy lock');
  assert.ok(cctvSrc.includes('if (inPump) { pumpSoon(); return; }'), 'must exit pump early when already inside pump frame');
  assert.ok(!/if\s*\(c\s*&&\s*isDirectSnapFeed[^\}]*pump\(\);/.test(cctvSrc), 'startCell direct snap branch must never call pump() synchronously');
  assert.ok(cctvSrc.includes('(p.h || p.snapMode) && p.loaded && !p.stopped'), 'pump must account for p.snapMode playing state');
  assert.ok(cctvSrc.includes('if (!p.vis || ((p.h || p.snapMode) && !(p.stopped && !p.loaded))) continue;'), 'pump candidates filter must not repeatedly queue loaded snapMode feeds');
  const snapFnMatch = cctvSrc.match(/const isDirectSnapFeed = [\s\S]*?\n\};/);
  assert.ok(snapFnMatch && !snapFnMatch[0].includes('dpuprkotang'), 'isDirectSnapFeed must not blacklist dpuprkotang.info MP4 streams from video playback');
  assert.ok(cctvSrc.includes('glbMp4Timer = setTimeout(failMp4, 8000)'), 'lightbox MP4 playback must arm timeout fallback');
  assert.ok(cctvSrc.includes('if (glbEmbed && ifr && !isDirectSnapFeed(glbUrl))'), 'glbFallbackEmbed must prioritize live embed player over static snapshot');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('.glb video,.glb img,.glb iframe{') && html.includes('aspect-ratio:16/9'), 'lightbox video, snap, and iframe must share unified 16:9 box dimensions');
  assert.ok(!html.includes('id="glb-frame" allow="autoplay; fullscreen" style="display:none;width:100%;height:100%'), 'lightbox iframe must not force 100% fullscreen sizing');
  assert.ok(cctvSrc.includes('function enterSnapFallback(cell, p)'), 'must share enterSnapFallback helper across video/HLS fallbacks');
  assert.ok(cctvSrc.includes('p.snapTimer = setTimeout(') && cctvSrc.includes('im.naturalWidth <= 0'), 'showSnap must enforce snapshot load timeout and naturalWidth check before marking Live');
  assert.ok(cctvSrc.includes('glbSnapLoadTimer = setTimeout(') && cctvSrc.includes("isKotang && glbSnapState === 'fail'"), 'lightbox must enforce snapshot timeout and surface offline banner when dpuprkotang video+snap both fail');
  assert.ok(html.includes('id="glb-err"') && html.includes('.glb .glb-err{'), 'lightbox must include #glb-err offline panel sharing 16:9 box dimensions');
});

test('gateway & safeFetch: retries transient ECONNRESET/TLS socket drops once before surfacing 502', async () => {
  let gwTries = 0;
  await withGateway({
    getRaw: async u => {
      gwTries++;
      if (gwTries === 1) {
        const err = new Error('Client network socket disconnected before secure TLS connection was established');
        err.code = 'ECONNRESET';
        throw err;
      }
      return {
        r: {
          ok: true,
          status: 200,
          headers: { get: k => /content-type/i.test(k) ? 'application/vnd.apple.mpegurl' : null },
          body: new ReadableStream({ start(c) { c.enqueue(Buffer.from('#EXTM3U\n#EXTINF:4,\nseg1.ts\n')); c.close(); } })
        },
        url: u
      };
    }
  }, async ({ hit }) => {
    const res = await hit('https://cam.example/tracks-v1/mono.ts.m3u8');
    assert.equal(res.status, 200);
    assert.equal(gwTries, 2);
  });
});

test('adaptive grid priority: camTier, camOrderValue, health-aware pickLiveKeys, offline toggle, and real probe', () => {
  const now = 100000;
  assert.equal(C.camTier({ playing: true, loaded: true, waitT: 0, rest: 0 }, now), 0);
  assert.equal(C.camTier({ snapMode: true, snapOk: true, playing: false }, now), 1);
  assert.equal(C.camTier({ loaded: false, dead: false }, now), 2);
  assert.equal(C.camTier({ playing: false, loaded: true, waitT: now - 4000 }, now), 3);
  assert.equal(C.camTier({ playing: false, loaded: true, stopped: true, waitT: now - 4000 }, now), 0);
  assert.equal(C.camTier({ loaded: true, rest: 2 }, now), 3);
  assert.equal(C.camTier({ dead: true, snapMode: false }, now), 4);

  const ordLiveHighIdx = C.camOrderValue({ playing: true, loaded: true, idx: 63 }, 63, now);
  const ordSnapMidIdx = C.camOrderValue({ snapMode: true, snapOk: true, idx: 12 }, 12, now);
  const ordQueueTopIdx = C.camOrderValue({ idx: 2 }, 2, now);
  const ordBuf = C.camOrderValue({ loaded: true, rest: 2, idx: 0 }, 0, now);
  const ordOff = C.camOrderValue({ dead: true, idx: 1 }, 1, now);
  assert.ok(ordQueueTopIdx < ordSnapMidIdx && ordSnapMidIdx < ordLiveHighIdx, 'healthy streams (queue/snap/live) must preserve catalog idx order across tab switches');
  assert.ok(ordLiveHighIdx < ordBuf && ordBuf < ordOff, 'buffering and offline streams must still demote behind healthy cameras');

  const vr = { top: 0, bot: 600, atBottom: false };
  const cands = [
    { key: 'buf-top', idx: 0, bad: false, health: 2, rect: { top: 20, bottom: 120, left: 0, width: 160, height: 100 }, frameRect: { top: 20, bottom: 110, left: 0, width: 160, height: 90 } },
    { key: 'healthy-mid', idx: 1, bad: false, health: 0, rect: { top: 140, bottom: 240, left: 0, width: 160, height: 100 }, frameRect: { top: 140, bottom: 230, left: 0, width: 160, height: 90 } },
  ];
  assert.deepEqual(C.pickLiveKeys(cands, vr, 1), ['healthy-mid'], 'healthy candidate must outrank buffering candidate when LIVE_CAP is tight');

  const cctvSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'scripts', '07-cctv.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="cam-off-tog"'), 'must render #cam-off-tog offline inspector toggle button');
  assert.ok(html.includes('class="tools cam-tools"'), 'must embed CCTV offline toggle flush inside .tools.cam-tools bar');
  assert.ok(html.includes('.cam-off-btn[hidden]{display:none !important}') && html.includes('border:0;border-radius:0;') && html.includes('clip-path:polygon(var(--cant) 0, 100% 0, 100% 100%, 0 100%)'), 'must render .cam-off-btn as flush right-corner diagonal blade with zero border-radius');
  assert.ok(html.includes('.camgrid.show-offline .cam.is-offline'), 'must allow toggling .is-offline visibility via .show-offline');
  assert.ok(!cctvSrc.includes("mode: 'no-cors'"), 'offline probe must never use fake no-cors fetch reviver');
  assert.ok(cctvSrc.includes('function probeOfflineCell(cell)') && cctvSrc.includes("camGrid.matches(':hover')"), 'must validate offline revival and defer grid reorder while hovering');
  assert.ok(!cctvSrc.includes("district === 'Semua' && aliveMap"), 'aliveMap offline filter must apply across all city tabs when offline toggle is off');
});

test('progressive cctv catalog cold start, memoization, disk persistence, and tab lifecycle guards', async () => {
  const os = require('os');
  const { createCctvCatalog } = require('../src/cctv-catalog');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitrep-cctv-cat-'));
  try {
    const cache = new Map();
    const bodyCache = new Map();
    const memo = (key, ttl, fn, okFn) => {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.v);
      return Promise.resolve().then(fn).then(v => {
        if (!okFn || okFn(v)) cache.set(key, { at: Date.now(), v });
        return v;
      });
    };
    let hits = { bpjt: 0, bekasi: 0, jogja: 0 };
    const mkDeps = (emptyUpstream) => ({
      fs,
      path,
      HIST_DIR: tmpDir,
      persistHist: true,
      UA: 'sitrep-test/1.0',
      CFG: {},
      GW: { reportedDead: () => false, detectFfmpeg: async () => false },
      cache,
      bodyCache,
      memo,
      mediaGet: async (u) => {
        if (emptyUpstream || /molecool\.id/i.test(u)) return { r: { ok: true, status: 200, url: u } };
        return { r: { ok: true, status: 200, url: u } };
      },
      mediaGetRaw: async () => ({ r: { ok: false, status: 503 } }),
      mediaText: async (r) => {
        if (emptyUpstream) return '';
        const u = r.url || '';
        if (/bpjt\.pu\.go\.id/i.test(u)) {
          hits.bpjt++;
          return 'const allStreams = {"ruas":[{"streamhls":"https://bpjt.pu.go.id/cam1/index.m3u8","status":"online","lat":-6.21,"lon":106.85,"nama_km":"KM 10","nama_ruas":"Jagorawi"}]};\n';
        }
        if (/bekasikota\.go\.id/i.test(u)) {
          hits.bekasi++;
          return JSON.stringify([{ name: 'Simpang_Kayuringin', path: 'kayuringin/index.m3u8' }]);
        }
        if (/jogjakota\.go\.id/i.test(u)) {
          hits.jogja++;
          return JSON.stringify([{ cctv_title: 'Malioboro', cctv_link: 'https://cctv.jogjakota.go.id/malio/index.m3u8', cctv_latitude: -7.79, cctv_longitude: 110.36 }]);
        }
        return '';
      },
      mediaBody: async () => Buffer.alloc(0),
      rdAssertPublic: async () => {},
      cctvFirecrawl: async () => '',
      camList: () => [],
      cctvKnown: new Set(),
      catalogHostAdd: () => {},
      isDraining: () => false,
    });

    const cat1 = createCctvCatalog(mkDeps(false));
    const r1 = await cat1.cctvCatalog();
    assert.equal(r1.ok, true);
    assert.ok(r1.cams.some(c => c.s.includes('bpjt.pu.go.id')), 'cold start must include unprobed BPJT streams when <24 alive');
    assert.ok(r1.cams.some(c => c.s.includes('jogjakota.go.id')), 'cold start must include unprobed Jogja streams when <24 alive');
    assert.ok(r1.cams.some(c => c.s.includes('bekasikota.go.id')), 'cold start must include Bekasi streams');
    const prevHits = { ...hits };
    await cat1.cctvCatalog();
    assert.equal(hits.bekasi, prevHits.bekasi, 'cctvBekasi must be memoized across catalog builds');
    assert.equal(hits.jogja, prevHits.jogja, 'cctvJogja must be memoized across catalog builds');
    cat1.saveCctvHist(true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'cctv-history.json')), 'saveCctvHist(true) must persist cctv-history.json');

    cache.clear();
    const cat2 = createCctvCatalog(mkDeps(true));
    const r2 = await cat2.cctvCatalog();
    assert.equal(r2.cams.length, r1.cams.length, 'second boot with failing upstream must fall back to persisted cctv-history.json');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const cctvSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'scripts', '07-cctv.js'), 'utf8');
  assert.ok(cctvSrc.includes("const stillWarm = Boolean(d && (d.warming || !list.length || (d.probing && list.length < 24)));"), 'pullCctv must treat probing with >=24 cameras as hydrated');
  assert.ok(cctvSrc.includes('clearTimeout(tvLoadT); tvLoadT = null;'), 'visibilitychange hidden handler must clear active TV load timer');
  assert.ok(cctvSrc.includes("if ((tvSt === 'load' && (!tvLoadT || Date.now() - tvLoadAt > 12000)) || (tvSt === 'fail' && !tvRetryT)) tvPlay();"), 'kickCams must avoid cancelling healthy in-flight TV loads and recover stale fail states');
});

test('non-toll regional expansion and multi-tag Pantau Banjir + Tangerang / Jakarta taxonomy', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const m = html.match(/<script type="application\/json" id="cam-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'cam-data script tag must exist');
  const cams = JSON.parse(m[1]);

  const tangerangKab = cams.filter(c => c.sub === 'Kab. Tangerang');
  assert.ok(tangerangKab.length >= 20, 'Must include Kabupaten Tangerang Dishub non-toll cameras');
  assert.ok(tangerangKab.some(c => /Jayanti/i.test(c.n) && c.s.includes('tangerangkab.go.id')), 'Jayanti cam must be included');
  assert.ok(tangerangKab.some(c => /Cisauk/i.test(c.n) && c.snap && c.snap.includes('thumbnail.jpg')), 'Cisauk cam must include snapshot');

  const bali = cams.filter(c => c.c === 'Bali');
  assert.ok(bali.length >= 15, 'Must include verified live Bali Satu Data non-toll cameras');
  assert.ok(bali.every(c => c.d === 0 && c.s.includes('transcode.baliprov.go.id')), 'Bali cameras must route via backend proxy (d:0)');

  const bandung = cams.filter(c => c.c === 'Bandung');
  assert.ok(bandung.length >= 5, 'Must include Kota Bandung non-toll cameras');
  const semarang = cams.filter(c => c.c === 'Semarang');
  assert.ok(semarang.length >= 5, 'Must include Kota Semarang non-toll cameras');

  const jkb = cams.filter(c => c.sub === 'Jakarta Barat' || c.c === 'Jakarta Barat');
  assert.ok(jkb.length >= 10, 'Jakarta Barat must be properly populated');
  const jkp = cams.filter(c => c.sub === 'Jakarta Pusat' || c.c === 'Jakarta Pusat');
  assert.ok(jkp.length >= 30, 'Jakarta Pusat must be properly populated');

  const authSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'scripts', '00-auth-utils.js'), 'utf8');
  const cctvSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'scripts', '07-cctv.js'), 'utf8');
  assert.ok(authSrc.includes('camInDistrict') && authSrc.includes('camPrimaryCity') && authSrc.includes('camIsFlood'), '00-auth-utils must expose multi-tag district helpers');
  assert.ok(cctvSrc.includes('camInDistrict(c, district)') && cctvSrc.includes("isToll(a)"), 'wantList must filter with camInDistrict and sort non-toll ahead of toll');

  const authCtx = {
    window: {},
    document: {
      getElementById: id => id === 'cam-data' ? { textContent: m[1] } : null,
      querySelector: () => null,
    },
  };
  const fn = new Function('window', 'document', authSrc.slice(0, authSrc.indexOf('const $  =')) + '\nreturn { CAMS, camInDistrict, camPrimaryCity, camIsFlood, camSubLabel };');
  const exported = fn(authCtx.window, authCtx.document);
  const sarakan = exported.CAMS.find(c => /Sarakan/i.test(c.n));
  assert.ok(sarakan, 'Sarakan must exist in initialized CAMS');
  assert.equal(exported.camInDistrict(sarakan, 'Pantau Banjir'), true, 'Sarakan must appear in Pantau Banjir tab');
  assert.equal(exported.camInDistrict(sarakan, 'Tangerang'), true, 'Sarakan must ALSO appear in Tangerang tab');
  assert.equal(exported.camSubLabel(sarakan), 'Kota Tangerang', 'Sarakan sub-label must be Kota Tangerang');

  const durenVilla = exported.CAMS.find(c => /Duren Villa/i.test(c.n));
  if (durenVilla) {
    assert.equal(exported.camInDistrict(durenVilla, 'Pantau Banjir'), true, 'New Kota Tangerang river cam must appear in Pantau Banjir');
    assert.equal(exported.camInDistrict(durenVilla, 'Tangerang'), true, 'New Kota Tangerang river cam must appear in Tangerang');
  }

  const { EventEmitter } = require('events');
  const fakeJpegA = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x41)]);
  const fakeJpegB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x42)]);
  const gw = createGateway({
    ffmpeg: '/nonexistent/ffmpeg-binary',
    hostAllowed: u => /(tangerangkab|baliprov)\.go\.id$/i.test(new URL(u).hostname),
    headersFor: () => ({}),
    rewriteUrl: async u => u,
    px: u => u,
    getRaw: async u => ({
      url: u,
      r: {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/jpeg']]),
        arrayBuffer: async () => (u.includes('01aaa') ? fakeJpegA : fakeJpegB),
      },
    }),
  });
  const runSnap = url => new Promise(resolve => {
    const req = new EventEmitter(); req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' };
    const chunks = [];
    const res = new EventEmitter(); res.status = 0; res.hdrs = {};
    res.writeHead = (code, h) => { res.status = code; res.hdrs = h || {}; };
    res.write = b => { chunks.push(Buffer.from(b)); return true; };
    res.end = b => { if (b) chunks.push(Buffer.from(b)); res.writableEnded = true; resolve({ status: res.status, body: Buffer.concat(chunks) }); };
    gw.snap(url, req, res);
  });
  const s1 = await runSnap('https://cctv-dishub.tangerangkab.go.id/storage/video/01aaa/thumbnail.jpg');
  const s2 = await runSnap('https://cctv-dishub.tangerangkab.go.id/storage/video/01bbb/thumbnail.jpg');
  assert.equal(s1.status, 200);
  assert.equal(s2.status, 200);
  assert.notDeepEqual(s1.body, s2.body, 'tangerangkab.go.id snap cache must stay isolated per ULID');
  const gwSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'cctv-gateway.js'), 'utf8');
  assert.ok(gwSrc.includes("return 'tk:'") && gwSrc.includes("return 'bali:'"), 'cctv-gateway must compute distinct canonicalKey for tangerangkab and baliprov');
});

test('JKP Satpol PP Gatot Subroto C11 keeps active CCTV-01, drops dead CCTV-02, and supports middle-dot camera search queries', () => {
  const cams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/client/data/cams.json'), 'utf8'));
  const c11 = cams.filter(c => /502507_JKP_SATPOL-PP_JL\.-JEND\.-GATOT-SUBROTO-C11/i.test(c.s || ''));
  assert.equal(c11.length, 1, 'Only live CCTV-01 must remain for Gatot Subroto C11');
  assert.match(c11[0].s, /_CCTV-01\/index\.m3u8$/);
  const cctvJs = fs.readFileSync(path.join(__dirname, '..', 'src/client/scripts/07-cctv.js'), 'utf8');
  assert.match(cctvJs, /replace\(\/\[·\|\]\+\/g, ' '\)/, 'CCTV search must tokenize middot-separated queries like Name · City');
});
