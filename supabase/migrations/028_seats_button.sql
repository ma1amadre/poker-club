-- 028: места за столом и баттон (решения пользователя 15.10.2026) — основа живого учёта стола; позже
-- на эти же номера мест лягут зоны камеры. Всё считает домен (replay, seats.ts); здесь — форма payload,
-- ключ повтора и пачка записей.
-- 1) evening_events.type: два новых типа.
--    seat   — {playerId, seat}: игрок садится на место seat — номер на сукне, целое 1..10 (номера растут
--             по часовой стрелке). Игрок — этого вечера (действующий вход, is_participant, как у рук
--             олл-ина). Пересадка — та же запись с новым местом. Занято ли место (другим игроком в
--             игре — отказ, вылетевшим — он место теряет) и вошёл ли игрок в турнир — правило replay.
--    button — {seat}: баттон на место seat (1..10). Сидит ли там игрок в игре — правило replay.
--             Раздача ('hand') двигает баттон по часовой к следующему игроку в игре — тоже replay;
--             тип 'hand' и его форма не меняются.
--    Рассадка — и до старта таймера (анонс): банкир сажает игроков, пока все рассаживаются. После
--    завершения вечера seat/button — P0001 (replay их всё равно не примет, а запись админа открыла бы
--    закрытый расчёт триггером 008). На деньги, очки, места в итоге, ачивки, рекорды и сезоны рассадка
--    не влияет.
-- 2) add_event (тело из 027) нормализует payload новых типов (uuid в нижнем регистре, номер места —
--    целым: 3.0 → 3); ключ повтора сверяет и номер места: тот же ключ с другим местом — 22023.
-- 3) add_events (тело из 020) принимает seat и button: «Рассадить случайно» — все места одним
--    действием, «Отменить» — void_events (020) без изменений.
-- board_state не меняется: он отдаёт все события, кроме платежей и отменённых, — seat и button тоже, а
-- имя игрока места попадает в players по payload.playerId. Слияние гостя (merge_players, merge_guests)
-- переносит игрока и в записях мест: payload_replace_player и payload_mentions_player (017) смотрят на
-- playerId любого события. Автомат статуса таймера перед finish считает только timer_* — новые типы
-- его не трогают. Новых таблиц нет; гранты функций — явно, служебные private.* — revoke у
-- public/anon/authenticated.

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
  'amend', 'time_adjust',
  'seat', 'button'));

-- ---------------------------------------------------------------------------
-- 2. Номер места из payload
-- ---------------------------------------------------------------------------
-- Тот же текст, что у домена (SEAT_ERROR): номер места — целое 1..10 (TABLE_SEATS).
create function private.json_table_seat(p_value jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then
    raise exception 'Место — целое число от 1 до 10'
      using errcode = '22023';
  end if;
  v_num := (p_value #>> '{}')::numeric;
  if v_num <> trunc(v_num) or v_num < 1 or v_num > 10 then
    raise exception 'Место — целое число от 1 до 10'
      using errcode = '22023';
  end if;
  return v_num::integer;
end;
$$;

comment on function private.json_table_seat(jsonb) is
  'Номер места на сукне (seat в payload seat и button, миграция 028): целое 1..10, иначе 22023.';

-- Служебная: зовёт только add_event.
revoke execute on function private.json_table_seat(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. add_event (тело из 027; новое — seat и button, номер места в ключе повтора, рассадка после финиша)
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
       'amend', 'time_adjust',
       'seat', 'button') then
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
  -- 027: сумма входа, ребая и правки — числом (нет поля — null).
  -- 028: номер места у seat и button — числом (нет поля — null); игрок места — как у всех, playerId.
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
         or (v_row.payload ->> 'rub')::numeric is distinct from (
              case when jsonb_typeof(v_payload -> 'rub') = 'number'
                   then (v_payload ->> 'rub')::numeric end)
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
                   then (v_payload ->> 'seconds')::numeric end)
         or (v_row.payload ->> 'seat')::numeric is distinct from (
              case when jsonb_typeof(v_payload -> 'seat') = 'number'
                   then (v_payload ->> 'seat')::numeric end) then
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
      perform private.check_keys(v_payload, array['playerId', 'stacks', 'rub'], p_type);
      v_pid := private.json_player_id(v_payload -> 'playerId', 'playerId');
      v_norm := jsonb_build_object('playerId', v_pid);

      if v_payload ? 'stacks' and v_payload ? 'rub' then
        raise exception 'Вход: нужна сумма или кратность — что-то одно'
          using errcode = '22023';
      end if;

      -- Кратность 1 не храним: стандартный вход неотличим от событий до миграции 015.
      if v_payload ? 'stacks' then
        v_stacks := private.json_entry_stacks(v_payload -> 'stacks');
        if v_stacks > 1 then
          v_norm := v_norm || jsonb_build_object('stacks', v_stacks);
        end if;
      end if;

      -- Сумма (027) хранится как пришла: равна ли она входу формата, решает клиент (стандартный вход
      -- он шлёт без неё), домен читает обе формы одинаково.
      if v_payload ? 'rub' then
        v_norm := v_norm || jsonb_build_object('rub', private.json_entry_rub(v_payload -> 'rub'));
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
      perform private.check_keys(v_payload, array['eventId', 'stacks', 'rub', 'by'], p_type);
      if (v_payload ? 'stacks')::int + (v_payload ? 'rub')::int + (v_payload ? 'by')::int <> 1 then
        raise exception 'Правка: нужно одно новое значение — сумма входа или ребая либо выбившие вылета'
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

      if v_payload ? 'by' then
        if v_target.type <> 'bust' then
          raise exception 'Правка: у входа и ребая исправляется сумма, а не выбившие'
            using errcode = '22023';
        end if;
        -- Жертва — из исходной записи (её payload уже нормализовал add_event).
        v_norm := jsonb_build_object('eventId', v_target.id,
                                     'by', private.json_bust_by(v_payload -> 'by',
                                                                (v_target.payload ->> 'playerId')::uuid));
      else
        if v_target.type = 'bust' then
          raise exception 'Правка: у вылета исправляются выбившие, а не сумма'
            using errcode = '22023';
        end if;
        -- Сумма (027) и кратность (022) хранятся и при «стандартном» значении: «700 → 500» и
        -- «×2 → ×1» — это правки, а не пустое место.
        if v_payload ? 'rub' then
          v_norm := jsonb_build_object('eventId', v_target.id,
                                       'rub', private.json_entry_rub(v_payload -> 'rub'));
        else
          v_norm := jsonb_build_object('eventId', v_target.id,
                                       'stacks', private.json_entry_stacks(v_payload -> 'stacks'));
        end if;
      end if;

    when p_type = 'seat' then
      -- Место (028): игрок этого вечера (действующий вход, как у рук олл-ина) на номер места 1..10.
      -- Занято ли место и жив ли игрок — правило replay: сервер игровых правил не проверяет.
      perform private.check_keys(v_payload, array['playerId', 'seat'], p_type);
      v_pid := private.json_player_id(v_payload -> 'playerId', 'playerId');
      if not public.is_participant(v_ev.id, v_pid) then
        raise exception 'Место: игрок % не за столом этого вечера', v_pid
          using errcode = '22023';
      end if;
      v_norm := jsonb_build_object('playerId', v_pid,
                                   'seat', private.json_table_seat(v_payload -> 'seat'));

    when p_type = 'button' then
      -- Баттон (028): номер места 1..10; сидит ли там игрок в игре — правило replay.
      perform private.check_keys(v_payload, array['seat'], p_type);
      v_norm := jsonb_build_object('seat', private.json_table_seat(v_payload -> 'seat'));

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

  -- Рассадка завершённого вечера (028): после финиша места и баттон не меняются (replay отклонит
  -- запись: «Вечер уже завершён»). Банкиру запись и так закрыта (lock_evening_for_write), а запись
  -- админа открыла бы закрытый расчёт (триггер 008) ради записи, которую журнал всё равно не примет.
  if p_type in ('seat', 'button') and v_ev.status in ('finished', 'settled') then
    raise exception 'Игра окончена — места и баттон уже не меняются'
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
  'Банкир/админ: событие в журнал вечера. join/rebuy — {playerId, stacks? | rub?}: кратность 1..10 (хранится при > 1) или сумма 1..100 000 ₽ (027, хранится как пришла), не обе сразу; showdown — {showdownId, hands: [{playerId, cards: [2 карты]}] (2..9 игроков вечера), board: 0/3/4/5 карт}, showdown_close — {showdownId} (017); timer_pause — {minutes?} (1..120), time_adjust — {seconds} (±1..3600), amend — {eventId, rub | stacks | by}: правка join/rebuy (сумма или кратность) или bust (выбившие) этого вечера на месте (022, 027); seat — {playerId, seat}: игрок этого вечера на место 1..10, button — {seat}: баттон на место 1..10 (028; после завершения вечера — P0001). p_client_id — ключ повтора: тот же ключ вернёт уже записанное событие.';

-- Сигнатура add_event не меняется — гранты из 007 в силе; повторяем явно (правило «Гранты»).
revoke execute on function public.add_event(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_event(uuid, text, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. add_events (тело из 020; новое — seat и button в одном действии)
-- ---------------------------------------------------------------------------
create or replace function public.add_events(
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
    if v_type is null or v_type not in ('join', 'rebuy', 'bust', 'payment', 'seat', 'button') then
      raise exception 'Одним действием пишутся только входы, ребаи, вылеты и платежи, места и баттон, а не «%»',
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
  'Банкир/админ: несколько записей журнала одним действием и одной транзакцией (020) — [{type, payload}], только join/rebuy/bust/payment/seat/button, 1..50; payload — как у add_event (у join/rebuy — и сумма rub, 027; места и баттон — 028: «Рассадить случайно» одним действием). p_client_id — ключ повтора действия: у i-й записи derived_client_id(p_client_id, i); повтор вернёт уже записанные события.';

revoke execute on function public.add_events(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_events(uuid, jsonb, uuid) to authenticated, service_role;
