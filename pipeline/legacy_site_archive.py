"""수집 시작 전 실버잡 사이트 자료를 사이트 저장소 git 기록에서 꺼내 CSV(gzip)로 만든다 (1회성).

  python -m pipeline.legacy_site_archive --site-repo . --ref origin/main --out legacy

사이트(main 브랜치)의 content/jobs-external.json은 Netlify 함수가 고용24에서 받은 공고를
하루 2~3번 덮어써 왔다(2026-09-27 ~ 2026-11-03). 커밋마다 파일을 읽어 그때 있던 공고를 남긴다.
자료의 뜻과 한계는 docs/legacy/README.md (보관본에 함께 들어간다).
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import shutil
from contextlib import contextmanager
import subprocess
from pathlib import Path


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True).stdout

@contextmanager
def open_gzip_text(path):
    """같은 내용이면 언제 만들어도 같은 파일(같은 SHA-256)이 되도록 gzip 머리의 시각·이름을 비운다."""
    with open(path, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz, \
            io.TextIOWrapper(gz, encoding="utf-8-sig", newline="") as f:
        yield f


def write_csv(path, rows):
    columns = []
    for r in rows:
        columns += [k for k in r if k not in columns]
    with open_gzip_text(path) as f:
        w = csv.writer(f)
        w.writerow(columns)
        for r in rows:
            w.writerow([json.dumps(r[c], ensure_ascii=False) if isinstance(r.get(c), (dict, list)) else r.get(c)
                        for c in columns])
    return len(rows)


def job_key(j):
    return j.get("id") or j.get("applyUrl") or f"{j.get('title')}|{j.get('company')}"


def build(repo, ref, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    log = git(repo, "log", ref, "--reverse", "--format=%H %cI", "--", "content/jobs-external.json").decode()
    syncs, presence, postings = [], [], {}
    for line in filter(None, log.splitlines()):
        commit, committed_at = line.split()
        data = json.loads(git(repo, "show", f"{commit}:content/jobs-external.json"))
        jobs = data.get("jobs", []) if isinstance(data, dict) else data
        synced_at = (data.get("syncedAt") if isinstance(data, dict) else None) or committed_at
        syncs.append({"commit": commit, "synced_at": synced_at, "committed_at": committed_at, "job_count": len(jobs)})
        seen = set()
        for j in jobs:
            key = job_key(j)
            if key in seen:
                continue
            seen.add(key)
            presence.append({"commit": commit, "id": key})
            if key in postings:
                postings[key].update(j)
                postings[key].update(id=key, last_synced_at=synced_at)
            else:
                postings[key] = {**j, "id": key, "first_synced_at": synced_at, "last_synced_at": synced_at}

    stats = json.loads(git(repo, "show", f"{ref}:content/jobs-stats-history.json"))
    daily = [{"date": d["date"], "total": d["total"],
              **{f"region:{k}": v for k, v in d.get("byRegion", {}).items()},
              **{f"job:{k}": v for k, v in d.get("byJob", {}).items()},
              **{f"social:{k}": v for k, v in d.get("bySocialSubcategory", {}).items()}} for d in stats["days"]]
    welfare = json.loads(git(repo, "show", f"{ref}:content/welfare-info.json"))["services"]

    files = {
        "site_work24_syncs.csv.gz": syncs,
        "site_work24_presence.csv.gz": presence,
        "site_work24_postings.csv.gz": list(postings.values()),
        "site_daily_stats.csv.gz": daily,
        "welfare_services.csv.gz": welfare,
    }
    manifest = {"source": f"site repository {ref}", "tables": {}}
    for name, rows in files.items():
        write_csv(out / name, rows)
        manifest["tables"][name] = {"rows": len(rows),
                                    "sha256": hashlib.sha256((out / name).read_bytes()).hexdigest()}
        print(f"{name}: {len(rows):,}행")
    shutil.copy(Path(__file__).parents[1] / "docs/legacy/README.md", out / "README.md")
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--site-repo", default=".")
    p.add_argument("--ref", default="origin/main")
    p.add_argument("--out", default="legacy")
    args = p.parse_args(argv)
    build(args.site_repo, args.ref, args.out)


if __name__ == "__main__":
    main()
