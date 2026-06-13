# Q1obsessed — Project Handoff

_Last updated: 2026-06-13_

A website to search any academic journal and see its **real percentile + rank in
every field**, from **SCImago SJR** and **Scopus CiteScore**, side by side.

---

## 1. Live links

| | |
|---|---|
| **Live site** | https://imeewan.github.io/q1obsessed/ |
| **GitHub repo** | https://github.com/imeewan/q1obsessed (public) |
| **Visitor analytics** | https://q1obsessed.goatcounter.com (GoatCounter code `q1obsessed`) |
| **Support / donations** | https://buymeacoffee.com/imeewanfiv |

Routes: `/` → Classic UI (default), `/arcade/` → Arcade UI, `/classic/` → alias.

---

## 2. What it does

- Search 49,508 journals (typo-tolerant). For a journal, show its **percentile,
  rank, and quartile in every field**, for **both SJR and Scopus**, side by side.
- **Field ranking** — click any category → modal listing every journal in that
  field ranked best→worst, with the searched journal highlighted, an in-field
  filter, and click-to-jump.
- **Compare** up to 5 journals.
- **Two UIs**: *Classic* (elegant dashboard) and *Arcade* (game-like collectible
  cards / VS battles). Switch buttons in each corner.

---

## 3. Architecture (important)

Two ways the same data is served:

| | Folder | Backend | Used for |
|---|---|---|---|
| **Live app** | `app/`, `static/` | FastAPI + SQLite (`q1obsessed.db`) | local dev / data refresh |
| **Static build** | `docs/` | none — data baked to JSON, logic in browser | **GitHub Pages (production)** |

GitHub Pages can't run Python, so `scripts/export_static.py` bakes the database
into `docs/data/` and `scripts/pages/data.js` installs a `fetch` shim that
intercepts `/api/*` and answers from local JSON. Both UIs run unchanged in both
modes. **`docs/` is the deployed site.**

Data baked into `docs/data/`:
- `index.json` — `[title, issn, hasSJR, hasScopus]` per cluster (array idx = cluster id).
- `det/<b>.json` — 50 shards of per-journal detail (1000 clusters each).
- `cat/<src>/<id>.json` + `categories.json` — per-field ranked lists (lazy-loaded on click).
- `stats.json`, `manifest.json`.

Journals are clustered across SJR + Scopus by **ISSN identity (union-find)**; the
cluster id is the universal id used in search results, detail `_id`, and compare
tokens.

---

## 4. How to change / run things

**Run locally (live app):**
```bash
pip install -r requirements.txt
python run.py            # http://127.0.0.1:8000  (--rebuild to rebuild the DB)
```

**Edit the UI** (text, colors, layout): change files in `static/classic/` or
`static/arcade/`, then rebuild the static site and push:
```bash
python scripts/export_static.py
git add -A && git commit -m "..." && git push
```
GitHub Pages rebuilds automatically (~1 min). Preview the static build locally:
`cd docs && python -m http.server 8001`.

**Rebuild the database** (after changing `build_db.py` or new data):
```bash
python scripts/build_db.py        # rewrites q1obsessed.db from data/
python scripts/export_static.py   # then re-bake docs/
```

**Yearly data refresh** (new SJR / CiteScore):
1. Put the new SJR CSV in `data/`.
2. Re-harvest Scopus: `python scripts/fetch_scopus_api.py --key <ELSEVIER_KEY>`
   — must sweep **all** ASJC codes **including the 27 `**00` codes** (1000,1100,…,
   3600), where flagship journals (Nature=1000, Cell=1300, Lancet=2700, ACS
   Omega=1500;1600) are classified. `data/asjc_codes.json` already has all 334.
3. `python scripts/build_db.py` → `python scripts/export_static.py` → commit + push.

---

## 5. How numbers are computed (methodology — revised 2026-06-13)

For a journal with metric value *v* in a category of *N* journals:
- **rank** = (journals with a strictly greater metric) + 1   (1 = best).
- **percentile** = `100 × (lower + 0.5 × ties) / N` — the **mid-rank percentile**,
  the same formula Scopus uses for CiteScore percentile. (Earlier we used an
  inclusive count, which made a Q2 boundary journal read 75.3 and look Q1.)
- **quartile**: top 25% = Q1, etc., **derived from our percentile** so rank,
  percentile, and quartile always agree (0 contradictions).

**Scopus** values come straight from the Elsevier API (official percentile + rank
+ quartile), already self-consistent.

**Important nuance:** for **SJR** we do **not** use SCImago's published `(Qx)`
markers, because those markers are sometimes **internally inconsistent with
SCImago's own SJR ranking** (non-monotonic — e.g. in Signal Processing a higher-SJR
journal is marked Q2 while a lower-SJR one is Q1). We derive the quartile ourselves
instead. This matches scimagojr.com for ~96% of category assignments, including all
well-known journals; the ~4% that differ are exactly the cases where SCImago's badge
contradicts its own ranking. This was a deliberate choice (internal consistency over
matching SCImago's quirky markers).

A journal can legitimately be a **different quartile in each database** — e.g.
*Journal of Molecular Structure* is **Q2 on SJR** (0.648) but **Q1 on Scopus**
(CiteScore 8.4). The header crown names the source ("Q1 in Scopus" / "Q1 in SJR" /
"Q1 journal" if both agree).

---

## 6. Files

```
q1obsessed/
├── run.py                     # build (if needed) + serve the live app
├── requirements.txt
├── HANDOFF.md                 # this file
├── README.md
├── app/main.py                # FastAPI: /api/search,/journal,/compare,/stats,/category
├── static/
│   ├── classic/               # Classic UI (index.html, app.js, styles.css)
│   └── arcade/                # Arcade UI
├── scripts/
│   ├── build_db.py            # raw data -> q1obsessed.db (SQLite + FTS5)
│   ├── fetch_scopus_api.py    # Scopus CiteScore harvester (Elsevier API)
│   ├── export_static.py       # q1obsessed.db -> docs/ (static Pages build)
│   ├── pages/data.js          # in-browser /api/* shim for the static build
│   └── verify_*.py            # SJR / Scopus checks
├── docs/                      # GENERATED static site (what Pages serves)
└── data/  + q1obsessed.db     # gitignored (raw data + DB; kept locally)
```

`data/` (281 MB raw) and `q1obsessed.db` (~42 MB) are **gitignored** — the deployed
`docs/` is self-contained. Keep them locally to refresh data.

---

## 7. Tooling notes (this machine)

- **GitHub CLI**: `C:\Program Files (x86)\GitHub CLI\gh.exe` (not on bash PATH —
  call the full path; authed as `imeewan`). For `gh api` with a leading-slash
  endpoint, prefix `MSYS_NO_PATHCONV=1` or Git Bash mangles the URL.
- `git push` works directly (gh set up the credential helper).
- Headless verification used MS Edge:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --headless=new
  --virtual-time-budget=10000 --dump-dom <url>`.

---

## 8. Security / licensing

- The **Elsevier API key** is used only at harvest time (`fetch_scopus_api.py
  --key …`); it is **never** stored in the repo and the running site never calls
  any API. If a key is ever exposed, regenerate it at dev.elsevier.com.
- **Do not add ads / monetize the redistributed data.** SJR is non-commercial-use
  only, and Scopus CiteScore came from a research API key — ads would likely breach
  SCImago/Elsevier terms. Donations (the coffee button) are the safer route.

---

## 9. Open ideas (none required)

- Field-ranking ("browse the whole field") view in **Arcade** — Classic only now.
- Custom domain (e.g. `q1obsessed.com`) for a cleaner URL.
- An About / methodology page for visitors.
- Optionally name the source in the brief fireworks toast (the crown already does).

---

_Status: complete and stable. Nothing mid-flight._
