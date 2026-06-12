"""
Q1obsessed — export the SQLite database to a fully static site for GitHub Pages.

GitHub Pages can't run the FastAPI backend, so this script:
  1. Reads q1obsessed.db and clusters journals across SJR + Scopus by ISSN
     identity (the same union-find the live API does at search time).
  2. Writes a compact search index + sharded per-journal detail JSON into
     docs/data/, plus stats.json and a manifest.
  3. Assembles docs/ : copies the Classic and Arcade UIs, injects the static
     data layer (scripts/pages/data.js), and rewrites the inter-version links
     so everything works under a project sub-path (imeewan.github.io/Q1obsessed/).

Run:  python scripts/export_static.py
Then the deployable site is the docs/ folder.
"""
import json
import os
import re
import shutil
import sqlite3
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB = os.path.join(ROOT, "q1obsessed.db")
STATIC = os.path.join(ROOT, "static")
DOCS = os.path.join(ROOT, "docs")
DATA_OUT = os.path.join(DOCS, "data")
DET_OUT = os.path.join(DATA_OUT, "det")
DATA_JS_SRC = os.path.join(HERE, "pages", "data.js")

SHARD = 1000


def norm_title(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def codes_of(issn):
    return [c.strip() for c in (issn or "").split(",") if c.strip()]


# --------------------------------------------------------------------------- #
# union-find
# --------------------------------------------------------------------------- #
class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        root = x
        while self.p[root] != root:
            root = self.p[root]
        while self.p[x] != root:
            self.p[x], x = root, self.p[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def load():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    sjr = {r["id"]: dict(r) for r in con.execute("SELECT * FROM sjr_journal")}
    for j in sjr.values():
        j["cats"] = []
    for r in con.execute("SELECT * FROM sjr_category"):
        if r["journal_id"] in sjr:
            sjr[r["journal_id"]]["cats"].append(dict(r))

    sco = {r["id"]: dict(r) for r in con.execute("SELECT * FROM scopus_journal")}
    for j in sco.values():
        j["cats"] = []
    for r in con.execute("SELECT * FROM scopus_category"):
        if r["journal_id"] in sco:
            sco[r["journal_id"]]["cats"].append(dict(r))

    nfields = con.execute("SELECT COUNT(DISTINCT category) c FROM sjr_category").fetchone()["c"]
    con.close()
    return sjr, sco, nfields


def cluster(sjr, sco):
    uf = UF()
    issn_seed, title_seed = {}, {}

    def add(node, issn, tnorm):
        uf.find(node)
        cs = codes_of(issn)
        if cs:
            for c in cs:
                k = "i:" + c
                if k in issn_seed:
                    uf.union(node, issn_seed[k])
                else:
                    issn_seed[k] = node
        else:
            k = "t:" + tnorm
            if k in title_seed:
                uf.union(node, title_seed[k])
            else:
                title_seed[k] = node

    for jid, j in sjr.items():
        add(("sjr", jid), j["issn"], j.get("title_norm") or norm_title(j["title"]))
    for jid, j in sco.items():
        add(("scopus", jid), j["issn"], j.get("title_norm") or norm_title(j["title"]))

    groups = {}
    for jid in sjr:
        groups.setdefault(uf.find(("sjr", jid)), {"sjr": [], "scopus": []})["sjr"].append(jid)
    for jid in sco:
        groups.setdefault(uf.find(("scopus", jid)), {"sjr": [], "scopus": []})["scopus"].append(jid)
    return groups


def cats_payload(rows):
    out = []
    for c in sorted(rows, key=lambda r: -(r["percentile"] or 0)):
        out.append({
            "category": c["category"],
            "percentile": round(float(c["percentile"]), 1) if c["percentile"] is not None else 0.0,
            "rank": int(c["rank"]) if c["rank"] is not None else None,
            "total": int(c["total"]) if c["total"] is not None else None,
            "quartile": int(c["quartile"]) if c["quartile"] is not None else None,
        })
    return out


def merged_issn(*journals):
    seen, codes = set(), []
    for j in journals:
        if not j:
            continue
        for c in codes_of(j.get("issn")):
            if c not in seen:
                seen.add(c)
                codes.append(c)
    return ",".join(codes)


def build():
    sjr, sco, nfields = load()
    print(f"[load] {len(sjr)} SJR + {len(sco)} Scopus journals, {nfields} SJR fields")
    groups = cluster(sjr, sco)
    print(f"[cluster] {len(groups)} journal clusters")

    # Deterministic order: by best display title then issn.
    def pick(lst, src):
        # representative = the member with the most categories
        return max(lst, key=lambda jid: len((sjr if src == 'sjr' else sco)[jid]["cats"])) if lst else None

    recs, multi = [], 0
    for g in groups.values():
        sj_id = pick(g["sjr"], "sjr")
        sc_id = pick(g["scopus"], "scopus")
        if len(g["sjr"]) > 1 or len(g["scopus"]) > 1:
            multi += 1
        sj = sjr[sj_id] if sj_id is not None else None
        sc = sco[sc_id] if sc_id is not None else None
        title = (sj or sc)["title"]
        issn = merged_issn(sj, sc)
        publisher = (sj and sj["publisher"]) or (sc and sc["publisher"]) or ""
        recs.append({"title": title, "tnorm": norm_title(title), "issn": issn,
                     "publisher": publisher, "sj": sj, "sc": sc})

    recs.sort(key=lambda r: (r["tnorm"], r["issn"]))
    if multi:
        print(f"[note] {multi} clusters had >1 journal from a source (kept the richest)")

    # Assemble index + sharded details + per-category ranked lists.
    index, shards = [], {}
    cat_entries = {"sjr": {}, "scopus": {}}   # source -> category -> [[rank,pct,q,val,clusterId], ...]
    for c, r in enumerate(recs):
        index.append([r["title"], r["issn"], 1 if r["sj"] else 0, 1 if r["sc"] else 0])
        if r["sj"]:
            sval = round(float(r["sj"]["sjr"]), 3) if r["sj"]["sjr"] is not None else None
            for cc in r["sj"]["cats"]:
                cat_entries["sjr"].setdefault(cc["category"], []).append([
                    int(cc["rank"]) if cc["rank"] is not None else None,
                    round(float(cc["percentile"]), 1) if cc["percentile"] is not None else 0.0,
                    int(cc["quartile"]) if cc["quartile"] is not None else 4, sval, c])
        if r["sc"]:
            cval = round(float(r["sc"]["citescore"]), 2) if r["sc"]["citescore"] is not None else None
            for cc in r["sc"]["cats"]:
                cat_entries["scopus"].setdefault(cc["category"], []).append([
                    int(cc["rank"]) if cc["rank"] is not None else None,
                    round(float(cc["percentile"]), 1) if cc["percentile"] is not None else 0.0,
                    int(cc["quartile"]) if cc["quartile"] is not None else 4, cval, c])
        metrics = {}
        if r["sj"]:
            j = r["sj"]
            metrics["sjr"] = {
                "source": "sjr", "_id": c, "title": r["title"], "issn": r["issn"],
                "publisher": r["publisher"], "country": j.get("country"),
                "type": j.get("type"), "coverage": j.get("coverage"),
                "metric_name": "SJR",
                "metric_value": round(float(j["sjr"]), 3) if j["sjr"] is not None else None,
                "h_index": int(j["h_index"]) if j.get("h_index") is not None else None,
                "best_quartile": j.get("best_quartile"),
                "best_percentile": j.get("best_percentile"),
                "categories": cats_payload(j["cats"]),
            }
        if r["sc"]:
            j = r["sc"]
            metrics["scopus"] = {
                "source": "scopus", "_id": c, "title": r["title"], "issn": r["issn"],
                "publisher": r["publisher"],
                "metric_name": "CiteScore",
                "metric_value": round(float(j["citescore"]), 2) if j["citescore"] is not None else None,
                "best_quartile": j.get("best_quartile"),
                "best_percentile": j.get("best_percentile"),
                "categories": cats_payload(j["cats"]),
            }
        detail = {"title": r["title"], "issn": r["issn"],
                  "publisher": r["publisher"], "metrics": metrics}
        shards.setdefault(c // SHARD, {})[c] = detail

    ncat = len(cat_entries["sjr"]) + len(cat_entries["scopus"])
    write_site(index, shards, {
        "sjr_journals": len(sjr), "scopus_journals": len(sco),
        "sjr_categories": nfields, "scopus_loaded": True,
    }, cat_entries)
    print(f"[done] {len(index)} clusters, {len(shards)} shards, {ncat} category lists -> {DOCS}")


# --------------------------------------------------------------------------- #
# write docs/
# --------------------------------------------------------------------------- #
def _inject(html, is_classic):
    """Rewrite inter-version links for the project sub-path and load data.js."""
    if is_classic:
        html = html.replace('href="/arcade/"', 'href="../arcade/"')
    else:
        html = html.replace('<a class="switch-link" href="/">',
                             '<a class="switch-link" href="../classic/">')
    # Load the static data layer immediately before the UI's app.js.
    html = html.replace('<script src="app.js"></script>',
                        '<script src="../data.js"></script>\n  <script src="app.js"></script>')
    return html


def _copy_version(name, is_classic):
    src = os.path.join(STATIC, name)
    dst = os.path.join(DOCS, name)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    for fn in os.listdir(src):
        sp = os.path.join(src, fn)
        if not os.path.isfile(sp):
            continue
        if fn == "index.html":
            with open(sp, encoding="utf-8") as f:
                html = f.read()
            with open(os.path.join(dst, fn), "w", encoding="utf-8") as f:
                f.write(_inject(html, is_classic))
        else:
            shutil.copy2(sp, os.path.join(dst, fn))


def write_site(index, shards, stats, cat_entries):
    if os.path.isdir(DATA_OUT):
        shutil.rmtree(DATA_OUT)
    os.makedirs(DET_OUT)

    with open(os.path.join(DATA_OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_OUT, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False)
    with open(os.path.join(DATA_OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"shard": SHARD, "clusters": len(index)}, f)
    for b, obj in shards.items():
        with open(os.path.join(DET_OUT, f"{b}.json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    # Per-category ranked lists (one file per field, lazy-loaded on click).
    # categories.json maps a category name -> its file id, per source.
    cat_root = os.path.join(DATA_OUT, "cat")
    categories_map = {"sjr": {}, "scopus": {}}
    for source in ("sjr", "scopus"):
        sdir = os.path.join(cat_root, source)
        os.makedirs(sdir, exist_ok=True)
        for catid, name in enumerate(sorted(cat_entries[source])):
            rows = cat_entries[source][name]
            rows.sort(key=lambda e: (e[0] is None, e[0] if e[0] is not None else 0))
            categories_map[source][name] = catid
            with open(os.path.join(sdir, f"{catid}.json"), "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_OUT, "categories.json"), "w", encoding="utf-8") as f:
        json.dump(categories_map, f, ensure_ascii=False, separators=(",", ":"))

    # the shared client data layer
    shutil.copy2(DATA_JS_SRC, os.path.join(DOCS, "data.js"))

    # the two UIs
    _copy_version("classic", is_classic=True)
    _copy_version("arcade", is_classic=False)

    # root redirect -> classic (the default), and disable Jekyll processing
    with open(os.path.join(DOCS, "index.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html><meta charset="utf-8"><title>Q1obsessed</title>'
                '<meta http-equiv="refresh" content="0; url=./classic/">'
                '<link rel="canonical" href="./classic/">'
                '<p>Redirecting to <a href="./classic/">Q1obsessed</a>…</p>\n')
    open(os.path.join(DOCS, ".nojekyll"), "w").close()


if __name__ == "__main__":
    build()
