-- 배치(서비스 롤)는 고용24 수천 건을 한 번에 반영해서 Data API 기본 제한(8초)을 넘는다.
-- 홈페이지가 쓰는 anon 키의 제한(3초)은 그대로 둔다.
alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';
