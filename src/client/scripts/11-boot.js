const sharePost = async (el, url) => {
  try {
    if (navigator.share) { await navigator.share({ url }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      const old = el.innerHTML;
      el.style.color = '#17bf63';
      setTimeout(() => { el.innerHTML = old; el.style.color = ''; }, 900);
    }
  } catch (err) {  }
};
document.addEventListener('click', e => {
  const sh = e.target.closest('.tw-share, .th-share');
  if (!sh) return;
  const card = sh.closest('.tw[data-url], .th[data-url]');
  const url = card && card.dataset.url;
  if (!url || !/^https?:/i.test(url)) return;
  e.preventDefault(); e.stopPropagation();
  sharePost(sh, url);
});

$$('.pane').forEach(p => {
  const ph = p.querySelector('.ph');
  if (!ph) return;
  ph.addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, textarea, .soc-tabs')) return;
    p.classList.toggle('open');
    if (p.classList.contains('mkt')) paintHeroes();
    if (P.size && (p.contains(camGrid) || matchMedia('(max-width: 820px)').matches)) {
      requestAnimationFrame(() => { if (p.contains(camGrid)) layout(); refreshCamVis(); });
    }
  });
});
const mqMobile = matchMedia('(max-width: 820px)');
let wasMobile = mqMobile.matches;
function applyResponsiveState(forceOpenDefaults){
  const isMobile = mqMobile.matches;
  if (isMobile && (forceOpenDefaults || !document.querySelector('.pane.open'))) {
    const first = $('.pane');
    if (first) first.classList.add('open');

    const soc = $('.pane[aria-label="Social live"]');
    if (soc) soc.classList.add('open');
  }
  wasMobile = isMobile;
  requestAnimationFrame(() => {
    if (typeof paintHeroes === 'function') paintHeroes();
    if (typeof drawGlobe === 'function') drawGlobe(performance.now());
    if (typeof renderGeoTelemetry === 'function') renderGeoTelemetry();
    if (typeof P !== 'undefined' && P.size && typeof layout === 'function') {
      layout();
      refreshCamVis();
    }
    if (typeof mapOpen !== 'undefined' && mapOpen && typeof sizeMap === 'function') {
      sizeMap();
      if (map) map.invalidateSize();
    }
    if (typeof rdFitView === 'function') rdFitView();
    if (typeof clToastSyncMore === 'function') clToastSyncMore();
  });
}
applyResponsiveState(true);
if (mqMobile.addEventListener) {
  mqMobile.addEventListener('change', () => applyResponsiveState(mqMobile.matches && !wasMobile));
}
let _rszSyncT = 0;
addEventListener('resize', () => {
  clearTimeout(_rszSyncT);
  _rszSyncT = setTimeout(() => {
    if (mqMobile.matches !== wasMobile) applyResponsiveState(mqMobile.matches && !wasMobile);
  }, 60);
});

ensureHls().catch(() => {});
if (!tvOn) tvOpen(true);

(async () => {
  await detectApi();
  drawCityBar(); renderCams();
  renderAllQchips();
  renderCatbar();
  sitInitMap();
  paintBreak();

  trackBg(pullDisaster().then(() => drawGlobe(performance.now())).catch(() => {}));
  pullBreaking();
  if (layerOn.peringatan) trackBg(pullAlerts().catch(() => {}));
  refreshAll(false);
})();
