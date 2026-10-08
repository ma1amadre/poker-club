-- Проверки миграции 022 (правка записи на месте amend, пауза на N минут, поправка остатка уровня
-- time_adjust) на локальной БД с seed.sql: всё в одной транзакции, в конце rollback — данные не
-- меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/022_amend_pause_time_adjust.sql
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

-- add_event одной строкой для rejects.
create function pg_temp.ev(p_evening text, p_type text, p_payload jsonb, p_key text default null)
returns text language sql immutable as $$
  select format('select public.add_event(%L, %L, %L::jsonb, %L)', p_evening, p_type, p_payload, p_key);
$$;
grant execute on function pg_temp.ev(text, text, jsonb, text) to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set banker '''00000000-0000-4000-8000-00000000a002'''
\set stranger '''00000000-0000-4000-8000-00000000a003'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set e4 '''e0000000-0000-4000-8000-000000000004'''
\set pJ '''a0000000-0000-4000-8000-000000001001'''
\set pS '''a0000000-0000-4000-8000-000000001002'''
\set pD '''a0000000-0000-4000-8000-000000001003'''
\set pL '''a0000000-0000-4000-8000-000000001004'''
\set k1 '''c2200000-0000-4000-8000-000000000001'''
\set k2 '''c2200000-0000-4000-8000-000000000002'''
\set k3 '''c2200000-0000-4000-8000-000000000003'''
\set k4 '''c2200000-0000-4000-8000-000000000004'''

-- ===========================================================================
-- 1. Вечер e6: банкир Саша сажает стол, вылет и ребай
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;

select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pJ))).id as join_j \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pS))).id as join_s \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pD))).id as join_d \gset
select (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pL, 'stacks', 2))).id as join_l \gset
select (public.add_event(:e6, 'timer_start', '{}')).id as start_id \gset
select (public.add_event(:e6, 'bust', jsonb_build_object('playerId', :pL, 'by', jsonb_build_array(:pJ)))).id as bust_l \gset
select (public.add_event(:e6, 'rebuy', jsonb_build_object('playerId', :pL))).id as rebuy_l \gset

-- ===========================================================================
-- 2. amend: нормализация
-- ===========================================================================
select id as r_id, type as r_type, payload as r_payload
from public.add_event(:e6, 'amend',
  jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(upper(:pD), :pS)), :k1) \gset
select pg_temp.check(
  :'r_type' = 'amend'
  and :'r_payload'::jsonb = jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(:pD, :pS)),
  'правка вылета: {eventId, by} — uuid в нижнем регистре, порядок выбивших сохранён');
select pg_temp.check(
  (select payload = jsonb_build_object('playerId', :pL, 'by', jsonb_build_array(:pJ))
   from public.evening_events where id = :bust_l),
  'исходная запись не меняется — правка отдельной записью');

select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :join_l, 'stacks', 1))).payload
    = jsonb_build_object('eventId', :join_l, 'stacks', 1),
  'правка кратности хранит и единицу: «×2 → ×1» видно');
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :rebuy_l, 'stacks', 3.0))).payload
    = jsonb_build_object('eventId', :rebuy_l, 'stacks', 3),
  'правка кратности ребая: 3.0 → 3');
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :bust_l, 'by', '[]'::jsonb))).payload
    = jsonb_build_object('eventId', :bust_l, 'by', '[]'::jsonb),
  'правка вылета на «кто выбил — не указано»: пустой список');

-- ===========================================================================
-- 3. amend: ключ повтора сверяет id записи и значение
-- ===========================================================================
select pg_temp.check(
  (public.add_event(:e6, 'amend',
     jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(:pD, upper(:pS))), :k1)).id
    = :r_id,
  'повтор тем же ключом и тем же намерением (регистр не важен) — та же запись');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend',
    jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(:pS, :pD)), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другим порядком выбивших — другое намерение');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend',
    jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(:pD)), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другими выбившими');
select public.add_event(:e6, 'amend', jsonb_build_object('eventId', :join_l, 'stacks', 3), :k2);
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_l, 'stacks', 4), :k2),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другой кратностью');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :rebuy_l, 'stacks', 3), :k2),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другой исправляемой записью');

-- ===========================================================================
-- 4. amend: отказы
-- ===========================================================================
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_l)),
  '22023', 'нужно одно новое значение', 'без нового значения');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend',
    jsonb_build_object('eventId', :join_l, 'stacks', 2, 'by', '[]'::jsonb)),
  '22023', 'нужно одно новое значение', 'кратность и выбившие сразу');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_l, 'stacks', 2, 'x', 1)),
  '22023', 'лишн', 'лишний ключ');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_l::text, 'stacks', 2)),
  '22023', 'должно быть номером записи', 'eventId строкой');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', 0, 'stacks', 2)),
  '22023', 'не номер записи', 'eventId 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', 1.5, 'stacks', 2)),
  '22023', 'не номер записи', 'eventId дробью');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', 999999999, 'stacks', 2)),
  '22023', 'нет в журнале этого вечера', 'несуществующая запись');
select min(id) as e5_join from public.evening_events where evening_id = :e5 and type = 'join' \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :e5_join, 'stacks', 2)),
  '22023', 'нет в журнале этого вечера', 'запись другого вечера');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :start_id, 'stacks', 2)),
  '22023', 'только вход, ребай или вылет', 'исправлять старт таймера');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :r_id, 'stacks', 2)),
  '22023', 'только вход, ребай или вылет', 'исправлять правку');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_l, 'stacks', 2)),
  '22023', 'у вылета исправляются выбившие', 'кратность у вылета');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_l, 'by', '[]'::jsonb)),
  '22023', 'у входа и ребая исправляется кратность', 'выбившие у входа');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_l, 'stacks', 11)),
  '22023', 'Кратность входа — целое число от 1 до 10', 'кратность 11');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(:pL))),
  '22023', 'не может выбить сам себя', 'жертва в выбивших — по исходной записи');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_l, 'by', jsonb_build_array(:pJ, upper(:pJ)))),
  '22023', 'указан в «by» дважды', 'повтор выбившего');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_l, 'by', :pJ)),
  '22023', 'должно быть списком', 'by не список');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_l,
    'by', jsonb_build_array('b0000000-0000-4000-8000-000000000001'))),
  '22023', 'не найден', 'выбивший — несуществующий игрок');

-- Отменённая запись: исправлять нечего (P0001 — недопустимо в текущем состоянии).
select (public.add_event(:e6, 'hand', '{}')).id as hand_id \gset
select (public.add_event(:e6, 'bust', jsonb_build_object('playerId', :pD, 'by', '[]'::jsonb))).id as bust_d \gset
select public.void_event(:bust_d);
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_d, 'by', jsonb_build_array(:pS))),
  'P0001', 'запись отменена', 'правка отменённой записи');

-- Посторонний (не банкир и не админ) — 42501.
reset role;
select pg_temp.login(:stranger);
set local role authenticated;
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_s, 'stacks', 2)),
  '42501', 'только банкир вечера или админ', 'посторонний не правит журнал');

-- ===========================================================================
-- 5. Пауза на N минут и поправка остатка уровня
-- ===========================================================================
reset role;
select pg_temp.login(:banker);
set local role authenticated;

select pg_temp.check(
  (public.add_event(:e6, 'timer_pause', jsonb_build_object('minutes', 10), :k3)).payload
    = jsonb_build_object('minutes', 10),
  'пауза на 10 минут: {minutes}');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_pause', jsonb_build_object('minutes', 15), :k3),
  '22023', 'Ключ повтора уже занят', 'тот же ключ паузы с другой длительностью');
select pg_temp.check(
  (public.add_event(:e6, 'timer_pause', jsonb_build_object('minutes', 10), :k3)).payload
    = jsonb_build_object('minutes', 10),
  'повтор паузы тем же ключом — та же запись');
select public.add_event(:e6, 'timer_resume', '{}');
select pg_temp.check(
  (public.add_event(:e6, 'timer_pause', '{}')).payload = '{}'::jsonb,
  'пауза без срока — как до 022');
select public.add_event(:e6, 'timer_resume', '{}');
select pg_temp.check(
  (public.add_event(:e6, 'timer_pause', jsonb_build_object('minutes', 120.0))).payload
    = jsonb_build_object('minutes', 120),
  'длительность 120.0 → 120');
select public.add_event(:e6, 'timer_resume', '{}');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_pause', jsonb_build_object('minutes', 0)),
  '22023', 'от 1 до 120', 'пауза на 0 минут');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_pause', jsonb_build_object('minutes', 121)),
  '22023', 'от 1 до 120', 'пауза на 121 минуту');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_pause', jsonb_build_object('minutes', 2.5)),
  '22023', 'от 1 до 120', 'пауза дробью');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_pause', jsonb_build_object('minutes', '10')),
  '22023', 'от 1 до 120', 'пауза строкой');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_pause', jsonb_build_object('minutes', 10, 'x', 1)),
  '22023', 'лишн', 'пауза с лишним ключом');
select pg_temp.rejects(pg_temp.ev(:e6, 'timer_resume', jsonb_build_object('minutes', 10)),
  '22023', 'не принимает данных', 'продолжение без данных — как раньше');

select pg_temp.check(
  (public.add_event(:e6, 'time_adjust', jsonb_build_object('seconds', 60), :k4)).payload
    = jsonb_build_object('seconds', 60)
  and (public.add_event(:e6, 'time_adjust', jsonb_build_object('seconds', -60.0))).payload
    = jsonb_build_object('seconds', -60),
  'поправка времени: {seconds} ±');
select pg_temp.rejects(pg_temp.ev(:e6, 'time_adjust', jsonb_build_object('seconds', -60), :k4),
  '22023', 'Ключ повтора уже занят', 'тот же ключ поправки с другим знаком');
select pg_temp.rejects(pg_temp.ev(:e6, 'time_adjust', jsonb_build_object('seconds', 0)),
  '22023', 'не ноль', 'поправка на 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'time_adjust', jsonb_build_object('seconds', 3601)),
  '22023', 'не больше 3600', 'поправка больше часа');
select pg_temp.rejects(pg_temp.ev(:e6, 'time_adjust', jsonb_build_object('seconds', 1.5)),
  '22023', 'целое число секунд', 'поправка дробью');
select pg_temp.rejects(pg_temp.ev(:e6, 'time_adjust', '{}'::jsonb),
  '22023', 'целое число секунд', 'поправка без секунд');
select pg_temp.rejects(pg_temp.ev(:e6, 'time_adjust', jsonb_build_object('seconds', 60, 'minutes', 1)),
  '22023', 'лишн', 'поправка с лишним ключом');

-- Служебная пауза перед finish: автомат статуса таймера знает паузы с минутами. Таймер идёт —
-- finish пишет паузу без срока; на паузе с минутами — лишней паузы нет.
select public.add_event(:e6, 'bust', jsonb_build_object('playerId', :pS, 'by', jsonb_build_array(:pJ)));
select public.add_event(:e6, 'bust', jsonb_build_object('playerId', :pL, 'by', jsonb_build_array(:pJ)));
select public.add_event(:e6, 'timer_pause', jsonb_build_object('minutes', 5));
select public.add_event(:e6, 'finish', '{}');
select pg_temp.check(
  (select count(*) = 0 from public.evening_events
   where evening_id = :e6 and type = 'timer_pause' and payload = '{}'::jsonb
     and id > (select max(id) from public.evening_events
               where evening_id = :e6 and type = 'timer_pause' and payload ? 'minutes')),
  'finish на паузе с минутами — служебной паузы нет');
select pg_temp.check(
  (select status = 'finished' from public.evenings where id = :e6),
  'вечер завершён');

-- ===========================================================================
-- 6. После завершения: банкир — только платежи, правку пишет админ; закрытый расчёт открывается
-- ===========================================================================
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_s, 'stacks', 2)),
  '42501', 'банкир может вносить только платежи', 'банкир не правит завершённый вечер');
reset role;
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :join_s, 'stacks', 2))).type = 'amend',
  'админ правит завершённый вечер');
select pg_temp.check(
  (select status = 'finished' from public.evenings where id = :e6),
  'правка не возвращает вечер в игру');

select min(id) as e4_bust from public.evening_events where evening_id = :e4 and type = 'bust' \gset
select pg_temp.check(
  (select status = 'settled' from public.evenings where id = :e4),
  'e4 — расчёт закрыт (seed)');
select public.add_event(:e4, 'amend', jsonb_build_object('eventId', :e4_bust, 'by', '[]'::jsonb));
select pg_temp.check(
  (select status = 'finished' and settled_at is null and settle_reopened_at is not null
   from public.evenings where id = :e4),
  'правка закрытого вечера открывает расчёт (триггер 008)');

-- Отмена правки — как у всех записей: void_event.
select max(id) as e4_amend from public.evening_events where evening_id = :e4 and type = 'amend' \gset
select public.void_event(:e4_amend);
select pg_temp.check(
  (select voided_at is not null from public.evening_events where id = :e4_amend),
  'правку отменяет void_event');

-- ===========================================================================
-- 7. Табло, тип в таблице, слияние гостя
-- ===========================================================================
reset role;
select board_token as token from public.evenings where id = :e6 \gset
select pg_temp.check(
  (select count(*) filter (where e.v ->> 'type' = 'amend') >= 4
      and count(*) filter (where e.v ->> 'type' = 'time_adjust') = 2
      and count(*) filter (where e.v ->> 'type' = 'timer_pause' and e.v -> 'payload' ? 'minutes') = 3
   from jsonb_array_elements(public.board_state(:'token') -> 'events') as e(v)),
  'board_state отдаёт правки, поправки времени и минуты пауз');

do $$
begin
  insert into public.evening_events (evening_id, type, payload)
  values ('e0000000-0000-4000-8000-000000000006', 'amend_bust', '{}');
  raise exception 'FAIL: лишний тип прошёл check';
exception when check_violation then
  raise notice 'ok: evening_events.type — check с amend и time_adjust';
end;
$$;

-- Гость в выбивших правки: слияние с Telegram-профилем переносит и его.
select max(id) as e5_bust from public.evening_events
  where evening_id = :e5 and type = 'bust' and voided_at is null \gset
insert into public.players (id, display_name, is_guest) values
  ('a0000000-0000-4000-8000-00000000ab01', 'Гость Правка', true);
insert into public.players (id, tg_id, display_name) values
  ('a0000000-0000-4000-8000-00000000ab02', 99022, 'Профиль Правка');
insert into public.evening_events (evening_id, type, payload)
  values (:e5, 'join', jsonb_build_object('playerId', 'a0000000-0000-4000-8000-00000000ab01'));
select pg_temp.login(:admin);
set local role authenticated;
select (public.add_event(:e5, 'amend', jsonb_build_object('eventId', :e5_bust,
  'by', jsonb_build_array('a0000000-0000-4000-8000-00000000ab01')))).id as amend_guest \gset
select public.merge_players('a0000000-0000-4000-8000-00000000ab01', 'a0000000-0000-4000-8000-00000000ab02');
reset role;
select pg_temp.check(
  (select payload -> 'by' = jsonb_build_array('a0000000-0000-4000-8000-00000000ab02')
          and payload ->> 'eventId' = :'e5_bust'
   from public.evening_events where id = :amend_guest),
  'после слияния в выбивших правки — профиль, ссылка на запись та же');

-- ===========================================================================
-- 8. Права
-- ===========================================================================
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.json_event_id(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.json_event_id(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.json_bust_by(jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.json_bust_by(jsonb, uuid)', 'execute'),
  'служебные функции 022 снаружи не вызвать');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid = 'public.add_event(uuid, text, jsonb, uuid)'::regprocedure),
  'add_event — authenticated, security definer, пустой search_path');

rollback;
