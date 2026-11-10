-- silverjob.kr 직종별 안내 글(/guide/*.html)에 들어가는 숫자. 사이트 빌드(하루 1번)가 읽는다.
-- 홈 화면과 같은 공고 목록(mv_site_jobs)을 직종별로 묶고, 급여는 수집 원본(job_postings)의
-- 금액·단위로 낸다. 공고 원문·업체 연락처는 내보내지 않고 집계와 최근 공고 제목만 준다.
-- job_postings는 공개하지 않으므로 뷰 소유자 권한으로 집계한다(security_invoker 끔).

create or replace view public.v_site_job_guide
with (security_invoker = false) as
with j as (
  select m.job, m.slug, m.title, m.company, m.region, m."regionDetail" as region_detail,
         m.type, m.pay, m."datePosted" as date_posted, m."socialSubcategory" as social_sub,
         p.wage_amount, p.wage_unit
    from public.mv_site_jobs m
    left join public.job_postings p on p.source = 'work24' and p.source_id = m.id
)
select
  g.job,
  (select count(*) from j where j.job = g.job)                                               as total,
  (select count(*) from j where j.job = g.job
     and j.date_posted >= to_char((now() at time zone 'Asia/Seoul')::date - 7, 'YYYY-MM-DD'))  as new_7d,
  (select count(distinct company) from j where j.job = g.job)                                as companies,
  (select coalesce(jsonb_object_agg(wage_unit, s), '{}') from (
      select wage_unit, jsonb_build_object(
               'n', count(*),
               'p25', percentile_cont(0.25) within group (order by wage_amount),
               'med', percentile_cont(0.5)  within group (order by wage_amount),
               'p75', percentile_cont(0.75) within group (order by wage_amount)) s
        from j where j.job = g.job and wage_amount > 0 and wage_unit is not null
       group by wage_unit) w)                                                                as wages,
  (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'n', n) order by n desc), '[]') from (
      select region, count(*) n from j where j.job = g.job and region <> '' group by 1) r)    as regions,
  (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'detail', region_detail, 'n', n) order by n desc), '[]') from (
      select region, region_detail, count(*) n from j
       where j.job = g.job and region_detail <> '' group by 1, 2 order by 3 desc limit 10) d) as top_areas,
  (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'n', n) order by n desc), '[]') from (
      select type, count(*) n from j where j.job = g.job and type <> '' group by 1 order by 2 desc limit 5) t) as types,
  (select coalesce(jsonb_agg(jsonb_build_object('name', social_sub, 'n', n) order by n desc), '[]') from (
      select social_sub, count(*) n from j where j.job = g.job and social_sub <> '' group by 1) s) as subcategories,
  (select coalesce(jsonb_agg(x order by x->>'datePosted' desc), '[]') from (
      select jsonb_build_object('slug', slug, 'title', title, 'company', company, 'region', region,
                                'regionDetail', region_detail, 'pay', pay, 'datePosted', date_posted) x
        from j where j.job = g.job and slug is not null
         -- 제목 키워드로 직종을 나누다 보니 "아파트 재가요양"이 시설관리로 들어가는 식의 섞임이 있어,
         -- 안내 글에 보여 줄 최근 공고는 그 직종 단어가 들어간 것만 고른다
         and (g.job = '사회공헌' or (title !~ '요양|보호사|돌봄|간병|등급' and title ~ case g.job
               when '경비안전' then '경비|보안|주차|지킴이'
               when '미화' then '청소|미화|환경'
               when '조리' then '조리|급식|주방|영양사'
               when '사무보조' then '사무|행정|접수|안내|경리'
               when '시설관리' then '시설|관리사무소|주택관리|설비|전기|기전|영선|기계'
               else '.' end))
       order by date_posted desc, slug limit 8) l)                                           as latest,
  (select max(finished_at) from public.ingest_runs where source = 'work24')                  as updated_at
from (select distinct job from public.mv_site_jobs) g;

grant select on public.v_site_job_guide to anon, authenticated;
