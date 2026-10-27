-- 실버잡 일자리 데이터: 매일 수집 → 이력 보존 → 분석 뷰 → 예측 결과
--
-- 원칙: 공고를 덮어쓰지 않고 "수집일마다 보였는지"를 남긴다.
-- 그래야 신규/마감, 게시 기간(마감 속도), 추세, 계절성을 계산할 수 있다.

-- 1) 공고 마스터: 공고 1건당 1행. 처음/마지막으로 본 날짜로 수명을 추적한다.
create table if not exists public.job_postings (
  id                 bigint generated always as identity primary key,
  source             text not null,                 -- 수집 출처 (예: 'kordi', 'worknet')
  source_id          text not null,                 -- 출처의 공고 ID
  title              text not null,
  org_name           text,
  sido               text,                          -- 시도
  sigungu            text,                          -- 시군구
  category           text,                          -- 직종(대분류)
  employment_type    text,                          -- 공익활동/사회서비스형/시장형/취업알선형 등
  wage_amount        numeric,
  wage_unit          text check (wage_unit in ('hour','day','month','year')),
  hours_per_week     numeric,
  posted_date        date,                          -- 출처가 알려준 게시일
  deadline_date      date,                          -- 출처가 알려준 마감일
  first_seen_date    date not null,                 -- 우리가 처음 수집한 날
  last_seen_date     date not null,                 -- 우리가 마지막으로 수집한 날
  closed_date        date,                          -- 목록에서 사라진 첫날 (null = 진행 중)
  raw                jsonb,
  updated_at         timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists job_postings_region_idx   on public.job_postings (sido, sigungu);
create index if not exists job_postings_category_idx on public.job_postings (category);
create index if not exists job_postings_open_idx     on public.job_postings (closed_date) where closed_date is null;

-- 2) 일별 스냅샷: 그날 목록에 있던 공고. 이력 분석의 기반.
create table if not exists public.job_snapshots (
  snapshot_date date   not null,
  posting_id    bigint not null references public.job_postings (id) on delete cascade,
  primary key (snapshot_date, posting_id)
);

-- 3) 지역 고령 인구 (KOSIS 등에서 적재). 기회 지수 = 공고 수 / 고령 인구.
create table if not exists public.region_population (
  sido         text not null,
  sigungu      text not null default '',
  year         int  not null,
  pop_65_plus  int  not null check (pop_65_plus > 0),
  primary key (sido, sigungu, year)
);

-- 4) 수집 실행 기록: 수집이 실패한 날을 "공고가 마감된 날"로 오해하지 않기 위해 필요.
create table if not exists public.ingest_runs (
  run_date      date not null,
  source        text not null,
  fetched_count int  not null,
  finished_at   timestamptz not null default now(),
  primary key (run_date, source)
);

-- 과거 공고(1회성 보충): API에 남아 있는 지난 공고의 게시일·지역·직종.
-- 수집을 시작하기 전 기간의 주간 추세를 채워 예측을 바로 시작할 수 있게 한다.
-- 실제 마감일은 알 수 없으므로 마감 속도 분석에는 쓰지 않는다.
create table if not exists public.job_postings_history (
  source          text not null,
  source_id       text not null,
  title           text,
  sido            text,
  sigungu         text,
  category        text,
  employment_type text,
  posted_date     date not null,
  deadline_date   date,
  primary key (source, source_id)
);

-- 일별 흐름 집계: 수집할 때 스냅샷을 비교해 확정 기록한다.
-- (마감됐다 다시 올라온 공고도 그날의 마감/재게시가 정확히 남는다)
create table if not exists public.job_daily_stats (
  day           date not null,
  source        text not null,
  sido          text not null,
  category      text not null,
  new_count     int  not null,
  closed_count  int  not null,
  open_count    int  not null,
  primary key (day, source, sido, category)
);

-- 5) 예측 결과: 배치(pipeline/forecast.py)가 기록하고 홈페이지는 읽기만 한다.
create table if not exists public.job_forecasts (
  generated_on  date not null,
  sido          text not null,
  category      text not null default '전체',
  week_start    date not null,                     -- 예측 대상 주(월요일)
  expected      numeric not null,                  -- 신규 공고 예상치
  lower         numeric not null,                  -- 80% 예측 구간 하한
  upper         numeric not null,                  -- 80% 예측 구간 상한
  method        text not null,                     -- 선택된 모델
  backtest_rel_mae numeric,                        -- 직전 주 값 그대로(기준선) 대비 오차 비율, < 1 이면 더 정확
  publishable   boolean not null default false,    -- 기준선보다 나을 때만 홈페이지 노출
  primary key (generated_on, sido, category, week_start)
);

-- 하루치 수집을 한 트랜잭션으로 반영한다.
--   1. 공고 upsert (first_seen_date는 최초 값 유지, 다시 보이면 마감 해제)
--   2. 오늘 스냅샷 기록
--   3. 수집 실행 기록
--   4. 같은 출처에서 오늘 목록에 없는 진행 중 공고를 오늘 자로 마감
-- 빈 목록이 오면 예외 → 수집 장애를 "전부 마감"으로 오해하지 않는다.
create or replace function public.ingest_postings(p_run_date date, p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_rows   int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  n_new    int;
  n_closed int;
  prev_run date;
begin
  if n_rows = 0 then
    raise exception 'empty fetch for % on %: refusing to close every posting', p_source, p_run_date;
  end if;

  select max(run_date) into prev_run
    from ingest_runs
   where source = p_source and run_date < p_run_date;

  select count(*) into n_new
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from job_postings j
                      where j.source = p_source and j.source_id = r->>'source_id');

  insert into job_postings as j (
    source, source_id, title, org_name, sido, sigungu, category, employment_type,
    wage_amount, wage_unit, hours_per_week, posted_date, deadline_date,
    first_seen_date, last_seen_date, raw)
  select p_source, r->>'source_id', r->>'title', r->>'org_name', r->>'sido', r->>'sigungu',
         r->>'category', r->>'employment_type', (r->>'wage_amount')::numeric, r->>'wage_unit',
         (r->>'hours_per_week')::numeric, (r->>'posted_date')::date, (r->>'deadline_date')::date,
         p_run_date, p_run_date, r->'raw'
    from jsonb_array_elements(p_rows) r
  on conflict (source, source_id) do update set
    title           = excluded.title,
    org_name        = excluded.org_name,
    -- 상세조회로 채운 지역은 다음 날 상세조회를 건너뛰어도 유지한다
    sido            = coalesce(excluded.sido, j.sido),
    sigungu         = case when excluded.sido is null then j.sigungu else excluded.sigungu end,
    category        = excluded.category,
    employment_type = excluded.employment_type,
    wage_amount     = excluded.wage_amount,
    wage_unit       = excluded.wage_unit,
    hours_per_week  = excluded.hours_per_week,
    posted_date     = excluded.posted_date,
    deadline_date   = excluded.deadline_date,
    last_seen_date  = greatest(j.last_seen_date, excluded.last_seen_date),
    closed_date     = case when excluded.last_seen_date >= coalesce(j.closed_date, excluded.last_seen_date + 1)
                           then null else j.closed_date end,
    raw             = excluded.raw,
    updated_at      = now();

  -- 같은 날 재실행하면 그날 스냅샷을 새로 쓴다
  delete from job_snapshots s
   using job_postings j
   where s.posting_id = j.id and j.source = p_source and s.snapshot_date = p_run_date;

  insert into job_snapshots (snapshot_date, posting_id)
  select p_run_date, j.id
    from job_postings j
    join jsonb_array_elements(p_rows) r
      on j.source = p_source and j.source_id = r->>'source_id'
  on conflict do nothing;

  insert into ingest_runs (run_date, source, fetched_count)
  values (p_run_date, p_source, n_rows)
  on conflict (run_date, source) do update set fetched_count = excluded.fetched_count, finished_at = now();

  update job_postings
     set closed_date = p_run_date, updated_at = now()
   where source = p_source
     and closed_date is null
     and last_seen_date < p_run_date;
  get diagnostics n_closed = row_count;

  delete from job_daily_stats where day = p_run_date and source = p_source;
  insert into job_daily_stats (day, source, sido, category, new_count, closed_count, open_count)
  select p_run_date, p_source,
         coalesce(j.sido, '지역 미상'), coalesce(j.category, '기타'),
         -- 첫 수집일에는 기존 공고가 모두 "처음 본" 공고이므로 신규로 세지 않는다
         count(*) filter (where t.posting_id is not null and prev_run is not null
                            and j.first_seen_date = p_run_date),
         count(*) filter (where t.posting_id is null),
         count(*) filter (where t.posting_id is not null)
    from job_postings j
    left join job_snapshots t on t.posting_id = j.id and t.snapshot_date = p_run_date
    left join job_snapshots y on y.posting_id = j.id and y.snapshot_date = prev_run
   where j.source = p_source
     and (t.posting_id is not null or y.posting_id is not null)
   group by 3, 4;

  return jsonb_build_object('fetched', n_rows, 'new', n_new, 'closed', n_closed);
end;
$$;

revoke all on function public.ingest_postings(date, text, jsonb) from public, anon, authenticated;

-- ───────────── 분석 뷰 (홈페이지가 바로 읽는 형태) ─────────────

-- 일별 흐름: 지역·직종별 신규 / 마감 / 진행 중 공고 수 (모든 출처 합산)
create or replace view public.v_daily_flow
with (security_invoker = true) as
select day, sido, category,
       sum(new_count)::int    as new_count,
       sum(closed_count)::int as closed_count,
       sum(open_count)::int   as open_count
  from public.job_daily_stats
 group by day, sido, category;

-- 주간 추세: 이번 주 vs 지난주 vs 4주 평균 (홈페이지 "일자리 날씨" 문구의 재료)
-- 출처가 게시일을 주면 그것을 쓴다 → 수집 시작 전 기간도 추세에 반영된다.
create or replace view public.v_weekly_trend
with (security_invoker = true) as
with all_postings as (
  select source, source_id, coalesce(posted_date, first_seen_date) as posted, sido
    from public.job_postings
  union all
  select h.source, h.source_id, h.posted_date, h.sido
    from public.job_postings_history h
   where not exists (select 1 from public.job_postings j
                      where j.source = h.source and j.source_id = h.source_id)
), weekly as (
  select date_trunc('week', posted)::date as week_start,
         sido,
         count(*) as new_count
    from all_postings
   group by 1, 2
)
select
  week_start,
  sido,
  new_count,
  lag(new_count) over w                                         as prev_week,
  round(avg(new_count) over (w rows between 4 preceding and 1 preceding), 1) as avg_prev_4w,
  new_count - lag(new_count) over w                             as diff_vs_prev
from weekly
window w as (partition by sido order by week_start);

-- 기회 지수: 진행 중 공고 수를 고령 인구 1만 명당으로 환산.
-- 공고 수만 보면 인구 많은 지역이 늘 1등이 되는 착시를 막는다.
create or replace view public.v_opportunity_index
with (security_invoker = true) as
with open_now as (
  select sido, count(*) as open_count
    from public.job_postings
   where closed_date is null
   group by sido
), pop as (
  select distinct on (sido) sido, pop_65_plus
    from public.region_population
   where sigungu = ''
   order by sido, year desc
)
select
  o.sido,
  o.open_count,
  p.pop_65_plus,
  round(o.open_count * 10000.0 / p.pop_65_plus, 2)                                  as per_10k_seniors,
  round(o.open_count * 10000.0 / p.pop_65_plus
        / nullif(sum(o.open_count) over () * 10000.0 / sum(p.pop_65_plus) over (), 0), 2) as vs_national
from open_now o
join pop p using (sido);

-- 마감 속도: 마감된 공고의 게시 기간 분포 (직종별).
-- 중앙값이 짧을수록 인기 → "이런 일자리는 보통 N일 안에 마감돼요"
create or replace view public.v_time_to_close
with (security_invoker = true) as
select
  coalesce(category, '기타')                                                 as category,
  count(*)                                                                   as closed_postings,
  percentile_cont(0.5)  within group (order by closed_date - first_seen_date) as median_days,
  percentile_cont(0.25) within group (order by closed_date - first_seen_date) as p25_days,
  round(avg((closed_date - first_seen_date <= 7)::int) * 100, 1)             as pct_closed_within_7d
from public.job_postings
where closed_date is not null
group by coalesce(category, '기타');

-- 근무 조건 분포: 시급 환산, 주당 근무시간 구간
create or replace view public.v_condition_mix
with (security_invoker = true) as
select
  coalesce(category, '기타') as category,
  case
    when hours_per_week is null then '정보 없음'
    when hours_per_week <= 15   then '주 15시간 이하'
    when hours_per_week <= 30   then '주 16~30시간'
    else '주 30시간 초과'
  end                         as hours_band,
  count(*)                    as postings,
  round(percentile_cont(0.5) within group (
    order by case wage_unit when 'hour' then wage_amount
                            when 'day'  then wage_amount / 8
                            when 'month' then wage_amount / 209
                            when 'year' then wage_amount / 2508 end)::numeric, 0) as median_hourly_wage
from public.job_postings
where closed_date is null
group by 1, 2;

-- 최신 예측: 가장 최근 배치 결과 중 홈페이지에 보여도 되는 것만
create or replace view public.v_latest_forecast
with (security_invoker = true) as
select sido, category, week_start, expected, lower, upper, method, backtest_rel_mae
  from public.job_forecasts
 where publishable
   and week_start > current_date - 7   -- 이미 지난 주의 예측은 보여주지 않는다
   and generated_on = (select max(generated_on) from public.job_forecasts);

-- ───────────── 접근 권한 ─────────────
-- 홈페이지(anon)는 읽기만, 쓰기는 서비스 롤(수집/예측 배치)만.
alter table public.job_postings      enable row level security;
alter table public.job_snapshots     enable row level security;
alter table public.job_postings_history enable row level security;
alter table public.region_population enable row level security;
alter table public.ingest_runs       enable row level security;
alter table public.job_daily_stats   enable row level security;
alter table public.job_forecasts     enable row level security;

create policy "public read postings"   on public.job_postings      for select to anon, authenticated using (true);
create policy "public read history"    on public.job_postings_history for select to anon, authenticated using (true);
create policy "public read population" on public.region_population for select to anon, authenticated using (true);
create policy "public read runs"       on public.ingest_runs       for select to anon, authenticated using (true);
create policy "public read daily"      on public.job_daily_stats   for select to anon, authenticated using (true);
create policy "public read forecasts"  on public.job_forecasts     for select to anon, authenticated using (publishable);
-- job_snapshots: 정책 없음 → 서비스 롤만 접근 (행 수가 커서 공개 API로 노출하지 않음)

grant select on public.v_daily_flow, public.v_weekly_trend, public.v_opportunity_index,
                public.v_time_to_close, public.v_condition_mix, public.v_latest_forecast
  to anon, authenticated;
