from pipeline.ingest import dedupe
from pipeline.sources import normalize, normalize_sido, parse_date, parse_number


def test_normalize_sido_variants():
    assert normalize_sido("서울") == "서울특별시"
    assert normalize_sido("서울시") == "서울특별시"
    assert normalize_sido("경기도") == "경기도"
    assert normalize_sido("강원도") == "강원특별자치도"
    assert normalize_sido("전라북도") == "전북특별자치도"
    assert normalize_sido("전라남도") == "전라남도"
    assert normalize_sido("") is None


def test_parse_date_and_number():
    assert parse_date("20261026") == "2026-10-26"
    assert parse_date("2026.10.26") == "2026-10-26"
    assert parse_date("상시") is None
    assert parse_number("1,030,000원") == 1030000.0
    assert parse_number("협의") is None


def test_normalize_requires_id_and_title():
    assert normalize({"title": "x"}) is None
    rec = normalize({"source_id": 7, "title": "경비", "sido": "부산", "wage_unit": "시급"})
    assert rec["source_id"] == "7"
    assert rec["sido"] == "부산광역시"
    assert rec["wage_unit"] is None


def test_dedupe_keeps_last():
    rows = [{"source_id": "1", "title": "a"}, {"source_id": "1", "title": "b"}]
    assert dedupe(rows) == [{"source_id": "1", "title": "b"}]
