/* Q1obsessed — frontend logic (vanilla JS) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (p) => fetch(p).then(r => r.json());

const state = {
  mode: 'search',
  compare: [],          // {key, title, source, id}
  scopusLoaded: false,
  lastResults: [],
};

const QUICK = ['Bioinformatics', 'Nature', 'ACS Omega', 'PLOS ONE',
  'Journal of the American Chemical Society', 'Cell', 'Scientific Reports'];

/* ---------------- background canvas (floating orbs) ---------------- */
(function bg() {
  const c = $('#bg-canvas'), x = c.getContext('2d');
  let orbs = [];
  const COLORS = ['#5ee0c0', '#ff7eb6', '#ffd35c', '#7ad9ff', '#b693ff'];
  function resize() {
    c.width = innerWidth; c.height = innerHeight;
    orbs = Array.from({ length: 6 }, (_, i) => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      r: 140 + Math.random() * 200, c: COLORS[i % COLORS.length],
      dx: (Math.random() - .5) * .25, dy: (Math.random() - .5) * .25,
    }));
  }
  function tick() {
    x.clearRect(0, 0, c.width, c.height);
    for (const o of orbs) {
      o.x += o.dx; o.y += o.dy;
      if (o.x < -o.r || o.x > c.width + o.r) o.dx *= -1;
      if (o.y < -o.r || o.y > c.height + o.r) o.dy *= -1;
      const g = x.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      g.addColorStop(0, o.c + '55'); g.addColorStop(1, o.c + '00');
      x.fillStyle = g; x.beginPath(); x.arc(o.x, o.y, o.r, 0, 7); x.fill();
    }
    requestAnimationFrame(tick);
  }
  addEventListener('resize', resize); resize(); tick();
})();

/* ---------------- tiered fireworks ---------------- */
const TIERS = {
  top5:  { shells: 3, n: 56, rings: 2, colors: ['#ffd35c', '#ff9d2f', '#fff', '#ffe9a8'], spread: 7.0, size: 1.35, gravity: .052, emoji: '🏆', label: 'TOP 5 IN FIELD' },
  top10: { shells: 3, n: 64, rings: 1, colors: ['#ffd35c', '#ff7eb6', '#fff'],            spread: 6.6, size: 1.25, gravity: .054, emoji: '🥇', label: 'TOP 10 IN FIELD' },
  q1:    { shells: 3, n: 58, rings: 1, colors: ['#ffd35c', '#ff9d2f', '#5ee0c0'],         spread: 6.2, size: 1.1, gravity: .055, emoji: '👑', label: 'Q1 JOURNAL' },
  q2:    { shells: 2, n: 48, rings: 1, colors: ['#7ad9ff', '#5ee0c0', '#cfe9ff'],         spread: 5.5, size: 1.0, gravity: .058, emoji: '🌊', label: 'Q2 JOURNAL' },
  q3:    { shells: 2, n: 36, rings: 1, colors: ['#b693ff', '#7ad9ff'],                    spread: 4.9, size: .9,  gravity: .06,  emoji: '✨', label: 'Q3 JOURNAL' },
  q4:    { shells: 1, n: 24, rings: 1, colors: ['#8b93bf', '#9aa3c7'],                    spread: 4.2, size: .82, gravity: .063, emoji: '🎓', label: 'Q4 JOURNAL' },
};

const fireworks = (function () {
  const c = $('#confetti-canvas'), x = c.getContext('2d');
  let parts = [], shells = [], pending = [], frame = 0, running = false;
  function resize() { c.width = innerWidth; c.height = innerHeight; }
  addEventListener('resize', resize); resize();

  function spawnShell(cfg) {
    const ty = innerHeight * (0.18 + Math.random() * 0.22);
    shells.push({ x: innerWidth * (0.25 + Math.random() * 0.5), y: innerHeight + 6, ty,
      vy: -Math.sqrt(innerHeight - ty) * 0.9,
      col: cfg.colors[(Math.random() * cfg.colors.length) | 0], cfg });
  }
  function explode(sx, sy, cfg) {
    for (let ring = 0; ring < (cfg.rings || 1); ring++) {
      const speed = cfg.spread * (ring ? 1 : 0.62);
      for (let i = 0; i < cfg.n; i++) {
        const a = (Math.PI * 2 * i) / cfg.n + (ring ? 0.12 : 0);
        const j = 0.85 + Math.random() * 0.3;
        parts.push({ x: sx, y: sy, vx: Math.cos(a) * speed * j, vy: Math.sin(a) * speed * j,
          g: cfg.gravity, r: (1.5 + Math.random() * 1.7) * cfg.size,
          col: cfg.colors[(Math.random() * cfg.colors.length) | 0],
          life: 1, decay: .013 + Math.random() * .008 });
      }
    }
  }
  function launch(tier) {
    const cfg = TIERS[tier] || TIERS.q4;
    // Schedule shells by frame (NOT setTimeout) so the loop never stops early.
    for (let i = 0; i < cfg.shells; i++) pending.push({ at: frame + i * 13, cfg });
    if (!running) { running = true; requestAnimationFrame(tick); }
  }
  function tick() {
    frame++;
    x.clearRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'lighter';
    pending = pending.filter(p => { if (frame >= p.at) { spawnShell(p.cfg); return false; } return true; });
    shells = shells.filter(s => {
      s.y += s.vy; s.vy += 0.12;
      x.globalAlpha = .85; x.fillStyle = s.col;
      x.beginPath(); x.arc(s.x, s.y, 2, 0, 7); x.fill();
      if (s.vy >= 0 || s.y <= s.ty) { explode(s.x, s.y, s.cfg); return false; }
      return true;
    });
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.vx *= .987; p.vy = p.vy * .987 + p.g; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      x.globalAlpha = Math.max(0, p.life);
      x.fillStyle = p.col; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    if (pending.length || shells.length || parts.length) requestAnimationFrame(tick);
    else { running = false; x.clearRect(0, 0, c.width, c.height); }
  }
  return { launch };
})();

function showTierToast(tier, field) {
  const cfg = TIERS[tier] || TIERS.q4;
  const el = document.createElement('div');
  el.className = 'tier-toast';
  el.innerHTML = `<span class="tier-emoji">${cfg.emoji}</span>
    <div class="tier-label grad">${cfg.label}</div>
    ${field ? `<div class="tier-sub">${esc(field)}</div>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* Decide a journal's celebration tier from its best standing across all fields. */
function standingOf(data) {
  let bestRank = Infinity, bestQ = 4, field = '';
  for (const m of Object.values(data.metrics)) {
    for (const c of (m.categories || [])) {
      if (c.rank && c.rank < bestRank) { bestRank = c.rank; field = c.category; }
      if (c.quartile && c.quartile < bestQ) bestQ = c.quartile;
    }
  }
  let tier = 'q4';
  if (bestRank <= 5) tier = 'top5';
  else if (bestRank <= 10) tier = 'top10';
  else if (bestQ === 1) tier = 'q1';
  else if (bestQ === 2) tier = 'q2';
  else if (bestQ === 3) tier = 'q3';
  return { tier, field };
}

function celebrate(data) {
  const { tier, field } = standingOf(data);
  fireworks.launch(tier);
  showTierToast(tier, field);
}

/* ---------------- helpers ---------------- */
function qClass(q) { return 'q' + (q || 4); }
function fmtIssn(s) { return s ? s.split(',').filter(Boolean).map(c => c.slice(0, 4) + '-' + c.slice(4)).join(', ') : ''; }
function animateNum(el, to, suffix = '') {
  const dur = 900, t0 = performance.now();
  function step(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (to * e).toFixed(1) + suffix;
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------------- search ---------------- */
const input = $('#search-input'), sugg = $('#suggestions'), clearBtn = $('#clear-btn');
const quickRow = $('#quick-row');
let activeIdx = -1, debounce, lastQ = '';

function showSugg(show) {
  sugg.hidden = !show;
  if (quickRow) quickRow.classList.toggle('dim', show);   // avoid overlap/misclicks
}

input.addEventListener('input', () => {
  const q = input.value.trim();
  clearBtn.hidden = !q;
  clearTimeout(debounce);
  if (!q) { showSugg(false); return; }
  debounce = setTimeout(() => doSuggest(q), 140);
});
input.addEventListener('keydown', (e) => {
  const items = $$('.sugg', sugg);
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); paintActive(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); paintActive(items); }
  else if (e.key === 'Enter') {
    if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].click();
    else if (state.lastResults[0]) openFromSuggestion(state.lastResults[0]);
  } else if (e.key === 'Escape') showSugg(false);
});
clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; showSugg(false); input.focus(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) showSugg(false); });

function paintActive(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === activeIdx));
  if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
}

async function doSuggest(q) {
  const data = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=10');
  state.scopusLoaded = data.scopus_loaded;
  state.lastResults = data.results;
  lastQ = q; activeIdx = -1;
  if (!data.results.length) { sugg.innerHTML = `<li class="sugg" style="cursor:default;color:var(--faint)">No journal matches “${esc(q)}”.</li>`; showSugg(true); return; }
  sugg.innerHTML = data.results.map(r => {
    const badges = [];
    if (r.sources.sjr != null) badges.push('<span class="src-dot src-sjr">SJR</span>');
    if (r.sources.scopus != null) badges.push('<span class="src-dot src-scopus">Scopus</span>');
    return `<li class="sugg" data-key="${enc(r.title_norm)}">
      <div><div class="sugg-title">${esc(r.title)}</div>
      ${r.issn ? `<div class="sugg-meta">${fmtIssn(r.issn)}</div>` : ''}</div>
      <div class="sugg-badges">${badges.join('')}</div></li>`;
  }).join('');
  $$('.sugg', sugg).forEach((li, i) => li.addEventListener('click', () => openFromSuggestion(data.results[i])));
  showSugg(true);
}

function openFromSuggestion(r) {
  showSugg(false);
  input.value = r.title;
  clearBtn.hidden = false;
  const src = r.sources.sjr != null ? 'sjr' : 'scopus';
  const id = r.sources.sjr != null ? r.sources.sjr : r.sources.scopus;
  loadJournal(src, id, true);
}

/* ---------------- journal card ---------------- */
const resultsEl = $('#results');

async function loadJournal(source, id, replace) {
  const data = await api(`/api/journal?source=${source}&id=${id}`);
  if (data.error) return;
  state.scopusLoaded = data.scopus_loaded;
  const card = renderCard(data);
  if (replace) resultsEl.innerHTML = '';
  resultsEl.prepend(maybeNotice(data));
  resultsEl.prepend(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // reveal bars + tiered fireworks based on standing
  requestAnimationFrame(() => revealBars(card));
  setTimeout(() => celebrate(data), 320);
}

function cardHasQ1(data) {
  return Object.values(data.metrics).some(m => (m.categories || []).some(c => c.quartile === 1));
}

function maybeNotice(data) {
  const frag = document.createDocumentFragment();
  if (!data.metrics.scopus && !state.scopusLoaded) {
    const n = document.createElement('div');
    n.className = 'notice';
    n.innerHTML = `🔓 Scopus metrics aren't loaded yet. Drop the Scopus “source titles and metrics” file into <code>data/</code> and rebuild — SJR is fully live now.`;
    frag.appendChild(n);
  }
  return frag;
}

function renderCard(data) {
  const card = document.createElement('div');
  card.className = 'jcard';
  const anyQ1 = cardHasQ1(data);
  const sjr = data.metrics.sjr, scopus = data.metrics.scopus;
  const meta = [];
  if (data.publisher) meta.push(`<span><b>${esc(data.publisher)}</b></span>`);
  if (data.issn) meta.push(`<span>ISSN ${fmtIssn(data.issn)}</span>`);
  const ref = sjr || scopus;
  if (ref && ref.country) meta.push(`<span>${esc(ref.country)}</span>`);
  if (ref && ref.coverage) meta.push(`<span>${esc(ref.coverage)}</span>`);

  const key = (sjr ? 'sjr:' + idOf(data, 'sjr') : 'scopus:' + idOf(data, 'scopus'));
  card.dataset.cmpkey = key;

  card.innerHTML = `
    <div class="jcard-head ${anyQ1 ? 'is-q1' : ''}">
      <div>
        <h2 class="jtitle">${esc(data.title)}</h2>
        <div class="jmeta">${meta.join('')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        ${anyQ1 ? '<span class="crown">👑 Q1 journal</span>' : ''}
        <div class="head-actions">
          <button class="icon-btn cmp-add">+ Compare</button>
        </div>
      </div>
    </div>
    <div class="metrics-grid">
      ${metricCol(sjr, 'sjr', 'SJR')}
      ${metricCol(scopus, 'scopus', 'CiteScore')}
    </div>`;

  const addBtn = $('.cmp-add', card);
  addBtn.addEventListener('click', () => {
    addToCompare(data);
    addBtn.textContent = '✓ Added'; addBtn.classList.add('added');
    setTimeout(() => { addBtn.textContent = '+ Compare'; addBtn.classList.remove('added'); }, 1400);
  });
  return card;
}

function idOf(data, src) {
  // backend doesn't echo ids; re-derive via search not needed — store on metrics
  return data.metrics[src] && data.metrics[src]._id != null ? data.metrics[src]._id : '';
}

function metricCol(m, src, label) {
  if (!m) {
    return `<div class="metric-col"><div class="empty-col">
      <div class="lock">🔒</div>
      <div><b>${label}</b> not available for this journal${src === 'scopus' && !state.scopusLoaded ? ' yet' : ''}.</div>
    </div></div>`;
  }
  const rows = m.categories.map((c, i) => {
    const pct = c.percentile.toFixed(1);
    return `<div class="cat-row" style="animation-delay:${i * 60}ms">
      <div class="cat-top">
        <span class="cat-name">${esc(c.category)} <span class="qbadge ${qClass(c.quartile)}">Q${c.quartile}</span></span>
        <span class="cat-rank">#${c.rank}${c.total ? ' / ' + c.total : ''}</span>
      </div>
      <div class="bar"><div class="bar-fill fill-${src}" data-pct="${pct}"></div></div>
      <div style="text-align:right"><span class="cat-pct" style="color:var(--${src})">${pct}<span style="font-size:11px">pct</span></span></div>
    </div>`;
  }).join('');
  const val = m.metric_value != null ? m.metric_value : '—';
  return `<div class="metric-col">
    <div class="metric-head">
      <span class="metric-name"><span class="dot ${src}"></span>${m.metric_name}</span>
      <span class="metric-val"><b>${typeof val === 'number' ? val.toFixed(3) : val}</b>${m.h_index ? ' · h-index ' + Math.round(m.h_index) : ''}</span>
    </div>
    ${rows || '<div class="cat-rank">No category data.</div>'}
  </div>`;
}

function revealBars(scope) {
  $$('.bar-fill', scope).forEach(b => {
    const pct = parseFloat(b.dataset.pct);
    requestAnimationFrame(() => { b.style.width = pct + '%'; });
  });
}

/* ---------------- compare ---------------- */
const dock = $('#compare-dock'), dockItems = $('#dock-items'), dockGo = $('#dock-go');
const compareCount = $('#compare-count');

function addToCompare(data) {
  const src = data.metrics.sjr ? 'sjr' : 'scopus';
  const id = data.metrics[src]._id;
  const key = src + ':' + id;
  if (state.compare.some(c => c.key === key)) return;
  if (state.compare.length >= 5) { flashDock(); return; }
  state.compare.push({ key, title: data.title, source: src, id });
  paintDock();
}
function removeCompare(key) { state.compare = state.compare.filter(c => c.key !== key); paintDock(); }
function flashDock() { dock.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220 }); }

function paintDock() {
  compareCount.textContent = state.compare.length;
  if (!state.compare.length) { dock.hidden = true; return; }
  dock.hidden = false;
  dockItems.innerHTML = state.compare.map(c =>
    `<span class="dock-chip">${esc(c.title.slice(0, 30))}${c.title.length > 30 ? '…' : ''}<button data-k="${enc(c.key)}">×</button></span>`).join('');
  $$('.dock-chip button', dockItems).forEach(b => b.addEventListener('click', () => removeCompare(b.dataset.k)));
  dockGo.disabled = state.compare.length < 2;
}
dockGo.addEventListener('click', () => setMode('compare'));

const compareView = $('#compare-view');
async function renderCompare() {
  if (state.compare.length < 2) {
    compareView.innerHTML = `<div class="cmp-empty">Add at least 2 journals to compare.<br>Search a journal and hit <b>+ Compare</b>.</div>`;
    return;
  }
  const ids = state.compare.map(c => c.source + ':' + c.id).join(',');
  const data = await api('/api/compare?ids=' + encodeURIComponent(ids));
  const cards = data.items.map((d, idx) => {
    const blocks = ['sjr', 'scopus'].map(src => {
      const m = d.metrics[src]; if (!m) return '';
      const top = m.categories[0];
      const avg = m.categories.length ? (m.categories.reduce((s, c) => s + c.percentile, 0) / m.categories.length) : 0;
      const best = m.categories.reduce((a, b) => b.percentile > a.percentile ? b : a, m.categories[0] || { percentile: 0 });
      return `<div class="cmp-metric"><span class="dot ${src}"></span>${m.metric_name} ${m.metric_value != null ? '· ' + (+m.metric_value).toFixed(2) : ''}</div>
        <div class="cmp-stat"><span>Best field</span><span class="v" style="color:var(--${src})">${best ? best.percentile.toFixed(1) + ' pct' : '—'}</span></div>
        <div class="cmp-stat"><span>Avg percentile</span><span class="v">${avg.toFixed(1)}</span></div>
        <div class="cmp-stat"><span>Fields</span><span class="v">${m.categories.length}</span></div>
        ${best ? `<div class="cmp-best"><span class="qbadge ${qClass(best.quartile)}">Q${best.quartile}</span><span style="color:var(--muted)">${esc(best.category)} · #${best.rank}${best.total ? '/' + best.total : ''}</span></div>` : ''}`;
    }).join('');
    return `<div class="cmp-card" style="animation-delay:${idx * 70}ms">
      <h3>${esc(d.title)}</h3>
      <div class="sub">${d.publisher ? esc(d.publisher) : ''}${d.issn ? ' · ' + fmtIssn(d.issn) : ''}</div>
      ${blocks || '<div class="cmp-stat">No metric data.</div>'}
    </div>`;
  }).join('');
  compareView.innerHTML = `
    <h2 class="cmp-head">Head-to-head</h2>
    <p class="cmp-sub">Comparing ${data.items.length} journals across SJR and Scopus.</p>
    <div class="cmp-grid">${cards}</div>`;
}

/* ---------------- modes ---------------- */
function setMode(mode) {
  state.mode = mode;
  $$('.nav-pill[data-mode]').forEach(p => p.classList.toggle('active', p.dataset.mode === mode));
  const search = mode === 'search';
  $('#hero').classList.toggle('hidden', !search);
  resultsEl.classList.toggle('hidden', !search);
  compareView.hidden = search;
  if (!search) renderCompare();
}
$$('.nav-pill[data-mode]').forEach(p => p.addEventListener('click', () => setMode(p.dataset.mode)));

/* ---------------- escaping ---------------- */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function enc(s) { return esc(s); }

/* ---------------- init ---------------- */
(async function init() {
  const qr = $('#quick-row');
  QUICK.forEach(t => {
    const b = document.createElement('span');
    b.className = 'quick-chip'; b.textContent = t;
    b.addEventListener('click', () => { input.value = t; doSuggest(t); input.focus(); });
    qr.appendChild(b);
  });
  paintDock();
  try {
    const s = await api('/api/stats');
    state.scopusLoaded = s.scopus_loaded;
    const total = s.sjr_journals + (s.scopus_journals || 0);
    $('#stats-pill').textContent = (s.sjr_journals).toLocaleString() + ' journals · ' + s.sjr_categories + ' fields';
  } catch (e) { }
})();
