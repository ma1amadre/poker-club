-- 009: тексты ошибок RPC на «ты».
-- Mini App обращается к игроку на «ты» (решение пользователя, ARCHITECTURE.md), а errorMessage
-- показывает русские тексты RPC как есть. Три функции, где сообщение обращалось на «вы»,
-- пересоздаются без изменений логики: тела скопированы из 007 (add_event, set_my_name) и 003
-- (cast_vote), поменялись только строки ошибок. create or replace сохраняет владельца, права
-- и комментарии функций.

-- ---------------------------------------------------------------------------
-- add_event (тело из 007)
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
  if p_client_id is not null then
    select ee.* into v_row
    from public.evening_events ee
    where ee.evening_id = p_evening
      and ee.client_id = p_client_id;
    if found then
      if v_row.created_by is distinct from v_me
         or v_row.type <> p_type
         or (v_row.payload ->> 'playerId') is distinct from lower(v_payload ->> 'playerId') then
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

-- ---------------------------------------------------------------------------
-- set_my_name (тело из 007)
-- ---------------------------------------------------------------------------
create or replace function public.set_my_name(p_name text)
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

  -- Два «Жени» в списках, пикере банкира и постах бота — путаница в вылетах и голосах.
  -- Уникальный индекс здесь не годится: tg-auth при входе берёт имя из Telegram, и тёзка
  -- не смог бы войти; гостей-тёзок банкир заводит законно.
  if exists (
    select 1
    from public.players p
    where p.id <> v_me
      and p.is_active
      and lower(p.display_name) = lower(v_name)) then
    raise exception 'Имя «%» уже занято в клубе — выбери другое', v_name
      using errcode = '23505';
  end if;

  update public.players
  set display_name = v_name
  where id = v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- cast_vote (тело из 003)
-- ---------------------------------------------------------------------------
create or replace function public.cast_vote(
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
    raise exception 'Фото должно лежать в папке {вечер}/{твой id}/'
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
