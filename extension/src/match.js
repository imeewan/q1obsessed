/* Q1obsessed extension — extract a journal name from a Google Scholar entry and
 * match it to a record. Precision-first: we'd rather show nothing than a wrong
 * quartile. Exposes window.Q1OMatch.
 */
window.Q1OMatch = (function () {
  'use strict';

  // Strip the journal name out of a venue string by removing a trailing
  // volume/issue/pages/article tail. Handles both:
  //   search results:  "Journal of Molecular Structure, 1234, 2020"
  //   author profiles: "Acs Omega 4 (16), 16999-17008" / "Methods 230, 147-157"
  //                    "ChemMedChem, e202400447" / "Plos one 18 (5), e0280232"
  function cleanVenue(s) {
    s = (s || '').trim();
    s = s.replace(/\s[\-‐-―]\s[^\-]*$/, '').trim();   // drop a trailing " - publisher"
    // cut at the first comma OR the first " <digit>" (volume), whichever comes first
    const m = s.match(/^(.*?)(?:,|\s)\s*\d/);
    if (m && m[1].replace(/,$/, '').trim().length >= 2) return m[1].replace(/,$/, '').trim();
    return s.replace(/,.*$/, '').trim();
  }

  // Google Scholar "gs_a" search line: "Authors - Venue, vol, year - publisher".
  // Profile venue line has no dashes — just "Venue vol (iss), pages".
  function extractVenue(gsaText) {
    if (!gsaText) return null;
    const parts = gsaText.split(/\s[\-‐-―]\s/);
    let seg;
    if (parts.length >= 3) seg = parts.slice(1, parts.length - 1).join(' - ');
    else if (parts.length === 2) seg = parts[1];
    else seg = parts[0];   // no dashes -> the whole string is the venue
    return cleanVenue(seg);
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

  return { extractVenue, matchVenue, matchEntry, cleanVenue };
})();
