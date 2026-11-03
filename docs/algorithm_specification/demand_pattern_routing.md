# 설계문서: 수요패턴 기반 모델 분기 (demand_pattern, intermittent, model_selector.run_pattern_aware_backtest)

> 6.3절 보완 B7 "문서화 의무"에 따라, 병합 전 설계문서와 단위테스트를 필수로
> 작성한다. AI·최적화 선임연구원은 이 문서를 리뷰·갱신하며 실증데이터 적용
> 시 설계를 직접 검증·수정할 책임을 진다.

## 배경

`experiments/2026-11-03-m5-litmus-test`에서 기존 `run_baseline_candidate_backtest`
(계절나이브 0.5 + GradientBoosting 0.5 블렌드)를 M5 CA_1 매장 48개 SKU에
돌린 결과, 전체 가중 WAPE는 13.0% 개선됐지만 매출 하위(B/C등급) 간헐수요
셀에서는 오히려 기준모델보다 나빴다(B 간헐 -1.1%, C 간헐 -9.1%). 이는
연구개발계획서 12.1절 R11(예비성능 실증 미재현 위험)이 우려하던 상황이며,
4.6절 보완 B5는 이미 "간헐 SKU에는 Croston 계열을 후보에 포함"하도록
규정하고 있었다. 이 문서는 그 대응책의 구현을 설명한다.

## 설계 결정

1. **분류는 ADI/CV² 기준(Syntetos-Boylan 2005), 학습구간만으로 수행.**
   `demand_pattern.classify_demand_pattern()`은 ADI(평균 수요간격) 1.32,
   CV²(비영 수요크기의 변동계수 제곱) 0.49를 임계값으로 smooth/intermittent/
   erratic/lumpy를 구분한다. `model_selector.run_pattern_aware_backtest()`는
   검증구간을 포함하지 않고 학습구간(`y.loc[y.index < test_start]`)만으로
   분류해 미래 데이터 누출을 막는다.

2. **Croston SBA는 intermittent 패턴 + 저매출 SKU에만 적용한다 — lumpy는
   제외.** 비교실험(`compare_pattern_aware.py`, 결과는
   `experiments/2026-11-03-m5-litmus-test/findings.md` 참고)에서 Croston
   SBA(평평한 예측)를 모든 intermittent/lumpy 셀에 무조건 적용했을 때:
   - lumpy 전체 셀에서 블렌드모델보다 더 나빴다(B lumpy +4.1%→-18.2%,
     C lumpy -0.05%→-29.8%). lumpy는 수요크기 자체의 변동성(CV²)이 크기
     때문에 평평한 예측이 그 변동을 못 따라간다.
   - A등급 intermittent SKU(학습구간 일평균 판매량 대략 2 이상)에서도
     오히려 나빠졌다(14.5%→-1.3%). 매출이 충분하면 ML 블렌드가 이미
     계절·달력 신호를 학습해 Croston의 단순 평탄 예측보다 낫다.
   - 반면 B/C등급 intermittent(저매출, 일평균 1 내외)에서는 뚜렷이
     나아졌다(B -1.1%→+12.8%, C -9.1%→+14.4%).

   따라서 `_CROSTON_PATTERN = "intermittent"`, `_LOW_VOLUME_AVG_RATE = 1.3`
   (학습구간 일평균 판매량 임계값)을 조건으로 모두 만족할 때만 Croston을
   적용하고, 그 외(smooth/erratic/lumpy, 고매출 intermittent)에는 기존
   블렌드모델을 그대로 쓴다. 최종 결과: 전체 가중 WAPE 개선율이 13.0%→14.4%로
   오르고, 모든 셀이 블렌드 단독 대비 악화되지 않았다(B/C lumpy는 블렌드와
   동일하게 유지, 개선은 없음 — 아래 "알려진 한계" 참고).

3. **`_LOW_VOLUME_AVG_RATE = 1.3`은 CA_1 1개 매장 표본에서 뽑은 경험적
   임계값이다.** A등급 intermittent SKU의 학습구간 일평균 판매량은
   2.3~4.0, B/C등급은 0.5~1.1로 뚜렷이 갈려 1.3을 기준으로 삼았다. 다른
   매장·업종 데이터에서는 재검증이 필요하다(아래 "다음 단계" 참고).

4. **TSB는 lumpy 패턴 + 고매출 SKU에만 적용한다 — 저매출 lumpy는
   여전히 블렌드를 쓴다.** `experiments/2026-11-03-lumpy-tsb-test`에서
   18개 lumpy SKU(A/B/C 각 6개)로 Croston/TSB를 비교한 결과, TSB는
   Croston과 **정반대 방향의 매출-의존성**을 보였다:
   - A등급 lumpy(일평균 약 1.56 이상)에서는 TSB가 블렌드보다 나았다
     (15.8%→18.8% 개선).
   - B/C등급 lumpy(일평균 1.31 이하)에서는 TSB가 크게 악화시켰다
     (4.1%→-24.3%, -0.05%→-31.0%).

   따라서 `_TSB_PATTERN = "lumpy"`, `_HIGH_VOLUME_AVG_RATE = 1.4`를 모두
   만족할 때만 TSB를 적용한다. 48개 SKU 전체 재검증 결과 전체 가중 WAPE
   개선율이 14.4%(Croston만)→**15.1%**(Croston+TSB)로 올랐고, 다른 모든
   셀은 악화 없이 유지됐다. B/C등급 lumpy는 여전히 미해결이다(아래
   "알려진 한계" 참고) — TSB는 WAPE 기준으로는 더 나빴지만 서비스수준은
   오히려 셋 중 가장 높았다(0.6434→0.6843, 블렌드/Croston 대비). 이는
   저매출 lumpy에 WAPE 대신 서비스수준을 주지표로 쓰는 게 더 적합할
   수 있다는 4.6절 보완 B5의 원래 취지와 맞는 신호다.

## 알려진 한계 (TODO)

- **B/C등급 lumpy(저매출)에는 아직 대응책이 없다.** 블렌드(4.1%/-0.05%),
  Croston(-18.2%/-29.8%), TSB(-24.3%/-31.0%) 셋 다 뚜렷한 개선이
  없거나 오히려 악화시켰다 — 현재는 블렌드를 그대로 쓴다(가장 덜
  나쁜 선택). lumpy는 수요크기 변동 자체가 예측의 어려움이므로,
  점추정(WAPE) 대신 분위수 기반 안전재고(서비스수준 직접 타겟팅)
  접근을 검토해야 한다. 이는 AI·최적화 선임연구원이 직접 설계해야
  하는 핵심 연구내용이다(3.5절 직접개발 의무).
- **`_LOW_VOLUME_AVG_RATE`/`_HIGH_VOLUME_AVG_RATE` 임계값은 매장
  1개·표본 48개(셀당 5~6개)로 정한 값이라 통계적으로 약하다.** 다른
  매장(TX_1, WI_1 등)으로 재검증해 임계값을 확정해야 한다.
- **ABC등급(매출 비중)을 SKU 자체 특징(학습구간 평균 판매량)으로 근사했다.**
  원래 ABC등급은 매장 전체 카탈로그 기준 매출 누적비중으로 계산하므로
  카탈로그 맥락이 필요하지만, `model_selector.py`는 SKU 단위로 호출되는
  구조라 카탈로그 정보를 받지 않는다. 운영 전환 시에는 호출부(배치
  파이프라인)에서 실제 ABC등급을 계산해 넘기고, 이 근사치 임계값을
  대체하는 것을 고려해야 한다.
- Croston SBA는 평평한(flat) 예측만 반환해 요일·명절 등 달력 효과를
  반영하지 못한다. 저매출 intermittent SKU에도 명절 전 수요 증가가
  있다면 과소예측 위험이 있다 — `bias()`/`service_level()`로 모니터링
  필요.

## 다음 단계 제안

1. 다른 M5 매장(TX_1, WI_1 등)으로 `compare_pattern_aware.py`/`compare_tsb.py`를
   재실행해 `_LOW_VOLUME_AVG_RATE`/`_HIGH_VOLUME_AVG_RATE` 임계값과 B/C등급
   lumpy 대응책 필요성을 재확인.
2. B/C등급 lumpy에 분위수 기반 안전재고 접근(점추정 모델 교체가 아닌
   평가 패러다임 전환) 검토 및 구현.
3. MASE·서비스수준(`src/evaluation/poc_metrics.py`)을 간헐/럼피 셀의
   주지표로 전환 — WAPE는 분모(실제판매 합)가 작아 지표가 불안정하고,
   TSB 실험에서 서비스수준이 WAPE와 다른 결론을 낼 수 있음을 확인했다
   (4.6절 보완 B5 원안).

## 테스트

`tests/unit/test_demand_pattern.py`, `test_intermittent.py`에서 분류·Croston·TSB
계산을 단위테스트하고, `test_model_selector.py`에서
`run_pattern_aware_backtest`의 분기(smooth→blend, 저매출 intermittent→croston,
고매출 lumpy→tsb, 저매출 lumpy→blend)를 검증한다. 실제 M5 데이터 기반 비교는
코드 리뷰용 스크립트(`experiments/2026-11-03-m5-litmus-test/compare_pattern_aware.py`,
`experiments/2026-11-03-lumpy-tsb-test/compare_tsb.py`)로 별도 실행하며, 용량
문제로 원본 M5 CSV는 저장소에 포함하지 않는다.
