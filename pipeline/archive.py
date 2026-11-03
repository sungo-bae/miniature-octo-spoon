"""연구용 월간 보관본: Supabase의 표를 모두 CSV(gzip)로 내보낸다.

  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m pipeline.archive --out archive

매달 GitHub Actions(monthly-archive.yml)가 실행해 비공개 저장소의 릴리스로 올린다.
- 무료 요금제 Supabase에는 자동 백업이 없으므로 이 파일이 백업이다.
- 매번 처음부터 지금까지 전체를 담는다(누적본). 한 달 치 파일 하나만 있어도 그 시점의 자료가 모두 있다.
- manifest.json에 표마다 행 수·SHA-256을 남겨, 논문에서 "몇 월 몇 일 보관본"으로 인용·검증할 수 있게 한다.
- CSV는 UTF-8(BOM 포함)이라 엑셀에서 바로 한글이 보이고, R·Python·SPSS에서도 읽힌다.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import shutil
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .supabase_rest import SupabaseRest

KST = timezone(timedelta(hours=9))

# (표 이름, 정렬 기준) — 정렬해야 페이지를 나눠 읽을 때 빠지거나 겹치는 행이 없다
TABLES = [
    ("job_postings", "id"),
    ("job_posting_spans", "posting_id,start_date"),
    ("ingest_runs", "run_date,source"),
    ("job_daily_stats", "day,source,sido,category"),
    ("job_postings_history", "source,source_id"),
    ("job_forecasts", "generated_on,sido,category,week_start"),
    ("region_population", "sido,sigungu,year"),
    ("apply_clicks", "id"),
]
DOCS = ["docs/DATA_DICTIONARY.md", "docs/DATA_CHANGELOG.md"]


def cell(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


@contextmanager
def open_gzip_text(path):
    """같은 내용이면 언제 만들어도 같은 파일(같은 SHA-256)이 되도록 gzip 머리의 시각·이름을 비운다."""
    with open(path, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz, \
            io.TextIOWrapper(gz, encoding="utf-8-sig", newline="") as f:
        yield f


def write_csv(rows, path):
    """행들을 gzip CSV로 쓰고 열 이름을 돌려준다. 행이 없어도 빈 파일을 만든다."""
    columns = list(rows[0].keys()) if rows else []
    with open_gzip_text(path) as f:
        w = csv.writer(f)
        if columns:
            w.writerow(columns)
            for r in rows:
                w.writerow([cell(r.get(c)) for c in columns])
    return columns


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export(db, out, root=Path(__file__).parents[1], now=None):
    now = now or datetime.now(KST)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"exported_at": now.isoformat(timespec="seconds"), "timezone": "Asia/Seoul", "tables": {}}
    for table, order in TABLES:
        rows = db.select(table, {"order": order})
        path = out / f"{table}.csv.gz"
        columns = write_csv(rows, path)
        manifest["tables"][table] = {"file": path.name, "rows": len(rows), "columns": columns,
                                     "sha256": sha256(path)}
        print(f"{table}: {len(rows):,}행")
    for doc in DOCS:
        src = root / doc
        if src.exists():
            shutil.copy(src, out / src.name)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", default="archive")
    args = p.parse_args(argv)
    export(SupabaseRest(timeout=120), args.out)


if __name__ == "__main__":
    main()
