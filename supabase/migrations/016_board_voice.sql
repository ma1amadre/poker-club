-- 016: голос табло.
-- Табло объявляет события вечера голосом (Silero TTS v5_5_ru, диктор xenia, CC BY-NC-SA 4.0).
-- Silero работает только в Python, поэтому клипы озвучиваются заранее (GitHub Actions в
-- poker-club-ops) и лежат здесь; табло скачивает их по хешу текста. Тексты фраз, числа словами,
-- хеш и манифест — домен (supabase/functions/_shared/domain/voice.ts), здесь только хранение:
-- 1) players.spoken_name — имя для озвучки: кириллица, пробел, дефис, апостроф и «+» перед ударной
--    гласной. Пусто — голос берёт display_name, если оно целиком кириллическое (иначе фразы звучат
--    без имени). Пишут админ (форма «Игроки», upsert под RLS) и сам игрок — RPC set_my_spoken_name.
-- 2) public.voice_clips — клипы (MP3) по (voice, text_hash). Хеш = sha256(voice || E'\n' || text),
--    его сверяет constraint: генератор не может положить клип не под тем хешем. Клиентам таблица не
--    видна (RLS без политик, прав у anon/authenticated нет); генератор пишет строкой
--    SUPABASE_DB_URL (роль postgres, владелец таблицы).
-- 3) board_voice_clips — клипы для табло по токену (anon, срок ссылки как у board_state).
--    Правило срока вынесено в private.board_evening_id, board_state пересоздаётся на нём и отдаёт
--    игрокам spoken_name.
-- 4) private.voice_manifest_input() — вход манифеста фраз для генератора (игроки и форматы).
-- 5) merge_players переносит spoken_name гостя на Telegram-профиль, если у профиля своего нет.

-- ---------------------------------------------------------------------------
-- 1. players.spoken_name
-- ---------------------------------------------------------------------------
-- Форма та, что даёт normalizeSpokenName/spokenNameError домена: без пробелов по краям и двойных,
-- символы — русские буквы, пробел, дефис, апостроф, «+»; хотя бы одна буква; «+» — только перед
-- гласной. Грант на колонку не нужен: права authenticated на players выданы на таблицу (002).
alter table public.players
  add column spoken_name text,
  add constraint players_spoken_name_shape check (
    spoken_name is null or (
      char_length(spoken_name) between 1 and 50
      and spoken_name = btrim(spoken_name)
      and position('  ' in spoken_name) = 0
      and spoken_name ~ '^[А-Яа-яЁё+'' -]+$'
      and spoken_name ~ '[А-Яа-яЁё]'
      and spoken_name !~ '\+([^аеёиоуыэюяАЕЁИОУЫЭЮЯ]|$)'));

comment on column public.players.spoken_name is
  'Имя для озвучки на табло (кириллица, «+» перед ударной гласной); null — голос берёт display_name, если оно кириллическое. Миграция 016.';

-- ---------------------------------------------------------------------------
-- set_my_spoken_name — своё имя для озвучки
-- ---------------------------------------------------------------------------
-- Тексты ошибок — как spokenNameError домена (интерфейс показывает их как есть, на «ты»).
create function public.set_my_spoken_name(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.require_player();
  -- Типографские апострофы → «'», пробелы схлопываются (как normalizeSpokenName).
  v_name text := btrim(regexp_replace(
                   translate(normalize(coalesce(p_name, ''), nfc), '’ʼ‘`', repeat(chr(39), 4)),
                   '\s+', ' ', 'g'));
begin
  if v_name = '' then
    update public.players set spoken_name = null where id = v_me;
    return null;
  end if;

  if char_length(v_name) > 50 then
    raise exception 'Имя для озвучки длиннее 50 символов. Сократи его.'
      using errcode = '22023';
  end if;
  if v_name ~ '[A-Za-z]' then
    raise exception 'Латиницу голос не читает. Напиши имя русскими буквами, как оно звучит.'
      using errcode = '22023';
  end if;
  if v_name ~ '[0-9]' then
    raise exception 'Цифры голос не читает. Напиши их словами.'
      using errcode = '22023';
  end if;
  if v_name !~ '^[А-Яа-яЁё+'' -]+$' then
    raise exception 'Можно только русские буквы, пробел, дефис, апостроф и знак + перед ударной гласной.'
      using errcode = '22023';
  end if;
  if v_name !~ '[А-Яа-яЁё]' then
    raise exception 'Напиши имя русскими буквами.'
      using errcode = '22023';
  end if;
  if v_name ~ '\+([^аеёиоуыэюяАЕЁИОУЫЭЮЯ]|$)' then
    raise exception 'Знак + ставится прямо перед ударной гласной: Эрдн+и.'
      using errcode = '22023';
  end if;

  update public.players set spoken_name = v_name where id = v_me;
  return v_name;
end;
$$;

comment on function public.set_my_spoken_name(text) is
  'Игрок: своё имя для озвучки на табло. Пустое — сбросить (null). Возвращает сохранённое значение.';

revoke execute on function public.set_my_spoken_name(text) from public, anon, authenticated;
grant execute on function public.set_my_spoken_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. voice_clips — озвученные фразы
-- ---------------------------------------------------------------------------
create table public.voice_clips (
  voice       text not null,
  text_hash   text not null,
  text        text not null,
  audio       bytea not null,
  mime        text not null default 'audio/mpeg',
  duration_ms integer not null,
  created_at  timestamptz not null default now(),
  primary key (voice, text_hash),
  constraint voice_clips_voice_shape check (voice ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  constraint voice_clips_hash_shape check (text_hash ~ '^[0-9a-f]{64}$'),
  -- normalizeSpeech домена: NFC, без пробелов по краям, без двойных пробелов и переводов строк.
  constraint voice_clips_text_normalized check (
    char_length(text) between 1 and 300
    and text = btrim(text)
    and position('  ' in text) = 0
    and text !~ '[\t\n\r\f\v]'
    and text is nfc normalized),
  constraint voice_clips_hash_matches check (
    text_hash = encode(sha256(convert_to(voice || E'\n' || text, 'UTF8')), 'hex')),
  constraint voice_clips_audio_size check (octet_length(audio) between 1 and 262144),
  constraint voice_clips_mime check (mime in ('audio/mpeg')),
  constraint voice_clips_duration check (duration_ms between 1 and 30000)
);

comment on table public.voice_clips is
  'Клипы голоса табло (MP3 моно). Ключ — (voice, sha256(voice || E''\n'' || text)); пишет генератор poker-club-ops ролью postgres, читает табло через board_voice_clips. Миграция 016.';

-- RLS без политик: клиенту таблица не видна; табло читает через security definer RPC.
alter table public.voice_clips enable row level security;
revoke all on table public.voice_clips from public, anon, authenticated;
grant select, insert, update, delete on table public.voice_clips to service_role;

-- ---------------------------------------------------------------------------
-- 3. Табло: срок ссылки, board_state (+ spoken_name), board_voice_clips
-- ---------------------------------------------------------------------------
-- Правило из board_state (003/007): вечер по токену, если он объявлен или идёт, или завершён не
-- больше 6 часов назад. Одно место на все RPC табло.
create function private.board_evening_id(p_token uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.evenings e
  where p_token is not null
    and e.board_token = p_token
    and (e.status in ('announced', 'live')
         or (e.status in ('finished', 'settled')
             and e.finished_at > now() - interval '6 hours'))
$$;

revoke execute on function private.board_evening_id(uuid) from public, anon, authenticated;

-- board_state (тело из 007; новое — правило срока из board_evening_id и spoken_name игроков).
create or replace function public.board_state(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id      uuid := private.board_evening_id(p_token);
  v_ev      public.evenings;
  v_events  jsonb;
  v_players jsonb;
begin
  if v_id is null then
    return null;
  end if;

  select e.* into v_ev
  from public.evenings e
  where e.id = v_id;

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
      'finished_at', v_ev.finished_at),
    'format', v_ev.format,
    'events', v_events,
    'players', v_players,
    -- Табло без входа сверяет часы по этому полю на каждом опросе.
    'server_now', clock_timestamp());
end;
$$;

-- Клипы по списку хешей (табло считает их доменом из текстов фраз). Отдаёт только найденные:
-- остальное ещё не озвучено. base64 без переводов строк (encode вставляет их каждые 76 символов).
create function public.board_voice_clips(p_token uuid, p_voice text, p_hashes text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if cardinality(coalesce(p_hashes, '{}'::text[])) > 100 then
    raise exception 'Не больше 100 клипов за один запрос'
      using errcode = '22023';
  end if;

  v_id := private.board_evening_id(p_token);
  if v_id is null then
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

comment on function public.board_voice_clips(uuid, text, text[]) is
  'Табло (anon): клипы голоса по хешам, не больше 100 за запрос; [{hash, mime, duration_ms, audio (base64)}] найденных. null — ссылка табло погасла (правило board_state).';

revoke execute on function public.board_voice_clips(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.board_voice_clips(uuid, text, text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Вход манифеста для генератора озвучки
-- ---------------------------------------------------------------------------
-- Генератор (poker-club-ops) вызывает `select private.voice_manifest_input()` ролью postgres и
-- отдаёт результат scripts/voice/manifest.mjs: активные игроки (с гостями) — имена и дата
-- последнего вечера с их входом (кому достанутся целые фразы пар нокаутов), форматы — конфиги
-- неархивных и снимки вечеров, которые ещё могут начаться или идут.
create function private.voice_manifest_input()
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
  'Генератор озвучки: {players: [{id, display_name, spoken_name, is_guest, is_active, last_played_at}], formats: [TournamentFormat]} — вход voiceManifest домена. Миграция 016.';

revoke execute on function private.voice_manifest_input() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. merge_players — имя для озвучки гостя переходит профилю
-- ---------------------------------------------------------------------------
-- Тело из 010; новое — перенос spoken_name перед удалением гостя. Имя для озвучки чаще всего
-- задают гостю, чьё имя голос не прочитает, а Telegram-профиль, к которому его привязывают, — с
-- латинским display_name: без переноса табло снова перестало бы называть игрока. Права и
-- комментарий функции create or replace сохраняет.
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

  -- Журнал: playerId и элементы by — точной заменой значения; created_by / voided_by.
  -- voided_at не трогаем — триггер «правка открывает расчёт» не срабатывает: итог вечера тот же.
  update public.evening_events ee
  set payload = private.payload_replace_player(ee.payload, p_guest, p_target)
  where ee.payload ->> 'playerId' = v_g
     or (jsonb_typeof(ee.payload -> 'by') = 'array' and ee.payload -> 'by' ? v_g);
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
  -- Имя для озвучки (016): своё у профиля важнее; нет своего — переходит гостевое (гость ниже
  -- удаляется вместе с ним, а латинское имя профиля голос не прочитает).
  update public.players t
  set spoken_name = g.spoken_name
  from public.players g
  where t.id = p_target
    and g.id = p_guest
    and t.spoken_name is null
    and g.spoken_name is not null;

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
