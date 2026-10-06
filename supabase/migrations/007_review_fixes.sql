-- 007_review_fixes.sql — исправления по ревью от 06.10.2026.
--
-- 1) add_event:
--    - p_client_id: ключ идемпотентности. Повтор того же намерения (ответ потерялся в сети, банкир
--      нажал ещё раз) возвращает уже записанное событие, а не вставляет дубль платежа или раздачи.
--    - finish у не начатого вечера (announced) — отказ: завершать нечего, а побочный эффект закрыл
--      бы RSVP и прогнозы.
--    - finish при идущем таймере сначала пишет явную паузу. Иначе отмена finish («вернуть вечер
--      в игру») снимала и неявную паузу replay, и таймер задним числом шёл всё время после финиша.
-- 2) void_event при отмене finish: вечер, у которого таймер не запускали, возвращается в announced,
--    а не в live; отметки постов итогов и голосования сбрасываются (results_revision считает,
--    сколько раз итог уже публиковался, — повторный пост выйдет как «Исправленные итоги»).
-- 3) server_now() и server_now в board_state — клиенты сверяют часы с сервером (время событий
--    ставит сервер, таймер считает клиент).
-- 4) set_payout — призовые доли вечера до старта меняет банкир (решение концепции).
-- 5) set_my_name не даёт взять имя другого активного игрока.
-- 6) Storage vote-photos: чтение — своё, админу, остальным после закрытия голосования (как votes);
--    загрузка — только участнику вечера при открытом голосовании, по шаблону имени и не больше
--    6 файлов на игрока и вечер.

-- ---------------------------------------------------------------------------
-- Колонки
-- ---------------------------------------------------------------------------
alter table public.evening_events add column client_id uuid;

create unique index evening_events_client_id_idx
  on public.evening_events (evening_id, client_id)
  where client_id is not null;

alter table public.evenings
  add column results_revision int not null default 0 check (results_revision >= 0);

comment on column public.evenings.results_revision is
  'Сколько раз итог вечера уже публиковался и был отменён/исправлен; > 0 — пост выходит как «Исправленные итоги».';

-- ---------------------------------------------------------------------------
-- add_event (новая сигнатура: + p_client_id)
-- ---------------------------------------------------------------------------
drop function public.add_event(uuid, text, jsonb);

create function public.add_event(
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
        raise exception 'Ключ повтора уже занят другой записью — обновите экран'
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

comment on function public.add_event(uuid, text, jsonb, uuid) is
  'Банкир/админ: событие в журнал вечера. p_client_id — ключ повтора: тот же ключ вернёт уже записанное событие.';

-- ---------------------------------------------------------------------------
-- void_event
-- ---------------------------------------------------------------------------
create or replace function public.void_event(p_event bigint)
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

  -- Отмена finish возвращает вечер в игру (или в анонс, если таймер так и не запускали);
  -- расчёт и голосование при этом теряют смысл. Уже опубликованный итог устарел: отметки постов
  -- снимаются, чтобы повторное завершение опубликовало итог заново («Исправленные итоги»)
  -- и новое голосование.
  if v_e.type = 'finish'
     and v_ev.status in ('finished', 'settled')
     and not exists (
       select 1
       from public.evening_events ee
       where ee.evening_id = v_ev.id
         and ee.type = 'finish'
         and ee.voided_at is null) then
    update public.evenings
    set status = case when started_at is null then 'announced' else 'live' end,
        finished_at = null,
        settled_at = null,
        voting_closes_at = null,
        results_revision = results_revision
          + case when results_posted_at is not null then 1 else 0 end,
        results_posted_at = null,
        voting_posted_at = null
    where id = v_ev.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- server_now — время сервера для сверки часов клиента
-- ---------------------------------------------------------------------------
-- clock_timestamp, а не now(): now() — начало транзакции, а нужно «сейчас» как можно ближе к ответу.
create function public.server_now()
returns timestamptz
language sql
volatile
set search_path = ''
as $$
  select clock_timestamp()
$$;

-- ---------------------------------------------------------------------------
-- board_state (+ server_now)
-- ---------------------------------------------------------------------------
create or replace function public.board_state(p_token uuid)
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
    'players', v_players,
    -- Табло без входа сверяет часы по этому полю на каждом опросе.
    'server_now', clock_timestamp());
end;
$$;

-- ---------------------------------------------------------------------------
-- set_payout — призовые доли вечера до старта
-- ---------------------------------------------------------------------------
-- Правило то же, что у domain/format.ts validateFormat: 1+ мест, доли > 0, сумма 100 %.
-- Только до старта таймера (announced): после старта деньги уже считаются по снимку формата.
create function public.set_payout(p_evening uuid, p_pct numeric[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_player();
  v_ev  public.evenings;
  v_n   int := coalesce(array_length(p_pct, 1), 0);
  v_sum numeric;
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
    raise exception 'Призовые меняет банкир вечера или админ'
      using errcode = '42501';
  end if;
  if v_ev.status <> 'announced' then
    raise exception 'Призовые меняются только до старта вечера'
      using errcode = 'P0001';
  end if;

  if v_n < 1 or v_n > 10 then
    raise exception 'Призовых мест — от 1 до 10'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_pct) as x(v) where x.v is null or x.v <= 0) then
    raise exception 'Доли призовых должны быть положительными числами'
      using errcode = '22023';
  end if;
  select sum(x.v) into v_sum from unnest(p_pct) as x(v);
  if abs(v_sum - 100) > 0.000000001 then
    raise exception 'Сумма долей призовых должна быть 100 %%, сейчас % %%', v_sum
      using errcode = '22023';
  end if;

  update public.evenings
  set format = jsonb_set(format, '{payoutPct}', to_jsonb(p_pct))
  where id = v_ev.id;
end;
$$;

comment on function public.set_payout(uuid, numeric[]) is
  'Банкир/админ: призовые доли вечера (format.payoutPct) до старта таймера.';

-- ---------------------------------------------------------------------------
-- set_my_name — без чужого имени
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
    raise exception 'Имя «%» уже занято в клубе — выберите другое', v_name
      using errcode = '23505';
  end if;

  update public.players
  set display_name = v_name
  where id = v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: vote-photos
-- ---------------------------------------------------------------------------
-- Можно ли текущему игроку загрузить ещё одно фото в папку {вечер}/{игрок}/: голосование вечера
-- открыто, игрок в нём участвовал, файлов в папке меньше 6 (3 номинации + запас на замену,
-- старое фото при замене удаляется). В public, а не private: политику проверяют с правами
-- вызывающего, схема private ему не видна.
create function public.can_upload_vote_photo(p_evening text, p_player text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev public.evenings;
  v_me uuid := public.current_player_id();
begin
  if v_me is null or p_player is distinct from v_me::text then
    return false;
  end if;
  if p_evening is null
     or p_evening !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening::uuid;

  if not found
     or v_ev.status not in ('finished', 'settled')
     or v_ev.voting_closes_at is null
     or now() >= v_ev.voting_closes_at
     or not public.is_participant(v_ev.id, v_me) then
    return false;
  end if;

  return (
    select count(*)
    from storage.objects o
    where o.bucket_id = 'vote-photos'
      and o.name like p_evening || '/' || p_player || '/%') < 6;
end;
$$;

drop policy vote_photos_select_members on storage.objects;
drop policy vote_photos_insert_own on storage.objects;

-- Как votes_select_own_or_closed: до закрытия голосования чужие фото (а по папкам — кто уже
-- проголосовал) не видны. Админу — всегда, для модерации.
create policy vote_photos_select_own_admin_or_closed on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vote-photos'
    and (select public.current_player_id()) is not null
    and (
      (storage.foldername(name))[2] = (select public.current_player_id())::text
      or (select public.is_admin())
      or exists (
        select 1
        from public.evenings e
        where e.id::text = (storage.foldername(name))[1]
          and e.voting_closes_at is not null
          and e.voting_closes_at <= now())));

-- Путь ровно {вечер}/{игрок}/{12 hex}.jpg — как в src/shared/api/photos.ts.
create policy vote_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vote-photos'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = (select public.current_player_id())::text
    and storage.filename(name) ~ '^[0-9a-f]{12}\.jpg$'
    and public.can_upload_vote_photo((storage.foldername(name))[1], (storage.foldername(name))[2]));

-- ---------------------------------------------------------------------------
-- Гранты
-- ---------------------------------------------------------------------------
revoke execute on function
  public.add_event(uuid, text, jsonb, uuid),
  public.server_now(),
  public.set_payout(uuid, numeric[]),
  public.can_upload_vote_photo(text, text)
  from public, anon, authenticated;

grant execute on function
  public.add_event(uuid, text, jsonb, uuid),
  public.server_now(),
  public.set_payout(uuid, numeric[]),
  public.can_upload_vote_photo(text, text)
  to authenticated, service_role;

grant execute on function public.server_now() to anon;
