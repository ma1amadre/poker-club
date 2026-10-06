-- 001_schema.sql — таблицы клуба.
-- Контракт: ARCHITECTURE.md, раздел «База данных». Права и RLS — в 002, RPC — в 003.
-- Время в БД — UTC (timestamptz); клубное расписание (день недели, время) — по Москве.

-- ---------------------------------------------------------------------------
-- Игроки
-- ---------------------------------------------------------------------------
create table public.players (
  id           uuid primary key default gen_random_uuid(),
  -- Связь с auth-пользователем проставляет tg-auth при первом входе; гость её не имеет.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  tg_id        bigint unique,
  -- 128 символов: в Telegram имя и фамилия до 64 каждая, tg-auth склеивает их.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 128),
  username     text,
  photo_url    text,
  is_guest     boolean not null default false,
  is_admin     boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.players is 'Игроки клуба и гости. Гость — без tg_id, в рейтинг не попадает.';

-- ---------------------------------------------------------------------------
-- Форматы турнира (TournamentFormat в config)
-- ---------------------------------------------------------------------------
create table public.formats (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  -- Форму конфига проверяет домен (validateFormat); БД лишь не даёт положить не-объект.
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Настройки клуба (одна строка)
-- ---------------------------------------------------------------------------
create table public.settings (
  id                    int primary key default 1 check (id = 1),
  group_chat_id         bigint,
  bot_username          text,
  game_weekday          int not null default 4 check (game_weekday between 1 and 7), -- 1=пн…7=вс
  game_time             time not null default '19:00',                               -- по Москве
  announce_hours_before int not null default 48 check (announce_hours_before between 1 and 336),
  default_location      text,
  default_format_id     uuid references public.formats (id) on delete set null,
  season_best_n         int not null default 10 check (season_best_n >= 1),
  ko_points             numeric not null default 0.5 check (ko_points >= 0),
  win_bonus             numeric not null default 1 check (win_bonus >= 0),
  updated_at            timestamptz not null default now()
);

-- Строка создаётся сразу: функции и фронт читают настройки, не проверяя их наличие.
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------------
-- Вечера
-- ---------------------------------------------------------------------------
create table public.evenings (
  id                 uuid primary key default gen_random_uuid(),
  scheduled_at       timestamptz not null,
  location           text,
  note               text,
  status             text not null default 'announced'
                     check (status in ('announced', 'live', 'finished', 'settled', 'cancelled')),
  banker_id          uuid references public.players (id) on delete set null,
  -- Снимок формата на момент создания: правка формата не должна переписывать прошлые вечера.
  format             jsonb not null check (jsonb_typeof(format) = 'object'),
  board_token        uuid not null unique default gen_random_uuid(),
  started_at         timestamptz,
  finished_at        timestamptz,
  settled_at         timestamptz,
  voting_closes_at   timestamptz,
  announce_posted_at timestamptz,
  results_posted_at  timestamptz,
  voting_posted_at   timestamptz,
  created_by         uuid references public.players (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index evenings_scheduled_at_idx on public.evenings (scheduled_at);
-- cron-tick ищет вечера с закрытым голосованием и неотправленным постом.
create index evenings_voting_pending_idx on public.evenings (voting_closes_at)
  where voting_posted_at is null and voting_closes_at is not null;

-- ---------------------------------------------------------------------------
-- Журнал событий вечера (event sourcing; состояние считает replay)
-- ---------------------------------------------------------------------------
create table public.evening_events (
  id         bigserial primary key,
  evening_id uuid not null references public.evenings (id) on delete cascade,
  type       text not null check (type in (
               'join', 'rebuy', 'bust',
               'timer_start', 'timer_pause', 'timer_resume',
               'level_next', 'level_prev', 'hand',
               'payment', 'finish')),
  -- Форму payload по типу проверяет add_event; здесь — только что это объект.
  payload    jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  at         timestamptz not null default now(),
  created_by uuid references public.players (id) on delete set null,
  voided_at  timestamptz,
  voided_by  uuid references public.players (id) on delete set null,
  -- voided_by может обнулиться при удалении игрока, а отметка об отмене — нет.
  check (voided_by is null or voided_at is not null)
);

-- Все чтения журнала — «события вечера по порядку id» (запрос фронта, Realtime-фильтр, replay).
create index evening_events_evening_id_idx on public.evening_events (evening_id, id);

-- ---------------------------------------------------------------------------
-- RSVP на анонс
-- ---------------------------------------------------------------------------
create table public.rsvps (
  evening_id uuid not null references public.evenings (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete cascade,
  status     text not null check (status in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (evening_id, player_id) -- он же индекс по evening_id
);

-- ---------------------------------------------------------------------------
-- Прогнозы: победитель и первый вылет
-- ---------------------------------------------------------------------------
-- winner_id = first_out_id намеренно разрешено: первым вылететь, сделать ребай и выиграть — реальный сценарий.
create table public.predictions (
  evening_id   uuid not null references public.evenings (id) on delete cascade,
  player_id    uuid not null references public.players (id) on delete cascade,
  winner_id    uuid references public.players (id) on delete set null,
  first_out_id uuid references public.players (id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (evening_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Голоса: рука / блеф / бэд-бит вечера
-- ---------------------------------------------------------------------------
create table public.votes (
  evening_id uuid not null references public.evenings (id) on delete cascade,
  voter_id   uuid not null references public.players (id) on delete cascade,
  category   text not null check (category in ('hand', 'bluff', 'badbeat')),
  nominee_id uuid not null references public.players (id) on delete cascade,
  caption    text check (char_length(caption) <= 200),
  photo_path text,
  created_at timestamptz not null default now(),
  primary key (evening_id, voter_id, category),
  check (voter_id <> nominee_id)
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- Ставим время на сервере: клиентским часам в Telegram WebView доверять нельзя.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

create trigger rsvps_set_updated_at
  before update on public.rsvps
  for each row execute function public.set_updated_at();

create trigger predictions_set_updated_at
  before update on public.predictions
  for each row execute function public.set_updated_at();
