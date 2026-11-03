# 실버잡 열쇠·토큰 관리표

실버잡을 움직이는 비밀값(API 키·토큰·주소)을 한곳에 정리한 표입니다.
**이 파일에는 값 자체를 절대 적지 않습니다.** 어디에 들어 있고, 언제 만료되고, 바꿀 때 어디를 고치는지만 적습니다.
채팅·메일·스크린샷에도 값을 붙여 넣지 마세요(끝 4자리 확인 정도만).

마지막 점검: 2026-11-03

## 한눈에 보기

| # | 이름 | 무엇에 쓰나 | 보관 위치 | 만료 | 노출되면 |
|---|---|---|---|---|---|
| 1 | `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털(한국노인인력개발원 구인·사업모집, 인구통계) 매일 수집 | GitHub 저장소 Secrets | 활용기간 2년(신청일 기준, 마이페이지에서 연장) | 남이 내 한도로 호출 → 재발급 |
| 2 | `WORK24_API_KEY` | 고용24 채용정보 매일 수집 + 사이트 공고 상세 원문 조회 | GitHub Secrets, Netlify 환경변수 (두 곳 같은 값) | 고용24 Open API 마이페이지에서 확인 | 재발급 후 두 곳 모두 교체 |
| 3 | `SUPABASE_URL` | 자료 저장소 주소 | GitHub Secrets | 없음 | 비밀 아님(사이트에도 공개) |
| 4 | `SUPABASE_SERVICE_ROLE_KEY` | 수집 결과를 Supabase에 쓰기 (모든 권한) | GitHub Secrets **만** | 없음(직접 바꾸기 전까지) | **가장 위험** — 즉시 교체 |
| 5 | Supabase 공개(publishable) 키 `sb_publishable_…` | 홈페이지·리포트가 공개 뷰 읽기, 지원 버튼 클릭 기록 | 사이트 코드(공개) | 없음 | 비밀 아님 — 공개 뷰만 읽힘 |
| 6 | `NETLIFY_BUILD_HOOK` | 수집이 끝나면 하루 한 번 사이트 다시 배포 | GitHub Secrets | 없음 | 남이 배포를 마구 일으킴(크레딧 소모) → 새로 만들기 |
| 7 | Vault `github_dispatch_token` | Supabase pg_cron이 매일 06:07에 GitHub 수집을 실행 | Supabase Vault | **2027-10-29** | 이 저장소 Actions만 실행 가능 → 폐기 후 새로 |
| 8 | `GITHUB_TOKEN` (Netlify) | 사이트 함수가 `main`에 커밋(복지정보 주간 갱신, 공고·후기 접수) | Netlify 환경변수 | GitHub 토큰 설정 화면에서 확인 | 사이트 저장소 쓰기 가능 → 즉시 폐기 |
| 9 | `WELFARE_API_KEY` | 복지정보 주간 갱신(월 03:00) | Netlify 환경변수 | 공공데이터포털 활용기간(2년) | 재발급 |
| 10 | `JOB_WEBHOOK_SECRET` | 공고·후기 접수 웹훅 주소의 암호 | Netlify 환경변수 + 폼 서비스의 웹훅 URL | 없음 | 가짜 접수 가능 → 새 값으로 두 곳 교체 |

`GITHUB_REPO`, `GITHUB_BRANCH`(Netlify)는 비밀이 아닌 설정값입니다.

## 다음 할 일 달력

| 언제 | 할 일 |
|---|---|
| 2027-10 초 | #7 GitHub dispatch 토큰 새로 만들어 Vault 교체 (만료 2027-10-29) |
| 매년 11월 | 공공데이터포털 마이페이지 → 활용신청 현황에서 #1·#9 활용기간 확인·연장 |
| 매년 11월 | 고용24 Open API 마이페이지에서 #2 사용기간 확인 |
| 매년 11월 | GitHub → Settings → Developer settings → Personal access tokens에서 #8 만료일 확인 |

만료를 놓치면: #1·#2는 아침 수집이 403/401로 실패하고(GitHub Actions 빨간 표시, 아침 보고에 나옴),
#7은 06:07 실행이 안 되고 예비 GitHub 일정(06:07·07:37, 늦을 수 있음)으로만 돕니다.

## 바꾸는 방법

### GitHub Secrets (#1, #2, #3, #4, #6)
GitHub `sungo-bae/miniature-octo-spoon` → Settings → Secrets and variables → Actions →
해당 이름 옆 연필(Update) → 새 값 붙여 넣기 → Update secret.
바꾼 뒤 Actions → daily-silverjob → Run workflow로 한 번 돌려 확인합니다.

### Netlify 환경변수 (#2, #8, #9, #10)
Netlify → 실버잡 사이트 → Site configuration → Environment variables → 이름 클릭 → Edit → 저장.
함수는 다음 배포부터 새 값을 씁니다(다음 날 아침 자동 배포 때 반영. 급하면 Deploys → Trigger deploy, 15크레딧).

### #1·#9 공공데이터포털 키 재발급
data.go.kr 로그인 → 마이페이지 → 개발계정(활용신청 현황) → 해당 API → 인증키 재발급(일반 인증키, Decoding/Encoding 중 **Decoding**).
재발급하면 같은 계정의 모든 API 키가 함께 바뀌므로 #1과 #9를 같이 교체합니다. 새 키는 반영까지 1시간쯤 걸릴 수 있습니다.

### #2 고용24 키
고용24 → Open API → 마이페이지 → 인증키 확인/재발급(**기업회원 키**. 개인회원 키는 거절됨).
GitHub Secrets와 Netlify 두 곳을 같은 값으로 바꿉니다.

### #4 Supabase service_role 키
Supabase 대시보드 → Project Settings → API Keys → secret 키 새로 만들기(또는 JWT 키 회전) →
GitHub Secret `SUPABASE_SERVICE_ROLE_KEY` 교체 → 옛 키 폐기.
**사이트 코드·Netlify에는 절대 넣지 않습니다.**

### #6 Netlify 빌드 훅
Netlify → Site configuration → Build & deploy → Build hooks → 옛 훅 삭제, 새 훅 추가(브랜치 `main`) →
주소를 GitHub Secret `NETLIFY_BUILD_HOOK`에 넣기.

### #7 GitHub dispatch 토큰 (Supabase Vault)
1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
   - Repository access: `sungo-bae/miniature-octo-spoon` 하나만
   - Permissions: Actions **Read and write** (그 외 없음), 만료 1년
2. Supabase → SQL Editor에서 실행(값은 직접 붙여 넣기):
   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'github_dispatch_token'),
     '<새 토큰>');
   ```
3. 확인: `select public.dispatch_daily_collection();` 실행 후 GitHub Actions에 새 실행이 생기면 성공.
4. 옛 토큰은 GitHub에서 Delete.

### #8 Netlify의 GitHub 토큰
GitHub에서 fine-grained 토큰 새로 만들기(저장소: 사이트 저장소 하나, Contents **Read and write**) →
Netlify `GITHUB_TOKEN` 교체 → 옛 토큰 삭제.

### #10 웹훅 암호
아무 긴 임의 문자열을 만들어 Netlify `JOB_WEBHOOK_SECRET`에 넣고,
폼 서비스의 웹훅 주소 끝 `?token=` 값도 같은 값으로 바꿉니다(공고 접수·후기 접수 두 곳).

## 지키는 규칙

- 값은 GitHub Secrets / Netlify 환경변수 / Supabase Vault 세 곳에만 둡니다. 저장소 파일·채팅·메일 금지.
- service_role 키는 GitHub Actions에서만. 사이트에는 공개 키만.
- 토큰은 필요한 저장소·권한만 주고 만료일을 정합니다.
- 노출이 의심되면: 먼저 새 값으로 교체 → 옛 값 폐기 → 다음 날 아침 수집 성공 확인.
