"""수집 출처 어댑터. 모든 출처는 같은 정규화 레코드 목록을 돌려준다.

정규화 레코드 필드 (DB public.job_postings 와 동일):
  source_id, title, org_name, sido, sigungu, category, employment_type,
  wage_amount, wage_unit, hours_per_week, posted_date, deadline_date, raw
"""
import csv
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from urllib.parse import quote

import requests

FIELDS = [
    "source_id", "title", "org_name", "sido", "sigungu", "category", "employment_type",
    "wage_amount", "wage_unit", "hours_per_week", "posted_date", "deadline_date",
]

# 출처마다 시도 표기가 달라(서울/서울시/서울특별시) 집계가 쪼개지지 않도록 통일한다.
SIDO_ALIASES = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
    "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도", "충북": "충청북도", "충남": "충청남도",
    "전북": "전북특별자치도", "전남": "전라남도", "경북": "경상북도", "경남": "경상남도",
    "제주": "제주특별자치도",
}
OLD_SIDO_NAMES = {"전라북도": "전북특별자치도", "강원도": "강원특별자치도"}
# 광주·전남은 통합되어 노인 구인정보 API가 "전남광주"로 보낸다. 예전 표기도 같은 지역으로 묶는다.
GWANGJU_JEONNAM = "전남광주"


def normalize_sido(value):
    if not value:
        return None
    v = value.strip()
    v = OLD_SIDO_NAMES.get(v, v)
    if v.startswith(("전남광주", "광주", "전남", "전라남")):
        return GWANGJU_JEONNAM
    for short, full in SIDO_ALIASES.items():
        if v == full or v.startswith(short):
            return full
    return v


def parse_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    digits = re.sub(r"\D", "", str(value))[:8]
    if len(digits) != 8:
        return None
    return datetime.strptime(digits, "%Y%m%d").strftime("%Y-%m-%d")


def parse_number(value):
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^\d.]", "", str(value))
    return float(cleaned) if cleaned else None


def normalize(record):
    """출처 필드를 정규화 레코드로 바꾼다. 필수값(source_id, title)이 없으면 None."""
    if not record.get("source_id") or not record.get("title"):
        return None
    out = {k: record.get(k) or None for k in FIELDS}
    out["source_id"] = str(out["source_id"])
    out["sido"] = normalize_sido(out["sido"])
    out["wage_amount"] = parse_number(out["wage_amount"])
    out["hours_per_week"] = parse_number(out["hours_per_week"])
    out["posted_date"] = parse_date(out["posted_date"])
    out["deadline_date"] = parse_date(out["deadline_date"])
    if out["wage_unit"] not in ("hour", "day", "month", "year"):
        out["wage_unit"] = None
    out["raw"] = record.get("raw")
    return out


def from_csv(path):
    """정규화 필드명을 헤더로 쓰는 CSV (수동 적재, 테스트용)."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [r for r in (normalize(dict(row, raw=dict(row))) for row in csv.DictReader(f)) if r]


# ───────────── 한국노인인력개발원 노인 구인정보 (노인일자리여기, 구 100세누리) ─────────────
# https://www.data.go.kr/data/15015153/openapi.do  — XML 응답, 최신 공고부터 정렬

SENURI_URL = "https://apis.data.go.kr/B552474/SenuriService/getJobList"
SENURI_PAGE_SIZE = 100

# 고용형태 코드(emplymShp). emplymShpNm 에도 코드가 그대로 와서 이름은 여기서 붙인다.
EMPLOYMENT = {"CM0101": "정규직", "CM0102": "계약직", "CM0103": "시간제", "CM0104": "일당직", "CM0105": "기타"}


class SourceError(RuntimeError):
    """인증키 오류·호출 한도 초과 등. 목록을 끝까지 못 받았으니 반영하면 안 된다."""


def parse_senuri_xml(text):
    """응답 XML → item 딕셔너리 목록. 오류 응답이면 SourceError."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise SourceError(f"XML이 아닌 응답: {text[:200]!r}") from e
    gateway_err = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg")
    if gateway_err:
        raise SourceError(gateway_err)
    code = root.findtext(".//resultCode")
    if code not in ("00", "0000"):
        raise SourceError(f"resultCode={code} {root.findtext('.//resultMsg') or ''}".strip())
    return [{child.tag: (child.text or "").strip() for child in item} for item in root.iter("item")]


def split_workplace(place):
    """근무지명 "서울 강남구 ..." → (시도, 시군구). 앞의 우편번호는 건너뛴다."""
    if not place:
        return None, None
    words = re.sub(r"^\d{5}\s*", "", place.strip()).split()
    if not words:
        return None, None
    sido = normalize_sido(words[0])
    sigungu = words[1] if len(words) > 1 and words[1].endswith(("시", "군", "구")) else None
    return sido, sigungu


def senuri_is_open(item, today):
    status = item.get("deadline")
    if status and status != "접수중":
        return False
    close = parse_date(item.get("toDd"))
    return close is None or close >= today.isoformat()


def senuri_record(item):
    sido, sigungu = split_workplace(item.get("workPlcNm"))
    return normalize({
        "source_id": item.get("jobId"),
        "title": item.get("recrtTitle"),
        "org_name": item.get("oranNm"),
        "sido": sido,
        "sigungu": sigungu,
        "category": item.get("jobclsNm"),
        "employment_type": EMPLOYMENT.get(item.get("emplymShp")),
        "posted_date": item.get("frDd"),
        "deadline_date": item.get("toDd"),
        "raw": item,
    })


def _get_text(url):
    r = requests.get(url, timeout=60)
    if r.status_code >= 500:
        r.raise_for_status()
    return r.text


def from_senuri(key, today, fetch_text=_get_text, max_pages=20):
    """접수 중인 공고 전체. 목록이 최신순이라 접수 중이 하나도 없는 페이지가 나오면 멈춘다.

    목록에 없는 공고를 마감으로 처리하므로, 한 페이지라도 실패하면 전체를 실패로 본다.
    """
    # 공공데이터포털은 인코딩된 키와 원본 키를 둘 다 주므로 이미 인코딩된 키는 그대로 쓴다
    enc_key = key if re.search(r"%[0-9A-Fa-f]{2}", key) else quote(key, safe="")
    rows = {}
    for page in range(1, max_pages + 1):
        url = f"{SENURI_URL}?serviceKey={enc_key}&pageNo={page}&numOfRows={SENURI_PAGE_SIZE}"
        items = parse_senuri_xml(fetch_text(url))
        open_items = [i for i in items if senuri_is_open(i, today)]
        for item in open_items:
            rec = senuri_record(item)
            if rec:
                rows[rec["source_id"]] = rec
        if len(items) < SENURI_PAGE_SIZE or not open_items:
            break
    return list(rows.values())
