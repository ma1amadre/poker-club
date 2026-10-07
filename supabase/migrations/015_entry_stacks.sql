-- 015: вход и ребай кратно стандартному.
-- Игрок может зайти не на buyInRub, а на buyInRub·k (k = 1..10): фишки startingChips·k, голова
-- этого входа bountyRub·k, в фонд (buyInRub − bountyRub)·k. Ребай — так же, со своей кратностью.
-- Деньги считает домен (replay/computeMoney) по полю payload.stacks событий join/rebuy; здесь —
-- только форма payload:
-- 1) add_event (тело из 009) принимает у join/rebuy необязательное «stacks» — целое число 1..10.
--    Нормализованная копия хранит его только при k > 1: стандартный вход выглядит так же, как
--    события до этой миграции ({playerId}), и миграция данных не нужна. Повтор по ключу сверяет и
--    кратность: тот же ключ с другой кратностью — другое намерение.
-- 2) add_guest получает p_stacks (по умолчанию 1): гостя сажают за стол сразу нужной кратностью.
--    Сигнатура меняется, поэтому drop + create и гранты заново; вызов с двумя аргументами работает.

-- ---------------------------------------------------------------------------
-- private.json_entry_stacks — кратность входа из payload
-- ---------------------------------------------------------------------------
create function private.json_entry_stacks(p_value jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then
    raise exception 'Кратность входа — целое число от 1 до 10'
      using errcode = '22023';
  end if;
  v_num := (p_value #>> '{}')::numeric;
  if v_num <> trunc(v_num) or v_num < 1 or v_num > 10 then
    raise exception 'Кратность входа — целое число от 1 до 10'
      using errcode = '22023';
  end if;
  return v_num::integer;
end;
$$;

-- Служебная: зовут только функции-определители (add_event); снаружи не нужна (как в 003).
revoke execute on function private.json_entry_stacks(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- add_event (тело из 009; новое — кратность у join/rebuy и в сверке ключа повтора)
-- ---------------------------------------------------------------------------
create or replace function public.add_event(
  p_evening   uuid,
  p_type      text,
  p_payload   jsonb default '{}'::jsonb,
  p_client_id uuid default null)
returns public.evening_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_player();
  v_ev      public.evenings;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_norm    jsonb;
  v_pid     uuid;
  v_killer  uuid;
  v_by      jsonb;
  v_elem    jsonb;
  v_num     numeric;
  v_note    text;
  v_stacks  integer;
  v_row     public.evening_events;
  v_timer   text;
  v_t       text;
begin
  if p_type is null or p_type not in (
       'join', 'rebuy', 'bust',
       'timer_start', 'timer_pause', 'timer_resume',
       'level_next', 'level_prev', 'hand',
       'payment', 'finish') then
    raise exception 'Неизвестный тип события «%»', coalesce(p_type, 'null')
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'Данные события должны быть объектом'
      using errcode = '22023';
  end if;

  -- Повтор уже записанного намерения — до проверки состояния вечера: повтор потерянного ответа
  -- на finish иначе упал бы на «игра окончена», хотя запись на самом деле прошла.
  -- Кратность сверяется так же, как игрок: нет поля — 1 (так хранится и стандартный вход).
  if p_client_id is not null then
    select ee.* into v_row
    from public.evening_events ee
    where ee.evening_id = p_evening
      and ee.client_id = p_client_id;
    if found then
      if v_row.created_by is distinct from v_me
         or v_row.type <> p_type
         or (v_row.payload ->> 'playerId') is distinct from lower(v_payload ->> 'playerId')
         or coalesce((v_row.payload ->> 'stacks')::numeric, 1) is distinct from (
              case
                when not (v_payload ? 'stacks') then 1
                when jsonb_typeof(v_payload -> 'stacks') = 'number' then (v_payload ->> 'stacks')::numeric
              end) then
        raise exception 'Ключ повтора уже занят другой записью — обнови экран'
          using errcode = '22023';
      end if;
      return v_row;
    end if;
  end if;

  v_ev := private.lock_evening_for_write(p_evening, p_type, v_me);

  -- Форма payload. Сохраняем нормализованную копию: uuid в каноническом виде, чтобы
  -- сравнение по тексту (is_participant, фильтры) не зависело от регистра клиента.
  case
    when p_type in ('join', 'rebuy') then
      perform private.check_keys(v_payload, array['playerId', 'stacks'], p_type);
      v_pid := private.json_player_id(v_payload -> 'playerId', 'playerId');
      v_norm := jsonb_build_object('playerId', v_pid);

      -- Кратность 1 не храним: стандартный вход неотличим от событий до миграции 015.
      if v_payload ? 'stacks' then
        v_stacks := private.json_entry_stacks(v_payload -> 'stacks');
        if v_stacks > 1 then
          v_norm := v_norm || jsonb_build_object('stacks', v_stacks);
        end if;
      end if;

    when p_type = 'bust' then
      perform private.check_keys(v_payload, array['playerId', 'by'], p_type);
      v_pid := private.json_player_id(v_payload -> 'playerId', 'playerId');

      if jsonb_typeof(v_payload -> 'by') is distinct from 'array' then
        raise exception 'Вылет: поле «by» должно быть списком (пустым, если выбившего нет)'
          using errcode = '22023';
      end if;
      if jsonb_array_length(v_payload -> 'by') > 10 then
        raise exception 'Вылет: в «by» больше 10 игроков'
          using errcode = '22023';
      end if;

      -- Порядок by важен: остаток от деления головы достаётся первому в списке.
      v_by := '[]'::jsonb;
      for v_elem in select x.value from jsonb_array_elements(v_payload -> 'by') as x(value) loop
        v_killer := private.json_player_id(v_elem, 'by');
        if v_killer = v_pid then
          raise exception 'Вылет: игрок не может выбить сам себя'
            using errcode = '22023';
        end if;
        if v_by @> jsonb_build_array(v_killer) then
          raise exception 'Вылет: игрок % указан в «by» дважды', v_killer
            using errcode = '22023';
        end if;
        v_by := v_by || jsonb_build_array(v_killer);
      end loop;

      v_norm := jsonb_build_object('playerId', v_pid, 'by', v_by);

    when p_type = 'payment' then
      perform private.check_keys(v_payload, array['playerId', 'amountRub', 'note'], p_type);
      v_pid := private.json_player_id(v_payload -> 'playerId', 'playerId');

      if jsonb_typeof(v_payload -> 'amountRub') is distinct from 'number' then
        raise exception 'Платёж: «amountRub» должно быть числом'
          using errcode = '22023';
      end if;
      v_num := (v_payload ->> 'amountRub')::numeric;
      if v_num <> trunc(v_num) or v_num = 0 or abs(v_num) > 1000000 then
        raise exception 'Платёж: сумма — целое число рублей, не ноль и не больше миллиона по модулю'
          using errcode = '22023';
      end if;

      v_norm := jsonb_build_object('playerId', v_pid, 'amountRub', v_num::bigint);

      if v_payload ? 'note' and jsonb_typeof(v_payload -> 'note') <> 'null' then
        if jsonb_typeof(v_payload -> 'note') <> 'string' then
          raise exception 'Платёж: «note» должно быть строкой'
            using errcode = '22023';
        end if;
        v_note := nullif(btrim(v_payload ->> 'note'), '');
        if char_length(v_note) > 200 then
          raise exception 'Платёж: комментарий длиннее 200 символов'
            using errcode = '22023';
        end if;
        if v_note is not null then
          v_norm := v_norm || jsonb_build_object('note', v_note);
        end if;
      end if;

    else
      -- timer_*, level_*, hand, finish — без данных
      if v_payload <> '{}'::jsonb then
        raise exception 'Событие «%» не принимает данных', p_type
          using errcode = '22023';
      end if;
      v_norm := '{}'::jsonb;
  end case;

  if p_type = 'finish' and v_ev.status = 'announced' then
    raise exception 'Вечер ещё не начался — завершать нечего'
      using errcode = 'P0001';
  end if;

  -- Явная пауза перед finish, если таймер идёт. Статус таймера — тот же автомат, что в replay
  -- (timer_start из not_started, pause из running, resume из paused; остальное replay отбрасывает).
  -- В live неотменённых finish нет (void_event возвращает live, только когда их не осталось),
  -- поэтому события таймера после финиша здесь не встречаются. Пауза получает тот же now(), что
  -- и finish, и меньший id — время останавливается ровно в момент завершения.
  if p_type = 'finish' and v_ev.status = 'live' then
    v_timer := 'not_started';
    for v_t in
      select ee.type
      from public.evening_events ee
      where ee.evening_id = v_ev.id
        and ee.voided_at is null
        and ee.type in ('timer_start', 'timer_pause', 'timer_resume')
      order by ee.id
    loop
      if v_t = 'timer_start' and v_timer = 'not_started' then
        v_timer := 'running';
      elsif v_t = 'timer_pause' and v_timer = 'running' then
        v_timer := 'paused';
      elsif v_t = 'timer_resume' and v_timer = 'paused' then
        v_timer := 'running';
      end if;
    end loop;

    if v_timer = 'running' then
      insert into public.evening_events (evening_id, type, payload, created_by)
      values (v_ev.id, 'timer_pause', '{}'::jsonb, v_me);
    end if;
  end if;

  insert into public.evening_events (evening_id, type, payload, created_by, client_id)
  values (v_ev.id, p_type, v_norm, v_me, p_client_id)
  returning * into v_row;

  -- Побочные эффекты статуса. Старт таймера закрывает RSVP и прогнозы (они живут, пока announced).
  if p_type = 'timer_start' and v_ev.status = 'announced' then
    update public.evenings
    set status = 'live',
        started_at = now()
    where id = v_ev.id;
  elsif p_type = 'finish' and v_ev.status = 'live' then
    update public.evenings
    set status = 'finished',
        finished_at = now(),
        voting_closes_at = now() + interval '24 hours'
    where id = v_ev.id;
  end if;

  return v_row;
end;
$$;

comment on function public.add_event(uuid, text, jsonb, uuid) is
  'Банкир/админ: событие в журнал вечера. join/rebuy — {playerId, stacks?} (кратность 1..10, хранится при > 1). p_client_id — ключ повтора: тот же ключ вернёт уже записанное событие.';

-- ---------------------------------------------------------------------------
-- add_guest (тело из 006; новое — p_stacks)
-- ---------------------------------------------------------------------------
drop function public.add_guest(uuid, text);

create function public.add_guest(p_evening uuid, p_name text, p_stacks integer default 1)
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

  -- Права и блокировка вечера до создания игрока: без прав не должно остаться «сирот» в players.
  -- (Ошибка ниже всё равно откатила бы транзакцию, но так понятнее и дешевле.)
  perform private.lock_evening_for_write(p_evening, 'join', v_me);

  insert into public.players (display_name, is_guest)
  values (v_name, true)
  returning id into v_guest;

  -- Через add_event, а не прямой insert: одна нормализация payload и одни побочные эффекты
  -- на все join. Блокировка вечера уже наша — повторный for update в той же транзакции не ждёт.
  perform public.add_event(p_evening, 'join',
    jsonb_build_object('playerId', v_guest, 'stacks', v_stacks));

  return v_guest;
end;
$$;

comment on function public.add_guest(uuid, text, integer) is
  'Банкир/админ: создать гостя (is_guest) и сразу добавить его join в вечер кратностью p_stacks (1..10). Возвращает id игрока.';

revoke execute on function public.add_guest(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.add_guest(uuid, text, integer) to authenticated, service_role;
