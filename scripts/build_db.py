"""
Q1obsessed — database builder.

Reads the raw SJR CSV (SCImago) and, if present, the Scopus "source titles and
metrics" XLSX, then precomputes per-category percentile + rank for every journal
and writes a single SQLite database (q1obsessed.db) with FTS5 search.

Percentile formula (matches the user's Colab, the way SCImago/Scopus define it):
    For a journal with metric value v in a category containing N journals,
        n  = count of journals in that category with metric <= v
        percentile = 100 * n / N
        rank       = count of journals with metric > v, plus 1   (1 = best)

Run:  python build_db.py
"""
import os
import re
import sqlite3
import unicodedata

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
DB_PATH = os.path.join(HERE, "..", "q1obsessed.db")

SJR_CSV = os.path.join(DATA, "sjr_2025.csv")
# Scopus metrics file: user drops the "source titles and metrics" xlsx here.
# We detect it loosely so the exact filename doesn't matter.
SCOPUS_DIR = DATA


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def norm_title(s: str) -> str:
    """Normalize a title for fuzzy matching / dedupe keys."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_issn(raw) -> str:
    """SJR stores ISSNs like '15424863, 00079235'. Return comma-joined 8-digit codes."""
    if not isinstance(raw, str):
        return ""
    codes = re.findall(r"[0-9Xx]{8}", raw.replace("-", ""))
    return ",".join(c.upper() for c in codes)


def to_float(v) -> float:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def quartile_from_percentile(p: float) -> int:
    """Top 25% -> Q1, etc. Percentile here is 'higher = better'."""
    if p >= 75:
        return 1
    if p >= 50:
        return 2
    if p >= 25:
        return 3
    return 1 if p == 100 else 4


# --------------------------------------------------------------------------- #
# SJR
# --------------------------------------------------------------------------- #
CAT_QUARTILE_RE = re.compile(r"\s*\(Q([1-4])\)\s*$")


def parse_categories(cell):
    """'Hematology (Q1); Oncology (Q2)' -> [('Hematology', 1), ('Oncology', 2)]."""
    out = []
    if not isinstance(cell, str):
        return out
    for part in cell.split(";"):
        part = part.strip()
        if not part:
            continue
        m = CAT_QUARTILE_RE.search(part)
        q = int(m.group(1)) if m else None
        name = CAT_QUARTILE_RE.sub("", part).strip()
        if name:
            out.append((name, q))
    return out


def build_sjr(con):
    print("[SJR] reading", SJR_CSV)
    df = pd.read_csv(SJR_CSV, sep=";", dtype=str).fillna("")
    df["sjr_val"] = df["SJR"].map(to_float)
    df["cats"] = df["Categories"].map(parse_categories)
    df["issn_clean"] = df["Issn"].map(clean_issn)

    # Precompute, per category, the sorted vector of SJR values -> fast rank/percentile.
    cat_values = {}
    for _, row in df.iterrows():
        for name, _q in row["cats"]:
            cat_values.setdefault(name, []).append(row["sjr_val"])
    cat_sorted = {c: np.sort(np.array(v, dtype=float)) for c, v in cat_values.items()}
    print(f"[SJR] {len(df)} sources, {len(cat_sorted)} categories")

    jrows, crows = [], []
    for jid, (_, row) in enumerate(df.iterrows(), start=1):
        v = row["sjr_val"]
        cats_payload = []
        for name, q_marker in row["cats"]:
            arr = cat_sorted[name]
            N = len(arr)
            n_le = int(np.searchsorted(arr, v, side="right"))   # count <= v
            n_lt = int(np.searchsorted(arr, v, side="left"))    # count strictly < v
            n_gt = N - n_le  # journals strictly greater than v
            # Percentile = Scopus's own definition, [(lower + 0.5*ties)/N]*100, a
            # mid-rank percentile. This makes the SJR percentile use the SAME
            # formula as Scopus CiteScore AND stay consistent with the rank-based
            # quartile (Q1 <=> pct >= 75): e.g. a journal ranked #22/85 is Q2 and
            # scores 74.7, not the old inclusive 75.3 that looked like Q1.
            pct = 100.0 * (n_lt + n_le) / (2 * N) if N else 0.0
            rank = n_gt + 1
            # Derive the quartile from OUR percentile (top 25% = Q1, etc.) so rank,
            # percentile and quartile are always mutually consistent. We do NOT use
            # SCImago's published (Qx) marker because those markers are sometimes
            # internally inconsistent with the SJR ranking itself (non-monotonic:
            # e.g. a higher-SJR journal marked Q2 while a lower-SJR one is Q1 in the
            # same category), which would contradict the percentile bar/rank we show.
            q = quartile_from_percentile(pct)
            crows.append((jid, name, round(pct, 2), rank, N, q))
            cats_payload.append((name, pct, rank, N, q))
        best_q = min((c[4] for c in cats_payload), default=4) if cats_payload else None
        best_pct = max((c[1] for c in cats_payload), default=0.0) if cats_payload else 0.0
        jrows.append((
            jid, row["Title"], norm_title(row["Title"]), row["issn_clean"],
            v, to_float(row.get("H index")), row.get("Publisher", ""),
            row.get("Country", ""), row.get("Type", ""), row.get("Areas", ""),
            row.get("Coverage", ""), best_q, round(best_pct, 2),
        ))

    con.executemany(
        "INSERT INTO sjr_journal VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", jrows)
    con.executemany(
        "INSERT INTO sjr_category VALUES (?,?,?,?,?,?)", crows)
    con.commit()
    print(f"[SJR] inserted {len(jrows)} journals, {len(crows)} category rows")


# --------------------------------------------------------------------------- #
# Scopus  (runs only if a metrics xlsx is present)
# --------------------------------------------------------------------------- #
def find_scopus_metrics_file():
    if not os.path.isdir(SCOPUS_DIR):
        return None
    cands = []
    for f in os.listdir(SCOPUS_DIR):
        fl = f.lower()
        if (fl.endswith((".xlsx", ".xls", ".csv"))
                and "ext_list" not in fl and "book" not in fl
                and not fl.startswith("sjr")):
            cands.append(os.path.join(SCOPUS_DIR, f))
    # Prefer files whose name hints at metrics/citescore.
    cands.sort(key=lambda p: ("metric" not in p.lower() and "citescore" not in p.lower(), p))
    return cands[0] if cands else None


def build_scopus(con):
    path = find_scopus_metrics_file()
    if not path:
        print("[Scopus] no metrics xlsx found in data/ - skipping (SJR-only build).")
        con.execute("INSERT OR REPLACE INTO meta VALUES ('scopus_loaded','0')")
        con.commit()
        return
    print("[Scopus] reading", path)
    # Columns vary by source (API csv / metrics xlsx); we detect them below.
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path, dtype=str).fillna("")
    else:
        xl = pd.ExcelFile(path)
        df = xl.parse(xl.sheet_names[0], dtype=str).fillna("")
    cols = {c.lower().strip(): c for c in df.columns}

    def find_col(*keys):
        for k in keys:
            for lc, orig in cols.items():
                if k in lc:
                    return orig
        return None

    c_title = find_col("source title", "title")
    c_issn = find_col("print issn", "issn")
    c_eissn = find_col("e-issn", "eissn")
    c_cite = find_col("citescore")
    c_pct = find_col("percentile")
    c_rank = find_col("rank")
    c_quart = find_col("quartile")
    c_field = find_col("scopus sub-subject area", "subject area", "asjc field", "category")
    c_pub = find_col("publisher")
    print(f"[Scopus] detected columns: title={c_title} citescore={c_cite} "
          f"percentile={c_pct} rank={c_rank} field={c_field}")

    if not (c_title and c_cite):
        print("[Scopus] could not detect required columns; columns present:")
        print("  ", list(df.columns)[:40])
        con.execute("INSERT OR REPLACE INTO meta VALUES ('scopus_loaded','0')")
        con.commit()
        return

    # Each row is typically one (journal x subject area). Group by ISSN/title -> journal.
    df["_title"] = df[c_title].astype(str)
    df["_norm"] = df["_title"].map(norm_title)
    df["_issn"] = ""
    if c_issn:
        df["_issn"] = df[c_issn].map(clean_issn)
    if c_eissn:
        df["_issn"] = (df["_issn"] + "," + df[c_eissn].map(clean_issn)).str.strip(",")
    df["_cs"] = df[c_cite].map(to_float)

    have_pct = c_pct is not None
    have_rank = c_rank is not None
    # Total sources per field (denominator for "#rank / total"): one row per
    # (journal x field) in the API output, so a field's row-count is its size.
    field_total = {}
    if c_field:
        for v in df[c_field].astype(str):
            v = v.strip()
            if v:
                field_total[v] = field_total.get(v, 0) + 1
    # If percentile/rank not in file, compute them per detected field from CiteScore.
    if not have_pct and c_field:
        cat_vals = {}
        for _, r in df.iterrows():
            cat_vals.setdefault(str(r[c_field]).strip(), []).append(r["_cs"])
        cat_sorted = {k: np.sort(np.array(v, float)) for k, v in cat_vals.items()}

    def jkey(r):
        # Identity by ISSN so distinct journals sharing a name stay separate.
        codes = [c for c in str(r["_issn"]).split(",") if c]
        return "i:" + codes[0] if codes else "t:" + (r["_norm"] or r["_title"])

    journals = {}   # identity key -> jid
    jrows, crows = [], []
    nextid = 1
    for _, r in df.iterrows():
        key = jkey(r)
        if key not in journals:
            journals[key] = nextid
            nextid += 1
        jid = journals[key]
        field = str(r[c_field]).strip() if c_field else "All"
        if have_pct:
            pct = to_float(r[c_pct])
            rank = int(to_float(r[c_rank])) if have_rank else 0
            N = field_total.get(field, 0)
        else:
            arr = cat_sorted.get(field, np.array([r["_cs"]]))
            N = len(arr)
            n_le = int(np.searchsorted(arr, r["_cs"], "right"))
            pct = 100.0 * n_le / N if N else 0.0
            rank = (N - n_le) + 1
        q = int(to_float(r[c_quart])) if c_quart and to_float(r[c_quart]) else quartile_from_percentile(pct)
        crows.append((jid, field, round(pct, 2), rank, N, q, r["_cs"]))

    # With official ranks, a field's true size is its largest rank (Scopus ranks
    # 1..N), which is the denominator Scopus shows — not our harvested row count.
    if have_rank:
        field_maxrank = {}
        for (_jid, field, _p, rank, _N, _q, _cs) in crows:
            if rank:
                field_maxrank[field] = max(field_maxrank.get(field, 0), rank)
        crows = [(jid, field, p, rank, field_maxrank.get(field, N) or N, q, cs)
                 for (jid, field, p, rank, N, q, cs) in crows]

    # Build journal rows (dedup): aggregate best metrics.
    agg = {}
    for jid, field, pct, rank, N, q, cs in crows:
        a = agg.setdefault(jid, {"best_pct": 0.0, "best_q": 4, "cs": cs})
        a["best_pct"] = max(a["best_pct"], pct)
        a["best_q"] = min(a["best_q"], q)
        a["cs"] = max(a["cs"], cs)
    seen = {}
    for _, r in df.iterrows():
        jid = journals[jkey(r)]
        if jid in seen:
            continue
        seen[jid] = True
        a = agg.get(jid, {"best_pct": 0.0, "best_q": 4, "cs": r["_cs"]})
        jrows.append((
            jid, r["_title"], r["_norm"], r["_issn"], a["cs"],
            r[c_pub] if c_pub else "", round(a["best_pct"], 2), a["best_q"],
        ))

    con.executemany("INSERT INTO scopus_journal VALUES (?,?,?,?,?,?,?,?)", jrows)
    con.executemany("INSERT INTO scopus_category VALUES (?,?,?,?,?,?,?)", crows)
    con.execute("INSERT OR REPLACE INTO meta VALUES ('scopus_loaded','1')")
    con.commit()
    print(f"[Scopus] inserted {len(jrows)} journals, {len(crows)} category rows")


# --------------------------------------------------------------------------- #
# Schema + FTS
# --------------------------------------------------------------------------- #
def create_schema(con):
    con.executescript("""
    DROP TABLE IF EXISTS sjr_journal;
    DROP TABLE IF EXISTS sjr_category;
    DROP TABLE IF EXISTS scopus_journal;
    DROP TABLE IF EXISTS scopus_category;
    DROP TABLE IF EXISTS meta;
    DROP TABLE IF EXISTS search_index;

    CREATE TABLE sjr_journal(
        id INTEGER PRIMARY KEY, title TEXT, title_norm TEXT, issn TEXT,
        sjr REAL, h_index REAL, publisher TEXT, country TEXT, type TEXT,
        areas TEXT, coverage TEXT, best_quartile INTEGER, best_percentile REAL);
    CREATE TABLE sjr_category(
        journal_id INTEGER, category TEXT, percentile REAL, rank INTEGER,
        total INTEGER, quartile INTEGER);
    CREATE INDEX idx_sjr_cat ON sjr_category(journal_id);
    CREATE INDEX idx_sjr_norm ON sjr_journal(title_norm);
    CREATE INDEX idx_sjr_issn ON sjr_journal(issn);

    CREATE TABLE scopus_journal(
        id INTEGER PRIMARY KEY, title TEXT, title_norm TEXT, issn TEXT,
        citescore REAL, publisher TEXT, best_percentile REAL, best_quartile INTEGER);
    CREATE TABLE scopus_category(
        journal_id INTEGER, category TEXT, percentile REAL, rank INTEGER,
        total INTEGER, quartile INTEGER, citescore REAL);
    CREATE INDEX idx_sco_cat ON scopus_category(journal_id);
    CREATE INDEX idx_sco_norm ON scopus_journal(title_norm);
    CREATE INDEX idx_sco_issn ON scopus_journal(issn);

    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);

    CREATE VIRTUAL TABLE search_index USING fts5(
        title, title_norm, source UNINDEXED, ref_id UNINDEXED, issn UNINDEXED,
        tokenize='unicode61 remove_diacritics 2');
    """)
    con.commit()


def build_search_index(con):
    rows = []
    for (jid, title, norm, issn) in con.execute(
            "SELECT id,title,title_norm,issn FROM sjr_journal"):
        rows.append((title, norm, "sjr", jid, issn))
    for (jid, title, norm, issn) in con.execute(
            "SELECT id,title,title_norm,issn FROM scopus_journal"):
        rows.append((title, norm, "scopus", jid, issn))
    con.executemany("INSERT INTO search_index VALUES (?,?,?,?,?)", rows)
    con.commit()
    print(f"[search] indexed {len(rows)} titles")


def main():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    con = sqlite3.connect(DB_PATH)
    create_schema(con)
    build_sjr(con)
    build_scopus(con)
    build_search_index(con)
    con.execute("INSERT OR REPLACE INTO meta VALUES ('built','1')")
    con.commit()
    con.execute("VACUUM")
    con.close()
    size = os.path.getsize(DB_PATH) / 1e6
    print(f"[done] {DB_PATH}  ({size:.1f} MB)")


if __name__ == "__main__":
    main()
