# G0.5 조기 다품목 리트머스 테스트 — 결과 보고

- 목적: `src/forecast/model_selector.py`의 백테스트 개선율(기존 단일 SKU 시뮬레이션 14.7%)이
  실제 다품목·간헐수요 소매 데이터에서도 재현되는지 확인 (연구개발계획서 12.1절 R11 위험:
  예비성능 실증 미재현 위험).
- 데이터: M5 Forecasting Accuracy(Walmart, Kaggle/Zenodo 공개) CA_1 매장, 3,049개 SKU 전수.
  4.6절 보완 B5의 ABC(매출 70/90% 컷) x 수요패턴(ADI·CV² 기준 smooth/intermittent/erratic/lumpy)
  층화에서 셀당 최대 6개씩 무작위 표본(총 48개, 셀당 실제 SKU 수가 적은 2개 셀은 5~6개).
- 방법: `run_litmus.py` — 셀별 `make_calendar_lag_features()` + `run_baseline_candidate_backtest()`
  (holdout 84일), WAPE 가중평균(판매량 가중). 검증구간 실제판매 합이 0인 SKU 1개는
  부록 B KPI 정의서 규칙에 따라 제외.

## 결과

전체 가중 WAPE: 기준(계절나이브) 0.6363 → 후보모델 0.5534 (**상대개선 13.0%**).
단일 SKU 시뮬레이션치(14.7%)와 근접 — 표면적으로는 재현된 것처럼 보임.

셀별 결과(판매량 가중 WAPE, 상대개선율):

| ABC | 수요패턴 | n | 기준 WAPE | 후보 WAPE | 개선율 |
|---|---|---|---|---|---|
| A | smooth | 6 | 0.355 | 0.290 | +18.4% |
| A | lumpy | 6 | 0.752 | 0.633 | +15.8% |
| A | erratic | 6 | 0.676 | 0.571 | +15.6% |
| A | intermittent | 6 | 0.763 | 0.655 | +14.2% |
| B | lumpy | 6 | 1.266 | 1.214 | +4.1% |
| B | intermittent | 6 | 1.128 | 1.140 | **-1.1%** |
| C | lumpy | 6 | 1.197 | 1.197 | -0.1% |
| C | intermittent | 5 | 1.399 | 1.527 | **-9.1%** |

(전체 CSV: `litmus_results_by_cell.csv`, SKU별 상세: `litmus_results_per_sku.csv`)

## 해석 — 전체 수치는 착시다

전체 13.0% 개선은 매출 비중이 큰 A등급(가중치 70%)이 끌어올린 결과다. 8개 셀 중
절반(B 간헐, C 간헐·럼피 2개는 사실상 0, B 럼피도 미미)이 개선 없거나 악화됐다.
특히 **C등급 간헐수요에서 -9.1%로 기준모델보다 뚜렷이 나쁘다.** 즉 매출 하위·
간헐수요 품목에서는 현재 후보모델(계절나이브 0.5 + GradientBoosting 0.5 블렌드)이
도움이 안 되거나 오히려 해롭다.

이는 100점 설계안의 R11 대응 규칙("층화 셀 과반 악화 시 특징·모델 재설계 스프린트
필요")이 발동하는 조건에 해당한다. 다만 연구개발계획서 4.6절이 이미 이 가능성을
예상해 "간헐 SKU에는 Croston 계열을 후보에 포함하고 WAPE 대신 MASE·서비스수준을
주지표로 사용한다"는 대응책을 세워둔 바 있다 — 이번 결과는 그 대응책이 왜
필요한지를 실데이터로 뒷받침한다.

## 제한점

- 셀당 표본 5~6개로 매장 1개(CA_1) 기준이라 통계적 유의성은 약함. 방향성(A등급 양호,
  B/C 간헐 악화)은 간헐수요 예측에 대한 일반적 지식과 일치하므로 신뢰할 만한 신호로
  보지만, 신뢰구간 등 통계검정은 수행하지 않음.
- 실제 품절검열(censored demand) 정보 없음 — M5는 품절 여부를 별도로 기록하지 않아
  품절수요 보정 로직은 이 테스트에서 검증되지 않음.
- 날씨 피처는 사용하지 않음(캘리포니아 매장이나 실제 기상 데이터 미연결, 공휴일
  피처만 사용).

## 다음 단계 제안

1. ~~B/C등급 간헐·럼피 셀에는 Croston/TSB 계열 모델을 후보에 추가하고, 평가지표를
   WAPE 대신 MASE·서비스수준으로 전환 (4.6절 원안대로).~~ → 아래 "후속:
   Croston SBA 적용 결과" 참고. 완료(intermittent만), lumpy는 미해결.
2. ~~셀별 모델 선택(현재는 전 SKU 동일 블렌드 비율 0.5/0.5)을 수요패턴에 따라
   다르게 적용하는 로직을 `model_selector.py`에 추가.~~ → 완료
   (`model_selector.run_pattern_aware_backtest`).
3. 가능하면 다른 매장(TX_1, WI_1 등)으로 재검증해 표본 수를 늘려 신호를 재확인.
   (미착수)

## 후속: Croston SBA 적용 결과 (같은 날, 같은 표본 재검증)

`src/forecast/demand_pattern.py`(ADI/CV² 분류), `src/forecast/intermittent.py`
(Croston SBA), `model_selector.run_pattern_aware_backtest()`(분기 로직)를
추가해 같은 48개 SKU 표본으로 `compare_pattern_aware.py`를 실행했다. 상세
설계 근거는 `docs/algorithm_specification/demand_pattern_routing.md` 참고.

| ABC | 패턴 | 기존 블렌드 개선율 | 신규(패턴분기) 개선율 |
|---|---|---|---|
| A | smooth/erratic/lumpy/intermittent | 14~19% | 14~18% (동일 수준, 블렌드 유지) |
| B | intermittent | **-1.1%** | **+12.8%** |
| B | lumpy | +4.1% | +4.1% (동일, 미해결) |
| C | intermittent | **-9.1%** | **+14.4%** |
| C | lumpy | -0.1% | -0.1% (동일, 미해결) |

전체 가중 WAPE 개선율: 13.0% → **14.4%**. 처음 Croston을 intermittent/lumpy
모두에 무조건 적용했을 때는 lumpy 전 셀과 A등급 intermittent에서 오히려
악화됐다(B lumpy +4.1%→-18.2%, C lumpy -0.1%→-29.8%, A intermittent
14.5%→-1.3%) — 수요크기 변동이 큰 lumpy에는 Croston의 평평한 예측이
맞지 않고, 매출이 충분한 A등급은 이미 ML 블렌드가 더 낫기 때문이다.
그래서 "intermittent 패턴 + 학습구간 일평균 판매량 1.3 미만"으로 조건을
좁혔고, 그 결과가 위 표다.

**lumpy는 여전히 미해결 과제다.** 블렌드와 Croston 둘 다 B/C lumpy에서
거의 개선이 없다. TSB 등 다른 방법이 필요하다(설계문서 "알려진 한계"
참고).
