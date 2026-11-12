'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildHtml } = require('../scripts/build-client.js');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'src', 'client');
const TARGET_FILE = path.join(ROOT, 'public', 'index.html');

test('frontend modular source tree integrity and zero-drift build verification', async (t) => {
  await t.test('all expected modular source directories and files exist', () => {
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'head.html')), 'head.html must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'data', 'cams.json')), 'data/cams.json must exist');

    const expectedStyles = [
      '00-tokens.css', '01-header.css', '02-ticker.css', '03-console.css',
      '04-situasi.css', '05-wire.css', '06-cctv.css', '07-social.css',
      '08-map.css', '09-hud.css', '10-tv-foot.css', '11-reader-glb.css',
      '12-responsive.css', '13-toasts.css'
    ];
    for (const s of expectedStyles) {
      assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'styles', s)), `styles/${s} must exist`);
    }

    const expectedDom = [
      '00-sprites.html', '01-header.html', '02-ticker.html',
      '03-console.html', '04-footer.html', '05-lightbox.html'
    ];
    for (const d of expectedDom) {
      assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'dom', d)), `dom/${d} must exist`);
    }

    const expectedScripts = [
      '00-auth-utils.js', '01-globe.js', '02-toasts.js', '03-market.js',
      '04-social.js', '05-wire.js', '06-ticker.js', '07-cctv.js',
      '08-map.js', '09-tv-footer.js', '10-reader.js', '11-boot.js'
    ];
    for (const sc of expectedScripts) {
      assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'scripts', sc)), `scripts/${sc} must exist`);
    }
  });

  await t.test('compiled public/index.html matches src/client/ byte-for-byte', () => {
    const compiled = buildHtml();
    const disk = fs.readFileSync(TARGET_FILE, 'utf8');
    assert.equal(compiled, disk, 'public/index.html must match buildHtml output identically');
  });

  await t.test('scripts/build-client.js CLI --check flag succeeds', () => {
    const scriptPath = path.join(ROOT, 'scripts', 'build-client.js');
    const out = execFileSync(process.execPath, [scriptPath, '--check'], { encoding: 'utf8' });
    assert.ok(out.includes('OK: public/index.html is up to date.'), 'CLI --check must return OK');
  });

  await t.test('src/client and build-client contain zero code comments', () => {
    function walk(dir) {
      let res = [];
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) res = res.concat(walk(full));
        else res.push(full);
      }
      return res;
    }
    const files = walk(CLIENT_DIR).concat([path.join(ROOT, 'scripts', 'build-client.js')]);
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        assert.ok(!line.startsWith('//') && !line.startsWith('/*') && !line.endsWith('*/'),
          `Found forbidden comment in ${path.relative(ROOT, f)} line ${i + 1}: ${line}`);
      }
    }
  });
});
