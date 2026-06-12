"""
Q1obsessed — Scopus CiteScore harvester (official Elsevier Serial Title API).

Enumerates every Scopus serial by ASJC sub-area code (no 1000-row limit, stays
under the API's deep-paging cap) and writes the official CiteScore + per-subject
rank/percentile to data/scopus_citescore_api.csv, in the shape build_db.py reads.

Get a free key (use your Mahidol login) at https://dev.elsevier.com/apikey/manage

Usage:
    python scripts/fetch_scopus_api.py --key YOUR_APIKEY
    python scripts/fetch_scopus_api.py --key YOUR_APIKEY --insttoken YOUR_TOKEN

Then:  python run.py --rebuild

Raw responses are streamed to data/scopus_api_raw.jsonl so a parser change never
requires re-fetching.
"""
import argparse
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT_CSV = os.path.join(DATA, "scopus_citescore_api.csv")
RAW = os.path.join(DATA, "scopus_api_raw.jsonl")
CODES_JSON = os.path.join(DATA, "asjc_codes.json")

BASE = "https://api.elsevier.com/content/serial/title"
COUNT = 200  # max page size for serial/title


def load_codes():
    if os.path.exists(CODES_JSON):
        return json.load(open(CODES_JSON))
    # Fallback: 4-digit ASJC sub-area codes (non-umbrella) 1101..3616.
    codes = []
    for top in range(11, 37):
        for sub in range(1, 30):
            codes.append(f"{top:02d}{sub:02d}")
    return codes


def get(url, key, insttoken):
    req = urllib.request.Request(url)
    req.add_header("X-ELS-APIKey", key)
    req.add_header("Accept", "application/json")
    if insttoken:
        req.add_header("X-ELS-Insttoken", insttoken)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def parse_entry(e, code_name):
    """Update code_name map; return (journal, [(subject, percentile, rank, cs)])."""
    for s in as_list(e.get("subject-area")):
        c = str(s.get("@code", "")).strip()
        nm = (s.get("$") or "").strip()
        if c and nm:
            code_name.setdefault(c, nm)

    csl = e.get("citeScoreYearInfoList") or {}
    cur_year = csl.get("citeScoreCurrentMetricYear")
    cur_cs = csl.get("citeScoreCurrentMetric")

    # Pick the complete current-year block (fall back to first Complete, then any).
    blocks = as_list(csl.get("citeScoreYearInfo"))
    chosen = None
    for b in blocks:
        if cur_year and str(b.get("@year")) == str(cur_year):
            chosen = b
            break
    if chosen is None:
        for b in blocks:
            if b.get("@status") == "Complete":
                chosen = b
                break
    if chosen is None and blocks:
        chosen = blocks[0]

    cs_val, rows = cur_cs, []
    if chosen:
        for il in as_list(chosen.get("citeScoreInformationList")):
            cinfos = as_list(il.get("citeScoreInfo"))
            ci = next((c for c in cinfos if c.get("docType") == "all"), cinfos[0] if cinfos else None)
            if not ci:
                continue
            cs_val = ci.get("citeScore", cur_cs)
            for r in as_list(ci.get("citeScoreSubjectRank")):
                rows.append((str(r.get("subjectCode", "")).strip(),
                             r.get("percentile", ""), r.get("rank", ""), cs_val))

    journal = {
        "title": (e.get("dc:title") or "").strip(),
        "issn": (e.get("prism:issn") or "").replace("-", "").strip(),
        "eissn": (e.get("prism:eIssn") or "").replace("-", "").strip(),
        "publisher": (e.get("dc:publisher") or "").strip(),
        "citescore": cs_val or "",
    }
    return journal, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--insttoken", default="")
    ap.add_argument("--sleep", type=float, default=0.12)
    ap.add_argument("--codes", default="", help="comma list of codes (overrides file)")
    ap.add_argument("--append", action="store_true",
                    help="append to existing CSV/raw, skipping journals already present")
    args = ap.parse_args()

    codes = args.codes.split(",") if args.codes else load_codes()

    # In append mode, learn which ISSNs we already have so we skip them.
    existing = set()
    if args.append and os.path.exists(OUT_CSV):
        with open(OUT_CSV, encoding="utf-8") as f:
            rd = csv.reader(f)
            next(rd, None)
            for row in rd:
                for c in (row[1], row[2]):  # ISSN, E-ISSN
                    if c:
                        existing.add(c)
        print(f"[append] {len(existing)} existing ISSNs loaded; will skip those")

    print(f"[harvest] {len(codes)} ASJC codes to sweep")
    raw_f = open(RAW, "a" if args.append else "w", encoding="utf-8")
    journals = {}        # source-id -> (journal, ranks)
    code_name = {}       # ASJC code -> name

    for ci, code in enumerate(codes, 1):
        start, area_n = 0, 0
        while True:
            qs = urllib.parse.urlencode(
                {"subjCode": code, "view": "CITESCORE", "count": COUNT, "start": start})
            try:
                payload = get(f"{BASE}?{qs}", args.key, args.insttoken)
            except urllib.error.HTTPError as ex:
                if ex.code in (401, 403):
                    print(f"\n[auth] HTTP {ex.code}: key rejected. Run on campus/VPN "
                          "or pass --insttoken. Stopping."); raw_f.close(); return
                if ex.code == 429:
                    time.sleep(5); continue
                if ex.code >= 500 and COUNT > 25:
                    break  # deep-page hiccup on a big sub-area; move on
                print(f"\n[warn] code {code} start {start}: HTTP {ex.code}"); break
            except Exception as ex:
                print(f"\n[warn] code {code} start {start}: {ex}"); break

            ents = payload.get("serial-metadata-response", {}).get("entry", [])
            if not ents or (len(ents) == 1 and ents[0].get("error")):
                break
            for e in ents:
                if not isinstance(e, dict) or e.get("error"):
                    continue
                sid = str(e.get("source-id", "")).strip()
                key = sid or (e.get("prism:issn") or e.get("dc:title", ""))
                if key in journals:
                    continue
                ji = (e.get("prism:issn") or "").replace("-", "").strip()
                je = (e.get("prism:eIssn") or "").replace("-", "").strip()
                if existing and ((ji and ji in existing) or (je and je in existing)):
                    continue  # already harvested under another code
                raw_f.write(json.dumps(e) + "\n")
                journals[key] = parse_entry(e, code_name)
                area_n += 1
            start += COUNT
            print(f"\r[{ci}/{len(codes)}] code {code}: +{area_n}  "
                  f"total {len(journals)} journals", end="")
            time.sleep(args.sleep)
            if len(ents) < COUNT:
                break
        print()
    raw_f.close()

    # Write one row per (journal, subject) with the official rank/percentile.
    n_rows = 0
    with open(OUT_CSV, "a" if args.append else "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if not args.append:
            w.writerow(["Source Title", "ISSN", "E-ISSN", "Publisher",
                        "CiteScore", "Subject Area", "Percentile", "Rank"])
        for journal, ranks in journals.values():
            if ranks:
                for code, pct, rank, cs in ranks:
                    w.writerow([journal["title"], journal["issn"], journal["eissn"],
                                journal["publisher"], cs,
                                code_name.get(code, code), pct, rank])
                    n_rows += 1
            else:
                w.writerow([journal["title"], journal["issn"], journal["eissn"],
                            journal["publisher"], journal["citescore"], "", "", ""])
                n_rows += 1
    print(f"\n[done] {len(journals)} journals, {n_rows} rows -> {OUT_CSV}")
    print("Next: python run.py --rebuild")


if __name__ == "__main__":
    main()
