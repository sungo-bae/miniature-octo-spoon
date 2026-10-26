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

MIGRATION = Path(__file__).parents[1] / "supabase/migrations/20261026000000_silverjob_analytics.sql"


@pytest.fixture()
def db():
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("drop schema if exists public cascade; create schema public;")
        for role in ("anon", "authenticated"):
            conn.execute(f"do $$ begin create role {role}; exception when duplicate_object then null; end $$")
        conn.execute(MIGRATION.read_text())
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
