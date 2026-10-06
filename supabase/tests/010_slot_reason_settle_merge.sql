-- Проверки миграции 010 на локальной БД с seed.sql: всё в одной транзакции, в конце rollback —
-- данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/010_slot_reason_settle_merge.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'authenticated', 'authenticated', 't1004@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a004'
  where id = 'a0000000-0000-4000-8000-000000001004';
insert into public.players (id, tg_id, display_name, username)
  values ('a0000000-0000-4000-8000-000000001007', 1007, 'Вова', 'vova_tg');

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

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set lesha_auth '''00000000-0000-4000-8000-00000000a004'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set guest '''a0000000-0000-4000-8000-000000009001'''
\set vova '''a0000000-0000-4000-8000-000000001007'''
\set sasha '''a0000000-0000-4000-8000-000000001002'''

-- ===========================================================================
-- 1. slot_date: ставится при вставке, перенос его не меняет
-- ===========================================================================
select pg_temp.check(not exists (select 1 from public.evenings where slot_date is null),
                     'у всех вечеров есть slot_date');
select pg_temp.check((select slot_date = date '2026-10-08' from public.evenings where id = :e6),
                     'slot_date вечера 6 — четверг 8 октября');

-- 23:30 МСК 15.10 = 20:30 UTC: слот — московский день, а не UTC.
insert into public.evenings (id, scheduled_at, status, format)
values ('e0000000-0000-4000-8000-0000000000a1', '2026-10-15 20:30:00+00', 'announced', '{}');
select pg_temp.check((select slot_date = date '2026-10-15' from public.evenings
                      where id = 'e0000000-0000-4000-8000-0000000000a1'),
                     'вставка: slot_date по московскому дню');

-- Перенос PATCH-ем (update) и upsert-ом формы админки (insert … on conflict do update)
update public.evenings set scheduled_at = '2026-10-09 17:00:00+00' where id = :e6;
select pg_temp.check((select slot_date = date '2026-10-08' from public.evenings where id = :e6),
                     'update scheduled_at не меняет slot_date');
insert into public.evenings (id, scheduled_at, format)
values (:e6, '2026-10-10 17:00:00+00', '{}')
on conflict (id) do update set scheduled_at = excluded.scheduled_at;
select pg_temp.check((select slot_date = date '2026-10-08' and scheduled_at = '2026-10-10 17:00:00+00'
                      from public.evenings where id = :e6),
                     'upsert формы переносит вечер, slot_date остаётся четвергом');
-- Тот же запрос, что cron-tick (slotFilter): четверг 8.10 занят перенесённым вечером.
select pg_temp.check(exists (
  select 1 from public.evenings
  where (scheduled_at >= '2026-10-07T21:00:00Z' and scheduled_at < '2026-10-08T21:00:00Z')
     or slot_date = date '2026-10-08'), 'слот четверга занят перенесённым вечером');

-- ===========================================================================
-- 2. cancel_reason
-- ===========================================================================
select pg_temp.check((select cancel_reason = 'Не собрали состав' and note is null
                      from public.evenings where id = 'e0000000-0000-4000-8000-000000000007'),
                     'отменённый вечер seed: причина отдельно от заметки');
do $$
begin
  update public.evenings set cancel_reason = repeat('я', 201) where id = 'e0000000-0000-4000-8000-000000000006';
  raise exception 'FAIL: причина длиннее 200 символов принята';
exception when check_violation then
  perform pg_temp.check(true, 'cancel_reason > 200 символов — 23514');
end;
$$;
do $$
begin
  update public.evenings set cancel_reason = '' where id = 'e0000000-0000-4000-8000-000000000006';
  raise exception 'FAIL: пустая причина принята';
exception when check_violation then
  perform pg_temp.check(true, 'пустая cancel_reason — 23514 (пусто = null)');
end;
$$;

-- ===========================================================================
-- 3. mark_settled сверяет журнал, который видел клиент
-- ===========================================================================
select coalesce(max(id), 0) as last_id,
       count(*) filter (where voided_at is not null) as voided
from public.evening_events where evening_id = :e5 \gset
-- Внутрь do $$ … $$ переменные psql не подставляются — передаём через настройки сеанса.
select set_config('t.last_id', :'last_id', true), set_config('t.voided', :'voided', true);

-- Банкир вечера 5 — Лёша
select pg_temp.login(:lesha_auth);
set local role authenticated;

-- Журнал изменился после того, как банкир открыл расчёт: новый платёж
select (public.add_event(:e5, 'payment', jsonb_build_object('playerId', :sasha::uuid, 'amountRub', 10))).id as pay_id \gset
select set_config('t.pay_id', :'pay_id', true);
do $$
begin
  perform public.mark_settled('e0000000-0000-4000-8000-000000000005',
    current_setting('t.last_id')::bigint, current_setting('t.voided')::int);
  raise exception 'FAIL: расчёт закрыт по устаревшему журналу (новая запись)';
exception when sqlstate 'P0001' then
  perform pg_temp.check(sqlerrm like 'Журнал вечера изменился, пока был открыт расчёт%',
                        'новая запись после чтения — P0001: ' || sqlerrm);
end;
$$;

-- Отмена платежа с другого устройства: id тот же, отменённых больше
select public.void_event(:pay_id);
do $$
begin
  perform public.mark_settled('e0000000-0000-4000-8000-000000000005',
    current_setting('t.pay_id')::bigint, current_setting('t.voided')::int);
  raise exception 'FAIL: расчёт закрыт по устаревшему журналу (отмена)';
exception when sqlstate 'P0001' then
  perform pg_temp.check(true, 'отмена записи после чтения — P0001');
end;
$$;
select pg_temp.check((select status = 'finished' from public.evenings where id = :e5),
                     'отказы не меняют статус');

-- Актуальный журнал — закрывается
select public.mark_settled(:e5, :pay_id, :voided + 1);
select pg_temp.check((select status = 'settled' and settled_at is not null from public.evenings where id = :e5),
                     'актуальный журнал — расчёт закрыт');
-- Повторное нажатие с устаревшими данными — не ошибка (уже закрыт)
select public.mark_settled(:e5, 0, 0);
reset role;

-- ===========================================================================
-- 4–5. merge_players: текст препятствия, текст отказа, проверка оставшихся ссылок
-- ===========================================================================
select pg_temp.login(:admin);
set local role authenticated;

select public.merge_players_preview(:guest, :sasha) as bad \gset
select pg_temp.check(
  :'bad'::jsonb -> 'blockers' ->> 0 =
    'Оба есть в журнале вечера 10 сентября — похоже, это разные люди. Выбери другой профиль или, если гостя вписали по ошибке, отмени его записи в журнале этого вечера.',
  'препятствие сначала советует выбрать другой профиль');
do $$
begin
  perform public.merge_players('a0000000-0000-4000-8000-000000009001', 'a0000000-0000-4000-8000-000000001002');
  raise exception 'FAIL: слияние с Сашей прошло';
exception when sqlstate 'P0001' then
  perform pg_temp.check(sqlerrm like 'Привязать профиль «Вова (гость)» к профилю «Саша» нельзя: Оба есть в журнале%',
                        'отказ слияния — «Привязать профиль … к профилю … нельзя»');
end;
$$;
reset role;

-- Таблица со ссылкой на игрока, о которой merge_players не знает (on delete cascade — удаление
-- гостя само бы её тихо вычистило).
savepoint forgotten;
create table public.zz_forgotten (
  player_id uuid not null references public.players (id) on delete cascade
);
insert into public.zz_forgotten values (:guest);

select pg_temp.check(private.player_references(:guest) @> array['public.zz_forgotten.player_id'],
                     'player_references находит ссылку из новой таблицы');

select pg_temp.login(:admin);
set local role authenticated;
do $$
begin
  perform public.merge_players('a0000000-0000-4000-8000-000000009001', 'a0000000-0000-4000-8000-000000001007');
  raise exception 'FAIL: слияние с забытой ссылкой прошло';
exception when sqlstate 'XX000' then
  perform pg_temp.check(sqlerrm like '%перенос не учёл записи в public.zz_forgotten.player_id%',
                        'забытая ссылка — отказ: ' || sqlerrm);
end;
$$;
reset role;
select pg_temp.check(exists (select 1 from public.players where id = :guest)
                     and exists (select 1 from public.zz_forgotten where player_id = :guest)
                     and exists (select 1 from public.evening_events where payload ->> 'playerId' = :guest),
                     'после отказа гость, его журнал и строка новой таблицы на месте');
rollback to savepoint forgotten;

-- Без забытых ссылок слияние проходит, и ссылок на гостя не остаётся
select pg_temp.login(:admin);
set local role authenticated;
select public.merge_players(:guest, :vova);
reset role;
select pg_temp.check(not exists (select 1 from public.players where id = :guest)
                     and cardinality(private.player_references(:vova)) > 0,
                     'слияние без забытых ссылок прошло, всё на профиле');

rollback;
\echo 'Все проверки 010 прошли'
