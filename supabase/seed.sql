-- seed.sql — тестовые данные ТОЛЬКО для локального стека (supabase db reset).
-- В облако не попадает: db push накатывает миграции, но не seed.
--
-- Состав: 6 игроков (tg_id 1001–1006, 1001 — админ Женя) и гость, настройки (клубный формат — из миграции 011),
-- отменённый вечер, 5 завершённых вечеров (2026-Q3 ×4, 2026-Q4 ×1) и анонс на ближайший четверг.
-- Сегодня по сценарию — вторник 2026-10-06.
--
-- auth.users здесь нет: их создаёт tg-auth при первом входе и сам связывает players.auth_user_id по tg_id.
--
-- Каждый завершённый вечер проходит replay без ошибок: ребаи только у вылетевших и до конца
-- 5-го уровня (таймер стартует на 10-й минуте, уровни по 40 мин → ребаи до 210-й минуты),
-- к finish жив ровно один. Платежи у рассчитанных вечеров сходятся в ноль — суммы посчитаны
-- по правилам money.ts (весь взнос 500 — в фонд, призовые 70/30; денег за нокауты нет — баунти
-- убрано 07.10.2026) и сверены прогоном домена по данным из БД.
--
-- Ачивки, которые должны получиться: первая кровь (Дима), охотник (несколько), хет-трик (Саша,
-- вечера 1–3), камбэк (Лёша, вечер 4 после двух ребаев), оракул (Миша угадал Сашу трижды подряд),
-- железный стул за 2026-Q3 (Женя, Саша, Дима), ребай-король 2026-Q3 (Лёша), звёзды из голосований.

-- ---------------------------------------------------------------------------
-- Игроки
-- ---------------------------------------------------------------------------
-- Фиксированные id: на них удобно ссылаться в тестах и при отладке.
insert into public.players (id, tg_id, display_name, username, is_guest, is_admin) values
  ('a0000000-0000-4000-8000-000000001001', 1001, 'Женя',  'zhenya_local', false, true),
  ('a0000000-0000-4000-8000-000000001002', 1002, 'Саша',  'sasha_local',  false, false),
  ('a0000000-0000-4000-8000-000000001003', 1003, 'Дима',  'dima_local',   false, false),
  ('a0000000-0000-4000-8000-000000001004', 1004, 'Лёша',  'lesha_local',  false, false),
  ('a0000000-0000-4000-8000-000000001005', 1005, 'Миша',  null,           false, false),
  ('a0000000-0000-4000-8000-000000001006', 1006, 'Костя', 'kostya_local', false, false),
  -- Гость: без tg_id, войти не может, в рейтинг не попадает, но играет и бывает номинантом.
  ('a0000000-0000-4000-8000-000000009001', null, 'Вова (гость)', null, true, false);

-- Имя для озвучки (миграция 016): «Вова (гость)» голос не прочитает (скобки) — табло зовёт его так.
update public.players set spoken_name = 'В+ова' where id = 'a0000000-0000-4000-8000-000000009001';

-- Короткие коды игроков для читаемых списков событий ниже.
-- Без on commit drop: seed может выполняться по одному оператору в автокоммите, и таблица
-- исчезла бы сразу после создания. Удаляются явно в конце файла.
create temporary table seed_pl (code text primary key, id uuid not null);
insert into seed_pl values
  ('J', 'a0000000-0000-4000-8000-000000001001'),
  ('S', 'a0000000-0000-4000-8000-000000001002'),
  ('D', 'a0000000-0000-4000-8000-000000001003'),
  ('L', 'a0000000-0000-4000-8000-000000001004'),
  ('M', 'a0000000-0000-4000-8000-000000001005'),
  ('K', 'a0000000-0000-4000-8000-000000001006'),
  ('G', 'a0000000-0000-4000-8000-000000009001');

-- ---------------------------------------------------------------------------
-- Формат и настройки
-- ---------------------------------------------------------------------------
-- Клубный формат (id f0000000-…-0001, ровно DEFAULT_FORMAT из domain/format.ts) создаёт миграция 011 —
-- та же, что заводит его в облаке. Здесь на него только ссылаемся.

-- Строку settings создала миграция 001, формат по умолчанию проставила 011. group_chat_id не задаём:
-- без группы tg-auth пускает только ADMIN_TG_ID, а cron-tick с TELEGRAM_DRY_RUN=1 лишь логирует посты.
update public.settings
set bot_username          = 'poker_club_local_bot',
    game_weekday          = 4,         -- четверг
    game_time             = '19:00',   -- по Москве
    announce_hours_before = 48,
    gameday_hours_before  = 5,         -- пост в день игры (миграция 014)
    default_location      = 'У Жени',
    default_format_id     = 'f0000000-0000-4000-8000-000000000001',
    season_best_n         = 10,
    ko_points             = 0.5,
    win_bonus             = 1
where id = 1;

-- ---------------------------------------------------------------------------
-- Вечера
-- ---------------------------------------------------------------------------
-- 19:00 МСК = 16:00 UTC. Минуты событий ниже отсчитываются от scheduled_at.
-- Служебные отметки постов (results/voting/announce_posted_at) проставлены, чтобы локальный
-- cron-tick не «добивал» посты по историческим вечерам.
insert into public.evenings (id, scheduled_at, location, note, status, banker_id, format, created_by) values
  ('e0000000-0000-4000-8000-000000000001', '2026-08-27 16:00:00+00', 'У Жени', null,
   'settled',   'a0000000-0000-4000-8000-000000001001', '{}', 'a0000000-0000-4000-8000-000000001001'),
  ('e0000000-0000-4000-8000-000000000007', '2026-09-03 16:00:00+00', 'У Жени', null,
   'cancelled', null,                                    '{}', 'a0000000-0000-4000-8000-000000001001'),
  ('e0000000-0000-4000-8000-000000000002', '2026-09-10 16:00:00+00', 'У Саши', 'Саша привёл друга',
   'settled',   'a0000000-0000-4000-8000-000000001002', '{}', 'a0000000-0000-4000-8000-000000001001'),
  ('e0000000-0000-4000-8000-000000000003', '2026-09-17 16:00:00+00', 'У Жени', null,
   'settled',   'a0000000-0000-4000-8000-000000001003', '{}', 'a0000000-0000-4000-8000-000000001001'),
  ('e0000000-0000-4000-8000-000000000004', '2026-09-24 16:00:00+00', 'У Димы', null,
   'settled',   'a0000000-0000-4000-8000-000000001001', '{}', 'a0000000-0000-4000-8000-000000001001'),
  -- Последний вечер: игра окончена, но расчёт не закрыт — есть долги.
  ('e0000000-0000-4000-8000-000000000005', '2026-10-01 16:00:00+00', 'У Жени', null,
   'finished',  'a0000000-0000-4000-8000-000000001004', '{}', 'a0000000-0000-4000-8000-000000001001'),
  -- Анонс на ближайший четверг.
  ('e0000000-0000-4000-8000-000000000006', '2026-10-08 16:00:00+00', 'У Жени', 'Возьмите наличку на ребаи',
   'announced', 'a0000000-0000-4000-8000-000000001002', '{}', 'a0000000-0000-4000-8000-000000001001');

-- Снимок формата — тот же клубный. Прошедшие вечера — без шага призовых (payoutStepRub, миграция 027):
-- они сыграны до него и считаются до рубля, как в облаке (027 снимки вечеров не трогает); расчёты
-- ниже сходятся в ноль именно так. Анонс — с шагом: как вечер, созданный после 027.
update public.evenings
set format = (select f.config - 'payoutStepRub' from public.formats f
              where f.id = 'f0000000-0000-4000-8000-000000000001');
update public.evenings
set format = (select f.config from public.formats f where f.id = 'f0000000-0000-4000-8000-000000000001')
where status = 'announced';

-- Причина отмены — отдельно от заметки (миграция 010).
update public.evenings set cancel_reason = 'Не собрали состав'
where id = 'e0000000-0000-4000-8000-000000000007';

-- ---------------------------------------------------------------------------
-- Журналы вечеров
-- ---------------------------------------------------------------------------
-- (вечер, n, минута от scheduled_at, тип, игрок, by, сумма, отменено_через_мин)
-- n задаёт порядок вставки = порядок id = порядок для replay.
create temporary table seed_ev (
  ev     int,
  n      int,
  m      int,
  type   text,
  pid    text,
  by     text[],
  amount int,
  void_after int
);

insert into seed_ev (ev, n, m, type, pid, by, amount, void_after) values
  -- Вечер 1 (27.08), банкир Женя. Входы 8 → фонд 4000 (2800/1200).
  -- Места: Саша, Дима, Женя, Лёша, Миша. Первая кровь клуба — Дима выбивает Лёшу.
  (1,  1,   0, 'join',        'J', null, null, null),
  (1,  2,   1, 'join',        'S', null, null, null),
  (1,  3,   2, 'join',        'D', null, null, null),
  (1,  4,   3, 'join',        'L', null, null, null),
  (1,  5,   5, 'join',        'M', null, null, null),
  (1,  6,  10, 'timer_start', null, null, null, null),
  (1,  7,  55, 'bust',        'L', '{D}', null, null),
  (1,  8,  58, 'rebuy',       'L', null, null, null),
  (1,  9,  60, 'payment',     'L', null, 500, null),     -- Лёша сразу отдал за ребай
  (1, 10, 120, 'bust',        'M', '{J}', null, null),
  (1, 11, 125, 'rebuy',       'M', null, null, null),
  (1, 12, 170, 'bust',        'L', '{S}', null, null),
  (1, 13, 175, 'rebuy',       'L', null, null, null),    -- 5-й уровень, ребаи ещё открыты
  (1, 14, 215, 'bust',        'M', '{D}', null, null),   -- 6-й уровень: вылет окончательный
  (1, 15, 250, 'bust',        'L', '{S,D}', null, null), -- сплит: KO обоим
  (1, 16, 280, 'bust',        'J', '{S}', null, null),
  (1, 17, 300, 'bust',        'D', '{S}', null, null),
  (1, 18, 301, 'finish',      null, null, null, null),
  (1, 19, 305, 'payment',     'J', null, 500, null),
  (1, 20, 306, 'payment',     'L', null, 1000, null),
  (1, 21, 307, 'payment',     'M', null, 1000, null),
  (1, 22, 310, 'payment',     'S', null, -2300, null),
  (1, 23, 311, 'payment',     'D', null, -700, null),

  -- Вечер 2 (10.09), банкир Саша. Гость Вова. Пауза 15 минут на пиццу.
  -- Входы 7 → фонд 3500 (2450/1050). Места: Саша, Костя, Дима, Женя, Вова.
  (2,  1,   0, 'join',        'J', null, null, null),
  (2,  2,   1, 'join',        'S', null, null, null),
  (2,  3,   2, 'join',        'D', null, null, null),
  (2,  4,   4, 'join',        'K', null, null, null),
  (2,  5,   6, 'join',        'G', null, null, null),
  (2,  6,  10, 'timer_start', null, null, null, null),
  (2,  7,  40, 'bust',        'G', '{K}', null, null),
  (2,  8,  42, 'rebuy',       'G', null, null, null),
  (2,  9,  90, 'bust',        'K', '{S}', null, null),
  (2, 10,  95, 'rebuy',       'K', null, null, null),
  (2, 11, 120, 'timer_pause', null, null, null, null),
  (2, 12, 135, 'timer_resume', null, null, null, null),
  (2, 13, 150, 'bust',        'G', '{J}', null, null),
  (2, 14, 230, 'bust',        'J', '{S}', null, null),
  (2, 15, 260, 'bust',        'D', '{K}', null, null),
  (2, 16, 290, 'bust',        'K', '{S}', null, null),
  (2, 17, 291, 'finish',      null, null, null, null),
  (2, 18, 295, 'payment',     'J', null, 500, null),
  (2, 19, 296, 'payment',     'D', null, 500, null),
  (2, 20, 297, 'payment',     'G', null, 1000, null),
  (2, 21, 300, 'payment',     'S', null, -1950, null),
  (2, 22, 301, 'payment',     'K', null, -50, null),

  -- Вечер 3 (17.09), банкир Дима. Шестеро, много ребаев; одна ошибка ввода отменена.
  -- Входы 11 → фонд 5500 (3850/1650). Места: Саша, Дима, Женя, Лёша, Костя, Миша.
  (3,  1,   0, 'join',        'J', null, null, null),
  (3,  2,   1, 'join',        'S', null, null, null),
  (3,  3,   1, 'join',        'D', null, null, null),
  (3,  4,   2, 'join',        'L', null, null, null),
  (3,  5,   3, 'join',        'M', null, null, null),
  (3,  6,   4, 'join',        'K', null, null, null),
  (3,  7,  10, 'timer_start', null, null, null, null),
  (3,  8,  30, 'bust',        'M', '{L}', null, null),
  (3,  9,  33, 'rebuy',       'M', null, null, null),
  (3, 10,  70, 'bust',        'J', '{K}', null, null),
  (3, 11,  75, 'rebuy',       'J', null, null, null),
  (3, 12,  99, 'bust',        'D', '{S}', null, 1),      -- не тот игрок: банкир отменил через минуту
  (3, 13, 100, 'bust',        'L', '{S}', null, null),
  (3, 14, 102, 'rebuy',       'L', null, null, null),
  (3, 15, 140, 'bust',        'M', '{D}', null, null),
  (3, 16, 145, 'rebuy',       'M', null, null, null),
  (3, 17, 185, 'bust',        'L', '{M}', null, null),
  (3, 18, 190, 'rebuy',       'L', null, null, null),
  (3, 19, 230, 'bust',        'M', '{S,K}', null, null),
  (3, 20, 255, 'bust',        'K', '{S}', null, null),
  (3, 21, 270, 'bust',        'L', '{D}', null, null),
  (3, 22, 300, 'bust',        'J', '{S}', null, null),
  (3, 23, 330, 'bust',        'D', '{S}', null, null),
  (3, 24, 331, 'finish',      null, null, null, null),
  (3, 25, 335, 'payment',     'J', null, 1000, null),
  (3, 26, 336, 'payment',     'L', null, 1500, null),
  (3, 27, 337, 'payment',     'M', null, 1500, null),
  (3, 28, 338, 'payment',     'K', null, 500, null),
  (3, 29, 340, 'payment',     'S', null, -3350, null),
  (3, 30, 341, 'payment',     'D', null, -1150, null),

  -- Вечер 4 (24.09), банкир Женя. Камбэк Лёши после двух ребаев; один вылет без выбившего.
  -- Входы 8 → фонд 4000 (2800/1200). Места: Лёша, Женя, Дима, Саша, Вова.
  (4,  1,   0, 'join',        'J', null, null, null),
  (4,  2,   1, 'join',        'S', null, null, null),
  (4,  3,   2, 'join',        'D', null, null, null),
  (4,  4,   3, 'join',        'L', null, null, null),
  (4,  5,   5, 'join',        'G', null, null, null),
  (4,  6,  10, 'timer_start', null, null, null, null),
  (4,  7,  50, 'bust',        'L', '{S}', null, null),
  (4,  8,  52, 'rebuy',       'L', null, null, null),
  (4,  9,  80, 'bust',        'G', '{D}', null, null),
  (4, 10,  85, 'rebuy',       'G', null, null, null),
  (4, 11, 130, 'bust',        'L', '{J}', null, null),
  (4, 12, 132, 'rebuy',       'L', null, null, null),
  (4, 13, 195, 'bust',        'G', '{L}', null, null),
  (4, 14, 240, 'bust',        'S', '{L}', null, null),
  (4, 15, 275, 'bust',        'D', '{}', null, null),    -- мультипот, выбившего не записали
  (4, 16, 300, 'bust',        'J', '{L}', null, null),
  (4, 17, 301, 'finish',      null, null, null, null),
  (4, 18, 305, 'payment',     'S', null, 500, null),
  (4, 19, 306, 'payment',     'D', null, 500, null),
  (4, 20, 307, 'payment',     'G', null, 1000, null),
  (4, 21, 310, 'payment',     'J', null, -700, null),
  (4, 22, 311, 'payment',     'L', null, -1300, null),

  -- Вечер 5 (01.10), банкир Лёша. Костя опоздал (поздняя регистрация). Расчёт не закрыт:
  -- Саша должен 500, Костя 500; банкир должен Диме 1300 и себе 700.
  -- Входы 8 → фонд 4000 (2800/1200). Места: Дима, Лёша, Женя, Костя, Саша, Миша.
  (5,  1,   0, 'join',        'J', null, null, null),
  (5,  2,   1, 'join',        'S', null, null, null),
  (5,  3,   2, 'join',        'D', null, null, null),
  (5,  4,   3, 'join',        'L', null, null, null),
  (5,  5,   4, 'join',        'M', null, null, null),
  (5,  6,  10, 'timer_start', null, null, null, null),
  (5,  7,  45, 'bust',        'M', '{J}', null, null),
  (5,  8,  47, 'rebuy',       'M', null, null, null),
  (5,  9,  60, 'join',        'K', null, null, null),
  (5, 10, 110, 'bust',        'S', '{D}', null, null),
  (5, 11, 112, 'rebuy',       'S', null, null, null),
  (5, 12, 175, 'bust',        'M', '{K}', null, null),
  (5, 13, 220, 'bust',        'S', '{D,J}', null, null),
  (5, 14, 250, 'bust',        'K', '{L}', null, null),
  (5, 15, 280, 'bust',        'J', '{D}', null, null),
  (5, 16, 320, 'bust',        'L', '{D}', null, null),
  (5, 17, 321, 'finish',      null, null, null, null),
  (5, 18, 325, 'payment',     'J', null, 500, null),
  (5, 19, 326, 'payment',     'M', null, 1000, null),
  (5, 20, 327, 'payment',     'S', null, 500, null),
  (5, 21, 330, 'payment',     'D', null, -1000, null);

-- Журналы пишутся задним числом в уже рассчитанные вечера: триггер миграции 008 («правка журнала
-- открывает закрытый расчёт») на время заливки выключен.
alter table public.evening_events disable trigger evening_events_reopen_settlement_on_insert;
alter table public.evening_events disable trigger evening_events_reopen_settlement_on_void;

insert into public.evening_events (evening_id, type, payload, at, created_by)
select
  e.id,
  v.type,
  case
    when v.type in ('join', 'rebuy') then
      jsonb_build_object('playerId', p.id)
    when v.type = 'bust' then
      jsonb_build_object(
        'playerId', p.id,
        'by', coalesce(
          (select jsonb_agg(k.id order by u.ord)
           from unnest(v.by) with ordinality as u(code, ord)
           join seed_pl k on k.code = u.code),
          '[]'::jsonb))
    when v.type = 'payment' then
      jsonb_build_object('playerId', p.id, 'amountRub', v.amount)
    else '{}'::jsonb
  end,
  e.scheduled_at + v.m * interval '1 minute',
  e.banker_id
from seed_ev v
join public.evenings e
  on e.id = ('e0000000-0000-4000-8000-00000000000' || v.ev)::uuid
left join seed_pl p on p.code = v.pid
order by v.ev, v.n;

-- Отменённые события: отменил банкир вечера.
update public.evening_events ee
set voided_at = ee.at + v.void_after * interval '1 minute',
    voided_by = e.banker_id
from seed_ev v
join public.evenings e
  on e.id = ('e0000000-0000-4000-8000-00000000000' || v.ev)::uuid
left join seed_pl p on p.code = v.pid
where v.void_after is not null
  and ee.evening_id = e.id
  and ee.at = e.scheduled_at + v.m * interval '1 minute'
  and ee.type = v.type
  and ee.payload ->> 'playerId' = p.id::text;

alter table public.evening_events enable trigger evening_events_reopen_settlement_on_insert;
alter table public.evening_events enable trigger evening_events_reopen_settlement_on_void;

-- Отметки времени вечеров — из журнала, как их выставили бы add_event и mark_settled.
update public.evenings e
set started_at = t.started_at,
    finished_at = t.finished_at,
    voting_closes_at = t.finished_at + interval '24 hours',
    settled_at = case when e.status = 'settled' then t.finished_at + interval '2 days' end,
    announce_posted_at = e.scheduled_at - interval '48 hours',
    results_posted_at = t.finished_at + interval '1 minute',
    voting_posted_at = t.finished_at + interval '24 hours 5 minutes'
from (
  select ee.evening_id,
         min(ee.at) filter (where ee.type = 'timer_start') as started_at,
         max(ee.at) filter (where ee.type = 'finish')      as finished_at
  from public.evening_events ee
  where ee.voided_at is null
  group by ee.evening_id
) t
where t.evening_id = e.id;

update public.evenings
set announce_posted_at = scheduled_at - interval '48 hours'
where status in ('announced', 'cancelled');

-- Что группа знает из анонса (миграция 008): время, место, отменён ли — как announceSnapshot в
-- supabase/functions/_shared/announce.ts.
update public.evenings
set announce_snapshot = jsonb_build_object(
      'scheduledAt', to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'location', nullif(btrim(location), ''),
      'cancelled', status = 'cancelled')
where announce_posted_at is not null;

-- ---------------------------------------------------------------------------
-- RSVP
-- ---------------------------------------------------------------------------
insert into public.rsvps (evening_id, player_id, status, updated_at)
select ('e0000000-0000-4000-8000-00000000000' || r.ev)::uuid, p.id, r.status,
       timestamptz '2026-08-25 12:00:00+00' + (r.ev * 7 + r.n) * interval '1 hour'
from (values
  -- Отменённый вечер: «да» сказали только двое.
  (7, 1, 'J', 'yes'), (7, 2, 'S', 'maybe'), (7, 3, 'D', 'no'), (7, 4, 'L', 'no'), (7, 5, 'K', 'yes'),
  -- Анонс на 08.10.
  (6, 1, 'J', 'yes'), (6, 2, 'S', 'yes'), (6, 3, 'D', 'maybe'), (6, 4, 'L', 'yes'),
  (6, 5, 'M', 'no'),  (6, 6, 'K', 'yes')
) as r(ev, n, code, status)
join seed_pl p on p.code = r.code;

-- ---------------------------------------------------------------------------
-- Прогнозы (победитель 3 очка, первый вылет 2)
-- ---------------------------------------------------------------------------
-- Миша угадывает Сашу в вечерах 1–3 подряд → «Оракул». Костя в вечере 1 и Лёша в вечере 2
-- прогнозируют, не играя: это разрешено.
insert into public.predictions (evening_id, player_id, winner_id, first_out_id, updated_at)
select e.id, p.id, w.id, f.id, e.scheduled_at - interval '3 hours'
from (values
  (1, 'M', 'S', 'L'), (1, 'J', 'J', 'M'), (1, 'D', 'D', 'L'), (1, 'K', 'S', 'M'),
  (2, 'M', 'S', 'G'), (2, 'J', 'S', 'K'), (2, 'L', 'K', 'G'),
  (3, 'M', 'S', 'J'), (3, 'D', 'S', 'M'), (3, 'K', 'K', 'L'),
  (4, 'M', 'S', 'G'), (4, 'J', 'L', 'G'), (4, 'S', 'S', 'L'),
  (5, 'M', 'D', 'M'), (5, 'J', 'J', 'K'), (5, 'K', 'D', 'S'),
  -- Анонс: чужие прогнозы скрыты RLS, пока вечер announced.
  (6, 'J', 'S', 'L'), (6, 'M', 'D', 'K')
) as x(ev, code, winner, first_out)
join public.evenings e on e.id = ('e0000000-0000-4000-8000-00000000000' || x.ev)::uuid
join seed_pl p on p.code = x.code
join seed_pl w on w.code = x.winner
join seed_pl f on f.code = x.first_out;

-- ---------------------------------------------------------------------------
-- Голоса (только игравшие, не за себя; голосование всех вечеров уже закрыто)
-- ---------------------------------------------------------------------------
insert into public.votes (evening_id, voter_id, category, nominee_id, caption, created_at)
select e.id, vt.id, x.category, nm.id, x.caption, e.finished_at + x.after_min * interval '1 minute'
from (values
  (1, 'J', 'hand',    'S', 'Каре дам на ривере против фулл-хауса', 20),
  (1, 'D', 'hand',    'S', null, 25),
  (1, 'L', 'bluff',   'J', 'Олл-ин с 7-2 разномастными — и все сбросили', 40),
  (1, 'M', 'badbeat', 'L', 'Тузы против десяток, десятка на ривере', 60),
  (1, 'S', 'badbeat', 'L', null, 90),
  (2, 'J', 'bluff',   'G', 'Гость поставил весь стек на пустой доске', 30),
  (2, 'K', 'bluff',   'G', null, 35),
  (2, 'D', 'hand',    'S', 'Стрит-флеш до валета', 50),
  (3, 'J', 'hand',    'S', 'Стрит-флеш на тёрне', 15),
  (3, 'D', 'hand',    'S', null, 18),
  (3, 'L', 'hand',    'D', null, 22),
  (3, 'K', 'bluff',   'M', 'Ререйз на ривере без пары', 30),
  (3, 'S', 'bluff',   'M', null, 31),
  (3, 'M', 'badbeat', 'L', 'Флеш против сета, спарилась доска', 45),
  (4, 'J', 'hand',    'L', 'Третий вход и победа', 10),
  (4, 'S', 'hand',    'L', null, 12),
  (4, 'D', 'badbeat', 'S', null, 20),
  (5, 'J', 'hand',    'D', 'Четыре нокаута за вечер', 15),
  (5, 'S', 'hand',    'D', null, 16),
  (5, 'M', 'bluff',   'K', 'Опоздал на час и сразу пошёл в атаку', 25),
  (5, 'K', 'badbeat', 'S', null, 40)
) as x(ev, voter, category, nominee, caption, after_min)
join public.evenings e on e.id = ('e0000000-0000-4000-8000-00000000000' || x.ev)::uuid
join seed_pl vt on vt.code = x.voter
join seed_pl nm on nm.code = x.nominee;

drop table seed_ev;
drop table seed_pl;

-- ---------------------------------------------------------------------------
-- Болельщик (миграция 024): кто сыграл настоящий вечер — «играет», как backfill миграции (seed
-- заливается после миграций, и backfill этих игроков не видит). Вопроса «Играешь или следишь?» на
-- главной у них нет; у нового профиля из tg-auth он появится.
-- ---------------------------------------------------------------------------
update public.players p
set is_spectator = false
where not p.is_guest
  and p.is_spectator is null
  and exists (
    select 1
    from public.evening_events ee
    join public.evenings e on e.id = ee.evening_id
    where ee.type = 'join'
      and ee.voided_at is null
      and ee.payload ->> 'playerId' = p.id::text
      and not e.is_training);

-- ---------------------------------------------------------------------------
-- Vault: адрес и секрет для локального cron (миграция 005)
-- ---------------------------------------------------------------------------
-- host.docker.internal — потому что запрос идёт из контейнера БД к API на хосте (порт 57321).
-- cron_secret миграция 011 уже создала случайным; локально заменяем его на известное значение,
-- чтобы cron-tick можно было дёрнуть руками:
--   curl -X POST http://127.0.0.1:57321/functions/v1/cron-tick -H 'x-cron-secret: local-cron-secret'
-- Обновляем, а не создаём: имя секрета в Vault уникально, второй create_secret упал бы.
do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret('http://host.docker.internal:57321', 'project_url',
                                'Адрес API для cron-tick (локальный стек)');
  end if;
  select id into v_id from vault.secrets where name = 'cron_secret';
  if v_id is null then
    perform vault.create_secret('local-cron-secret', 'cron_secret',
                                'Заголовок x-cron-secret для cron-tick (локальный стек)');
  else
    perform vault.update_secret(v_id, 'local-cron-secret', null,
                                'Заголовок x-cron-secret для cron-tick (локальный стек)');
  end if;
end;
$$;
