const BREAK_CYCLE = 45;
let breakItems = [], breakSig = '', breakRemain = BREAK_CYCLE, breakBusy = false, breakAt = 0, breakFail = 0;
const TICK_PX_S = 52;
const tickTrack = $('#ticker-track');

function setBreakState(s){
  const el = $('#tk-fetch');
  if (el) el.dataset.state = s;
  $('#tk-state').textContent = s === 'fetch' ? 'Sync' : s === 'fail' ? 'Retry' : 'Fetch';
}
function paintBreak(){
  $('#tk-meta').textContent = '00:' + String(breakRemain).padStart(2, '0');
  const el = $('#tk-fetch');
  if (el) el.style.setProperty('--tk-p', Math.max(0, Math.min(100, Math.round((breakRemain / BREAK_CYCLE) * 100))) + '%');
}

const tkFetchEl = $('#tk-fetch');
tkFetchEl.addEventListener('click', () => { if (!breakBusy) pullBreaking(); });
tkFetchEl.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !breakBusy) { e.preventDefault(); pullBreaking(); }
});
const TK_SIG = { demo:'#i-tk-demo', fire:'#i-tk-fire', flood:'#i-tk-flood', disaster:'#i-tk-disaster',
  insiden:'#i-tk-insiden', siber:'#i-tk-siber', kriminal:'#i-tk-kriminal',
  kesehatan:'#i-tk-kesehatan', ekonomi:'#i-tk-ekonomi', politik:'#i-tk-politik' };
let breakPrev = new Set(), breakSeeded = false;
let tkFreshTimer = 0;
const renderTk = (h, isNew) => {
  const cat = newsCat(h);
  return `<a class="tk${isNew ? ' tk-new' : ''}" data-cat="${esc(cat)}" href="${escUrl(h.url)}" target="_blank" rel="noopener" title="${esc(h.label || CAT_LABEL[cat] || '')}">` +
    `<span class="tk-mk"><svg class="ic tk-sig" aria-hidden="true"><use href="${TK_SIG[cat] || '#i-pin'}"></use></svg></span>` +
    `<span class="tk-time">${esc(h.ts ? wibTime(h.ts) : '')}</span>` +
    `<span class="tk-t">${esc(cleanTitle(deEmoji(h.title || ''), h.pub || h.src))}</span>` +
    `<span class="tk-src">${esc(cleanSrc(h.src, h.pub))}</span>` +
  `</a>`;
};
function buildTicker(force){
  const rail = tickTrack;
  if (!breakItems.length) {
    rail.innerHTML = '<span class="tk tk-empty">Menunggu item breaking…</span>';
    tkSetW = 0;
    breakSig = '';
    return;
  }
  const sig = breakItems.map(h => (h.url || '') + '|' + (h.title || '')).join('~');
  if (!force && sig === breakSig) return;
  breakSig = sig;

  let anchorKey = '', anchorSubX = 0;
  const oldSet = rail.firstElementChild;
  if (oldSet && tkSetW > 0) {
    const normX = ((tkX % tkSetW) + tkSetW) % tkSetW;
    const setRect = oldSet.getBoundingClientRect();
    for (const ch of oldSet.children) {
      if (ch.classList.contains('tk-sep')) continue;
      const r = ch.getBoundingClientRect();
      const left = r.left - setRect.left;
      if (normX >= left && normX < left + r.width) {
        anchorKey = ch.getAttribute('href') || '__LIVE__';
        anchorSubX = normX - left;
        break;
      }
    }
  }

  const fresh = breakSeeded
    ? new Set(breakItems.filter(h => !breakPrev.has(h.url || h.title)).map(h => h.url || h.title))
    : new Set();
  breakPrev = new Set(breakItems.map(h => h.url || h.title));
  breakSeeded = true;

  const freshN = fresh.size;
  const liveChip = '<span class="tk-live"><i></i>LIVE' +
    (freshN ? `<b class="tk-fresh">+${freshN}</b>` : '') + '</span>';

  clearTimeout(tkFreshTimer);
  if (freshN) tkFreshTimer = setTimeout(() => {
    document.querySelectorAll('.tk-fresh').forEach(el => el.remove());
  }, 30000);
  const tkSep = '<span class="tk-sep" aria-hidden="true">///</span>';
  const one = [liveChip, ...breakItems.map(h => renderTk(h, fresh.has(h.url || h.title)))].join(tkSep) + tkSep;
  const vp = $('.tk-vp').clientWidth || innerWidth;
  const estItemW = 280;
  const initRep = Math.max(1, Math.ceil((vp + 240) / Math.max(estItemW, breakItems.length * estItemW)));
  const initHtml = one.repeat(initRep);
  rail.innerHTML = `<div class="tk-set">${initHtml}</div><div class="tk-set">${initHtml}</div>`;
  let setW = rail.firstElementChild.getBoundingClientRect().width;
  if (setW > 0 && setW < vp + 200) {
    const rep = Math.ceil((vp + 200) / setW);
    const repHtml = initHtml.repeat(rep);
    rail.innerHTML = `<div class="tk-set">${repHtml}</div><div class="tk-set">${repHtml}</div>`;
    setW = rail.firstElementChild.getBoundingClientRect().width;
  }
  tkSetW = setW;
  if (setW > 0) {
    let matched = false;
    if (anchorKey) {
      const newSet = rail.firstElementChild;
      const newSetRect = newSet.getBoundingClientRect();
      for (const ch of newSet.children) {
        if (ch.classList.contains('tk-sep')) continue;
        const key = ch.getAttribute('href') || '__LIVE__';
        if (key === anchorKey) {
          const left = ch.getBoundingClientRect().left - newSetRect.left;
          tkX = ((left + anchorSubX) % setW + setW) % setW;
          matched = true;
          break;
        }
      }
    }
    if (!matched) tkX = ((tkX % setW) + setW) % setW;
    tickTrack.style.transform = 'translate3d(' + (-tkX).toFixed(2) + 'px,0,0)';
  }
}

let tkX = 0, tkSetW = 0, tkLast = 0, tkHold = false, tkVel = TICK_PX_S;
function tkFrame(t) {
  const dt = tkLast ? Math.min(t - tkLast, 100) / 1000 : 0;
  tkLast = t;
  if (tkSetW > 0 && breakItems.length) {
    const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    const targetVel = (tkHold || reduce) ? 0 : TICK_PX_S;
    tkVel += (targetVel - tkVel) * Math.min(1, dt * 12);
    if (tkVel > 0.05) tkX += tkVel * dt;
    if (tkX >= tkSetW) tkX %= tkSetW;
    tickTrack.style.transform = 'translate3d(' + (-tkX).toFixed(2) + 'px,0,0)';
  } else tickTrack.style.transform = '';
  requestAnimationFrame(tkFrame);
}
requestAnimationFrame(tkFrame);
{

  const vpEl = $('.tk-vp');
  if (vpEl && matchMedia('(hover:hover)').matches) {
    vpEl.addEventListener('mouseenter', () => { tkHold = true; });
    vpEl.addEventListener('mouseleave', () => { tkHold = false; });
    vpEl.addEventListener('focusin', () => { tkHold = true; });
    vpEl.addEventListener('focusout', e => {
      if (!vpEl.contains(e.relatedTarget)) tkHold = false;
    });
  }
}
if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    if (!breakItems.length) return;
    const set = tickTrack.querySelector('.tk-set');
    if (!set) return;
    const vp = $('.tk-vp').clientWidth || innerWidth;
    if (set.getBoundingClientRect().width < vp + 200) buildTicker(true);
  }).observe($('.tk-vp'));
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (breakItems.length) buildTicker(true); });
async function pullBreaking(){
  if (breakBusy) return;
  breakBusy = true;
  setBreakState('fetch');
  const t0 = Date.now();
  try {
    let items = null, scanned = 0;
    if (API != null) {
      const d = await getJson(API + '/api/breaking', 12000);
      if (d && d.ok) { items = d.items || []; scanned = d.total || 0; }
    }
    if (!items) items = mergedMedia().map(h => {
      const title = cleanTitle(h.title, h.pub);
      const m = { ...h, title };
      const cat = newsCatOf(m);
      return cat ? { ...m, cat, label: CAT_LABEL[cat] } : null;
    }).filter(Boolean).slice(0, 12);
    if (!items.length && breakItems.length) items = breakItems;
    const prev = new Set(breakItems.map(x => x.url));
    const hasNew = breakAt > 0 && items.some(x => !prev.has(x.url));
    breakItems = items;
    breakFail = 0;
    breakAt = Date.now();
    buildTicker();
    if (hasNew) syncGlobeSoon();
    $('#tk-fetch').title = 'Breaking wire · ' + items.length + ' item' +
      (scanned ? ' · ' + scanned + ' headline dipindai' : '') +
      ' · sync ' + wibTime(breakAt) + ' WIB · auto ' + BREAK_CYCLE + 's';
  } catch (e) {
    breakFail++;
    setBreakState('fail');
    $('#tk-fetch').title = 'Gagal ambil breaking: ' + (e.message || e);
  } finally {
    const wait = 420 - (Date.now() - t0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    breakBusy = false;
    if (!breakFail) setBreakState('idle');
    breakRemain = BREAK_CYCLE;
    paintBreak();
  }
}
setInterval(() => {
  if (document.hidden) return;
  if (breakAt) {
    const elapsed = Math.floor((Date.now() - breakAt) / 1000);
    breakRemain = Math.max(0, BREAK_CYCLE - elapsed);
  } else {
    breakRemain = Math.max(0, breakRemain - 1);
  }
  paintBreak();
  if (breakRemain === 0 && !breakBusy) pullBreaking();
}, 1000);

