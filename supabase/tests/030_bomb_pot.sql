-- Проверки миграции 030 (бомб-пот: бросок сервера, переброс после отмены, кто забрал банк, add_events с
-- раздачей и бомб-потом) на локальной БД с seed.sql: всё в одной транзакции, в конце rollback — данные
-- не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/030_bomb_pot.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'authenticated', 'authenticated', 't1002@test.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'authenticated', 'authenticated', 't1003@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'authenticated', 'authenticated', 't1004@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a002'
  where id = 'a0000000-0000-4000-8000-000000001002';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a003'
  where id = 'a0000000-0000-4000-8000-000000001003';
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
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;

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
grant execute on function pg_temp.rejects(text, text, text, text) to anon, authenticated;

-- add_event и add_events одной строкой для rejects.
create function pg_temp.ev(p_evening text, p_type text, p_payload jsonb, p_key text default null)
returns text language sql immutable as $$
  select format('select public.add_event(%L, %L, %L::jsonb, %L)', p_evening, p_type, p_payload, p_key);
$$;
grant execute on function pg_temp.ev(text, text, jsonb, text) to anon, authenticated;
create function pg_temp.evs(p_evening text, p_events jsonb, p_key text default null)
returns text language sql immutable as $$
  select format('select * from public.add_events(%L, %L::jsonb, %L)', p_evening, p_events, p_key);
$$;
grant execute on function pg_temp.evs(text, jsonb, text) to authenticated;

-- Ключ i-й записи действия — та же формула, что private.derived_client_id (020).
create function pg_temp.key(p_client_id uuid, p_n integer) returns uuid language sql as $$
  select case when p_n = 0 then p_client_id else md5(p_client_id::text || ':' || p_n::text)::uuid end;
$$;
grant execute on function pg_temp.key(uuid, integer) to authenticated;

create function pg_temp.journal_size(p_evening uuid) returns bigint language sql as $$
  select count(*) from public.evening_events where evening_id = p_evening;
$$;
grant execute on function pg_temp.journal_size(uuid) to authenticated;

create function pg_temp.status(p_evening uuid) returns text language sql security definer as $$
  select status from public.evenings where id = p_evening;
$$;
grant execute on function pg_temp.status(uuid) to authenticated;

-- Течение времени: в одной транзакции now() один, а правило «той же раздачи» (030) сравнивает, когда
-- раздачу отменили, с временем броска. Сдвиг всего журнала вечера на минуту назад — следующее действие
-- случилось «позже» всех прежних (триггер 008 смотрит только на саму отмену — он не срабатывает).
create function pg_temp.tick(p_evening uuid) returns void language sql security definer as $$
  update public.evening_events
  set at = at - interval '1 minute',
      voided_at = voided_at - interval '1 minute'
  where evening_id = p_evening;
$$;
grant execute on function pg_temp.tick(uuid) to authenticated;

-- Бросок записи и бросок годен: целое 1..5.
create function pg_temp.bbs(p_payload jsonb) returns integer language sql immutable as $$
  select case when jsonb_typeof(p_payload -> 'bbs') = 'number'
              then (p_payload ->> 'bbs')::integer end;
$$;
grant execute on function pg_temp.bbs(jsonb) to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set banker '''00000000-0000-4000-8000-00000000a002'''
\set stranger '''00000000-0000-4000-8000-00000000a003'''
\set banker5 '''00000000-0000-4000-8000-00000000a004'''
\set e1 '''e0000000-0000-4000-8000-000000000001'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set pJ '''a0000000-0000-4000-8000-000000001001'''
\set pS '''a0000000-0000-4000-8000-000000001002'''
\set pD '''a0000000-0000-4000-8000-000000001003'''
\set pL '''a0000000-0000-4000-8000-000000001004'''
\set pM '''a0000000-0000-4000-8000-000000001005'''
\set k1 '''c3000000-0000-4000-8000-000000000001'''
\set k2 '''c3000000-0000-4000-8000-000000000002'''
\set k3 '''c3000000-0000-4000-8000-000000000003'''
\set k4 '''c3000000-0000-4000-8000-000000000004'''
\set k5 '''c3000000-0000-4000-8000-000000000005'''
\set k6 '''c3000000-0000-4000-8000-000000000006'''
\set k7 '''c3000000-0000-4000-8000-000000000007'''

-- ===========================================================================
-- 0. Типы событий и кубик
-- ===========================================================================
select pg_temp.check(
  (select pg_get_constraintdef(c.oid) like '%''bomb_pot''::text%''bomb_pot_result''::text%'
   from pg_constraint c
   where c.conname = 'evening_events_type_check' and c.conrelid = 'public.evening_events'::regclass),
  'evening_events_type_check: bomb_pot и bomb_pot_result — в списке типов');

-- 10 000 бросков: каждое значение 1..5 — от 1 800 до 2 200 раз (ожидание 2 000, σ = 40: ±5σ, ложное
-- падение — около 3·10⁻⁶), других значений нет.
create temp table rolls on commit drop as
  select private.bomb_pot_roll() as v from generate_series(1, 10000);
select pg_temp.check(
  (select count(*) = 10000 and min(v) = 1 and max(v) = 5 and count(distinct v) = 5 from rolls),
  'bomb_pot_roll: 10 000 бросков, значения ровно 1..5');
select pg_temp.check(
  (select bool_and(n between 1800 and 2200) from (select count(*) as n from rolls group by v) x),
  format('bomb_pot_roll: каждое значение 1 800..2 200 раз (%s)',
    (select string_agg(v || ':' || n, ' ' order by v) from (select v, count(*) as n from rolls group by v) x)));

-- ===========================================================================
-- 1. Права и анонс: не банкир, anon, до старта таймера
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;

select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pJ))).id as j1 \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pS))).id as j2 \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pD))).id as j3 \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pL))).id as j4 \gset

select pg_temp.journal_size(:e6) as size0 \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  'P0001', 'Игра ещё не началась — бомб-пот объявляют после старта таймера', 'на анонсе бомб-пот не объявить');
select pg_temp.check(pg_temp.status(:e6) = 'announced', 'вечер остался анонсом');

select pg_temp.login(:stranger);
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  '42501', 'Вести журнал вечера может только банкир', 'не банкир — бомб-пот не объявить');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :j1, 'winners', jsonb_build_array(:pJ))),
  '42501', 'Вести журнал вечера может только банкир', 'не банкир — кто забрал банк не отметить');
reset role;
set local role anon;
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  '42501', 'permission denied', 'anon — add_event недоступен');
reset role;
set local role authenticated;
select pg_temp.check(pg_temp.journal_size(:e6) = :size0, 'отказы ничего не записали');

-- ===========================================================================
-- 2. Бросок сервера: форма записи, ключ повтора, подделка, один на раздачу
-- ===========================================================================
select pg_temp.login(:banker);
select (public.add_event(:e6, 'timer_start')).id as started \gset
select pg_temp.check(pg_temp.status(:e6) = 'live', 'старт таймера — live');

create temp table bomb1 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb, :k1);
select id as bp1, pg_temp.bbs(payload) as bbs1 from bomb1 \gset
select pg_temp.check(
  (select (select array_agg(k order by k) from jsonb_object_keys(payload) as k) = array['bbs']
          and pg_temp.bbs(payload) between 1 and 5
          and created_by = 'a0000000-0000-4000-8000-000000001002'
   from bomb1),
  'bomb_pot: от клиента {}, в журнале только {bbs} — бросок 1..5');

select pg_temp.journal_size(:e6) as size1 \gset
select pg_temp.check(
  (select id = :bp1 and pg_temp.bbs(payload) = :bbs1
   from public.add_event(:e6, 'bomb_pot', '{}'::jsonb, :k1))
  and pg_temp.journal_size(:e6) = :size1,
  'повтор тем же ключом — та же запись с тем же броском, кубик не перебрасывается');
select pg_temp.check(
  (select id = :bp1 and pg_temp.bbs(payload) = :bbs1
   from public.add_event(:e6, 'bomb_pot', '{"bbs": 5}'::jsonb, :k1)),
  'повтор с присланным bbs возвращает записанное: бросок сервера не подменить');

select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{"bbs": 3}'::jsonb),
  '22023', 'лишнее поле «bbs»', 'клиент прислал взнос — отказ');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{"previousBbs": [2]}'::jsonb),
  '22023', 'лишнее поле «previousBbs»', 'клиент прислал переброс — отказ');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb, :k2),
  'P0001', 'В этой раздаче бомб-пот уже объявлен — новый можно со следующей раздачи',
  'второй бомб-пот в той же раздаче — отказ (два телефона разом)');
select pg_temp.check(pg_temp.journal_size(:e6) = :size1, 'отказы броска ничего не записали');

-- ===========================================================================
-- 3. Переброс: отмена и повторное объявление в той же раздаче — новый бросок с previousBbs
-- ===========================================================================
select public.void_event(:bp1);
create temp table bomb2 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb, :k2);
select id as bp2, pg_temp.bbs(payload) as bbs2 from bomb2 \gset
select pg_temp.check(
  (select pg_temp.bbs(payload) between 1 and 5
          and payload -> 'previousBbs' = jsonb_build_array(:bbs1)
   from bomb2),
  'после отмены — новый бросок, отменённый — в previousBbs (переброс)');
select public.void_event(:bp2);
create temp table bomb3 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb, :k3);
select id as bp3 from bomb3 \gset
select pg_temp.check(
  (select payload -> 'previousBbs' = jsonb_build_array(:bbs1, :bbs2) from bomb3),
  'второй переброс: оба отменённых броска раздачи по порядку');
select pg_temp.check(
  (select count(*) = 3 from public.evening_events
   where evening_id = :e6 and type = 'bomb_pot' and id in (:bp1, :bp2, :bp3)),
  'отменённые броски остаются в журнале (видны в ленте)');

-- ===========================================================================
-- 4. Новый бросок после «Следующей раздачи»; отмена раздачи возвращает бомб-пот в раздачу
-- ===========================================================================
select (public.add_event(:e6, 'hand')).id as hand1 \gset
create temp table bomb4 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb, :k4);
select id as bp4 from bomb4 \gset
select pg_temp.check(
  (select not (payload ? 'previousBbs') and pg_temp.bbs(payload) between 1 and 5 from bomb4),
  'после раздачи — первый бросок новой раздачи, без previousBbs');
select public.void_event(:hand1);
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  'P0001', 'бомб-пот уже объявлен',
  'раздача отменена — бомб-поты снова в одной раздаче, новый не объявить');
select (public.add_event(:e6, 'hand')).id as hand2 \gset

-- ===========================================================================
-- 5. Кто забрал банк: форма, ключ повтора, отказы
-- ===========================================================================
create temp table res1 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', (:bp4 || '.0')::numeric, 'winners', jsonb_build_array(upper(:pJ), :pS)), :k5);
select id as res1 from res1 \gset
select pg_temp.check(
  (select payload = jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pJ, :pS)) from res1),
  'bomb_pot_result: eventId числом, забравшие — uuid в нижнем регистре, порядок сохранён');
select pg_temp.journal_size(:e6) as size5 \gset
select pg_temp.check(
  (select id = :res1 from public.add_event(:e6, 'bomb_pot_result',
     jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pJ, upper(:pS))), :k5))
  and pg_temp.journal_size(:e6) = :size5,
  'повтор результата тем же ключом (регистр не важен) — та же запись');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pS, :pJ)), :k5),
  '22023', 'Ключ повтора уже занят', 'тот же ключ, другой порядок забравших');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pD)), :k5),
  '22023', 'Ключ повтора уже занят', 'тот же ключ, другие забравшие');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp3, 'winners', jsonb_build_array(:pJ, :pS)), :k5),
  '22023', 'Ключ повтора уже занят', 'тот же ключ, другой бомб-пот');

select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result', jsonb_build_object('eventId', :bp4)),
  '22023', '«winners» — список тех, кто забрал банк', 'без забравших');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', '[]'::jsonb)),
  '22023', '«winners» — список тех, кто забрал банк', 'пустой список забравших');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', :pJ)),
  '22023', '«winners» — список тех, кто забрал банк', 'забравший не списком');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pJ, upper(:pJ)))),
  '22023', 'указан дважды', 'забравший повторяется');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pM))),
  '22023', 'не за столом этого вечера', 'забравший без входа в вечер');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array('a0000000-0000-4000-8000-0000000019ff'))),
  '22023', 'не найден', 'забравшего нет среди игроков');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4::text, 'winners', jsonb_build_array(:pJ))),
  '22023', '«eventId» — номер записи бомб-пота', 'eventId строкой');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', 0, 'winners', jsonb_build_array(:pJ))),
  '22023', '«eventId» — номер записи бомб-пота', 'eventId 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', 2.5, 'winners', jsonb_build_array(:pJ))),
  '22023', '«eventId» — номер записи бомб-пота', 'eventId дробью');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :j1, 'winners', jsonb_build_array(:pJ))),
  '22023', 'нет в журнале этого вечера', 'eventId — вход, а не бомб-пот');
select (ee.id) as e1_event from public.evening_events ee where ee.evening_id = :e1 order by ee.id limit 1 \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :e1_event, 'winners', jsonb_build_array(:pJ))),
  '22023', 'нет в журнале этого вечера', 'eventId — запись другого вечера');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp4, 'winners', jsonb_build_array(:pJ), 'pot', 100)),
  '22023', 'лишнее поле «pot»', 'лишнее поле результата');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp1, 'winners', jsonb_build_array(:pJ))),
  'P0001', 'Бомб-пот отменён — отмечать, кто забрал банк, нечего', 'отменённый бомб-пот');
select pg_temp.check(pg_temp.journal_size(:e6) = :size5, 'отказы результата ничего не записали');

-- ===========================================================================
-- 6. add_events: «Кто забрал банк» — результат и раздача; раздача и бомб-пот; откат пачки
-- ===========================================================================
select (public.add_event(:e6, 'hand')).id as hand3 \gset
create temp table bomb5 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb);
select id as bp5 from bomb5 \gset
create temp table close_rows on commit drop as
  select * from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'bomb_pot_result',
      'payload', jsonb_build_object('eventId', :bp5, 'winners', jsonb_build_array(upper(:pD)))),
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb)
  ), :k6);
select pg_temp.check(
  (select array_agg(type || ':' || payload::text order by id) from close_rows)
    = array['bomb_pot_result:' || jsonb_build_object('eventId', :bp5, 'winners', jsonb_build_array(:pD))::text,
            'hand:{}'],
  'add_events: кто забрал банк и раздача, payload нормализован');
select pg_temp.check(
  (select bool_and(client_id = pg_temp.key(:k6::uuid, (n - 1)::int))
   from (select client_id, row_number() over (order by id) as n from close_rows) x)
  and (select count(distinct at) = 1 from close_rows),
  'ключи действия и одно время — «Отменить» снимает обе записи');
select pg_temp.journal_size(:e6) as size6 \gset
select pg_temp.check(
  (select count(*) = 2 from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'bomb_pot_result',
      'payload', jsonb_build_object('eventId', :bp5, 'winners', jsonb_build_array(:pD))),
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb)
  ), :k6)) and pg_temp.journal_size(:e6) = :size6,
  'повтор действия тем же ключом — те же записи');

-- Откаты пачек — пока в раздаче бомб-пота нет: отказ ложится на свою запись.
select pg_temp.rejects(pg_temp.evs(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb))),
  'P0001', 'бомб-пот уже объявлен', 'второй бомб-пот в пачке откатывает всё действие');
select pg_temp.rejects(pg_temp.evs(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{"bbs": 5}'::jsonb))),
  '22023', 'лишнее поле «bbs»', 'взнос в пачке — отказ, раздача не записана');
select pg_temp.rejects(pg_temp.evs(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'timer_pause', 'payload', '{}'::jsonb))),
  '22023', 'только входы, ребаи, вылеты и платежи, места и баттон, раздача и бомб-пот',
  'пауза в действии — по-прежнему отказ');
select pg_temp.check(pg_temp.journal_size(:e6) = :size6, 'откаты пачек ничего не записали');

-- Объявить на следующую раздачу: раздача и бомб-пот одним действием — бросок видит новую раздачу.
select public.void_event(:bp5);
select pg_temp.tick(:e6);
create temp table next_rows on commit drop as
  select * from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb)
  ), :k7);
select pg_temp.check(
  (select array_agg(type order by id) = array['hand', 'bomb_pot'] from next_rows)
  and (select pg_temp.bbs(payload) between 1 and 5 and not (payload ? 'previousBbs')
       from next_rows where type = 'bomb_pot'),
  'add_events: раздача и бомб-пот — бросок новой раздачи без переброса (отменённый бросок прошлой раздачи не в счёт)');
select id as bp6, pg_temp.bbs(payload) as bbs6 from next_rows where type = 'bomb_pot' \gset
select id as hand4 from next_rows where type = 'hand' \gset
select pg_temp.journal_size(:e6) as size7 \gset

-- Бомб-пот раздачи уже объявлен: «на следующую раздачу» закрыло бы его без «Кто забрал» — отказ всей
-- пачке; повтор того же действия тем же ключом — те же записи (тайм-аут, повтор).
select pg_temp.rejects(pg_temp.evs(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb))),
  'P0001', 'В этой раздаче бомб-пот уже объявлен — сначала отметь, кто забрал банк',
  'раздача и бомб-пот при открытом бомб-поте — отказ (второй телефон, повтор с другим ключом)');
select pg_temp.check(
  (select array_agg(id order by id) from public.add_events(:e6, jsonb_build_array(
     jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
     jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb)
   ), :k7)) = array[:hand4, :bp6]::bigint[]
  and pg_temp.journal_size(:e6) = :size7,
  'повтор «на следующую раздачу» тем же ключом — те же раздача и бросок');

-- ===========================================================================
-- 6a. Переброс по счёту раздач: объявление «на следующую раздачу» отменено вместе с раздачей
-- ===========================================================================
-- Отмена обеих записей и снова [раздача, бомб-пот]: отменённый бросок лежит в журнале раньше новой
-- раздачи, но раздача та же по счёту — переброс.
select pg_temp.tick(:e6);
select public.void_events(array[:hand4, :bp6]::bigint[]);
select pg_temp.tick(:e6);
create temp table next_rows2 on commit drop as
  select * from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb)));
select id as bp7, pg_temp.bbs(payload) as bbs7 from next_rows2 where type = 'bomb_pot' \gset
select id as hand5 from next_rows2 where type = 'hand' \gset
select pg_temp.check(
  (select payload -> 'previousBbs' = jsonb_build_array(:bbs6) from next_rows2 where type = 'bomb_pot'),
  '[раздача, бомб-пот] → отмена обеих → [раздача, бомб-пот]: переброс, отменённый бросок — в previousBbs');

-- Отмена ещё раз и сразу «Эта раздача» (шторка открывается на ней): раздач по счёту на одну меньше, чем
-- в момент отменённых бросков, но они лежат после последней действующей раздачи — та же раздача,
-- переброс (живая проверка 26.10.2026: повтор после «Отменить» в тосте шёл без пометки).
select pg_temp.tick(:e6);
select public.void_events(array[:hand5, :bp7]::bigint[]);
select pg_temp.tick(:e6);
create temp table bomb7b on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb);
select id as bp7b from bomb7b \gset
select pg_temp.check(
  (select payload -> 'previousBbs' = jsonb_build_array(:bbs6, :bbs7) from bomb7b),
  '[раздача, бомб-пот] → отмена обеих → «Эта раздача»: переброс, оба отменённых броска по порядку');

-- Отмена и его, потом отдельно «Следующая раздача» и «Эта раздача» — переброс с бросками «на следующую
-- раздачу»; бросок «Этой раздачи» был в прежней раздаче по счёту — не в счёт.
select pg_temp.tick(:e6);
select public.void_event(:bp7b);
select pg_temp.tick(:e6);
select (public.add_event(:e6, 'hand')).id as hand6 \gset
select pg_temp.tick(:e6);
create temp table bomb8 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb);
select id as bp8 from bomb8 \gset
select pg_temp.check(
  (select payload -> 'previousBbs' = jsonb_build_array(:bbs6, :bbs7) from bomb8),
  'отмена → «Следующая раздача» → «Эта раздача»: переброс той же раздачи, оба отменённых броска по порядку');

-- Раздача, отменённая ДО броска, его раздачу не меняет: бросок был в прежней раздаче, и после новой
-- «Следующей раздачи» объявление — первый бросок.
select pg_temp.tick(:e6);
select count(*) as closed8 from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'bomb_pot_result',
    'payload', jsonb_build_object('eventId', :bp8, 'winners', jsonb_build_array(:pJ))),
  jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb))) \gset
select pg_temp.tick(:e6);
select (public.add_event(:e6, 'hand')).id as hand_mistake \gset
select pg_temp.tick(:e6);
select public.void_event(:hand_mistake);
select pg_temp.tick(:e6);
select (public.add_event(:e6, 'bomb_pot', '{}'::jsonb)).id as bp9 \gset
select pg_temp.check(
  (select not (payload ? 'previousBbs') from public.evening_events where id = :bp9),
  'бросок после отменённой раздачи — первый в своей раздаче');
select pg_temp.tick(:e6);
select public.void_event(:bp9);
select pg_temp.tick(:e6);
select (public.add_event(:e6, 'hand')).id as hand7 \gset
select pg_temp.tick(:e6);
create temp table bomb10 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb);
select pg_temp.check(
  (select not (payload ? 'previousBbs') from bomb10),
  'раздача отменена до броска: бросок был в прежней раздаче — в следующей раздаче первый бросок');

-- «На следующую раздачу» отменено вместе с раздачей, бомб-пот сыгран «Этой раздачей» (с переброском) и
-- закрыт «Кто забрал»: в следующей раздаче раздач по счёту столько же, сколько у отменённого броска, но
-- он был до сыгранного бомб-пота — первый бросок без переброса (живая проверка 26.10.2026: счёт раздач
-- приписывал его новой раздаче).
select pg_temp.tick(:e6);
select count(*) as closed10 from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'bomb_pot_result',
    'payload', jsonb_build_object('eventId', (select id from bomb10), 'winners', jsonb_build_array(:pL))),
  jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb))) \gset
select pg_temp.tick(:e6);
create temp table next_rows3 on commit drop as
  select * from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb),
    jsonb_build_object('type', 'bomb_pot', 'payload', '{}'::jsonb)));
select id as bp11, pg_temp.bbs(payload) as bbs11 from next_rows3 where type = 'bomb_pot' \gset
select id as hand8 from next_rows3 where type = 'hand' \gset
select pg_temp.tick(:e6);
select public.void_events(array[:hand8, :bp11]::bigint[]);
select pg_temp.tick(:e6);
create temp table bomb12 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb);
select id as bp12 from bomb12 \gset
select pg_temp.check(
  (select payload -> 'previousBbs' = jsonb_build_array(:bbs11) from bomb12),
  '«на следующую» отменено с раздачей → «Эта раздача»: переброс');
select pg_temp.tick(:e6);
select count(*) as closed12 from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'bomb_pot_result',
    'payload', jsonb_build_object('eventId', :bp12, 'winners', jsonb_build_array(:pL))),
  jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb))) \gset
select pg_temp.tick(:e6);
create temp table bomb13 on commit drop as
  select * from public.add_event(:e6, 'bomb_pot', '{}'::jsonb);
select pg_temp.check(
  (select not (payload ? 'previousBbs') and pg_temp.bbs(payload) between 1 and 5 from bomb13),
  'после сыгранного бомб-пота отменённый до него бросок не в счёт новой раздачи (раздач столько же)');

-- Дальше (финиш, табло) — с этим открытым бомб-потом.
select id as bp6 from bomb13 \gset

-- ===========================================================================
-- 7. Завершение: банкир — 42501, админ — P0001; отмена финиша; закрытый расчёт
-- ===========================================================================
select (public.add_event(:e6, 'finish')).id as finish_e6 \gset
select pg_temp.check(pg_temp.status(:e6) = 'finished', 'finish — finished');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  '42501', 'банкир может вносить только платежи', 'банкир после финиша — бомб-пот не объявить');
select pg_temp.login(:admin);
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  'P0001', 'Игра окончена — бомб-пот уже не объявить', 'админ после финиша — бомб-пот не объявить');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot_result',
    jsonb_build_object('eventId', :bp6, 'winners', jsonb_build_array(:pJ))),
  'P0001', 'Игра окончена — кто забрал бомб-пот, уже не отметить', 'админ после финиша — результат не отметить');
select pg_temp.check(pg_temp.status(:e6) = 'finished', 'отказы не открыли вечер');
select public.void_event(:finish_e6);
select pg_temp.check(pg_temp.status(:e6) = 'live', 'отмена finish — снова live');
select pg_temp.rejects(pg_temp.ev(:e6, 'bomb_pot', '{}'::jsonb),
  'P0001', 'бомб-пот уже объявлен', 'после отмены финиша бомб-пот раздачи снова открыт');
select pg_temp.check(
  (select type = 'bomb_pot_result' from public.add_event(:e6, 'bomb_pot_result',
     jsonb_build_object('eventId', :bp6, 'winners', jsonb_build_array(:pL)))),
  'после отмены финиша результат снова пишется');

select pg_temp.rejects(pg_temp.ev(:e1, 'bomb_pot', '{}'::jsonb),
  'P0001', 'Игра окончена — бомб-пот уже не объявить', 'закрытый расчёт — бомб-пот не объявить');
select pg_temp.check(pg_temp.status(:e1) = 'settled', 'закрытый расчёт не открылся');
select pg_temp.login(:banker5);
select pg_temp.rejects(pg_temp.ev(:e5, 'bomb_pot', '{}'::jsonb),
  '42501', 'банкир может вносить только платежи', 'банкир завершённого вечера — бомб-пот не объявить');

-- ===========================================================================
-- 8. Табло получает бомб-пот и результат; отменённого броска — нет
-- ===========================================================================
reset role;
select board_token as tok6 from public.evenings where id = :e6 \gset
set local role anon;
select pg_temp.check(
  (select count(*) filter (where ev ->> 'type' = 'bomb_pot' and (ev -> 'payload' ? 'bbs')) >= 2
      and count(*) filter (where ev ->> 'type' = 'bomb_pot_result'
                            and ev -> 'payload' -> 'winners' = jsonb_build_array(:pJ, :pS)) = 1
      and count(*) filter (where (ev ->> 'id')::bigint in (:bp1, :bp2, :bp5)) = 0
      and count(*) filter (where (ev ->> 'id')::bigint = :bp3
                            and ev -> 'payload' -> 'previousBbs' = jsonb_build_array(:bbs1, :bbs2)) = 1
   from jsonb_array_elements(public.board_state(:'tok6'::uuid) -> 'events') as ev),
  'board_state: бомб-поты с броском и переброс, результат; отменённых бросков нет');
reset role;

-- ===========================================================================
-- 9. Слияние гостя: забравшие бомб-пот переносятся и держат игрока в журнале
-- ===========================================================================
select pg_temp.check(
  private.payload_replace_player(
    jsonb_build_object('eventId', 7, 'winners', jsonb_build_array(:pJ, :pS)), :pJ::uuid, :pD::uuid)
    = jsonb_build_object('eventId', 7, 'winners', jsonb_build_array(:pD, :pS)),
  'payload_replace_player: забравший заменён, порядок и eventId сохранены');
select pg_temp.check(
  private.payload_replace_player(
    jsonb_build_object('playerId', :pJ, 'by', jsonb_build_array(:pS)), :pS::uuid, :pD::uuid)
    = jsonb_build_object('playerId', :pJ, 'by', jsonb_build_array(:pD))
  and private.payload_replace_player('{"bbs": 3}'::jsonb, :pS::uuid, :pD::uuid) = '{"bbs": 3}'::jsonb,
  'payload_replace_player: выбившие — как раньше, бросок не трогается');
select pg_temp.check(
  private.payload_mentions_player(jsonb_build_object('eventId', 7, 'winners', jsonb_build_array(:pJ, :pS)), :pS)
  and not private.payload_mentions_player(jsonb_build_object('eventId', 7, 'winners', jsonb_build_array(:pJ)), :pS)
  and private.payload_mentions_player(jsonb_build_object('playerId', :pS, 'seat', 3), :pS),
  'payload_mentions_player: видит забравших, остальное — как раньше');

-- ===========================================================================
-- 10. Гранты и security definer
-- ===========================================================================
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.add_events(uuid, jsonb, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.add_events(uuid, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_events(uuid, jsonb, uuid)', 'execute'),
  'add_event и add_events: authenticated и service_role, не anon');
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.bomb_pot_roll()', 'execute')
  and not has_function_privilege('anon', 'private.bomb_pot_roll()', 'execute')
  and not has_function_privilege('authenticated', 'private.json_bomb_pot_winners(jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.json_bomb_pot_winners(jsonb, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.payload_replace_player(jsonb, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.payload_mentions_player(jsonb, text)', 'execute'),
  'служебные функции (кубик, забравшие, слияние) снаружи не вызвать');
select pg_temp.check(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc p where p.oid = 'public.add_event(uuid, text, jsonb, uuid)'::regprocedure)
  and (select p.prosecdef and p.proconfig @> array['search_path=""']
       from pg_proc p where p.oid = 'public.add_events(uuid, jsonb, uuid)'::regprocedure)
  and (select not p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""']
       from pg_proc p where p.oid = 'private.bomb_pot_roll()'::regprocedure),
  'add_event и add_events — security definer с пустым search_path; кубик — volatile');

rollback;
