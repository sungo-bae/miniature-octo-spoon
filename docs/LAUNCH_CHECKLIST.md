# 서비스 공개 전 체크리스트

공개(홈페이지 오픈) 직전에 반드시 확인한다.

## 1. 인증키 재발급 (필수)

개발 중 공공데이터포털 일반 인증키가 대화·캡처 화면에 노출된 적이 있다(2026-10-26).
공개 전에 재발급하고 새 키로 교체한다.

1. 공공데이터포털 → 마이페이지 → 인증키 → **재발급**
   - 일반 인증키는 계정당 하나라서 노인 구인정보, 자립형일자리 등 모든 API에 같은 키가 적용된다.
2. GitHub → Settings → Secrets and variables → Actions → `DATA_GO_KR_SERVICE_KEY` 의 ✏️ 를 눌러 새 키로 교체
3. Actions → daily-silverjob → **Run workflow** 로 수집이 정상 동작하는지 확인
   - 재발급 직후 1~2시간은 새 키가 동작하지 않을 수 있다.

## 2. Supabase 키 점검

- `SUPABASE_SERVICE_ROLE_KEY`(secret 키)가 홈페이지 코드나 저장소에 들어가지 않았는지 확인한다.
  - 홈페이지에는 publishable/anon 키만 쓴다.
- 의심되면 Supabase → Project Settings → API Keys 에서 secret 키를 새로 만들고 GitHub Secret 을 교체한 뒤, 기존 키를 삭제한다.

## 3. 데이터 확인

- `v_latest_forecast` 에 공개 가능한(publishable) 예측이 있는지 확인한다.
- 최근 7일 `ingest_runs` 가 매일 기록됐는지 확인한다(수집 누락 여부).
