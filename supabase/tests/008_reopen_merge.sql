-- Проверки миграции 008 на локальной БД с seed.sql: всё в одной транзакции, в конце rollback —
-- данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/008_reopen_merge.sql
\set QUIET on
begin;

-- ---------------------------------------------------------------------------
-- Подготовка: auth-пользователи для Жени (админ), Саши и Лёши; новый Telegram-профиль «Вова»
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'authenticated', 'authenticated', 't1002@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'authenticated', 'authenticated', 't1004@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a002'
  where id = 'a0000000-0000-4000-8000-000000001002';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a004'
  where id = 'a0000000-0000-4000-8000-000000001004';
insert into public.players (id, tg_id, display_name, username)
  values ('a0000000-0000-4000-8000-000000001007', 1007, 'Вова', 'vova_tg');

-- Вход от имени пользователя: как PostgREST — роль authenticated и sub в request.jwt.claims.
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
-- mark_settled с 010 принимает журнал, который видел клиент: здесь — текущий.
create function pg_temp.settle(p_evening uuid) returns void language sql as $$
  select public.mark_settled(p_evening,
    (select coalesce(max(id), 0) from public.evening_events where evening_id = p_evening),
    (select count(*)::int from public.evening_events where evening_id = p_evening and voided_at is not null));
$$;
grant execute on function pg_temp.settle(uuid) to authenticated;

-- Короткие имена
\set admin '''00000000-0000-4000-8000-00000000a001'''
\set sasha_auth '''00000000-0000-4000-8000-00000000a002'''
\set lesha_auth '''00000000-0000-4000-8000-00000000a004'''
\set e1 '''e0000000-0000-4000-8000-000000000001'''
\set e2 '''e0000000-0000-4000-8000-000000000002'''
\set e3 '''e0000000-0000-4000-8000-000000000003'''
\set e4 '''e0000000-0000-4000-8000-000000000004'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set guest '''a0000000-0000-4000-8000-000000009001'''
\set vova '''a0000000-0000-4000-8000-000000001007'''
\set sasha '''a0000000-0000-4000-8000-000000001002'''
\set lesha '''a0000000-0000-4000-8000-000000001004'''

-- ===========================================================================
-- 1. Правка журнала открывает закрытый расчёт
-- ===========================================================================
select pg_temp.check((select status = 'settled' and settle_reopened_at is null
                      from public.evenings where id = :e1), 'исходно вечер 1 — расчёт закрыт');

select pg_temp.login(:admin);
set local role authenticated;

-- Платёж админа в рассчитанный вечер
select (public.add_event(:e1, 'payment', jsonb_build_object('playerId', :sasha::uuid, 'amountRub', 100))).id as pay_id \gset
select pg_temp.check((select status = 'finished' and settled_at is null and settle_reopened_at is not null
                      from public.evenings where id = :e1), 'add_event payment → finished, метка «открылся сам»');

select pg_temp.settle(:e1);
select pg_temp.check((select status = 'settled' and settled_at is not null and settle_reopened_at is null
                      from public.evenings where id = :e1), 'mark_settled снимает метку');

select public.void_event(:pay_id);
select pg_temp.check((select status = 'finished' and settled_at is null and settle_reopened_at is not null
                      from public.evenings where id = :e1), 'void_event → finished, метка');

select pg_temp.settle(:e1);
select public.unmark_settled(:e1);
select pg_temp.check((select status = 'finished' and settle_reopened_at is null
                      from public.evenings where id = :e1), 'unmark_settled руками — без метки');

-- Событие без данных (раздача) — «любого типа»
select public.add_event(:e3, 'hand');
select pg_temp.check((select status = 'finished' and settle_reopened_at is not null
                      from public.evenings where id = :e3), 'add_event hand → finished');

-- add_guest (join через add_event)
select public.add_guest(:e4, 'Тест Гость');
select pg_temp.check((select status = 'finished' and settle_reopened_at is not null
                      from public.evenings where id = :e4), 'add_guest → finished');

-- Отмена finish рассчитанного вечера: вечер возвращается в игру (как раньше)
select pg_temp.settle(:e3);
select public.void_event((select id from public.evening_events
                          where evening_id = :e3 and type = 'finish' and voided_at is null));
select pg_temp.check((select status = 'live' and settled_at is null and finished_at is null
                      from public.evenings where id = :e3), 'void finish у settled → live');

reset role;

-- Банкир (Саша, вечер 2) — платёж тоже открывает расчёт
select pg_temp.login(:sasha_auth);
set local role authenticated;
select public.add_event(:e2, 'payment', jsonb_build_object('playerId', :sasha::uuid, 'amountRub', -50));
select pg_temp.check((select status = 'finished' and settle_reopened_at is not null
                      from public.evenings where id = :e2), 'платёж банкира → finished');
reset role;

-- Ошибка в add_event откатывает и статус (атомарность): кривой payload
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.settle(:e2);
do $$
begin
  perform public.add_event('e0000000-0000-4000-8000-000000000002', 'payment', '{"playerId": "nope"}');
  raise exception 'FAIL: ожидалась ошибка 22023';
exception when sqlstate '22023' then
  perform pg_temp.check((select status = 'settled' from public.evenings
                         where id = 'e0000000-0000-4000-8000-000000000002'),
                        'ошибочное событие не открывает расчёт');
end;
$$;
reset role;

-- ===========================================================================
-- 4. set_prediction: на гостя ставить можно (сервер гостей не ограничивает)
-- ===========================================================================
select pg_temp.login(:sasha_auth);
set local role authenticated;
select public.set_prediction('e0000000-0000-4000-8000-000000000006', :guest, :guest);
reset role;
select pg_temp.check((select winner_id = :guest and first_out_id = :guest from public.predictions
                      where evening_id = 'e0000000-0000-4000-8000-000000000006' and player_id = :sasha),
                     'set_prediction принимает гостя победителем и первым вылетом');
-- Снимаем, чтобы не мешать проверкам слияния ниже (число прогнозов с гостем).
select pg_temp.login(:sasha_auth);
set local role authenticated;
select public.set_prediction('e0000000-0000-4000-8000-000000000006', null, null);
reset role;

-- ===========================================================================
-- 2. merge_players
-- ===========================================================================
-- Сколько ссылок на гостя до слияния
select count(*) filter (where payload ->> 'playerId' = :guest) as g_pid,
       count(*) filter (where payload -> 'by' ? :guest) as g_by
from public.evening_events \gset
select count(*) as g_votes_nom from public.votes where nominee_id = :guest \gset
select count(*) as g_pred_about from public.predictions where winner_id = :guest or first_out_id = :guest \gset
select coalesce(jsonb_agg(jsonb_build_object('e', evening_id, 'p', player_id, 'u', updated_at) order by evening_id, player_id), '[]')::text as pred_times
from public.predictions where winner_id = :guest or first_out_id = :guest \gset
select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status) order by id), '[]')::text as statuses
from public.evenings \gset

-- Не админ
select pg_temp.login(:sasha_auth);
set local role authenticated;
do $$
begin
  perform public.merge_players('a0000000-0000-4000-8000-000000009001', 'a0000000-0000-4000-8000-000000001007');
  raise exception 'FAIL: ожидалась ошибка прав';
exception when sqlstate '42501' then
  perform pg_temp.check(true, 'не админ — 42501');
end;
$$;
reset role;

select pg_temp.login(:admin);
set local role authenticated;

-- Неверные аргументы
do $$
begin
  perform public.merge_players_preview('a0000000-0000-4000-8000-000000001002', 'a0000000-0000-4000-8000-000000001007');
  raise exception 'FAIL: гость с Telegram принят';
exception when sqlstate '22023' then
  perform pg_temp.check(true, 'p_guest с tg_id — 22023');
end;
$$;
do $$
begin
  perform public.merge_players_preview('a0000000-0000-4000-8000-000000009001', 'a0000000-0000-4000-8000-000000009001');
  raise exception 'FAIL: сам с собой';
exception when sqlstate '22023' then
  perform pg_temp.check(true, 'p_guest = p_target — 22023');
end;
$$;

-- Предпросмотр: Вова-гость играл вечера 2 и 4, за него 2 голоса, 4 прогноза с его именем
select public.merge_players_preview(:guest, :vova) as preview \gset
select pg_temp.check((:'preview'::jsonb ->> 'evenings')::int = 2, 'preview: 2 вечера');
select pg_temp.check((:'preview'::jsonb ->> 'votesReceived')::int = 2, 'preview: 2 голоса за гостя');
select pg_temp.check((:'preview'::jsonb ->> 'predictionsAbout')::int = 4, 'preview: 4 прогноза');
select pg_temp.check(jsonb_array_length(:'preview'::jsonb -> 'blockers') = 0, 'preview: препятствий нет');

-- Препятствие: Саша играл те же вечера
select public.merge_players_preview(:guest, :sasha) as bad \gset
select pg_temp.check(jsonb_array_length(:'bad'::jsonb -> 'blockers') = 2
                     and :'bad'::jsonb ->> 'blockers' like '%Оба есть в журнале вечера 10 сентября — похоже, это разные люди. Выбери другой профиль%',
                     'preview с Сашей: 2 препятствия «оба в журнале»');
do $$
begin
  perform public.merge_players('a0000000-0000-4000-8000-000000009001', 'a0000000-0000-4000-8000-000000001002');
  raise exception 'FAIL: слияние с игравшим в тех же вечерах прошло';
exception when sqlstate 'P0001' then
  perform pg_temp.check(sqlerrm like 'Привязать профиль «Вова (гость)» к профилю «Саша» нельзя: Оба есть в журнале вечера 10 сентября%',
                        'merge с Сашей — P0001 с причиной: ' || sqlerrm);
end;
$$;
reset role;

-- Препятствия по rsvps, голосам «за другого» и фото при открытом голосовании (в точке сохранения)
savepoint blockers;
insert into public.rsvps (evening_id, player_id, status) values
  ('e0000000-0000-4000-8000-000000000006', :guest, 'no'),
  ('e0000000-0000-4000-8000-000000000006', :vova, 'yes');
insert into public.votes (evening_id, voter_id, category, nominee_id) values (:e2, :vova, 'hand', :guest);
update public.evenings set voting_closes_at = now() + interval '1 hour' where id = :e4;
insert into public.votes (evening_id, voter_id, category, nominee_id, photo_path)
  values (:e4, :guest, 'badbeat', :lesha, 'e0000000-0000-4000-8000-000000000004/a0000000-0000-4000-8000-000000009001/0123456789ab.jpg');
select pg_temp.login(:admin);
set local role authenticated;
select public.merge_players_preview(:guest, :vova) as bad2 \gset
select pg_temp.check(jsonb_array_length(:'bad2'::jsonb -> 'blockers') = 3, 'три препятствия: ' || (:'bad2'::jsonb ->> 'blockers'));
select pg_temp.check(:'bad2'::jsonb ->> 'blockers' like '%ответили на анонс вечера 8 октября%', 'rsvp разные');
select pg_temp.check(:'bad2'::jsonb ->> 'blockers' like '%голос за себя%', 'голос за другого');
select pg_temp.check(:'bad2'::jsonb ->> 'blockers' like '%голосование ещё идёт%', 'фото при открытом голосовании');
reset role;
rollback to savepoint blockers;

-- Совпадающий ответ на анонс — не препятствие, дубль схлопывается
savepoint same_rsvp;
insert into public.rsvps (evening_id, player_id, status, updated_at) values
  ('e0000000-0000-4000-8000-000000000006', :guest, 'yes', '2026-10-05 10:00+00'),
  ('e0000000-0000-4000-8000-000000000006', :vova, 'yes', '2026-10-05 11:00+00');
select pg_temp.login(:admin);
set local role authenticated;
select public.merge_players(:guest, :vova);
reset role;
select pg_temp.check((select count(*) = 1 and min(updated_at) = '2026-10-05 11:00+00'
                      from public.rsvps where evening_id = 'e0000000-0000-4000-8000-000000000006'
                        and player_id = :vova), 'одинаковые rsvp: остался ответ профиля');
rollback to savepoint same_rsvp;

-- Само слияние
select pg_temp.login(:admin);
set local role authenticated;
select public.merge_players(:guest, :vova) as report \gset
reset role;

select pg_temp.check((:'report'::jsonb ->> 'evenings')::int = 2, 'отчёт: 2 вечера');
select pg_temp.check(not exists (select 1 from public.players where id = :guest), 'гость удалён');
select pg_temp.check((select not is_guest from public.players where id = :vova), 'профиль не гость');
select pg_temp.check(not exists (select 1 from public.evening_events
                                 where payload ->> 'playerId' = :guest or payload -> 'by' ? :guest
                                    or created_by = :guest or voided_by = :guest),
                     'в журнале не осталось ссылок на гостя');
select pg_temp.check((select count(*) filter (where payload ->> 'playerId' = :vova) = :g_pid
                         and count(*) filter (where payload -> 'by' ? :vova) = :g_by
                      from public.evening_events), 'все ссылки журнала перешли на профиль');
select pg_temp.check((select count(*) from public.votes where nominee_id = :vova) = :g_votes_nom,
                     'голоса за гостя теперь за профиль');
select pg_temp.check((select coalesce(jsonb_agg(jsonb_build_object('e', evening_id, 'p', player_id, 'u', updated_at) order by evening_id, player_id), '[]')
                      from public.predictions where winner_id = :vova or first_out_id = :vova)
                     = :'pred_times'::jsonb, 'прогнозы перешли, updated_at сохранён');
select pg_temp.check((select count(*) from public.predictions where winner_id = :vova or first_out_id = :vova) = :g_pred_about,
                     'число прогнозов с профилем = было с гостем');
select pg_temp.check((select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status) order by id), '[]')
                      from public.evenings) = :'statuses'::jsonb,
                     'статусы вечеров не изменились (слияние не открывает расчёт)');
-- is_participant / голосование видят профиль участником вечеров гостя
select pg_temp.check(public.is_participant(:e2, :vova) and public.is_participant(:e4, :vova),
                     'профиль — участник вечеров 2 и 4');
-- Порядок by: в вечере 4 Дима выбил гостя → теперь Дима выбил Вову; payload остался той же формы
select pg_temp.check((select payload = jsonb_build_object('playerId', :vova, 'by', jsonb_build_array('a0000000-0000-4000-8000-000000001003'))
                      from public.evening_events
                      where evening_id = :e4 and type = 'bust' and at = (select scheduled_at + interval '80 minutes' from public.evenings where id = :e4)),
                     'bust: playerId заменён, by и форма payload не изменились');

rollback;
\echo 'Все проверки 008 прошли'
