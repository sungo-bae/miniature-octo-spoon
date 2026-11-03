#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""KAMIS 가격정보 API(kamis_api.py)를 실제 서비스키로 호출해 검증하는 스크립트.

이 저장소를 돌리는 샌드박스는 apis.data.go.kr 접속이 막혀 있어 실제
호출을 확인할 수 없다 — 이 스크립트는 사용자 로컬 환경(또는 외부
인터넷이 열려 있는 아무 환경)에서 직접 실행해야 한다.

사용법:
    1. .env.example을 .env로 복사하고 DATA_GO_KR_SERVICE_KEY를 채운다
       (특일정보·기상청과 같은 키를 그대로 쓰면 된다).
    2. pip install -r requirements.txt
    3. python3 tests/integration/verify_kamis_api.py

확인하려는 것:
    - response.header/response.body 응답 봉투 구조 가정이 맞는지
      (docs/algorithm_specification/market_price_features.md "알려진 한계" 참고)
    - exmn_ymd/item_nm/exmn_dd_prc/exmn_dd_cnvs_prc 등 필드명이 실제와 맞는지
    - KamisClient.fetch_period_prices()가 정상적으로 파싱해내는지

여기서 에러가 나거나 결과가 이상하면, 이 스크립트의 "1) 원본 응답" 출력을
그대로 복사해서 알려주면 kamis_api.py를 실제 스키마에 맞게 고칠 수 있다.
"""
import json
import os
import sys
from datetime import date, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)


def _redact_service_key(url: str) -> str:
    """콘솔/로그에 서비스키가 평문으로 남지 않도록 쿼리스트링에서 가린다."""
    import re

    return re.sub(r"(serviceKey=)[^&]+", r"\1***REDACTED***", url)


def _load_dotenv(path: str) -> None:
    """python-dotenv 의존성 없이 .env를 아주 단순하게 읽어 os.environ에 채운다."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


def main() -> None:
    _load_dotenv(os.path.join(REPO_ROOT, ".env"))

    service_key = os.environ.get("DATA_GO_KR_SERVICE_KEY")
    if not service_key:
        print("DATA_GO_KR_SERVICE_KEY가 설정되어 있지 않습니다.")
        print(f"{REPO_ROOT}/.env 파일에 키를 채워주세요 (.env.example 참고).")
        sys.exit(1)

    import requests

    from src.external.kamis_api import BASE_URL, KamisAPIError, KamisClient

    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=13)
    item_code, category_code = "211", "200"  # 배추, 채소류

    print("=" * 70)
    print("1) 원본 응답 확인 (raw request)")
    print("=" * 70)
    raw_params = {
        "serviceKey": service_key,
        "returnType": "JSON",
        "pageNo": "1",
        "numOfRows": "20",
        "cond[exmn_ymd::GTE]": start.strftime("%Y%m%d"),
        "cond[exmn_ymd::LTE]": end.strftime("%Y%m%d"),
        "cond[ctgry_cd::EQ]": category_code,
        "cond[item_cd::EQ]": item_code,
        "cond[se_cd::EQ]": "01",
    }
    try:
        resp = requests.get(BASE_URL, params=raw_params, timeout=10)
        print(f"HTTP 상태코드: {resp.status_code}")
        print(f"요청 URL: {_redact_service_key(resp.url)}")
        try:
            parsed = resp.json()
            print(json.dumps(parsed, ensure_ascii=False, indent=2)[:3000])
        except ValueError:
            print("JSON 파싱 실패 — 원문(앞 2000자):")
            print(resp.text[:2000])
    except requests.RequestException as exc:
        print(f"요청 자체가 실패했습니다: {exc}")
        sys.exit(1)

    print()
    print("=" * 70)
    print("2) KamisClient로 파싱 (kamis_api.py 로직)")
    print("=" * 70)
    try:
        client = KamisClient(service_key=service_key)
        records = client.fetch_period_prices(
            item_code=item_code, category_code=category_code, start=start, end=end
        )
        if not records:
            print("결과가 0건입니다 — 기간을 늘리거나 다른 품목코드로 재시도해보세요.")
        for r in records:
            print(
                f"  {r.exmn_ymd} | {r.item_name}({r.item_code}) {r.variety_name} | "
                f"{r.market_name} | {r.se_name} | 가격 {r.price:,.0f}원/{r.unit} | "
                f"환산가격(참고용, 단위에 따라 원가격과 같을 수 있음) {r.converted_price:,.0f}원"
            )
        print(f"\n총 {len(records)}건 파싱 성공.")
    except KamisAPIError as exc:
        print(f"KamisClient 파싱/호출 실패: {exc}")
        print("위 '1) 원본 응답'을 보고 kamis_api.py의 필드명을 맞춰야 합니다.")
        sys.exit(1)


if __name__ == "__main__":
    main()
