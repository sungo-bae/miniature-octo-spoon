# 사방넷 연동 판매예측 SaaS (미니어처)

물류 중소기업 고객사의 사방넷(또는 사방넷 풀필먼트) 데이터를 API로 수집해
품목별 판매량을 예측하는 멀티테넌트 SaaS의 초기 스캐폴딩입니다.

전체 설계 배경과 데이터 흐름 다이어그램은 [`docs/architecture.md`](docs/architecture.md),
사방넷 API에 대해 확인된 사실/미확인 항목은 [`docs/sabangnet_api_notes.md`](docs/sabangnet_api_notes.md)를 참고하세요.

## 핵심 설계 원칙

- **고객사 로그인 비밀번호를 절대 다루지 않습니다.** 고객사가 사방넷에서 직접 발급한
  API Access/Secret Key(또는 레거시 연동키)만 온보딩 시 등록받습니다.
- **처음부터 멀티테넌트**로 설계했습니다. 모든 데이터 테이블에 `tenant_id`가 있고,
  자격증명은 테넌트별로 암호화되어 분리 저장됩니다.
- 사방넷 API 원문 스펙(엔드포인트, signature 알고리즘)은 아직 확정되지 않아
  `app/integrations/sabangnet/client.py`에 TODO로 표시해 두었습니다. 파일럿 고객사가
  API 문서를 확보하면 이 파일만 교체하면 되도록 client/mapper 레이어를 분리했습니다.

## 스택

FastAPI · SQLAlchemy 2.0 · PostgreSQL · Celery/Redis(폴링 스케줄링) · SARIMAX + XGBoost 하이브리드 예측

## 디렉토리 구조

```
app/
  core/        설정, 자격증명 암호화(Fernet), Celery 앱
  db/          SQLAlchemy Base/세션
  models/      테넌트, 자격증명, 주문, 재고, 예측 등 ORM 모델
  integrations/sabangnet/  사방넷 API 클라이언트(client) + 응답 변환(mapper)
  ingestion/   Celery 기반 테넌트별 폴링 태스크
  etl/         정규화된 데이터를 멱등하게 적재(upsert)
  forecasting/ 피처 생성, SARIMAX+XGBoost 예측, 일일 재학습 태스크
  api/v1/      테넌트/자격증명 온보딩, 예측 조회 REST API
alembic/       DB 마이그레이션
docs/          아키텍처 및 사방넷 API 조사 문서
```

## 로컬 실행

```bash
cp .env.example .env
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# 위 출력값을 .env의 CREDENTIAL_ENCRYPTION_KEY에 채워 넣는다

docker compose up -d postgres redis
pip install -r requirements.txt
alembic upgrade head

uvicorn app.main:app --reload            # API 서버
celery -A app.core.celery_app worker -l info   # 별도 터미널: 수집/예측 워커
celery -A app.core.celery_app beat -l info     # 별도 터미널: 스케줄러
```

동작 확인 (테넌트 생성 → API 키 등록 → 예측 조회):

```bash
curl -X POST localhost:8000/api/v1/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name":"성오테크"}'

curl -X POST localhost:8000/api/v1/tenants/<tenant_id>/credentials \
  -H 'Content-Type: application/json' \
  -d '{"service_type":"fulfillment","key_id":"<사방넷 발급 access key>","key_secret":"<사방넷 발급 secret key>"}'

curl localhost:8000/api/v1/tenants/<tenant_id>/forecasts
```

위 흐름과 ETL(`upsert_order`)·예측(`forecast_next_day`) 로직은 로컬 PostgreSQL에
실데이터를 넣어 end-to-end로 검증했습니다 — 자격증명이 평문이 아닌 암호문으로
저장되는 것, 재수집 시 주문이 중복 적재되지 않는 것(ON CONFLICT upsert), 40일치
샘플 데이터로 SARIMAX+XGBoost 예측이 정상적으로 값을 반환하는 것까지 확인했습니다.

## 다음 단계

1. 파일럿 고객사에게 사방넷 API 부가서비스 가입 및 문서 확보 요청
2. `app/integrations/sabangnet/client.py`의 TODO(엔드포인트, signature)를 실제 스펙으로 교체
3. Sandbox 키로 실제 주문/재고 수집 → 적재 검증
4. 최소 수개월치 데이터 확보 후 예측 정확도(MAPE) 검증
