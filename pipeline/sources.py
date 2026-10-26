"""수집 출처 어댑터. 모든 출처는 같은 정규화 레코드 목록을 돌려준다.

정규화 레코드 필드 (DB public.job_postings 와 동일):
  source_id, title, org_name, sido, sigungu, category, employment_type,
  wage_amount, wage_unit, hours_per_week, posted_date, deadline_date, raw
"""
import csv
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
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
SIDO_NAMES = set(SIDO_ALIASES.values()) - {"광주광역시", "전라남도"} | {GWANGJU_JEONNAM}


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
SENURI_DETAIL_URL = "https://apis.data.go.kr/B552474/SenuriService/getJobInfo"
SENURI_PAGE_SIZE = 100

# 고용형태 코드(emplymShp). emplymShpNm 에도 코드가 그대로 와서 이름은 여기서 붙인다.
EMPLOYMENT = {"CM0101": "정규직", "CM0102": "계약직", "CM0103": "시간제", "CM0104": "일당직", "CM0105": "기타"}

# 직종(jobclsNm)은 워크넷 연계 공고 대부분에서 비어 있어 제목 키워드로 분류한다.
# 앞에서부터 처음 맞는 직종을 쓴다 ("시설 경비" → 경비, "미화원 및 운전원" → 청소).
CATEGORY_KEYWORDS = [
    ("청소·미화", ("미화", "청소", "룸메이드", "환경정리", "세탁")),
    ("경비·보안", ("경비", "보안", "경호", "안전요원", "주차관리")),
    ("조리·급식", ("조리", "주방", "식당", "급식", "배식", "찬모", "세척")),
    ("돌봄·복지", ("요양", "돌봄", "간병", "보호사", "활동지원", "복지", "보육", "간호", "치료사")),
    ("운전·배송", ("운전", "배송", "택배", "배달", "수발", "셔틀", "지게차", "승무")),
    ("시설관리·기술", ("시설", "기계", "전기", "설비", "영선", "보일러", "수리", "정비", "CNC", "선반", "기사",
                     "관리인", "관리원")),
    ("생산·물류", ("생산", "제조", "포장", "조립", "공장", "물류", "현장", "검사", "제본", "재단", "농장")),
    ("사무·전문", ("사무", "경리", "회계", "총무", "행정", "상담", "안내", "접수", "간사", "영업", "마케팅",
                  "디자인", "개발자", "설계", "기획", "편집", "조사관")),
    ("판매·서비스", ("판매", "매장", "캐셔", "계산원", "바리스타", "카페", "사우나", "프런트", "프론트", "홀서비스")),
]


def classify_category(title):
    for category, words in CATEGORY_KEYWORDS:
        if any(w in title for w in words):
            return category
    return "기타"


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
    """근무지명·주소 "서울 강남구 ..." → (시도, 시군구). 앞의 우편번호(12345, 123-456)는 건너뛴다."""
    if not place:
        return None, None
    words = re.sub(r"^(\d{5}|\d{3}-\d{3})\s*", "", place.strip()).split()
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
    if sido not in SIDO_NAMES:  # 예전 공고는 "중구"처럼 시군구만 오기도 한다 → 상세 주소로 보완
        sido, sigungu = None, None
    title = item.get("recrtTitle") or ""
    return normalize({
        "source_id": item.get("jobId"),
        "title": title,
        "org_name": item.get("oranNm"),
        "sido": sido,
        "sigungu": sigungu,
        "category": classify_category(title),
        "employment_type": EMPLOYMENT.get(item.get("emplymShp")),
        "posted_date": item.get("frDd"),
        "deadline_date": item.get("toDd"),
        "raw": item,
    })


def _get_text(url, tries=4):
    """공공데이터포털은 연결이 간헐적으로 끊겨서 몇 번 다시 시도한다."""
    for attempt in range(1, tries + 1):
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            return r.text
        except requests.RequestException:
            if attempt == tries:
                raise
            time.sleep(2 ** attempt)


def _encode_key(key):
    # 공공데이터포털은 인코딩된 키와 원본 키를 둘 다 주므로 이미 인코딩된 키는 그대로 쓴다
    return key if re.search(r"%[0-9A-Fa-f]{2}", key) else quote(key, safe="")


def _list_page(key, page, fetch_text):
    url = f"{SENURI_URL}?serviceKey={_encode_key(key)}&pageNo={page}&numOfRows={SENURI_PAGE_SIZE}"
    return parse_senuri_xml(fetch_text(url))


def from_senuri(key, today, fetch_text=_get_text, max_pages=30, empty_pages_to_stop=2):
    """접수 중인 공고 전체.

    목록이 시작접수일 최신순이라, 접수 중인 공고가 없는 페이지가 연달아 나오면 멈춘다
    (접수기간이 긴 예전 공고를 놓치지 않도록 한 페이지로는 멈추지 않는다).
    목록에 없는 공고를 마감으로 처리하므로, 한 페이지라도 실패하면 전체를 실패로 본다.
    """
    rows, empty_streak = {}, 0
    for page in range(1, max_pages + 1):
        items = _list_page(key, page, fetch_text)
        open_items = [i for i in items if senuri_is_open(i, today)]
        for item in open_items:
            rec = senuri_record(item)
            if rec:
                rows[rec["source_id"]] = rec
        empty_streak = 0 if open_items else empty_streak + 1
        if len(items) < SENURI_PAGE_SIZE or empty_streak >= empty_pages_to_stop:
            break
    return list(rows.values())


def from_senuri_history(key, since, fetch_text=_get_text, max_pages=500):
    """since 이후 시작된 공고 전체(마감 포함). 예측 모델의 과거 추세를 채우는 1회성 보충용."""
    rows = {}
    for page in range(1, max_pages + 1):
        items = _list_page(key, page, fetch_text)
        for item in items:
            rec = senuri_record(item)
            if rec and rec["posted_date"] and rec["posted_date"] >= since.isoformat():
                rows[rec["source_id"]] = rec
        oldest = min((parse_date(i.get("frDd")) or "9999" for i in items), default="")
        if len(items) < SENURI_PAGE_SIZE or oldest < since.isoformat():
            break
    return list(rows.values())


def _detail_address(key, job_id, fetch_text):
    url = f"{SENURI_DETAIL_URL}?serviceKey={_encode_key(key)}&id={quote(job_id)}"
    items = parse_senuri_xml(fetch_text(url))
    return items[0].get("plDetAddr") if items else None


def fill_missing_regions(key, rows, fetch_text=_get_text, limit=500, max_failures=10, workers=8):
    """근무지가 비어 있는 공고는 상세조회(getJobInfo)의 사업장 주소로 시도·시군구를 채운다.

    상세조회는 건당 수 초씩 걸려 동시에 여러 건을 조회한다 (API 한도 30 tps).
    실패한 공고는 지역 미상으로 남기고 넘어가되, 실패가 쌓이면 키·한도 문제로 보고 멈춘다.
    반환: 지역을 채운 공고 수
    """
    targets = [r for r in rows if not r["sido"]][:limit]
    filled = failures = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start in range(0, len(targets), workers * 4):
            batch = targets[start:start + workers * 4]
            futures = {pool.submit(_detail_address, key, r["source_id"], fetch_text): r for r in batch}
            for fut, rec in futures.items():
                try:
                    address = fut.result()
                except (SourceError, requests.RequestException):
                    failures += 1
                    continue
                sido, sigungu = split_workplace(address)
                if sido in SIDO_NAMES:
                    rec["sido"], rec["sigungu"] = sido, sigungu
                    rec["raw"] = {**(rec["raw"] or {}), "region_from": "detail_address", "plDetAddr": address}
                    filled += 1
            if failures >= max_failures:
                break
    return filled
