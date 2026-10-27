-- 현황 리포트(site/report.html)용 뷰.

-- 직종별 공고 수와 대표 급여 (시도별 + '전국').
-- 급여는 그 직종에서 가장 흔한 단위(시급·월급 등)의 중앙값 하나로 보여준다.
-- 단위를 섞어 환산하면 "월급 230만 원"이 "시급 11,000원"처럼 낯선 숫자가 되기 때문이다.
create or replace view public.v_category_pay
with (security_invoker = true) as
with open_jobs as (
  select coalesce(sido, '지역 미상') as sido, coalesce(category, '기타') as category,
         source, wage_unit, wage_amount
    from public.job_postings
   where closed_date is null
), scoped as (
  select * from open_jobs
  union all
  select '전국', category, source, wage_unit, wage_amount from open_jobs
), pay as (
  select sido, category, wage_unit, count(*) as samples,
         percentile_cont(0.5) within group (order by wage_amount) as median_pay,
         row_number() over (partition by sido, category order by count(*) desc) as rk
    from scoped
   where wage_unit is not null and wage_amount > 0
   group by sido, category, wage_unit
), counts as (
  select sido, category, count(*) as open_count,
         count(*) filter (where source = 'kordi_jobbsn') as gov_count
    from scoped
   group by sido, category
)
select c.sido, c.category, c.open_count, c.gov_count,
       p.wage_unit as pay_unit, round(p.median_pay::numeric, -1) as median_pay, p.samples as pay_samples
  from counts c
  left join pay p on p.sido = c.sido and p.category = c.category and p.rk = 1;

-- 마감 속도: 게시일(없으면 처음 본 날)부터 마감까지. 수집을 시작하기 전에 올라온 공고도
-- 실제 게시 기간으로 센다.
create or replace view public.v_time_to_close
with (security_invoker = true) as
select
  coalesce(category, '기타')                                                 as category,
  count(*)                                                                   as closed_postings,
  percentile_cont(0.5)  within group (order by closed_date - coalesce(posted_date, first_seen_date)) as median_days,
  percentile_cont(0.25) within group (order by closed_date - coalesce(posted_date, first_seen_date)) as p25_days,
  round(avg((closed_date - coalesce(posted_date, first_seen_date) <= 7)::int) * 100, 1)             as pct_closed_within_7d
from public.job_postings
where closed_date is not null
group by coalesce(category, '기타');

grant select on public.v_category_pay, public.v_time_to_close to anon, authenticated;
