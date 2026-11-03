-- 매월 2일 03:17 KST에 GitHub Actions의 monthly-archive(연구용 월간 보관본)를 실행시킨다.
-- 매일 수집과 같은 Vault 토큰(github_dispatch_token, 이 저장소의 Actions 실행 권한)을 쓴다.

create or replace function public.dispatch_workflow(p_workflow text)
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
    url     := 'https://api.github.com/repos/sungo-bae/miniature-octo-spoon/actions/workflows/'
               || p_workflow || '/dispatches',
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

revoke all on function public.dispatch_workflow(text) from public, anon, authenticated;

-- pg_cron은 UTC 기준: 매월 1일 18:17 UTC = 2일 03:17 KST
select cron.schedule('silverjob-monthly-archive', '17 18 1 * *',
                     $$select public.dispatch_workflow('monthly-archive.yml')$$);
