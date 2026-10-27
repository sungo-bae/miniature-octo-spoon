from datetime import date

import pytest

from pipeline import ingest
from pipeline.sources import SourceError, from_work24, parse_work24_wage, work24_record


def wanted(i, title="아파트 경비원 모집", region="서울 강남구", jobs_cd="530101", sal="10320원",
           sal_type="시급", reg="26-10-25", close="26-11-30"):
    return {"wantedAuthNo": f"K{i:015d}", "title": title, "company": "OO관리", "region": region,
            "jobsCd": jobs_cd, "sal": sal, "salTpNm": sal_type, "regDt": reg, "closeDt": close,
            "holidayTpNm": "주5일근무", "basicAddr": "서울특별시 강남구 테헤란로 1"}


def work24_xml(items, total=None):
    body = "".join("<wanted>" + "".join(f"<{k}>{v}</{k}>" for k, v in it.items()) + "</wanted>" for it in items)
    return f"<wantedRoot><total>{len(items) if total is None else total}</total>{body}</wantedRoot>"


def test_record_maps_fields_like_the_site():
    r = work24_record(wanted(1))
    assert (r["source_id"], r["sido"], r["sigungu"], r["category"]) == ("K000000000000001", "서울특별시", "강남구", "경비·보안")
    assert (r["wage_amount"], r["wage_unit"]) == (10320.0, "hour")
    assert (r["posted_date"], r["deadline_date"]) == ("2026-10-25", "2026-11-30")
    assert r["raw"]["holidayTpNm"] == "주5일근무"


def test_record_uses_official_job_code_for_care_work():
    r = work24_record(wanted(2, title="OO요양원 요양보호사 채용", jobs_cd="550100"))
    assert r["category"] == "요양·간병"
    assert work24_record(wanted(3, title="병동 간호조무사 (요양 병원)", jobs_cd="307000"))["category"] == "간호·치료"


def test_record_applies_the_sites_senior_filters():
    assert work24_record(wanted(4, title="어린이집 보육교사 모집")) is None   # 시니어와 무관
    assert work24_record(wanted(5, title="CNC 선반 가공")) is None          # 사이트 6개 분류 밖


def test_open_ended_deadline_and_monthly_wage():
    r = work24_record(wanted(6, close="채용시까지 26-10-16", sal="280만원 ~ 300만원", sal_type=""))
    assert r["deadline_date"] is None
    assert (r["wage_amount"], r["wage_unit"]) == (2800000.0, "month")
    assert parse_work24_wage("120000원", "") == (120000.0, "day")


def test_from_work24_reads_every_page_and_drops_expired():
    items = [wanted(i) for i in range(250)] + [wanted(999, close="26-10-01")]
    pages = {p: work24_xml(items[(p - 1) * 100:p * 100], total=len(items)) for p in (1, 2, 3)}
    calls = []

    def fetch(url):
        assert "pfPreferential=8" in url and "authKey=k%2B%2F%3D&" in url
        page = int(url.split("startPage=")[1].split("&")[0])
        calls.append(page)
        return pages[page]

    rows = from_work24("k+/=", date(2026, 10, 27), fetch_text=fetch, workers=2)
    assert sorted(calls) == [1, 2, 3]
    assert len(rows) == 250


def test_from_work24_fails_when_pages_are_missing():
    pages = {1: work24_xml([wanted(i) for i in range(100)], total=300),
             2: work24_xml([], total=300), 3: work24_xml([], total=300)}
    with pytest.raises(SourceError):
        from_work24("k", date(2026, 10, 27), fetch_text=lambda u: pages[int(u.split("startPage=")[1].split("&")[0])])


def test_from_work24_raises_on_error_response():
    with pytest.raises(SourceError):
        from_work24("k", date(2026, 10, 27), fetch_text=lambda u: "<error><message>인증키 오류</message></error>")


class FakeDB:
    def __init__(self, previous):
        self.previous, self.rpc_called = previous, False

    def select(self, table, params=None):
        if table == "ingest_runs":
            return [{"fetched_count": self.previous}] if self.previous else []
        return []

    def rpc(self, fn, **kw):
        self.rpc_called = True
        return {"fetched": len(kw["p_rows"]), "new": 0, "closed": 0}


@pytest.mark.parametrize("previous, refused", [(1000, True), (300, False), (None, False)])
def test_ingest_refuses_sudden_drop(monkeypatch, previous, refused):
    db = FakeDB(previous)
    monkeypatch.setattr(ingest, "SupabaseRest", lambda: db)
    monkeypatch.setenv("WORK24_API_KEY", "k")
    monkeypatch.setattr(ingest.sources, "from_work24", lambda key, d: [work24_record(wanted(i)) for i in range(400)])
    if refused:
        with pytest.raises(SystemExit):
            ingest.main(["--source", "work24", "--run-date", "2026-10-27"])
        assert not db.rpc_called
    else:
        ingest.main(["--source", "work24", "--run-date", "2026-10-27"])
        assert db.rpc_called
