/* Q1obsessed — static data layer for GitHub Pages.
 *
 * The live site has a FastAPI backend at /api/*. GitHub Pages can't run Python,
 * so this script bakes the same behaviour into the browser: it installs a fetch
 * shim that intercepts any request to "/api/..." and answers it from prebuilt
 * JSON (a compact search index + sharded per-journal detail files). Both the
 * Classic and Arcade UIs then run completely unchanged, with NO server.
 *
 * Load this BEFORE the UI's own app.js.
 */
(function () {
  'use strict';

  // Locate the data/ folder relative to THIS script, so it works under any
  // path prefix (e.g. https://imeewan.github.io/Q1obsessed/).
  const me = (document.currentScript && document.currentScript.src) || '';
  const BASE = me.replace(/[^/]*$/, '');     // directory containing data.js
  const DATA = BASE + 'data/';

  const _fetch = window.fetch ? window.fetch.bind(window) : null;

  let manifest = null, index = null, stats = null, loading = null;
  const shardCache = new Map();

  // Mirror of the Python norm_title() used when the index was built.
  function norm(s) {
    return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  async function ensureLoaded() {
    if (index) return;
    if (!loading) loading = (async () => {
      const [mf, idx, st] = await Promise.all([
        _fetch(DATA + 'manifest.json').then(r => r.json()),
        _fetch(DATA + 'index.json').then(r => r.json()),
        _fetch(DATA + 'stats.json').then(r => r.json()),
      ]);
      manifest = mf; stats = st;
      // index[c] = [title, issn, hasSjr(0/1), hasScopus(0/1)] ; c = cluster id
      index = idx.map((row, c) => ({
        c, title: row[0], issn: row[1], n: norm(row[0]),
        hs: !!row[2], hc: !!row[3],
      }));
    })();
    await loading;
  }

  async function shardFor(c) {
    const b = Math.floor(c / manifest.shard);
    if (!shardCache.has(b)) {
      shardCache.set(b, _fetch(DATA + 'det/' + b + '.json').then(r => r.json()));
    }
    return shardCache.get(b);
  }
  async function detail(c) {
    if (isNaN(c)) return null;
    const sh = await shardFor(c);
    return sh[c] || null;
  }

  // Per-category ranked lists, loaded only when a category is opened.
  let categories = null, catLoading = null;
  const catCache = new Map();
  async function ensureCategories() {
    if (categories) return;
    if (!catLoading) catLoading = _fetch(DATA + 'categories.json')
      .then(r => r.json()).then(m => { categories = m; });
    await catLoading;
  }
  async function catList(source, id) {
    const k = source + '/' + id;
    if (!catCache.has(k)) catCache.set(k,
      _fetch(DATA + 'cat/' + source + '/' + id + '.json').then(r => r.json()));
    return catCache.get(k);
  }

  // ---- search scoring (approximates the server's fuzzy rank) ----
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 99;
    const dp = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
      let prev = dp[0]; dp[0] = j;
      for (let i = 1; i <= m; i++) {
        const tmp = dp[i];
        dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[m];
  }
  function score(q, e) {
    const n = e.n;
    if (n === q) return 1000;
    if (n.startsWith(q)) return 880 - Math.min(80, n.length - q.length);
    if (n.includes(q)) return 700 - Math.min(80, n.indexOf(q));
    const qt = q.split(' '), nt = new Set(n.split(' '));
    let hit = 0; for (const t of qt) if (nt.has(t)) hit++;
    if (hit) return 400 + hit * 40 - Math.abs(n.length - q.length);
    return -1;
  }
  function searchSync(q, limit) {
    const qn = norm(q);
    if (!qn) return [];
    const scored = [];
    for (const e of index) {
      const s = score(qn, e);
      if (s >= 0) scored.push([s, e]);
    }
    if (scored.length < limit) {            // typo fallback: bounded edit distance
      for (const e of index) {
        if (e.n.includes(qn)) continue;
        const d = lev(qn, e.n.slice(0, qn.length + 2));
        if (d <= 2) scored.push([300 - d * 60, e]);
      }
    }
    scored.sort((a, b) => b[0] - a[0]);
    const seen = new Set(), out = [];
    for (const [, e] of scored) {
      if (seen.has(e.c)) continue;
      seen.add(e.c);
      const sources = {};
      if (e.hs) sources.sjr = e.c;
      if (e.hc) sources.scopus = e.c;
      out.push({ title: e.title, title_norm: e.n, issn: e.issn, sources });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---- dispatch a /api/* URL to local data ----
  async function handle(url) {
    await ensureLoaded();
    const u = new URL(url, location.href);
    const ep = (u.pathname.split('/api/')[1] || '').replace(/\/$/, '');
    const qp = u.searchParams;

    if (ep.startsWith('stats')) return stats;

    if (ep.startsWith('search')) {
      const q = qp.get('q') || '';
      const limit = parseInt(qp.get('limit') || '12', 10);
      return { query: q, results: searchSync(q, limit), scopus_loaded: true };
    }
    if (ep.startsWith('journal')) {
      const d = await detail(parseInt(qp.get('id'), 10));
      return d ? Object.assign({ scopus_loaded: true }, d)
               : { error: 'not found', scopus_loaded: true };
    }
    if (ep.startsWith('compare')) {
      const ids = (qp.get('ids') || '').split(',');
      const seen = new Set(), items = [];
      for (const tok of ids) {
        const c = parseInt((tok.split(':')[1] || ''), 10);
        if (isNaN(c) || seen.has(c)) continue;
        seen.add(c);
        const d = await detail(c);
        if (d && d.title) items.push(Object.assign({ scopus_loaded: true }, d));
      }
      return { items, scopus_loaded: true };
    }
    if (ep.startsWith('category')) {
      const source = qp.get('source') === 'scopus' ? 'scopus' : 'sjr';
      const name = qp.get('name') || '';
      await ensureCategories();
      const id = categories[source] ? categories[source][name] : undefined;
      if (id == null) return { category: name, source, total: 0, items: [] };
      const rows = await catList(source, id);
      const items = rows.map(e => ({
        rank: e[0], percentile: e[1], quartile: e[2], value: e[3], id: e[4],
        title: index[e[4]] ? index[e[4]].title : '',
      }));
      return { category: name, source, total: items.length, items };
    }
    return { error: 'unknown endpoint', scopus_loaded: true };
  }

  // ---- install the shim. Always 200 so callers that check res.ok don't throw.
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') !== -1) {
      return handle(url).then(data => new Response(JSON.stringify(data),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return _fetch(input, init);
  };
})();
