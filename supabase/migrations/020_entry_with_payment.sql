-- 020: несколько записей журнала одним действием (аудит 07.10.2026, «Быстрые победы», п. 6).
-- 1) «Вылет и ребай ×k» — одной кнопкой в шторке вылета; «Оплачено сразу» в шторках посадки и ребая —
--    вместе со входом или ребаем пишется платёж банкиру на сумму взноса. Записи одного действия
--    должны лечь в журнал вместе или не лечь вовсе: вылет без ребая или ребай без оплаты, оставшиеся
--    после обрыва связи, — это деньги, которые банкиру придётся искать руками.
--    public.add_events(p_evening, p_events, p_client_id) — пачка событий в одной транзакции через
--    add_event (одна нормализация payload, одни права, одни побочные эффекты). Только входы, ребаи,
--    вылеты и платежи (то, что пульт пишет вместе), 1..50 записей. Ключ повтора — один на действие:
--    у первой записи — сам p_client_id, у i-й (с 1) — private.derived_client_id(p_client_id, i).
--    Повтор тем же ключом возвращает уже записанные события (add_event сверяет намерение каждого).
-- 2) Отмена такого действия — тоже одним вызовом: public.void_events(p_events) — отмена нескольких
--    записей одного вечера в одной транзакции через void_event (тост «Отменить» после «Вылет и
--    ребай» и отмена входа вместе с его оплатой).
-- 3) add_guest с оплатой: p_paid_rub — сумму считает домен на клиенте (prepaidPayment), сервер
--    пишет платёж гостя тем же вызовом (ключ — derived_client_id(p_client_id, 1)). Повтор тем же
--    ключом сверяет и оплату: была ли она и на ту же ли сумму. Сигнатура (uuid, text, integer, uuid)
--    заменяется на (uuid, text, integer, uuid, integer): вызовы с 2–4 аргументами работают.
-- Правила игры (жив ли игрок, открыты ли ребаи) сервер, как и раньше, не проверяет — это replay;
-- клиент проверяет цепочку доменной canApplySequence. Новых таблиц нет; гранты функций — явно.

-- ---------------------------------------------------------------------------
-- 1. Ключ повтора i-й записи действия
-- ---------------------------------------------------------------------------
-- Детерминированный uuid из ключа действия и номера записи: повтор действия даёт те же ключи.
-- md5 — не для секретности: ключ повтора — случайный uuid клиента, здесь нужно только разнести номера.
create function private.derived_client_id(p_client_id uuid, p_n integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_client_id is null then null
    when p_n = 0 then p_client_id
    else md5(p_client_id::text || ':' || p_n::text)::uuid
  end
$$;

comment on function private.derived_client_id(uuid, integer) is
  'Ключ повтора n-й записи одного действия (020): n = 0 — сам ключ, дальше — md5(ключ:n) как uuid.';

revoke execute on function private.derived_client_id(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. add_events — пачка записей одной транзакцией
-- ---------------------------------------------------------------------------
create function public.add_events(
  p_evening   uuid,
  p_events    jsonb,
  p_client_id uuid default null)
returns setof public.evening_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_elem  jsonb;
  v_type  text;
  v_extra text;
  v_i     integer := 0;
begin
  perform private.require_player();

  if jsonb_typeof(p_events) is distinct from 'array'
     or jsonb_array_length(p_events) not between 1 and 50 then
    raise exception 'Записей в одном действии — от 1 до 50'
      using errcode = '22023';
  end if;

  -- Форма всей пачки — до первой записи: кривой хвост не должен оставить начало даже на время.
  for v_elem in select x.value from jsonb_array_elements(p_events) as x(value) loop
    if jsonb_typeof(v_elem) is distinct from 'object' then
      raise exception 'Запись действия — объект {type, payload}'
        using errcode = '22023';
    end if;
    select k into v_extra
    from jsonb_object_keys(v_elem) as k
    where k not in ('type', 'payload')
    limit 1;
    if v_extra is not null then
      raise exception 'Запись действия: лишнее поле «%»', v_extra
        using errcode = '22023';
    end if;
    v_type := v_elem ->> 'type';
    if v_type is null or v_type not in ('join', 'rebuy', 'bust', 'payment') then
      raise exception 'Одним действием пишутся только входы, ребаи, вылеты и платежи, а не «%»',
        coalesce(v_type, 'null')
        using errcode = '22023';
    end if;
  end loop;

  -- Через add_event: права, блокировка вечера (повторный for update в той же транзакции не ждёт),
  -- нормализация и сверка ключа повтора — одни на все пути записи. Ошибка любой записи откатывает
  -- всё действие.
  for v_elem in select x.value from jsonb_array_elements(p_events) as x(value) loop
    return next public.add_event(
      p_evening,
      v_elem ->> 'type',
      coalesce(v_elem -> 'payload', '{}'::jsonb),
      private.derived_client_id(p_client_id, v_i));
    v_i := v_i + 1;
  end loop;
end;
$$;

comment on function public.add_events(uuid, jsonb, uuid) is
  'Банкир/админ: несколько записей журнала одним действием и одной транзакцией (020) — [{type, payload}], только join/rebuy/bust/payment, 1..50. p_client_id — ключ повтора действия: у i-й записи derived_client_id(p_client_id, i); повтор вернёт уже записанные события.';

revoke execute on function public.add_events(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_events(uuid, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. void_events — отмена нескольких записей одного вечера одной транзакцией
-- ---------------------------------------------------------------------------
create function public.void_events(p_events bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform private.require_player();

  if p_events is null
     or cardinality(p_events) not between 1 and 50
     or array_position(p_events, null) is not null then
    raise exception 'Записей в одной отмене — от 1 до 50'
      using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_events) as x) <> cardinality(p_events) then
    raise exception 'Запись указана в отмене дважды'
      using errcode = '22023';
  end if;
  -- Все записи — одного вечера (несуществующие отклонит void_event).
  if (select count(distinct ee.evening_id)
      from public.evening_events ee
      where ee.id = any (p_events)) > 1 then
    raise exception 'Одной отменой — записи только одного вечера'
      using errcode = '22023';
  end if;

  -- Через void_event: права, блокировка и возврат вечера в игру при отмене finish — как у одной
  -- записи. Любой отказ (уже отменена, нет прав) откатывает всю отмену.
  foreach v_id in array p_events loop
    perform public.void_event(v_id);
  end loop;
end;
$$;

comment on function public.void_events(bigint[]) is
  'Банкир/админ: отменить несколько записей одного вечера одной транзакцией (020), в порядке списка; правила — как у void_event.';

revoke execute on function public.void_events(bigint[]) from public, anon, authenticated;
grant execute on function public.void_events(bigint[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. add_guest с оплатой (тело из 019; новое — p_paid_rub)
-- ---------------------------------------------------------------------------
-- Повтор add_guest тем же ключом: оплата должна совпасть с первой попыткой — была ли она, того же
-- ли гостя и на ту же ли сумму. Иначе это другое намерение (переключатель «Оплачено сразу» меняли
-- между попытками, а клиент держит ключ по намерению с оплатой) — 22023, как у add_event.
create function private.check_guest_payment(
  p_evening  uuid,
  p_pay_key  uuid,
  p_guest    uuid,
  p_paid_rub integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row   public.evening_events;
  v_found boolean;
begin
  select ee.* into v_row
  from public.evening_events ee
  where ee.evening_id = p_evening
    and ee.client_id = p_pay_key;
  v_found := found;

  if v_found is distinct from (p_paid_rub is not null)
     or (v_found and (
           v_row.type <> 'payment'
           or (v_row.payload ->> 'playerId') is distinct from p_guest::text
           or (v_row.payload ->> 'amountRub')::numeric is distinct from p_paid_rub)) then
    raise exception 'Ключ повтора уже занят другой записью — обнови экран'
      using errcode = '22023';
  end if;
end;
$$;

-- Служебная: зовёт только add_guest.
revoke execute on function private.check_guest_payment(uuid, uuid, uuid, integer)
  from public, anon, authenticated;

drop function public.add_guest(uuid, text, integer, uuid);

create function public.add_guest(
  p_evening   uuid,
  p_name      text,
  p_stacks    integer default 1,
  p_client_id uuid    default null,
  p_paid_rub  integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_player();
  -- Пробелы схлопываются так же, как в set_my_name.
  v_name    text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_stacks  integer := coalesce(p_stacks, 1);
  v_guest   uuid;
  v_pay_key uuid := private.derived_client_id(p_client_id, 1);
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Имя гостя — от 1 до 40 символов'
      using errcode = '22023';
  end if;
  -- До создания игрока: с неверной кратностью или суммой гость не должен появиться в players.
  if v_stacks < 1 or v_stacks > 10 then
    raise exception 'Кратность входа — целое число от 1 до 10'
      using errcode = '22023';
  end if;
  if p_paid_rub is not null and (p_paid_rub < 1 or p_paid_rub > 1000000) then
    raise exception 'Оплата гостя — целое число рублей от 1 до миллиона'
      using errcode = '22023';
  end if;

  -- Повтор уже записанного намерения — до проверки прав и состояния вечера (как в add_event).
  if p_client_id is not null then
    v_guest := private.guest_by_client_id(p_evening, p_client_id, v_me, v_name, v_stacks);
    if v_guest is not null then
      perform private.check_guest_payment(p_evening, v_pay_key, v_guest, p_paid_rub);
      return v_guest;
    end if;
  end if;

  -- Права и блокировка вечера до создания игрока: без прав не должно остаться «сирот» в players.
  perform private.lock_evening_for_write(p_evening, 'join', v_me);

  -- Повтор мог прийти, пока первая попытка держала блокировку: после неё гость уже записан.
  if p_client_id is not null then
    v_guest := private.guest_by_client_id(p_evening, p_client_id, v_me, v_name, v_stacks);
    if v_guest is not null then
      perform private.check_guest_payment(p_evening, v_pay_key, v_guest, p_paid_rub);
      return v_guest;
    end if;
  end if;

  insert into public.players (display_name, is_guest)
  values (v_name, true)
  returning id into v_guest;

  -- Через add_event, а не прямой insert: одна нормализация payload и одни побочные эффекты
  -- на все join. Блокировка вечера уже наша — повторный for update в той же транзакции не ждёт.
  -- Ключ повтора — у join гостя: по нему повтор и находит гостя.
  perform public.add_event(p_evening, 'join',
    jsonb_build_object('playerId', v_guest, 'stacks', v_stacks), p_client_id);

  -- «Оплачено сразу»: платёж гостя тем же вызовом — обычный платёж журнала.
  if p_paid_rub is not null then
    perform public.add_event(p_evening, 'payment',
      jsonb_build_object('playerId', v_guest, 'amountRub', p_paid_rub), v_pay_key);
  end if;

  return v_guest;
end;
$$;

comment on function public.add_guest(uuid, text, integer, uuid, integer) is
  'Банкир/админ: создать гостя (is_guest) и сразу добавить его join в вечер кратностью p_stacks (1..10). p_client_id — ключ повтора: тот же ключ вернёт уже посаженного гостя (019). p_paid_rub — «Оплачено сразу»: платёж гостя на эту сумму тем же вызовом (020). Возвращает id игрока.';

revoke execute on function public.add_guest(uuid, text, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.add_guest(uuid, text, integer, uuid, integer) to authenticated, service_role;
