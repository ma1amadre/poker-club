-- Проверки миграции 024 (болельщик, слияние гостя с гостем) на локальной БД с seed.sql: всё в одной
-- транзакции, в конце rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP
-- выходит с кодом 3. От сегодняшней даты не зависит. Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/024_spectator_merge_guests.sql
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

-- Запрос должен упасть с этим кодом (и, если задан, с текстом по шаблону like).
create function pg_temp.rejects(p_sql text, p_state text, p_what text, p_like text default null)
returns void language plpgsql as $$
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
    if p_like is not null and sqlerrm not like p_like then
      raise exception 'FAIL: % — другой текст: %', p_what, sqlerrm;
    end if;
    raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.rejects(text, text, text, text) to anon, authenticated, service_role;

-- Сколько строк players изменил update под текущей ролью (RLS молча отсекает чужое).
create function pg_temp.updated(p_sql text) returns int language plpgsql as $$
declare
  n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function pg_temp.updated(text) to anon, authenticated, service_role;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set sasha_auth '''00000000-0000-4000-8000-00000000a002'''
\set zhenya '''a0000000-0000-4000-8000-000000001001'''
\set sasha '''a0000000-0000-4000-8000-000000001002'''
\set guest '''a0000000-0000-4000-8000-000000009001'''
\set dup '''a0000000-0000-4000-8000-000000009002'''
\set petya '''a0000000-0000-4000-8000-000000009003'''
\set e2 '''e0000000-0000-4000-8000-000000000002'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''

-- ===========================================================================
-- 1. Болельщик: колонка, backfill, новые игроки
-- ===========================================================================
select pg_temp.check(
  (select count(*) = 6 and bool_and(is_spectator = false)
   from public.players where tg_id is not null),
  'сыгравшие постоянные — «играет» (backfill; seed повторяет его после заливки)');
select pg_temp.check((select is_spectator is null from public.players where id = :guest),
                     'гостю флаг не ставится');
insert into public.players (id, tg_id, display_name)
  values ('a0000000-0000-4000-8000-000000001009', 1009, 'Новичок');
select pg_temp.check(
  (select is_spectator is null from public.players where id = 'a0000000-0000-4000-8000-000000001009'),
  'новый профиль (tg-auth) — null: ещё не выбирал, главная спросит');

-- ===========================================================================
-- 2. set_my_spectator и права на флаг
-- ===========================================================================
select pg_temp.login(:sasha_auth);
set local role authenticated;
select pg_temp.check(public.set_my_spectator(true) = true, 'set_my_spectator(true) возвращает true');
reset role;
select pg_temp.check((select is_spectator from public.players where id = :sasha) = true,
                     'флаг Саши — болельщик');
select pg_temp.check((select is_spectator from public.players where id = :zhenya) = false,
                     'чужой флаг не тронут');

select pg_temp.login(:sasha_auth);
set local role authenticated;
select pg_temp.rejects('select public.set_my_spectator(null)', '22023', 'null — 22023',
                       'Выбери: играешь или следишь за игрой');
-- Прямой записью в таблицу — ни свой флаг, ни чужой, ни свой is_admin (RLS: update только админ).
select pg_temp.check(
  pg_temp.updated(format('update public.players set is_spectator = false where id = %L', :sasha)) = 0,
  'свой флаг напрямую не меняется — только через RPC');
select pg_temp.check(
  pg_temp.updated(format('update public.players set is_spectator = true where id = %L', :zhenya)) = 0,
  'чужой флаг игрок не меняет');
select pg_temp.check(
  pg_temp.updated(format('update public.players set is_admin = true where id = %L', :sasha)) = 0,
  'свой is_admin тоже нет (поэтому RPC, а не политика на свою строку)');
select pg_temp.check(public.set_my_spectator(false) = false, 'set_my_spectator(false) — снова играет');
reset role;
select pg_temp.check(
  (select is_spectator = false and not is_admin from public.players where id = :sasha),
  'после RPC — false, is_admin не тронут');

-- Отключённый игрок не входит в клуб — и флаг не меняет.
update public.players set is_active = false where id = :sasha;
select pg_temp.login(:sasha_auth);
set local role authenticated;
select pg_temp.rejects('select public.set_my_spectator(true)', '42501', 'отключённый — 42501');
reset role;
update public.players set is_active = true where id = :sasha;

set local role anon;
select pg_temp.rejects('select public.set_my_spectator(true)', '42501', 'anon — нет права на RPC');
reset role;

-- Админ меняет чужой флаг формой «Игроки» (upsert под RLS).
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.check(
  pg_temp.updated(format('update public.players set is_spectator = true where id = %L', :sasha)) = 1,
  'админ меняет чужой флаг');
reset role;
select pg_temp.check((select is_spectator from public.players where id = :sasha) = true,
                     'флаг Саши поставил админ');

select pg_temp.check(
  has_function_privilege('authenticated', 'public.set_my_spectator(boolean)', 'execute')
  and has_function_privilege('service_role', 'public.set_my_spectator(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.set_my_spectator(boolean)', 'execute'),
  'гранты set_my_spectator: authenticated и service_role, anon — нет');

-- ===========================================================================
-- 3. merge_guests: права и аргументы
-- ===========================================================================
-- Дубль гостя «Вова (гость)» — «Вова», и постоянный игрок без Telegram «Петя».
insert into public.players (id, tg_id, display_name, is_guest, is_active) values
  (:dup, null, 'Вова', true, false),
  (:petya, null, 'Петя', false, true);
update public.players set spoken_name = 'П+етя' where id = :petya;

set local role anon;
select pg_temp.rejects(format('select public.merge_guests_preview(%L, %L)', :guest, :dup),
                       '42501', 'anon: merge_guests_preview — нет права');
select pg_temp.rejects(format('select public.merge_guests(%L, %L)', :guest, :dup),
                       '42501', 'anon: merge_guests — нет права');
reset role;

select pg_temp.login(:sasha_auth);
set local role authenticated;
select pg_temp.rejects(format('select public.merge_guests_preview(%L, %L)', :guest, :dup),
                       '42501', 'не админ: предпросмотр — 42501', 'Объединять игроков может только админ');
select pg_temp.rejects(format('select public.merge_guests(%L, %L)', :guest, :dup),
                       '42501', 'не админ: слияние — 42501');
reset role;

select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.rejects(format('select public.merge_guests_preview(null, %L)', :dup),
                       '22023', 'нет дубля — 22023');
select pg_temp.rejects(format('select public.merge_guests_preview(%L, %L)', :guest, :guest),
                       '22023', 'один и тот же — 22023', 'Это один и тот же игрок');
select pg_temp.rejects(format('select public.merge_guests_preview(%L, %L)', :guest,
                              'a0000000-0000-4000-8000-0000000099ff'),
                       '22023', 'профиля нет — 22023', '%не найден%');
select pg_temp.rejects(format('select public.merge_guests_preview(%L, %L)', :sasha, :dup),
                       '22023', 'дубль с Telegram — 22023', '«Саша» входит через Telegram%');
select pg_temp.rejects(format('select public.merge_guests_preview(%L, %L)', :guest, :sasha),
                       '22023', 'оставить профиль с Telegram — 22023 и совет про привязку',
                       '%«Привязать к Telegram»%');
-- И старое слияние гостя с Telegram-профилем профиль без Telegram по-прежнему не принимает.
select pg_temp.rejects(format('select public.merge_players_preview(%L, %L)', :guest, :dup),
                       '22023', 'merge_players: профиль без Telegram — как раньше', 'У «Вова» нет Telegram%');

-- ===========================================================================
-- 4. Предпросмотр и препятствие «оба в журнале»
-- ===========================================================================
select public.merge_guests_preview(:guest, :dup) as preview \gset
select pg_temp.check(
  (:'preview'::jsonb -> 'blockers') = '[]'::jsonb
  and (:'preview'::jsonb ->> 'evenings')::int = 2
  and (:'preview'::jsonb ->> 'events')::int = 10
  and (:'preview'::jsonb ->> 'votesReceived')::int = 2
  and (:'preview'::jsonb ->> 'predictionsAbout')::int = 4
  and (:'preview'::jsonb #>> '{guest,name}') = 'Вова (гость)'
  and (:'preview'::jsonb #>> '{target,name}') = 'Вова'
  and (:'preview'::jsonb ->> 'becomesPermanent')::boolean = false
  and (:'preview'::jsonb ->> 'becomesActive')::boolean = true,
  'предпросмотр: 2 вечера, 10 записей, 2 голоса, 4 прогноза; дубль включён — профиль включится: '
    || :'preview');

-- Одного человека посадили дважды: дубль тоже в журнале 10 сентября.
savepoint twice;
select (public.add_event(:e2, 'join', jsonb_build_object('playerId', :dup::uuid))).id as dup_join \gset
select public.merge_guests_preview(:guest, :dup) as bad \gset
select pg_temp.check(
  :'bad'::jsonb -> 'blockers' ->> 0 =
    'Оба есть в журнале вечера 10 сентября — похоже, это разные люди. Выбери другой профиль или, если одного человека посадили дважды, сначала отмени лишние записи в журнале этого вечера.',
  'препятствие «оба в журнале» — текст для дублей');
select pg_temp.rejects(format('select public.merge_guests(%L, %L)', :guest, :dup), 'P0001',
                       'слияние при препятствии — P0001 с причиной',
                       'Объединить профиль «Вова (гость)» с профилем «Вова» нельзя: Оба есть в журнале вечера 10 сентября%');
reset role;
select pg_temp.check(exists (select 1 from public.players where id = :guest),
                     'после отказа дубль на месте');
select pg_temp.login(:admin);
set local role authenticated;
select public.void_event(:dup_join);
select pg_temp.check(
  (public.merge_guests_preview(:guest, :dup) -> 'blockers') = '[]'::jsonb,
  'лишний вход отменён — препятствия нет');
reset role;
rollback to savepoint twice;
reset role;

-- Разные ответы на один анонс (строки вставлены напрямую: войти без Telegram нельзя, но перенос
-- общий с merge_players и должен их видеть).
savepoint answers;
insert into public.rsvps (evening_id, player_id, status) values (:e6, :guest, 'yes'), (:e6, :dup, 'no');
select pg_temp.check(
  public.merge_guests_preview(:guest, :dup) ->> 'blockers'
    like '%Оба ответили на анонс вечера 8 октября, и ответы разные.%',
  'разные ответы — препятствие');
rollback to savepoint answers;

-- ===========================================================================
-- 5. Слияние: перенос, флаги, имя для озвучки
-- ===========================================================================
reset role;
update public.players set is_spectator = true where id = :guest;
create temporary table before_merge as
  select
    (select count(*) from public.evening_events where private.payload_mentions_player(payload, :guest)) as events,
    (select string_agg(id::text || status || coalesce(settled_at::text, '') || results_revision::text, ',' order by id)
     from public.evenings) as evenings,
    (select count(*) from public.votes where nominee_id = :guest) as votes,
    (select count(*) from public.predictions where winner_id = :guest or first_out_id = :guest) as preds;

select pg_temp.login(:admin);
set local role authenticated;
select public.merge_guests(:guest, :dup) as report \gset
reset role;

select pg_temp.check(not exists (select 1 from public.players where id = :guest), 'дубль удалён');
select pg_temp.check(
  not exists (select 1 from public.evening_events where private.payload_mentions_player(payload, :guest))
  and (select count(*) from public.evening_events where private.payload_mentions_player(payload, :dup))
      = (select events from before_merge),
  'журнал: все упоминания дубля — на профиле');
select pg_temp.check(
  (select count(*) from public.votes where nominee_id = :dup) = (select votes from before_merge)
  and (select count(*) from public.predictions where winner_id = :dup or first_out_id = :dup)
      = (select preds from before_merge),
  'голоса и прогнозы о дубле — на профиле');
select pg_temp.check(
  (select string_agg(id::text || status || coalesce(settled_at::text, '') || results_revision::text, ',' order by id)
   from public.evenings) = (select evenings from before_merge),
  'статусы, закрытые расчёты и ревизии итогов вечеров не тронуты');
select pg_temp.check(
  (select display_name = 'Вова' and is_guest and is_active and spoken_name = 'В+ова' and is_spectator
   from public.players where id = :dup),
  'профиль: имя своё, гость, включился (дубль был включён), имя для озвучки и режим — дубля (своих не было)');
select pg_temp.check(cardinality(private.player_references(:guest)) = 0,
                     'ссылок на дубль не осталось');
select pg_temp.check((:'report'::jsonb ->> 'becomesActive')::boolean, 'отчёт слияния — как предпросмотр');

-- Постоянный без Telegram в гостя: профиль станет постоянным, своё имя для озвучки сохранит;
-- ответ на анонс переезжает с прежним временем.
insert into public.rsvps (evening_id, player_id, status, updated_at)
  values (:e6, :petya, 'maybe', '2026-10-05 10:00:00+00');
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.check((public.merge_guests_preview(:petya, :dup) ->> 'becomesPermanent')::boolean,
                     'предпросмотр: дубль постоянный — профиль станет постоянным');
select public.merge_guests(:petya, :dup) as report2 \gset
reset role;
select pg_temp.check(
  (select not is_guest and spoken_name = 'В+ова' from public.players where id = :dup),
  'профиль стал постоянным, своё имя для озвучки осталось');
select pg_temp.check(
  (select status = 'maybe' and updated_at = '2026-10-05 10:00:00+00'
   from public.rsvps where evening_id = :e6 and player_id = :dup),
  'ответ на анонс переехал с прежним временем');

-- ===========================================================================
-- 6. Гранты служебных функций
-- ===========================================================================
select pg_temp.check(
  has_function_privilege('authenticated', 'public.merge_guests(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.merge_guests_preview(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.merge_guests(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.merge_guests(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.merge_guests_preview(uuid, uuid)', 'execute'),
  'гранты merge_guests: authenticated и service_role, anon — нет');
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.merge_move(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.merge_report_body(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.merge_guests_report(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.merge_move(uuid, uuid)', 'execute'),
  'служебные private.merge_* — не для клиентов');

rollback;
\echo 'Все проверки 024 прошли'
