"""
Q1obsessed — backend API.

Serves a typo-tolerant journal search over the prebuilt SQLite database and
returns per-category percentile + rank for both SJR and Scopus metrics.

Run:  uvicorn app.main:app --reload --port 8000      (from G:\\proj\\Q1obsessed)
"""
import os
import re
import sqlite3
import unicodedata

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from rapidfuzz import fuzz, process

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB_PATH = os.path.join(ROOT, "q1obsessed.db")
STATIC_DIR = os.path.join(ROOT, "static")

app = FastAPI(title="Q1obsessed")


@app.middleware("http")
async def no_store(request, call_next):
    """Don't let browsers cache the SPA assets, so edits always show up."""
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    return resp


# --------------------------------------------------------------------------- #
# DB access
# --------------------------------------------------------------------------- #
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def norm_title(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# In-memory title cache for fuzzy ranking (built lazily, fast for ~50k titles).
_CACHE = {"titles": None}


def all_titles():
    if _CACHE["titles"] is None:
        con = db()
        rows = con.execute(
            "SELECT title, title_norm, source, ref_id, issn FROM search_index"
        ).fetchall()
        con.close()
        _CACHE["titles"] = [dict(r) for r in rows]
    return _CACHE["titles"]


def scopus_loaded() -> bool:
    con = db()
    r = con.execute("SELECT value FROM meta WHERE key='scopus_loaded'").fetchone()
    con.close()
    return bool(r and r["value"] == "1")


# --------------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------------- #
def fts_query(q: str):
    """Build a forgiving FTS5 prefix query."""
    toks = [t for t in re.split(r"\s+", norm_title(q)) if t]
    if not toks:
        return None
    return " ".join(f'"{t}"*' for t in toks)


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 12):
    """Typo-tolerant search. FTS prefix first, then rapidfuzz rerank/fallback."""
    qn = norm_title(q)
    # Collect candidates keyed by (source, ref_id) so distinct journals that
    # share a title are never silently dropped.
    candidates = {}

    # 1) Fast FTS prefix match.
    fq = fts_query(q)
    if fq:
        con = db()
        try:
            rows = con.execute(
                "SELECT title, title_norm, source, ref_id, issn FROM search_index "
                "WHERE search_index MATCH ? LIMIT 400", (fq,)).fetchall()
        except sqlite3.OperationalError:
            rows = []
        con.close()
        for r in rows:
            candidates[(r["source"], r["ref_id"])] = dict(r)

    # 2) Fuzzy fallback / enrichment for typos the prefix query misses.
    if len({c["title_norm"] for c in candidates.values()}) < limit:
        pool = all_titles()
        matches = process.extract(
            qn, {i: t["title_norm"] for i, t in enumerate(pool)},
            scorer=fuzz.WRatio, limit=120)
        for _norm, score, idx in matches:
            if score < 60:
                continue
            t = pool[idx]
            candidates.setdefault((t["source"], t["ref_id"]), t)

    out = cluster_candidates(candidates.values(), qn, limit)
    return {"query": q, "results": out, "scopus_loaded": scopus_loaded()}


def _issn_codes(s):
    return [c.strip() for c in (s or "").split(",") if c.strip()]


def cluster_candidates(cands, qn, limit):
    """Group rows into journals by shared ISSN (union-find); a journal with no
    ISSN clusters by normalized title. Same journal's SJR+Scopus rows merge;
    different journals that share a name stay separate."""
    cands = list(cands)
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Union all ISSN codes belonging to the same candidate row.
    for c in cands:
        codes = _issn_codes(c["issn"])
        ckey = "issn:" + codes[0] if codes else "title:" + c["title_norm"]
        c["_ckey"] = ckey
        find(ckey)
        for code in codes:
            union(ckey, "issn:" + code)

    clusters = {}
    for c in cands:
        root = find(c["_ckey"])
        score = fuzz.WRatio(qn, c["title_norm"])
        if c["title_norm"] == qn:
            score += 100
        elif c["title_norm"].startswith(qn):
            score += 40
        g = clusters.setdefault(root, {
            "title": c["title"], "title_norm": c["title_norm"],
            "issn": c["issn"], "sources": {}, "score": 0})
        g["sources"][c["source"]] = c["ref_id"]
        g["score"] = max(g["score"], score)
        if len(c["issn"]) > len(g["issn"]):
            g["issn"] = c["issn"]

    ordered = sorted(clusters.values(), key=lambda g: -g["score"])[:limit]
    return [{"title": g["title"], "title_norm": g["title_norm"],
             "issn": g["issn"], "sources": g["sources"]} for g in ordered]


# --------------------------------------------------------------------------- #
# Journal detail
# --------------------------------------------------------------------------- #
def sjr_detail(con, jid):
    j = con.execute("SELECT * FROM sjr_journal WHERE id=?", (jid,)).fetchone()
    if not j:
        return None
    cats = con.execute(
        "SELECT category,percentile,rank,total,quartile FROM sjr_category "
        "WHERE journal_id=? ORDER BY percentile DESC", (jid,)).fetchall()
    return {
        "source": "sjr", "_id": jid,
        "title": j["title"], "issn": j["issn"], "publisher": j["publisher"],
        "country": j["country"], "type": j["type"], "coverage": j["coverage"],
        "metric_name": "SJR", "metric_value": j["sjr"], "h_index": j["h_index"],
        "best_quartile": j["best_quartile"], "best_percentile": j["best_percentile"],
        "categories": [dict(c) for c in cats],
    }


def scopus_detail(con, jid):
    j = con.execute("SELECT * FROM scopus_journal WHERE id=?", (jid,)).fetchone()
    if not j:
        return None
    cats = con.execute(
        "SELECT category,percentile,rank,total,quartile FROM scopus_category "
        "WHERE journal_id=? ORDER BY percentile DESC", (jid,)).fetchall()
    return {
        "source": "scopus", "_id": jid,
        "title": j["title"], "issn": j["issn"], "publisher": j["publisher"],
        "metric_name": "CiteScore", "metric_value": j["citescore"],
        "best_quartile": j["best_quartile"], "best_percentile": j["best_percentile"],
        "categories": [dict(c) for c in cats],
    }


def find_counterpart(con, table, issn, title_norm):
    """Match a journal across the two databases by ISSN; fall back to title only
    when that title is unambiguous (a single journal of that name)."""
    if issn:
        for code in issn.split(","):
            code = code.strip()
            if not code:
                continue
            r = con.execute(
                f"SELECT id FROM {table} WHERE issn LIKE ?", (f"%{code}%",)).fetchone()
            if r:
                return r["id"]
    # Title fallback: skip if ambiguous, to avoid linking the wrong same-name journal.
    rows = con.execute(
        f"SELECT id FROM {table} WHERE title_norm=?", (title_norm,)).fetchall()
    return rows[0]["id"] if len(rows) == 1 else None


@app.get("/api/journal")
def journal(source: str, id: int):
    con = db()
    primary = sjr_detail(con, id) if source == "sjr" else scopus_detail(con, id)
    if not primary:
        con.close()
        return JSONResponse({"error": "not found"}, status_code=404)

    counterpart = None
    if source == "sjr":
        cid = find_counterpart(con, "scopus_journal", primary["issn"], norm_title(primary["title"]))
        if cid:
            counterpart = scopus_detail(con, cid)
    else:
        cid = find_counterpart(con, "sjr_journal", primary["issn"], norm_title(primary["title"]))
        if cid:
            counterpart = sjr_detail(con, cid)
    con.close()

    metrics = {primary["source"]: primary}
    if counterpart:
        metrics[counterpart["source"]] = counterpart
    return {
        "title": primary["title"],
        "issn": primary["issn"],
        "publisher": primary["publisher"],
        "metrics": metrics,
        "scopus_loaded": scopus_loaded(),
    }


@app.get("/api/compare")
def compare(ids: str = Query(..., description="comma list of source:id, e.g. sjr:42,sjr:7")):
    items = []
    for token in ids.split(","):
        token = token.strip()
        if ":" not in token:
            continue
        src, sid = token.split(":", 1)
        try:
            data = journal(source=src, id=int(sid))
        except Exception:
            continue
        if isinstance(data, dict) and "title" in data:
            items.append(data)
    return {"items": items, "scopus_loaded": scopus_loaded()}


@app.get("/api/stats")
def stats():
    con = db()
    nsjr = con.execute("SELECT COUNT(*) c FROM sjr_journal").fetchone()["c"]
    nsco = con.execute("SELECT COUNT(*) c FROM scopus_journal").fetchone()["c"]
    ncat = con.execute("SELECT COUNT(DISTINCT category) c FROM sjr_category").fetchone()["c"]
    con.close()
    return {"sjr_journals": nsjr, "scopus_journals": nsco,
            "sjr_categories": ncat, "scopus_loaded": scopus_loaded()}


# --------------------------------------------------------------------------- #
# Static frontend — two UI versions behind one API
#   /          -> the original elegant dashboard (default; static/classic/)
#   /classic/  -> same classic UI (explicit alias)
#   /arcade/   -> the game-like UI (static/arcade/)
# Mount order matters: the named sub-experiences and /api routes must be
# registered BEFORE the catch-all root mount, or "/" would swallow them.
# --------------------------------------------------------------------------- #
CLASSIC_DIR = os.path.join(STATIC_DIR, "classic")
ARCADE_DIR = os.path.join(STATIC_DIR, "arcade")

if os.path.isdir(ARCADE_DIR):
    app.mount("/arcade", StaticFiles(directory=ARCADE_DIR, html=True), name="arcade")
if os.path.isdir(CLASSIC_DIR):
    app.mount("/classic", StaticFiles(directory=CLASSIC_DIR, html=True), name="classic")
    # Classic is the default experience, served at the site root (registered last).
    app.mount("/", StaticFiles(directory=CLASSIC_DIR, html=True), name="root")
