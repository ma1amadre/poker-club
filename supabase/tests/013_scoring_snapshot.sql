-- Проверки миграции 013 на локальной БД с seed.sql: всё в одной транзакции, в конце rollback —
-- данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят; «сейчас» — 2026-Q4 или позже, seed — вечера 2026-Q3/Q4):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/013_scoring_snapshot.sql
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
grant execute on function pg_temp.check(boolean, text) to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set lesha_auth '''00000000-0000-4000-8000-00000000a004'''
\set e1 '''e0000000-0000-4000-8000-000000000001'''
\set e4 '''e0000000-0000-4000-8000-000000000004'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set old_rules '{"koPoints": 0.5, "winBonus": 1}'
\set new_rules '{"koPoints": 1, "winBonus": 3}'

-- ===========================================================================
-- 1. Снимок есть ровно у завершённых вечеров (seed вставляет их завершёнными)
-- ===========================================================================
select pg_temp.check(not exists (
         select 1 from public.evenings
         where (status in ('finished', 'settled')) <> (scoring is not null)),
       'снимок есть ровно у finished/settled');
select pg_temp.check((select scoring = :'old_rules'::jsonb from public.evenings where id = :e1),
       'снимок seed — настройки на момент вставки');

-- ===========================================================================
-- 2. Админ меняет очки — прошлые вечера держат свой снимок
-- ===========================================================================
select pg_temp.login(:admin);
set local role authenticated;
update public.settings set ko_points = 1, win_bonus = 3 where id = 1;
select pg_temp.check((select count(*) = 5 from public.evenings where scoring = :'old_rules'::jsonb),
       'смена ko_points/win_bonus не трогает снимки пяти завершённых вечеров');

-- Снимок снаружи не пишется: ни PATCH, ни upsert формы админки.
update public.evenings set scoring = '{"koPoints": 9, "winBonus": 9}' where id = :e1;
insert into public.evenings (id, scheduled_at, format, scoring)
values (:e1, '2026-08-27 16:00:00+00', '{}', '{"koPoints": 7, "winBonus": 7}')
on conflict (id) do update set location = excluded.location, scoring = excluded.scoring;
select pg_temp.check((select scoring = :'old_rules'::jsonb from public.evenings where id = :e1),
       'update/upsert со scoring снимок не меняют');

-- ===========================================================================
-- 3. Отмена finish снимает снимок, повторный finish берёт новые правила
-- ===========================================================================
select public.void_event((select ee.id from public.evening_events ee
                          where ee.evening_id = :e5 and ee.type = 'finish' and ee.voided_at is null));
select pg_temp.check((select status = 'live' and scoring is null from public.evenings where id = :e5),
       'отмена finish: вечер в игре, снимка нет');
select public.add_event(:e5, 'finish', '{}'::jsonb);
select pg_temp.check((select status = 'finished' and scoring = :'new_rules'::jsonb
                      from public.evenings where id = :e5),
       'повторный finish: снимок по текущим настройкам');

-- Правка журнала закрытого вечера открывает расчёт (settled → finished), снимок остаётся.
select public.add_event(:e4, 'payment',
  jsonb_build_object('playerId', 'a0000000-0000-4000-8000-000000001002', 'amountRub', 1));
select pg_temp.check((select status = 'finished' and scoring = :'old_rules'::jsonb
                      from public.evenings where id = :e4),
       'открытие расчёта правкой журнала снимок не меняет');

-- Анонс снимка не получает, даже если его прислать.
update public.evenings set scoring = '{"koPoints": 1, "winBonus": 1}' where id = :e6;
select pg_temp.check((select scoring is null from public.evenings where id = :e6),
       'у вечера в анонсе снимка нет');

-- ===========================================================================
-- 4. «Лучшие N»: правка настройки замораживает прошедшие сезоны прежним значением
-- ===========================================================================
select pg_temp.check((select count(*) = 0 from public.season_rules),
       'до правки season_best_n замороженных сезонов нет (seed её не меняет)');
update public.settings set season_best_n = 4 where id = 1;
select pg_temp.check((select best_n = 10 from public.season_rules where season_key = '2026-Q3'),
       'первая правка после конца 2026-Q3 замораживает его прежним значением 10');
select pg_temp.check(not exists (
         select 1 from public.season_rules
         where season_key >= to_char(now() at time zone 'Europe/Moscow', 'YYYY-"Q"Q')),
       'текущий сезон не замораживается');
select pg_temp.check((select count(*) = 1 from public.season_rules),
       'замораживаются кварталы с первого вечера клуба — до 2026-Q3 вечеров нет');
update public.settings set season_best_n = 6 where id = 1;
select pg_temp.check((select best_n = 10 from public.season_rules where season_key = '2026-Q3'),
       'повторная правка закрытый сезон не трогает');
update public.settings set announce_hours_before = 24 where id = 1;
select pg_temp.check((select count(*) = 1 from public.season_rules),
       'правка других настроек ничего не замораживает');

-- Клиенту — только чтение.
select pg_temp.check((select count(*) = 1 from public.season_rules), 'админ читает season_rules');
select pg_temp.login(:lesha_auth);
select pg_temp.check((select count(*) = 1 from public.season_rules), 'игрок читает season_rules');
do $$
begin
  insert into public.season_rules (season_key, best_n) values ('2026-Q2', 3);
  raise exception 'FAIL: игрок записал в season_rules';
exception when insufficient_privilege then
  raise notice 'ok: запись в season_rules клиенту закрыта';
end;
$$;
do $$
begin
  update public.season_rules set best_n = 1;
  raise exception 'FAIL: игрок изменил season_rules';
exception when insufficient_privilege then
  raise notice 'ok: правка season_rules клиенту закрыта';
end;
$$;
reset role;

-- ===========================================================================
-- 5. Ограничения (на случай выключенного триггера)
-- ===========================================================================
alter table public.evenings disable trigger evenings_scoring_snapshot;
do $$
begin
  update public.evenings set scoring = '{"koPoints": -1, "winBonus": 1}'
  where id = 'e0000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: отрицательные очки в снимке';
exception when check_violation then
  raise notice 'ok: форма снимка проверяется';
end;
$$;
do $$
begin
  update public.evenings set scoring = null where id = 'e0000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: завершённый вечер без снимка';
exception when check_violation then
  raise notice 'ok: завершённый вечер без снимка не сохраняется';
end;
$$;
alter table public.evenings enable trigger evenings_scoring_snapshot;

rollback;
