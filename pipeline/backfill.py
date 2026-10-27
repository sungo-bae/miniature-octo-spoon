"""1회성: API에 남아 있는 과거 공고로 job_postings_history 를 채운다.

수집을 막 시작하면 주간 추세가 몇 주밖에 없어 예측을 할 수 없다. 이 API는 지난 공고도
게시일과 함께 돌려주므로, 과거 1~2년치를 받아 두면 첫날부터 추세와 예측을 쓸 수 있다.

  DATA_GO_KR_SERVICE_KEY=... python -m pipeline.backfill --since 2024-10-01
  DATA_GO_KR_SERVICE_KEY=... python -m pipeline.backfill --source kordi_jobbsn --since 2025-01-01
"""
import argparse
import os
from datetime import date

from pipeline import sources
from pipeline.supabase_rest import SupabaseRest

HISTORY_FIELDS = ["source_id", "title", "sido", "sigungu", "category", "employment_type",
                  "posted_date", "deadline_date"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="kordi", choices=["kordi", "kordi_jobbsn"])
    ap.add_argument("--since", required=True, help="이 날짜 이후 시작된 공고 (YYYY-MM-DD)")
    ap.add_argument("--detail-limit", type=int, default=3000,
                    help="지역이 빈 공고를 상세조회로 보완할 최대 건수 (일일 호출 한도 10,000건)")
    args = ap.parse_args(argv)

    key = os.environ["DATA_GO_KR_SERVICE_KEY"]
    since = date.fromisoformat(args.since)
    if args.source == "kordi_jobbsn":  # 지역이 항상 들어 있어 상세조회가 필요 없다
        rows = sources.from_jobbsn_history(key, since, date.today())
        print(f"과거 공고 {len(rows)}건")
    else:
        rows = sources.from_senuri_history(key, since)
        print(f"과거 공고 {len(rows)}건")
        filled = sources.fill_missing_regions(key, rows, limit=args.detail_limit)
        print(f"상세조회로 지역 보완: {filled}건, 지역 미상: {sum(not r['sido'] for r in rows)}건")

    db = SupabaseRest()
    out = [{"source": args.source, **{k: r[k] for k in HISTORY_FIELDS}} for r in rows]
    for i in range(0, len(out), 500):
        db.upsert("job_postings_history", out[i:i + 500], on_conflict="source,source_id")
    print(f"job_postings_history 에 {len(out)}건 기록")


if __name__ == "__main__":
    main()
