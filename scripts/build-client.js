'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'src', 'client');
const TARGET_FILE = path.join(ROOT, 'public', 'index.html');

function buildHtml() {
  const headFile = path.join(CLIENT_DIR, 'head.html');
  const headContent = fs.readFileSync(headFile, 'utf8');

  const styleDir = path.join(CLIENT_DIR, 'styles');
  const styleFiles = fs.readdirSync(styleDir).filter(f => f.endsWith('.css')).sort();
  const styles = styleFiles.map(f => fs.readFileSync(path.join(styleDir, f), 'utf8')).join('');

  const domDir = path.join(CLIENT_DIR, 'dom');
  const domFiles = fs.readdirSync(domDir).filter(f => f.endsWith('.html')).sort();
  const dom = domFiles.map(f => fs.readFileSync(path.join(domDir, f), 'utf8')).join('');

  const camsFile = path.join(CLIENT_DIR, 'data', 'cams.json');
  const camsRaw = fs.readFileSync(camsFile, 'utf8');
  const cams = JSON.parse(camsRaw);
  const camScript = `<script type="application/json" id="cam-data">${JSON.stringify(cams)}</script>\n`;

  const scriptDir = path.join(CLIENT_DIR, 'scripts');
  const scriptFiles = fs.readdirSync(scriptDir).filter(f => f.endsWith('.js')).sort();
  const scripts = scriptFiles.map(f => fs.readFileSync(path.join(scriptDir, f), 'utf8')).join('');

  return headContent + '<style>\n' + styles + '</style>\n</head>\n<body>\n\n' + dom + camScript + '<script>\n' + scripts + '</script>\n</body>\n</html>\n';
}

function run() {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isWatch = args.includes('--watch');

  if (isCheck) {
    const compiled = buildHtml();
    const existing = fs.readFileSync(TARGET_FILE, 'utf8');
    if (compiled === existing) {
      process.stdout.write('[build-client] OK: public/index.html is up to date.\n');
      process.exit(0);
    } else {
      process.stderr.write('[build-client] ERROR: public/index.html is out of sync with src/client/!\nRun `node scripts/build-client.js` or `npm run build:client` to re-sync.\n');
      process.exit(1);
    }
  }

  const t0 = performance.now();
  const output = buildHtml();
  fs.writeFileSync(TARGET_FILE, output, 'utf8');
  const dur = (performance.now() - t0).toFixed(1);
  process.stdout.write(`[build-client] Compiled public/index.html (${output.length} bytes in ${dur}ms)\n`);

  if (isWatch) {
    process.stdout.write('[build-client] Watching src/client for changes...\n');
    let timer = null;
    const watcher = fs.watch(CLIENT_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const tStart = performance.now();
          const next = buildHtml();
          fs.writeFileSync(TARGET_FILE, next, 'utf8');
          const elapsed = (performance.now() - tStart).toFixed(1);
          process.stdout.write(`[build-client] Recompiled public/index.html (${next.length} bytes in ${elapsed}ms) [${new Date().toISOString()}]\n`);
        } catch (err) {
          process.stderr.write(`[build-client] Build failed: ${err.message}\n`);
        }
      }, 50);
    });
    process.on('SIGINT', () => {
      watcher.close();
      process.exit(0);
    });
  }
}

if (require.main === module) {
  run();
}

module.exports = { buildHtml };
