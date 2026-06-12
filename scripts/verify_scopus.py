"""
Verify the Scopus data in q1obsessed.db against Scopus's own numbers.

(A) Pipeline integrity: for a large random sample, the percentile/rank/quartile
    stored in the DB must match what the raw Scopus API returned
    (data/scopus_api_raw.jsonl) — this proves the build didn't corrupt anything.
(B) Live re-query: for a few journals, re-pull from the Scopus API by ISSN right
    now and confirm the DB still matches a fresh response from Scopus.

Usage:
    python scripts/verify_scopus.py                 # (A) only
    python scripts/verify_scopus.py --key APIKEY     # (A) + (B) live re-query
"""
import argparse
import json
import os
import random
import sqlite3
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_db import norm_title, quartile_from_percentile  # noqa: E402
from fetch_scopus_api import parse_entry, as_list           # noqa: E402

DATA = os.path.join(HERE, "..", "data")
DB = os.path.join(HERE, "..", "q1obsessed.db")
RAW = os.path.join(DATA, "scopus_api_raw.jsonl")
random.seed(7)


def load_truth():
    """ISSN code -> {subject_name: (percentile, rank)} from the raw API dump.
    Keyed by ISSN (not title) so duplicate-name journals don't collide."""
    code_name, entries = {}, []
    with open(RAW, encoding="utf-8") as f:
        for line in f:
            entries.append(json.loads(line))
    for e in entries:
        for s in as_list(e.get("subject-area")):
            c = str(s.get("@code", "")).strip()
            nm = (s.get("$") or "").strip()
            if c and nm:
                code_name.setdefault(c, nm)
    truth = {}
    for e in entries:
        j, rows = parse_entry(e, code_name)
        subjects = {}
        for code, pct, rank, _cs in rows:
            subjects[code_name.get(code, code)] = (
                float(pct) if str(pct) != "" else None,
                int(rank) if str(rank) != "" else None)
        for code in (j["issn"], j["eissn"]):
            if code:
                truth[code] = subjects
    return truth


def check_integrity(n=600):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    if not con.execute("SELECT value FROM meta WHERE key='scopus_loaded'").fetchone():
        print("Scopus not loaded — run the harvest + rebuild first."); return
    truth = load_truth()
    journals = con.execute("SELECT id,title,title_norm,issn FROM scopus_journal").fetchall()
    sample = random.sample(journals, min(n, len(journals)))

    checked = pct_ok = rank_ok = quart_ok = miss = 0
    mismatches = []
    for j in sample:
        api = None
        for code in (j["issn"] or "").split(","):
            if code and code in truth:
                api = truth[code]
                break
        if not api:
            miss += 1
            continue
        cats = con.execute(
            "SELECT category,percentile,rank,quartile FROM scopus_category "
            "WHERE journal_id=?", (j["id"],)).fetchall()
        for c in cats:
            if c["category"] not in api:
                continue
            checked += 1
            tp, tr = api[c["category"]]
            if tp is not None and abs(c["percentile"] - tp) <= 0.5:
                pct_ok += 1
            elif tp is not None:
                mismatches.append((j["title"], c["category"], "pct",
                                   c["percentile"], tp))
            if tr is not None and c["rank"] == tr:
                rank_ok += 1
            elif tr is not None:
                mismatches.append((j["title"], c["category"], "rank",
                                   c["rank"], tr))
            if tp is not None and c["quartile"] == quartile_from_percentile(tp):
                quart_ok += 1

    print("\n=== (A) Scopus DB vs raw API (pipeline integrity) ===")
    print(f"sampled journals : {len(sample)}  (no raw match: {miss})")
    print(f"category checks  : {checked}")
    if checked:
        print(f"percentile match : {pct_ok}/{checked}  ({100*pct_ok/checked:.2f}%)")
        print(f"rank match       : {rank_ok}/{checked}  ({100*rank_ok/checked:.2f}%)")
        print(f"quartile match   : {quart_ok}/{checked}  ({100*quart_ok/checked:.2f}%)")
    for m in mismatches[:15]:
        print("  MISMATCH:", m)
    con.close()
    return len(mismatches)


def check_live(key, n=8):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id,title,title_norm,issn FROM scopus_journal "
        "WHERE issn!='' ORDER BY RANDOM() LIMIT ?", (n,)).fetchall()
    print("\n=== (B) Live re-query from Scopus API (by ISSN) ===")
    for j in rows:
        issn = j["issn"].split(",")[0]
        url = (f"https://api.elsevier.com/content/serial/title/issn/{issn}"
               f"?view=CITESCORE")
        req = urllib.request.Request(url)
        req.add_header("X-ELS-APIKey", key)
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                payload = json.loads(r.read().decode())
            e = payload["serial-metadata-response"]["entry"][0]
        except Exception as ex:
            print(f"  {j['title'][:40]}: live fetch failed ({ex})")
            continue
        code_name = {}
        _x, rows2 = parse_entry(e, code_name)
        live = {code_name.get(c, c): (p, rk) for c, p, rk, _ in rows2}
        db = con.execute(
            "SELECT category,percentile,rank FROM scopus_category WHERE journal_id=?",
            (j["id"],)).fetchall()
        ok = True
        for c in db:
            if c["category"] in live:
                lp, lr = live[c["category"]]
                if str(lp) != "" and abs(float(lp) - c["percentile"]) > 0.5:
                    ok = False
                if str(lr) != "" and int(lr) != c["rank"]:
                    ok = False
        print(f"  {'OK ' if ok else 'DIFF'} {j['title'][:46]:46s} "
              f"({len(db)} fields)")
    con.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default="")
    ap.add_argument("--n", type=int, default=600)
    args = ap.parse_args()
    check_integrity(args.n)
    if args.key:
        check_live(args.key)
