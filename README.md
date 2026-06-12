# Q1obsessed

Search any journal and instantly see its **real** percentile and rank in every
field it belongs to — from **SCImago SJR** and **Scopus CiteScore**, side by side.

![SJR](https://img.shields.io/badge/SJR-live-5ee0c0) ![Scopus](https://img.shields.io/badge/Scopus%20CiteScore-live-ff7eb6) ![journals](https://img.shields.io/badge/journals-49k-ffd35c)

Two ways to use it:

- **Classic** — a clean, animated dashboard (the default).
- **Arcade** — a game-like edition: journals as collectible rarity cards with
  XP bars, combos, and a VS battle mode. (Switch from the corner button.)

## Two ways it runs

The data is identical; only *how it's served* differs.

| | For | Backend | Hosting |
|---|---|---|---|
| **Live app** (`app/`, `static/`) | local use / a real server | FastAPI + SQLite | any Python host |
| **Static build** (`docs/`) | **GitHub Pages** | none — data baked into JSON, all logic in-browser | free static hosting |

GitHub Pages can't run Python, so `scripts/export_static.py` bakes the database
into static JSON and a small client (`scripts/pages/data.js`) reimplements the
`/api/*` behaviour in the browser. The two UIs are copied verbatim into `docs/`
and run unchanged.

## Quick start (live app)

```bash
cd G:\proj\Q1obsessed
pip install -r requirements.txt
python run.py
```

Open <http://127.0.0.1:8000>. Routes: `/` (Classic), `/arcade/` (Arcade),
`/api/*` (shared backend). Rebuild the DB with `python run.py --rebuild`.

## Build the static site (for GitHub Pages)

```bash
python scripts/export_static.py     # reads q1obsessed.db -> writes docs/
```

`docs/` is the deployable site. To preview it as pure static (no backend):

```bash
cd docs && python -m http.server 8001   # then open http://127.0.0.1:8001/
```

### Publishing on GitHub Pages

Push the repo, then in **Settings → Pages**, set source to **`main` branch /docs
folder**. The site goes live at `https://<user>.github.io/<repo>/`.

## How the numbers are computed

For a journal with metric value *v* in a category of *N* journals:

```
n          = number of journals in the category with metric <= v
percentile = 100 * n / N
rank       = (number of journals with metric > v) + 1     # 1 = best in field
```

This matches the source Colab notebook and how SCImago/Scopus define category
percentiles. Verified e.g. *Bioinformatics* → Computational Mathematics 99.0 pct
(rank 3/207). Each journal's two databases are merged by **ISSN identity**
(union-find), so the same journal's SJR and Scopus metrics appear together while
distinct journals that share a name stay separate.

## Data sources

| Metric | Source | Coverage |
|--------|--------|----------|
| SJR 2025 | SCImago full database (`data/sjr_2025.csv`) | 32,193 sources, 310 fields |
| Scopus CiteScore | Elsevier **Serial Title API**, swept across all ASJC subject codes | 49,504 journals |

Scopus is harvested with `scripts/fetch_scopus_api.py --key <ELSEVIER_APIKEY>`
(a free key from <https://dev.elsevier.com/apikey/manage>). The API key is used
**only at harvest time** and is never stored in the repo or used by the running
site — every value is baked into the local database. Re-harvest yearly when new
CiteScore/SJR data is released, then `python run.py --rebuild` and
`python scripts/export_static.py`.

> The large `data/` folder and the generated `q1obsessed.db` are gitignored
> (the published site in `docs/` is self-contained). Keep them locally to
> refresh the data.

## Project layout

```
Q1obsessed/
├── run.py                     # build (if needed) + serve the live app
├── requirements.txt
├── app/main.py                # FastAPI: /api/search, /journal, /compare, /stats
├── static/
│   ├── classic/               # Classic UI (uses the live /api/*)
│   └── arcade/                # Arcade UI (uses the live /api/*)
├── scripts/
│   ├── build_db.py            # raw data -> q1obsessed.db (SQLite + FTS5)
│   ├── fetch_scopus_api.py    # Scopus CiteScore harvester (Elsevier API)
│   ├── export_static.py       # q1obsessed.db -> docs/ (static GitHub Pages build)
│   ├── pages/data.js          # in-browser /api/* shim for the static build
│   └── verify_*.py            # SJR / Scopus accuracy checks
└── docs/                      # ← generated static site (what GitHub Pages serves)
    ├── classic/  arcade/  data/  data.js  index.html
```
