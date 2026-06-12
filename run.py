"""Q1obsessed launcher.  Builds the DB if missing, then serves the site.

    python run.py            # http://127.0.0.1:8000
    python run.py --port 8080
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--rebuild", action="store_true", help="rebuild the database first")
    args = ap.parse_args()

    db = os.path.join(HERE, "q1obsessed.db")
    if args.rebuild or not os.path.exists(db):
        print("Building database…")
        subprocess.check_call([sys.executable, os.path.join(HERE, "scripts", "build_db.py")])

    import uvicorn
    os.chdir(HERE)
    print(f"\n  Q1obsessed -> http://{args.host}:{args.port}\n")
    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
