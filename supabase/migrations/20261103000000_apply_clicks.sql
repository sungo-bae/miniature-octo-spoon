-- silverjob.kr의 "지원하기"·"카카오톡으로 문의하기" 버튼 클릭 수.
-- 이름·연락처·IP 같은 개인정보는 받지 않고, 어떤 공고(슬러그)·지역·직종에서 눌렸는지만 센다.
-- 홈페이지(anon 키)는 정해진 열만 넣을 수 있고, 읽거나 고칠 수는 없다.

create table if not exists public.apply_clicks (
  id         bigint generated always as identity primary key,
  clicked_at timestamptz not null default now(),
  job_slug   text check (char_length(job_slug) <= 40),
  channel    text not null check (channel in ('external', 'kakao')),   -- 원문 공고로 이동 / 카카오톡 문의
  page       text not null check (page in ('modal', 'detail')),       -- 목록의 공고 창 / 공고 상세 페이지
  region     text check (char_length(region) <= 40),
  category   text check (char_length(category) <= 40)
);
create index if not exists apply_clicks_day_idx on public.apply_clicks (clicked_at);

alter table public.apply_clicks enable row level security;
create policy "homepage records clicks" on public.apply_clicks for insert to anon, authenticated with check (true);
revoke all on public.apply_clicks from anon, authenticated;
grant insert (job_slug, channel, page, region, category) on public.apply_clicks to anon, authenticated;

-- 하루(한국시간)·버튼 종류·지역·직종별 클릭 수. 공개하지 않는다(서비스 롤·대시보드에서만 본다).
create or replace view public.v_apply_clicks_daily
with (security_invoker = true) as
select (clicked_at at time zone 'Asia/Seoul')::date as day,
       channel, coalesce(region, '지역 미상') as region, coalesce(category, '기타') as category,
       count(*) as clicks
  from public.apply_clicks
 group by 1, 2, 3, 4;
revoke all on public.v_apply_clicks_daily from anon, authenticated;
