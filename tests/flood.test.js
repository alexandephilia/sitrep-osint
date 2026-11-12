'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGeoSensors } = require('../src/geo-sensors');

function makeSensors(mockGet) {
  const singleFlight = async (cache, ttl, fn) => {
    if (cache.data && Date.now() - cache.at < ttl) return cache.data;
    return fn();
  };
  const cacheFail = (cache, _ttl, fallback) => cache.data || fallback;
  return createGeoSensors({
    crypto,
    UA: 'sitrep-test',
    SEC: {},
    TRUSTED_ROOTS: new Set(),
    get: mockGet,
    mediaGet: mockGet,
    mediaText: async () => '',
    singleFlight,
    cacheFail,
    sleep: async () => {},
    isDraining: () => false,
    isMain: false
  });
}

test('petabencanaFloods filters stale polygons (>48h), computes centroids, and maps report depths', async () => {
  const freshIso = new Date(Date.now() - 3600 * 1000).toISOString();
  const staleIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const sensors = makeSensors(async url => {
    if (url.includes('/floods?')) {
      return {
        json: async () => ({
          result: {
            features: [
              {
                properties: { area_id: 'fresh-1', area_name: 'Kampung Melayu', parent_name: 'Jatinegara', city_name: 'Jakarta Timur', state: 3, last_updated: freshIso },
                geometry: { type: 'Polygon', coordinates: [[[106.86, -6.24], [106.88, -6.24], [106.88, -6.22], [106.86, -6.22], [106.86, -6.24]]] }
              },
              {
                properties: { area_id: 'stale-1', area_name: 'Old Area', state: 4, last_updated: staleIso },
                geometry: { type: 'Polygon', coordinates: [[[106.8, -6.2], [106.82, -6.2], [106.82, -6.18], [106.8, -6.18], [106.8, -6.2]]] }
              }
            ]
          }
        })
      };
    }
    if (url.includes('/reports?')) {
      return {
        json: async () => ({
          result: {
            features: [
              {
                properties: { pkey: 'rep-1', title: 'Banjir Tinggi', text: 'Air masuk rumah', created_at: freshIso, report_data: { flood_depth: 85 }, source: 'grasp' },
                geometry: { type: 'Point', coordinates: [106.85, -6.23] }
              },
              {
                properties: { pkey: 'rep-stale', title: 'Old Report', created_at: staleIso, report_data: { flood_depth: 50 } },
                geometry: { type: 'Point', coordinates: [106.81, -6.21] }
              }
            ]
          }
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  });

  const res = await sensors.petabencanaFloods();
  assert.equal(res.ok, true);
  assert.equal(res.areas.length, 1);
  assert.equal(res.areas[0].id, 'fresh-1');
  assert.equal(res.areas[0].state, 3);
  assert.ok(Math.abs(res.areas[0].lat - (-6.23)) < 1e-6);
  assert.ok(Math.abs(res.areas[0].lon - 106.87) < 1e-6);

  assert.equal(res.reports.length, 1);
  assert.equal(res.reports[0].id, 'rep-1');
  assert.equal(res.reports[0].depth, 85);
  assert.equal(res.reports[0].state, 4);
});

test('disaster() exposes floods telemetry alongside gempa, gunung, and tma', async () => {
  const freshIso = new Date(Date.now() - 1800 * 1000).toISOString();
  const sensors = makeSensors(async url => {
    if (url.includes('autogempa.json') || url.includes('gempaterkini.json')) {
      return { json: async () => ({ Infogempa: { gempa: [] } }) };
    }
    if (url.includes('magma.esdm.go.id')) {
      return { text: async () => '' };
    }
    if (url.includes('pintu_air')) {
      return {
        json: async () => ({
          features: [{
            geometry: { type: 'Point', coordinates: ['106.848', '-6.207'] },
            properties: { id: 1, pintu_air: { id: 1, name: 'Manggarai', sistem_aliran: 'Ciliwung' }, ketinggian: 860, status_siaga: 2 }
          }]
        })
      };
    }
    if (url.includes('/floods?')) {
      return {
        json: async () => ({
          result: {
            features: [{
              properties: { area_id: 'a1', area_name: 'Bidara Cina', state: 3, last_updated: freshIso },
              geometry: { type: 'Polygon', coordinates: [[[106.86, -6.24], [106.87, -6.24], [106.87, -6.23], [106.86, -6.23], [106.86, -6.24]]] }
            }]
          }
        })
      };
    }
    if (url.includes('/reports?')) {
      return { json: async () => ({ result: { features: [] } }) };
    }
    throw new Error('Unexpected URL: ' + url);
  });

  const d = await sensors.disaster();
  assert.equal(d.ok, true);
  assert.ok(d.floods && Array.isArray(d.floods.areas) && Array.isArray(d.floods.reports));
  assert.equal(d.floods.areas.length, 1);
  assert.equal(d.tma.length, 1);
  assert.equal(d.tma[0].siaga, 2);
});

test('frontend flood telemetry, globe auto-focus, toast alert, and legend parity are compiled', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /isCriticalFlood/);
  assert.match(html, /clToastSensorAlert/);
  assert.match(html, /PINTU AIR · /);
  assert.match(html, /GENANGAN BANJIR · PETABENCANA\.ID/);
  assert.match(html, /'Banjir'\}?<\/span><\/span>|'Banjir'<\/span><\/span>|compactSensors \? 'BNJ' : 'Banjir'/);
  assert.match(html, /<symbol id="i-m-flood"/);
  assert.match(html, /data-layer="tma"[^>]*>.*#i-m-flood.*<span>Banjir<\/span>/);
  assert.match(html, /mp-flood-ic/);
});
