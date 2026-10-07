-- Проверки миграции 015 на локальной БД с seed.sql: всё в одной транзакции, в конце rollback —
-- данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/015_entry_stacks.sql
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

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set p3 '''a0000000-0000-4000-8000-000000001003'''
\set p4 '''a0000000-0000-4000-8000-000000001004'''
\set p5 '''a0000000-0000-4000-8000-000000001005'''

select pg_temp.login(:admin);
set local role authenticated;

-- ===========================================================================
-- 1. join: кратность хранится только при k > 1
-- ===========================================================================
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :p3, 'stacks', 2))).payload
    = jsonb_build_object('playerId', :p3, 'stacks', 2),
  'вход ×2 — stacks в payload');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :p4, 'stacks', 1))).payload
    = jsonb_build_object('playerId', :p4),
  'вход ×1 — payload как до миграции, без stacks');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :p5))).payload
    = jsonb_build_object('playerId', :p5),
  'вход без stacks — как раньше');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :p5, 'stacks', 10.0))).payload
    = jsonb_build_object('playerId', :p5, 'stacks', 10),
  '10.0 — целое, хранится как 10 (игровые правила, повторный вход, — дело replay)');

-- ===========================================================================
-- 2. Неверная кратность и лишние поля — 22023
-- ===========================================================================
select pg_temp.rejects(format($q$select public.add_event(%L, 'join', '{"playerId": %s, "stacks": 0}')$q$, :e6, to_json(:p3::text)),
  'Кратность входа — целое число от 1 до 10', 'stacks 0');
select pg_temp.rejects(format($q$select public.add_event(%L, 'join', '{"playerId": %s, "stacks": 11}')$q$, :e6, to_json(:p3::text)),
  'Кратность входа — целое число от 1 до 10', 'stacks 11');
select pg_temp.rejects(format($q$select public.add_event(%L, 'rebuy', '{"playerId": %s, "stacks": 1.5}')$q$, :e6, to_json(:p3::text)),
  'Кратность входа — целое число от 1 до 10', 'stacks 1.5');
select pg_temp.rejects(format($q$select public.add_event(%L, 'rebuy', '{"playerId": %s, "stacks": "2"}')$q$, :e6, to_json(:p3::text)),
  'Кратность входа — целое число от 1 до 10', 'stacks строкой');
select pg_temp.rejects(format($q$select public.add_event(%L, 'join', '{"playerId": %s, "stacks": null}')$q$, :e6, to_json(:p3::text)),
  'Кратность входа — целое число от 1 до 10', 'stacks null');
select pg_temp.rejects(format($q$select public.add_event(%L, 'join', '{"playerId": %s, "stack": 2}')$q$, :e6, to_json(:p3::text)),
  'лишнее поле «stack»', 'опечатка в имени поля — лишнее поле');
select pg_temp.rejects(format($q$select public.add_event(%L, 'bust', '{"playerId": %s, "by": [], "stacks": 2}')$q$, :e6, to_json(:p3::text)),
  'лишнее поле «stacks»', 'у вылета кратности нет');

-- ===========================================================================
-- 3. rebuy с кратностью; ключ повтора сверяет кратность
-- ===========================================================================
select pg_temp.check(
  (public.add_event(:e6, 'rebuy', jsonb_build_object('playerId', :p3, 'stacks', 3),
                    'c0000000-0000-4000-8000-000000000015')).payload
    = jsonb_build_object('playerId', :p3, 'stacks', 3),
  'ребай ×3 — stacks в payload');
select pg_temp.check(
  (select count(*) = 1 from public.evening_events where client_id = 'c0000000-0000-4000-8000-000000000015'),
  'ребай записан один раз');
select pg_temp.check(
  (public.add_event(:e6, 'rebuy', jsonb_build_object('playerId', :p3, 'stacks', 3),
                    'c0000000-0000-4000-8000-000000000015')).payload ->> 'stacks' = '3',
  'повтор с тем же ключом и той же кратностью возвращает запись');
select pg_temp.check(
  (select count(*) = 1 from public.evening_events where client_id = 'c0000000-0000-4000-8000-000000000015'),
  'повтор не задвоил ребай');
select pg_temp.rejects(format($q$select public.add_event(%L, 'rebuy', '{"playerId": %s, "stacks": 2}', 'c0000000-0000-4000-8000-000000000015')$q$, :e6, to_json(:p3::text)),
  'Ключ повтора уже занят', 'тот же ключ с другой кратностью — другое намерение');
select pg_temp.rejects(format($q$select public.add_event(%L, 'rebuy', '{"playerId": %s}', 'c0000000-0000-4000-8000-000000000015')$q$, :e6, to_json(:p3::text)),
  'Ключ повтора уже занят', 'тот же ключ без кратности (×1) — тоже другое');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :p4),
                    'c0000000-0000-4000-8000-000000000016')).payload = jsonb_build_object('playerId', :p4)
  and (public.add_event(:e6, 'join', jsonb_build_object('playerId', :p4, 'stacks', 1),
                        'c0000000-0000-4000-8000-000000000016')).payload = jsonb_build_object('playerId', :p4),
  'повтор стандартного входа с явной единицей — то же намерение');

-- ===========================================================================
-- 4. add_guest: кратность гостя, проверка до создания игрока, два аргумента по-прежнему
-- ===========================================================================
select public.add_guest(:e6, 'Гость Тройной', 3) as guest3 \gset
select public.add_guest(:e6, 'Гость Обычный') as guest1 \gset
select pg_temp.check(
  (select ee.payload = jsonb_build_object('playerId', :'guest3', 'stacks', 3)
   from public.evening_events ee
   where ee.evening_id = :e6 and ee.type = 'join' and ee.payload ->> 'playerId' = :'guest3'),
  'add_guest с p_stacks = 3 — вход ×3');
select pg_temp.check(
  (select ee.payload = jsonb_build_object('playerId', :'guest1')
   from public.evening_events ee
   where ee.evening_id = :e6 and ee.type = 'join' and ee.payload ->> 'playerId' = :'guest1'),
  'add_guest с двумя аргументами — стандартный вход');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Лишний', 11)$q$, :e6),
  'Кратность входа — целое число от 1 до 10', 'add_guest с кратностью 11');
reset role;
select pg_temp.check(
  (select count(*) = 0 from public.players where display_name = 'Гость Лишний'),
  'отказ add_guest не оставил игрока');

-- Слияние гостя с профилем (008) меняет только playerId — кратность входа остаётся.
select pg_temp.check(
  private.payload_replace_player(jsonb_build_object('playerId', :p3, 'stacks', 2), :p3::uuid, :p4::uuid)
    = jsonb_build_object('playerId', :p4, 'stacks', 2),
  'payload_replace_player сохраняет stacks');

-- ===========================================================================
-- 5. Права
-- ===========================================================================
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_guest(uuid, text, integer)', 'execute')
  and has_function_privilege('service_role', 'public.add_guest(uuid, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.add_guest(uuid, text, integer)', 'execute'),
  'add_guest(uuid, text, integer): authenticated и service_role, не anon');
select pg_temp.check(
  to_regprocedure('public.add_guest(uuid, text)') is null,
  'старой сигнатуры add_guest(uuid, text) нет — вызов с двумя аргументами не двусмыслен');
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.json_entry_stacks(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.json_entry_stacks(jsonb)', 'execute'),
  'private.json_entry_stacks снаружи не вызвать');

rollback;
