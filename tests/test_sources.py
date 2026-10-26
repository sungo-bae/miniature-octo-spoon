from datetime import date

import pytest

from pipeline.ingest import dedupe
from pipeline.sources import (SourceError, from_senuri, normalize, normalize_sido, parse_date,
                              parse_number, split_workplace)


def test_normalize_sido_variants():
    assert normalize_sido("서울") == "서울특별시"
    assert normalize_sido("서울시") == "서울특별시"
    assert normalize_sido("경기도") == "경기도"
    assert normalize_sido("강원도") == "강원특별자치도"
    assert normalize_sido("전라북도") == "전북특별자치도"
    assert normalize_sido("전라남도") == "전남광주"
    assert normalize_sido("광주광역시") == "전남광주"
    assert normalize_sido("전남광주") == "전남광주"
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


# ───────────── 노인 구인정보 API (XML) ─────────────

def senuri_xml(items, code="00"):
    body = "".join(
        "<item>" + "".join(f"<{k}>{v}</{k}>" for k, v in it.items()) + "</item>" for it in items)
    return (f"<?xml version='1.0' encoding='UTF-8'?><response><header><resultCode>{code}</resultCode>"
            f"<resultMsg>OK</resultMsg></header><body><items>{body}</items></body></response>")


def job(i, status="접수중", to="20261231", place="서울 강남구 역삼동"):
    return {"jobId": f"J{i}", "recrtTitle": f"경비원 모집 &amp; 우대 {i}", "oranNm": "OO관리",
            "workPlcNm": place, "jobclsNm": "경비원", "emplymShp": "CM0103",
            "deadline": status, "frDd": "20261020", "toDd": to}


def test_split_workplace():
    assert split_workplace("06236 서울 강남구 테헤란로") == ("서울특별시", "강남구")
    assert split_workplace("경기도 성남시 분당구") == ("경기도", "성남시")
    assert split_workplace("광주 북구") == ("전남광주", "북구")
    assert split_workplace("본사") == ("본사", None)
    assert split_workplace(None) == (None, None)


def test_from_senuri_filters_open_and_stops_at_closed_page():
    pages = {
        1: senuri_xml([job(i) for i in range(99)] + [job(99, status="마감")]),
        2: senuri_xml([job(100 + i, to="20261001") for i in range(100)]),  # 접수기간 지남
        3: senuri_xml([job(200 + i, to="20261001") for i in range(100)]),  # 두 번 연속 → 여기서 멈춤
        4: senuri_xml([job(999)]),
    }
    calls = []

    def fetch(url):
        calls.append(url)
        return pages[int(url.split("pageNo=")[1].split("&")[0])]

    rows = from_senuri("a+b/c==", date(2026, 10, 26), fetch_text=fetch)
    assert len(rows) == 99
    assert len(calls) == 3
    assert "serviceKey=a%2Bb%2Fc%3D%3D&" in calls[0]
    r = rows[0]
    assert r["title"] == "경비원 모집 & 우대 0"
    assert (r["sido"], r["sigungu"], r["category"], r["employment_type"]) == ("서울특별시", "강남구", "경비·보안", "시간제")
    assert (r["posted_date"], r["deadline_date"]) == ("2026-10-20", "2026-12-31")


def test_from_senuri_keeps_encoded_key():
    seen = []
    from_senuri("abc%2B%3D", date(2026, 10, 26), fetch_text=lambda u: seen.append(u) or senuri_xml([job(1)]))
    assert "serviceKey=abc%2B%3D&" in seen[0]


@pytest.mark.parametrize("body", [
    "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>"
    "<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
    senuri_xml([], code="22"),
    "Unexpected errors",
])
def test_from_senuri_raises_on_api_error(body):
    with pytest.raises(SourceError):
        from_senuri("k", date(2026, 10, 26), fetch_text=lambda u: body)


def detail_xml(address):
    return senuri_xml([{"jobId": "x", "plDetAddr": address}])


def test_classify_category():
    from pipeline.sources import classify_category
    assert classify_category("[반송동] 아파트 외곽 미화원 구인") == "청소·미화"
    assert classify_category("아파트형 공장 시설 경비 채용") == "경비·보안"
    assert classify_category("대연동 요양보호사님 모십니다.") == "돌봄·복지"
    assert classify_category("구내식당 주방보조/세척원 모집") == "조리·급식"
    assert classify_category("(주) 대보 정직원 채용공고") == "기타"


def test_unknown_list_region_is_left_for_detail():
    from pipeline.sources import senuri_record
    assert senuri_record(job(1, place="중구"))["sido"] is None


def test_fill_missing_regions_uses_detail_address():
    from pipeline.sources import fill_missing_regions, senuri_record
    rows = [senuri_record(job(1, place="")), senuri_record(job(2, place="")), senuri_record(job(3))]
    addresses = {"J1": "405-825 인천광역시 남동구 논고개로 17", "J2": "해외"}

    def fetch(url):
        assert "getJobInfo" in url
        return detail_xml(addresses[url.split("id=")[1]])

    assert fill_missing_regions("k", rows, fetch_text=fetch) == 1
    assert (rows[0]["sido"], rows[0]["sigungu"]) == ("인천광역시", "남동구")
    assert rows[1]["sido"] is None
    assert rows[2]["sido"] == "서울특별시"


def test_fill_missing_regions_stops_after_repeated_failures():
    from pipeline.sources import fill_missing_regions, senuri_record
    rows = [senuri_record(job(i, place="")) for i in range(100)]
    calls = []

    def fetch(url):
        calls.append(url)
        return "<OpenAPI_ServiceResponse><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>"

    assert fill_missing_regions("k", rows, fetch_text=fetch, max_failures=3, workers=2) == 0
    assert len(calls) == 8  # 첫 묶음(2×4)만 시도하고 멈춤


def test_from_senuri_history_stops_before_since():
    from pipeline.sources import from_senuri_history
    pages = {1: senuri_xml([dict(job(i), frDd="20261001", deadline="마감") for i in range(100)]),
             2: senuri_xml([dict(job(100 + i), frDd="20250101") for i in range(100)]),
             3: senuri_xml([job(999)])}
    rows = from_senuri_history("k", date(2025, 6, 1),
                               fetch_text=lambda u: pages[int(u.split("pageNo=")[1].split("&")[0])])
    assert len(rows) == 100
