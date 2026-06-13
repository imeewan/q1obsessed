"""
Q1obsessed — export a compact journal->quartile lookup for the Chrome extension.

Reads the already-built static site data (docs/data/) so cluster ids stay
identical to the live site (the extension popup fetches per-field detail from
https://imeewan.github.io/q1obsessed/data/det/<shard>.json by cluster id).

Output: extension/data/journals.json  — an array of compact records:
    [c, title, issn, bestSjrQ, bestScopusQ, bestSjrPct, bestScopusPct]
(title_norm is computed in JS at load time to keep the file small.)

Run:  python scripts/export_extension.py
"""
import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS_DATA = os.path.join(ROOT, "docs", "data")
OUT_DIR = os.path.join(ROOT, "extension", "data")
OUT = os.path.join(OUT_DIR, "journals.json")


def main():
    idx_path = os.path.join(DOCS_DATA, "index.json")
    if not os.path.exists(idx_path):
        raise SystemExit("docs/data/index.json missing — run scripts/export_static.py first")

    records = []
    shard_files = sorted(glob.glob(os.path.join(DOCS_DATA, "det", "*.json")),
                         key=lambda p: int(os.path.splitext(os.path.basename(p))[0]))
    n_sjr = n_sco = n_both = 0
    for sf in shard_files:
        shard = json.load(open(sf, encoding="utf-8"))
        for cid, d in shard.items():
            m = d.get("metrics", {})
            sj = m.get("sjr") or {}
            sc = m.get("scopus") or {}
            has_sj = "sjr" in m
            has_sc = "scopus" in m
            if has_sj and has_sc:
                n_both += 1
            if has_sj:
                n_sjr += 1
            if has_sc:
                n_sco += 1
            records.append([
                int(cid),
                d.get("title", ""),
                d.get("issn", ""),
                sj.get("best_quartile") if has_sj else None,
                sc.get("best_quartile") if has_sc else None,
                round(sj["best_percentile"], 1) if has_sj and sj.get("best_percentile") is not None else None,
                round(sc["best_percentile"], 1) if has_sc and sc.get("best_percentile") is not None else None,
            ])

    records.sort(key=lambda r: r[0])
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"[done] {len(records)} journals -> {OUT}  ({size_mb:.1f} MB)")
    print(f"       SJR={n_sjr}  Scopus={n_sco}  both={n_both}")


if __name__ == "__main__":
    main()
