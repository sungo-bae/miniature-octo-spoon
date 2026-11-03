-- 매일 기록(job_snapshots)을 "공고별 게시 기간"(job_posting_spans)으로 바꾼다.
--
-- job_snapshots는 수집한 날마다 그날 열려 있던 공고를 한 줄씩(하루 2만여 줄, 약 2MB) 적었다.
-- 1년이면 700MB가 넘어 무료 요금제 한도(500MB)를 넘는다. 같은 정보를 공고마다
-- "연속으로 보인 기간"(시작 수집일 ~ 끝 수집일) 한 줄로 적으면 크기가 수십 분의 일로 준다.
--
-- 같은 정보인 이유: 기간 안의 수집일(ingest_runs)마다 그 공고가 목록에 있었고, 기간 밖에는 없었다.
-- 공고가 내려갔다 다시 올라오면 기간 줄이 하나 더 생긴다. 수집을 건너뛴 날(ingest_runs에 없음)은
-- 예전에도 기록이 없었으므로 잃는 것이 없다. 날짜별 목록은 v_job_daily_presence로 그대로 다시 만든다.

create table if not exists public.job_posting_spans (
  posting_id bigint not null references public.job_postings (id) on delete cascade,
  start_date date   not null,   -- 이 기간에 처음 보인 수집일
  end_date   date   not null,   -- 이 기간에 마지막으로 보인 수집일
  primary key (posting_id, start_date),
  check (end_date >= start_date)
);
create index if not exists job_posting_spans_end_idx on public.job_posting_spans (end_date);

alter table public.job_posting_spans enable row level security;
-- 정책 없음 → 서비스 롤만 접근 (job_snapshots와 같음)
revoke all on public.job_posting_spans from anon, authenticated;

-- 기존 매일 기록을 기간으로 옮긴다. 출처별 수집일에 차례 번호를 매기고, 공고가 연속된 수집일에
-- 보였으면 같은 기간으로 묶는다(차례 번호 - 공고별 순번이 같은 묶음).
do $$
begin
  if to_regclass('public.job_snapshots') is null then
    return;
  end if;

  insert into public.job_posting_spans (posting_id, start_date, end_date)
  with runs as (
    select source, run_date, row_number() over (partition by source order by run_date) as rn
      from public.ingest_runs
  ), seen as (
    select s.posting_id, s.snapshot_date,
           r.rn - row_number() over (partition by s.posting_id order by s.snapshot_date) as grp
      from public.job_snapshots s
      join public.job_postings j on j.id = s.posting_id
      join runs r on r.source = j.source and r.run_date = s.snapshot_date
  )
  select posting_id, min(snapshot_date), max(snapshot_date)
    from seen
   group by posting_id, grp
  on conflict do nothing;

  -- 옮긴 결과가 원래 기록과 한 줄도 다르지 않은지 확인하고, 다르면 전체를 되돌린다
  if exists (
    (select s.snapshot_date, s.posting_id from public.job_snapshots s
     except
     select r.run_date, p.posting_id
       from public.job_posting_spans p
       join public.job_postings j on j.id = p.posting_id
       join public.ingest_runs r on r.source = j.source and r.run_date between p.start_date and p.end_date)
    union all
    (select r.run_date, p.posting_id
       from public.job_posting_spans p
       join public.job_postings j on j.id = p.posting_id
       join public.ingest_runs r on r.source = j.source and r.run_date between p.start_date and p.end_date
     except
     select s.snapshot_date, s.posting_id from public.job_snapshots s)
  ) then
    raise exception 'job_posting_spans가 job_snapshots와 다릅니다 — 옮기지 않습니다';
  end if;

  drop table public.job_snapshots;
end $$;

-- 예전 job_snapshots와 같은 모양(수집일, 공고)의 목록. 분석·논문용으로 날짜별 집계를 낼 때 쓴다.
create or replace view public.v_job_daily_presence
with (security_invoker = true) as
select r.run_date as snapshot_date, p.posting_id
  from public.job_posting_spans p
  join public.job_postings j on j.id = p.posting_id
  join public.ingest_runs r on r.source = j.source and r.run_date between p.start_date and p.end_date;
revoke all on public.v_job_daily_presence from anon, authenticated;

create or replace function public.ingest_postings(p_run_date date, p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_rows    int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  n_new     int;
  n_closed  int;
  prev_run  date;
  today_ids bigint[];
begin
  if n_rows = 0 then
    raise exception 'empty fetch for % on %: refusing to close every posting', p_source, p_run_date;
  end if;
  -- 기간은 수집일 순서대로만 이어 붙일 수 있다. 지난 날짜를 다시 넣으면 기간이 틀어진다.
  if exists (select 1 from ingest_runs where source = p_source and run_date > p_run_date) then
    raise exception '% 출처는 %보다 뒤 날짜가 이미 반영되어 있습니다', p_source, p_run_date;
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

  select array_agg(distinct j.id) into today_ids
    from job_postings j
    join jsonb_array_elements(p_rows) r on j.source = p_source and j.source_id = r->>'source_id';

  -- 같은 날 다시 실행하면 그날 반영한 기간을 먼저 되돌린다:
  -- 오늘 시작한 기간은 지우고, 오늘까지 늘린 기간은 직전 수집일로 되돌린다.
  delete from job_posting_spans s
   using job_postings j
   where s.posting_id = j.id and j.source = p_source and s.start_date = p_run_date;
  update job_posting_spans s
     set end_date = prev_run
    from job_postings j
   where s.posting_id = j.id and j.source = p_source and s.end_date = p_run_date;

  -- 직전 수집일에도 보였던 공고는 기간을 오늘까지 늘리고, 아니면 새 기간을 시작한다
  update job_posting_spans s
     set end_date = p_run_date
    from unnest(today_ids) t(id)
   where s.posting_id = t.id and s.end_date = prev_run;
  insert into job_posting_spans (posting_id, start_date, end_date)
  select t.id, p_run_date, p_run_date
    from unnest(today_ids) t(id)
   where not exists (select 1 from job_posting_spans s where s.posting_id = t.id and s.end_date = p_run_date);

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
  with seen as (
    select s.posting_id,
           bool_or(s.end_date = p_run_date) as today,
           bool_or(prev_run is not null and prev_run between s.start_date and s.end_date) as prev
      from job_posting_spans s
     where s.end_date >= coalesce(prev_run, p_run_date)
     group by s.posting_id
  )
  insert into job_daily_stats (day, source, sido, category, new_count, closed_count, open_count)
  select p_run_date, p_source,
         coalesce(j.sido, '지역 미상'), coalesce(j.category, '기타'),
         -- 첫 수집일에는 기존 공고가 모두 "처음 본" 공고이므로 신규로 세지 않는다
         count(*) filter (where s.today and prev_run is not null and j.first_seen_date = p_run_date),
         count(*) filter (where not s.today),
         count(*) filter (where s.today)
    from seen s
    join job_postings j on j.id = s.posting_id
   where j.source = p_source
     and (s.today or s.prev)
   group by 3, 4;

  return jsonb_build_object('fetched', n_rows, 'new', n_new, 'closed', n_closed);
end;
$$;

revoke all on function public.ingest_postings(date, text, jsonb) from public, anon, authenticated;
