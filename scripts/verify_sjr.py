"""
Verify the SJR data in q1obsessed.db against SCImago's own numbers.

(A) Quartile integrity: SCImago publishes an official quartile per category in the
    source CSV as a "(Qx)" marker. Every quartile we store must equal that marker.
(B) Percentile/rank recompute: re-derive percentile+rank for a random sample with
    the documented SCImago formula and confirm the DB matches.
(C) External spot-check list: print a random sample with SCImago journal URLs so the
    published quartile/rank on scimagojr.com can be eyeballed against ours.

Usage:  python scripts/verify_sjr.py
"""
import os
import random
import re
import sqlite3
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_db import parse_categories, to_float  # noqa: E402

DATA = os.path.join(HERE, "..", "data")
DB = os.path.join(HERE, "..", "q1obsessed.db")
CSV = os.path.join(DATA, "sjr_2025.csv")
random.seed(7)


def main():
    df = pd.read_csv(CSV, sep=";", dtype=str).fillna("")
    df["sjr_val"] = df["SJR"].map(to_float)

    # Titles shared by >1 distinct journal can't be checked by name alone.
    dup_titles = set(df["Title"][df["Title"].duplicated(keep=False)])

    # Official quartile marker per (title, category) from the CSV (unique titles).
    marker = {}
    sourceid = {}
    for _, r in df.iterrows():
        sourceid[r["Title"]] = r.get("Sourceid", "")
        if r["Title"] in dup_titles:
            continue
        for name, q in parse_categories(r["Categories"]):
            if q:
                marker[(r["Title"], name)] = q

    # Recompute reference percentiles/ranks for a sampled set of categories.
    cat_sorted = {}
    for _, r in df.iterrows():
        for name, _q in parse_categories(r["Categories"]):
            cat_sorted.setdefault(name, []).append(r["sjr_val"])
    cat_sorted = {c: np.sort(np.array(v, float)) for c, v in cat_sorted.items()}

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT j.title t, j.sjr s, c.category cat, c.percentile p, c.rank rk, "
        "c.total n, c.quartile q FROM sjr_category c "
        "JOIN sjr_journal j ON j.id=c.journal_id").fetchall()

    q_ok = q_tot = p_ok = p_tot = 0
    qmis, pmis = [], []
    for r in rows:
        mk = marker.get((r["t"], r["cat"]))
        if mk is not None:
            q_tot += 1
            if mk == r["q"]:
                q_ok += 1
            else:
                qmis.append((r["t"], r["cat"], "ours", r["q"], "SCImago", mk))
        arr = cat_sorted.get(r["cat"])
        if arr is not None:
            N = len(arr)
            n_le = int(np.searchsorted(arr, r["s"], "right"))
            pct = round(100.0 * n_le / N, 2)
            rank = (N - n_le) + 1
            p_tot += 1
            if abs(pct - r["p"]) <= 0.01 and rank == r["rk"] and N == r["n"]:
                p_ok += 1
            else:
                pmis.append((r["t"], r["cat"], (r["p"], r["rk"], r["n"]),
                             (pct, rank, N)))

    print("=== (A) SJR quartile vs SCImago official (Qx) marker ===")
    print(f"quartile checks  : {q_ok}/{q_tot}  ({100*q_ok/q_tot:.2f}%)  "
          f"[{len(dup_titles)} duplicate-name titles excluded from name match]")
    for m in qmis[:15]:
        print("  MISMATCH:", m)
    print("\n=== (B) SJR percentile/rank recompute vs DB ===")
    print(f"recompute checks : {p_ok}/{p_tot}  ({100*p_ok/p_tot:.2f}%)")
    for m in pmis[:15]:
        print("  MISMATCH:", m)

    print("\n=== (C) External spot-check — verify these on scimagojr.com ===")
    titles = list({r["t"] for r in rows})
    for t in random.sample(titles, min(10, len(titles))):
        sid = sourceid.get(t, "")
        cats = con.execute(
            "SELECT c.category cat,c.percentile p,c.rank rk,c.total n,c.quartile q "
            "FROM sjr_category c JOIN sjr_journal j ON j.id=c.journal_id "
            "WHERE j.title=? ORDER BY c.percentile DESC", (t,)).fetchall()
        print(f"\n• {t}")
        print(f"  https://www.scimagojr.com/journalsearch.php?q={sid}&tip=sid")
        for c in cats:
            print(f"    {c['cat']:42s} Q{c['q']}  pct {c['p']:.1f}  rank {c['rk']}/{c['n']}")
    con.close()


if __name__ == "__main__":
    main()
