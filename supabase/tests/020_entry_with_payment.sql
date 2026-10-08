-- Проверки миграции 020 (несколько записей одним действием: add_events, void_events, add_guest с
-- оплатой) на локальной БД с seed.sql: всё в одной транзакции, в конце rollback — данные не меняются.
-- Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/020_entry_with_payment.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'authenticated', 'authenticated', 't1002@test.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'authenticated', 'authenticated', 't1003@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a002'
  where id = 'a0000000-0000-4000-8000-000000001002';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a003'
  where id = 'a0000000-0000-4000-8000-000000001003';

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

-- Ошибка с нужным SQLSTATE и текстом, иначе FAIL.
create function pg_temp.rejects(p_sql text, p_state text, p_message text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — запись прошла', p_what;
exception
  when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
    if sqlstate <> p_state or position(p_message in sqlerrm) = 0 then
      raise exception 'FAIL: % — другая ошибка: % %', p_what, sqlstate, sqlerrm;
    end if;
    raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.rejects(text, text, text, text) to authenticated;

-- Ключ i-й записи действия — та же формула, что private.derived_client_id (сверка — в разделе 0):
-- роль authenticated схему private не видит.
create function pg_temp.key(p_client_id uuid, p_n integer) returns uuid language sql as $$
  select case when p_n = 0 then p_client_id else md5(p_client_id::text || ':' || p_n::text)::uuid end;
$$;
grant execute on function pg_temp.key(uuid, integer) to authenticated;

-- Записи вечера (все, с отменёнными) — для сверки «ничего не записалось».
create function pg_temp.journal_size(p_evening uuid) returns bigint language sql as $$
  select count(*) from public.evening_events where evening_id = p_evening;
$$;
grant execute on function pg_temp.journal_size(uuid) to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set banker '''00000000-0000-4000-8000-00000000a002'''
\set stranger '''00000000-0000-4000-8000-00000000a003'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set pJ '''a0000000-0000-4000-8000-000000001001'''
\set pS '''a0000000-0000-4000-8000-000000001002'''
\set pD '''a0000000-0000-4000-8000-000000001003'''
\set pL '''a0000000-0000-4000-8000-000000001004'''
\set k1 '''c2000000-0000-4000-8000-000000000001'''
\set k2 '''c2000000-0000-4000-8000-000000000002'''
\set k3 '''c2000000-0000-4000-8000-000000000003'''
\set k4 '''c2000000-0000-4000-8000-000000000004'''
\set k5 '''c2000000-0000-4000-8000-000000000005'''

-- ===========================================================================
-- 0. Ключ i-й записи действия
-- ===========================================================================
select pg_temp.check(
  private.derived_client_id(:k1::uuid, 0) = :k1::uuid
  and private.derived_client_id(:k1::uuid, 1) = md5(:k1 || ':1')::uuid
  and private.derived_client_id(:k1::uuid, 1) <> private.derived_client_id(:k1::uuid, 2)
  and private.derived_client_id(null, 1) is null
  and private.derived_client_id(:k1::uuid, 3) = pg_temp.key(:k1::uuid, 3)
  and private.derived_client_id(:k1::uuid, 0) = pg_temp.key(:k1::uuid, 0),
  'derived_client_id: 0 — сам ключ, дальше — md5(ключ:n), без ключа — null');

-- ===========================================================================
-- 1. Посадка с оплатой: входы и платежи одной транзакцией, повтор — те же записи
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;

create temp table seat_rows on commit drop as
select * from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pJ)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pJ, 'amountRub', 500)),
  jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', upper(:pD), 'stacks', 2)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pD, 'amountRub', 1000)),
  jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pL))
), :k1);

select pg_temp.check((select count(*) = 5 from seat_rows), 'add_events вернул пять записей');
select pg_temp.check(
  (select array_agg(type order by id) = array['join', 'payment', 'join', 'payment', 'join']
   from seat_rows),
  'порядок записей — порядок действия');
select pg_temp.check(
  (select bool_and(client_id = pg_temp.key(:k1::uuid, (n - 1)::int))
   from (select client_id, row_number() over (order by id) as n from seat_rows) x),
  'ключи: у первой — ключ действия, у i-й — derived_client_id(ключ, i)');
select pg_temp.check((select count(distinct at) = 1 from seat_rows), 'одна транзакция — одно время');
select pg_temp.check(
  (select payload = jsonb_build_object('playerId', :pD, 'stacks', 2)
   from seat_rows where type = 'join' and payload ->> 'playerId' = :pD),
  'payload нормализован тем же add_event: uuid в нижнем регистре, кратность');
select pg_temp.check(
  (select bool_and(created_by = :pS::uuid) from seat_rows), 'автор — банкир');

select pg_temp.journal_size(:e6) as size_seat \gset
create temp table seat_again on commit drop as
select * from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pJ)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pJ, 'amountRub', 500)),
  jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pD, 'stacks', 2)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pD, 'amountRub', 1000)),
  jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pL))
), :k1);
select pg_temp.check(
  (select array_agg(id order by id) from seat_again) = (select array_agg(id order by id) from seat_rows)
  and pg_temp.journal_size(:e6) = :size_seat,
  'повтор тем же ключом — те же записи, журнал не вырос');

select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pJ)),
    jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pD, 'amountRub', 500)))::text,
  :k1), '22023', 'Ключ повтора уже занят другой записью', 'тот же ключ, другой игрок во второй записи');

-- ===========================================================================
-- 2. Вылет и ребай с оплатой; ошибка любой записи откатывает всё действие
-- ===========================================================================
create temp table bust_rows on commit drop as
select * from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'bust', 'payload', jsonb_build_object('playerId', :pL, 'by', jsonb_build_array(:pJ, :pD))),
  jsonb_build_object('type', 'rebuy', 'payload', jsonb_build_object('playerId', :pL, 'stacks', 3)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pL, 'amountRub', 1500))
), :k2);
select pg_temp.check(
  (select array_agg(type order by id) = array['bust', 'rebuy', 'payment'] from bust_rows),
  'вылет, ребай и оплата — одним действием');

select pg_temp.journal_size(:e6) as size_before \gset
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'bust', 'payload', jsonb_build_object('playerId', :pD, 'by', jsonb_build_array())),
    jsonb_build_object('type', 'rebuy', 'payload', jsonb_build_object('playerId', :pD, 'stacks', 11)))::text,
  :k3), '22023', 'Кратность входа', 'кривая вторая запись — отказ');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_before
  and not exists (select 1 from public.evening_events where client_id = :k3::uuid),
  'после отказа первой записи действия в журнале нет');

select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pD, 'amountRub', 500)),
    jsonb_build_object('type', 'timer_start', 'payload', '{}'::jsonb))::text),
  '22023', 'только входы, ребаи, вылеты и платежи', 'таймер в действии — отказ до первой записи');
select pg_temp.rejects(format($q$select * from public.add_events(%L, '[]'::jsonb)$q$, :e6),
  '22023', 'от 1 до 50', 'пустое действие');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb)$q$, :e6,
  (select jsonb_agg(jsonb_build_object('type', 'payment',
     'payload', jsonb_build_object('playerId', :pD, 'amountRub', 1))) from generate_series(1, 51))::text),
  '22023', 'от 1 до 50', '51 запись');
select pg_temp.rejects(format($q$select * from public.add_events(%L, '{"type":"join"}'::jsonb)$q$, :e6),
  '22023', 'от 1 до 50', 'не список');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb)$q$, :e6,
  jsonb_build_array(jsonb_build_object('type', 'payment', 'payload',
    jsonb_build_object('playerId', :pD, 'amountRub', 500), 'at', 'вчера'))::text),
  '22023', 'лишнее поле «at»', 'лишнее поле записи');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_before, 'отказы формы ничего не записали');

-- Без ключа — пишется, ключи пустые.
create temp table nokey on commit drop as
select * from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pD, 'amountRub', 200)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pD, 'amountRub', -200))));
select pg_temp.check((select count(*) = 2 and bool_and(client_id is null) from nokey),
  'без ключа — записи без client_id');

-- ===========================================================================
-- 3. Права: не банкир и не админ — отказ, ничего не записано
-- ===========================================================================
reset role;
select pg_temp.login(:stranger);
set local role authenticated;
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(jsonb_build_object('type', 'payment', 'payload',
    jsonb_build_object('playerId', :pD, 'amountRub', 500)))::text, :k4),
  '42501', 'только банкир вечера или админ', 'игрок без прав');
select pg_temp.rejects(format($q$select public.void_events(array[%s]::bigint[])$q$,
  (select min(id) from bust_rows)), '42501', 'только банкир вечера или админ', 'отмена без прав');
reset role;
select pg_temp.check(not exists (select 1 from public.evening_events where client_id = :k4::uuid),
  'отказ по правам ничего не записал');

-- ===========================================================================
-- 4. void_events: всё действие одной отменой; повтор и смесь вечеров — отказ целиком
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;
select (select array_agg(id order by id desc) from bust_rows)::text as bust_ids \gset
select public.void_events(:'bust_ids'::bigint[]);
select pg_temp.check(
  (select bool_and(ee.voided_at is not null and ee.voided_by = :pS::uuid)
   from public.evening_events ee where ee.id = any (:'bust_ids'::bigint[])),
  'void_events отменил все записи действия');

select pg_temp.rejects(format($q$select public.void_events(%L::bigint[])$q$, :'bust_ids'),
  'P0001', 'Событие уже отменено', 'повторная отмена — отказ');

-- Одна уже отменённая в списке — отмена не проходит и для остальных.
select (select id from seat_rows where type = 'join' and payload ->> 'playerId' = :pL) as join_l \gset
select pg_temp.rejects(format($q$select public.void_events(array[%s, %s]::bigint[])$q$,
  :join_l, (select min(id) from bust_rows)), 'P0001', 'Событие уже отменено', 'смесь живой и отменённой');
select pg_temp.check(
  (select voided_at is null from public.evening_events where id = :join_l),
  'живая запись из отклонённой отмены не отменена');

select pg_temp.rejects(format($q$select public.void_events(array[%s, %s]::bigint[])$q$,
  :join_l, :join_l), '22023', 'дважды', 'одна запись дважды');
select pg_temp.rejects($q$select public.void_events(array[]::bigint[])$q$,
  '22023', 'от 1 до 50', 'пустая отмена');
select pg_temp.rejects($q$select public.void_events(array[1, null]::bigint[])$q$,
  '22023', 'от 1 до 50', 'null в списке');
reset role;
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects(format($q$select public.void_events(array[%s, %s]::bigint[])$q$,
  :join_l, (select min(id) from public.evening_events where evening_id = :e5)),
  '22023', 'только одного вечера', 'записи двух вечеров');
reset role;

-- ===========================================================================
-- 5. add_guest с оплатой: гость, вход и платёж одним вызовом; повтор сверяет оплату
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;
select public.add_guest(:e6, 'Гость Оплатил', 2, :k5, 1000) as g1 \gset
select pg_temp.check(
  (select count(*) = 1 from public.evening_events ee
   where ee.evening_id = :e6 and ee.type = 'payment'
     and ee.client_id = pg_temp.key(:k5::uuid, 1)
     and ee.payload = jsonb_build_object('playerId', :'g1', 'amountRub', 1000)),
  'платёж гостя записан с ключом derived_client_id(ключ, 1)');
select pg_temp.check(
  (select count(distinct at) = 1 from public.evening_events ee
   where ee.evening_id = :e6 and ee.payload ->> 'playerId' = :'g1'),
  'вход и платёж гостя — одна транзакция');

select pg_temp.journal_size(:e6) as size_guest \gset
select public.add_guest(:e6, 'Гость Оплатил', 2, :k5, 1000) as g1_again \gset
select pg_temp.check(:'g1_again' = :'g1' and pg_temp.journal_size(:e6) = :size_guest,
  'повтор с той же оплатой — тот же гость, второго платежа нет');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Оплатил', 2, %L)$q$, :e6, :k5),
  '22023', 'Ключ повтора уже занят другой записью', 'тот же ключ без оплаты');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Оплатил', 2, %L, 500)$q$, :e6, :k5),
  '22023', 'Ключ повтора уже занят другой записью', 'тот же ключ с другой суммой');

-- Ключ гостя без оплаты не принимает повтор «с оплатой».
select public.add_guest(:e6, 'Гость В Долг', 1, :k3) as g2 \gset
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость В Долг', 1, %L, 500)$q$, :e6, :k3),
  '22023', 'Ключ повтора уже занят другой записью', 'ключ без оплаты, повтор с оплатой');

-- Без ключа: платёж без client_id. Неверная сумма — отказ до создания игрока.
select public.add_guest(:e6, 'Гость Без Ключа', 1, null, 500) as g3 \gset
select pg_temp.check(
  (select count(*) = 1 and bool_and(client_id is null) from public.evening_events
   where evening_id = :e6 and type = 'payment' and payload ->> 'playerId' = :'g3'),
  'без ключа — платёж гостя без client_id');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Ноль', 1, null, 0)$q$, :e6),
  '22023', 'Оплата гостя', 'оплата 0');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость Ноль', 1, null, -500)$q$, :e6),
  '22023', 'Оплата гостя', 'оплата меньше нуля');
reset role;
select pg_temp.check(not exists (select 1 from public.players where display_name = 'Гость Ноль'),
  'отказ по сумме не оставил игрока');

-- Старые вызовы (2–4 аргумента) работают и платежа не пишут.
select pg_temp.login(:banker);
set local role authenticated;
select public.add_guest(:e6, 'Гость Старый Клиент') as g4 \gset
reset role;
select pg_temp.check(
  not exists (select 1 from public.evening_events
              where evening_id = :e6 and type = 'payment' and payload ->> 'playerId' = :'g4'),
  'add_guest с двумя аргументами — вход без платежа');

-- ===========================================================================
-- 6. Права функций и сигнатуры
-- ===========================================================================
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_events(uuid, jsonb, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.add_events(uuid, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_events(uuid, jsonb, uuid)', 'execute'),
  'add_events: authenticated и service_role, не anon');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.void_events(bigint[])', 'execute')
  and has_function_privilege('service_role', 'public.void_events(bigint[])', 'execute')
  and not has_function_privilege('anon', 'public.void_events(bigint[])', 'execute'),
  'void_events: authenticated и service_role, не anon');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_guest(uuid, text, integer, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.add_guest(uuid, text, integer, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.add_guest(uuid, text, integer, uuid, integer)', 'execute')
  and to_regprocedure('public.add_guest(uuid, text, integer, uuid)') is null,
  'add_guest(…, integer): authenticated и service_role, не anon; сигнатуры 019 нет');
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.derived_client_id(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.check_guest_payment(uuid, uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'private.check_guest_payment(uuid, uuid, uuid, integer)', 'execute'),
  'служебные функции 020 снаружи не вызвать');

rollback;
