-- 017: олл-ин на вскрытии — карты на табло.
-- Когда игроки в олл-ине вскрываются, банкир отмечает в пульте карты каждого и стол (флоп, тёрн,
-- ривер), а табло и экран вечера показывают руки, стол, шансы и ауты. Шансы считает клиент
-- (src/shared/lib/poker); на деньги, места, очки и итоги раздача не влияет — replay держит её только
-- для показа (state.showdown). Здесь — форма данных и ссылки на игроков:
-- 1) evening_events.type: два новых типа.
--    showdown       — {showdownId, hands: [{playerId, cards: [c1, c2]}], board: [...]}: полное
--                     состояние раздачи, каждая правка пишет всё заново (отмена последней записи
--                     возвращает предыдущую версию). Карты — 'As', 'Td', '9h' (ранг 2–9TJQKA,
--                     масть shdc), 2..9 рук, без повторов игроков и карт, на столе 0/3/4/5 карт,
--                     игроки — за столом этого вечера (действующий join). Жив ли игрок — правило
--                     replay: новую раздачу открывают только для тех, кто в игре, а правку
--                     открытой можно внести и после вылета.
--    showdown_close — {showdownId}: банкир закрыл раздачу (табло возвращается к таймеру).
-- 2) add_event (тело из 015) нормализует payload этих типов; ключ повтора сверяет id раздачи и
--    карты: тот же ключ с другой картой — другое намерение.
-- 3) Слияние гостя с профилем (008/010) переносит игрока и в руках олл-ина: payload_replace_player,
--    player_references, merge_players_report и merge_players знают про payload.hands.
-- board_state не меняется: он отдаёт все события, кроме платежей и отменённых, — showdown тоже, а
-- имена игроков рук уже есть в players (у каждого из них есть join этого вечера).

-- ---------------------------------------------------------------------------
-- 1. Типы событий
-- ---------------------------------------------------------------------------
alter table public.evening_events drop constraint evening_events_type_check;
alter table public.evening_events add constraint evening_events_type_check check (type in (
  'join', 'rebuy', 'bust',
  'timer_start', 'timer_pause', 'timer_resume',
  'level_next', 'level_prev', 'hand',
  'payment', 'finish',
  'showdown', 'showdown_close'));

-- ---------------------------------------------------------------------------
-- 2. Разбор карт и id раздачи
-- ---------------------------------------------------------------------------
-- Карта из payload: строка 'As', 'Td', '9h' — как isCardCode домена (регистр строгий).
create function private.json_card(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string'
     or (p_value #>> '{}') !~ '^[2-9TJQKA][shdc]$' then
    raise exception 'Олл-ин: «%» — не карта, нужна запись вида As, Td, 9h', coalesce(p_value #>> '{}', 'null')
      using errcode = '22023';
  end if;
  return p_value #>> '{}';
end;
$$;

-- id раздачи олл-ина: uuid строкой (клиент создаёт его при открытии раздачи).
create function private.json_showdown_id(p_value jsonb)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string' then
    raise exception 'Олл-ин: «showdownId» должно быть строкой с id раздачи'
      using errcode = '22023';
  end if;
  begin
    return (p_value #>> '{}')::uuid;
  exception when invalid_text_representation then
    raise exception 'Олл-ин: «%» — не id раздачи', p_value #>> '{}'
      using errcode = '22023';
  end;
end;
$$;

-- Служебные: зовёт только add_event (как json_entry_stacks в 015).
revoke execute on function private.json_card(jsonb) from public, anon, authenticated;
revoke execute on function private.json_showdown_id(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. add_event (тело из 015; новое — showdown, showdown_close и их сверка в ключе повтора)
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
  v_sid     uuid;
  v_seen    uuid[];
  v_used    text[];
  v_card    text;
  v_cardj   jsonb;
  v_cards   jsonb;
  v_hands   jsonb;
  v_board   jsonb;
  v_row     public.evening_events;
  v_timer   text;
  v_t       text;
begin
  if p_type is null or p_type not in (
       'join', 'rebuy', 'bust',
       'timer_start', 'timer_pause', 'timer_resume',
       'level_next', 'level_prev', 'hand',
       'payment', 'finish',
       'showdown', 'showdown_close') then
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
                    is distinct from lower(jsonb_path_query_array(v_payload, '$.hands[*].playerId')::text))) then
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
  'Банкир/админ: событие в журнал вечера. join/rebuy — {playerId, stacks?} (кратность 1..10, хранится при > 1); showdown — {showdownId, hands: [{playerId, cards: [2 карты]}] (2..9 игроков вечера), board: 0/3/4/5 карт}, showdown_close — {showdownId} (017). p_client_id — ключ повтора: тот же ключ вернёт уже записанное событие.';

-- ---------------------------------------------------------------------------
-- 4. Слияние гостя с профилем: игроки в руках олл-ина
-- ---------------------------------------------------------------------------
-- Упоминает ли payload события игрока: playerId, элемент by или игрок руки олл-ина. Одно правило на
-- перенос (merge_players), отчёт (merge_players_report) и проверку остатков (player_references).
create function private.payload_mentions_player(p_payload jsonb, p_player text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
           p_payload ->> 'playerId' = p_player
           or (jsonb_typeof(p_payload -> 'by') = 'array' and p_payload -> 'by' ? p_player)
           or (jsonb_typeof(p_payload -> 'hands') = 'array'
               and p_payload -> 'hands' @> jsonb_build_array(jsonb_build_object('playerId', p_player))),
           false)
$$;

revoke execute on function private.payload_mentions_player(jsonb, text) from public, anon, authenticated;

-- Тело из 008; новое — игрок в руках олл-ина (порядок рук сохраняется, остальное не трогается).
create or replace function private.payload_replace_player(p_payload jsonb, p_from uuid, p_to uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
           when p_payload ->> 'playerId' = p_from::text
             then jsonb_set(p_payload, '{playerId}', to_jsonb(p_to::text))
           else p_payload
         end
         || case
              when jsonb_typeof(p_payload -> 'by') = 'array'
                then jsonb_build_object('by', coalesce(
                  (select jsonb_agg(
                            case when x.value = to_jsonb(p_from::text) then to_jsonb(p_to::text)
                                 else x.value end
                            order by x.ord)
                   from jsonb_array_elements(p_payload -> 'by') with ordinality as x(value, ord)),
                  '[]'::jsonb))
              else '{}'::jsonb
            end
         || case
              when jsonb_typeof(p_payload -> 'hands') = 'array'
                then jsonb_build_object('hands', coalesce(
                  (select jsonb_agg(
                            case when jsonb_typeof(h.value) = 'object'
                                      and h.value ->> 'playerId' = p_from::text
                                   then jsonb_set(h.value, '{playerId}', to_jsonb(p_to::text))
                                 else h.value end
                            order by h.ord)
                   from jsonb_array_elements(p_payload -> 'hands') with ordinality as h(value, ord)),
                  '[]'::jsonb))
              else '{}'::jsonb
            end
$$;

-- Тело из 010; новое — ссылки из рук олл-ина (payload_mentions_player).
create or replace function private.player_references(p_player uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fk    record;
  v_found boolean;
  v_refs  text[] := '{}';
  v_id    text := p_player::text;
begin
  for v_fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_catalog.pg_constraint c
    cross join lateral unnest(c.conkey) as k(attnum)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and c.confrelid = 'public.players'::regclass
    order by 1, 2
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tbl, v_fk.col)
      into v_found
      using p_player;
    if v_found then
      v_refs := v_refs || (v_fk.tbl || '.' || v_fk.col);
    end if;
  end loop;

  if exists (
    select 1
    from public.evening_events ee
    where private.payload_mentions_player(ee.payload, v_id)
  ) then
    v_refs := v_refs || 'public.evening_events.payload'::text;
  end if;
  return v_refs;
end;
$$;

-- Тело из 010; новое — игроки рук олл-ина в «оба в одном журнале» и в счёте записей журнала.
create or replace function private.merge_players_report(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guest    public.players;
  v_target   public.players;
  v_g        text;
  v_t        text;
  v_blockers text[] := '{}';
  v_row      record;
  v_cat      jsonb := '{"hand": "«Рука вечера»", "bluff": "«Блеф вечера»", "badbeat": "«Бэд-бит вечера»"}';
begin
  if p_guest is null or p_target is null then
    raise exception 'Выбери гостя и Telegram-профиль'
      using errcode = '22023';
  end if;
  if p_guest = p_target then
    raise exception 'Это один и тот же игрок'
      using errcode = '22023';
  end if;

  select p.* into v_guest from public.players p where p.id = p_guest;
  if not found then
    raise exception 'Гость не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  select p.* into v_target from public.players p where p.id = p_target;
  if not found then
    raise exception 'Telegram-профиль не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  if v_guest.tg_id is not null or v_guest.auth_user_id is not null then
    raise exception '«%» входит через Telegram — привязать можно только профиль без Telegram',
      v_guest.display_name
      using errcode = '22023';
  end if;
  if v_target.tg_id is null then
    raise exception 'У «%» нет Telegram — выбери профиль, который входит через Telegram',
      v_target.display_name
      using errcode = '22023';
  end if;

  v_g := p_guest::text;
  v_t := p_target::text;

  -- Оба в действующих записях одного журнала: после слияния один человек сыграл бы за двоих
  -- (два входа, вылет от самого себя) — это не перенос, а порча вечера. Чаще всего это значит,
  -- что выбран не тот профиль: совет об этом — первым, правка журнала — только если гостя
  -- вписали по ошибке.
  for v_row in
    with refs as (
      select ee.evening_id, ee.payload ->> 'playerId' as pid
      from public.evening_events ee
      where ee.voided_at is null
        and ee.payload ? 'playerId'
      union
      select ee.evening_id, b.value
      from public.evening_events ee
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(ee.payload -> 'by') = 'array' then ee.payload -> 'by'
             else '[]'::jsonb end) as b(value)
      where ee.voided_at is null
      union
      select ee.evening_id, h.value ->> 'playerId'
      from public.evening_events ee
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(ee.payload -> 'hands') = 'array' then ee.payload -> 'hands'
             else '[]'::jsonb end) as h(value)
      where ee.voided_at is null
    )
    select e.scheduled_at
    from public.evenings e
    where exists (select 1 from refs r where r.evening_id = e.id and r.pid = v_g)
      and exists (select 1 from refs r where r.evening_id = e.id and r.pid = v_t)
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба есть в журнале вечера %s — похоже, это разные люди. Выбери другой профиль или, если гостя вписали по ошибке, отмени его записи в журнале этого вечера.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at
    from public.rsvps g
    join public.rsvps t on t.evening_id = g.evening_id and t.player_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.player_id = p_guest
      and g.status <> t.status
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба ответили на анонс вечера %s, и ответы разные.', private.club_date_text(v_row.scheduled_at));
  end loop;

  -- Прогнозы сравниваем уже с подменой гостя на профиль.
  for v_row in
    select e.scheduled_at
    from public.predictions g
    join public.predictions t on t.evening_id = g.evening_id and t.player_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.player_id = p_guest
      and ((case when g.winner_id = p_guest then p_target else g.winner_id end)
             is distinct from (case when t.winner_id = p_guest then p_target else t.winner_id end)
        or (case when g.first_out_id = p_guest then p_target else g.first_out_id end)
             is distinct from (case when t.first_out_id = p_guest then p_target else t.first_out_id end))
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба сделали прогноз на вечер %s, и прогнозы разные.', private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at, g.category
    from public.votes g
    join public.votes t
      on t.evening_id = g.evening_id and t.category = g.category and t.voter_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.voter_id = p_guest
      and (g.nominee_id is distinct from t.nominee_id
           or g.caption is distinct from t.caption
           or g.photo_path is distinct from t.photo_path)
    order by e.scheduled_at, g.category
  loop
    v_blockers := v_blockers || format(
      'Оба голосовали в номинации %s вечера %s, и голоса разные.',
      v_cat ->> v_row.category, private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at
    from public.votes v
    join public.evenings e on e.id = v.evening_id
    where (v.voter_id = p_guest and v.nominee_id = p_target)
       or (v.voter_id = p_target and v.nominee_id = p_guest)
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'В вечере %s один из них голосовал за другого — после слияния это был бы голос за себя.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  -- Фото голосов остаются в папке гостя {вечер}/{гость}/ (объекты Storage SQL не переносит).
  -- После закрытия голосования это ничего не ломает; пока оно открыто, профиль не смог бы
  -- переголосовать с этим фото (cast_vote принимает только свою папку).
  for v_row in
    select e.scheduled_at
    from public.votes v
    join public.evenings e on e.id = v.evening_id
    where v.voter_id = p_guest
      and v.photo_path is not null
      and (e.voting_closes_at is null or e.voting_closes_at > now())
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'У гостя есть фото к голосу за вечер %s, а голосование ещё идёт. Привяжи после его закрытия.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  return jsonb_build_object(
    'guest', jsonb_build_object('id', v_guest.id, 'name', v_guest.display_name),
    'target', jsonb_build_object('id', v_target.id, 'name', v_target.display_name),
    -- Сыгранные вечера: есть действующий join гостя.
    'evenings', (
      select count(distinct ee.evening_id)
      from public.evening_events ee
      where ee.type = 'join' and ee.voided_at is null and ee.payload ->> 'playerId' = v_g),
    'events', (
      select count(*)
      from public.evening_events ee
      where private.payload_mentions_player(ee.payload, v_g)),
    'votesReceived', (select count(*) from public.votes v where v.nominee_id = p_guest),
    'votesCast', (select count(*) from public.votes v where v.voter_id = p_guest),
    'predictionsAbout', (
      select count(*) from public.predictions p
      where p.winner_id = p_guest or p.first_out_id = p_guest),
    'predictionsMade', (select count(*) from public.predictions p where p.player_id = p_guest),
    'rsvps', (select count(*) from public.rsvps r where r.player_id = p_guest),
    'bankerOf', (select count(*) from public.evenings e where e.banker_id = p_guest),
    'photosKept', (
      select count(*) from public.votes v where v.voter_id = p_guest and v.photo_path is not null),
    'blockers', to_jsonb(v_blockers));
end;
$$;

-- Тело из 010; новое — перенос игрока в руках олл-ина (payload_mentions_player).
create or replace function public.merge_players(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_rows   jsonb;
  v_left   text[];
  v_g      text := p_guest::text;
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Связывать игроков может только админ'
      using errcode = '42501';
  end if;

  -- Все вечера под блокировкой — тот же порядок, что у add_event/void_event (сначала вечер):
  -- параллельная запись в журнал дождётся слияния и увидит уже перенесённые id.
  perform 1 from public.evenings e order by e.id for update;
  perform 1 from public.players p where p.id in (p_guest, p_target) order by p.id for update;

  v_report := private.merge_players_report(p_guest, p_target);
  if jsonb_array_length(v_report -> 'blockers') > 0 then
    raise exception 'Привязать профиль «%» к профилю «%» нельзя: %',
      v_report #>> '{guest,name}', v_report #>> '{target,name}',
      (select string_agg(b.value, ' ') from jsonb_array_elements_text(v_report -> 'blockers') as b(value))
      using errcode = 'P0001';
  end if;

  -- Журнал: playerId, элементы by и игроки рук олл-ина (017) — точной заменой значения;
  -- created_by / voided_by.
  -- voided_at не трогаем — триггер «правка открывает расчёт» не срабатывает: итог вечера тот же.
  update public.evening_events ee
  set payload = private.payload_replace_player(ee.payload, p_guest, p_target)
  where private.payload_mentions_player(ee.payload, v_g);
  update public.evening_events set created_by = p_target where created_by = p_guest;
  update public.evening_events set voided_by = p_target where voided_by = p_guest;

  update public.evenings set banker_id = p_target where banker_id = p_guest;
  update public.evenings set created_by = p_target where created_by = p_guest;

  -- rsvps и predictions: удалить и вставить заново, а не update — триггер updated_at переписал бы
  -- время ответа (по нему идёт порядок «кто ответил раньше»). Совпадающие строки профиля уже есть
  -- (препятствия выше гарантируют, что они равны) — on conflict do nothing.
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from public.rsvps r where r.player_id = p_guest;
  delete from public.rsvps r where r.player_id = p_guest;
  insert into public.rsvps (evening_id, player_id, status, updated_at)
  select x.evening_id, p_target, x.status, x.updated_at
  from jsonb_populate_recordset(null::public.rsvps, v_rows) as x
  on conflict (evening_id, player_id) do nothing;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_rows
  from public.predictions p
  where p.player_id = p_guest or p.winner_id = p_guest or p.first_out_id = p_guest;
  delete from public.predictions p
  where p.player_id = p_guest or p.winner_id = p_guest or p.first_out_id = p_guest;
  insert into public.predictions (evening_id, player_id, winner_id, first_out_id, updated_at)
  select x.evening_id,
         case when x.player_id = p_guest then p_target else x.player_id end,
         case when x.winner_id = p_guest then p_target else x.winner_id end,
         case when x.first_out_id = p_guest then p_target else x.first_out_id end,
         x.updated_at
  from jsonb_populate_recordset(null::public.predictions, v_rows) as x
  on conflict (evening_id, player_id) do nothing;

  -- Голоса: тем же приёмом (check voter <> nominee проверяется уже на итоговых строках).
  -- photo_path не меняется: файл остаётся в папке гостя, см. merge_players_report.
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_rows
  from public.votes v where v.voter_id = p_guest or v.nominee_id = p_guest;
  delete from public.votes v where v.voter_id = p_guest or v.nominee_id = p_guest;
  insert into public.votes (evening_id, voter_id, category, nominee_id, caption, photo_path, created_at)
  select x.evening_id,
         case when x.voter_id = p_guest then p_target else x.voter_id end,
         x.category,
         case when x.nominee_id = p_guest then p_target else x.nominee_id end,
         x.caption, x.photo_path, x.created_at
  from jsonb_populate_recordset(null::public.votes, v_rows) as x
  on conflict (evening_id, voter_id, category) do nothing;

  update public.players set is_guest = false where id = p_target;

  -- Все внешние ключи на players — on delete cascade или set null: забытая ссылка не уронила бы
  -- удаление, а тихо стёрла бы или обнулила данные гостя. Поэтому проверяем явно: осталась
  -- ссылка (новая таблица, которую не добавили в перенос выше) — отказ, всё слияние откатывается.
  v_left := private.player_references(p_guest);
  if cardinality(v_left) > 0 then
    raise exception 'Привязать профиль «%» к профилю «%» не получилось: перенос не учёл записи в %. Ничего не изменилось. Это ошибка приложения — перешли этот текст разработчику.',
      v_report #>> '{guest,name}', v_report #>> '{target,name}', array_to_string(v_left, ', ')
      using errcode = 'XX000';
  end if;
  delete from public.players where id = p_guest;

  return v_report;
end;
$$;
