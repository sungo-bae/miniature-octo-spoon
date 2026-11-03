-- silverjob.kr 홈 화면(일자리 목록·검색·통계)과 공고 페이지가 읽는 공고 목록.
-- 사이트의 Netlify 함수(sync-work24-jobs.mjs)가 15초 안에 받은 일부만 4.8MB JSON으로 커밋하던 것을,
-- 매일 전체를 받는 이 파이프라인의 고용24 공고로 바꾼다. 열 이름과 값은 사이트가 쓰던 JSON과 같다
-- (권역 8개, 직종 6개, 급여·자격요건·주소 문구) — 화면 코드는 그대로 두고 자료만 바꾸기 위해서다.
-- 매일 고용24 수집 뒤 refresh_site_jobs()로 새로 만든다.

create materialized view if not exists public.mv_site_jobs as
with base as (
  select j.*,
         case
           when j.title ~ '어린이집|유치원|보육교사|보육사|수영강사|생산직|생산팀|품질관리|자동화설비|토목|엔지니어|시공|건설산업안전|산업안전관리자|공장|폐수처리|기술영업|영업관리|현장관리자|설계' then null
           when j.title ~ '경비|보안|주차|지킴이' then '경비안전'
           when j.title ~ '청소|미화|환경' then '미화'
           when j.title ~ '조리|급식|주방|영양사' then '조리'
           when j.title ~ '사무|행정|접수|안내' then '사무보조'
           when j.title ~ '시설|아파트|건물|빌딩|관리사무소|주택관리|공동주택' then '시설관리'
           when j.title ~ '공헌|봉사|돌봄|복지|요양|간병|보호사' then '사회공헌'
         end as site_job,
         nullif(j.raw->>'minEdubg', '') as min_edu,
         nullif(j.raw->>'maxEdubg', '') as max_edu,
         nullif(j.raw->>'career', '') as career
    from public.job_postings j
   where j.source = 'work24' and j.closed_date is null
)
select
  raw->>'slug'                                   as slug,
  source_id                                      as id,
  coalesce(raw->>'infoSvc', '')                  as "infoSvc",
  title,
  coalesce(org_name, '')                         as company,
  case sido
    when '서울특별시' then '서울'
    when '경기도' then '경기·인천'       when '인천광역시' then '경기·인천'
    when '부산광역시' then '부산·경남'   when '경상남도' then '부산·경남'   when '울산광역시' then '부산·경남'
    when '대구광역시' then '대구·경북'   when '경상북도' then '대구·경북'
    when '전남광주' then '광주·전라'     when '전북특별자치도' then '광주·전라'
    when '대전광역시' then '대전·충청'   when '충청남도' then '대전·충청'
    when '충청북도' then '대전·충청'     when '세종특별자치시' then '대전·충청'
    when '강원특별자치도' then '강원'
    when '제주특별자치도' then '제주'
    else ''
  end                                            as region,
  coalesce(sigungu, '')                          as "regionDetail",
  site_job                                       as job,
  coalesce(raw->>'jobsCd', '')                   as "jobsCd",
  case when site_job <> '사회공헌' then ''
       else case left(raw->>'jobsCd', 3)
              when '550' then '요양보호사·간병'        when '231' then '사회복지사'
              when '232' then '노인맞춤돌봄·생활지원'  when '304' then '간호사'
              when '306' then '물리·작업치료사'        when '307' then '간호조무사·병동보조'
              when '561' then '요양시설 위생관리'      else '기타' end
  end                                            as "socialSubcategory",
  coalesce(raw->>'holidayTpNm', '')              as type,
  -- "3000만원 ~ 3000만원"처럼 최소·최대가 같으면 한 값으로 (사이트 formatPay와 같게)
  regexp_replace(trim(coalesce(nullif(raw->>'sal', ''), raw->>'salTpNm', '')),
                 '^(.+?)\s*~\s*\1$', '\1')        as pay,
  coalesce(posted_date >= (now() at time zone 'Asia/Seoul')::date - 3, false) as "isNew",
  coalesce(to_char(posted_date, 'YYYY-MM-DD'), '') as "datePosted",
  ''                                             as description,
  coalesce(nullif(concat_ws(' · ',
             case when min_edu is not null then '학력: ' || min_edu ||
                  case when max_edu is not null and max_edu <> min_edu then ' ~ ' || max_edu else '' end end,
             case when career is not null then '경력: ' || career end), ''),
           '채용공고 원문 참고')                    as requirements,
  ''                                             as preferred,
  concat_ws(' ', nullif(raw->>'basicAddr', ''), nullif(raw->>'detailAddr', '')) as address,
  ''                                             as contact,
  coalesce(raw->>'wantedInfoUrl', '')            as "applyUrl",
  coalesce(to_char(deadline_date, 'YYYY.MM.DD'), '') as deadline,
  '워크넷'                                        as source
from base
where site_job is not null;

create unique index if not exists mv_site_jobs_id_idx on public.mv_site_jobs (id);
create index if not exists mv_site_jobs_slug_idx on public.mv_site_jobs (slug);
create index if not exists mv_site_jobs_list_idx on public.mv_site_jobs (region, job, "datePosted" desc);

-- 홈 화면 숫자(전체·신규·업체 수, 직종·권역·세부지역별 건수)를 한 번에 주는 한 줄짜리 요약.
create materialized view if not exists public.mv_site_job_stats as
select
  count(*)                                   as total,
  count(*) filter (where "isNew")            as new_count,
  count(distinct company)                    as companies,
  (select coalesce(jsonb_object_agg(job, n), '{}') from
     (select job, count(*) n from public.mv_site_jobs group by job) t)                 as by_job,
  (select coalesce(jsonb_object_agg(region, n), '{}') from
     (select region, count(*) n from public.mv_site_jobs group by region) t)           as by_region,
  (select coalesce(jsonb_object_agg(region, details), '{}') from
     (select region, jsonb_object_agg("regionDetail", n) details from
        (select region, "regionDetail", count(*) n from public.mv_site_jobs
          where "regionDetail" <> '' group by 1, 2) d group by region) t)              as by_region_detail,
  (select max(finished_at) from public.ingest_runs where source = 'work24')            as updated_at
from public.mv_site_jobs;

grant select on public.mv_site_jobs, public.mv_site_job_stats to anon, authenticated;

create or replace function public.refresh_site_jobs()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  refresh materialized view concurrently public.mv_site_jobs;
  refresh materialized view public.mv_site_job_stats;
  select total into n from public.mv_site_job_stats;
  return n;
end;
$$;
revoke all on function public.refresh_site_jobs() from public, anon, authenticated;
