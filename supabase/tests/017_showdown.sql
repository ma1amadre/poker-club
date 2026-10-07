-- Проверки миграции 017 (олл-ин на табло) на локальной БД с seed.sql: всё в одной транзакции, в
-- конце rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/017_showdown.sql
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

-- payload олл-ина: руки [игрок, карта, карта] и стол.
create function pg_temp.sd(p_id text, p_hands text[][], p_board text[]) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'showdownId', p_id,
    'hands', coalesce((
      select jsonb_agg(jsonb_build_object('playerId', p_hands[i][1],
                                          'cards', jsonb_build_array(p_hands[i][2], p_hands[i][3]))
                       order by i)
      from generate_subscripts(p_hands, 1) as i), '[]'::jsonb),
    'board', to_jsonb(coalesce(p_board, '{}'::text[])));
$$;
grant execute on function pg_temp.sd(text, text[][], text[]) to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set p3 '''a0000000-0000-4000-8000-000000001003'''
\set p4 '''a0000000-0000-4000-8000-000000001004'''
\set p5 '''a0000000-0000-4000-8000-000000001005'''
\set p6 '''a0000000-0000-4000-8000-000000001006'''
\set sd1 '''5d000000-0000-4000-8000-000000000001'''
\set sd2 '''5d000000-0000-4000-8000-000000000002'''

select pg_temp.login(:admin);
set local role authenticated;

-- За столом вечера e6 — p3, p4, p5 (p6 не входил).
select public.add_event(:e6, 'join', jsonb_build_object('playerId', :p3));
select public.add_event(:e6, 'join', jsonb_build_object('playerId', :p4));
select public.add_event(:e6, 'join', jsonb_build_object('playerId', :p5));

-- ===========================================================================
-- 1. showdown: нормализованная копия, uuid в нижнем регистре
-- ===========================================================================
select pg_temp.check(
  (public.add_event(:e6, 'showdown',
     pg_temp.sd(upper(:sd1), array[[upper(:p3), 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{}'))).payload
    = pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{}'),
  'олл-ин записан: id раздачи и игроков — в нижнем регистре, стол пустой');
select pg_temp.check(
  (public.add_event(:e6, 'showdown',
     pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{2c,7d,9h}'))).payload -> 'board'
    = '["2c", "7d", "9h"]'::jsonb,
  'флоп — полное состояние раздачи');
select pg_temp.check(
  (public.add_event(:e6, 'showdown',
     pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc'], [:p5, 'Td', '9d']],
                '{2c,7d,9h,Jd,Ah}'))).payload -> 'hands' -> 2
    = jsonb_build_object('playerId', :p5, 'cards', '["Td", "9d"]'::jsonb),
  'ривер на троих: порядок рук сохраняется');
select pg_temp.check(
  (public.add_event(:e6, 'showdown_close', jsonb_build_object('showdownId', upper(:sd1)))).payload
    = jsonb_build_object('showdownId', :sd1),
  'showdown_close — только id раздачи');

-- ===========================================================================
-- 2. Неверная раздача — 22023
-- ===========================================================================
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'as', 'Kd'], [:p4, 'Qh', 'Qc']], '{}')),
  'Олл-ин: «as» — не карта', 'масть и ранг — строго As, Td, 9h');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, '10s', 'Kd'], [:p4, 'Qh', 'Qc']], '{}')),
  'Олл-ин: «10s» — не карта', 'десятка — T, не 10');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p4, 'As', 'Qc']], '{}')),
  'Олл-ин: карта As указана дважды', 'одна карта у двух игроков');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{Kd,2c,3c}')),
  'Олл-ин: карта Kd указана дважды', 'карта руки на столе');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{2c}')),
  'Олл-ин: на столе 0, 3, 4 или 5 карт', 'одна карта на столе');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{2c,3c}')),
  'Олл-ин: на столе 0, 3, 4 или 5 карт', 'две карты на столе');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{2c,3c,4c,5c,6c,7c}')),
  'Олл-ин: на столе 0, 3, 4 или 5 карт', 'шесть карт на столе');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd']], '{}')),
  'Олл-ин: игроков — от 2 до 9', 'одна рука');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    jsonb_build_object('showdownId', :sd2, 'board', '[]'::jsonb, 'hands',
      (select jsonb_agg(jsonb_build_object('playerId', :p3, 'cards', '["As", "Kd"]'::jsonb))
       from generate_series(1, 10)))),
  'Олл-ин: игроков — от 2 до 9', 'десять рук');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p3, 'Qh', 'Qc']], '{}')),
  'указан дважды', 'один игрок в двух руках');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p6, 'Qh', 'Qc']], '{}')),
  'не за столом этого вечера', 'игрок без входа в этот вечер');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{}') || '{"street": "flop"}'),
  'лишнее поле «street»', 'лишнее поле раздачи');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    jsonb_build_object('showdownId', :sd2, 'board', '[]'::jsonb, 'hands', jsonb_build_array(
      jsonb_build_object('playerId', :p3, 'cards', '["As", "Kd"]'::jsonb, 'stack', 500),
      jsonb_build_object('playerId', :p4, 'cards', '["Qh", "Qc"]'::jsonb)))),
  'лишнее поле «stack»', 'лишнее поле руки');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    jsonb_build_object('showdownId', :sd2, 'board', '[]'::jsonb, 'hands', jsonb_build_array(
      jsonb_build_object('playerId', :p3, 'cards', '["As", "Kd", "2c"]'::jsonb),
      jsonb_build_object('playerId', :p4, 'cards', '["Qh", "Qc"]'::jsonb)))),
  'у каждого игрока — две карты', 'три карты в руке');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd('раздача', array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{}')),
  'не id раздачи', 'id раздачи — не uuid');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    jsonb_build_object('showdownId', :sd2, 'board', '[]'::jsonb)),
  '«hands» должно быть списком рук', 'нет рук');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown_close',
    jsonb_build_object('showdownId', :sd1, 'board', '[]'::jsonb)),
  'лишнее поле «board»', 'у закрытия только id');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown_close', '{}'),
  'должно быть строкой с id раздачи', 'закрытие без id');

-- Вход отменён — игрок больше не за столом.
reset role;
update public.evening_events set voided_at = now()
where evening_id = :e6 and type = 'join' and payload ->> 'playerId' = :p5;
set local role authenticated;
select pg_temp.rejects(format('select public.add_event(%L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, 'As', 'Kd'], [:p5, 'Qh', 'Qc']], '{}')),
  'не за столом этого вечера', 'игрок с отменённым входом');
reset role;
update public.evening_events set voided_at = null
where evening_id = :e6 and type = 'join' and payload ->> 'playerId' = :p5;
set local role authenticated;

-- ===========================================================================
-- 3. Ключ повтора: та же раздача — та же запись, другая карта — другое намерение
-- ===========================================================================
select (public.add_event(:e6, 'showdown',
          pg_temp.sd(:sd2, array[[:p3, '7s', '7h'], [:p4, 'Ac', 'Jc']], '{}'),
          'c0000000-0000-4000-8000-000000000017')).id as rid \gset
select pg_temp.check(
  (public.add_event(:e6, 'showdown',
     pg_temp.sd(upper(:sd2), array[[upper(:p3), '7s', '7h'], [:p4, 'Ac', 'Jc']], '{}'),
     'c0000000-0000-4000-8000-000000000017')).id = :rid,
  'повтор с тем же ключом (id в другом регистре) возвращает запись');
select pg_temp.check(
  (select count(*) = 1 from public.evening_events where client_id = 'c0000000-0000-4000-8000-000000000017'),
  'повтор не задвоил олл-ин');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, '7s', '7h'], [:p4, 'Ac', 'Jd']], '{}'),
    'c0000000-0000-4000-8000-000000000017'),
  'Ключ повтора уже занят', 'тот же ключ с другой картой руки');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd2, array[[:p3, '7s', '7h'], [:p4, 'Ac', 'Jc']], '{2c,3c,4c}'),
    'c0000000-0000-4000-8000-000000000017'),
  'Ключ повтора уже занят', 'тот же ключ с флопом');
select pg_temp.rejects(format('select public.add_event(%L, %L, %L, %L)', :e6, 'showdown',
    pg_temp.sd(:sd1, array[[:p3, '7s', '7h'], [:p4, 'Ac', 'Jc']], '{}'),
    'c0000000-0000-4000-8000-000000000017'),
  'Ключ повтора уже занят', 'тот же ключ с другой раздачей');

-- ===========================================================================
-- 4. Табло: board_state отдаёт олл-ин, отменённые правки — нет
-- ===========================================================================
reset role;
select board_token as token from public.evenings where id = :e6 \gset
select public.board_state(:'token') as bs \gset
select pg_temp.check(
  (select count(*) = 5 from jsonb_array_elements(:'bs'::jsonb -> 'events') as e(v)
   where e.v ->> 'type' in ('showdown', 'showdown_close')),
  'board_state: четыре правки олл-ина и закрытие');
select pg_temp.check(
  (select count(*) = 3 from jsonb_array_elements(:'bs'::jsonb -> 'players') as p(v)
   where p.v ->> 'id' in (:p3, :p4, :p5)),
  'board_state: имена всех игроков рук есть в players');

set local role authenticated;
select public.void_event(:rid);
reset role;
select pg_temp.check(
  (select count(*) = 4 from jsonb_array_elements(public.board_state(:'token') -> 'events') as e(v)
   where e.v ->> 'type' in ('showdown', 'showdown_close')),
  'отменённая правка олл-ина табло не видна');

-- Тип события — check в таблице: прямой вставкой лишний тип не пройдёт.
do $$
begin
  insert into public.evening_events (evening_id, type, payload)
  values ('e0000000-0000-4000-8000-000000000006', 'showdown_open', '{}');
  raise exception 'FAIL: лишний тип прошёл check';
exception when check_violation then
  raise notice 'ok: evening_events.type — check с типами олл-ина';
end;
$$;

-- ===========================================================================
-- 5. Слияние гостя: игрок в руках олл-ина переносится
-- ===========================================================================
select pg_temp.check(
  private.payload_replace_player(
    pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{2c,7d,9h}'), :p4::uuid, :p6::uuid)
    = pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p6, 'Qh', 'Qc']], '{2c,7d,9h}'),
  'payload_replace_player меняет игрока руки, порядок и карты на месте');
select pg_temp.check(
  private.payload_mentions_player(pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{}'), :p4)
  and not private.payload_mentions_player(pg_temp.sd(:sd1, array[[:p3, 'As', 'Kd'], [:p4, 'Qh', 'Qc']], '{}'), :p6)
  and private.payload_mentions_player(jsonb_build_object('playerId', :p6), :p6)
  and private.payload_mentions_player(jsonb_build_object('playerId', :p3, 'by', jsonb_build_array(:p6)), :p6)
  and not private.payload_mentions_player('{}'::jsonb, :p6),
  'payload_mentions_player: playerId, by и руки олл-ина');

set local role authenticated;
select public.add_guest(:e6, 'Гость Олл-ин') as guest \gset
select public.add_event(:e6, 'showdown',
  pg_temp.sd('5d000000-0000-4000-8000-000000000003', array[[:p3, '8s', '8h'], [:'guest', '6c', '6d']], '{}'));
select public.add_event(:e6, 'showdown',
  pg_temp.sd('5d000000-0000-4000-8000-000000000003', array[[:p3, '8s', '8h'], [:'guest', '6c', '6d']], '{2s,3s,4s}'));
reset role;
select pg_temp.check(
  (private.merge_players_report(:'guest', :p6) ->> 'events')::int = 3,
  'отчёт слияния считает вход и две правки олл-ина гостя');

set local role authenticated;
select public.merge_players(:'guest', :p6);
reset role;
select pg_temp.check(
  (select count(*) = 2 from public.evening_events ee
   where ee.evening_id = :e6 and ee.type = 'showdown'
     and ee.payload -> 'hands' @> jsonb_build_array(jsonb_build_object('playerId', :p6))
     and ee.payload -> 'hands' -> 1 -> 'cards' = '["6c", "6d"]'::jsonb),
  'после слияния в руках олл-ина — профиль, карты на месте');
select pg_temp.check(
  cardinality(private.player_references(:'guest')) = 0
  and not exists (select 1 from public.players where id = :'guest'),
  'на гостя ссылок не осталось, гость удалён');

-- ===========================================================================
-- 6. Права
-- ===========================================================================
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.json_card(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.json_card(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.json_showdown_id(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.payload_mentions_player(jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'private.payload_mentions_player(jsonb, text)', 'execute'),
  'служебные функции олл-ина снаружи не вызвать');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and has_function_privilege('anon', 'public.board_state(uuid)', 'execute'),
  'add_event — по-прежнему authenticated, board_state — anon');

rollback;
