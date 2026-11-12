'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVM = require('../src/evmerge');
const SOC = require('../src/social');
const ASSESS = require('../src/assessment');
const FEEDTEXT = require('../src/feedtext');
const MEDIA = require('../src/article-media');
const GEO = require('../src/geocode');
const { createNewsService } = require('../src/news-service');

function createIsolatedNewsEnv(dir) {
  const cache = new Map();
  const bodyCache = new Map();
  const makeSem = (limit) => {
    let busy = 0;
    const q = [];
    const run = fn => new Promise((res, rej) => {
      const exec = () => {
        busy++;
        Promise.resolve().then(fn).then(res, rej).finally(() => {
          busy--;
          if (q.length) q.shift()();
        });
      };
      if (busy < limit) exec();
      else q.push(exec);
    });
    return run;
  };
  const memo = (key, ttl, fn, okFn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.v);
    const p = Promise.resolve().then(fn).then(v => {
      if (!okFn || okFn(v)) cache.set(key, { at: Date.now(), v });
      return v;
    });
    return p;
  };
  const svc = createNewsService({
    fs,
    path,
    HIST_DIR: dir,
    CFG: {},
    SOC,
    ASSESS,
    FEEDTEXT,
    MEDIA,
    GEO,
    EVM,
    PIPELINE_VERSION: 'test-24h',
    assetReuse: () => '',
    cache,
    bodyCache,
    memo,
    makeSem,
    get: async () => ({ ok: false, status: 599, text: async () => '' }),
    sleep: () => Promise.resolve(),
    yieldTick: () => Promise.resolve(),
    registerNewsUrl: () => {},
    recordUpstream: () => {},
    urlToCanon: new Map(),
    mediaCacheGet: () => null,
    persistHist: false,
  });
  return { svc, cache, bodyCache };
}

test('EVM.mergeEvents with retainPrevMs retains <24h events across feed rotation and accumulates sources', () => {
  const now = 1800000000000;
  const oldPin = {
    name: 'Bekasi',
    la: -6.238,
    lo: 106.975,
    prec: 'kab',
    prov: 'Jawa Barat',
    kind: 'fire',
    label: 'Kebakaran',
    title: 'Kebakaran gudang logistik cikarang timur di Bekasi',
    src: 'ANTARA',
    url: 'https://news.example.id/fire-bekasi',
    ts: now - 8 * 3600e3,
    weight: 0.72,
  };
  const merged1 = EVM.mergeEvents([oldPin], [], { now, retainPrevMs: 24 * 3600e3 });
  assert.equal(merged1.length, 1);

  const stalePin = { ...merged1[0], eid: 'eExpired', title: 'Banjir kemarin sore di Demak', ts: now - 25 * 3600e3 };
  const freshPin = {
    name: 'Surabaya',
    la: -7.257,
    lo: 112.752,
    prec: 'kab',
    prov: 'Jawa Timur',
    kind: 'demo',
    label: 'Demo',
    title: 'Unjuk rasa buruh depan balai kota Surabaya',
    src: 'DETIK',
    url: 'https://news.example.id/demo-sby',
    ts: now - 30 * 60e3,
    weight: 0.81,
  };

  // oldPin missing from current `out` must survive carry-forward; stalePin (>24h) must drop
  const merged2 = EVM.mergeEvents([freshPin], [...merged1, stalePin], { now, retainPrevMs: 24 * 3600e3 });
  assert.equal(merged2.length, 2);
  const keptOld = merged2.find(x => x.eid === merged1[0].eid);
  assert.ok(keptOld, 'old <24h incident must remain retained');
  assert.equal(keptOld.carried, true);
  assert.ok(!merged2.some(x => x.eid === 'eExpired'), 'expired >24h incident must be pruned');

  // Re-appearing in a second outlet accumulates unique sources
  const followUp = {
    ...oldPin,
    src: 'KOMPAS',
    url: 'https://kompas.example.id/fire-bekasi-2',
    ts: now - 2 * 3600e3,
  };
  const merged3 = EVM.mergeEvents([freshPin, followUp], merged2, { now, retainPrevMs: 24 * 3600e3 });
  const updatedOld = merged3.find(x => x.eid === merged1[0].eid);
  assert.deepEqual([...updatedOld.sources].sort(), ['ANTARA', 'KOMPAS']);
  assert.equal(updatedOld.n, 2);
});

test('24H incident ledger persists to disk, survives RSS rotation & !s.ok hiccups, and avoids 60-item political starvation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitrep-24h-'));
  try {
    const { svc, cache } = createIsolatedNewsEnv(tmpDir);
    const now = Date.now();
    const fireTs = now - 9 * 3600e3;
    const fireItem = {
      title: 'Kebakaran hebat melanda pasar sentral di Medan',
      url: 'https://news.example.id/medan-pasar-fire',
      ts: fireTs,
      pub: 'Antara',
      desc: 'Api melalap puluhan kios di pasar sentral Medan.',
    };

    const feedId = svc.NEWS[0][0];
    svc.mergeNewsHist(feedId, [fireItem], now, { persist: false });
    for (const [fid] of svc.NEWS) {
      cache.set('n:' + fid, {
        at: now,
        v: { id: fid, ok: true, stale: false, items: fid === feedId ? [{ ...fireItem, src: fid }] : [] },
      });
    }

    const inc1 = await svc.incidents();
    const medan1 = inc1.items.find(x => !x.fixed && /Medan/i.test(x.name));
    assert.ok(medan1, 'Medan fire pin must exist');
    svc.saveIncidentHist(true, { explicit: true });
    assert.ok(fs.existsSync(path.join(tmpDir, 'incident-history.json')), 'incident-history.json must be written');

    // Simulate >200 newer political articles pushing fireItem out of NEWS_FEED_CAP + restart via fresh createNewsService
    const { svc: svcRestarted, cache: cache2 } = createIsolatedNewsEnv(tmpDir);
    const noisePol = Array.from({ length: 120 }, (_, i) => ({
      title: `Rapat paripurna membahas anggaran APBN sektor-${i} di Jakarta`,
      url: `https://news.example.id/pol-${i}`,
      ts: now - (i + 1) * 60000,
      pub: 'Antara',
      desc: 'Pembahasan kebijakan anggaran di DPR.',
      src: feedId,
    }));
    svcRestarted.mergeNewsHist(feedId, noisePol, now, { persist: false });
    // Even simulate transient feed failure (!ok) on feedId!
    for (const [fid] of svcRestarted.NEWS) {
      cache2.set('n:' + fid, {
        at: now,
        v: fid === feedId ? { id: fid, ok: false, err: 'timeout', items: [] } : { id: fid, ok: true, stale: false, items: [] },
      });
    }

    const [inc2, sit2] = await Promise.all([svcRestarted.incidents(), svcRestarted.situation()]);
    const medan2 = inc2.items.find(x => !x.fixed && x.eid === medan1.eid);
    assert.ok(medan2, 'Medan fire must persist across RSS rotation, !s.ok outage, and service restart');
    assert.equal(sit2.located, inc2.total, 'situation().located must remain identical to incidents().total');
    assert.ok(sit2.daily && sit2.daily.total24h === inc2.total, 'situation().daily must expose 24H daily totals');
    assert.ok(sit2.items.some(it => /pasar sentral di Medan/i.test(it.title)),
      'Operational 9h-old Medan fire must stay inside situation().items despite 120 fresher political stories');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
