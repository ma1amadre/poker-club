-- 029: ссылка-приглашение в клуб (решение пользователя 25.10.2026). Человека, которого не получается
-- добавить в группу клуба, админ приглашает личной ссылкой на Mini App бота —
-- https://t.me/<bot_username>?startapp=i_<код> (формат — domain/invite.ts; start_param приходит в initData
-- и его читает tg-auth). Правила — по умолчанию, пользователь может их поменять:
-- одна ссылка — один вход (первый успешный вход сжигает код), действует 7 дней, админ отзывает
-- неиспользованную; создаёт только админ.
-- 1) public.player_invites — приглашения. Код — 24 случайных байта (192 бита) в base64url, 32 знака; в
--    таблице только SHA-256 кода (hex), сам код админ видит один раз — в ответе create_player_invite.
--    used_at/used_by — кто и когда вошёл, revoked_at — отзыв; срок — expires_at.
-- 2) players.joined_by_invite — вошёл по приглашению: дальше tg-auth пускает его без группы, пока
--    is_active. Это обычный постоянный игрок (не гость); выключают, как всех, — «Активен» в «Игроках».
-- 3) RPC админа (authenticated, проверка is_admin): create_player_invite() → {id, code, expiresAt},
--    list_player_invites() → приглашения со статусом active/used/expired/revoked и именем вошедшего,
--    revoke_player_invite(id) → {id, revokedAt}. RPC входа (только service_role, её зовёт tg-auth):
--    redeem_player_invite(код, tg id, имя, username, фото) — сжечь код и создать или пометить игрока
--    в одной транзакции.
-- Слияние профилей (merge_players, merge_guests) приглашений не касается: удаляемый профиль — без
-- Telegram, а приглашения ссылаются только на профили с Telegram (создатель — админ, вошедший — по
-- tg id); проверка остатков ссылок private.player_references находит новые внешние ключи сама (по
-- каталогу) и отказала бы слиянию, а не потеряла бы запись.
--
-- Гранты: новая таблица — RLS без политик, у anon/authenticated прав нет (хеши и список — только через
-- RPC админа), service_role — select/insert/update/delete (как season_posts 025). Новая колонка players —
-- права выданы на таблицу целиком (002, 011), отдельный грант не нужен. Функции — явно; служебные
-- private.* — revoke у public/anon/authenticated.

-- ---------------------------------------------------------------------------
-- 1. Приглашения
-- ---------------------------------------------------------------------------
create table public.player_invites (
  id         uuid primary key default gen_random_uuid(),
  code_hash  text not null unique,
  created_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references public.players (id) on delete set null,
  revoked_at timestamptz,
  constraint player_invites_code_hash_shape check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint player_invites_expires_after_created check (expires_at > created_at),
  -- Отозвать можно только неиспользованное, сжечь — только неотозванное.
  constraint player_invites_used_or_revoked check (used_at is null or revoked_at is null),
  constraint player_invites_used_by_when_used check (used_by is null or used_at is not null)
);

comment on table public.player_invites is
  'Ссылки-приглашения в клуб (029): t.me/<бот>?startapp=i_<код>. Хранится только SHA-256 кода; одна ссылка — один вход, срок — expires_at. Пишут только RPC create/revoke/redeem_player_invite.';
comment on column public.player_invites.code_hash is
  'SHA-256 кода (hex от UTF-8). Сам код (32 знака base64url, 192 бита) админ видит один раз — в ответе create_player_invite.';
comment on column public.player_invites.used_by is
  'Кто вошёл по ссылке (players.id); ставит redeem_player_invite вместе с used_at.';

alter table public.player_invites enable row level security;

-- Прав по умолчанию нет (ARCHITECTURE.md, «Гранты»); локально default privileges дают ролям лишнее —
-- снимаем, чтобы права совпадали с облаком.
revoke all on table public.player_invites from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.player_invites to service_role;

-- ---------------------------------------------------------------------------
-- 2. Пометка игрока
-- ---------------------------------------------------------------------------
alter table public.players add column joined_by_invite boolean not null default false;

comment on column public.players.joined_by_invite is
  'Вошёл по ссылке-приглашению (029): tg-auth пускает без группы клуба, пока is_active. Ставит redeem_player_invite.';

-- ---------------------------------------------------------------------------
-- 3. RPC
-- ---------------------------------------------------------------------------
-- Хеш кода: тот же, что считает redeem_player_invite по коду из ссылки.
create function private.invite_code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
$$;

revoke execute on function private.invite_code_hash(text) from public, anon, authenticated;

-- Новое приглашение: код возвращается один раз, в базе — только хеш. Срок — 7 дней (INVITE_TTL_DAYS
-- домена; сверяет _shared/invites.test.ts).
create function public.create_player_invite()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_player();
  v_code   text;
  v_invite public.player_invites;
begin
  if not public.is_admin() then
    raise exception 'Приглашать в клуб может только админ'
      using errcode = '42501';
  end if;
  -- 24 байта → 32 знака base64 без «=»; «+» и «/» → «-» и «_»: знаки параметра startapp.
  v_code := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
  insert into public.player_invites (code_hash, created_by, expires_at)
  values (private.invite_code_hash(v_code), v_me, now() + interval '7 days')
  returning * into v_invite;
  return jsonb_build_object('id', v_invite.id, 'code', v_code, 'expiresAt', v_invite.expires_at);
end;
$$;

comment on function public.create_player_invite() is
  'Админ: новая ссылка-приглашение. {id, code, expiresAt}; код показывается один раз, в базе — только хеш. Миграция 029.';

-- Список для админки: свежие сверху, статус на сейчас. Код не возвращается (его в базе нет).
create function public.list_player_invites()
returns table (
  id           uuid,
  status       text,
  created_at   timestamptz,
  expires_at   timestamptz,
  used_at      timestamptz,
  used_by      uuid,
  used_by_name text,
  revoked_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Приглашения видит только админ'
      using errcode = '42501';
  end if;
  return query
  select i.id,
         case
           when i.used_at is not null then 'used'
           when i.revoked_at is not null then 'revoked'
           when i.expires_at <= now() then 'expired'
           else 'active'
         end,
         i.created_at,
         i.expires_at,
         i.used_at,
         i.used_by,
         p.display_name,
         i.revoked_at
  from public.player_invites i
  left join public.players p on p.id = i.used_by
  order by i.created_at desc, i.id
  limit 200;
end;
$$;

comment on function public.list_player_invites() is
  'Админ: последние 200 приглашений — status active/used/expired/revoked, кто и когда вошёл. Миграция 029.';

-- Отзыв: только неиспользованное (по использованному уже вошли — выключают игрока). Повторный отзыв —
-- тот же ответ без изменений (двойное нажатие).
create function public.revoke_player_invite(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite public.player_invites;
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Отозвать приглашение может только админ'
      using errcode = '42501';
  end if;
  select i.* into v_invite from public.player_invites i where i.id = p_id for update;
  if not found then
    raise exception 'Такого приглашения нет — обнови список'
      using errcode = '22023';
  end if;
  if v_invite.used_at is not null then
    raise exception 'По этой ссылке уже вошли — отозвать её нельзя. Закрыть вход можно переключателем «Активен» во вкладке «Игроки»'
      using errcode = 'P0001';
  end if;
  if v_invite.revoked_at is null then
    update public.player_invites i
    set revoked_at = now()
    where i.id = p_id
    returning * into v_invite;
  end if;
  return jsonb_build_object('id', v_invite.id, 'revokedAt', v_invite.revoked_at);
end;
$$;

comment on function public.revoke_player_invite(uuid) is
  'Админ: отозвать неиспользованное приглашение (использованное — P0001). {id, revokedAt}. Миграция 029.';

-- Вход по приглашению (tg-auth, service_role): одна транзакция — сжечь код и создать игрока или
-- пометить существующего (по tg id). Ответ {outcome, playerId?}:
--   ok       — вошёл: код сожжён этим входом или уже был его (второе устройство в ту же секунду);
--   inactive — профиль с этим Telegram отключён: код не тратится;
--   unknown  — такого кода нет (или он не по форме); used — по ссылке уже вошёл другой;
--   revoked  — отозвана; expired — срок вышел.
-- Имя из Telegram берётся только для нового игрока (как в tg-auth); username и фото дальше обновляет
-- tg-auth при каждом входе.
create function public.redeem_player_invite(
  p_code         text,
  p_tg_id        bigint,
  p_display_name text,
  p_username     text default null,
  p_photo_url    text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash   text;
  v_player public.players;
  v_invite public.player_invites;
  v_id     uuid;
begin
  if p_tg_id is null or p_tg_id <= 0 then
    raise exception 'Нужен tg id игрока'
      using errcode = '22023';
  end if;
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{32}$' then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  v_hash := private.invite_code_hash(p_code);

  -- Отключённому профилю код не тратим: войти он всё равно не сможет, пока админ его не включит.
  select p.* into v_player from public.players p where p.tg_id = p_tg_id for update;
  if found and not v_player.is_active then
    return jsonb_build_object('outcome', 'inactive');
  end if;

  -- Сжечь код атомарно: второй вход тем же кодом ждёт блокировку строки, а после неё условие уже
  -- не выполняется — дальше он разбирает, почему.
  update public.player_invites i
  set used_at = now()
  where i.code_hash = v_hash
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  returning i.* into v_invite;

  if not found then
    select i.* into v_invite from public.player_invites i where i.code_hash = v_hash;
    if not found then
      return jsonb_build_object('outcome', 'unknown');
    end if;
    if v_invite.used_at is not null then
      -- Код сжёг этот же человек (параллельный вход): перечитываем игрока — его могла создать
      -- соседняя транзакция уже после нашего первого чтения.
      select p.* into v_player from public.players p where p.tg_id = p_tg_id;
      if found and v_player.id = v_invite.used_by and v_player.is_active then
        return jsonb_build_object('outcome', 'ok', 'playerId', v_player.id);
      end if;
      return jsonb_build_object('outcome', 'used');
    end if;
    if v_invite.revoked_at is not null then
      return jsonb_build_object('outcome', 'revoked');
    end if;
    return jsonb_build_object('outcome', 'expired');
  end if;

  if v_player.id is not null then
    -- Уже был в клубе (например, вышел из группы): постоянный игрок с пометкой.
    update public.players p
    set joined_by_invite = true,
        is_guest = false
    where p.id = v_player.id
    returning p.id into v_id;
  else
    if nullif(btrim(p_display_name), '') is null then
      raise exception 'Нужно имя игрока'
        using errcode = '22023';
    end if;
    insert into public.players (tg_id, display_name, username, photo_url, joined_by_invite)
    values (p_tg_id, btrim(p_display_name), nullif(p_username, ''), nullif(p_photo_url, ''), true)
    -- Профиль с этим tg id только что создал параллельный вход через группу — помечаем его.
    on conflict (tg_id) do update
      set joined_by_invite = true,
          is_guest = false
    returning id into v_id;
  end if;

  update public.player_invites i set used_by = v_id where i.id = v_invite.id;
  return jsonb_build_object('outcome', 'ok', 'playerId', v_id);
end;
$$;

comment on function public.redeem_player_invite(text, bigint, text, text, text) is
  'tg-auth (service_role): вход по ссылке-приглашению — сжечь код и создать или пометить игрока (joined_by_invite). {outcome: ok|inactive|unknown|used|revoked|expired, playerId?}. Миграция 029.';

revoke execute on function
  public.create_player_invite(),
  public.list_player_invites(),
  public.revoke_player_invite(uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_player_invite(),
  public.list_player_invites(),
  public.revoke_player_invite(uuid)
  to authenticated, service_role;

revoke execute on function public.redeem_player_invite(text, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.redeem_player_invite(text, bigint, text, text, text) to service_role;
