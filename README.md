# 실버잡 데이터 분석·예측 파이프라인

매일 노인 일자리 공고를 수집해 **이력을 쌓고**, 홈페이지가 바로 읽을 수 있는 **분석 뷰**와 **주간 신규 공고 예측**을 Supabase에 만들어 둡니다.

```
공공 API ──(매일 06:07 KST, GitHub Actions)──▶ ingest_postings()  ──▶ job_postings / job_snapshots / job_daily_stats
                                                                     │
                                      pipeline/forecast.py ◀─────────┘──▶ job_forecasts
                                                                     │
홈페이지(anon 키, 읽기 전용) ◀── v_daily_flow · v_weekly_trend · v_opportunity_index · v_time_to_close · v_condition_mix · v_latest_forecast
```

## 홈페이지에서 쓰는 뷰

| 뷰 | 보여주는 것 | 화면 문구 예시 |
|---|---|---|
| `v_daily_flow` | 날짜·시도·직종별 신규 / 마감 / 진행 중 공고 수 | "오늘 서울에 새 일자리 5개가 올라왔어요" |
| `v_weekly_trend` | 주간 신규 공고 수, 지난주·최근 4주 평균과의 차이 | "이번 주 23개, 지난주보다 10개 늘었어요" |
| `v_opportunity_index` | 고령 인구 1만 명당 진행 중 공고 수, 전국 평균 대비 배율 | "우리 지역은 전국 평균보다 1.3배 많아요" |
| `v_time_to_close` | 직종별 공고가 마감되기까지 걸리는 기간(중앙값), 7일 안 마감 비율 | "경비·청소는 보통 3일 안에 마감돼요. 서두르세요!" |
| `v_condition_mix` | 직종 × 주당 근무시간 구간별 공고 수, 시급 환산 중앙값 | "주 15시간 이하 일자리가 가장 많아요" |
| `v_latest_forecast` | 시도별 앞으로 4주간 신규 공고 예상치와 80% 범위 | "다음 주 경기도 새 일자리 19~43개 예상" |

## 예측 방법 (`pipeline/forecast.py`)

1. 시도별(+전국) 주간 신규 공고 수 시계열을 만듭니다. 출처가 게시일을 주면 게시일 기준이라 수집 전 기간도 반영됩니다.
2. 후보 모델: **직전 주 값(기준선)**, **최근 4주 평균**, **작년 같은 주**(52주 이상 쌓이면), **감쇠 추세 지수평활**.
3. 과거 각 시점에서 그때까지의 데이터만으로 1~4주 앞을 예측해 실제와 비교합니다(롤링 백테스트). 오차가 가장 작은 모델을 고릅니다.
4. 예측 범위는 백테스트 오차의 10~90% 분위로 만듭니다(80% 범위).
5. **기준선보다 정확하고(`backtest_rel_mae < 1`) 16주 이상 쌓였을 때만** `publishable=true`가 되어 홈페이지에 노출됩니다.

데이터가 1년 이상 쌓이면 직종별 예측이나 LightGBM 같은 전역 모델로 확장할 수 있습니다. 확장해도 같은 백테스트 기준을 통과해야 노출됩니다.

## 데이터 안전장치

- **빈 수집 거부:** 0건이 오면 반영하지 않습니다. 출처 장애를 "전부 마감"으로 오해하지 않기 위해서입니다.
- **출처별 마감 처리:** 한 출처의 수집이 다른 출처의 공고를 마감시키지 않습니다.
- **재게시 처리:** 마감됐다 다시 올라온 공고는 마감이 해제되고, 신규로 세지 않습니다.
- **첫 수집일 처리:** 첫 수집일에는 기존 공고를 신규로 세지 않습니다.
- **권한:** 쓰기는 서비스 롤 키(배치)만, 홈페이지 anon 키는 읽기만 합니다.

## 설정

1. Supabase에 `supabase/migrations/20261026000000_silverjob_analytics.sql`을 적용합니다.
2. 공공데이터포털에서 노인 일자리 구인정보 API를 활용신청합니다. `pipeline/configs/kordi.example.json`을 명세에 맞게 채워 `pipeline/configs/kordi.json`으로 저장합니다.
3. GitHub 저장소 Secrets에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATA_GO_KR_SERVICE_KEY`를 등록합니다.
4. (선택) KOSIS 시도별 65세 이상 인구를 `region_population`에 적재합니다. 이 데이터가 있어야 기회 지수가 계산됩니다.

수동 적재는 `python -m pipeline.ingest --source manual --csv 파일.csv`로 할 수 있습니다. CSV 헤더는 정규화 필드명을 씁니다.

## 개발

```bash
pip install -r requirements-dev.txt
PG_TEST_DSN=postgresql://postgres@localhost:5432/postgres python -m pytest   # 빈 로컬 DB에서만 실행
```

`pipeline/synthetic.py`는 테스트·데모용 **가상** 데이터 생성기입니다. 운영 DB에는 넣지 마세요.
