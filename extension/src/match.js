/* Q1obsessed extension — extract a journal name from a Google Scholar entry and
 * match it to a record. Precision-first: we'd rather show nothing than a wrong
 * quartile. Exposes window.Q1OMatch.
 */
window.Q1OMatch = (function () {
  'use strict';

  // Google Scholar's "gs_a" line looks like:
  //   "F Author, S Author - Journal Name, vol(issue), 2021 - publisher.com"
  // The venue is the segment right after the authors; the journal name is the
  // text before the first comma in that segment.
  function extractVenue(gsaText) {
    if (!gsaText) return null;
    const parts = gsaText.split(/\s[\-‐-―]\s/);   // split on " - " / dashes
    if (parts.length < 2) return null;
    let seg = parts.length >= 3 ? parts.slice(1, parts.length - 1).join(' - ') : parts[1];
    seg = seg.replace(/,\s*\d{4}\b.*$/, '');                // drop ", YEAR ..." onward
    let venue = seg.split(',')[0].trim();                   // journal name before 1st comma
    venue = venue.replace(/\s*\(\d{4}\)\s*$/, '').trim();   // strip trailing "(2021)"
    return venue;
  }

  // Each significant venue token must be a prefix of the journal's token in order,
  // with the same number of significant tokens. Handles "J Mol Struct" ->
  // "Journal of Molecular Structure", "Proc Natl Acad Sci" -> "Proceedings of the
  // National Academy of Sciences", etc.
  function tokenPrefix(venueSig, recSig) {
    if (venueSig.length < 2 || venueSig.length !== recSig.length) return false;
    for (let i = 0; i < venueSig.length; i++) {
      if (!recSig[i].startsWith(venueSig[i])) return false;
    }
    return true;
  }

  function matchVenue(raw) {
    const n = Q1O.norm(raw);
    if (!n || n.length < 3) return null;

    // 1) exact full-name match
    let rec = Q1O.byNorm.get(n);
    if (rec) return rec;
    if (n.startsWith('the ')) { rec = Q1O.byNorm.get(n.slice(4)); if (rec) return rec; }

    // 2) abbreviation match (token-prefix), unique-only to avoid false positives
    const vs = Q1O.sig(n);
    if (vs.length < 2) return null;
    const cands = Q1O.byChar.get(vs[0][0]);
    if (!cands) return null;
    let hit = null;
    for (const r of cands) {
      if (tokenPrefix(vs, r._sig)) {
        if (hit && hit[0] !== r[0]) return null;   // ambiguous -> give up
        hit = r;
      }
    }
    return hit;
  }

  // Convenience: from a raw gs_a string straight to a record.
  function matchEntry(gsaText) {
    const v = extractVenue(gsaText);
    return v ? matchVenue(v) : null;
  }

  return { extractVenue, matchVenue, matchEntry };
})();
