-- Проверки миграции 026 (вторая игра в тот же день, «Ещё игра сегодня» и после полуночи, зачёт тренировки,
-- табло клуба) на локальной БД с seed.sql: всё в одной транзакции, в конце rollback — данные не меняются. Любая неудача —
-- exception, psql с ON_ERROR_STOP выходит с кодом 3. Не зависит от сегодняшней даты: свои вечера ставятся
-- от now() (внутри транзакции now() не меняется). Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/026_second_game_promote_training.sql
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

-- Полдень по Москве: сегодня и со сдвигом в днях.
create function pg_temp.msk_noon(p_days int) returns timestamptz language sql as $$
  select (((now() at time zone 'Europe/Moscow')::date + p_days) + time '12:00') at time zone 'Europe/Moscow';
$$;
-- Сегодняшний вечер по Москве: время до now() (запись «на сейчас» ложится на сегодняшнюю дату).
create function pg_temp.msk_today(p_hour int) returns timestamptz language sql as $$
  select ((now() at time zone 'Europe/Moscow')::date + make_interval(hours => p_hour)) at time zone 'Europe/Moscow';
$$;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set sasha '''00000000-0000-4000-8000-00000000a002'''
\set dima '''00000000-0000-4000-8000-00000000a003'''
\set p_admin '''a0000000-0000-4000-8000-000000001001'''
\set p_sasha '''a0000000-0000-4000-8000-000000001002'''
\set p_dima '''a0000000-0000-4000-8000-000000001003'''
\set fmt '''{"name":"Клубный","buyInRub":500,"startingChips":1000,"maxRebuys":null,"rebuyUntilLevel":4,"lateRegUntilLevel":2,"payoutPct":[100],"levels":[{"sb":5,"bb":10,"trigger":{"type":"time","minutes":40}}]}'''

-- Изоляция: вечера seed (анонс бывает «сегодня») не мешают табло клуба и номерам игр.
update public.evenings set status = 'cancelled' where status = 'announced';

-- ===========================================================================
-- 1. Номер игры и уникальность (дата, номер)
-- ===========================================================================
select pg_temp.check((select column_default = '1' and is_nullable = 'NO'
                      from information_schema.columns
                      where table_schema = 'public' and table_name = 'evenings' and column_name = 'game_no'),
       'evenings.game_no: not null, по умолчанию 1');
select pg_temp.check(not exists (select 1 from pg_indexes where indexname = 'evenings_one_per_club_day_idx')
                     and exists (select 1 from pg_indexes where indexname = 'evenings_club_day_game_idx'),
       'старый индекс дня снят, новый (дата, game_no) есть');

insert into public.evenings (id, scheduled_at, status, format) values
  ('e2600000-0000-4000-8000-0000000000a1', pg_temp.msk_noon(5), 'announced', :fmt::jsonb);
select pg_temp.rejects(format($q$insert into public.evenings (scheduled_at, status, format)
  values (%L, 'announced', %L)$q$, pg_temp.msk_noon(5) + interval '3 hours', :fmt),
  '23505', 'второй вечер без номера в тот же день — 23505 (cron-tick и форма админки)');
insert into public.evenings (id, scheduled_at, status, format, game_no) values
  ('e2600000-0000-4000-8000-0000000000a2', pg_temp.msk_noon(5) + interval '4 hours', 'announced', :fmt::jsonb, 2);
select pg_temp.check(true, 'игра 2 в тот же день — можно');
select pg_temp.rejects(format($q$insert into public.evenings (scheduled_at, status, format, game_no)
  values (%L, 'announced', %L, 2)$q$, pg_temp.msk_noon(5) + interval '6 hours', :fmt),
  '23505', 'второй вечер с тем же номером в тот же день — 23505');
select pg_temp.rejects(format($q$insert into public.evenings (scheduled_at, status, format, game_no)
  values (%L, 'announced', %L, 0)$q$, pg_temp.msk_noon(6), :fmt),
  '23514', 'game_no 0 — check');
update public.evenings set status = 'cancelled' where id = 'e2600000-0000-4000-8000-0000000000a2';
insert into public.evenings (scheduled_at, status, format, game_no) values
  (pg_temp.msk_noon(5) + interval '5 hours', 'announced', :fmt::jsonb, 2);
select pg_temp.check(true, 'отменённая игра 2 номер не держит');
insert into public.evenings (scheduled_at, status, format, is_training) values
  (pg_temp.msk_noon(5) + interval '1 hour', 'announced', :fmt::jsonb, true);
select pg_temp.check(true, 'тренировка в тот же день номер не занимает');
select pg_temp.check(private.next_game_no(((pg_temp.msk_noon(5)) at time zone 'Europe/Moscow')::date) = 3
                     and private.next_game_no(((pg_temp.msk_noon(7)) at time zone 'Europe/Moscow')::date) = 1,
       'next_game_no: наибольший неотменённый настоящий + 1, пустой день — 1');

-- ===========================================================================
-- 2. Пометка «Тренировка» без RPC по-прежнему не меняется
-- ===========================================================================
insert into public.evenings (id, scheduled_at, status, format, banker_id, is_training) values
  ('e2600000-0000-4000-8000-0000000000b0', pg_temp.msk_noon(5) + interval '2 hours', 'announced', :fmt::jsonb, :p_admin, true);
select pg_temp.rejects($q$update public.evenings set is_training = false
  where id = 'e2600000-0000-4000-8000-0000000000b0'$q$, '22023', 'тренировку не сделать настоящим вечером напрямую');
select set_config('poker.promote_training', 'on', true) as flag_on \gset
select pg_temp.rejects($q$update public.evenings set is_training = true
  where id = 'e2600000-0000-4000-8000-0000000000a1'$q$,
  '22023', 'флаг зачёта не превращает настоящий вечер в тренировку');
select set_config('poker.promote_training', 'off', true) as flag_off \gset

-- ===========================================================================
-- 3. promote_training_evening
-- ===========================================================================
-- Сегодня: настоящая игра 1 (завершена) и две тренировки — завершённая и идущая. Вчера — завершённая
-- тренировка на пустой день.
insert into public.evenings (id, scheduled_at, status, format, banker_id, started_at, finished_at) values
  ('e2600000-0000-4000-8000-0000000000c1', pg_temp.msk_today(0), 'finished', :fmt::jsonb, :p_sasha,
   now() - interval '3 hours', now() - interval '1 hour');
insert into public.evenings (id, scheduled_at, status, format, banker_id, is_training, started_at, finished_at) values
  ('e2600000-0000-4000-8000-0000000000b1', pg_temp.msk_today(0) + interval '1 minute', 'finished', :fmt::jsonb, :p_admin, true,
   now() - interval '50 minutes', now() - interval '10 minutes'),
  ('e2600000-0000-4000-8000-0000000000b2', pg_temp.msk_today(0) + interval '2 minutes', 'live', :fmt::jsonb, :p_admin, true,
   now() - interval '5 minutes', null),
  ('e2600000-0000-4000-8000-0000000000b3', pg_temp.msk_noon(-1), 'settled', :fmt::jsonb, :p_admin, true,
   now() - interval '20 hours', now() - interval '18 hours');
select pg_temp.check((select scoring is not null and voting_closes_at is null and results_posted_at is null
                      from public.evenings where id = 'e2600000-0000-4000-8000-0000000000b1'),
       'завершённая тренировка: снимок очков есть, голосования и поста нет');

set local role anon;
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-0000000000b1')$q$,
  '42501', 'anon — нет права');
reset role;

select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-0000000000b1')$q$,
  '42501', 'не админ (банкир вечера) — 42501');
reset role;

select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-00000000ffff')$q$,
  '22023', 'вечера нет — 22023');
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-0000000000c1')$q$,
  'P0001', 'настоящий вечер — засчитывать нечего');
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-0000000000b2')$q$,
  'P0001', 'идущая тренировка — только завершённую');
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-0000000000b0')$q$,
  'P0001', 'объявленная тренировка — только завершённую');

select public.promote_training_evening('e2600000-0000-4000-8000-0000000000b1') as promoted \gset
reset role;
select pg_temp.check((:'promoted'::jsonb ->> 'gameNo')::int = 2
                     and :'promoted'::jsonb ->> 'evening' = 'e2600000-0000-4000-8000-0000000000b1',
       'ответ: вечер и номер игры 2');
select pg_temp.check((select not is_training and game_no = 2 and status = 'finished'
                             and voting_closes_at = now() + interval '24 hours'
                             and promoted_at = now()
                             and results_posted_at is null and scoring is not null
                             and finished_at = now() - interval '10 minutes'
                      from public.evenings where id = 'e2600000-0000-4000-8000-0000000000b1'),
       'зачёт: настоящий вечер, игра 2, голосование 24 ч от зачёта, момент зачёта записан, пост итогов не тронут, снимок очков и финал прежние');
select pg_temp.check((select count(*) = 0 from public.evenings where promoted_at is not null
                      and id <> 'e2600000-0000-4000-8000-0000000000b1'),
       'promoted_at — только у засчитанной тренировки');
select pg_temp.check(coalesce(current_setting('poker.promote_training', true), '') <> 'on',
       'флаг зачёта снят после вызова');
select pg_temp.rejects($q$update public.evenings set is_training = true
  where id = 'e2600000-0000-4000-8000-0000000000b1'$q$, '22023', 'засчитанный вечер обратно в тренировку не превратить');

select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects($q$select public.promote_training_evening('e2600000-0000-4000-8000-0000000000b1')$q$,
  'P0001', 'повторный вызов — уже настоящий вечер');
select (public.promote_training_evening('e2600000-0000-4000-8000-0000000000b3') ->> 'gameNo')::int as no_b3 \gset
reset role;
select pg_temp.check(:no_b3 = 1 and (select status = 'settled' and not is_training and game_no = 1
                                     from public.evenings where id = 'e2600000-0000-4000-8000-0000000000b3'),
       'тренировка на день без настоящих вечеров — игра 1, рассчитанная остаётся рассчитанной');

-- ===========================================================================
-- 4. create_next_game — «Ещё игра сегодня»
-- ===========================================================================
-- Источник — игра 1 сегодня (c1, банкир Саша); игра 2 уже есть (засчитанная b1) → новая — игра 3.
set local role anon;
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000c1')$q$,
  '42501', 'anon — нет права');
reset role;

select pg_temp.login(:dima);
set local role authenticated;
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000c1')$q$,
  '42501', 'не банкир и не админ — 42501');
reset role;

select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-00000000ffff')$q$,
  '22023', 'вечера нет — 22023');
reset role;

insert into public.evenings (id, scheduled_at, status, format, banker_id, is_training, started_at, finished_at) values
  ('e2600000-0000-4000-8000-0000000000b4', pg_temp.msk_today(0) + interval '3 minutes', 'finished', :fmt::jsonb, :p_sasha, true,
   now() - interval '40 minutes', now() - interval '20 minutes');
insert into public.evenings (id, scheduled_at, status, format, banker_id, started_at, finished_at) values
  ('e2600000-0000-4000-8000-0000000000c0', pg_temp.msk_noon(-2), 'finished', :fmt::jsonb, :p_sasha,
   now() - interval '15 hours', now() - interval '13 hours');
insert into public.evenings (id, scheduled_at, status, format, banker_id) values
  ('e2600000-0000-4000-8000-0000000000c9', pg_temp.msk_noon(9), 'announced', :fmt::jsonb, :p_sasha);

select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000b4')$q$,
  'P0001', 'после тренировки — нельзя');
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000c9')$q$,
  'P0001', 'вечер не завершён — нельзя');
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000c0')$q$,
  'P0001', 'финал больше 12 ч назад — нельзя');

select public.create_next_game('e2600000-0000-4000-8000-0000000000c1') as next1 \gset
select public.create_next_game('e2600000-0000-4000-8000-0000000000c1') as next2 \gset
reset role;
select pg_temp.check((:'next1'::jsonb ->> 'created')::boolean and (:'next1'::jsonb ->> 'gameNo')::int = 3,
       'банкир вечера создал игру — номер 3 (1 и 2 уже есть)');
select pg_temp.check(:'next2'::jsonb ->> 'evening' = :'next1'::jsonb ->> 'evening'
                     and not (:'next2'::jsonb ->> 'created')::boolean,
       'повтор возвращает ту же игру, второй не создаётся');
select pg_temp.check((select e.status = 'announced' and e.scheduled_at = now() and e.game_no = 3
                             and e.banker_id = :p_sasha and e.location is not distinct from s.location
                             and e.format = s.format and not e.is_training
                             and e.announce_posted_at is not null and e.gameday_posted_at is not null
                             and e.results_posted_at is null and e.voting_closes_at is null
                             and e.created_by = :p_sasha
                             and e.slot_date = (now() at time zone 'Europe/Moscow')::date
                      from public.evenings e, public.evenings s
                      where e.id = (:'next1'::jsonb ->> 'evening')::uuid
                        and s.id = 'e2600000-0000-4000-8000-0000000000c1'),
       'новая игра: на сейчас, место, формат и банкир игры 1, анонс и пост дня игры отмечены');

-- Игру начали — повтор по-прежнему ведёт в неё; завершили — повтор создаёт следующую.
update public.evenings set status = 'live', started_at = now() where id = (:'next1'::jsonb ->> 'evening')::uuid;
select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.check(public.create_next_game('e2600000-0000-4000-8000-0000000000c1') ->> 'evening' = :'next1'::jsonb ->> 'evening',
       'идущая игра, созданная после финала, — повтор ведёт в неё');
reset role;

-- Админ без банкира у источника: банкиром новой игры становится он сам.
update public.evenings set status = 'cancelled' where id = (:'next1'::jsonb ->> 'evening')::uuid;
update public.evenings set banker_id = null where id = 'e2600000-0000-4000-8000-0000000000c1';
select pg_temp.login(:admin);
set local role authenticated;
select public.create_next_game('e2600000-0000-4000-8000-0000000000c1') as next3 \gset
reset role;
select pg_temp.check((select banker_id = :p_admin and game_no = 3 from public.evenings
                      where id = (:'next3'::jsonb ->> 'evening')::uuid),
       'админ без банкира у игры 1 — банкир он сам; отменённая игра 3 номер не держит');

-- ===========================================================================
-- 5. Табло клуба: итог игры уступает анонсу следующей игры того же дня
-- ===========================================================================
select club_board_token as code from public.settings where id = 1 \gset
-- Идущая тренировка важнее анонса (023) — завершаем её, чтобы проверять ступени настоящих вечеров.
update public.evenings set status = 'finished', finished_at = now() - interval '30 minutes'
  where id = 'e2600000-0000-4000-8000-0000000000b2';
-- Сейчас: игра 1 (c1) завершена час назад, засчитанная b1 — 10 мин назад, игра 3 (next3) — анонс на сейчас.
set local role anon;
select pg_temp.check(public.club_board_state(:'code') -> 'board' -> 'evening' ->> 'id' = :'next3'::jsonb ->> 'evening',
       'анонс игры 3 сегодня важнее итогов игр 1 и 2');
select pg_temp.check((public.club_board_state(:'code') -> 'board' -> 'evening' ->> 'game_no')::int = 3,
       'табло отдаёт evening.game_no');
reset role;

update public.evenings set status = 'cancelled' where id = (:'next3'::jsonb ->> 'evening')::uuid;
set local role anon;
select pg_temp.check(public.club_board_state(:'code') -> 'board' -> 'evening' ->> 'id' = 'e2600000-0000-4000-8000-0000000000b1',
       'анонса нет — итог последней завершённой игры');
reset role;

-- ===========================================================================
-- 6. «Ещё игра сегодня» после полуночи по Москве
-- ===========================================================================
-- Источник — игра 2 вчерашней даты в 23:00 МСК (игра 1 вчера — засчитанная b3), финал час назад: окно
-- в 12 ч не кончилось, но по Москве уже другой день.
insert into public.evenings (id, scheduled_at, status, format, banker_id, game_no, started_at, finished_at) values
  ('e2600000-0000-4000-8000-0000000000c2', pg_temp.msk_noon(-1) + interval '11 hours', 'finished', :fmt::jsonb, :p_sasha, 2,
   now() - interval '3 hours', now() - interval '1 hour');
select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000c2')$q$,
  'P0001', 'после полуночи новая игра не создаётся: была бы игрой 1 другой даты');
reset role;
select pg_temp.check(not exists (select 1 from public.evenings
                                 where scheduled_at = now() and status = 'announced'),
       'после отказа нового вечера на сейчас нет');

-- Игру 3 той даты создали до полуночи (23:58), ответ не дошёл — повтор после полуночи (и второй телефон
-- админа) открывает её, а не создаёт игру 1 сегодня.
insert into public.evenings (id, scheduled_at, status, format, banker_id, game_no, announce_posted_at, gameday_posted_at) values
  ('e2600000-0000-4000-8000-0000000000c3', pg_temp.msk_noon(-1) + interval '11 hours 58 minutes', 'announced', :fmt::jsonb,
   :p_sasha, 3, now(), now());
select pg_temp.login(:sasha);
set local role authenticated;
select public.create_next_game('e2600000-0000-4000-8000-0000000000c2') as night1 \gset
reset role;
select pg_temp.login(:admin);
set local role authenticated;
select public.create_next_game('e2600000-0000-4000-8000-0000000000c2') as night2 \gset
reset role;
select pg_temp.check(:'night1'::jsonb ->> 'evening' = 'e2600000-0000-4000-8000-0000000000c3'
                     and :'night2'::jsonb ->> 'evening' = 'e2600000-0000-4000-8000-0000000000c3'
                     and not (:'night1'::jsonb ->> 'created')::boolean
                     and (:'night1'::jsonb ->> 'gameNo')::int = 3,
       'повтор после полуночи — та же игра 3 вчерашней даты, новой не создаётся');
select pg_temp.check(not exists (select 1 from public.evenings
                                 where scheduled_at = now() and status = 'announced'),
       'вечер на сейчас (игра 1 сегодня) не появился');
-- Отменённая игра за «уже созданную» не считается — а новую после полуночи по-прежнему не создать.
update public.evenings set status = 'cancelled' where id = 'e2600000-0000-4000-8000-0000000000c3';
select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects($q$select public.create_next_game('e2600000-0000-4000-8000-0000000000c2')$q$,
  'P0001', 'созданную игру отменили — после полуночи снова отказ, а не игра 1 сегодня');
reset role;

rollback;
