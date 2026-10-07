-- Проверки миграции 014 (пост в день игры) на локальной БД с seed.sql: всё в одной транзакции, в конце
-- rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/014_gameday_post.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'authenticated', 'authenticated', 't1004@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a004'
  where id = 'a0000000-0000-4000-8000-000000001004';

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
grant execute on function pg_temp.check(boolean, text) to authenticated, service_role;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set lesha_auth '''00000000-0000-4000-8000-00000000a004'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set posted '''2026-10-08 11:00:00+00'''

-- Отметка «пост ушёл», как её ставит cron-tick (service_role).
create function pg_temp.mark_posted() returns void language sql as $$
  update public.evenings set gameday_posted_at = '2026-10-08 11:00:00+00'
  where id = 'e0000000-0000-4000-8000-000000000006';
$$;
grant execute on function pg_temp.mark_posted() to service_role;

-- ===========================================================================
-- 1. Настройка: по умолчанию 5, 1–48, админ сохраняет её формой (update под RLS)
-- ===========================================================================
select pg_temp.check((select gameday_hours_before = 5 from public.settings where id = 1),
       'gameday_hours_before по умолчанию 5');
do $$
begin
  update public.settings set gameday_hours_before = 0 where id = 1;
  raise exception 'FAIL: 0 часов принято';
exception when check_violation then
  raise notice 'ok: 0 часов отклонено';
end;
$$;
do $$
begin
  update public.settings set gameday_hours_before = 49 where id = 1;
  raise exception 'FAIL: 49 часов принято';
exception when check_violation then
  raise notice 'ok: 49 часов отклонено';
end;
$$;

select pg_temp.login(:admin);
set local role authenticated;
update public.settings set gameday_hours_before = 6 where id = 1;
select pg_temp.check((select gameday_hours_before = 6 from public.settings where id = 1),
       'админ сохраняет gameday_hours_before (грант authenticated + RLS settings_update_admin)');

select pg_temp.login(:lesha_auth);
update public.settings set gameday_hours_before = 7 where id = 1; -- RLS: 0 строк
select pg_temp.check((select gameday_hours_before = 6 from public.settings where id = 1),
       'не админ gameday_hours_before не меняет');
reset role;

-- service_role (cron-tick) читает настройку и пишет отметку.
set local role service_role;
select pg_temp.check((select gameday_hours_before = 6 from public.settings where id = 1),
       'service_role читает gameday_hours_before');
select pg_temp.mark_posted();
select pg_temp.check((select gameday_posted_at = :posted::timestamptz from public.evenings where id = :e6),
       'service_role пишет gameday_posted_at');
reset role;

-- ===========================================================================
-- 2. Перенос в пределах московского дня отметку не снимает
-- ===========================================================================
-- e6 — четверг 08.10, 19:00 МСК (16:00 UTC).
update public.evenings set scheduled_at = '2026-10-08 18:00:00+00' where id = :e6; -- 21:00 МСК
select pg_temp.check((select gameday_posted_at is not null from public.evenings where id = :e6),
       'перенос на 21:00 того же дня — отметка остаётся');

update public.evenings set location = 'У Саши' where id = :e6;
select pg_temp.check((select gameday_posted_at is not null from public.evenings where id = :e6),
       'правка места — отметка остаётся');

-- 00:05 МСК четверга = 21:05 UTC среды: дата по UTC другая, день по Москве тот же.
update public.evenings set scheduled_at = '2026-10-07 21:05:00+00' where id = :e6;
select pg_temp.check((select gameday_posted_at is not null from public.evenings where id = :e6),
       'другая дата по UTC, но тот же день по Москве — отметка остаётся');

-- ===========================================================================
-- 3. Перенос на другой московский день снимает отметку — любым путём записи
-- ===========================================================================
update public.evenings set scheduled_at = '2026-10-08 16:00:00+00' where id = :e6;
-- 00:30 МСК пятницы = 21:30 UTC четверга: дата UTC та же, день по Москве другой.
update public.evenings set scheduled_at = '2026-10-08 21:30:00+00' where id = :e6;
select pg_temp.check((select gameday_posted_at is null from public.evenings where id = :e6),
       'перенос на 00:30 пятницы (та же дата UTC) — отметка снята');

-- Форма админки: upsert (insert … on conflict do update) от имени админа.
update public.evenings set scheduled_at = '2026-10-08 16:00:00+00', gameday_posted_at = :posted
  where id = :e6;
select pg_temp.login(:admin);
set local role authenticated;
insert into public.evenings (id, scheduled_at, format)
values (:e6, '2026-10-09 16:00:00+00', '{}')
on conflict (id) do update set scheduled_at = excluded.scheduled_at;
reset role;
select pg_temp.check((select gameday_posted_at is null and scheduled_at = '2026-10-09 16:00:00+00'
                      from public.evenings where id = :e6),
       'upsert формы админки с переносом на пятницу — отметка снята');

-- Обратно на четверг до нового поста: снимать нечего, отметка остаётся пустой.
update public.evenings set scheduled_at = '2026-10-08 16:00:00+00' where id = :e6;
select pg_temp.check((select gameday_posted_at is null from public.evenings where id = :e6),
       'перенос без отметки ничего не ставит');

rollback;
