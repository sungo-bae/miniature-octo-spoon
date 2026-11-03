# 설계문서: KAMIS 농산물 가격 피처 (kamis_api, market_price_features)

> 6.3절 보완 B7 "문서화 의무"에 따라, 병합 전 설계문서와 단위테스트를 필수로
> 작성한다. AI·최적화 선임연구원은 이 문서를 리뷰·갱신하며 실증데이터 적용
> 시 설계를 직접 검증·수정할 책임을 진다.

## 목적

식품 제조·유통 고객사는 배추·양파 등 원재료성 농산물 가격 급등락이
발주 타이밍/수요에 영향을 준다. 공공데이터포털(data.go.kr)이 제공하는
aT 한국농수산식품유통공사의 "일별 도,소매 가격정보" API에서 일별 가격을
가져와 `calendar_features.py`의 달력 피처와 같은 방식으로 모델 입력에
병합한다.

## 데이터 소스

| 소스 | API | 인증 방식 | 비고 |
|---|---|---|---|
| aT 한국농수산식품유통공사 (공공데이터포털 경유) | 한국농수산식품유통공사_일별 도,소매 가격정보 조회 | `DATA_GO_KR_SERVICE_KEY` (특일정보·기상청과 **공용**) | data.go.kr에서 활용신청 시 **자동승인** — 승인 대기 불필요 |

**중요:** KAMIS는 자체 Open API 포털(kamis.or.kr)도 별도로 운영하며
거기서는 전용 인증키(cert_key/cert_id)가 필요하지만, **이 프로젝트는
공공데이터포털 경유 버전을 사용**하므로 기존 `DATA_GO_KR_SERVICE_KEY`
하나로 충분하다. (초기 구현 당시 kamis.or.kr 직접 연동으로 잘못 가정했던
버전을 2026-11-03 사용자가 실제로 data.go.kr에서 활용신청해 받은 공식
명세서("일별 도,소매 가격정보 API명세 및 관련 코드 정보.zip")를 기준으로
전면 재작성했다.)

### 확인된 API 명세 (공식 문서 기준)

- End Point: `https://apis.data.go.kr/B552845/perDay/price` (GET)
- 요청 파라미터: `serviceKey`, `returnType`(JSON/XML), `pageNo`, `numOfRows`(최대 1000),
  `cond[exmn_ymd::GTE]`/`cond[exmn_ymd::LTE]`(조회기간, YYYYMMDD), `cond[ctgry_cd::EQ]`(부류코드, 필수),
  `cond[item_cd::EQ]`(품목코드, 필수), 선택: `cond[se_cd::EQ]`(구분코드: 01=소매/02=중도매/03=친환경),
  `cond[sgg_cd::EQ]`(시군구코드/지역), `cond[vrty_cd::EQ]`(품종코드), `cond[grd_cd::EQ]`(등급코드), `cond[mrkt_cd::EQ]`(시장코드)
- 응답: `response.header.{resultCode,resultMsg}`, `response.body.{numOfRows,pageNo,totalCount,items.item[]}`
  (holiday_api.py와 동일한 data.go.kr 표준 응답 포맷 — 이 부분은 문서에 명시되어 있지 않아
  동일 포털의 다른 API 관례를 따른 추정이다. 아래 "알려진 한계" 참고)
- 응답 필드: `exmn_ymd`(조사일자), `item_cd`/`item_nm`, `ctgry_cd`, `se_cd`/`se_nm`,
  `mrkt_nm`(시장명), `unit`/`unit_sz`(단위), `exmn_dd_prc`(조사일가격, 단위 기준 원),
  `exmn_dd_cnvs_prc`(조사일 kg환산가격 — 품목 간 비교 가능한 정규화 가격)

### 코드표 (코드정보.xlsx에서 확인, 예시)

| 구분 | 코드 | 값 |
|---|---|---|
| 구분코드 | 01 | 소매 |
| 부류코드 | 200 | 채소류 |
| 품목코드 | 211 | 배추 |
| 시군구코드 | 1101 | 서울 |

전체 코드표(부류 6종, 품목 136종, 품종 332종, 등급 693종, 시군구 38종,
시장 216종)는 사용자가 발급 과정에서 받은 "코드정보.xlsx"에 있다 — 저장소에는
포함하지 않았으니 실제 사용 시 사용자가 보관 중인 파일 또는 data.go.kr
상세페이지에서 다시 받아야 한다.

## 설계 결정

1. **구조는 calendar_features.py를 그대로 따른다.** `build_market_price_series()`
   (API→DataFrame 빌더)와 `make_market_price_features()`(기존 피처
   DataFrame에 병합) 두 함수로 나눠, `make_calendar_lag_features`의 패턴과
   일관성을 유지했다.
2. **가격은 kg환산가격(exmn_dd_cnvs_prc)을 사용한다.** 품목마다 `unit`/`unit_sz`
   (예: "10키로", "1키로")가 달라 원시 가격(exmn_dd_prc)은 품목 간 비교가
   안 된다. kg 환산값을 써야 "가격 피처"로서 의미가 있다.
3. **페이지네이션을 자동 처리한다.** `numOfRows` 최대 1000건 제한이 있어,
   `fetch_period_prices()`는 `totalCount`를 보고 필요한 만큼 페이지를 순회한다
   (무한루프 방지로 `MAX_PAGES=50` 안전장치).
4. **지역(sgg_code) 미지정 시 여러 시장 데이터가 섞여 올 수 있다.**
   `build_market_price_series()`는 같은 날짜에 여러 행이 오면 평균으로
   합친다(`groupby("date").mean()`) — `make_market_price_features()`의
   `reindex()`가 날짜 인덱스 유일성을 요구하기 때문이다. 특정 지역만
   보고 싶다면 `sgg_code`를 지정하면 된다(예: "1101"=서울).
5. **비거래일은 전진채움(ffill), 단 최대 7일로 제한.** (이전 버전과 동일.)
6. **가격 피처: 수준값 + 지연값 + 7일 변화율.** `price`, `price_lag_{1,7,14}`,
   `price_change_pct_7d`를 기본 제공한다.

## 알려진 한계 (TODO) — 중요

- **응답 봉투(response.header/body) 구조는 공식 명세서에 명시되어 있지
  않고, holiday_api.py 등 같은 포털 다른 API의 관례를 따른 추정이다.**
  요청 파라미터(`cond[...]`, `serviceKey` 등)는 공식 문서 그대로이므로
  신뢰도가 높지만, 응답 최상위 구조가 다르면(예: `response` 래퍼가 없는
  경우) 파싱이 실패한다. **실사용 전 반드시 한 번 실제 호출해 최상위
  JSON 구조를 확인해야 한다.**
- **"가격 급등락이 수요에 선행한다"는 가설 자체가 검증되지 않았다.**
  이 피처를 모델에 넣었을 때 실제로 WAPE가 개선되는지는 확인된 바 없다.
  `model_selector.py`에 통합하기 전 `experiments/`에 litmus 테스트와
  같은 방식의 ablation(가격 피처 있음/없음 비교)이 필요하다.
- **고객사 원재료 품목에 맞는 코드 매핑이 아직 없다.** 코드정보.xlsx에서
  수동으로 찾아 설정해야 한다.
- 아직 `model_selector.run_pattern_aware_backtest()`/
  `run_baseline_candidate_backtest()`에 통합되지 않았다 — 이 모듈은
  독립된 빌더/병합 함수로만 존재한다. 실증 검증 후 AI 선임연구원이
  통합 여부를 판단해야 한다(3.5절 직접개발 의무).

## 테스트

`tests/unit/test_kamis_api.py`, `test_market_price_features.py`에서 외부
HTTP 호출을 모킹해 검증한다 (페이지네이션, 중복 날짜 평균 처리 포함).
모킹 데이터는 공식 요청 명세 + 추정 응답 봉투를 기준으로 하므로, 실제
API 응답의 최상위 구조가 다르면 이 테스트들도 함께 다시 작성해야 한다.
