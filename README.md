# 성오테크 AI 수요예측·재고 최적화 플랫폼

연구개발계획서(Rev.1) 3.2절 A2 모듈과 부록 E 저장소 구조를 따르는 초기
코드 스캐폴드입니다. 현재는 공공데이터 API(특일정보·기상청 단기예보)를
달력 피처로 변환하는 부분부터 구현되어 있습니다.

> 계획서 3.5절·6.4절에 따라 핵심 알고리즘(품절수요 보정, 모델선택,
> 확률예측, 안전재고·발주최적화, PoC 평가코드)은 AI·최적화 선임연구원이
> 직접 설계·구현·검증해야 합니다. 이 저장소의 코드는 그 작업의 출발점
> (스캐폴드)이며, 각 모듈의 `docs/algorithm_specification/` 설계문서를
> 선임연구원이 검토·갱신하는 것을 전제로 합니다.

## 디렉터리 구조

```
src/
  external/        # 공공데이터 API 클라이언트 (특일정보, 기상청 단기예보)
  forecast/        # 기준모델·후보모델 (A2)
  evaluation/       # WAPE/Bias 등 PoC 평가지표 (A5)
tests/unit/         # 단위테스트 (외부 HTTP 호출은 모두 모킹)
docs/algorithm_specification/  # 모듈별 설계문서 (6.3절 보완 B7 문서화 의무)
```

## 준비물

1. 공공데이터포털(data.go.kr)에서 아래 두 서비스를 활용신청하고 서비스키를 발급받습니다.
   - 한국천문연구원_특일 정보
   - 기상청_단기예보 조회서비스
2. `.env.example`을 `.env`로 복사하고 `DATA_GO_KR_SERVICE_KEY`에 발급받은 키를 입력합니다.

## 설치 및 테스트

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest tests/unit
```

## 사용 예시

```python
from datetime import date
from src.external.calendar_features import build_holiday_calendar, make_calendar_lag_features

holiday_calendar = build_holiday_calendar(date(2025, 7, 31), date(2026, 7, 30))
features = make_calendar_lag_features(y, lags=[1, 2, 3, 7, 14, 21, 28], holiday_calendar=holiday_calendar)
```

`y`는 DatetimeIndex를 가진 일별 판매량 `pandas.Series`입니다 (부록 A `sales.csv` 집계 결과).
