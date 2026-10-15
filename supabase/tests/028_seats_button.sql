-- Проверки миграции 028 (места за столом и баттон: записи seat и button, add_events с рассадкой) на
-- локальной БД с seed.sql: всё в одной транзакции, в конце rollback — данные не меняются. Любая
-- неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/028_seats_button.sql
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
grant execute on function pg_temp.rejects(text, text, text, text) to authenticated;

-- add_event одной строкой для rejects.
create function pg_temp.ev(p_evening text, p_type text, p_payload jsonb, p_key text default null)
returns text language sql immutable as $$
  select format('select public.add_event(%L, %L, %L::jsonb, %L)', p_evening, p_type, p_payload, p_key);
$$;
grant execute on function pg_temp.ev(text, text, jsonb, text) to authenticated;

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
\set k1 '''c2800000-0000-4000-8000-000000000001'''
\set k2 '''c2800000-0000-4000-8000-000000000002'''
\set k3 '''c2800000-0000-4000-8000-000000000003'''
\set k4 '''c2800000-0000-4000-8000-000000000004'''

-- ===========================================================================
-- 0. Типы событий и служебная функция
-- ===========================================================================
select pg_temp.check(
  (select pg_get_constraintdef(c.oid) like '%''seat''::text%''button''::text%'
   from pg_constraint c
   where c.conname = 'evening_events_type_check' and c.conrelid = 'public.evening_events'::regclass),
  'evening_events_type_check: seat и button — в списке типов');
select pg_temp.check(
  private.json_table_seat('1') = 1 and private.json_table_seat('10') = 10
  and private.json_table_seat('4.0') = 4,
  'json_table_seat: 1, 10 и 4.0 → 4');
select pg_temp.rejects($q$select private.json_table_seat('0')$q$, '22023',
  'Место — целое число от 1 до 10', 'json_table_seat: 0');
select pg_temp.rejects($q$select private.json_table_seat(null)$q$, '22023',
  'Место — целое число от 1 до 10', 'json_table_seat: нет значения');

-- ===========================================================================
-- 1. seat: рассадка на анонсе (до старта таймера), форма payload
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;

select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pJ))).id as j1 \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pS))).id as j2 \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pD))).id as join_d \gset

select pg_temp.check(
  (public.add_event(:e6, 'seat', jsonb_build_object('playerId', upper(:pJ), 'seat', 3))).payload
    = jsonb_build_object('playerId', :pJ, 'seat', 3),
  'seat на анонсе: {playerId, seat}, uuid в нижнем регистре');
select pg_temp.check(
  (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pS, 'seat', 7.0))).payload
    = jsonb_build_object('playerId', :pS, 'seat', 7),
  'seat 7.0 — число нормализовано до 7');
select pg_temp.check(
  (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pD, 'seat', 3))).payload ->> 'seat' = '3',
  'занято ли место — правило replay: сервер запись принимает');
select pg_temp.check(pg_temp.status(:e6) = 'announced', 'рассадка не запускает вечер');

select pg_temp.journal_size(:e6) as size_bad \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 0)),
  '22023', 'Место — целое число от 1 до 10', 'место 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 11)),
  '22023', 'Место — целое число от 1 до 10', 'место 11');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 2.5)),
  '22023', 'Место — целое число от 1 до 10', 'дробное место');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', '3')),
  '22023', 'Место — целое число от 1 до 10', 'место строкой');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', null)),
  '22023', 'Место — целое число от 1 до 10', 'место null');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ)),
  '22023', 'Место — целое число от 1 до 10', 'без места');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('seat', 3)),
  '22023', 'Поле «playerId» должно быть строкой', 'без игрока');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 3, 'by', '[]'::jsonb)),
  '22023', 'лишнее поле «by»', 'лишнее поле');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pL, 'seat', 4)),
  '22023', 'не за столом этого вечера', 'игрок без входа в этот вечер');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', 'a0000000-0000-4000-8000-0000000019ff', 'seat', 4)),
  '22023', 'не найден', 'игрока нет');
select pg_temp.rejects(pg_temp.ev(:e6, 'hand', jsonb_build_object('seat', 1)),
  '22023', 'не принимает данных', 'hand по-прежнему без данных');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_bad, 'отказы ничего не записали');

-- Вход отменён — игрок уже не за столом вечера.
select public.void_event(:join_d);
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pD, 'seat', 5)),
  '22023', 'не за столом этого вечера', 'вход игрока отменён — места не дать');

-- ===========================================================================
-- 2. button: форма payload
-- ===========================================================================
select pg_temp.check(
  (public.add_event(:e6, 'button', jsonb_build_object('seat', 3))).payload = jsonb_build_object('seat', 3),
  'button {seat}');
select pg_temp.check(
  (public.add_event(:e6, 'button', jsonb_build_object('seat', 7.0))).payload = jsonb_build_object('seat', 7),
  'button 7.0 → 7');
select pg_temp.check(
  (public.add_event(:e6, 'button', jsonb_build_object('seat', 9))).payload = jsonb_build_object('seat', 9),
  'сидит ли кто на месте — правило replay: сервер запись принимает');
select pg_temp.journal_size(:e6) as size_bad2 \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 0)),
  '22023', 'Место — целое число от 1 до 10', 'баттон на место 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 11)),
  '22023', 'Место — целое число от 1 до 10', 'баттон на место 11');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', '{}'::jsonb),
  '22023', 'Место — целое число от 1 до 10', 'баттон без места');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 3, 'playerId', :pJ)),
  '22023', 'лишнее поле «playerId»', 'у баттона нет игрока');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_bad2, 'отказы баттона ничего не записали');

-- ===========================================================================
-- 3. Ключ повтора сверяет номер места
-- ===========================================================================
select (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 5), :k1)).id as seat_k1 \gset
select pg_temp.journal_size(:e6) as size_k \gset
select pg_temp.check(
  (public.add_event(:e6, 'seat', jsonb_build_object('playerId', upper(:pJ), 'seat', 5.0), :k1)).id = :seat_k1
  and pg_temp.journal_size(:e6) = :size_k,
  'повтор места с тем же ключом — та же запись');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 6), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другим местом');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pS, 'seat', 5), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другим игроком');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 5), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ — баттон вместо места');
select (public.add_event(:e6, 'button', jsonb_build_object('seat', 5), :k2)).id as button_k2 \gset
select pg_temp.check(
  (public.add_event(:e6, 'button', jsonb_build_object('seat', 5), :k2)).id = :button_k2,
  'повтор баттона с тем же ключом — та же запись');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 3), :k2),
  '22023', 'Ключ повтора уже занят', 'тот же ключ баттона с другим местом');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', '{}'::jsonb, :k2),
  '22023', 'Ключ повтора уже занят', 'тот же ключ баттона без места');

-- ===========================================================================
-- 4. add_events: «Рассадить случайно» и баттон одним действием
-- ===========================================================================
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pL))).id as j4 \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pM))).id as j5 \gset
create temp table seat_rows on commit drop as
select * from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', upper(:pL), 'seat', 2)),
  jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pM, 'seat', 8.0)),
  jsonb_build_object('type', 'button', 'payload', jsonb_build_object('seat', 8))
), :k3);
select pg_temp.check(
  (select array_agg(type || ':' || payload::text order by id) from seat_rows)
    = array['seat:' || jsonb_build_object('playerId', :pL, 'seat', 2)::text,
            'seat:' || jsonb_build_object('playerId', :pM, 'seat', 8)::text,
            'button:' || jsonb_build_object('seat', 8)::text],
  'add_events: два места и баттон, payload нормализован');
select pg_temp.check(
  (select bool_and(client_id = pg_temp.key(:k3::uuid, (n - 1)::int))
   from (select client_id, row_number() over (order by id) as n from seat_rows) x)
  and (select count(distinct at) = 1 from seat_rows),
  'ключи действия и одно время — как в 020');
select pg_temp.journal_size(:e6) as size_batch \gset
select pg_temp.check(
  (select count(*) = 3 from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pL, 'seat', 2)),
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pM, 'seat', 8)),
    jsonb_build_object('type', 'button', 'payload', jsonb_build_object('seat', 8))
  ), :k3)) and pg_temp.journal_size(:e6) = :size_batch,
  'повтор рассадки тем же ключом — те же записи');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pL, 'seat', 4)),
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pM, 'seat', 8))
  ), :k3),
  '22023', 'Ключ повтора уже занят', 'повтор рассадки с другим местом — отказ');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pL, 'seat', 4)),
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pM, 'seat', 12))
  ), :k4),
  '22023', 'Место — целое число от 1 до 10', 'кривое место во второй записи откатывает всё действие');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_batch, 'после отката журнал не вырос');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'seat', 'payload', jsonb_build_object('playerId', :pL, 'seat', 4)),
    jsonb_build_object('type', 'hand', 'payload', '{}'::jsonb))::text),
  '22023', 'только входы, ребаи, вылеты и платежи, места и баттон', 'раздача в действии — отказ');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_batch, 'отказ формы ничего не записал');

-- Отмена рассадки одним действием — void_events (020) без изменений.
select public.void_events((select array_agg(id order by id) from seat_rows));
select pg_temp.check(
  (select count(*) = 3 from public.evening_events ee
   where ee.id in (select id from seat_rows) and ee.voided_at is not null),
  'void_events отменяет рассадку целиком');

-- ===========================================================================
-- 5. Права и автоматы: не банкир, таймер, завершение, закрытый расчёт
-- ===========================================================================
select pg_temp.login(:stranger);
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pJ, 'seat', 1)),
  '42501', 'Вести журнал вечера может только банкир', 'не банкир — место не записать');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 1)),
  '42501', 'Вести журнал вечера может только банкир', 'не банкир — баттон не записать');

select pg_temp.login(:banker);
select (public.add_event(:e6, 'timer_start')).id as started \gset
select pg_temp.check(pg_temp.status(:e6) = 'live', 'старт таймера — live, как раньше');
select pg_temp.check(
  (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pS, 'seat', 4))).type = 'seat'
  and (public.add_event(:e6, 'hand')).payload = '{}'::jsonb
  and (public.add_event(:e6, 'button', jsonb_build_object('seat', 4))).type = 'button',
  'идёт игра: место, раздача и баттон');
select (public.add_event(:e6, 'finish')).id as finish_e6 \gset
select pg_temp.check(
  pg_temp.status(:e6) = 'finished'
  and (select ee.type = 'timer_pause' from public.evening_events ee
       where ee.evening_id = :e6 and ee.id = :finish_e6 - 1),
  'finish после рассадки: служебная пауза перед ним и finished — автомат таймера не задет');
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pS, 'seat', 6)),
  '42501', 'банкир может вносить только платежи', 'банкир после финиша — места нет');
select pg_temp.login(:admin);
select pg_temp.rejects(pg_temp.ev(:e6, 'seat', jsonb_build_object('playerId', :pS, 'seat', 6)),
  'P0001', 'Игра окончена — места и баттон уже не меняются', 'админ после финиша — место не записать');
select pg_temp.rejects(pg_temp.ev(:e6, 'button', jsonb_build_object('seat', 4)),
  'P0001', 'Игра окончена — места и баттон уже не меняются', 'админ после финиша — баттон не записать');
select public.void_event(:finish_e6);
select pg_temp.check(pg_temp.status(:e6) = 'live', 'отмена finish — снова live');
select pg_temp.check(
  (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pS, 'seat', 6))).payload ->> 'seat' = '6',
  'после отмены финиша рассадка снова пишется');

-- Закрытый расчёт: запись рассадки отклонена — расчёт не открывается.
select (ee.payload ->> 'playerId') as e1_player from public.evening_events ee
  where ee.evening_id = :e1 and ee.type = 'join' and ee.voided_at is null order by ee.id limit 1 \gset
select pg_temp.rejects(pg_temp.ev(:e1, 'seat', jsonb_build_object('playerId', :'e1_player', 'seat', 1)),
  'P0001', 'Игра окончена — места и баттон уже не меняются', 'закрытый расчёт — место не записать');
select pg_temp.check(pg_temp.status(:e1) = 'settled', 'закрытый расчёт не открылся');
select pg_temp.login(:banker5);
select pg_temp.rejects(pg_temp.ev(:e5, 'button', jsonb_build_object('seat', 1)),
  '42501', 'банкир может вносить только платежи', 'банкир завершённого вечера — баттон не записать');

-- ===========================================================================
-- 6. Табло получает рассадку; слияние гостя переносит игрока места, место без входа ему мешает
-- ===========================================================================
reset role;
select board_token as tok6 from public.evenings where id = :e6 \gset
set local role anon;
select pg_temp.check(
  (select count(*) filter (where ev ->> 'type' = 'seat') > 0
      and count(*) filter (where ev ->> 'type' = 'button') > 0
   from jsonb_array_elements(public.board_state(:'tok6'::uuid) -> 'events') as ev)
  and (select bool_or(p ->> 'id' = :pS)
       from jsonb_array_elements(public.board_state(:'tok6'::uuid) -> 'players') as p),
  'board_state: записи seat и button на табло, имя игрока места — в players');
reset role;
select pg_temp.check(
  private.payload_replace_player(jsonb_build_object('playerId', :pJ, 'seat', 3), :pJ::uuid, :pD::uuid)
    = jsonb_build_object('playerId', :pD, 'seat', 3)
  and private.payload_mentions_player(jsonb_build_object('playerId', :pJ, 'seat', 3), :pJ),
  'слияние гостя: игрок места переносится, номер места сохраняется');

-- Запись места держит игрока в журнале вечера: merge_report_body (024) считает любую неотменённую
-- запись с playerId. Отменили только вход гостя — слиянию мешает его место, а в ленте завершённого
-- вечера рассадки не видно. Поэтому пульт отменяет вход вместе с рассадкой (seatingVoidedWith в
-- lib.ts, ревью 028) — одной void_events.
insert into public.players (id, display_name, is_guest)
  values ('a0000000-0000-4000-8000-0000000028ff', 'Гость рассадки', true);
\set pG '''a0000000-0000-4000-8000-0000000028ff'''
select pg_temp.login(:banker);
set local role authenticated;
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pG))).id as join_g \gset
select (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pG, 'seat', 9))).id as seat_g \gset
select public.void_event(:join_g);
reset role;
select pg_temp.check(
  jsonb_array_length(private.merge_report_body(:pG, :pS, 'guest') -> 'blockers') = 1,
  'отменён только вход гостя — его запись места мешает слиянию с игроком этого вечера');
select pg_temp.login(:banker);
set local role authenticated;
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pG))).id as join_g2 \gset
select (public.add_event(:e6, 'seat', jsonb_build_object('playerId', :pG, 'seat', 10))).id as seat_g2 \gset
select public.void_events(array[:seat_g, :join_g2, :seat_g2]::bigint[]);
reset role;
select pg_temp.check(
  jsonb_array_length(private.merge_report_body(:pG, :pS, 'guest') -> 'blockers') = 0,
  'вход и места гостя отменены одним действием — слиянию ничего не мешает');

-- ===========================================================================
-- 7. Гранты
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
  not has_function_privilege('authenticated', 'private.json_table_seat(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.json_table_seat(jsonb)', 'execute'),
  'служебная json_table_seat снаружи не вызвать');

rollback;
