# poker-club — архитектурный контракт

Telegram Mini App для еженедельного домашнего турнира (4–6 игроков). Концепция и все продуктовые
решения: `C:\Users\JUK\.claude\plans\dynamic-crafting-fairy.md`. Этот файл — технический контракт:
имена таблиц, колонок, RPC, типов и функций, которые ОБЯЗАНЫ совпадать между частями системы.
Меняешь контракт — меняй этот файл в том же коммите.

## Стек и раскладка

- Фронт: React 19 + Vite 8 + TS 6, TanStack Query, react-router 7 (**HashRouter** — GitHub Pages
  без rewrite), supabase-js 2, `qrcode`. Сборка на GitHub Pages под `/poker-club/` (`BASE_PATH`).
- Бэкенд: Supabase (Postgres + RLS, Realtime, Storage, Edge Functions на Deno 2, pg_cron + pg_net).
- Локальный стек на портах **573xx** (API 57321, DB 57322, Studio 57323, Inbucket 57324).

```
supabase/
  config.toml
  migrations/NNN_name.sql
  seed.sql                       # локальные тестовые данные
  functions/
    _shared/domain/*.ts          # ЧИСТАЯ логика: без импортов кроме относительных './x.ts'
    _shared/domain/*.test.ts     # vitest (запускается из корня `npm test`)
    _shared/telegram.ts          # initData, Bot API
    _shared/admin.ts             # service-клиент supabase-js для функций
    _shared/messages.ts          # тексты постов бота
    tg-auth/index.ts
    notify/index.ts
    cron-tick/index.ts
src/
  main.tsx, app/*, pages/*, shared/{supabase,telegram,auth,api,ui,lib}/*
  vendor/materia/*               # вендоренная «Материя» (scripts/sync-materia.mjs)
scripts/                         # node-скрипты разработки
```

Правило импорта домена: во фронте `import { replay } from '@domain/replay.ts'` (alias в vite и
tsconfig), в функциях — относительным путём `../_shared/domain/replay.ts`. Внутри домена — только
относительные импорты с расширением `.ts`, никаких npm-пакетов, `Date.now()` не вызывать (время
передаётся параметром `nowMs`).

## Доменная модель (supabase/functions/_shared/domain)

Вечер — **журнал событий** (event sourcing). Всё состояние (уровень, кто в игре, места, нокауты,
фонд, баунти, долги) вычисляется функцией `replay` из формата и событий. Отмена действия —
пометка события `voided`, история сохраняется.

### types.ts
```ts
export type PlayerId = string; // uuid players.id

export type LevelTrigger =
  | { type: 'time'; minutes: number }
  | { type: 'eliminations'; count: number } // уровень растёт после N вылетов С НАЧАЛА уровня
  | { type: 'hands'; count: number };       // после N событий 'hand' с начала уровня

export interface BlindLevel { sb: number; bb: number; ante?: number; trigger: LevelTrigger }

export interface TournamentFormat {
  name: string;
  buyInRub: number;        // 500 — цена входа и ребая
  startingChips: number;   // 500 — фишек за вход и за ребай
  bountyRub: number;       // 100 — из каждого входа/ребая «за голову»; в фонд идёт buyIn - bounty
  rebuyUntilLevel: number; // 5 — вход/ребай разрешён, пока номер текущего уровня (с 1) <= этого
  rebuyLimit: number | null; // null = без лимита (решение клуба)
  payoutPct: number[];     // [70, 30]
  levels: BlindLevel[];    // после последнего уровня блайнды остаются последними
}

export type EventType =
  | 'join' | 'rebuy' | 'bust'
  | 'timer_start' | 'timer_pause' | 'timer_resume'
  | 'level_next' | 'level_prev' | 'hand'
  | 'payment' | 'finish';

export type EventPayload =
  | { playerId: PlayerId }                                   // join, rebuy
  | { playerId: PlayerId; by: PlayerId[] }                   // bust; by = кто выбил (0..n)
  | { playerId: PlayerId; amountRub: number; note?: string } // payment: + игрок→банкир, − банкир→игрок
  | Record<string, never>;                                   // timer_*, level_*, hand, finish

export interface EveningEvent {
  id: number; type: EventType; payload: EventPayload;
  at: string;          // ISO, серверное время вставки
  voided: boolean;     // voided-события replay игнорирует
}
```

### Правила replay (replay.ts → `replay(format, events, nowMs): EveningState`)
- События сортируются по `id` (порядок вставки), voided пропускаются.
- `join`: игрок входит (entries += 1, alive). Разрешён, пока вход открыт (`rebuysOpen`) — то есть
  это и поздняя регистрация. Повторный join того же игрока — ошибка.
- `rebuy`: только для вылетевшего игрока (alive=false), пока `rebuysOpen` и не превышен лимит.
- `bust {playerId, by}`: игрок вылетел. Каждый игрок из `by` получает +1 нокаут (KO засчитывается
  каждому при дележе). «Голова» жертвы (`bountyRub`) делится поровну между `by` в целых рублях,
  остаток — первому в списке; если `by` пуст — голова «сиротская» и уходит победителю.
  Каждый bust считается нокаутом, даже если жертва потом сделала ребай.
- Таймер: `timer_start` запускает уровень 1; `timer_pause`/`timer_resume`; время уровня считается
  только в состоянии running. Уровень с триггером `time` сам переходит в следующий, когда время
  истекло (переход вычисляется, отдельного события нет; лишнее время переносится в следующий
  уровень). `level_next`/`level_prev` — ручной переход, обнуляет прогресс нового уровня.
  Триггеры `eliminations`/`hands` считают bust/hand с начала текущего уровня.
- `rebuysOpen` = вечер не завершён И (таймер не запущен ИЛИ номер текущего уровня <= rebuyUntilLevel).
- Окончательный вылет = bust, после которого у игрока не было rebuy. Места: последний живой — 1-е,
  дальше в порядке, обратном окончательным вылетам. До завершения места известны только у
  окончательно вылетевших после закрытия ребаев.
- `finish`: банкир завершает вечер. Допустим, если жив ровно 1 игрок (ребаи могут быть ещё открыты —
  тогда finish их закрывает). `finished = true` только после события finish. Время после finish не
  идёт; чтобы отмена finish не запускала таймер задним числом, `add_event` при идущем таймере пишет
  перед finish явный `timer_pause` с тем же `at` (миграция 007).
- Деньги (money.ts): `prizePoolRub = totalEntries * (buyInRub - bountyRub)`; выплаты по `payoutPct`
  для первых min(n_игроков, payoutPct.length) мест с перенормировкой до 100%, вниз до рубля, остаток
  1-му месту. Победитель забирает свою голову и сиротские. Сумма всех выплат + баунти ровно равна
  сумме всех взносов — это инвариант, его проверяют тесты.
- Ошибочные события (ребай живого, bust мёртвого, join после закрытия) не ломают replay: они
  пропускаются и попадают в `state.errors: {eventId, message}[]`. `canApply(format, state, type, payload, nowMs)`
  возвращает текст ошибки или null — фронт проверяет перед отправкой.

```ts
export interface PlayerState {
  playerId: PlayerId; joinedAt: string; entries: number; rebuys: number; alive: boolean;
  busts: number; finalBustEventId: number | null; place: number | null;
  kos: number; koVictims: PlayerId[]; bountyWonRub: number; bustLevel: number | null;
}
export interface TimerState {
  status: 'not_started' | 'running' | 'paused';
  levelIndex: number;          // 0-based
  levelElapsedMs: number;
  levelRemainingMs: number | null; // null для не-time триггеров
  handsInLevel: number; bustsInLevel: number;
  totalElapsedMs: number;      // чистое игровое время без пауз
}
export interface EveningState {
  players: Record<PlayerId, PlayerState>;
  joinOrder: PlayerId[];
  timer: TimerState;
  currentLevel: BlindLevel; nextLevel: BlindLevel | null;
  rebuysOpen: boolean; aliveCount: number; totalEntries: number; totalChips: number;
  prizePoolRub: number; finished: boolean;
  places: PlayerId[];          // index 0 = 1-е место; полон только при finished
  firstBustPlayerId: PlayerId | null; // для прогноза «кто вылетит первым» = первый bust вечера
  errors: { eventId: number; message: string }[];
}
```

### Остальные модули
- `money.ts`: `computeMoney(format, state) → Record<PlayerId, {owesRub, prizeRub, bountyRub, netRub}>`;
  `settlement(money, payments: {playerId, amountRub}[]) → Record<PlayerId, {dueRub, paidRub, remainingRub, status: 'owes'|'awaits'|'settled'}>`
  (`dueRub = owesRub - prizeRub - bountyRub`, >0 — игрок платит банкиру; `paid` — сумма payment;
  `remaining = due - paid`; settled при 0). `isSettled(...)`.
- `scoring.ts`: очки вечера = (N − место) + `koPoints`·KO + (1-е ? `winBonus` : 0), N = число
  участников вечера (гости тоже). Конфиг `{koPoints: 0.5, winBonus: 1}` из settings.
- `summary.ts`: `summarize(eveningId, dateIso, format, events, cfg) → EveningSummary` —
  компактный итог завершённого вечера для статистики:
  `{eveningId, date, seasonKey, entrants, places, points, netRub, kos, koPairs: [killer, victim][], rebuys, bustLevel,
  firstBustPlayerId, busts: {victim, by}[]}` (последние два — для прогнозов и `first_blood` при дележе).
- `season.ts`: `seasonKey(dateIso, tz='Europe/Moscow') → '2026-Q4'`; `seasonStandings(summaries, {bestN, excluded: Set<PlayerId>})`
  → строки `{playerId, total, counted: number[], played, wins, kos, netRub}` отсортированы; `allTimeStandings(...)`;
  `oracleStandings(predictionScores)`; `hallOfFame(summaries, ...)` → чемпионы завершённых кварталов.
- `predictions.ts`: `scorePrediction({winnerId, firstOutId}, state) → {winner: 0|3, firstOut: 0|2, total}`.
- `votes.ts`: категории `'hand' | 'bluff' | 'badbeat'` (Рука / Блеф / Бэд-бит вечера);
  `voteResults(votes) → Record<category, {winners: PlayerId[], counts: Record<PlayerId, number>}>` (ничья — несколько победителей).
- `achievements.ts`: `computeAchievements(input) → Achievement[]`, `{playerId, code, eveningId|null, seasonKey|null, count}`;
  коды: `first_blood` (первый нокаут в истории клуба), `hunter` (3+ KO за вечер), `comeback` (победа после 2+ ребаев),
  `rebuy_king` (больше всех ребаев за завершённый сезон), `iron_chair` (не пропустил ни одного вечера завершённого сезона),
  `hat_trick` (3 победы подряд в вечерах, где играл), `sworn_enemy` (выбил одного и того же игрока 5 раз),
  `oracle` (угадал победителя в 3 вечерах подряд, где делал прогноз), `star` (победа в номинации голосования),
  `champion` (1-е место завершённого сезона). Переходящие звания: `titles(input) → {nemesis: Record<PlayerId, PlayerId|null>, form: PlayerId|null}`
  (немезида — кто чаще всех выбивал игрока, минимум 2 раза; форма — лучшая сумма очков за последние 5 вечеров клуба).
  Гости ачивки не получают. `diffAchievements(before, after)` — новые для поста бота.
  Названия/описания по-русски в `ACHIEVEMENT_META`.
- `format.ts`: `DEFAULT_FORMAT` (клубный: 500 ₽/500 фишек, баунти 100, ребаи до конца 5-го уровня без лимита,
  70/30, уровни по 40 мин: 5/10, 10/20, 15/30, 20/40, 25/50, 50/100, 75/150, 100/200), `validateFormat`.
- `index.ts` — реэкспорт всего.

## База данных (public)

| Таблица | Колонки |
|---|---|
| `players` | `id uuid pk`, `auth_user_id uuid unique → auth.users on delete set null`, `tg_id bigint unique null`, `display_name text not null`, `username text`, `photo_url text`, `is_guest bool default false`, `is_admin bool default false`, `is_active bool default true`, `created_at` |
| `settings` | singleton `id int pk check (id = 1)`; `group_chat_id bigint`, `bot_username text`, `game_weekday int` (1=пн…7=вс), `game_time time`, `announce_hours_before int default 48`, `default_location text`, `default_format_id uuid → formats`, `season_best_n int default 10`, `ko_points numeric default 0.5`, `win_bonus numeric default 1`, `updated_at` |
| `formats` | `id uuid pk`, `name text`, `config jsonb` (TournamentFormat), `is_archived bool default false`, `created_at` |
| `evenings` | `id uuid pk`, `scheduled_at timestamptz not null`, `location text`, `note text`, `status text` (`announced`→`live`→`finished`→`settled`, или `cancelled`), `banker_id uuid → players`, `format jsonb not null` (снимок формата на момент создания; `payoutPct` до старта меняет `set_payout`), `board_token uuid unique default gen_random_uuid()`, `started_at`, `finished_at`, `settled_at`, `voting_closes_at`, `announce_posted_at`, `results_posted_at`, `voting_posted_at`, `results_revision int default 0` (сколько раз опубликованный итог устарел; > 0 — пост «Исправленные итоги», миграция 007), `created_by`, `created_at` |
| `evening_events` | `id bigserial pk`, `evening_id uuid → evenings on delete cascade`, `type text check (EventType)`, `payload jsonb default '{}'`, `at timestamptz default now()`, `created_by uuid → players`, `voided_at timestamptz`, `voided_by uuid → players`, `client_id uuid` (ключ повтора, unique `(evening_id, client_id)`, миграция 007) |
| `rsvps` | pk `(evening_id, player_id)`, `status text check in ('yes','no','maybe')`, `updated_at` |
| `predictions` | pk `(evening_id, player_id)`, `winner_id uuid → players`, `first_out_id uuid → players`, `updated_at` |
| `votes` | pk `(evening_id, voter_id, category)`, `category text check in ('hand','bluff','badbeat')`, `nominee_id uuid → players`, `caption text check (char_length <= 200)`, `photo_path text`, `created_at`; `check (voter_id <> nominee_id)` |

Индексы-ограничения: `evenings_one_per_club_day_idx` — unique по `((scheduled_at at time zone 'Europe/Moscow')::date)`
`where status <> 'cancelled'`: не больше одного неотменённого вечера на московскую дату (вставка второго → 23505). Миграция 006.

Хелперы (security definer, stable): `current_player_id() → uuid` (по `auth.uid()`, только `is_active`),
`is_admin() → bool`, `is_banker(evening uuid) → bool`, `is_participant(evening uuid, player uuid) → bool`
(есть не-voided join).

### RPC (security definer, `set search_path = ''`, проверяют права сами)
- `add_event(p_evening uuid, p_type text, p_payload jsonb, p_client_id uuid default null) → evening_events` —
  банкир вечера или админ. После `finished` банкир может добавлять только `payment`; остальное — только
  админ (правка закрытого вечера). `p_client_id` — ключ повтора (один на намерение пользователя): если
  событие с тем же ключом уже есть, возвращается оно, без вставки и до проверки состояния вечера
  (тип/игрок не совпадают → 22023). Клиент держит ключ неудавшейся записи 2 минуты (useEveningActions).
  `finish` у вечера в `announced` → P0001. Побочные эффекты: первый `timer_start` → `status='live'`,
  `started_at=now()`; `finish` (из `live`) → при идущем таймере сначала `timer_pause`, затем
  `status='finished'`, `finished_at=now()`, `voting_closes_at=now()+interval '24 hours'`.
- `add_guest(p_evening uuid, p_name text) → uuid` — банкир вечера или админ (права как у `add_event` для `join`):
  создаёт игрока `is_guest = true` (имя 1–40 символов, пробелы схлопываются) и сразу добавляет его `join`
  в этот вечер (через `add_event`). Возвращает id гостя. Миграция 006. Клиент — `addGuest` / `useAddGuest`
  в `src/shared/api/rpc.ts`.
- `void_event(p_event bigint) → void` — те же права; отмена последнего неотменённого `finish` возвращает
  `status='live'` (или `announced`, если `started_at` пуст), обнуляет finished_at/settled_at/voting_closes_at,
  снимает `results_posted_at` и `voting_posted_at` (если итог уже публиковался — `results_revision += 1`):
  повторное завершение опубликует «Исправленные итоги» и новое голосование.
- `set_payout(p_evening uuid, p_pct numeric[])` — банкир вечера или админ, только пока `announced`:
  `format.payoutPct` вечера (1–10 долей > 0, сумма 100 — как `validateFormat`). Миграция 007.
- `server_now() → timestamptz` — время сервера (clock_timestamp) для сверки часов клиента; доступна anon.
- `mark_settled(p_evening uuid)` / `unmark_settled` — банкир или админ; `status='settled'`.
- `set_rsvp(p_evening uuid, p_status text)` — любой участник клуба, пока `status='announced'`.
- `set_prediction(p_evening uuid, p_winner uuid, p_first_out uuid)` — пока `status='announced'`.
- `cast_vote(p_evening uuid, p_category text, p_nominee uuid, p_caption text, p_photo_path text)` —
  голосующий и номинант — участники вечера, `now() < voting_closes_at`, не за себя; upsert.
- `delete_vote(p_evening uuid, p_voter uuid, p_category text)` — свой голос, пока голосование открыто;
  любой — админ. Фото из Storage удаляется отдельно.
- `set_my_name(p_name text)` — 1–40 символов, пробелы схлопываются; имя другого активного игрока
  (без учёта регистра) → 23505 «уже занято». Уникального индекса нет: тёзки из Telegram и гости законны.
- `board_state(p_token uuid) → jsonb` — **доступен anon**; для `status in ('announced','live')` или
  `finished` не старше 6 часов: `{evening:{id,scheduled_at,location,status,started_at,finished_at}, format, events:[без payment, без voided], players:[{id,display_name}], server_now}`
  (`players` — только упомянутые в событиях); иначе null.
- Служебные функции — в схеме `private` (не выставлена в API). Коды ошибок RPC: 42501 нет прав,
  22023 неверные данные (лишний ключ в payload — тоже), P0001 недопустимо в текущем состоянии.

### RLS
- Все таблицы: `select` для `current_player_id() is not null` (активный участник клуба), кроме:
  `predictions` — свои всегда, чужие только когда вечер уже не `announced`;
  `votes` — свои всегда, чужие только после `voting_closes_at`.
- `evening_events`, `rsvps`, `predictions`, `votes` — запись только через RPC.
- `players`, `settings`, `formats`, `evenings` — insert/update только `is_admin()`; игрок может менять
  у себя только `display_name` (через RPC `set_my_name(p_name text)`).
- Storage: приватный бакет `vote-photos`, лимит 2 МБ, `image/jpeg`/`image/webp`; путь
  `{evening_id}/{player_id}/{12 hex}.jpg` (номинации в имени нет); загрузка — только в свою папку,
  участнику вечера при открытом голосовании, по шаблону имени и не больше 6 файлов на игрока и вечер
  (`public.can_upload_vote_photo`); чтение — своё, админу, остальным после `voting_closes_at` (как `votes`);
  удаление — владельцу или админу. Миграция 007.
- Realtime: в публикации `supabase_realtime` — `evening_events`, `evenings`, `rsvps`.

### Cron
`pg_cron` раз в 15 минут: `net.http_post` на `{project_url}/functions/v1/cron-tick` с заголовком
`x-cron-secret`. `project_url` и `cron_secret` — в Vault (`vault.create_secret`), в миграции не
хардкодить; для локалки — в `seed.sql`. Время в БД — UTC; клубное расписание — Europe/Moscow.

## Edge Functions

Окружение: `TELEGRAM_BOT_TOKEN`, `ADMIN_TG_ID` (tg id админа клуба), `CRON_SECRET`, `APP_URL`
(адрес Mini App), `TELEGRAM_DRY_RUN=1` (локально: не слать в Telegram, а логировать),
встроенные `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (или `SUPABASE_SECRET_KEY`, если задан).
Локально — `supabase/functions/.env` (в git только `.env.example`).

- `tg-auth` (`verify_jwt = false`): POST `{initData}` → проверка подписи по алгоритму Telegram
  (`secret = HMAC_SHA256(key="WebAppData", msg=bot_token)`, `hash = hex(HMAC_SHA256(secret, data_check_string))`,
  сравнение за постоянное время), `auth_date` не старше 24 ч → доступ: если `settings.group_chat_id`
  задан — `getChatMember` (member/administrator/creator или restricted с `is_member`), иначе пускаем
  только `ADMIN_TG_ID` → upsert `players` по `tg_id` (имя, username, фото; `ADMIN_TG_ID` → `is_admin`) →
  auth-пользователь `tg<id>@users.poker-club.invalid` (`admin.createUser` с `email_confirm` и
  `app_metadata.tg_id`, если нет) → `admin.generateLink({type:'magiclink'})`; чужой (без метки `tg_id`)
  пользователь с этим адресом к игроку не привязывается — 409 `auth_conflict` → ответ `{tokenHash, player}`. Клиент делает
  `auth.verifyOtp({type:'email', token_hash})`. Ошибки — тело `{error: текст, code}`: 401 (подпись:
  `bad_hash`, `expired`, …), 403 (`not_member`, `no_group`, `inactive`). Имя из Telegram берётся только
  при создании игрока (дальше его меняют админ и `set_my_name`). При `TELEGRAM_DRY_RUN=1` и пустой
  `group_chat_id` пускает всех — для dev-входа за игроков seed.
- `notify` (JWT обязателен): POST `{kind: 'evening_finished', eveningId}` — только банкир вечера или
  админ; сервер сам собирает текст (итог, места, деньги, новые ачивки, приглашение голосовать) из БД
  доменными функциями и шлёт в `settings.group_chat_id`. Идемпотентно по `results_posted_at`; при
  `results_revision > 0` заголовок «Исправленные итоги». `kind: 'evening_corrected'` — только админ:
  исправленный итог закрытого вечера, если после `results_posted_at` журнал менялся (кроме платежей),
  иначе `no_changes`; защита от дублей — перестановка `results_posted_at` по старому значению.
  Ответ `{ok: true, outcome: 'posted'|'already_posted'|'no_group'|'no_changes'}`; клиент —
  `notifyEveningFinished(eveningId, kind)` в `src/shared/api/rpc.ts`.
- `cron-tick` (`verify_jwt = false`, проверка `x-cron-secret`): (1) если до ближайшей игры по
  расписанию осталось ≤ `announce_hours_before` и вечера на эту дату нет — создаёт `evenings`
  (формат по умолчанию, банкир не назначен) и постит анонс; (2) постит итоги голосования для вечеров
  с прошедшим `voting_closes_at` и пустым `voting_posted_at`; (3) добивает неотправленные итоги вечеров.
- Кнопки в постах группы — URL-кнопки на прямую ссылку Mini App
  `https://t.me/<bot_username>?startapp=<param>` (web_app-кнопки в группах недоступны).
  `startapp`: `e_<eveningId>` → вечер, `v_<eveningId>` → голосование, `r` → рейтинг.

## Фронт

- Аутентификация: `AuthProvider` при старте берёт `Telegram.WebApp.initData` → `tg-auth` →
  `verifyOtp` → сессия. **Сессия только в памяти** (`persistSession: false`, своё in-memory storage):
  домен `ma1amadre.github.io` общий с mrgn-board. В dev-режиме вне Telegram — экран выбора тестового
  игрока: initData подписывается в браузере ключом `VITE_DEV_BOT_TOKEN` (тот же фейковый токен, что
  в `supabase/functions/.env` локально); код dev-входа существует только под `import.meta.env.DEV`.
- Дизайн-система — «Материя» (собственная система пользователя, исходник вне репо: `D:/dev/materia`).
  Её сборка **вендорится** в `src/vendor/materia/` (`materia.mjs` + `materia.d.mts`, `materia.css` —
  токены всех регистров и стили компонентов одним листом; `tokens.css` — справочно, уже вшит в
  `materia.css`). Шрифты Google Fonts — не `@import` в листе (он блокировал запуск при зависшем
  fonts.googleapis.com), а неблокирующая ссылка в `index.html` между метками `materia-fonts`; её пишет
  sync-скрипт. Обновление — `node scripts/sync-materia.mjs [путь]`, руками не править.
  Порядок стилей в `main.tsx`: `materia.css` → `styles/base.css` (safe-area Telegram `--pc-safe-*`,
  `--pc-app-height`, на тач-экранах `--m-control-h` = 48 px) → `styles/app.css`; стили кита —
  `src/shared/ui/ui.css`, только на переменных «Материи».
- Тема — регистр «Материи» на `<html data-theme>` (`src/app/useTheme.ts`): всё приложение — Кобальт,
  `kobalt` / `kobalt-dark` по `Telegram.WebApp.colorScheme` (вне Telegram — по `prefers-color-scheme`),
  подписка на `themeChanged`; табло `/board/:token` — `yantar` (`ThemeScope` в `routes.tsx`, при уходе
  регистр возвращается). Один экран — один регистр. Цвета Telegram-темы (`--tg-theme-*`) **не
  используются**; наоборот, шапку, фон и нижнюю панель Telegram красим в токен `ground`
  (`setHeaderColor` с 6.9, `setBackgroundColor` с 6.1, `setBottomBarColor` с 7.10).
- UI-кит `src/shared/ui` (импорт только из `index.ts`): компоненты «Материи» как есть (Badge, Notice,
  Field, Select, Switch, Checkbox, RadioGroup, Dialog, Toast, Progress, Skeleton, Spinner, DataTable,
  Accordion, Menu, StatGroup, EmptyState…), обёртки на её анатомии (Button/IconButton/ButtonLink,
  Card, Stat/Stats, Tabs, Segmented, Avatar/AvatarGroup, Icon, Empty/ErrorView, Confirm, Toast-провайдер,
  Amount) и своё из её токенов (Page, Section, List/ListItem, Sheet, BottomNav, PlayerPicker, FieldGroup).
  Текст — роли `m-*`; голос: «ёлочки», ё, неразрывные пробелы в числах, кнопка = глагол + объект, одна
  primary на экран. Витрина кита в dev: `/#/dev/kit` (переключатель kobalt/kobalt-dark) и
  `/#/dev/kit-yantar` (табло-цифры), в прод-сборку не попадает.
- Общие помощники экранов — `src/shared/lib` (импорт из `index.ts`; чистые модули тесты берут напрямую):
  `format` (деньги, числа, даты, `NBSP`), `text` (склонения, места, правило очков, `capitalize`, `joinNames`,
  `normalizeName`/`NAME_MAX` как у `set_my_name`/`add_guest`), `season` (подписи квартала), `clubTime`
  (Москва UTC+3 ↔ UTC для форм, `nextGameSlot`/`nextGameAt` — то же правило, что `cron-tick/schedule.ts`,
  сверяется тестом), `voting` (`votingPhase`, `participantIds` как `is_participant`), `paths`, `useNow`,
  `useElementWidth`. Между папками `src/pages/*` разрешены только две связи: табло берёт подписи вечера
  из `pages/evening/lib`, карточка игрока — места и чемпиона из `pages/rating/stats`; остальное общее — здесь.
  Статус вечера везде — `EveningStatusBadge` кита; `errorMessage` показывает русские тексты RPC как есть,
  а английские служебные сообщения Postgres/PostgREST заменяет переводом по коду (исходник — в `cause`).
- Никакого `dangerouslySetInnerHTML` и сырого HTML из пользовательских данных.
- Маршруты (HashRouter): `/` главная; `/evening/:id` вечер (живой экран; у банкира — пульт);
  `/evening/:id/settle` расчёт; `/evening/:id/vote` голосование; `/board/:token` табло (публичное,
  вне AuthProvider); `/rating` (сезон / деньги / всё время / оракул / зал славы); `/player/:id`;
  `/history`; `/admin`, `/admin/evening/new`, `/admin/evening/:id`; только в dev — `/dev/kit`, `/dev/kit-yantar`.
- Время вечера: `useNow(1000)` + `replay(format, events, now)`; `now` — по часам сервера
  (`src/shared/lib/serverClock.ts`: смещение по замерам `server_now` при старте и возврате на экран,
  `board_state.server_now` на каждом опросе табло и `at` из ответов `add_event`; берётся замер с
  наименьшим RTT). После записи `useEveningActions.send` прогоняет replay с новой записью: если журнал
  её не принял (например, ребай пришёл после закрытия), вместо «записан» — предупреждение.
  События вечера — запрос + Realtime-подписка на `evening_events` с фильтром `evening_id=eq.<id>`;
  табло без авторизации опрашивает `board_state` раз в 3 с.

## Тестовые данные (seed.sql, только локально)
Игроки с `tg_id` 1001–1006 (1001 — админ), один гость, формат по умолчанию, settings
(четверг 19:00 МСК), 4–6 завершённых вечеров с реалистичными событиями (ребаи, сплит-нокаут,
платежи) и один `announced` вечер — чтобы рейтинг, ачивки и карточки игроков было на чём смотреть.

## Деплой в облако: чеклист Auth (до подключения группы)
Защита входа держится на настройках Auth из `supabase/config.toml`, в облако они сами не переезжают.
1. После `supabase link` — `supabase config push` (сверить diff секции `[auth]`) или вручную в дашборде:
   Authentication → выключить «Allow new users to sign up» и провайдер Email (вход по паролю),
   включить Secure password change.
2. Проверить, что вход `tg-auth` → `verifyOtp(token_hash)` работает с выключенным Email-провайдером
   (локально так и настроено; в облаке не проверялось).
3. Сразу после деплоя войти админом (`ADMIN_TG_ID`), до подключения группы.
4. Участника, вышедшего из группы, админ выключает (`is_active=false`): refresh-токен иначе живёт дальше.
