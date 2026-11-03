"""마이그레이션 + 수집 함수 + 분석 뷰 통합 테스트.

빈 로컬 Postgres가 필요하다:  PG_TEST_DSN=postgresql://postgres@localhost:54329/postgres
(테스트가 public 스키마를 지우고 다시 만든다. 운영 DB에 절대 쓰지 말 것.)
"""
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")
DSN = os.environ.get("PG_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="PG_TEST_DSN not set")

MIGRATIONS = Path(__file__).parents[1] / "supabase/migrations"
MIGRATION = MIGRATIONS / "20261026000000_silverjob_analytics.sql"
# 매일 기록을 공고별 게시 기간으로 바꾼 수집 함수 (pg_cron·Vault가 필요한 나머지 마이그레이션은 싣지 않는다)
SPANS = MIGRATIONS / "20261105000000_posting_spans.sql"


@pytest.fixture()
def db():
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("drop schema if exists public cascade; create schema public;")
        for role in ("anon", "authenticated"):
            conn.execute(f"do $$ begin create role {role}; exception when duplicate_object then null; end $$")
        conn.execute(MIGRATION.read_text())
        conn.execute(SPANS.read_text())
        yield conn


def ingest(db, day, rows, source="test"):
    return db.execute("select public.ingest_postings(%s, %s, %s)",
                      (day, source, json.dumps(rows))).fetchone()[0]


def row(sid, cat="경비·청소", sido="서울특별시"):
    return {"source_id": sid, "title": f"공고 {sid}", "sido": sido, "category": cat,
            "wage_amount": 10030, "wage_unit": "hour", "hours_per_week": 15}


def test_new_close_and_reopen(db):
    d1, d2, d3 = date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 7)
    assert ingest(db, d1, [row("a"), row("b")]) == {"fetched": 2, "new": 2, "closed": 0}
    assert ingest(db, d2, [row("b"), row("c")]) == {"fetched": 2, "new": 1, "closed": 1}
    assert ingest(db, d3, [row("a"), row("c")]) == {"fetched": 2, "new": 0, "closed": 1}

    state = dict(db.execute("select source_id, closed_date from job_postings").fetchall())
    assert state == {"a": None, "b": d3, "c": None}
    first_seen = db.execute("select first_seen_date from job_postings where source_id='a'").fetchone()[0]
    assert first_seen == d1

    flow = db.execute("select day, new_count, closed_count, open_count from v_daily_flow order by day").fetchall()
    # 첫 수집일은 신규로 세지 않는다
    # d2: a 마감, c 신규 / d3: b 마감, a 재게시(신규 아님)
    assert flow == [(d1, 0, 0, 2), (d2, 1, 1, 2), (d3, 0, 1, 2)]


def test_empty_fetch_is_rejected(db):
    ingest(db, date(2026, 1, 5), [row("a")])
    with pytest.raises(psycopg.errors.RaiseException):
        ingest(db, date(2026, 1, 6), [])
    assert db.execute("select closed_date from job_postings").fetchone()[0] is None


def test_closing_is_scoped_to_source(db):
    ingest(db, date(2026, 1, 5), [row("a")], source="s1")
    ingest(db, date(2026, 1, 6), [row("x")], source="s2")
    assert db.execute("select closed_date from job_postings where source='s1'").fetchone()[0] is None


def test_analysis_views(db):
    start = date(2026, 1, 5)
    for i in range(10):
        # 경비는 2일 만에, 공익활동은 계속 열려 있음
        rows = [row(f"g{i}", "경비·청소"), row(f"g{i-1}", "경비·청소"), row("p", "공익활동", "부산광역시")]
        ingest(db, start + timedelta(days=i), [r for r in rows if r["source_id"] != "g-1"])
    db.execute("insert into region_population values ('서울특별시','',2025,1000000), ('부산광역시','',2025,500000)")

    ttc = dict(db.execute("select category, median_days from v_time_to_close").fetchall())
    assert ttc == {"경비·청소": 2}

    idx = {r[0]: r[1:] for r in db.execute(
        "select sido, open_count, per_10k_seniors from v_opportunity_index").fetchall()}
    assert idx["서울특별시"][0] == 2 and idx["부산광역시"][0] == 1

    trend = db.execute("select count(*) from v_weekly_trend").fetchone()[0]
    assert trend > 0
    mix = db.execute("select sum(postings) from v_condition_mix").fetchone()[0]
    assert mix == 3


def test_anon_cannot_call_ingest(db):
    db.execute("set role anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        ingest(db, date(2026, 1, 5), [row("a")])
    db.execute("reset role")


def test_region_filled_by_detail_survives_next_day(db):
    ingest(db, date(2026, 1, 5), [row("a", sido="인천광역시")])
    ingest(db, date(2026, 1, 6), [row("a", sido=None)])  # 다음 날은 상세조회를 건너뜀
    assert db.execute("select sido from job_postings").fetchone()[0] == "인천광역시"


def test_weekly_trend_includes_history_without_double_counting(db):
    ingest(db, date(2026, 1, 5), [dict(row("a"), posted_date="2026-01-05")])
    db.execute("""insert into job_postings_history (source, source_id, sido, posted_date) values
                  ('test', 'a', '서울특별시', '2026-01-05'),
                  ('test', 'old', '서울특별시', '2025-12-29')""")
    trend = db.execute("select week_start, new_count from v_weekly_trend order by 1").fetchall()
    assert trend == [(date(2025, 12, 29), 1), (date(2026, 1, 5), 1)]


def presence(db):
    return set(db.execute("select snapshot_date, p.source_id from v_job_daily_presence v "
                          "join job_postings p on p.id = v.posting_id").fetchall())


def test_spans_record_each_continuous_stretch(db):
    d = [date(2026, 1, 5) + timedelta(days=i) for i in range(4)]
    ingest(db, d[0], [row("a"), row("b")])
    ingest(db, d[1], [row("a")])
    ingest(db, d[2], [row("b")])          # a 내려감, b 다시 올라옴
    ingest(db, d[3], [row("a"), row("b")])
    spans = db.execute("select p.source_id, s.start_date, s.end_date from job_posting_spans s "
                       "join job_postings p on p.id = s.posting_id order by 1, 2").fetchall()
    assert spans == [("a", d[0], d[1]), ("a", d[3], d[3]), ("b", d[0], d[0]), ("b", d[2], d[3])]
    assert presence(db) == {(d[0], "a"), (d[0], "b"), (d[1], "a"), (d[2], "b"), (d[3], "a"), (d[3], "b")}


def test_skipped_collection_day_keeps_stretch(db):
    # 수집을 못 한 날(1/6)은 공고가 내려간 것으로 보지 않는다
    ingest(db, date(2026, 1, 5), [row("a")])
    ingest(db, date(2026, 1, 7), [row("a")])
    assert db.execute("select count(*) from job_posting_spans").fetchone()[0] == 1


def test_same_day_rerun_is_idempotent(db):
    d1, d2 = date(2026, 1, 5), date(2026, 1, 6)
    ingest(db, d1, [row("a"), row("b")])
    ingest(db, d2, [row("a"), row("c")])
    before = (presence(db), db.execute("select * from job_daily_stats order by 1, 2, 3, 4").fetchall())
    ingest(db, d2, [row("a"), row("c")])
    after = (presence(db), db.execute("select * from job_daily_stats order by 1, 2, 3, 4").fetchall())
    assert before == after
    # 다시 받은 결과가 다르면 그 결과로 바뀐다
    ingest(db, d2, [row("b")])
    assert presence(db) == {(d1, "a"), (d1, "b"), (d2, "b")}


def test_older_date_is_rejected(db):
    ingest(db, date(2026, 1, 6), [row("a")])
    with pytest.raises(psycopg.errors.RaiseException):
        ingest(db, date(2026, 1, 5), [row("a")])


def test_snapshots_move_into_spans_unchanged():
    """예전 매일 기록(job_snapshots)이 게시 기간으로 한 줄도 빠짐없이 옮겨지는지."""
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("drop schema if exists public cascade; create schema public;")
        for role in ("anon", "authenticated"):
            conn.execute(f"do $$ begin create role {role}; exception when duplicate_object then null; end $$")
        conn.execute(MIGRATION.read_text())   # 예전 수집 함수로 쌓는다
        days = [date(2026, 1, 5) + timedelta(days=i) for i in range(6)]
        lists = [["a", "b"], ["a"], ["b", "c"], ["a", "b", "c"], ["c"], ["a", "c"]]
        for day, ids in zip(days, lists):
            if day == days[4]:
                continue                       # 하루 수집 실패
            ingest(conn, day, [row(i) for i in ids])
        ingest(conn, days[0], [row("x")], source="other")
        old = set(conn.execute("select snapshot_date, p.source_id from job_snapshots s "
                               "join job_postings p on p.id = s.posting_id").fetchall())
        old_stats = conn.execute("select * from job_daily_stats order by 1, 2, 3, 4").fetchall()
        conn.execute(SPANS.read_text())
        assert conn.execute("select to_regclass('public.job_snapshots')").fetchone()[0] is None
        assert presence(conn) == old
        # 새 함수로 마지막 날을 다시 받아도 일별 집계가 예전 함수와 같다
        ingest(conn, days[5], [row("a"), row("c")])
        assert conn.execute("select * from job_daily_stats order by 1, 2, 3, 4").fetchall() == old_stats
