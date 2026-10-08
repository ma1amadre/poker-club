-- Проверки миграции 019 (ключ повтора у add_guest) на локальной БД с seed.sql: всё в одной транзакции,
-- в конце rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/019_add_guest_retry_key.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'authenticated', 'authenticated', 't1002@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a002'
  where id = 'a0000000-0000-4000-8000-000000001002';

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

-- Ошибка с кодом 22023 и нужным текстом, иначе FAIL.
create function pg_temp.rejects(p_sql text, p_message text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — запись прошла', p_what;
exception
  when invalid_parameter_value then
    if position(p_message in sqlerrm) = 0 then
      raise exception 'FAIL: % — другой текст: %', p_what, sqlerrm;
    end if;
    raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.rejects(text, text, text) to authenticated;

-- Сколько игроков с таким именем и сколько их входов в вечер.
create function pg_temp.guests(p_evening uuid, p_name text) returns table (players bigint, joins bigint)
language sql as $$
  select
    (select count(*) from public.players p where p.display_name = p_name),
    (select count(*) from public.evening_events ee
       join public.players p on p.id::text = ee.payload ->> 'playerId'
     where ee.evening_id = p_evening and ee.type = 'join' and p.display_name = p_name);
$$;
grant execute on function pg_temp.guests(uuid, text) to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set banker '''00000000-0000-4000-8000-00000000a002'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set p3 '''a0000000-0000-4000-8000-000000001003'''
\set k1 '''c1900000-0000-4000-8000-000000000001'''
\set k2 '''c1900000-0000-4000-8000-000000000002'''
\set k3 '''c1900000-0000-4000-8000-000000000003'''

-- ===========================================================================
-- 1. Повтор тем же ключом возвращает того же гостя: второго игрока и второго входа нет
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;

select public.add_guest(:e6, 'Гость Повтор', 2, :k1) as g1 \gset
select pg_temp.check(
  (select ee.client_id = :k1::uuid and ee.payload = jsonb_build_object('playerId', :'g1', 'stacks', 2)
   from public.evening_events ee
   where ee.evening_id = :e6 and ee.type = 'join' and ee.payload ->> 'playerId' = :'g1'),
  'ключ повтора записан у входа гостя');

select public.add_guest(:e6, 'Гость Повтор', 2, :k1) as g1_again \gset
select pg_temp.check(:'g1_again' = :'g1', 'повтор тем же ключом — тот же гость');
select public.add_guest(:e6, '  гость   повтор ', 2, :k1) as g1_case \gset
select pg_temp.check(:'g1_case' = :'g1',
  'повтор с другим регистром и пробелами — то же намерение');
select pg_temp.check(
  (select players = 1 and joins = 1 from pg_temp.guests(:e6, 'Гость Повтор')),
  'после повторов — один гость и один вход');

-- ===========================================================================
-- 2. Ключ другого намерения — отказ 22023, ничего не создаётся
-- ===========================================================================
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Повтор', 3, %L)$q$, :e6, :k1),
  'Ключ повтора уже занят другой записью', 'тот же ключ с другой кратностью');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Другой Гость', 2, %L)$q$, :e6, :k1),
  'Ключ повтора уже занят другой записью', 'тот же ключ с другим именем');

-- Ключ обычного входа (add_event) гостю не подходит.
select public.add_event(:e6, 'join', jsonb_build_object('playerId', :p3), :k2);
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Чужой', 1, %L)$q$, :e6, :k2),
  'Ключ повтора уже занят другой записью', 'ключ входа постоянного игрока');

reset role;
select pg_temp.check(
  (select count(*) = 0 from public.players where display_name in ('Другой Гость', 'Гость Чужой')),
  'отказы по ключу не оставили игроков');

-- Чужой ключ (другой автор) — тоже другое намерение.
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Повтор', 2, %L)$q$, :e6, :k1),
  'Ключ повтора уже занят другой записью', 'ключ, записанный другим банкиром');

-- ===========================================================================
-- 3. Без ключа — как раньше: каждый вызов — новый гость
-- ===========================================================================
select public.add_guest(:e6, 'Гость Без Ключа');
select public.add_guest(:e6, 'Гость Без Ключа', 1);
select pg_temp.check(
  (select players = 2 and joins = 2 from pg_temp.guests(:e6, 'Гость Без Ключа')),
  'без ключа — два вызова, два гостя (старый клиент)');
select pg_temp.check(
  (select bool_and(ee.client_id is null)
   from public.evening_events ee
   join public.players p on p.id::text = ee.payload ->> 'playerId'
   where ee.evening_id = :e6 and p.display_name = 'Гость Без Ключа'),
  'без ключа — client_id пуст');

-- ===========================================================================
-- 4. Повтор — до проверки состояния вечера: ответ потерялся, а вечер уже закрыт для записи
-- ===========================================================================
select public.add_guest(:e6, 'Гость До Отмены', 1, :k3) as g3 \gset
reset role;
update public.evenings set status = 'cancelled' where id = :e6;
select pg_temp.login(:admin);
set local role authenticated;
select public.add_guest(:e6, 'Гость До Отмены', 1, :k3) as g3_again \gset
select pg_temp.check(:'g3_again' = :'g3',
  'повтор после отмены вечера возвращает гостя, а не «журнал закрыт»');
reset role;

-- ===========================================================================
-- 5. Права и сигнатура (с миграции 020 — ещё и p_paid_rub: (uuid, text, integer, uuid, integer))
-- ===========================================================================
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_guest(uuid, text, integer, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.add_guest(uuid, text, integer, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.add_guest(uuid, text, integer, uuid, integer)', 'execute'),
  'add_guest(uuid, text, integer, uuid, integer): authenticated и service_role, не anon');
select pg_temp.check(
  to_regprocedure('public.add_guest(uuid, text, integer)') is null
  and to_regprocedure('public.add_guest(uuid, text)') is null,
  'старых сигнатур add_guest нет — вызовы с двумя и тремя аргументами не двусмысленны');
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.guest_by_client_id(uuid, uuid, uuid, text, integer)', 'execute')
  and not has_function_privilege('anon', 'private.guest_by_client_id(uuid, uuid, uuid, text, integer)', 'execute'),
  'private.guest_by_client_id снаружи не вызвать');

rollback;
