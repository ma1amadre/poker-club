-- 003_rpc.sql — RPC: единственный путь записи в журнал вечера, RSVP, прогнозы и голоса.
--
-- Все функции security definer с пустым search_path: внутри только полностью квалифицированные
-- имена, иначе пользователь мог бы подложить свои объекты в search_path.
-- БД проверяет права и форму данных. Покерные правила (ребай только вылетевшему, finish при одном
-- живом и т. п.) проверяет домен на клиенте через canApply, а replay сам пропускает ошибочные
-- события — дублировать правила в SQL значит держать два источника правды.
--
-- Коды ошибок (error.code в supabase-js; текст — для показа пользователю):
--   42501 — нет прав (не вошёл, не участник клуба, не банкир, не участник вечера) → HTTP 403
--   22023 — неверные данные (нет такого вечера/игрока, кривой payload)           → HTTP 400
--   P0001 — действие недопустимо в текущем состоянии (вечер закрыт, приём закрыт) → HTTP 400

-- Внутренние помощники живут вне public: схема не выставлена в API и не видна клиентам.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- private.require_player — id текущего участника клуба или ошибка
-- ---------------------------------------------------------------------------
create function private.require_player()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_player_id();
begin
  if v_me is null then
    raise exception 'Нужно войти в клуб через Telegram'
      using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.json_player_id — значение jsonb → uuid существующего игрока
-- ---------------------------------------------------------------------------
create function private.json_player_id(p_value jsonb, p_field text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'string' then
    raise exception 'Поле «%» должно быть строкой с id игрока', p_field
      using errcode = '22023';
  end if;

  begin
    v_id := (p_value #>> '{}')::uuid;
  exception when invalid_text_representation then
    raise exception 'Поле «%»: «%» — не id игрока', p_field, p_value #>> '{}'
      using errcode = '22023';
  end;

  if not exists (select 1 from public.players p where p.id = v_id) then
    raise exception 'Поле «%»: игрок % не найден', p_field, v_id
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.check_keys — в объекте нет ключей, кроме разрешённых
-- ---------------------------------------------------------------------------
-- Лишний ключ почти всегда опечатка клиента (player_id вместо playerId), а молча его
-- выбросить — значит потерять событие в replay. Поэтому ошибка, а не нормализация.
create function private.check_keys(p_payload jsonb, p_allowed text[], p_type text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_extra text;
begin
  select k into v_extra
  from jsonb_object_keys(p_payload) as k
  where k <> all (p_allowed)
  limit 1;

  if v_extra is not null then
    raise exception 'Событие «%»: лишнее поле «%»', p_type, v_extra
      using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.lock_evening_for_write — вечер под блокировкой + проверка прав на журнал
-- ---------------------------------------------------------------------------
-- Общие права add_event и void_event: банкир вечера или админ; после finished банкир
-- работает только с payment, остальное — правка закрытого вечера, это делает админ.
-- for update сериализует запись в журнал одного вечера: порядок id = порядок действий.
create function private.lock_evening_for_write(p_evening uuid, p_type text, p_me uuid)
returns public.evenings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev    public.evenings;
  v_admin boolean := public.is_admin();
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening
  for update;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;

  if not v_admin and v_ev.banker_id is distinct from p_me then
    raise exception 'Вести журнал вечера может только банкир вечера или админ'
      using errcode = '42501';
  end if;

  if v_ev.status = 'cancelled' then
    raise exception 'Вечер отменён — журнал закрыт'
      using errcode = 'P0001';
  end if;

  if v_ev.status in ('finished', 'settled') and not v_admin and p_type <> 'payment' then
    raise exception 'Игра окончена: банкир может вносить только платежи, остальное правит админ'
      using errcode = '42501';
  end if;

  return v_ev;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_event
-- ---------------------------------------------------------------------------
create function public.add_event(p_evening uuid, p_type text, p_payload jsonb default '{}'::jsonb)
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
  v_row     public.evening_events;
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

  v_ev := private.lock_evening_for_write(p_evening, p_type, v_me);

  -- Форма payload. Сохраняем нормализованную копию: uuid в каноническом виде, чтобы
  -- сравнение по тексту (is_participant, фильтры) не зависело от регистра клиента.
  case
    when p_type in ('join', 'rebuy') then
      perform private.check_keys(v_payload, array['playerId'], p_type);
      v_pid := private.json_player_id(v_payload -> 'playerId', 'playerId');
      v_norm := jsonb_build_object('playerId', v_pid);

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

  insert into public.evening_events (evening_id, type, payload, created_by)
  values (v_ev.id, p_type, v_norm, v_me)
  returning * into v_row;

  -- Побочные эффекты статуса. Старт таймера закрывает RSVP и прогнозы (они живут, пока announced).
  if p_type = 'timer_start' and v_ev.status = 'announced' then
    update public.evenings
    set status = 'live',
        started_at = now()
    where id = v_ev.id;
  elsif p_type = 'finish' and v_ev.status in ('announced', 'live') then
    update public.evenings
    set status = 'finished',
        finished_at = now(),
        voting_closes_at = now() + interval '24 hours'
    where id = v_ev.id;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_event
-- ---------------------------------------------------------------------------
create function public.void_event(p_event bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_player();
  v_e   public.evening_events;
  v_ev  public.evenings;
begin
  select ee.* into v_e
  from public.evening_events ee
  where ee.id = p_event;

  if not found then
    raise exception 'Событие не найдено'
      using errcode = '22023';
  end if;

  v_ev := private.lock_evening_for_write(v_e.evening_id, v_e.type, v_me);

  -- Перечитываем под блокировкой вечера: параллельная отмена могла успеть раньше.
  select ee.* into v_e
  from public.evening_events ee
  where ee.id = p_event;

  if v_e.voided_at is not null then
    raise exception 'Событие уже отменено'
      using errcode = 'P0001';
  end if;

  update public.evening_events
  set voided_at = now(),
      voided_by = v_me
  where id = v_e.id;

  -- Отмена finish возвращает вечер в игру; расчёт и голосование при этом теряют смысл.
  if v_e.type = 'finish'
     and v_ev.status in ('finished', 'settled')
     and not exists (
       select 1
       from public.evening_events ee
       where ee.evening_id = v_ev.id
         and ee.type = 'finish'
         and ee.voided_at is null) then
    update public.evenings
    set status = 'live',
        finished_at = null,
        settled_at = null,
        voting_closes_at = null
    where id = v_ev.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_settled / unmark_settled
-- ---------------------------------------------------------------------------
-- Сошёлся ли баланс, решает домен на клиенте (isSettled); БД фиксирует решение банкира.
create function public.mark_settled(p_evening uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_player();
  v_ev public.evenings;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening
  for update;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if not public.is_admin() and v_ev.banker_id is distinct from v_me then
    raise exception 'Закрыть расчёт может только банкир вечера или админ'
      using errcode = '42501';
  end if;

  if v_ev.status = 'settled' then
    return; -- повторное нажатие — не ошибка
  end if;
  if v_ev.status <> 'finished' then
    raise exception 'Закрыть расчёт можно только после окончания игры'
      using errcode = 'P0001';
  end if;

  update public.evenings
  set status = 'settled',
      settled_at = now()
  where id = v_ev.id;
end;
$$;

create function public.unmark_settled(p_evening uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_player();
  v_ev public.evenings;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening
  for update;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if not public.is_admin() and v_ev.banker_id is distinct from v_me then
    raise exception 'Открыть расчёт может только банкир вечера или админ'
      using errcode = '42501';
  end if;

  if v_ev.status = 'finished' then
    return;
  end if;
  if v_ev.status <> 'settled' then
    raise exception 'Расчёт этого вечера не закрыт'
      using errcode = 'P0001';
  end if;

  update public.evenings
  set status = 'finished',
      settled_at = null
  where id = v_ev.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_rsvp
-- ---------------------------------------------------------------------------
create function public.set_rsvp(p_evening uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_player();
  v_status text;
begin
  if p_status is null or p_status not in ('yes', 'no', 'maybe') then
    raise exception 'Ответ должен быть yes, no или maybe'
      using errcode = '22023';
  end if;

  select e.status into v_status
  from public.evenings e
  where e.id = p_evening;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if v_status <> 'announced' then
    raise exception 'Запись на вечер закрыта: игра уже началась или вечер отменён'
      using errcode = 'P0001';
  end if;

  insert into public.rsvps (evening_id, player_id, status)
  values (p_evening, v_me, p_status)
  on conflict (evening_id, player_id) do update
    set status = excluded.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_prediction
-- ---------------------------------------------------------------------------
-- Оба null — прогноз снимается. Прогноз может делать и тот, кто сам не играет.
create function public.set_prediction(p_evening uuid, p_winner uuid, p_first_out uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_player();
  v_status text;
begin
  select e.status into v_status
  from public.evenings e
  where e.id = p_evening;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if v_status <> 'announced' then
    raise exception 'Прогнозы закрыты: таймер уже запущен'
      using errcode = 'P0001';
  end if;

  if p_winner is null and p_first_out is null then
    delete from public.predictions
    where evening_id = p_evening
      and player_id = v_me;
    return;
  end if;

  if p_winner is not null
     and not exists (select 1 from public.players p where p.id = p_winner) then
    raise exception 'Игрок-победитель не найден'
      using errcode = '22023';
  end if;
  if p_first_out is not null
     and not exists (select 1 from public.players p where p.id = p_first_out) then
    raise exception 'Игрок «первый вылет» не найден'
      using errcode = '22023';
  end if;

  insert into public.predictions (evening_id, player_id, winner_id, first_out_id)
  values (p_evening, v_me, p_winner, p_first_out)
  on conflict (evening_id, player_id) do update
    set winner_id = excluded.winner_id,
        first_out_id = excluded.first_out_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- cast_vote
-- ---------------------------------------------------------------------------
create function public.cast_vote(
  p_evening    uuid,
  p_category   text,
  p_nominee    uuid,
  p_caption    text default null,
  p_photo_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_player();
  v_ev      public.evenings;
  v_caption text := nullif(btrim(p_caption), '');
  v_photo   text := nullif(btrim(p_photo_path), '');
begin
  if p_category is null or p_category not in ('hand', 'bluff', 'badbeat') then
    raise exception 'Номинация должна быть hand, bluff или badbeat'
      using errcode = '22023';
  end if;
  if p_nominee is null then
    raise exception 'Не выбран номинант'
      using errcode = '22023';
  end if;

  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if v_ev.status not in ('finished', 'settled')
     or v_ev.voting_closes_at is null
     or now() >= v_ev.voting_closes_at then
    raise exception 'Голосование по этому вечеру закрыто'
      using errcode = 'P0001';
  end if;

  if p_nominee = v_me then
    raise exception 'Голосовать за себя нельзя'
      using errcode = '22023';
  end if;
  if not public.is_participant(p_evening, v_me) then
    raise exception 'Голосуют только игравшие в этот вечер'
      using errcode = '42501';
  end if;
  if not public.is_participant(p_evening, p_nominee) then
    raise exception 'Номинант не играл в этот вечер'
      using errcode = '22023';
  end if;

  if char_length(v_caption) > 200 then
    raise exception 'Подпись длиннее 200 символов'
      using errcode = '22023';
  end if;
  -- Ссылаться можно только на своё фото этого вечера: путь {evening_id}/{player_id}/...
  -- Иначе голос мог бы «присвоить» чужую загрузку.
  if v_photo is not null
     and (not starts_with(v_photo, p_evening::text || '/' || v_me::text || '/')
          or char_length(v_photo) > 200
          or v_photo like '%..%') then
    raise exception 'Фото должно лежать в папке {вечер}/{ваш id}/'
      using errcode = '22023';
  end if;

  insert into public.votes (evening_id, voter_id, category, nominee_id, caption, photo_path)
  values (p_evening, v_me, p_category, p_nominee, v_caption, v_photo)
  on conflict (evening_id, voter_id, category) do update
    set nominee_id = excluded.nominee_id,
        caption = excluded.caption,
        photo_path = excluded.photo_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_vote (дополнение к контракту: «админ может удалить» голос из концепции)
-- ---------------------------------------------------------------------------
-- Админ удаляет любой голос (модерация подписи/фото), голосующий — свой, пока голосование открыто.
-- Фото в Storage удаляется отдельно (политика бакета разрешает это владельцу и админу).
create function public.delete_vote(p_evening uuid, p_voter uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.require_player();
  v_admin boolean := public.is_admin();
  v_ev    public.evenings;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;

  if not v_admin then
    if p_voter is distinct from v_me then
      raise exception 'Удалить чужой голос может только админ'
        using errcode = '42501';
    end if;
    if v_ev.voting_closes_at is null or now() >= v_ev.voting_closes_at then
      raise exception 'Голосование закрыто — голос уже не отозвать'
        using errcode = 'P0001';
    end if;
  end if;

  delete from public.votes
  where evening_id = p_evening
    and voter_id = p_voter
    and category = p_category;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_my_name
-- ---------------------------------------------------------------------------
create function public.set_my_name(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.require_player();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Имя — от 1 до 40 символов'
      using errcode = '22023';
  end if;

  update public.players
  set display_name = v_name
  where id = v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- board_state — табло для ТВ/ноутбука, доступно без входа по токену из QR
-- ---------------------------------------------------------------------------
-- Отдаём ровно то, что нужно replay для таймера и состава: без платежей (деньги — не для
-- экрана в комнате) и без отменённых событий. Завершённый вечер (в т. ч. уже рассчитанный)
-- виден ещё 6 часов, чтобы табло показало итог, а потом ссылка гаснет.
create function public.board_state(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev     public.evenings;
  v_events jsonb;
  v_players jsonb;
begin
  if p_token is null then
    return null;
  end if;

  select e.* into v_ev
  from public.evenings e
  where e.board_token = p_token
    and (e.status in ('announced', 'live')
         or (e.status in ('finished', 'settled')
             and e.finished_at > now() - interval '6 hours'));

  if not found then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ee.id,
               'type', ee.type,
               'payload', ee.payload,
               'at', ee.at,
               'voided', false)
             order by ee.id),
           '[]'::jsonb)
  into v_events
  from public.evening_events ee
  where ee.evening_id = v_ev.id
    and ee.voided_at is null
    and ee.type <> 'payment';

  -- Имена только тех, кто упомянут в событиях вечера, — не весь клуб.
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', p.id, 'display_name', p.display_name)
             order by p.display_name),
           '[]'::jsonb)
  into v_players
  from public.players p
  where p.id::text in (
    select ev.value -> 'payload' ->> 'playerId'
    from jsonb_array_elements(v_events) as ev(value)
    union
    select b.value
    from jsonb_array_elements(v_events) as ev(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(ev.value -> 'payload' -> 'by', '[]'::jsonb)) as b(value));

  return jsonb_build_object(
    'evening', jsonb_build_object(
      'id', v_ev.id,
      'scheduled_at', v_ev.scheduled_at,
      'location', v_ev.location,
      'status', v_ev.status,
      'started_at', v_ev.started_at,
      'finished_at', v_ev.finished_at),
    'format', v_ev.format,
    'events', v_events,
    'players', v_players);
end;
$$;

-- ---------------------------------------------------------------------------
-- Гранты на функции
-- ---------------------------------------------------------------------------
-- Новые функции public Supabase по умолчанию открывает anon и authenticated — закрываем всё
-- и открываем поимённо. anon получает только board_state.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.current_player_id(),
  public.is_admin(),
  public.is_banker(uuid),
  public.is_participant(uuid, uuid),
  public.add_event(uuid, text, jsonb),
  public.void_event(bigint),
  public.mark_settled(uuid),
  public.unmark_settled(uuid),
  public.set_rsvp(uuid, text),
  public.set_prediction(uuid, uuid, uuid),
  public.cast_vote(uuid, text, uuid, text, text),
  public.delete_vote(uuid, uuid, text),
  public.set_my_name(text),
  public.board_state(uuid)
  to authenticated;

grant execute on function public.board_state(uuid) to anon;

grant execute on all functions in schema public to service_role;
