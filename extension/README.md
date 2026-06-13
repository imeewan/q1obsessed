# Q1obsessed — Journal Quartiles for Google Scholar (Chrome extension)

Shows **SJR** and **Scopus (CiteScore)** quartile badges next to every journal on
Google Scholar. Click a badge for the full per-field ranking. Like excitation.tech,
but with **both** databases.

Powered by the [Q1obsessed](https://imeewan.github.io/q1obsessed/) dataset
(SCImago SJR + Scopus CiteScore, 49,508 journals).

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or Edge: `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Go to [Google Scholar](https://scholar.google.com), search anything — quartile
   badges appear next to each result's title. Click one for the per-field popup.

Use the toolbar icon to toggle badges on/off. To use it on another computer, copy
this folder and load it the same way (or publish it to the Chrome Web Store, which
also syncs it across your signed-in Chrome browsers).

## How it works

- **`data/journals.json`** — a compact lookup bundled in the extension
  (`[clusterId, title, issn, sjrQ, scopusQ, sjrPct, scopusPct]`, ~3.7 MB). Badges
  work offline and instantly. Regenerate it with
  `python scripts/export_extension.py` (reads `docs/data/`, so cluster ids match
  the live site).
- **`src/data.js`** — loads the lookup and builds match indexes.
- **`src/match.js`** — extracts the journal name from a Scholar entry and matches
  it. Exact full-name match first, then a precision-safe token-prefix match for
  abbreviations (e.g. "J Mol Struct" → *Journal of Molecular Structure*). Unmatched
  / ambiguous → no badge (we'd rather show nothing than a wrong quartile).
- **`src/content.js`** — scans search results + author-profile pages, injects the
  badges, and renders the popup. The popup's per-field detail is fetched on demand
  from `https://imeewan.github.io/q1obsessed/data/det/<shard>.json` (same cluster id).
- **`src/ui.css`** — badge + popup styling. **`popup/`** — the toolbar panel.

## Known limitations (v1)

- Abbreviations whose official name has a long trailing suffix can miss (e.g.
  "Proc Natl Acad Sci" → PNAS, whose full name includes "…of the United States of
  America"). A curated abbreviation/ISO-4 map is a planned enhancement.
- Matching is name-based (Scholar doesn't expose ISSN), so rare same-name journals
  resolve to the one with the most data.

## Refreshing the data

When the Q1obsessed dataset is refreshed (yearly), re-run
`python scripts/export_extension.py`, bump `version` in `manifest.json`, and reload
(or re-publish) the extension.
