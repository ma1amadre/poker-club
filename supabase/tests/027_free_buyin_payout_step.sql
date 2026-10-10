-- Проверки миграции 027 (вход и ребай любой суммой — rub в записи; шаг призовых у форматов) на
-- локальной БД с seed.sql: всё в одной транзакции, в конце rollback — данные не меняются. Любая
-- неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/027_free_buyin_payout_step.sql
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

-- Ключ i-й записи действия — та же формула, что private.derived_client_id (020).
create function pg_temp.key(p_client_id uuid, p_n integer) returns uuid language sql as $$
  select case when p_n = 0 then p_client_id else md5(p_client_id::text || ':' || p_n::text)::uuid end;
$$;
grant execute on function pg_temp.key(uuid, integer) to authenticated;

create function pg_temp.journal_size(p_evening uuid) returns bigint language sql as $$
  select count(*) from public.evening_events where evening_id = p_evening;
$$;
grant execute on function pg_temp.journal_size(uuid) to authenticated;

create function pg_temp.players_count() returns bigint language sql security definer as $$
  select count(*) from public.players;
$$;
grant execute on function pg_temp.players_count() to authenticated;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set banker '''00000000-0000-4000-8000-00000000a002'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
\set pJ '''a0000000-0000-4000-8000-000000001001'''
\set pS '''a0000000-0000-4000-8000-000000001002'''
\set pD '''a0000000-0000-4000-8000-000000001003'''
\set pL '''a0000000-0000-4000-8000-000000001004'''
\set pM '''a0000000-0000-4000-8000-000000001005'''
\set k1 '''c2700000-0000-4000-8000-000000000001'''
\set k2 '''c2700000-0000-4000-8000-000000000002'''
\set k3 '''c2700000-0000-4000-8000-000000000003'''
\set k4 '''c2700000-0000-4000-8000-000000000004'''
\set k5 '''c2700000-0000-4000-8000-000000000005'''
\set k6 '''c2700000-0000-4000-8000-000000000006'''

-- ===========================================================================
-- 0. Форматы: шаг призовых 100 ₽ в справочнике, снимки вечеров не тронуты
-- ===========================================================================
select pg_temp.check(
  not exists (select 1 from public.formats where not (config ? 'payoutStepRub'))
  and (select (config ->> 'payoutStepRub')::int = 100 from public.formats
       where id = 'f0000000-0000-4000-8000-000000000001'),
  'formats: у всех форматов есть payoutStepRub, у клубного — 100');
select pg_temp.check(
  (select config - 'payoutStepRub' = (select format from public.evenings
                                       where id = 'e0000000-0000-4000-8000-000000000001')
   from public.formats where id = 'f0000000-0000-4000-8000-000000000001'),
  'снимок формата прошедшего вечера seed — без шага: прошлые итоги считаются до рубля');
select pg_temp.check(
  (select (format ->> 'payoutStepRub')::int = 100 from public.evenings
   where id = 'e0000000-0000-4000-8000-000000000006'),
  'анонс seed — с шагом 100 ₽, как вечер, созданный после 027');

-- Оператор 027 на старых данных: добавляет шаг только тем, у кого его нет; повтор ничего не меняет.
insert into public.formats (id, name, config) values
  ('f0000000-0000-4000-8000-0000000002a1', 'Без шага',
   '{"name": "Без шага", "buyInRub": 300, "startingChips": 1000, "rebuyUntilLevel": 3,
     "rebuyLimit": null, "payoutPct": [100],
     "levels": [{"sb": 10, "bb": 20, "trigger": {"type": "time", "minutes": 20}}]}'),
  ('f0000000-0000-4000-8000-0000000002a2', 'Шаг 50',
   '{"name": "Шаг 50", "buyInRub": 500, "startingChips": 500, "rebuyUntilLevel": 3,
     "rebuyLimit": null, "payoutPct": [100], "payoutStepRub": 50,
     "levels": [{"sb": 10, "bb": 20, "trigger": {"type": "time", "minutes": 20}}]}');
create function pg_temp.add_step() returns int language plpgsql as $$
declare
  v_n int;
begin
  update public.formats
  set config = config || '{"payoutStepRub": 100}'::jsonb
  where not (config ? 'payoutStepRub');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
select pg_temp.check(pg_temp.add_step() = 1, '027: шаг получает только формат без него');
select pg_temp.check(
  (select (config ->> 'payoutStepRub')::int from public.formats
   where id = 'f0000000-0000-4000-8000-0000000002a1') = 100
  and (select (config ->> 'payoutStepRub')::int from public.formats
       where id = 'f0000000-0000-4000-8000-0000000002a2') = 50,
  'формат без шага — 100, шаг, заданный админом, — как был');
select pg_temp.check(pg_temp.add_step() = 0, 'повторный прогон ничего не меняет');

-- ===========================================================================
-- 1. join/rebuy с суммой: хранится как пришла, старые формы — как раньше
-- ===========================================================================
select pg_temp.login(:banker);
set local role authenticated;

select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pJ))).payload
    = jsonb_build_object('playerId', :pJ),
  'стандартный вход — без суммы, как до 027');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', upper(:pD), 'rub', 700), :k1)).payload
    = jsonb_build_object('playerId', :pD, 'rub', 700),
  'вход на 700 ₽ — rub в payload, uuid в нижнем регистре');
select (ee.id) as join_d from public.evening_events ee
  where ee.evening_id = :e6 and ee.client_id = :k1 \gset
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pL, 'rub', 300.0))).payload
    = jsonb_build_object('playerId', :pL, 'rub', 300),
  'вход на 300.0 — число нормализовано до 300');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pM, 'rub', 500))).payload
    = jsonb_build_object('playerId', :pM, 'rub', 500),
  'сумма, равная входу формата, хранится как пришла (её не шлёт клиент — домен читает одинаково)');
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pS, 'stacks', 2))).payload
    = jsonb_build_object('playerId', :pS, 'stacks', 2),
  'кратность (015) принимается как раньше');

-- Повтор по ключу сверяет сумму.
select pg_temp.journal_size(:e6) as size_join \gset
select pg_temp.check(
  (public.add_event(:e6, 'join', jsonb_build_object('playerId', :pD, 'rub', 700), :k1)).id = :join_d
  and pg_temp.journal_size(:e6) = :size_join,
  'повтор с тем же ключом и той же суммой — та же запись');
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pD, 'rub', 800), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другой суммой — другое намерение');
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pD), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ без суммы — тоже другое');
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pD, 'stacks', 2), :k1),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с кратностью вместо суммы — другое');

-- ===========================================================================
-- 2. Неверная сумма — 22023, в журнал ничего не ложится
-- ===========================================================================
select pg_temp.journal_size(:e6) as size_bad \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pJ, 'rub', 0)),
  '22023', 'Сумма входа или ребая — целое число рублей от 1 до 100' || chr(160) || '000', 'сумма 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pJ, 'rub', -500)),
  '22023', 'Сумма входа или ребая', 'сумма меньше нуля');
select pg_temp.rejects(pg_temp.ev(:e6, 'rebuy', jsonb_build_object('playerId', :pJ, 'rub', 100001)),
  '22023', 'Сумма входа или ребая', 'сумма больше 100 000');
select pg_temp.rejects(pg_temp.ev(:e6, 'rebuy', jsonb_build_object('playerId', :pJ, 'rub', 700.5)),
  '22023', 'Сумма входа или ребая', 'дробная сумма');
select pg_temp.rejects(pg_temp.ev(:e6, 'rebuy', jsonb_build_object('playerId', :pJ, 'rub', '700')),
  '22023', 'Сумма входа или ребая', 'сумма строкой');
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pJ, 'rub', null)),
  '22023', 'Сумма входа или ребая', 'сумма null');
select pg_temp.rejects(pg_temp.ev(:e6, 'join', jsonb_build_object('playerId', :pJ, 'rub', 700, 'stacks', 2)),
  '22023', 'нужна сумма или кратность — что-то одно', 'сумма и кратность сразу');
select pg_temp.rejects(pg_temp.ev(:e6, 'bust', jsonb_build_object('playerId', :pJ, 'by', '[]'::jsonb, 'rub', 500)),
  '22023', 'лишнее поле «rub»', 'у вылета суммы нет');
select pg_temp.rejects(pg_temp.ev(:e6, 'payment', jsonb_build_object('playerId', :pJ, 'amountRub', 500, 'rub', 500)),
  '22023', 'лишнее поле «rub»', 'у платежа суммы входа нет');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_bad, 'отказы ничего не записали');
select pg_temp.check(
  (public.add_event(:e6, 'rebuy', jsonb_build_object('playerId', :pJ, 'rub', 100000))).payload ->> 'rub'
    = '100000',
  'предельная сумма 100 000 принимается (правило ребая — у replay, сервер его не проверяет)');

-- ===========================================================================
-- 3. add_events: вход на 700 с оплатой 700 и ребай 300 — одной транзакцией, повтор сверяет суммы
-- ===========================================================================
select pg_temp.login(:admin);
create temp table batch_rows on commit drop as
select * from public.add_events(:e6, jsonb_build_array(
  jsonb_build_object('type', 'rebuy', 'payload', jsonb_build_object('playerId', :pL, 'rub', 300)),
  jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pL, 'amountRub', 300))
), :k2);
select pg_temp.check(
  (select array_agg(payload order by id) from batch_rows)
    = array[jsonb_build_object('playerId', :pL, 'rub', 300),
            jsonb_build_object('playerId', :pL, 'amountRub', 300)],
  'add_events: ребай на 300 ₽ и платёж 300 ₽');
select pg_temp.check(
  (select bool_and(client_id = pg_temp.key(:k2::uuid, (n - 1)::int))
   from (select client_id, row_number() over (order by id) as n from batch_rows) x)
  and (select count(distinct at) = 1 from batch_rows),
  'ключи действия и одно время — как в 020');
select pg_temp.journal_size(:e6) as size_batch \gset
select pg_temp.check(
  (select count(*) = 2 from public.add_events(:e6, jsonb_build_array(
    jsonb_build_object('type', 'rebuy', 'payload', jsonb_build_object('playerId', :pL, 'rub', 300)),
    jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pL, 'amountRub', 300))
  ), :k2)) and pg_temp.journal_size(:e6) = :size_batch,
  'повтор действия тем же ключом — те же записи');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'rebuy', 'payload', jsonb_build_object('playerId', :pL, 'rub', 500)),
    jsonb_build_object('type', 'payment', 'payload', jsonb_build_object('playerId', :pL, 'amountRub', 500))
  ), :k2),
  '22023', 'Ключ повтора уже занят', 'повтор действия с другой суммой — отказ, журнал цел');
select pg_temp.rejects(format($q$select * from public.add_events(%L, %L::jsonb, %L)$q$, :e6,
  jsonb_build_array(
    jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', 'a0000000-0000-4000-8000-000000001006', 'rub', 700)),
    jsonb_build_object('type', 'join', 'payload', jsonb_build_object('playerId', :pJ, 'rub', 0))
  ), :k3),
  '22023', 'Сумма входа или ребая', 'кривая сумма во второй записи откатывает всё действие');
select pg_temp.check(pg_temp.journal_size(:e6) = :size_batch, 'после отката журнал не вырос');

-- ===========================================================================
-- 4. amend: правка суммы
-- ===========================================================================
select (ee.id) as rebuy_l from public.evening_events ee
  where ee.evening_id = :e6 and ee.client_id = :k2 \gset
select (ee.id) as join_s from public.evening_events ee
  where ee.evening_id = :e6 and ee.type = 'join' and ee.payload ->> 'playerId' = :pS \gset

select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'rub', 500))).payload
    = jsonb_build_object('eventId', :join_d, 'rub', 500),
  'правка суммы входа 700 → 500: сумма хранится и при «стандартном» значении');
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :rebuy_l, 'rub', 700.0), :k4)).payload
    = jsonb_build_object('eventId', :rebuy_l, 'rub', 700),
  'правка суммы ребая 300 → 700: 700.0 → 700');
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :join_s, 'rub', 1200))).payload
    = jsonb_build_object('eventId', :join_s, 'rub', 1200),
  'правка входа ×2 (015) суммой — принимается');
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'stacks', 2))).payload
    = jsonb_build_object('eventId', :join_d, 'stacks', 2),
  'правка кратностью (022) по-прежнему принимается — и у записи с суммой');

-- Ключ повтора правки сверяет сумму.
select pg_temp.check(
  (public.add_event(:e6, 'amend', jsonb_build_object('eventId', :rebuy_l, 'rub', 700), :k4)).payload ->> 'rub'
    = '700',
  'повтор правки с тем же ключом и суммой — та же запись');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :rebuy_l, 'rub', 800), :k4),
  '22023', 'Ключ повтора уже занят', 'тот же ключ правки с другой суммой');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :rebuy_l, 'stacks', 2), :k4),
  '22023', 'Ключ повтора уже занят', 'тот же ключ правки с кратностью вместо суммы');

-- Отказы правки.
select (public.add_event(:e6, 'bust', jsonb_build_object('playerId', :pM, 'by', jsonb_build_array(:pJ)))).id
  as bust_m \gset
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :bust_m, 'rub', 700)),
  '22023', 'у вылета исправляются выбившие, а не сумма', 'сумма у вылета');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'by', '[]'::jsonb)),
  '22023', 'у входа и ребая исправляется сумма, а не выбившие', 'выбившие у входа');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'rub', 700, 'stacks', 2)),
  '22023', 'нужно одно новое значение', 'сумма и кратность в правке сразу');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'rub', 700, 'by', '[]'::jsonb)),
  '22023', 'нужно одно новое значение', 'сумма и выбившие сразу');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_d)),
  '22023', 'нужно одно новое значение', 'правка без значения');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'rub', 0)),
  '22023', 'Сумма входа или ребая', 'правка на сумму 0');
select pg_temp.rejects(pg_temp.ev(:e6, 'amend', jsonb_build_object('eventId', :join_d, 'rub', 100001)),
  '22023', 'Сумма входа или ребая', 'правка на сумму больше предела');

-- ===========================================================================
-- 5. add_guest с суммой и оплатой, повтор по ключу сверяет сумму
-- ===========================================================================
select public.add_guest(:e6, 'Гость 700', 1, :k5, 700, 700) as guest700 \gset
select pg_temp.check(
  (select ee.payload = jsonb_build_object('playerId', :'guest700', 'rub', 700)
     and ee.client_id = :k5::uuid
   from public.evening_events ee where ee.evening_id = :e6 and ee.type = 'join'
     and ee.payload ->> 'playerId' = :'guest700'),
  'add_guest с p_rub = 700 — вход на 700 ₽, ключ — у входа');
select pg_temp.check(
  (select ee.payload = jsonb_build_object('playerId', :'guest700', 'amountRub', 700)
     and ee.client_id = pg_temp.key(:k5::uuid, 1)
   from public.evening_events ee where ee.evening_id = :e6 and ee.type = 'payment'
     and ee.payload ->> 'playerId' = :'guest700'),
  'оплата гостя — 700 ₽ тем же вызовом');
select pg_temp.players_count() as players_before \gset
select pg_temp.check(
  public.add_guest(:e6, 'гость 700', 1, :k5, 700, 700) = :'guest700'::uuid
  and pg_temp.players_count() = :players_before,
  'повтор с тем же ключом и суммой (имя без учёта регистра) — тот же гость, нового нет');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость 700', 1, %L, 700, 500)$q$, :e6, :k5),
  '22023', 'Ключ повтора уже занят', 'тот же ключ с другой суммой гостя');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость 700', 1, %L, 700)$q$, :e6, :k5),
  '22023', 'Ключ повтора уже занят', 'тот же ключ без суммы — другое намерение');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость 0', 1, %L, null, 0)$q$, :e6, :k6),
  '22023', 'Сумма входа или ребая', 'гость с суммой 0');
select pg_temp.rejects(format($q$select public.add_guest(%L, 'Гость ×2', 2, %L, null, 700)$q$, :e6, :k6),
  '22023', 'нужна сумма или кратность — что-то одно', 'гость с суммой и кратностью ×2');
select pg_temp.check(pg_temp.players_count() = :players_before,
  'неверная сумма гостя — игрок не создан');
select public.add_guest(:e6, 'Гость стандарт') as guest_std \gset
select pg_temp.check(
  (select ee.payload = jsonb_build_object('playerId', :'guest_std')
   from public.evening_events ee where ee.evening_id = :e6 and ee.type = 'join'
     and ee.payload ->> 'playerId' = :'guest_std'),
  'add_guest с двумя аргументами — стандартный вход, как раньше');

-- ===========================================================================
-- 6. Слияние гостя сохраняет сумму; права и сигнатуры
-- ===========================================================================
reset role;
select pg_temp.check(
  private.payload_replace_player(jsonb_build_object('playerId', :pJ, 'rub', 700), :pJ::uuid, :pD::uuid)
    = jsonb_build_object('playerId', :pD, 'rub', 700),
  'payload_replace_player сохраняет rub');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_guest(uuid, text, integer, uuid, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.add_guest(uuid, text, integer, uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.add_guest(uuid, text, integer, uuid, integer, integer)', 'execute'),
  'add_guest(…, p_rub): authenticated и service_role, не anon');
select pg_temp.check(
  to_regprocedure('public.add_guest(uuid, text, integer, uuid, integer)') is null
  and to_regprocedure('private.guest_by_client_id(uuid, uuid, uuid, text, integer)') is null,
  'старых сигнатур add_guest и guest_by_client_id нет — вызов с пятью аргументами не двусмыслен');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_event(uuid, text, jsonb, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.add_events(uuid, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.add_events(uuid, jsonb, uuid)', 'execute'),
  'add_event и add_events: authenticated и service_role, не anon');
select pg_temp.check(
  not has_function_privilege('authenticated', 'private.json_entry_rub(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.json_entry_rub(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.guest_by_client_id(uuid, uuid, uuid, text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'private.guest_by_client_id(uuid, uuid, uuid, text, integer, integer)', 'execute'),
  'служебные json_entry_rub и guest_by_client_id снаружи не вызвать');

rollback;
