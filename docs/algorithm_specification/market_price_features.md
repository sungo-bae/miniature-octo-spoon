# 설계문서: KAMIS 농산물 가격 피처 (kamis_api, market_price_features)

> 6.3절 보완 B7 "문서화 의무"에 따라, 병합 전 설계문서와 단위테스트를 필수로
> 작성한다. AI·최적화 선임연구원은 이 문서를 리뷰·갱신하며 실증데이터 적용
> 시 설계를 직접 검증·수정할 책임을 진다.

## 목적

식품 제조·유통 고객사는 배추·양파 등 원재료성 농산물 가격 급등락이
발주 타이밍/수요에 영향을 준다. aT 한국농수산식품유통공사가 운영하는
KAMIS 농산물유통정보 Open API에서 일별 소매/도매 가격을 가져와
`calendar_features.py`의 달력 피처와 같은 방식으로 모델 입력에 병합한다.

## 데이터 소스

| 소스 | API | 인증 방식 | 비고 |
|---|---|---|---|
| aT 한국농수산식품유통공사 | KAMIS Open API (periodProductList) | `KAMIS_CERT_KEY` + `KAMIS_CERT_ID` (KAMIS 자체 포털 발급, data.go.kr 키와 무관) | 품목코드(item_code)·부류코드(item_category_code)는 품목마다 다름 |

기존 `holiday_api.py`/`weather_api.py`가 쓰는 `DATA_GO_KR_SERVICE_KEY`와는
완전히 별개의 키 발급 절차가 필요하다.

## 설계 결정

1. **구조는 calendar_features.py를 그대로 따른다.** `build_market_price_series()`
   (API→DataFrame 빌더)와 `make_market_price_features()`(기존 피처
   DataFrame에 병합) 두 함수로 나눠, `make_calendar_lag_features`의 패턴과
   일관성을 유지했다.
2. **비거래일은 전진채움(ffill), 단 최대 7일로 제한.** 농산물 시장은
   주말·공휴일에 거래가 없어 가격 데이터에 구멍이 생긴다. 무기한
   전진채움은 오래된 가격을 최신인 것처럼 쓰는 위험이 있어
   `max_ffill_days=7`로 제한했고, 그보다 오래 비면 NaN으로 남긴다.
3. **가격 피처: 수준값 + 지연값 + 7일 변화율.** `price`, `price_lag_{1,7,14}`,
   `price_change_pct_7d`를 기본 제공한다. "급등락"을 직접 포착하는 것은
   변화율 쪽이므로, 모델이 유의미하게 쓰는지는 실증데이터로 확인이
   필요하다 (아래 "알려진 한계" 참고).

## 알려진 한계 (TODO) — 중요

- **이 모듈은 실제 API 호출로 검증되지 않았다.** 샌드박스 환경이 `kamis.or.kr`
  등 외부 호스트로의 네트워크 접근을 막고 있어(허용목록에 없음), 요청
  파라미터명(`p_productclscode`, `p_itemcategorycode` 등)과 응답 필드명
  (`regday`, `item_name`, `price` 등)은 KAMIS 공개 문서를 기준으로 한
  best-effort 구현이다. **실사용 전 반드시 발급받은 인증키로 한 번 직접
  호출해 응답 JSON 구조를 확인하고, 다르면 `_parse_period_item()`을
  수정해야 한다.** (holiday_api.py/weather_api.py는 과거 세션에서 https로
  전환하며 실제 호출 오류를 겪은 뒤 고친 이력이 있다 — 이 모듈도 같은
  검증 단계가 필요하다.)
- **"가격 급등락이 수요에 선행한다"는 가설 자체가 검증되지 않았다.**
  이 피처를 모델에 넣었을 때 실제로 WAPE가 개선되는지는 확인된 바 없다.
  `model_selector.py`에 통합하기 전 `experiments/`에 litmus 테스트와
  같은 방식의 ablation(가격 피처 있음/없음 비교)이 필요하다.
- **품목코드·부류코드·지역코드 매핑표가 없다.** 고객사가 취급하는
  원재료 품목에 맞는 KAMIS 코드를 수동으로 찾아 설정해야 한다 (KAMIS
  포털에서 품목별 코드 조회 가능).
- 아직 `model_selector.run_pattern_aware_backtest()`/
  `run_baseline_candidate_backtest()`에 통합되지 않았다 — 이 모듈은
  독립된 빌더/병합 함수로만 존재한다. 실증 검증 후 AI 선임연구원이
  통합 여부를 판단해야 한다(3.5절 직접개발 의무).

## 테스트

`tests/unit/test_kamis_api.py`, `test_market_price_features.py`에서 외부
HTTP 호출을 모킹해 검증한다. 모킹 데이터는 best-effort 스키마 가정을
그대로 사용하므로, 실제 API 응답과 다르면 이 테스트들도 함께 다시
작성해야 한다.
