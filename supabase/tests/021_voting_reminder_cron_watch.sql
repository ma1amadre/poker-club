-- Проверки миграции 021 (напоминание о голосовании, сторож будильника) на локальной БД с seed.sql: всё в
-- одной транзакции, в конце rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP
-- выходит с кодом 3. Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/021_voting_reminder_cron_watch.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';

create function pg_temp.login(p_auth uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;
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

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set e4 '''e0000000-0000-4000-8000-000000000004'''
\set mark '''2026-10-02 13:00:00+00'''

-- ===========================================================================
-- 1. Отметка напоминания: колонка, запись функциями, снятие при новом закрытии
-- ===========================================================================
select pg_temp.check((select voting_reminder_posted_at is null and voting_closes_at is not null
                      from public.evenings where id = :e5),
       'у завершённого вечера seed отметки напоминания нет, голосование с закрытием');

-- cron-tick (service_role) ставит отметку обычным update.
set local role service_role;
update public.evenings set voting_reminder_posted_at = :mark where id = :e5;
reset role;
select pg_temp.check((select voting_reminder_posted_at = :mark::timestamptz from public.evenings where id = :e5),
       'service_role пишет voting_reminder_posted_at');

-- Upsert формы админки с тем же закрытием и правка других колонок отметку не трогают.
update public.evenings set voting_closes_at = voting_closes_at, note = 'заметка' where id = :e5;
select pg_temp.check((select voting_reminder_posted_at = :mark::timestamptz from public.evenings where id = :e5),
       'то же voting_closes_at — отметка остаётся');

-- Новое закрытие (админ продлил голосование) — отметка снимается: напоминание уйдёт к новому сроку.
update public.evenings set voting_closes_at = voting_closes_at + interval '1 hour' where id = :e5;
select pg_temp.check((select voting_reminder_posted_at is null from public.evenings where id = :e5),
       'новое voting_closes_at снимает отметку');

-- Отмена finish (void_event) обнуляет закрытие — и отметку; повторный finish даёт новое напоминание.
update public.evenings set voting_reminder_posted_at = :mark where id = :e5;
select pg_temp.login(:admin);
set local role authenticated;
select public.void_event((select id from public.evening_events
                          where evening_id = 'e0000000-0000-4000-8000-000000000005'
                            and type = 'finish' and voided_at is null
                          order by id desc limit 1));
reset role;
select pg_temp.check((select status = 'live' and voting_closes_at is null and voting_reminder_posted_at is null
                      from public.evenings where id = :e5),
       'отмена finish: голосования нет, отметка напоминания снята');

-- Отметка без смены закрытия (тот же update, что у claimPost) — триггер не мешает.
update public.evenings set voting_reminder_posted_at = :mark where id = :e4;
select pg_temp.check((select voting_reminder_posted_at = :mark::timestamptz from public.evenings where id = :e4),
       'отметка ставится, пока закрытие то же');

select pg_temp.check(
  not has_function_privilege('authenticated', 'private.evenings_reset_voting_reminder()', 'execute')
  and not has_function_privilege('anon', 'private.evenings_reset_voting_reminder()', 'execute'),
  'функцию триггера снаружи не вызвать');

-- ===========================================================================
-- 2. Сторож будильника: таблица — только service_role
-- ===========================================================================
-- Локальный pg_cron мог уже дёрнуть cron-tick (seed ставит project_url) — начинаем с чистой таблицы.
delete from public.cron_heartbeat;

select pg_temp.check(
  has_table_privilege('service_role', 'public.cron_heartbeat', 'select')
  and has_table_privilege('service_role', 'public.cron_heartbeat', 'insert')
  and has_table_privilege('service_role', 'public.cron_heartbeat', 'update')
  and has_table_privilege('service_role', 'public.cron_heartbeat', 'delete')
  and not has_table_privilege('service_role', 'public.cron_heartbeat', 'truncate')
  and not has_table_privilege('anon', 'public.cron_heartbeat', 'select')
  and not has_table_privilege('authenticated', 'public.cron_heartbeat', 'select'),
  'cron_heartbeat: select/insert/update/delete — service_role, anon и authenticated — ничего');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.cron_heartbeat'::regclass),
       'cron_heartbeat: RLS включён');

do $$
begin
  insert into public.cron_heartbeat (id) values (2);
  raise exception 'FAIL: вторая строка принята';
exception when check_violation then
  raise notice 'ok: строка одна (id = 1)';
end;
$$;

-- ===========================================================================
-- 3. mark_cron_tick — только service_role; ok ставит обе отметки, не ok — только время тика
-- ===========================================================================
set local role anon;
select pg_temp.rejects('select public.mark_cron_tick(true)', '42501', 'anon не пишет отметку');
reset role;
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects('select public.mark_cron_tick(true)', '42501', 'authenticated (даже админ) не пишет отметку');
reset role;

set local role service_role;
select public.mark_cron_tick(true);
reset role;
select pg_temp.check((select last_run_at = now() and last_ok_at = now() from public.cron_heartbeat where id = 1),
       'тик без ошибок: last_run_at и last_ok_at — время базы');

-- Прошлый успешный тик — давно; тик с ошибками его не сдвигает.
update public.cron_heartbeat set last_ok_at = now() - interval '2 hours', last_run_at = now() - interval '1 hour';
set local role service_role;
select public.mark_cron_tick(false);
reset role;
select pg_temp.check((select last_run_at = now() and last_ok_at = now() - interval '2 hours'
                      from public.cron_heartbeat where id = 1),
       'тик с ошибками: last_run_at — сейчас, last_ok_at — прежний');
set local role service_role;
select public.mark_cron_tick(null);
reset role;
select pg_temp.check((select last_ok_at = now() - interval '2 hours' from public.cron_heartbeat where id = 1),
       'p_ok = null — как тик с ошибками');
select pg_temp.check((select count(*) = 1 from public.cron_heartbeat), 'отметка по-прежнему одной строкой');

-- ===========================================================================
-- 4. cron_last_tick — anon (keepalive), только время
-- ===========================================================================
set local role anon;
select pg_temp.check(
  (select public.cron_last_tick() ?& array['last_ok_at', 'last_run_at', 'server_now']
          and (select count(*) = 3 from jsonb_object_keys(public.cron_last_tick()))),
  'anon: cron_last_tick — ровно last_ok_at, last_run_at, server_now');
select pg_temp.check(
  ((public.cron_last_tick() ->> 'last_ok_at')::timestamptz = now() - interval '2 hours')
  and ((public.cron_last_tick() ->> 'last_run_at')::timestamptz = now())
  and ((public.cron_last_tick() ->> 'server_now')::timestamptz = now()),
  'anon: времена отметки и сервера');
reset role;

delete from public.cron_heartbeat;
set local role anon;
select pg_temp.check(
  (select public.cron_last_tick() -> 'last_ok_at' = 'null'::jsonb
          and public.cron_last_tick() -> 'last_run_at' = 'null'::jsonb
          and public.cron_last_tick() ->> 'server_now' is not null),
  'отметки ещё нет — null, время сервера есть');
reset role;

select pg_temp.check(
  has_function_privilege('anon', 'public.cron_last_tick()', 'execute')
  and has_function_privilege('authenticated', 'public.cron_last_tick()', 'execute')
  and has_function_privilege('service_role', 'public.cron_last_tick()', 'execute')
  and has_function_privilege('service_role', 'public.mark_cron_tick(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.mark_cron_tick(boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_cron_tick(boolean)', 'execute'),
  'права функций: cron_last_tick — anon/authenticated/service_role, mark_cron_tick — только service_role');
select pg_temp.check(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.oid in ('public.cron_last_tick()'::regprocedure, 'public.mark_cron_tick(boolean)'::regprocedure)),
  'обе функции — security definer с пустым search_path');

rollback;
