-- Проверки миграции 023 (табло клуба, «табло на связи», тренировочный вечер) на локальной БД с seed.sql:
-- всё в одной транзакции, в конце rollback — данные не меняются. Любая неудача — exception, psql с
-- ON_ERROR_STOP выходит с кодом 3. Не зависит от сегодняшней даты: свои вечера ставятся от now()
-- (внутри транзакции now() не меняется). Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/023_club_board_pregame_training.sql
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
grant execute on function pg_temp.check(boolean, text) to anon, authenticated, service_role;

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

-- Хеш клипа — как clipHash домена.
create function pg_temp.h(p_text text) returns text language sql as $$
  select encode(sha256(convert_to('silero-v5_5-xenia' || E'\n' || p_text, 'UTF8')), 'hex');
$$;
grant execute on function pg_temp.h(text) to anon, authenticated, service_role;

-- Полдень по Москве: сегодня и со сдвигом в днях.
create function pg_temp.msk_noon(p_days int) returns timestamptz language sql as $$
  select (((now() at time zone 'Europe/Moscow')::date + p_days) + time '12:00') at time zone 'Europe/Moscow';
$$;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set sasha '''00000000-0000-4000-8000-00000000a002'''
\set p_admin '''a0000000-0000-4000-8000-000000001001'''
\set p_sasha '''a0000000-0000-4000-8000-000000001002'''
\set p_dima '''a0000000-0000-4000-8000-000000001003'''
\set p_vova '''a0000000-0000-4000-8000-000000009001'''
\set fmt '''{"name":"Клубный","buyInRub":500,"rebuyRub":500,"startingChips":1000,"maxRebuys":null,"rebuyUntilLevel":4,"lateRegUntilLevel":2,"payoutPct":[100],"levels":[{"sb":5,"bb":10,"trigger":{"type":"time","minutes":40}}]}'''

-- Изоляция: вечера seed не должны попадать в выбор табло клуба (анонс seed бывает «сегодня»).
update public.evenings set status = 'cancelled' where status = 'announced';
select pg_temp.check(not exists (
  select 1 from public.evenings
  where status = 'live' or (status in ('finished', 'settled') and finished_at > now() - interval '6 hours')),
  'вечера seed табло клуба не мешают');

-- ===========================================================================
-- 1. Код табло клуба
-- ===========================================================================
select club_board_token as code0 from public.settings where id = 1 \gset
select pg_temp.check(:'code0' ~ '^[0-9a-f]{12}$', 'у клуба есть код табло — 12 hex');
select pg_temp.rejects($q$update public.settings set club_board_token = 'abc' where id = 1$q$,
  '23514', 'код не по форме — check');

-- Между вечерами: board null, ближайшего анонса нет, расписание — из settings.
set local role anon;
select pg_temp.check(public.club_board_state(:'code0') ->> 'board' is null
                     and public.club_board_state(:'code0') -> 'board' = 'null'::jsonb
                     and public.club_board_state(:'code0') ->> 'next_at' is null,
       'anon: между вечерами — board null, next_at null');
select pg_temp.check((select array_agg(k order by k) from jsonb_object_keys(public.club_board_state(:'code0')) k)
                     = array['board', 'next_at', 'schedule', 'server_now'],
       'club_board_state: ровно board, next_at, schedule, server_now');
select pg_temp.check(public.club_board_state('ffffffffffff') is null
                     and public.club_board_state(null) is null
                     and public.club_board_state('') is null,
       'чужой, пустой и null код — null');
reset role;
select pg_temp.check(public.club_board_state(:'code0') -> 'schedule'
                     = (select jsonb_build_object('weekday', game_weekday, 'time', left(game_time::text, 5))
                        from public.settings where id = 1),
       'schedule — день недели и время «HH:MM» из settings');

-- ===========================================================================
-- 2. Тренировочный вечер: день клуба, неизменность пометки, голосование
-- ===========================================================================
insert into public.evenings (id, scheduled_at, status, format, banker_id) values
  ('e2300000-0000-4000-8000-0000000000a1', pg_temp.msk_noon(0), 'announced', :fmt::jsonb, :p_sasha);
insert into public.evenings (id, scheduled_at, status, format, banker_id, is_training) values
  ('e2300000-0000-4000-8000-0000000000b1', pg_temp.msk_noon(0) - interval '2 hours', 'announced', :fmt::jsonb, :p_admin, true),
  ('e2300000-0000-4000-8000-0000000000b2', pg_temp.msk_noon(0) + interval '2 hours', 'announced', :fmt::jsonb, :p_admin, true);
select pg_temp.check(true, 'настоящий и две тренировки в один московский день — можно');
select pg_temp.rejects(format($q$insert into public.evenings (scheduled_at, status, format)
  values (%L, 'announced', %L)$q$, pg_temp.msk_noon(0) + interval '3 hours', :fmt),
  '23505', 'второй настоящий вечер в тот же день — по-прежнему нельзя');

select pg_temp.rejects($q$update public.evenings set is_training = false
  where id = 'e2300000-0000-4000-8000-0000000000b1'$q$, '22023', 'тренировку не сделать настоящим вечером');
select pg_temp.rejects($q$update public.evenings set is_training = true
  where id = 'e2300000-0000-4000-8000-0000000000a1'$q$, '22023', 'настоящий вечер не пометить тренировкой');
update public.evenings set note = 'заметка', is_training = true where id = 'e2300000-0000-4000-8000-0000000000b1';
select pg_temp.check(true, 'то же значение пометки в update не мешает');

update public.evenings set voting_closes_at = now() + interval '1 day'
  where id = 'e2300000-0000-4000-8000-0000000000b1';
select pg_temp.check((select voting_closes_at is null from public.evenings where id = 'e2300000-0000-4000-8000-0000000000b1'),
       'у тренировки голосования нет — voting_closes_at остаётся null');

-- finish через add_event: вечер завершён, голосования нет.
update public.evenings set status = 'live', started_at = now() - interval '1 hour'
  where id = 'e2300000-0000-4000-8000-0000000000b2';
select pg_temp.login(:admin);
set local role authenticated;
select (public.add_event('e2300000-0000-4000-8000-0000000000b2', 'finish', '{}'::jsonb)).id is not null as fin \gset
reset role;
select pg_temp.check((select status = 'finished' and voting_closes_at is null and finished_at is not null
                      from public.evenings where id = 'e2300000-0000-4000-8000-0000000000b2'),
       'finish тренировки: завершена, voting_closes_at null');

-- ===========================================================================
-- 3. Какой вечер показывает табло клуба
-- ===========================================================================
-- Сейчас: настоящий анонс сегодня (a1), тренировка-анонс сегодня (b1), тренировка завершена только что (b2).
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'id' = 'e2300000-0000-4000-8000-0000000000a1',
       'анонс настоящего вечера сегодня важнее итога и анонса тренировки');
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'is_training' = 'false',
       'в ответе — evening.is_training');

update public.evenings set status = 'live', started_at = now() where id = 'e2300000-0000-4000-8000-0000000000b1';
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'id' = 'e2300000-0000-4000-8000-0000000000b1'
                     and (public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'is_training')::boolean,
       'идущая тренировка важнее анонса — табло показывает её с пометкой');

-- Итог настоящего вечера (вчера, 1 ч назад) важнее анонса, но не идущей тренировки.
insert into public.evenings (id, scheduled_at, status, format, started_at, finished_at) values
  ('e2300000-0000-4000-8000-0000000000a0', pg_temp.msk_noon(-1), 'finished', :fmt::jsonb,
   now() - interval '4 hours', now() - interval '1 hour');
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'id' = 'e2300000-0000-4000-8000-0000000000b1',
       'идущая тренировка важнее итога настоящего вечера');
update public.evenings set status = 'finished', finished_at = now() where id = 'e2300000-0000-4000-8000-0000000000b1';
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'id' = 'e2300000-0000-4000-8000-0000000000a0',
       'итог настоящего вечера (до 6 ч) важнее анонса и итога тренировки');
update public.evenings set finished_at = now() - interval '6 hours 1 minute', started_at = now() - interval '9 hours'
  where id = 'e2300000-0000-4000-8000-0000000000a0';
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'id' = 'e2300000-0000-4000-8000-0000000000a1',
       'итог старше 6 ч — снова анонс');

-- Идущий настоящий важнее всего, в том числе идущей тренировки.
update public.evenings set status = 'live', finished_at = null, started_at = now() - interval '10 minutes'
  where id = 'e2300000-0000-4000-8000-0000000000b1';
update public.evenings set status = 'live', started_at = now() - interval '20 minutes'
  where id = 'e2300000-0000-4000-8000-0000000000a1';
select pg_temp.check(public.club_board_state(:'code0') -> 'board' -> 'evening' ->> 'id' = 'e2300000-0000-4000-8000-0000000000a1',
       'идущий настоящий вечер важнее идущей тренировки');

-- Ответ табло клуба = ответ табло вечера (кроме времени ответа).
select board_token as tok_a1 from public.evenings where id = 'e2300000-0000-4000-8000-0000000000a1' \gset
select pg_temp.check((public.club_board_state(:'code0') -> 'board') - 'server_now'
                     = public.board_state(:'tok_a1'::uuid) - 'server_now',
       'board — тот же ответ, что board_state по ссылке вечера');
select pg_temp.check(public.board_state(:'tok_a1'::uuid) -> 'evening' ? 'is_training',
       'board_state отдаёт evening.is_training');

-- Следующая игра между вечерами: ближайший будущий анонс настоящего вечера, тренировки не в счёт.
update public.evenings set status = 'cancelled' where id::text like 'e2300000%' and status in ('announced', 'live');
update public.evenings set finished_at = now() - interval '7 hours' where id::text like 'e2300000%' and status = 'finished';
insert into public.evenings (id, scheduled_at, status, format) values
  ('e2300000-0000-4000-8000-0000000000a3', pg_temp.msk_noon(3), 'announced', :fmt::jsonb),
  ('e2300000-0000-4000-8000-0000000000a4', pg_temp.msk_noon(10), 'announced', :fmt::jsonb);
insert into public.evenings (id, scheduled_at, status, format, is_training) values
  ('e2300000-0000-4000-8000-0000000000b3', pg_temp.msk_noon(1), 'announced', :fmt::jsonb, true);
select pg_temp.check(public.club_board_state(:'code0') -> 'board' = 'null'::jsonb
                     and (public.club_board_state(:'code0') ->> 'next_at')::timestamptz = pg_temp.msk_noon(3),
       'между вечерами: next_at — ближайший анонс настоящего вечера, тренировка не в счёт');

-- ===========================================================================
-- 4. Перевыпуск кода
-- ===========================================================================
select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.rotate_club_board_token()$q$, '42501', 'не админ — перевыпустить нельзя');
reset role;
set local role anon;
select pg_temp.rejects($q$select public.rotate_club_board_token()$q$, '42501', 'anon — нет права');
reset role;

select pg_temp.login(:admin);
set local role authenticated;
select public.rotate_club_board_token() as code1 \gset
reset role;
select pg_temp.check(:'code1' ~ '^[0-9a-f]{12}$' and :'code1' <> :'code0'
                     and (select club_board_token from public.settings where id = 1) = :'code1',
       'админ перевыпустил код — новый, по форме, в settings');
set local role anon;
select pg_temp.check(public.club_board_state(:'code0') is null and public.club_board_state(:'code1') is not null,
       'старый код гаснет сразу, новый работает');
reset role;

-- ===========================================================================
-- 5. Клипы голоса для табло клуба и проверка озвучки
-- ===========================================================================
insert into public.voice_clips (voice, text_hash, text, audio, mime, duration_ms) values
  ('silero-v5_5-xenia', pg_temp.h('Пауза.'), 'Пауза.', decode(repeat('ab', 50), 'hex'), 'audio/mpeg', 640)
on conflict do nothing;

set local role anon;
select pg_temp.check(jsonb_array_length(public.club_board_voice_clips(:'code1', 'silero-v5_5-xenia',
                       array[pg_temp.h('Пауза.'), pg_temp.h('Нет такой фразы.')])) = 1,
       'anon по коду клуба получает только озвученные клипы — даже между вечерами');
select pg_temp.check(public.club_board_voice_clips(:'code0', 'silero-v5_5-xenia', array[pg_temp.h('Пауза.')]) is null,
       'по старому коду — null');
select pg_temp.rejects(format($q$select public.club_board_voice_clips(%L, 'silero-v5_5-xenia',
  array(select pg_temp.h(i::text) from generate_series(1, 101) i))$q$, :'code1'),
  '22023', 'больше 100 хешей — отказ');
select pg_temp.rejects($q$select public.voice_clips_present('silero-v5_5-xenia', array['x'])$q$,
  '42501', 'voice_clips_present: anon — нет права');
reset role;

select pg_temp.login('00000000-0000-4000-8000-0000000000ff');
set local role authenticated;
select pg_temp.rejects($q$select public.voice_clips_present('silero-v5_5-xenia', array['x'])$q$,
  '42501', 'voice_clips_present: не участник клуба — отказ');
reset role;

select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.check(public.voice_clips_present('silero-v5_5-xenia',
                       array[pg_temp.h('Пауза.'), pg_temp.h('Нет такой фразы.')]) = array[pg_temp.h('Пауза.')],
       'участник клуба: какие хеши озвучены — без звука');
select pg_temp.check(public.voice_clips_present('silero-v5_5-xenia', array[]::text[]) = array[]::text[]
                     and public.voice_clips_present('other', array[pg_temp.h('Пауза.')]) = array[]::text[],
       'пустой список и чужой голос — пусто');
select pg_temp.rejects($q$select public.voice_clips_present('silero-v5_5-xenia',
  array(select i::text from generate_series(1, 301) i))$q$, '22023', 'больше 300 хешей — отказ');
reset role;

-- ===========================================================================
-- 6. «Табло на связи»: board_ping и board_presence
-- ===========================================================================
insert into public.evenings (id, scheduled_at, status, format) values
  ('e2300000-0000-4000-8000-0000000000a5', pg_temp.msk_noon(0), 'announced', :fmt::jsonb);
select board_token as tok_a5 from public.evenings where id = 'e2300000-0000-4000-8000-0000000000a5' \gset

set local role anon;
select pg_temp.check(public.board_ping(:'tok_a5', false), 'anon: отметка по ссылке вечера — true');
select pg_temp.check(not public.board_ping('00000000-0000-4000-8000-000000000000', true)
                     and not public.board_ping('ffffffffffff', true)
                     and not public.board_ping(null, true)
                     and not public.board_ping(repeat('a', 65), true),
       'чужой токен, чужой код, null и слишком длинный — false, без записи');
select pg_temp.rejects($q$select * from public.board_presence$q$, '42501', 'anon таблицу отметок не читает');
reset role;
select pg_temp.check((select count(*) = 1 and bool_and(seen_at = now() and voice_at is null)
                      from public.board_presence where evening_id = 'e2300000-0000-4000-8000-0000000000a5'),
       'отметка записана: seen_at, голос выключен');
select pg_temp.check((select count(*) from public.board_presence) = 1, 'других отметок нет');

-- Табло клуба отмечает вечер, который показывает (a5 — анонс сегодня).
set local role anon;
select pg_temp.check(public.board_ping(:'code1', true), 'отметка по коду клуба — true');
reset role;
select pg_temp.check((select voice_at = now() from public.board_presence
                      where evening_id = 'e2300000-0000-4000-8000-0000000000a5'),
       'табло клуба отметило показанный вечер, голос включён');

-- Чаще раза в 5 с строка не переписывается; без голоса voice_at остаётся прежним.
update public.board_presence set seen_at = now() - interval '3 seconds', voice_at = now() - interval '3 seconds'
  where evening_id = 'e2300000-0000-4000-8000-0000000000a5';
select public.board_ping(:'tok_a5', true);
select pg_temp.check((select seen_at = now() - interval '3 seconds' from public.board_presence
                      where evening_id = 'e2300000-0000-4000-8000-0000000000a5'),
       'отметка чаще раза в 5 с не переписывается');
update public.board_presence set seen_at = now() - interval '30 seconds', voice_at = now() - interval '30 seconds'
  where evening_id = 'e2300000-0000-4000-8000-0000000000a5';
select public.board_ping(:'tok_a5', false);
select pg_temp.check((select seen_at = now() and voice_at = now() - interval '30 seconds' from public.board_presence
                      where evening_id = 'e2300000-0000-4000-8000-0000000000a5'),
       'новая отметка без голоса — seen_at свежий, voice_at прежний');

-- Читают участники клуба.
select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.check((select count(*) = 1 from public.board_presence), 'участник клуба видит отметки табло');
select pg_temp.rejects($q$insert into public.board_presence (evening_id, seen_at)
  values ('e2300000-0000-4000-8000-0000000000a3', now())$q$, '42501', 'писать отметку напрямую нельзя');
reset role;
select pg_temp.login('00000000-0000-4000-8000-0000000000ff');
set local role authenticated;
select pg_temp.check((select count(*) = 0 from public.board_presence), 'не участник клуба отметок не видит');
reset role;

-- Между вечерами табло клуба ничего не отмечает.
update public.evenings set status = 'cancelled' where id = 'e2300000-0000-4000-8000-0000000000a5';
select pg_temp.check(not public.board_ping(:'code1', true), 'между вечерами отметка — false');

-- ===========================================================================
-- 7. Удаление тренировки
-- ===========================================================================
insert into public.evenings (id, scheduled_at, status, format, banker_id, is_training) values
  ('e2300000-0000-4000-8000-0000000000b4', pg_temp.msk_noon(0), 'announced', :fmt::jsonb, :p_admin, true);
select pg_temp.login(:admin);
set local role authenticated;
select public.add_guest('e2300000-0000-4000-8000-0000000000b4', 'Тестгость Тренировки') as g_new \gset
select public.add_guest('e2300000-0000-4000-8000-0000000000b4', 'Тестгость Дважды') as g_twice \gset
select (public.add_event('e2300000-0000-4000-8000-0000000000b4', 'join',
          jsonb_build_object('playerId', :p_vova))).id is not null as j1 \gset
select public.set_rsvp('e2300000-0000-4000-8000-0000000000b4', 'yes');
reset role;
-- Второй гость сыграл и в настоящем вечере — его удалять нельзя.
insert into public.evening_events (evening_id, type, payload)
  values ('e2300000-0000-4000-8000-0000000000a3', 'join', jsonb_build_object('playerId', :'g_twice'));
insert into public.board_presence (evening_id, seen_at) values ('e2300000-0000-4000-8000-0000000000b4', now());

select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.delete_training_evening('e2300000-0000-4000-8000-0000000000b4')$q$,
  '42501', 'удалить тренировку — только админ');
reset role;
set local role anon;
select pg_temp.rejects($q$select public.delete_training_evening('e2300000-0000-4000-8000-0000000000b4')$q$,
  '42501', 'anon — нет права');
reset role;

select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects($q$select public.delete_training_evening('e2300000-0000-4000-8000-0000000000a3')$q$,
  'P0001', 'обычный вечер не удалить');
select pg_temp.rejects($q$select public.delete_training_evening('e2300000-0000-4000-8000-00000000dead')$q$,
  '22023', 'нет вечера — 22023');
select public.delete_training_evening('e2300000-0000-4000-8000-0000000000b4') as del \gset
reset role;
select pg_temp.check((:'del')::jsonb = jsonb_build_object('evening', 'e2300000-0000-4000-8000-0000000000b4', 'guestsDeleted', 1),
       'ответ: вечер и сколько гостей удалено');
select pg_temp.check(not exists (select 1 from public.evenings where id = 'e2300000-0000-4000-8000-0000000000b4')
                     and not exists (select 1 from public.evening_events where evening_id = 'e2300000-0000-4000-8000-0000000000b4')
                     and not exists (select 1 from public.rsvps where evening_id = 'e2300000-0000-4000-8000-0000000000b4')
                     and not exists (select 1 from public.board_presence where evening_id = 'e2300000-0000-4000-8000-0000000000b4'),
       'вечер, журнал, ответы и отметки табло удалены');
select pg_temp.check(not exists (select 1 from public.players where id = :'g_new'),
       'гость, заведённый на тренировке и больше нигде не упомянутый, удалён');
select pg_temp.check(exists (select 1 from public.players where id = :'g_twice')
                     and exists (select 1 from public.players where id = :p_vova),
       'гость из настоящего вечера и старый гость остаются');

-- ===========================================================================
-- 8. Генератор озвучки: last_played_at без тренировок
-- ===========================================================================
select (select p ->> 'last_played_at' from jsonb_array_elements(private.voice_manifest_input() -> 'players') p
        where p ->> 'id' = :p_dima) as dima_before \gset
insert into public.evenings (id, scheduled_at, status, format, is_training) values
  ('e2300000-0000-4000-8000-0000000000b5', pg_temp.msk_noon(20), 'announced', :fmt::jsonb, true);
insert into public.evening_events (evening_id, type, payload)
  values ('e2300000-0000-4000-8000-0000000000b5', 'join', jsonb_build_object('playerId', :p_dima));
select pg_temp.check((select p ->> 'last_played_at' from jsonb_array_elements(private.voice_manifest_input() -> 'players') p
                      where p ->> 'id' = :p_dima) is not distinct from :'dima_before',
       'вход на тренировке не двигает last_played_at');
select pg_temp.check(private.voice_manifest_input() -> 'formats' @> jsonb_build_array(:fmt::jsonb),
       'формат объявленной тренировки — в манифесте (её уровни озвучатся)');

-- ===========================================================================
-- 9. Права и форма функций
-- ===========================================================================
select pg_temp.check(
  has_function_privilege('anon', 'public.club_board_state(text)', 'execute')
  and has_function_privilege('anon', 'public.club_board_voice_clips(text, text, text[])', 'execute')
  and has_function_privilege('anon', 'public.board_ping(text, boolean)', 'execute')
  and has_function_privilege('anon', 'public.board_state(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.rotate_club_board_token()', 'execute')
  and not has_function_privilege('anon', 'public.delete_training_evening(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.voice_clips_present(text, text[])', 'execute')
  and has_function_privilege('authenticated', 'public.rotate_club_board_token()', 'execute')
  and has_function_privilege('authenticated', 'public.delete_training_evening(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.voice_clips_present(text, text[])', 'execute')
  and has_function_privilege('service_role', 'public.club_board_state(text)', 'execute')
  and has_function_privilege('service_role', 'public.delete_training_evening(uuid)', 'execute'),
  'гранты RPC: табло — anon, правка и проверка озвучки — authenticated, всё — service_role');

select pg_temp.check(bool_and(not has_function_privilege('anon', f, 'execute')
                              and not has_function_privilege('authenticated', f, 'execute')),
       'служебные функции 023 снаружи не вызвать')
from unnest(array[
  'private.board_payload(uuid)',
  'private.club_board_evening_id()',
  'private.club_board_token_ok(text)',
  'private.evenings_training_guard()',
  'private.voice_manifest_input()']) f;

select pg_temp.check(bool_and(p.prosecdef and p.proconfig @> array['search_path=""']),
       'RPC 023 — security definer с пустым search_path')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (('public', 'club_board_state'), ('public', 'club_board_voice_clips'),
                                 ('public', 'board_ping'), ('public', 'rotate_club_board_token'),
                                 ('public', 'delete_training_evening'), ('public', 'voice_clips_present'),
                                 ('public', 'board_state'), ('private', 'board_payload'),
                                 ('private', 'club_board_evening_id'), ('private', 'club_board_token_ok'));

select pg_temp.check(
  has_table_privilege('authenticated', 'public.board_presence', 'select')
  and not has_table_privilege('authenticated', 'public.board_presence', 'insert')
  and not has_table_privilege('authenticated', 'public.board_presence', 'update')
  and not has_table_privilege('anon', 'public.board_presence', 'select')
  and has_table_privilege('service_role', 'public.board_presence', 'select')
  and has_table_privilege('service_role', 'public.board_presence', 'insert')
  and has_table_privilege('service_role', 'public.board_presence', 'update')
  and has_table_privilege('service_role', 'public.board_presence', 'delete')
  and (select relrowsecurity from pg_class where oid = 'public.board_presence'::regclass),
  'board_presence: RLS, select — authenticated, всё — service_role, anon — ничего');

rollback;
