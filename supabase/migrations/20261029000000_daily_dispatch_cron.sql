-- 매일 06:07 KST에 GitHub Actions의 daily-silverjob을 직접 실행시킨다.
-- GitHub의 schedule은 몇 시간씩 늦거나 건너뛰는 날이 많아서(10/28·10/29 모두 3시간 넘게 지연),
-- 정확한 시각에 도는 Supabase pg_cron이 workflow_dispatch API를 부른다. GitHub schedule은
-- 예비로 남겨 두고, 그쪽은 그날 이미 반영한 출처를 건너뛴다(--skip-if-done).
--
-- 필요한 비밀값: Vault의 'github_dispatch_token' (이 저장소의 Actions 쓰기 권한만 가진 fine-grained 토큰).
--   select vault.create_secret('<토큰>', 'github_dispatch_token');   -- SQL Editor에서 직접 실행

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.dispatch_daily_collection()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
  request_id bigint;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if token is null then
    raise exception 'Vault에 github_dispatch_token이 없습니다';
  end if;
  select net.http_post(
    url     := 'https://api.github.com/repos/sungo-bae/miniature-octo-spoon/actions/workflows/daily.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'silverjob-supabase-cron'),
    body    := jsonb_build_object('ref', 'claude/new-repository-setup-u9kou0')
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.dispatch_daily_collection() from public, anon, authenticated;

-- pg_cron은 UTC 기준: 21:07 UTC = 06:07 KST
select cron.schedule('silverjob-daily-dispatch', '7 21 * * *', 'select public.dispatch_daily_collection()');
