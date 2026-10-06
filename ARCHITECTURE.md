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
  тогда finish их закрывает). `finished = true` только после события finish.
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
| `evenings` | `id uuid pk`, `scheduled_at timestamptz not null`, `location text`, `note text`, `status text` (`announced`→`live`→`finished`→`settled`, или `cancelled`), `banker_id uuid → players`, `format jsonb not null` (снимок формата на момент создания), `board_token uuid unique default gen_random_uuid()`, `started_at`, `finished_at`, `settled_at`, `voting_closes_at`, `announce_posted_at`, `results_posted_at`, `voting_posted_at`, `created_by`, `created_at` |
| `evening_events` | `id bigserial pk`, `evening_id uuid → evenings on delete cascade`, `type text check (EventType)`, `payload jsonb default '{}'`, `at timestamptz default now()`, `created_by uuid → players`, `voided_at timestamptz`, `voided_by uuid → players` |
| `rsvps` | pk `(evening_id, player_id)`, `status text check in ('yes','no','maybe')`, `updated_at` |
| `predictions` | pk `(evening_id, player_id)`, `winner_id uuid → players`, `first_out_id uuid → players`, `updated_at` |
| `votes` | pk `(evening_id, voter_id, category)`, `category text check in ('hand','bluff','badbeat')`, `nominee_id uuid → players`, `caption text check (char_length <= 200)`, `photo_path text`, `created_at`; `check (voter_id <> nominee_id)` |

Хелперы (security definer, stable): `current_player_id() → uuid` (по `auth.uid()`, только `is_active`),
`is_admin() → bool`, `is_banker(evening uuid) → bool`, `is_participant(evening uuid, player uuid) → bool`
(есть не-voided join).

### RPC (security definer, `set search_path = ''`, проверяют права сами)
- `add_event(p_evening uuid, p_type text, p_payload jsonb) → evening_events` — банкир вечера или админ.
  После `finished` банкир может добавлять только `payment`; остальное — только админ (правка закрытого вечера).
  Побочные эффекты: первый `timer_start` → `status='live'`, `started_at=now()`; `finish` →
  `status='finished'`, `finished_at=now()`, `voting_closes_at=now()+interval '24 hours'`.
- `void_event(p_event bigint) → void` — те же права; отмена `finish` возвращает `status='live'`
  и обнуляет finished_at/voting_closes_at.
- `mark_settled(p_evening uuid)` / `unmark_settled` — банкир или админ; `status='settled'`.
- `set_rsvp(p_evening uuid, p_status text)` — любой участник клуба, пока `status='announced'`.
- `set_prediction(p_evening uuid, p_winner uuid, p_first_out uuid)` — пока `status='announced'`.
- `cast_vote(p_evening uuid, p_category text, p_nominee uuid, p_caption text, p_photo_path text)` —
  голосующий и номинант — участники вечера, `now() < voting_closes_at`, не за себя; upsert.
- `delete_vote(p_evening uuid, p_voter uuid, p_category text)` — свой голос, пока голосование открыто;
  любой — админ. Фото из Storage удаляется отдельно.
- `set_my_name(p_name text)` — 1–40 символов, пробелы схлопываются.
- `board_state(p_token uuid) → jsonb` — **доступен anon**; для `status in ('announced','live')` или
  `finished` не старше 6 часов: `{evening:{id,scheduled_at,location,status,started_at,finished_at}, format, events:[без payment, без voided], players:[{id,display_name}]}`
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
  `{evening_id}/{player_id}/{category}-{random}.jpg`; загрузка — только в свою папку
  (`(storage.foldername(name))[2] = current_player_id()::text`), чтение — участникам клуба,
  удаление — владельцу или админу.
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
  auth-пользователь `tg<id>@users.poker-club.invalid` (`admin.createUser` с `email_confirm`, если нет)
  → `admin.generateLink({type:'magiclink'})` → ответ `{tokenHash, player}`. Клиент делает
  `auth.verifyOtp({type:'email', token_hash})`. Ошибки — тело `{error: текст, code}`: 401 (подпись:
  `bad_hash`, `expired`, …), 403 (`not_member`, `no_group`, `inactive`). Имя из Telegram берётся только
  при создании игрока (дальше его меняют админ и `set_my_name`). При `TELEGRAM_DRY_RUN=1` и пустой
  `group_chat_id` пускает всех — для dev-входа за игроков seed.
- `notify` (JWT обязателен): POST `{kind: 'evening_finished', eveningId}` — только банкир вечера или
  админ; сервер сам собирает текст (итог, места, деньги, новые ачивки, приглашение голосовать) из БД
  доменными функциями и шлёт в `settings.group_chat_id`. Идемпотентно по `results_posted_at`.
  Ответ `{ok: true, outcome: 'posted'|'already_posted'|'no_group'}`; клиент — `notifyEveningFinished`
  в `src/shared/api/rpc.ts`.
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
- Тема: CSS-переменные Telegram (`--tg-theme-*`, их выставляет telegram-web-app.js) с фолбэками.
  Никакого `dangerouslySetInnerHTML` и сырого HTML из пользовательских данных.
- Маршруты (HashRouter): `/` главная; `/evening/:id` вечер (живой экран; у банкира — пульт);
  `/evening/:id/settle` расчёт; `/evening/:id/vote` голосование; `/board/:token` табло (публичное,
  вне AuthProvider); `/rating` (сезон / деньги / всё время / оракул / зал славы); `/player/:id`;
  `/history`; `/admin`, `/admin/evening/new`, `/admin/evening/:id`.
- Время вечера: `useNow(1000)` + `replay(format, events, now)`; события вечера — запрос + Realtime-подписка
  на `evening_events` с фильтром `evening_id=eq.<id>`; табло без авторизации опрашивает `board_state` раз в 3 с.

## Тестовые данные (seed.sql, только локально)
Игроки с `tg_id` 1001–1006 (1001 — админ), один гость, формат по умолчанию, settings
(четверг 19:00 МСК), 4–6 завершённых вечеров с реалистичными событиями (ребаи, сплит-нокаут,
платежи) и один `announced` вечер — чтобы рейтинг, ачивки и карточки игроков было на чём смотреть.
