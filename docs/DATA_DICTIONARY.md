# 실버잡 수집 자료 설명서

실버잡(silverjob.kr)이 2026-10-27부터 매일 아침 공공 API에서 모으는 어르신 일자리 공고 자료의 구조와 뜻입니다.
월간 보관본(비공개 저장소 릴리스 `data-YYYY-MM`)의 CSV 파일과 열 이름이 같습니다.
수집 방법이 바뀐 날짜는 [DATA_CHANGELOG.md](DATA_CHANGELOG.md)에 있습니다.

## 출처

| `source` 값 | 출처 | API | 수집 범위 |
|---|---|---|---|
| `work24` | 고용24(고용노동부) 채용정보 | 고용24 Open API 채용정보 목록(`callOpenApiSvcInfo210L01`) | `pfPreferential=8`(고령자 우대) 공고 전체 중, 제목으로 시니어 일자리와 무관한 공고(어린이집·공장·설계 등)를 빼고 실버잡 6개 직종 키워드가 있는 공고 |
| `kordi` | 한국노인인력개발원 노인 구인정보 | 공공데이터포털 `SenuriService/getJobList` | 진행 중 공고 전체. 고용24에 같은 구인인증번호가 있으면 고용24 쪽으로만 셈 |
| `kordi_jobbsn` | 한국노인인력개발원 자립형일자리 사업모집공고 | 공공데이터포털 `JobBsnInfoService/getJobBsnRecruitList` | 올해 진행 중 모집 전체 |

- 수집 시각: 매일 06:07 KST(Supabase pg_cron → GitHub Actions). 실패하면 07:37 KST 예비 실행.
- 날짜는 모두 한국 날짜(KST)입니다.
- 수집일은 `ingest_runs`에 출처별로 남습니다. **수집일이 아닌 날은 "자료 없음"이지 "공고 없음"이 아닙니다.**

## 표

### `job_postings` — 공고 1건당 1행
| 열 | 뜻 |
|---|---|
| `id` | 내부 번호 (다른 표의 `posting_id`) |
| `source`, `source_id` | 출처와 출처의 공고 번호 (둘을 합치면 유일) |
| `title`, `org_name` | 공고 제목, 기관·업체명 (자립형일자리는 제목이 없어 "근무지(또는 기관) 참여자 모집"으로 만듦) |
| `sido`, `sigungu` | 근무지 시도·시군구 (`전남광주` = 광주광역시·전라남도 통합 표기) |
| `category` | 직종. 고용24는 직종코드(`raw.jobsCd`) 앞 3자리 매핑 → 없으면 제목 키워드, 노인인력개발원은 제목 키워드 (`pipeline/sources.py`의 `CATEGORY_KEYWORDS`) |
| `employment_type` | 고용24: 모두 `민간 일자리(고용24)` / 노인 구인정보: 고용 형태(정규직·계약직·시간제·일당직·기타) / 자립형일자리: 모두 `노인일자리 사업` |
| `wage_amount`, `wage_unit` | 급여 금액과 단위(`hour`·`day`·`month`·`year`). 고용24만 채움. 범위면 낮은 쪽, 주급은 ÷5 해 일급, 단위가 없으면 금액 크기로 추정(5만 원 미만 시급, 30만 원 미만 일급, 1천만 원 미만 월급, 그 이상 연봉) |
| `hours_per_week` | 주당 근무시간 (출처가 줄 때만) |
| `posted_date`, `deadline_date` | 출처가 알려준 게시일·마감일 (마감일 없음 = "채용시까지") |
| `first_seen_date` | 실버잡이 처음 수집한 날 |
| `last_seen_date` | 마지막으로 목록에서 본 날 |
| `closed_date` | 목록에서 사라진 첫 수집일 (비어 있음 = 아직 모집 중). 다시 올라오면 비워짐 |
| `raw` | 출처 원본 중 쓰는 항목(JSON). 고용24: 급여 문구 `sal`, 학력 `minEdubg`·`maxEdubg`, 경력 `career`, 직종코드 `jobsCd`, 주소, 원문 주소 `wantedInfoUrl` 등 |
| `updated_at` | 마지막으로 고친 시각 |

### `job_posting_spans` — 공고가 목록에 연속으로 보인 기간
| 열 | 뜻 |
|---|---|
| `posting_id` | `job_postings.id` |
| `start_date` | 이 기간에 처음 보인 수집일 |
| `end_date` | 이 기간에 마지막으로 보인 수집일 |

공고가 내려갔다 다시 올라오면 기간이 하나 더 생깁니다. 수집을 못 한 날은 기간을 끊지 않습니다.
**날짜별로 열려 있던 공고**는 기간 안의 수집일로 펼치면 됩니다 (DB의 `v_job_daily_presence` 뷰와 같음):

```sql
select r.run_date, p.posting_id
  from job_posting_spans p
  join job_postings j  on j.id = p.posting_id
  join ingest_runs r   on r.source = j.source and r.run_date between p.start_date and p.end_date;
```

```python
# pandas
spans = spans.merge(postings[["id", "source"]], left_on="posting_id", right_on="id")
daily = spans.merge(runs, on="source")
daily = daily[(daily.run_date >= daily.start_date) & (daily.run_date <= daily.end_date)]
```

2026-11-03까지는 날짜별 목록(`job_snapshots`)으로 저장했고, 2026-11-03에 이 표로 옮겼습니다(한 줄도 다르지 않음을 확인).

### `ingest_runs` — 출처별 수집일
`run_date`, `source`, `fetched_count`(그날 받은 공고 수), `finished_at`.

### `job_daily_stats` — 수집일·출처·시도·직종별 흐름
| 열 | 뜻 |
|---|---|
| `new_count` | 그날 처음 본 공고 (각 출처의 첫 수집일은 0) |
| `closed_count` | 직전 수집일에는 있었는데 그날 없어진 공고 |
| `open_count` | 그날 열려 있던 공고 |

### `job_postings_history` — 수집 시작 전 과거 공고 (1회 보충)
노인 구인정보 API에 남아 있던 2025-10-27 ~ 2026-10-26 게시 공고의 게시일·지역·직종.
실제 마감일을 알 수 없으므로 **게시 추세에만** 쓰고 게시 기간 분석에는 쓰지 않습니다.

### `job_forecasts` — 주간 신규 공고 예측
`generated_on`(예측한 날), `sido`, `category`, `week_start`(대상 주 월요일), `expected`, `lower`·`upper`(80% 구간),
`method`(선택 모델), `backtest_rel_mae`(직전 주 값 기준선 대비 오차 비율, 1보다 작으면 더 정확), `publishable`(홈페이지 노출 여부).

### `region_population` — 시도별 65세 이상 인구
행정안전부 주민등록 인구통계. `sido`, `sigungu`(빈 값 = 시도 전체), `year`, `pop_65_plus`.

### `apply_clicks` — 실버잡 "지원하기"·"카카오톡 문의" 버튼 클릭 (2026-11-03부터)
| 열 | 뜻 |
|---|---|
| `clicked_at` | 누른 시각 (UTC 저장, 한국시간 = +9시간) |
| `job_slug` | 공고 페이지 주소 (`job-xxxxxxxx`, 고용24 `raw.slug`와 같음) |
| `channel` | `external` = 원문 공고로 이동, `kakao` = 카카오톡 문의 |
| `page` | `modal` = 목록의 공고 창, `detail` = 공고 상세 페이지 |
| `region`, `category` | 사이트의 권역(8개)·직종(6개) |

이름·연락처·IP 등 개인정보는 받지 않습니다. 같은 사람이 여러 번 누르면 여러 번 셉니다.

## 보관본 파일

- `*.csv.gz`: UTF-8(BOM) CSV를 gzip으로 묶은 것. 엑셀은 압축을 풀어 열고, R(`readr::read_csv`)·pandas(`pd.read_csv`)는 그대로 읽습니다.
- `manifest.json`: 내보낸 시각, 표마다 행 수·열 이름·SHA-256.
- 매달 보관본은 **처음부터 그때까지 전체**를 담습니다. 논문에는 사용한 보관본 이름(예: `data-2027-10`)과 `exported_at`을 적으면 됩니다.

## 이용 조건

- 고용24·공공데이터포털 자료는 공공누리/이용허락 범위에서 출처를 밝히고 씁니다
  (예: "고용노동부 고용24 채용정보 Open API", "한국노인인력개발원 노인일자리 구인정보, 공공데이터포털").
- 공고에 담긴 업체 연락처·주소는 공개 공고 내용이지만, 논문에는 개별 업체를 특정하지 않는 집계 결과를 싣는 것이 안전합니다.
