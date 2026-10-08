-- Проверки миграции 025 (пост «Итоги сезона» — season_posts) на локальной БД с seed.sql: всё в одной
-- транзакции, в конце rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP
-- выходит с кодом 3. Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/025_season_posts.sql
\set QUIET on
begin;

create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL: %', p_what;
  end if;
  raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated, service_role;

-- Отказ с нужным кодом (текст не сверяем: это сообщения Postgres, а не наши).
create function pg_temp.rejects(p_sql text, p_state text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — прошло', p_what;
exception
  when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
    if sqlstate <> p_state then
      raise exception 'FAIL: % — другая ошибка: % %', p_what, sqlstate, sqlerrm;
    end if;
    raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.rejects(text, text, text) to anon, authenticated, service_role;

-- ===========================================================================
-- 1. Права: только service_role, RLS включён
-- ===========================================================================
select pg_temp.check(
  has_table_privilege('service_role', 'public.season_posts', 'select')
  and has_table_privilege('service_role', 'public.season_posts', 'insert')
  and has_table_privilege('service_role', 'public.season_posts', 'update')
  and has_table_privilege('service_role', 'public.season_posts', 'delete')
  and not has_table_privilege('service_role', 'public.season_posts', 'truncate')
  and not has_table_privilege('anon', 'public.season_posts', 'select')
  and not has_table_privilege('anon', 'public.season_posts', 'insert')
  and not has_table_privilege('authenticated', 'public.season_posts', 'select')
  and not has_table_privilege('authenticated', 'public.season_posts', 'insert'),
  'season_posts: select/insert/update/delete — service_role, anon и authenticated — ничего');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.season_posts'::regclass),
       'season_posts: RLS включён');

set local role authenticated;
select pg_temp.rejects($$select * from public.season_posts$$, '42501', 'authenticated не читает');
reset role;
set local role anon;
select pg_temp.rejects($$insert into public.season_posts (season_key) values ('2026-Q4')$$, '42501',
       'anon не пишет');
reset role;

-- ===========================================================================
-- 2. Застолбить → повтор не вставляет → снять (как notify/season.ts)
-- ===========================================================================
set local role service_role;
do $$
declare
  n integer;
begin
  insert into public.season_posts (season_key, posted_at)
  values ('2026-Q4', '2027-01-01 09:00:00+00')
  on conflict (season_key) do nothing;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'первый тик застолбил сезон');

  insert into public.season_posts (season_key, posted_at)
  values ('2026-Q4', '2027-01-01 09:15:00+00')
  on conflict (season_key) do nothing;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'второй тик (одновременный или следующий) сезон не застолбит — дубля нет');
end;
$$;
select pg_temp.check(
  (select posted_at = '2027-01-01 09:00:00+00' from public.season_posts where season_key = '2026-Q4'),
  'отметка — от первого тика');

-- Сбой Telegram: снять можно только свою отметку (по времени).
delete from public.season_posts where season_key = '2026-Q4' and posted_at = '2027-01-01 09:15:00+00';
select pg_temp.check((select count(*) = 1 from public.season_posts where season_key = '2026-Q4'),
       'чужую отметку (другое время) не снять');
delete from public.season_posts where season_key = '2026-Q4' and posted_at = '2027-01-01 09:00:00+00';
select pg_temp.check((select count(*) = 0 from public.season_posts where season_key = '2026-Q4'),
       'своя отметка снята — следующий тик повторит пост');
reset role;

-- ===========================================================================
-- 3. Ключ сезона — как seasonKey домена
-- ===========================================================================
select pg_temp.rejects($$insert into public.season_posts (season_key) values ('2026-Q5')$$, '23514',
       'квартал только 1–4');
select pg_temp.rejects($$insert into public.season_posts (season_key) values ('IV 2026')$$, '23514',
       'ключ только вида 2026-Q4');
select pg_temp.rejects($$insert into public.season_posts (season_key) values (null)$$, '23502',
       'ключ обязателен');

rollback;
