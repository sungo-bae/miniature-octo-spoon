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
    ("요양·간병", ("요양보호", "요양원", "요양병원", "간병", "보호사")),
    ("간호·치료", ("간호", "치료사", "물리치료", "작업치료")),
    ("돌봄·복지", ("요양", "돌봄", "활동지원", "복지", "보육")),
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


# ───────────── 한국노인인력개발원 자립형일자리 사업모집공고 (노인일자리 업무시스템) ─────────────
# 정부 노인일자리 사업(시장형·인턴십 등)의 참여자 모집. XML 응답, 연도(projYear)별 전체 목록.
# 모집중 공고가 모든 페이지에 흩어져 있어 해당 연도 목록을 끝까지 받은 뒤 고른다.

JOBBSN_URL = "https://apis.data.go.kr/B552474/JobBsnInfoService/getJobBsnRecruitList"
JOBBSN_PAGE_SIZE = 1000
JOBBSN_EMPLOYMENT = "노인일자리 사업"
PLACEHOLDER = "수행기관문의"


def jobbsn_record(item):
    place = item.get("workPlace")
    org = item.get("orgName")
    place = None if place == PLACEHOLDER else place
    return normalize({
        "source_id": item.get("projNo"),
        "title": f"{place or org} 참여자 모집" if (place or org) else None,
        "org_name": org,
        "sido": normalize_sido(item.get("dstrCd1Nm")),
        "sigungu": item.get("dstrCd2Nm") or None,
        "category": classify_category(f"{place or ''} {org or ''}"),
        "employment_type": JOBBSN_EMPLOYMENT,
        "posted_date": item.get("hpNotiSdate"),
        "deadline_date": item.get("hpNotiEdate"),
        "raw": item,  # 모집인원(hpInvtCnt) 등 원본 필드 보존
    })


def _jobbsn_year(key, year, fetch_text, max_pages=200):
    items = []
    for page in range(1, max_pages + 1):
        url = (f"{JOBBSN_URL}?serviceKey={_encode_key(key)}&pageNo={page}"
               f"&numOfRows={JOBBSN_PAGE_SIZE}&projYear={year}")
        batch = parse_senuri_xml(fetch_text(url))
        items += batch
        if len(batch) < JOBBSN_PAGE_SIZE:
            return items
    raise SourceError(f"자립형일자리 {year}년 목록이 {max_pages}페이지를 넘었습니다")


def from_jobbsn(key, today, fetch_text=_get_text):
    """모집중인 자립형일자리 공고 전체. 연초에는 지난해 사업의 모집도 남아 있어 함께 본다.

    목록에 없는 공고를 마감으로 처리하므로, 한 페이지라도 실패하면 전체를 실패로 본다.
    """
    years = [today.year - 1, today.year] if today.month <= 3 else [today.year]
    rows = {}
    for year in years:
        for item in _jobbsn_year(key, year, fetch_text):
            if item.get("trnStatNm") == "모집중":
                rec = jobbsn_record(item)
                if rec:
                    rows[rec["source_id"]] = rec
    return list(rows.values())


def from_jobbsn_history(key, since, today, fetch_text=_get_text):
    """since 이후 모집을 시작한 공고 전체(완료 포함). 과거 추세 보충용."""
    rows = {}
    for year in range(since.year, today.year + 1):
        for item in _jobbsn_year(key, year, fetch_text):
            rec = jobbsn_record(item)
            if rec and rec["posted_date"] and since.isoformat() <= rec["posted_date"] <= today.isoformat():
                rows[rec["source_id"]] = rec
    return list(rows.values())


# ───────────── 고용24(워크넷) 채용정보 — (준)고령자 우대 공고 ─────────────
# 사이트(netlify/functions/sync-work24-jobs.mjs)와 같은 조건·필터로 받되, 시간 제한 없이
# 조건에 맞는 공고 전체를 받는다. 사이트 함수는 15초 안에 받은 만큼만 저장해서 날마다
# 총계가 흔들렸다(일자리가 줄어든 게 아니라 덜 받은 것).

WORK24_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do"
WORK24_PAGE_SIZE = 100
WORK24_MAX_PAGES = 400
WORK24_EMPLOYMENT = "민간 일자리(고용24)"

# 사이트와 같은 보조 필터: 제목만으로 시니어 일자리와 무관하다고 확신할 수 있는 공고
WORK24_UNRELATED = re.compile(
    r"어린이집|유치원|보육교사|보육사|수영강사|생산직|생산팀|품질관리|자동화설비|토목|엔지니어|시공|"
    r"건설산업안전|산업안전관리자|공장|폐수처리|기술영업|영업관리|현장관리자|설계")
# 사이트의 6개 카테고리 중 하나에 들어야 사이트 목록에 오른다 (mapJobCategory)
WORK24_SITE_CATEGORY = re.compile(
    r"경비|보안|주차|지킴이|청소|미화|환경|조리|급식|주방|영양사|사무|행정|접수|안내|"
    r"시설|아파트|건물|빌딩|관리사무소|주택관리|공동주택|공헌|봉사|돌봄|복지|요양|간병|보호사")
# 고용24 공식 직종분류코드(jobsCd) 앞 3자리 → 직종. 사이트가 "사회공헌" 세부분류에 쓰는 매핑을
# 실제 일 이름으로 옮겼다. 매핑에 없으면 제목 키워드로 분류한다.
WORK24_JOBS_CD = {
    "550": "요양·간병",
    "231": "돌봄·복지",   # 사회복지사
    "232": "돌봄·복지",   # 노인맞춤돌봄·생활지원
    "304": "간호·치료",   # 간호사
    "306": "간호·치료",   # 물리·작업치료사
    "307": "간호·치료",   # 간호조무사·병동보조
    "561": "청소·미화",   # 요양시설 위생관리
}
WAGE_UNITS = {"시급": "hour", "일급": "day", "주급": "week", "월급": "month", "연봉": "year"}


def parse_work24_date(value):
    """고용24 날짜는 "26-10-02"처럼 연도가 두 자리다. "채용시까지"는 마감일이 아니다(상시)."""
    if not value or "채용시까지" in value:
        return None
    m = re.search(r"(\d{2,4})-(\d{2})-(\d{2})", value) or re.search(r"(\d{4})(\d{2})(\d{2})", value)
    if not m:
        return None
    year = m[1] if len(m[1]) == 4 else "20" + m[1]
    return f"{year}-{m[2]}-{m[3]}"


def parse_work24_wage(sal, sal_type):
    """"338만원", "10320원", "280만원 ~ 300만원" → (금액, 단위). 범위는 낮은 쪽.

    단위(salTpNm)가 없으면 금액 크기로 추정한다: 5만 원 미만 시급, 30만 원 미만 일급,
    1천만 원 미만 월급, 그 이상 연봉.
    """
    if not sal:
        return None, None
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*(만)?\s*원", sal)
    if not m:
        return None, None
    amount = float(m[1].replace(",", "")) * (10000 if m[2] else 1)
    unit = next((u for k, u in WAGE_UNITS.items() if k in (sal_type or "")), None)
    if unit == "week":
        amount, unit = amount / 5, "day"
    if unit is None:
        unit = "hour" if amount < 50000 else "day" if amount < 300000 else "month" if amount < 10_000_000 else "year"
    return amount, unit


def _work24_items(text):
    """응답 XML → (total, <wanted> 항목 목록). 형식이 다르면 SourceError."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise SourceError(f"고용24: XML이 아닌 응답: {text[:200]!r}") from e
    items = [{c.tag: (c.text or "").strip() for c in w} for w in root.iter("wanted")]
    total = root.findtext(".//total")
    if total is None:
        msg = root.findtext(".//message") or root.findtext(".//errMsg") or text[:200]
        raise SourceError(f"고용24 오류 응답: {msg}")
    return int(total or 0), items


def work24_record(item):
    title = item.get("title") or ""
    if WORK24_UNRELATED.search(title) or not WORK24_SITE_CATEGORY.search(title):
        return None
    sido, sigungu = split_workplace(item.get("region"))
    if sido not in SIDO_NAMES:
        sido, sigungu = split_workplace(item.get("basicAddr"))
        if sido not in SIDO_NAMES:
            sido, sigungu = None, None
    category = WORK24_JOBS_CD.get((item.get("jobsCd") or "")[:3]) or classify_category(title)
    wage, unit = parse_work24_wage(item.get("sal"), item.get("salTpNm"))
    return normalize({
        "source_id": item.get("wantedAuthNo"),
        "title": title,
        "org_name": item.get("company"),
        "sido": sido,
        "sigungu": sigungu,
        "category": category,
        "employment_type": WORK24_EMPLOYMENT,
        "wage_amount": wage,
        "wage_unit": unit,
        "posted_date": parse_work24_date(item.get("regDt")),
        "deadline_date": parse_work24_date(item.get("closeDt")),
        "raw": item,
    })


def from_work24(key, today, fetch_text=_get_text, workers=8):
    """조건에 맞는 고용24 공고 전체 (마감일이 지난 공고 제외).

    목록에 없는 공고를 마감으로 처리하므로, 받은 건수가 고용24가 알려준 전체 건수에 크게
    못 미치거나 한 페이지라도 실패하면 전체를 실패로 본다.
    """
    def page_url(page):
        return (f"{WORK24_URL}?authKey={quote(key, safe='')}&callTp=L&returnType=XML"
                f"&startPage={page}&display={WORK24_PAGE_SIZE}&pfPreferential=8")

    total, first = _work24_items(fetch_text(page_url(1)))
    pages = min(-(-total // WORK24_PAGE_SIZE), WORK24_MAX_PAGES)
    items = list(first)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _, batch in pool.map(lambda p: _work24_items(fetch_text(page_url(p))), range(2, pages + 1)):
            items += batch
    if total and len(items) < min(total, pages * WORK24_PAGE_SIZE) * 0.95:
        raise SourceError(f"고용24: 전체 {total}건 중 {len(items)}건만 받았습니다")

    rows = {}
    for item in items:
        rec = work24_record(item)
        if rec and (rec["deadline_date"] is None or rec["deadline_date"] >= today.isoformat()):
            rows[rec["source_id"]] = rec
    return list(rows.values())
