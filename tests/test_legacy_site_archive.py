import csv
import gzip
import json
import subprocess
from pathlib import Path

from pipeline import legacy_site_archive as legacy


def commit(repo, files, msg):
    for name, data in files.items():
        p = Path(repo) / "content" / name
        p.parent.mkdir(exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
    subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg], check=True)


def read(path):
    with gzip.open(path, "rt", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def test_builds_presence_per_commit(tmp_path):
    repo = tmp_path / "site"
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    extra = {"jobs-stats-history.json": {"days": [{"date": "2026-10-02", "total": 2, "byRegion": {"서울": 2},
                                                   "byJob": {"미화": 2}}]},
             "welfare-info.json": {"services": [{"name": "기초연금"}]}}
    a = {"id": "A", "title": "경비", "pay": "월 200만원"}
    b = {"id": "B", "title": "미화"}
    commit(repo, {"jobs-external.json": {"jobs": [a, b], "syncedAt": "2026-10-01T18:00:00Z"}, **extra}, "1")
    # 같은 syncedAt으로 파일만 다시 저장된 경우도 커밋별로 따로 남는다
    commit(repo, {"jobs-external.json": {"jobs": [dict(a, pay="월 210만원")], "syncedAt": "2026-10-01T18:00:00Z"}}, "2")

    m = legacy.build(repo, "HEAD", tmp_path / "out")
    assert m["tables"]["site_work24_syncs.csv.gz"]["rows"] == 2
    presence = read(tmp_path / "out/site_work24_presence.csv.gz")
    assert [p["id"] for p in presence] == ["A", "B", "A"]
    postings = {p["id"]: p for p in read(tmp_path / "out/site_work24_postings.csv.gz")}
    assert postings["A"]["pay"] == "월 210만원"            # 마지막으로 본 값
    assert read(tmp_path / "out/site_daily_stats.csv.gz")[0]["region:서울"] == "2"
    assert (tmp_path / "out/README.md").exists()
    # 같은 기록이면 다시 만들어도 같은 파일
    again = legacy.build(repo, "HEAD", tmp_path / "out2")
    assert again == m
