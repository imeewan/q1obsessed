/* Q1obsessed extension — scan Google Scholar, inject SJR/Scopus quartile badges,
 * and show a rich per-field popup on click. Visual styling lives in src/ui.css
 * (designed separately); this file owns the structure + behaviour.
 */
(function () {
  'use strict';

  const SITE = 'https://imeewan.github.io/q1obsessed/';
  let enabled = true;

  /* ---------- badge construction ---------- */
  function pill(src, q) {
    const b = document.createElement('span');
    b.className = `q1o-badge q1o-${src.toLowerCase()} ${q ? 'q1o-q' + q : 'q1o-na'}`;
    const s = document.createElement('span'); s.className = 'q1o-src'; s.textContent = src;
    const v = document.createElement('span'); v.className = 'q1o-q'; v.textContent = q ? 'Q' + q : '—';
    b.append(s, v);
    return b;
  }

  function badges(rec) {
    const wrap = document.createElement('span');
    wrap.className = 'q1o-badges';
    wrap.dataset.c = rec[0];
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.title = 'Q1obsessed — click for the full per-field ranking';
    wrap.append(pill('SJR', rec[3]), pill('Scopus', rec[4]));
    const open = (e) => { e.preventDefault(); e.stopPropagation(); openPopup(rec); };
    wrap.addEventListener('click', open);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
    return wrap;
  }

  /* ---------- popup (per-field detail, fetched from the live site) ---------- */
  function qbadge(q) {
    const s = document.createElement('span');
    s.className = 'q1o-qb q1o-q' + (q || 'x');
    s.textContent = q ? 'Q' + q : '—';
    return s;
  }

  function metricColumn(m, src, label) {
    const col = document.createElement('div');
    col.className = 'q1o-col q1o-col-' + src;
    const head = document.createElement('div');
    head.className = 'q1o-col-head';
    head.innerHTML = `<span class="q1o-dot q1o-${src}"></span><b>${label}</b>` +
      (m && m.metric_value != null ? ` <span class="q1o-mv">${(+m.metric_value).toFixed(src === 'sjr' ? 3 : 1)}</span>` : '');
    col.appendChild(head);
    if (!m || !m.categories || !m.categories.length) {
      const e = document.createElement('div'); e.className = 'q1o-empty';
      e.textContent = `No ${label} data`;
      col.appendChild(e);
      return col;
    }
    for (const c of m.categories) {
      const row = document.createElement('div'); row.className = 'q1o-row';
      const name = document.createElement('span'); name.className = 'q1o-cat'; name.textContent = c.category;
      const rank = document.createElement('span'); rank.className = 'q1o-rank';
      rank.textContent = `#${c.rank}${c.total ? '/' + c.total : ''}`;
      const pct = document.createElement('span'); pct.className = 'q1o-pct';
      pct.textContent = (c.percentile != null ? c.percentile.toFixed(1) : '—');
      row.append(qbadge(c.quartile), name, rank, pct);
      col.appendChild(row);
    }
    return col;
  }

  let popupEl = null;
  function closePopup() { if (popupEl) { popupEl.remove(); popupEl = null; document.removeEventListener('keydown', escClose); } }
  function escClose(e) { if (e.key === 'Escape') closePopup(); }

  async function openPopup(rec) {
    closePopup();
    const ov = document.createElement('div');
    ov.className = 'q1o-overlay';
    ov.innerHTML = `
      <div class="q1o-pop" role="dialog" aria-modal="true">
        <div class="q1o-pop-head">
          <div class="q1o-pop-titles">
            <h2 class="q1o-pop-title">${escapeHtml(rec[1])}</h2>
            <div class="q1o-pop-sub"></div>
          </div>
          <button class="q1o-close" aria-label="Close">&times;</button>
        </div>
        <div class="q1o-pop-body"><div class="q1o-loading">Loading field ranking…</div></div>
        <div class="q1o-pop-foot">Data: <b>Q1obsessed</b> · SCImago SJR &amp; Scopus CiteScore</div>
      </div>`;
    document.body.appendChild(ov);
    popupEl = ov;
    ov.querySelector('.q1o-close').addEventListener('click', closePopup);
    ov.addEventListener('click', (e) => { if (e.target === ov) closePopup(); });
    document.addEventListener('keydown', escClose);

    const detail = await Q1O.getDetail(rec[0]).catch(() => null);
    if (!popupEl) return;
    const body = ov.querySelector('.q1o-pop-body');
    if (!detail) {
      body.innerHTML = `<div class="q1o-empty">Couldn't load details (offline?). ` +
        `Quartiles — SJR: ${rec[3] ? 'Q' + rec[3] : '—'}, Scopus: ${rec[4] ? 'Q' + rec[4] : '—'}.</div>`;
      return;
    }
    const sub = [];
    if (detail.publisher) sub.push(escapeHtml(detail.publisher));
    if (detail.issn) sub.push('ISSN ' + detail.issn.split(',').map(c => c.slice(0, 4) + '-' + c.slice(4)).join(', '));
    ov.querySelector('.q1o-pop-sub').textContent = sub.join(' · ');
    body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'q1o-grid';
    grid.appendChild(metricColumn(detail.metrics.sjr, 'sjr', 'SJR'));
    grid.appendChild(metricColumn(detail.metrics.scopus, 'scopus', 'Scopus'));
    body.appendChild(grid);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- scanning Google Scholar ---------- */
  function inject(into, rec) {
    into.appendChild(badges(rec));   // inline, after the title link
  }

  function scanSearchResults(root) {
    for (const r of root.querySelectorAll('.gs_r .gs_ri, .gs_r.gs_ri')) {
      if (r.dataset.q1o) continue;
      const gsa = r.querySelector('.gs_a');
      const title = r.querySelector('.gs_rt');
      if (!gsa || !title) continue;
      r.dataset.q1o = '1';
      const rec = Q1OMatch.matchEntry(gsa.textContent);
      if (rec) inject(title, rec);
    }
  }

  function scanProfile(root) {
    // Author profile: each publication row, venue is the 2nd grey line.
    for (const row of root.querySelectorAll('.gsc_a_tr')) {
      if (row.dataset.q1o) continue;
      const grays = row.querySelectorAll('.gs_gray');
      const titleCell = row.querySelector('.gsc_a_at');
      if (grays.length < 2 || !titleCell) continue;
      row.dataset.q1o = '1';
      const rec = Q1OMatch.matchVenue(Q1OMatch.extractVenue(grays[1].textContent) || grays[1].textContent);
      if (rec) titleCell.parentElement.appendChild(badges(rec));
    }
  }

  function scan() {
    if (!enabled) return;
    scanSearchResults(document);
    scanProfile(document);
  }

  /* ---------- boot ---------- */
  function applyEnabled(on) {
    enabled = on;
    document.documentElement.classList.toggle('q1o-off', !on);
    if (on) Q1O.ready.then(scan);
  }

  function boot() {
    chrome.storage.local.get({ enabled: true }, (s) => {
      applyEnabled(s.enabled !== false);
      Q1O.ready.then(() => {
        let t;
        const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 200); });
        obs.observe(document.body, { childList: true, subtree: true });
      });
    });
    // Live toggle from the toolbar popup, no page reload needed.
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.enabled) applyEnabled(ch.enabled.newValue !== false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
