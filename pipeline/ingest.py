"""매일 실행: 출처에서 공고를 받아 Supabase에 하루치 스냅샷으로 반영한다.

  DATA_GO_KR_SERVICE_KEY=... python -m pipeline.ingest --source kordi
  python -m pipeline.ingest --source manual --csv data/postings.csv --run-date 2026-10-26
"""
import argparse
import json
import os
from datetime import date

from pipeline import sources
from pipeline.supabase_rest import SupabaseRest


def dedupe(rows):
    """같은 공고가 여러 페이지에 중복으로 오면 마지막 것만 남긴다."""
    return list({r["source_id"]: r for r in rows}.values())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True,
                    help="kordi = 한국노인인력개발원 노인 구인정보 API, 그 외 이름은 --csv 필요")
    ap.add_argument("--csv", help="정규화 필드명을 헤더로 쓰는 CSV 경로")
    ap.add_argument("--run-date", default=date.today().isoformat())
    args = ap.parse_args(argv)
    run_date = date.fromisoformat(args.run_date)

    if args.csv:
        rows = sources.from_csv(args.csv)
    elif args.source == "kordi":
        rows = sources.from_senuri(os.environ["DATA_GO_KR_SERVICE_KEY"], run_date)
    else:
        ap.error(f"출처 {args.source!r}에는 --csv 가 필요합니다")

    rows = dedupe(rows)
    if not rows:
        raise SystemExit(f"{args.source}: 0건 수집 — 출처 장애로 보고 반영하지 않습니다.")

    result = SupabaseRest().rpc(
        "ingest_postings", p_run_date=args.run_date, p_source=args.source, p_rows=rows)
    print(json.dumps({"run_date": args.run_date, "source": args.source, **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
