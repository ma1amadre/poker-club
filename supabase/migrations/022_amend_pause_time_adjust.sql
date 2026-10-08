-- 022: правка записи на месте, пауза на N минут и поправка остатка уровня.
-- Всё считает домен (replay); здесь — форма payload, ссылка правки на исходную запись и ключ повтора.
-- 1) evening_events.type: два новых типа.
--    amend       — {eventId, stacks} | {eventId, by}: правка более ранней записи этого вечера. У входа и
--                  ребая — кратность (1..10, хранится и 1: правка «×2 → ×1» должна быть видна), у вылета —
--                  выбившие (как by у bust: не больше 10, без повторов, без самой жертвы; порядок
--                  сохраняется). Исправляемая запись — этого вечера, не отменена, типа join/rebuy/bust;
--                  иначе 22023 (запись отменена — P0001). Replay применяет правку В ПОЗИЦИИ исходной
--                  записи (порядок мест, ребаи и уровни после неё не сдвигаются), проверяет её теми же
--                  правилами, что исходную, и держит в силе последнюю принятую правку записи; отмена
--                  правки (void_event) возвращает прежнее значение. Права — как у всех записей: банкир
--                  вечера или админ, после завершения — только админ (lock_evening_for_write).
--    time_adjust — {seconds}: прибавить к остатку текущего уровня (минус — убавить), целое, не 0, по
--                  модулю до 3600. Границы (уровень по времени, не последний, остаток после поправки
--                  > 0 и не больше длины уровня) — правило replay: серверу неизвестно «сейчас» таймера.
-- 2) timer_pause принимает необязательное {minutes} — длительность перерыва (целое 1..120). Нет поля —
--    пауза без срока, как все паузы до 022 (данные не мигрируются). Таймер сам не продолжает: по
--    истечении экраны только зовут продолжить, «Продолжить игру» — по-прежнему timer_resume банкира.
-- 3) Ключ повтора сверяет и новые поля: id исправляемой записи, выбивших правки, минуты паузы,
--    секунды поправки — то же намерение с другим значением под старым ключом — 22023.
-- 4) Разбор by вынесен в private.json_bust_by (общий у bust и amend, тексты отказов прежние).
-- board_state не меняется: правки и поправки времени уходят на табло как все события (кроме платежей
-- и отменённых). Слияние гостя (merge_players) переносит игрока и в by правки: payload_replace_player
-- и payload_mentions_player (017) смотрят на by любого события.

-- ---------------------------------------------------------------------------
-- 1. Типы событий
-- ---------------------------------------------------------------------------
alter table public.evening_events drop constraint evening_events_type_check;
alter table public.evening_events add constraint evening_events_type_check check (type in (
  'join', 'rebuy', 'bust',
  'timer_start', 'timer_pause', 'timer_resume',
  'level_next', 'level_prev', 'hand',
  'payment', 'finish',
  'showdown', 'showdown_close',
  'amend', 'time_adjust'));

-- ---------------------------------------------------------------------------
-- 2. Разбор id записи и списка выбивших
-- ---------------------------------------------------------------------------
-- id записи журнала из payload правки: целое положительное число (как EveningEvent.id домена).
create function private.json_event_id(p_value jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then
    raise exception 'Правка: «eventId» должно быть номером записи журнала'
      using errcode = '22023';
  end if;
  v_num := (p_value #>> '{}')::numeric;
  if v_num <> trunc(v_num) or v_num < 1 or v_num > 9223372036854775807 then
    raise exception 'Правка: «%» — не номер записи журнала', p_value #>> '{}'
      using errcode = '22023';
  end if;
  return v_num::bigint;
end;
$$;

-- Выбившие у вылета (bust) и у правки вылета (amend): список id игроков, не больше 10, без повторов и
-- без самой жертвы; порядок сохраняется. Нормализованная копия — uuid в каноническом виде.
create function private.json_bust_by(p_value jsonb, p_victim uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_by     jsonb := '[]'::jsonb;
  v_elem   jsonb;
  v_killer uuid;
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    raise exception 'Вылет: поле «by» должно быть списком (пустым, если выбившего нет)'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_value) > 10 then
    raise exception 'Вылет: в «by» больше 10 игроков'
      using errcode = '22023';
  end if;
  for v_elem in select x.value from jsonb_array_elements(p_value) as x(value) loop
    v_killer := private.json_player_id(v_elem, 'by');
    if v_killer = p_victim then
      raise exception 'Вылет: игрок не может выбить сам себя'
        using errcode = '22023';
    end if;
    if v_by @> jsonb_build_array(v_killer) then
      raise exception 'Вылет: игрок % указан в «by» дважды', v_killer
        using errcode = '22023';
    end if;
    v_by := v_by || jsonb_build_array(v_killer);
  end loop;
  return v_by;
end;
$$;

-- Служебные: зовёт только add_event (как json_entry_stacks в 015, json_card в 017).
revoke execute on function private.json_event_id(jsonb) from public, anon, authenticated;
revoke execute on function private.json_bust_by(jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. add_event (тело из 017; новое — amend, time_adjust, минуты паузы, их сверка в ключе повтора)
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
  v_elem    jsonb;
  v_num     numeric;
  v_note    text;
  v_stacks  integer;
  v_sid     uuid;
  v_seen    uuid[];
  v_used    text[];
  v_card    text;
  v_cardj   jsonb;
  v_cards   jsonb;
  v_hands   jsonb;
  v_board   jsonb;
  v_row     public.evening_events;
  v_target  public.evening_events;
  v_timer   text;
  v_t       text;
begin
  if p_type is null or p_type not in (
       'join', 'rebuy', 'bust',
       'timer_start', 'timer_pause', 'timer_resume',
       'level_next', 'level_prev', 'hand',
       'payment', 'finish',
       'showdown', 'showdown_close',
       'amend', 'time_adjust') then
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
  -- Олл-ин (017) — id раздачи, у showdown ещё и карты рук и стола: правка карты — другое намерение.
  -- 022: id исправляемой записи, выбившие правки, минуты паузы и секунды поправки — числа сверяются
  -- как числа (нет поля — null), выбившие правки — списком в нижнем регистре (как руки олл-ина).
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
              end)
         or (v_row.payload ->> 'showdownId') is distinct from lower(v_payload ->> 'showdownId')
         or (v_row.type = 'showdown' and (
               (v_row.payload -> 'board') is distinct from (v_payload -> 'board')
               or jsonb_path_query_array(v_row.payload, '$.hands[*].cards')
                    is distinct from jsonb_path_query_array(v_payload, '$.hands[*].cards')
               or lower(jsonb_path_query_array(v_row.payload, '$.hands[*].playerId')::text)
                    is distinct from lower(jsonb_path_query_array(v_payload, '$.hands[*].playerId')::text)))
         or (v_row.payload ->> 'eventId')::numeric is distinct from (
              case when jsonb_typeof(v_payload -> 'eventId') = 'number'
                   then (v_payload ->> 'eventId')::numeric end)
         or (v_row.type = 'amend'
             and lower((v_row.payload -> 'by')::text) is distinct from lower((v_payload -> 'by')::text))
         or (v_row.payload ->> 'minutes')::numeric is distinct from (
              case when jsonb_typeof(v_payload -> 'minutes') = 'number'
                   then (v_payload ->> 'minutes')::numeric end)
         or (v_row.payload ->> 'seconds')::numeric is distinct from (
              case when jsonb_typeof(v_payload -> 'seconds') = 'number'
                   then (v_payload ->> 'seconds')::numeric end) then
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
      v_norm := jsonb_build_object('playerId', v_pid, 'by', private.json_bust_by(v_payload -> 'by', v_pid));

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

    when p_type = 'showdown' then
      -- Олл-ин: полное состояние раздачи. Форма — как readShowdown домена; жив ли игрок, здесь не
      -- проверяется (правило replay: правку открытой раздачи вносят и после вылета).
      perform private.check_keys(v_payload, array['showdownId', 'hands', 'board'], p_type);
      v_sid := private.json_showdown_id(v_payload -> 'showdownId');

      if jsonb_typeof(v_payload -> 'hands') is distinct from 'array' then
        raise exception 'Олл-ин: «hands» должно быть списком рук'
          using errcode = '22023';
      end if;
      if jsonb_array_length(v_payload -> 'hands') not between 2 and 9 then
        raise exception 'Олл-ин: игроков — от 2 до 9'
          using errcode = '22023';
      end if;

      v_hands := '[]'::jsonb;
      v_seen := '{}';
      v_used := '{}';
      for v_elem in select x.value from jsonb_array_elements(v_payload -> 'hands') as x(value) loop
        if jsonb_typeof(v_elem) is distinct from 'object' then
          raise exception 'Олл-ин: рука — объект {playerId, cards}'
            using errcode = '22023';
        end if;
        perform private.check_keys(v_elem, array['playerId', 'cards'], p_type);
        v_pid := private.json_player_id(v_elem -> 'playerId', 'playerId');
        if v_pid = any (v_seen) then
          raise exception 'Олл-ин: игрок % указан дважды', v_pid
            using errcode = '22023';
        end if;
        -- За столом этого вечера — действующий вход (is_participant).
        if not public.is_participant(v_ev.id, v_pid) then
          raise exception 'Олл-ин: игрок % не за столом этого вечера', v_pid
            using errcode = '22023';
        end if;
        v_seen := v_seen || v_pid;

        if jsonb_typeof(v_elem -> 'cards') is distinct from 'array'
           or jsonb_array_length(v_elem -> 'cards') <> 2 then
          raise exception 'Олл-ин: у каждого игрока — две карты'
            using errcode = '22023';
        end if;
        v_cards := '[]'::jsonb;
        for v_cardj in select c.value from jsonb_array_elements(v_elem -> 'cards') as c(value) loop
          v_card := private.json_card(v_cardj);
          if v_card = any (v_used) then
            raise exception 'Олл-ин: карта % указана дважды', v_card
              using errcode = '22023';
          end if;
          v_used := v_used || v_card;
          v_cards := v_cards || to_jsonb(v_card);
        end loop;
        v_hands := v_hands || jsonb_build_array(jsonb_build_object('playerId', v_pid, 'cards', v_cards));
      end loop;

      if jsonb_typeof(v_payload -> 'board') is distinct from 'array'
         or jsonb_array_length(v_payload -> 'board') not in (0, 3, 4, 5) then
        raise exception 'Олл-ин: на столе 0, 3, 4 или 5 карт'
          using errcode = '22023';
      end if;
      v_board := '[]'::jsonb;
      for v_cardj in select c.value from jsonb_array_elements(v_payload -> 'board') as c(value) loop
        v_card := private.json_card(v_cardj);
        if v_card = any (v_used) then
          raise exception 'Олл-ин: карта % указана дважды', v_card
            using errcode = '22023';
        end if;
        v_used := v_used || v_card;
        v_board := v_board || to_jsonb(v_card);
      end loop;

      v_norm := jsonb_build_object('showdownId', v_sid, 'hands', v_hands, 'board', v_board);

    when p_type = 'showdown_close' then
      perform private.check_keys(v_payload, array['showdownId'], p_type);
      v_norm := jsonb_build_object('showdownId', private.json_showdown_id(v_payload -> 'showdownId'));

    when p_type = 'timer_pause' then
      -- Пауза без срока — {} (как до 022); с длительностью — {minutes}.
      perform private.check_keys(v_payload, array['minutes'], p_type);
      v_norm := '{}'::jsonb;
      if v_payload ? 'minutes' then
        if jsonb_typeof(v_payload -> 'minutes') is distinct from 'number' then
          raise exception 'Пауза: длительность — целое число минут от 1 до 120'
            using errcode = '22023';
        end if;
        v_num := (v_payload ->> 'minutes')::numeric;
        if v_num <> trunc(v_num) or v_num < 1 or v_num > 120 then
          raise exception 'Пауза: длительность — целое число минут от 1 до 120'
            using errcode = '22023';
        end if;
        v_norm := jsonb_build_object('minutes', v_num::integer);
      end if;

    when p_type = 'time_adjust' then
      perform private.check_keys(v_payload, array['seconds'], p_type);
      if jsonb_typeof(v_payload -> 'seconds') is distinct from 'number' then
        raise exception 'Поправка времени — целое число секунд, не ноль и не больше 3600 по модулю'
          using errcode = '22023';
      end if;
      v_num := (v_payload ->> 'seconds')::numeric;
      if v_num <> trunc(v_num) or v_num = 0 or abs(v_num) > 3600 then
        raise exception 'Поправка времени — целое число секунд, не ноль и не больше 3600 по модулю'
          using errcode = '22023';
      end if;
      v_norm := jsonb_build_object('seconds', v_num::integer);

    when p_type = 'amend' then
      -- Правка записи на месте: ровно одно новое значение и ссылка на исправляемую запись.
      perform private.check_keys(v_payload, array['eventId', 'stacks', 'by'], p_type);
      if (v_payload ? 'stacks') = (v_payload ? 'by') then
        raise exception 'Правка: нужно одно новое значение — кратность входа или ребая либо выбившие вылета'
          using errcode = '22023';
      end if;

      select ee.* into v_target
      from public.evening_events ee
      where ee.id = private.json_event_id(v_payload -> 'eventId')
        and ee.evening_id = v_ev.id;
      if not found then
        raise exception 'Правка: записи № % нет в журнале этого вечера', v_payload ->> 'eventId'
          using errcode = '22023';
      end if;
      if v_target.voided_at is not null then
        raise exception 'Правка: запись отменена — исправлять нечего'
          using errcode = 'P0001';
      end if;
      if v_target.type not in ('join', 'rebuy', 'bust') then
        raise exception 'Правка: исправить можно только вход, ребай или вылет'
          using errcode = '22023';
      end if;

      if v_payload ? 'stacks' then
        if v_target.type = 'bust' then
          raise exception 'Правка: у вылета исправляются выбившие, а не кратность'
            using errcode = '22023';
        end if;
        -- Кратность хранится и при 1: «×2 → ×1» — это правка, а не пустое место.
        v_norm := jsonb_build_object('eventId', v_target.id,
                                     'stacks', private.json_entry_stacks(v_payload -> 'stacks'));
      else
        if v_target.type <> 'bust' then
          raise exception 'Правка: у входа и ребая исправляется кратность, а не выбившие'
            using errcode = '22023';
        end if;
        -- Жертва — из исходной записи (её payload уже нормализовал add_event).
        v_norm := jsonb_build_object('eventId', v_target.id,
                                     'by', private.json_bust_by(v_payload -> 'by',
                                                                (v_target.payload ->> 'playerId')::uuid));
      end if;

    else
      -- timer_start, timer_resume, level_*, hand, finish — без данных
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
  -- и finish, и меньший id — время останавливается ровно в момент завершения. Минуты паузы (022)
  -- статус не меняют; служебная пауза — без срока.
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
  'Банкир/админ: событие в журнал вечера. join/rebuy — {playerId, stacks?} (кратность 1..10, хранится при > 1); showdown — {showdownId, hands: [{playerId, cards: [2 карты]}] (2..9 игроков вечера), board: 0/3/4/5 карт}, showdown_close — {showdownId} (017); timer_pause — {minutes?} (1..120), time_adjust — {seconds} (±1..3600), amend — {eventId, stacks | by}: правка join/rebuy/bust этого вечера на месте (022). p_client_id — ключ повтора: тот же ключ вернёт уже записанное событие.';
