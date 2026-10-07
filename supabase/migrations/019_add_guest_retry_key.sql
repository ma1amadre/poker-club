-- 019: ключ повтора у add_guest (аудит 07.10.2026, «Гости-дубли»).
-- «Добавить гостя» создаёт игрока и сразу сажает его за стол. Если ответ сервера потерялся (связь в
-- квартире, тайм-аут клиента) и банкир нажал ещё раз, появлялся второй гость со вторым входом —
-- взнос и фонд удваивались. Теперь add_guest, как add_event (миграция 007), принимает p_client_id —
-- ключ повтора, один на намерение банкира («этот гость с этой кратностью»):
-- 1) Ключ уже есть в журнале этого вечера — вернуть id гостя той записи, ничего не создавая. Сверка
--    намерения: запись — join того же автора, той же кратности, игрок — гость с тем же именем (без
--    учёта регистра); иначе 22023 «Ключ повтора уже занят другой записью — обнови экран» (текст как
--    у add_event).
-- 2) Сверка — до блокировки вечера (повтор потерянного ответа не должен падать на проверке состояния)
--    и ещё раз после неё: повтор, пришедший, пока первая попытка держала блокировку, после неё видит
--    уже записанного гостя и возвращает его, а не создаёт второго.
-- 3) Ключ уходит в join гостя (add_event с p_client_id): уникальность (evening_id, client_id) из 007
--    страхует от дубля и без этих проверок.
-- Без ключа (старый клиент) — как раньше. Сигнатура (uuid, text, integer) заменяется на
-- (uuid, text, integer, uuid): вызовы с двумя и тремя аргументами работают через умолчания.
-- Новых таблиц нет; гранты функции — явно, как у прежней сигнатуры (015).

-- Гость по ключу повтора: id игрока из уже записанного join или null, если ключа в журнале нет.
create function private.guest_by_client_id(
  p_evening   uuid,
  p_client_id uuid,
  p_me        uuid,
  p_name      text,
  p_stacks    integer)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row   public.evening_events;
  v_guest public.players;
begin
  select ee.* into v_row
  from public.evening_events ee
  where ee.evening_id = p_evening
    and ee.client_id = p_client_id;
  if not found then
    return null;
  end if;

  select p.* into v_guest
  from public.players p
  where p.id::text = v_row.payload ->> 'playerId';

  if v_row.type <> 'join'
     or v_row.created_by is distinct from p_me
     or coalesce((v_row.payload ->> 'stacks')::numeric, 1) is distinct from p_stacks
     or v_guest.id is null
     or not v_guest.is_guest
     or lower(v_guest.display_name) is distinct from lower(p_name) then
    raise exception 'Ключ повтора уже занят другой записью — обнови экран'
      using errcode = '22023';
  end if;
  return v_guest.id;
end;
$$;

-- Служебная: зовёт только add_guest.
revoke execute on function private.guest_by_client_id(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- add_guest (тело из 015; новое — p_client_id)
-- ---------------------------------------------------------------------------
drop function public.add_guest(uuid, text, integer);

create function public.add_guest(
  p_evening   uuid,
  p_name      text,
  p_stacks    integer default 1,
  p_client_id uuid    default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_player();
  -- Пробелы схлопываются так же, как в set_my_name.
  v_name   text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_stacks integer := coalesce(p_stacks, 1);
  v_guest  uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Имя гостя — от 1 до 40 символов'
      using errcode = '22023';
  end if;
  -- До создания игрока: с неверной кратностью гость не должен появиться в players.
  if v_stacks < 1 or v_stacks > 10 then
    raise exception 'Кратность входа — целое число от 1 до 10'
      using errcode = '22023';
  end if;

  -- Повтор уже записанного намерения — до проверки прав и состояния вечера (как в add_event).
  if p_client_id is not null then
    v_guest := private.guest_by_client_id(p_evening, p_client_id, v_me, v_name, v_stacks);
    if v_guest is not null then
      return v_guest;
    end if;
  end if;

  -- Права и блокировка вечера до создания игрока: без прав не должно остаться «сирот» в players.
  perform private.lock_evening_for_write(p_evening, 'join', v_me);

  -- Повтор мог прийти, пока первая попытка держала блокировку: после неё гость уже записан.
  if p_client_id is not null then
    v_guest := private.guest_by_client_id(p_evening, p_client_id, v_me, v_name, v_stacks);
    if v_guest is not null then
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

  return v_guest;
end;
$$;

comment on function public.add_guest(uuid, text, integer, uuid) is
  'Банкир/админ: создать гостя (is_guest) и сразу добавить его join в вечер кратностью p_stacks (1..10). p_client_id — ключ повтора: тот же ключ вернёт уже посаженного гостя (019). Возвращает id игрока.';

revoke execute on function public.add_guest(uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.add_guest(uuid, text, integer, uuid) to authenticated, service_role;
