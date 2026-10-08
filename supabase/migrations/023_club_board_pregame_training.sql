-- 023: табло клуба, проверка перед игрой, тренировочный вечер (аудит 07.10.2026, «Следующий шаг», п. 3 и 6).
-- 1) Постоянная ссылка «табло клуба». settings.club_board_token — один короткий код клуба (12 hex: его
--    печатают пультом ТВ один раз и сохраняют закладкой). Табло /tv/<код> само показывает, что сейчас
--    важно (private.club_board_evening_id): идущий вечер, итог в пределах 6 ч после финала или сегодняшний
--    (по Москве) анонс — экран ожидания; настоящий вечер важнее тренировки, но идущая тренировка важнее
--    анонса и итога (она идёт прямо сейчас — её и показывать). Нечего показать — экран «Следующая игра».
--    RPC для anon: club_board_state(код) — то же, что board_state, плюс время следующей игры; клипы
--    голоса — club_board_voice_clips(код, …). Перевыпуск кода — rotate_club_board_token() (только
--    админ): старая ссылка гаснет сразу. Ссылки вечеров (evenings.board_token, board_state) работают как
--    раньше; board_state отдаёт ещё evening.is_training (тело вынесено в private.board_payload).
-- 2) «Табло на связи». Табло раз в 20 с отмечается board_ping(токен вечера или код клуба, голос включён):
--    public.board_presence — по строке на вечер, только время последней отметки и время, когда голос был
--    включён; ни адреса, ни устройства. Читают участники клуба (проверка перед игрой у банкира).
--    voice_clips_present(голос, хеши) — какие фразы уже озвучены (без звука): имена и фразы уровней в
--    проверке перед игрой.
-- 3) Тренировочный вечер. evenings.is_training — ставится при создании и больше не меняется (триггер):
--    иначе обычный вечер можно было бы пометить тренировкой и удалить. Тренировка не держит день клуба
--    (уникальный индекс дня и слот cron-tick её не видят), голосования у неё нет (voting_closes_at всегда
--    null), из истории, рейтинга, ленты и постов бота её убирают клиент и функции. Удалить целиком —
--    delete_training_evening(вечер), только админ и только тренировку; гости, заведённые на ней и больше
--    нигде не упомянутые, удаляются вместе с ней. В private.voice_manifest_input тренировка не двигает
--    last_played_at (пары нокаутов для генератора озвучки).
--
-- Гранты: новые колонки — права на таблицы выданы целиком (002, 011). Новая таблица board_presence —
-- select для authenticated (RLS: участник клуба), всё — service_role; anon — ничего (пишет только
-- board_ping). Функции — явно; служебные private.* — revoke у public/anon/authenticated.

-- ---------------------------------------------------------------------------
-- 1. Тренировочный вечер: колонка, неизменность, день клуба, голосование
-- ---------------------------------------------------------------------------
alter table public.evenings add column is_training boolean not null default false;

comment on column public.evenings.is_training is
  'Тренировочный вечер: не попадает в историю, рейтинг, сезоны, ачивки, ленту, рекорды, посты бота и напоминания; голосования нет; удаляется целиком (delete_training_evening). Ставится при создании, не меняется. Миграция 023.';

-- Пометку ставят только при создании: обычный вечер нельзя «переделать» в тренировку и удалить, а
-- тренировку — в настоящий вечер с историей.
create function private.evenings_training_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.is_training is distinct from old.is_training then
    raise exception 'Пометку «Тренировка» меняют только при создании вечера — создай новый вечер'
      using errcode = '22023';
  end if;
  -- Голосования у тренировки нет: finish (add_event) ставит закрытие через 24 ч — снимаем.
  if new.is_training then
    new.voting_closes_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.evenings_training_guard() from public, anon, authenticated;

create trigger evenings_training_guard
  before insert or update on public.evenings
  for each row execute function private.evenings_training_guard();

-- Один неотменённый вечер на московскую дату — среди настоящих (006): тренировка в день игры законна.
drop index public.evenings_one_per_club_day_idx;
create unique index evenings_one_per_club_day_idx
  on public.evenings (((scheduled_at at time zone 'Europe/Moscow')::date))
  where status <> 'cancelled' and not is_training;

-- Вход генератора озвучки (тело из 016): last_played_at — по настоящим вечерам.
create or replace function private.voice_manifest_input()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'display_name', p.display_name,
                 'spoken_name', p.spoken_name,
                 'is_guest', p.is_guest,
                 'is_active', p.is_active,
                 'last_played_at', (
                   select max(e.scheduled_at)
                   from public.evening_events ee
                   join public.evenings e on e.id = ee.evening_id
                   where ee.type = 'join'
                     and ee.voided_at is null
                     and not e.is_training
                     and ee.payload ->> 'playerId' = p.id::text))
               order by p.display_name, p.id)
      from public.players p
      where p.is_active), '[]'::jsonb),
    'formats',
      coalesce((
        select jsonb_agg(f.config order by f.created_at, f.id)
        from public.formats f
        where not f.is_archived), '[]'::jsonb)
      || coalesce((
        select jsonb_agg(e.format order by e.scheduled_at, e.id)
        from public.evenings e
        where e.status in ('announced', 'live')), '[]'::jsonb))
$$;

comment on function private.voice_manifest_input() is
  'Генератор озвучки: {players: [{id, display_name, spoken_name, is_guest, is_active, last_played_at}], formats: [TournamentFormat]} — вход voiceManifest домена. Миграция 016; last_played_at без тренировок — 023.';

revoke execute on function private.voice_manifest_input() from public, anon, authenticated;

-- Удалить тренировку целиком: журнал, ответы, прогнозы, голоса, отметки табло (cascade) и гостей,
-- которых завели на ней (созданы после вечера и больше нигде не упомянуты — private.player_references).
create function public.delete_training_evening(p_evening uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev      public.evenings;
  v_guests  uuid[];
  v_guest   uuid;
  v_deleted integer := 0;
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Удалить тренировочный вечер может только админ'
      using errcode = '42501';
  end if;

  -- Та же блокировка, что у записи в журнал: идущая запись дождётся удаления и упадёт на «вечера нет».
  select e.* into v_ev from public.evenings e where e.id = p_evening for update;
  if not found then
    raise exception 'Такого вечера нет — обнови экран'
      using errcode = '22023';
  end if;
  if not v_ev.is_training then
    raise exception 'Удалить можно только тренировочный вечер. Обычный вечер отменяют в форме вечера'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into v_guests
  from public.evening_events ee
  join public.players p on p.id::text = ee.payload ->> 'playerId'
  where ee.evening_id = p_evening
    and ee.type = 'join'
    and p.is_guest
    and p.tg_id is null
    and p.auth_user_id is null
    and p.created_at >= v_ev.created_at;

  delete from public.evenings e where e.id = p_evening;

  foreach v_guest in array v_guests loop
    if cardinality(private.player_references(v_guest)) = 0 then
      delete from public.players p where p.id = v_guest;
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  return jsonb_build_object('evening', p_evening, 'guestsDeleted', v_deleted);
end;
$$;

comment on function public.delete_training_evening(uuid) is
  'Админ: удалить тренировочный вечер целиком (обычный — P0001) вместе с гостями, заведёнными на нём и больше нигде не упомянутыми. {evening, guestsDeleted}. Миграция 023.';

revoke execute on function public.delete_training_evening(uuid) from public, anon, authenticated;
grant execute on function public.delete_training_evening(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Код табло клуба
-- ---------------------------------------------------------------------------
-- 12 hex = 48 случайных бит (первые 12 знаков uuid v4 — случайные). Встроенные функции: умолчание
-- вычисляется с правами того, кто пишет строку (админ правит settings под RLS).
alter table public.settings
  add column club_board_token text not null
    default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    constraint settings_club_board_token_shape check (club_board_token ~ '^[0-9a-f]{12}$');

comment on column public.settings.club_board_token is
  'Код постоянной ссылки табло клуба (/tv/<код>): 12 hex. Перевыпуск — rotate_club_board_token(). Миграция 023.';

create function public.rotate_club_board_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Перевыпустить ссылку табло может только админ'
      using errcode = '42501';
  end if;
  update public.settings s
  set club_board_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      updated_at = now()
  where s.id = 1
  returning s.club_board_token into v_token;
  if v_token is null then
    raise exception 'Настроек клуба нет — примени миграции'
      using errcode = 'P0001';
  end if;
  return v_token;
end;
$$;

comment on function public.rotate_club_board_token() is
  'Админ: новый код табло клуба; старая ссылка /tv/<код> сразу гаснет. Миграция 023.';

revoke execute on function public.rotate_club_board_token() from public, anon, authenticated;
grant execute on function public.rotate_club_board_token() to authenticated, service_role;

create function private.club_board_token_ok(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_code is not null and s.club_board_token = p_code
    from public.settings s
    where s.id = 1), false)
$$;

revoke execute on function private.club_board_token_ok(text) from public, anon, authenticated;

-- Какой вечер показывает табло клуба. По порядку: идущий настоящий, идущая тренировка, итог настоящего
-- (до 6 ч после финала), сегодняшний анонс настоящего, итог тренировки, сегодняшний анонс тренировки.
-- Внутри ступени — последний начатый / последний завершённый / самый ранний анонс.
create function private.club_board_evening_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.evenings e
  where e.status = 'live'
     or (e.status in ('finished', 'settled') and e.finished_at > now() - interval '6 hours')
     or (e.status = 'announced'
         and (e.scheduled_at at time zone 'Europe/Moscow')::date
             = (now() at time zone 'Europe/Moscow')::date)
  order by
    case
      when e.status = 'live' and not e.is_training then 1
      when e.status = 'live' then 2
      when e.status in ('finished', 'settled') and not e.is_training then 3
      when e.status = 'announced' and not e.is_training then 4
      when e.status in ('finished', 'settled') then 5
      else 6
    end,
    case
      when e.status = 'live' then -extract(epoch from coalesce(e.started_at, e.scheduled_at))
      when e.status = 'announced' then extract(epoch from e.scheduled_at)
      else -extract(epoch from e.finished_at)
    end,
    e.id
  limit 1
$$;

revoke execute on function private.club_board_evening_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Табло: общий ответ, board_state, club_board_state, клипы
-- ---------------------------------------------------------------------------
-- Ответ табло по id вечера (тело board_state из 016) + evening.is_training.
create function private.board_payload(p_evening uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev      public.evenings;
  v_events  jsonb;
  v_players jsonb;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening;
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
             jsonb_build_object(
               'id', p.id,
               'display_name', p.display_name,
               'spoken_name', p.spoken_name)
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
      'finished_at', v_ev.finished_at,
      'is_training', v_ev.is_training),
    'format', v_ev.format,
    'events', v_events,
    'players', v_players,
    -- Табло без входа сверяет часы по этому полю на каждом опросе.
    'server_now', clock_timestamp());
end;
$$;

revoke execute on function private.board_payload(uuid) from public, anon, authenticated;

-- board_state (016): то же правило срока ссылки, ответ — private.board_payload.
create or replace function public.board_state(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.board_evening_id(p_token);
begin
  if v_id is null then
    return null;
  end if;
  return private.board_payload(v_id);
end;
$$;

-- Табло клуба по коду: {board: ответ как у board_state | null, next_at, schedule, server_now}; код не
-- тот (перевыпущен, обрезан) — null.
create function public.club_board_state(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.settings;
  v_id       uuid;
  v_next     timestamptz;
begin
  if not private.club_board_token_ok(p_code) then
    return null;
  end if;
  select s.* into v_settings from public.settings s where s.id = 1;
  v_id := private.club_board_evening_id();

  select min(e.scheduled_at) into v_next
  from public.evenings e
  where e.status = 'announced'
    and not e.is_training
    and e.scheduled_at > now();

  return jsonb_build_object(
    'board', case when v_id is null then null else private.board_payload(v_id) end,
    'next_at', v_next,
    'schedule', jsonb_build_object(
      'weekday', v_settings.game_weekday,
      'time', left(v_settings.game_time::text, 5)),
    'server_now', clock_timestamp());
end;
$$;

comment on function public.club_board_state(text) is
  'Табло клуба (anon) по коду settings.club_board_token: {board (как board_state) | null, next_at — ближайший анонс настоящего вечера, schedule {weekday, time}, server_now}; код не тот — null. Миграция 023.';

revoke execute on function public.club_board_state(text) from public, anon, authenticated;
grant execute on function public.club_board_state(text) to anon, authenticated, service_role;

-- Клипы голоса по хешам (как board_voice_clips, 016) — для табло клуба: код верен — найденные клипы,
-- даже если вечера сейчас нет (проверка звука «Голос включён.» на экране ожидания).
create function public.club_board_voice_clips(p_code text, p_voice text, p_hashes text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if cardinality(coalesce(p_hashes, '{}'::text[])) > 100 then
    raise exception 'Не больше 100 клипов за один запрос'
      using errcode = '22023';
  end if;
  if not private.club_board_token_ok(p_code) then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'hash', c.text_hash,
               'mime', c.mime,
               'duration_ms', c.duration_ms,
               'audio', translate(encode(c.audio, 'base64'), E'\n', ''))
             order by c.text_hash)
    from public.voice_clips c
    where c.voice = p_voice
      and c.text_hash = any (p_hashes)), '[]'::jsonb);
end;
$$;

comment on function public.club_board_voice_clips(text, text, text[]) is
  'Табло клуба (anon): клипы голоса по хешам, не больше 100 за запрос; [{hash, mime, duration_ms, audio (base64)}] найденных. null — код табло клуба не тот. Миграция 023.';

revoke execute on function public.club_board_voice_clips(text, text, text[]) from public, anon, authenticated;
grant execute on function public.club_board_voice_clips(text, text, text[]) to anon, authenticated, service_role;

-- Какие фразы уже озвучены — без звука: проверка перед игрой у банкира (имена, фразы уровней).
create function public.voice_clips_present(p_voice text, p_hashes text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_player();
  if cardinality(coalesce(p_hashes, '{}'::text[])) > 300 then
    raise exception 'Не больше 300 фраз за один запрос'
      using errcode = '22023';
  end if;
  return coalesce((
    select array_agg(c.text_hash order by c.text_hash)
    from public.voice_clips c
    where c.voice = p_voice
      and c.text_hash = any (p_hashes)), '{}'::text[]);
end;
$$;

comment on function public.voice_clips_present(text, text[]) is
  'Участник клуба: какие из хешей уже озвучены этим голосом (до 300 за запрос). Миграция 023.';

revoke execute on function public.voice_clips_present(text, text[]) from public, anon, authenticated;
grant execute on function public.voice_clips_present(text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. «Табло на связи»
-- ---------------------------------------------------------------------------
create table public.board_presence (
  evening_id uuid primary key references public.evenings (id) on delete cascade,
  -- Последняя отметка табло, показывающего этот вечер (по ссылке вечера или табло клуба).
  seen_at    timestamptz not null,
  -- Последняя отметка табло с включённым голосом.
  voice_at   timestamptz
);

comment on table public.board_presence is
  'Табло на связи: последняя отметка табло по вечеру (board_ping) и когда голос был включён. Без данных устройства. Миграция 023.';

alter table public.board_presence enable row level security;

create policy board_presence_select_members on public.board_presence
  for select to authenticated
  using ((select public.current_player_id()) is not null);

revoke all on table public.board_presence from public, anon, authenticated, service_role;
grant select on table public.board_presence to authenticated;
grant select, insert, update, delete on table public.board_presence to service_role;

-- Отметка табло: токен вечера (uuid, правило срока board_state) или код табло клуба (вечер, который
-- оно сейчас показывает). Чаще раза в 5 с строка не переписывается. true — отметка относится к вечеру.
create function public.board_ping(p_token text, p_voice boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_token is null or char_length(p_token) > 64 then
    return false;
  end if;
  if p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := private.board_evening_id(p_token::uuid);
  elsif private.club_board_token_ok(p_token) then
    v_id := private.club_board_evening_id();
  end if;
  if v_id is null then
    return false;
  end if;

  insert into public.board_presence as bp (evening_id, seen_at, voice_at)
  values (v_id, now(), case when coalesce(p_voice, false) then now() end)
  on conflict (evening_id) do update
    set seen_at = excluded.seen_at,
        voice_at = coalesce(excluded.voice_at, bp.voice_at)
    where bp.seen_at < excluded.seen_at - interval '5 seconds'
       or (excluded.voice_at is not null
           and (bp.voice_at is null or bp.voice_at < excluded.voice_at - interval '5 seconds'));
  return true;
end;
$$;

comment on function public.board_ping(text, boolean) is
  'Табло (anon) отмечается раз в 20 с: токен вечера или код табло клуба, включён ли голос. Пишет board_presence вечера, который табло показывает. Миграция 023.';

revoke execute on function public.board_ping(text, boolean) from public, anon, authenticated;
grant execute on function public.board_ping(text, boolean) to anon, authenticated, service_role;
