/* Q1obsessed extension — bundled quartile lookup + index.
 * Loads data/journals.json (records: [c, title, issn, sjrQ, scopusQ, sjrPct, scopusPct])
 * and builds fast indexes for matching Google Scholar venue strings.
 * Exposes window.Q1O.
 */
window.Q1O = (function () {
  'use strict';

  const STOP = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'a', 'an', 'to',
    'de', 'la', 'le', 'les', 'des', 'du', 'el', 'der', 'die', 'das']);

  // Mirror of the site's norm_title().
  function norm(s) {
    return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function sig(n) { return n.split(' ').filter(t => t && !STOP.has(t)); }

  const byNorm = new Map();   // exact normalized title -> record
  const byChar = new Map();   // first significant char -> [records]  (abbrev matching)
  const byIssn = new Map();   // issn code -> record
  let records = null;

  // On a same-name collision, keep the record with more data (both databases).
  function richer(a, b) {
    const sa = (a[3] != null) + (a[4] != null);
    const sb = (b[3] != null) + (b[4] != null);
    return sa >= sb;
  }

  const ready = (async function () {
    const url = chrome.runtime.getURL('data/journals.json');
    records = await fetch(url).then(r => r.json());
    for (const rec of records) {
      const n = norm(rec[1]);
      rec._n = n;
      rec._sig = sig(n);
      if (!byNorm.has(n) || richer(rec, byNorm.get(n))) byNorm.set(n, rec);
      const f = rec._sig.length ? rec._sig[0][0] : (n[0] || '');
      if (f) { if (!byChar.has(f)) byChar.set(f, []); byChar.get(f).push(rec); }
      for (const code of (rec[2] || '').split(',')) {
        if (code && !byIssn.has(code)) byIssn.set(code, rec);
      }
    }
    return records.length;
  })();

  // Per-field detail is fetched on demand from the live site (cluster id = same).
  const SHARD = 1000;
  const DET = 'https://imeewan.github.io/q1obsessed/data/det/';
  const shardCache = new Map();
  async function getDetail(c) {
    const b = Math.floor(c / SHARD);
    if (!shardCache.has(b)) {
      shardCache.set(b, fetch(DET + b + '.json').then(r => r.json()).catch(() => ({})));
    }
    const sh = await shardCache.get(b);
    return sh[c] || null;
  }

  return {
    ready, norm, sig, getDetail,
    get byNorm() { return byNorm; },
    get byChar() { return byChar; },
    get byIssn() { return byIssn; },
  };
})();
