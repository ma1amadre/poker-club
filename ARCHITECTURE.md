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
    _shared/announce.ts          # снимок анонса и решение «писать ли о правке вечера» (чистое, vitest)
    _shared/gameday.ts           # пост в день игры: писать ли сейчас, кто идёт и кто не ответил (чистое, vitest)
    _shared/botChats.ts          # группы бота из getUpdates для bot-setup (чистое, vitest)
    tg-auth/index.ts
    notify/index.ts              # + results.ts (итоги), changes.ts (перенос/отмена/возврат вечера)
    cron-tick/index.ts
    bot-setup/index.ts           # имя бота, поиск группы, проверочный пост — для админки «Клуб»
  tests/NNN_*.sql                # SQL-проверки в транзакции с rollback (запуск — в шапке файла)
.github/workflows/deploy.yml     # проверки → GitHub Pages + облачный Supabase (DEPLOY.md)
.env.production                  # облачные VITE_SUPABASE_URL / _PUBLISHABLE_KEY (публичные)
src/
  main.tsx, app/*, pages/*, shared/{supabase,telegram,auth,api,ui,lib}/*
  shared/lib/poker/*             # движок олл-ина: оценка рук, эквити, ауты, Web Worker (раздел «Олл-ин»)
  vendor/materia/*               # вендоренная «Материя» (scripts/sync-materia.mjs)
  styles/fonts.css               # @font-face своих шрифтов (пишет scripts/fetch-fonts.mjs)
public/fonts/                    # woff2 шрифтов «Материи» + OFL.txt (scripts/fetch-fonts.mjs)
scripts/                         # node-скрипты разработки (check-merge-replay.mjs — слияние на seed;
                                 # sync-materia.mjs — вендоринг «Материи»; fetch-fonts.mjs — шрифты)
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
  buyInRub: number;        // 500 — цена стандартного входа и ребая (вход ×k — buyInRub·k)
  startingChips: number;   // 500 — фишек за стандартный вход и ребай (×k — startingChips·k)
  bountyRub: number;       // 100 — из каждого входа/ребая «за голову»; в фонд идёт buyIn - bounty (×k — всё ×k)
  rebuyUntilLevel: number; // 5 — вход/ребай разрешён, пока номер текущего уровня (с 1) <= этого
  rebuyLimit: number | null; // null = без лимита (решение клуба)
  payoutPct: number[];     // [70, 30]
  levels: BlindLevel[];    // после последнего уровня блайнды остаются последними
}

export type EventType =
  | 'join' | 'rebuy' | 'bust'
  | 'timer_start' | 'timer_pause' | 'timer_resume'
  | 'level_next' | 'level_prev' | 'hand'
  | 'payment' | 'finish'
  | 'showdown' | 'showdown_close';           // олл-ин на табло (миграция 017), на игру не влияет

export const MAX_ENTRY_STACKS = 10;

export type EventPayload =
  | { playerId: PlayerId; stacks?: number }                  // join, rebuy; stacks — кратность k (1..10, нет = 1)
  | { playerId: PlayerId; by: PlayerId[] }                   // bust; by = кто выбил (0..n)
  | { playerId: PlayerId; amountRub: number; note?: string } // payment: + игрок→банкир, − банкир→игрок
  | ShowdownPayload                                          // showdown
  | { showdownId: string }                                   // showdown_close
  | Record<string, never>;                                   // timer_*, level_*, hand, finish

export type CardCode = string; // 'As', 'Td', '9h': ранг 2–9TJQKA, масть s h d c
export type ShowdownHand = { playerId: PlayerId; cards: [CardCode, CardCode] };
export type ShowdownPayload = {
  showdownId: string;   // uuid раздачи: один на олл-ин, общий у всех его правок
  hands: ShowdownHand[]; // 2..9, порядок — порядок показа
  board: CardCode[];     // 0, 3, 4 или 5 карт
};
export type ShowdownState = ShowdownPayload & {
  openedEventId: number; eventId: number; // первое и последнее принятое событие раздачи
  openedAt: string; updatedAt: string;    // `at` открытия и последней правки
};

export interface EveningEvent {
  id: number; type: EventType; payload: EventPayload;
  at: string;          // ISO, серверное время вставки
  voided: boolean;     // voided-события replay игнорирует
}
```

### Правила replay (replay.ts → `replay(format, events, nowMs): EveningState`)
- События сортируются по `id` (порядок вставки), voided пропускаются.
- **Кратность входа** (миграция 015): у `join` и `rebuy` необязательное `stacks` = k — целое 1..10
  (`MAX_ENTRY_STACKS`), нет поля — 1 (так выглядят все события до 015, миграции данных нет). Вход ×k —
  это k стандартных входов по всем статьям: взнос `buyInRub·k`, фишки `startingChips·k`, голова этого
  входа `bountyRub·k`, в фонд `(buyInRub − bountyRub)·k`. Пример: вход на 1 000 ₽ — голова 200, в
  фонд 800. Некорректное `stacks` (0, 11, дробь, строка, null) — событие отбрасывается с ошибкой
  «Кратность входа — целое число от 1 до 10» (`readStacks` → null). Число входов (`entries`,
  `totalEntries`) считается штуками, деньги и фишки — по сумме кратностей.
- `join`: игрок входит (entries += 1, stacks = currentStacks = k, alive). Разрешён, пока вход открыт
  (`rebuysOpen`) — то есть это и поздняя регистрация. Повторный join того же игрока — ошибка.
- `rebuy`: только для вылетевшего игрока (alive=false), пока `rebuysOpen` и не превышен лимит;
  stacks += k, currentStacks = k (своя кратность у каждого ребая).
- `bust {playerId, by}`: игрок вылетел. Каждый игрок из `by` получает +1 нокаут (KO засчитывается
  каждому при дележе). «Голова» жертвы — голова её ТЕКУЩЕГО входа, `bountyRub·currentStacks` —
  делится поровну между `by` в целых рублях, остаток — первому в списке; если `by` пуст — голова
  «сиротская» и уходит победителю (со своей суммой). Каждый bust считается нокаутом, даже если
  жертва потом сделала ребай.
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
- Деньги (money.ts): `totalStacks = Σ k` по всем входам и ребаям; `prizePoolRub = totalStacks *
  (buyInRub - bountyRub)`, `bountyPoolRub = totalStacks * bountyRub`, `totalChips = totalStacks *
  startingChips`; взнос игрока `owesRub = stacks * buyInRub`. Выплаты по `payoutPct`
  для первых min(n_игроков, payoutPct.length) мест с перенормировкой до 100%, вниз до рубля, остаток
  1-му месту. Победитель забирает голову своего текущего входа и сиротские (нераспределённое =
  `bountyPoolRub` − розданное за нокауты). Сумма всех выплат + баунти ровно равна сумме всех
  взносов — это инвариант, его проверяют тесты (`money.test.ts`: ручные сценарии, 3000
  сгенерированных вечеров со смешанными кратностями и независимым пересчётом голов, полный перебор
  ~22 тыс. вечеров на троих с головой 75 ₽).
- **Олл-ин** (миграция 017, `showdown.ts`): `showdown` — полное состояние раздачи (руки и стол), каждая
  правка пишет всё заново; `showdown_close {showdownId}` — банкир закрыл раздачу. Форма — `readShowdown`: id —
  uuid, 2..9 рук по две карты, без повторов игроков и карт (в руках и на столе вместе), на столе 0/3/4/5 карт.
  Игроки: новая раздача (другой `showdownId`) — только те, кто в игре (`alive`); правка открытой — ещё и те, кто
  уже был в ней и с тех пор вылетел (олл-ин вводят до вылета, опечатку в карте замечают и после); игрок не из
  турнира — ошибка. Принятое событие кладёт раздачу в `state.showdown` (`openedEventId`/`openedAt` — от первой
  версии с этим id), новый `showdownId` заменяет незакрытую раздачу, `showdown_close` с id открытой и `finish`
  обнуляют её (отмена finish вернёт). Закрыть не ту раздачу — ошибка «Эта раздача олл-ина уже закрыта».
  После finish олл-ин не принимается («Вечер уже завершён»). На деньги, места, нокауты, таймер, итоги, очки и
  ачивки олл-ин не влияет: `apply` трогает только `state.showdown` (`showdown.test.ts` сверяет replay,
  `computeMoney` и `summarize` одного журнала с олл-инами и без них — отменёнными, с теми же id). Отмена (void)
  — как у всех событий: отменить последнюю правку — раздача возвращается к предыдущей версии.
- Ошибочные события (ребай живого, bust мёртвого, join после закрытия) не ломают replay: они
  пропускаются и попадают в `state.errors: {eventId, message}[]`. `canApply(format, state, type, payload, nowMs)`
  возвращает текст ошибки или null — фронт проверяет перед отправкой.

```ts
export interface PlayerState {
  playerId: PlayerId; joinedAt: string; entries: number; rebuys: number;
  stacks: number;        // Σ k входа и ребаев: взнос = stacks × buyInRub
  currentStacks: number; // k текущего входа: голова на кону = currentStacks × bountyRub
  alive: boolean; busts: number; finalBustEventId: number | null; place: number | null;
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
  rebuysOpen: boolean; aliveCount: number; totalEntries: number; // штуки
  totalStacks: number; totalChips: number; prizePoolRub: number; bountyPoolRub: number; // по кратностям
  finished: boolean;
  places: PlayerId[];          // index 0 = 1-е место; полон только при finished
  firstBustPlayerId: PlayerId | null; // для прогноза «кто вылетит первым» = первый bust вечера
  showdown: ShowdownState | null; // открытый олл-ин (только показ; см. «Олл-ин»)
  errors: { eventId: number; message: string }[];
}
```

### Остальные модули
- `money.ts`: `entryAmounts(format, k=1) → {stacks, rub, chips, bountyRub, poolRub}` — во что обходится
  вход/ребай кратности k (пульт банкира, подписи ленты);
  `computeMoney(format, state) → Record<PlayerId, {owesRub, prizeRub, bountyRub, netRub}>`;
  `settlement(money, payments: {playerId, amountRub}[]) → Record<PlayerId, {dueRub, paidRub, remainingRub, status: 'owes'|'awaits'|'settled'}>`
  (`dueRub = owesRub - prizeRub - bountyRub`, >0 — игрок платит банкиру; `paid` — сумма payment;
  `remaining = due - paid`; settled при 0). `isSettled(...)`.
- `scoring.ts`: очки вечера = (N − место) + `koPoints`·KO + (1-е ? `winBonus` : 0), N = число
  участников вечера (гости тоже). Конфиг `{koPoints: 0.5, winBonus: 1}`: у завершённого вечера — его снимок
  `evenings.scoring` (миграция 013), без снимка — текущие settings. `parseScoringSnapshot(jsonb) → ScoringConfig|null`
  (строго: два числа ≥ 0), `eveningScoring(snapshot, current)` — снимок или текущие.
- `summary.ts`: `summarize(eveningId, dateIso, format, events, cfg, snapshot?) → EveningSummary` —
  компактный итог завершённого вечера для статистики; очки — по `eveningScoring(snapshot, cfg)`:
  `{eveningId, date, seasonKey, entrants, places, points, scoring?, netRub, kos, koPairs: [killer, victim][], rebuys, bustLevel,
  firstBustPlayerId, busts: {victim, by}[]}` (`scoring` — правила, по которым посчитаны `points`, summarize ставит
  всегда; `firstBustPlayerId`, `busts` — для прогнозов и `first_blood` при дележе). Поля «Жизни клуба» (необязательные
  в типе ради итогов, собранных в тестах; summarize ставит всегда): `prizePoolRub` (фонд без баунти), `durationMs` —
  чистое игровое время **до решающего вылета** (часы replay на момент последнего принятого bust: часы идут до finish,
  а «Завершить» жмут и через полчаса, и на следующее утро; без вылетов — до finish), `finishedAt` (`at` принятого finish).
- `season.ts`: `seasonKey(dateIso, tz='Europe/Moscow') → '2026-Q4'`; `seasonStandings(summaries, {bestN, excluded: Set<PlayerId>,
  seasonKey?, bestNBySeason?})` → строки `{playerId, total, counted: number[], played, wins, kos, netRub}` отсортированы;
  `allTimeStandings(...)`; `oracleStandings(predictionScores)`; `hallOfFame(summaries, {bestN, excluded, currentSeasonKey,
  bestNBySeason?})` → чемпионы завершённых кварталов. **«Лучшие N» по сезону** (миграция 013): `SeasonBestN` =
  `Record<seasonKey, number>` из `season_rules`; `bestNForSeason(key, bestN, bySeason?)` — замороженное значение
  закрытого сезона (целое ≥ 1), иначе текущее `settings.season_best_n`. `seasonStandings` применяет его к `seasonKey`,
  а без него — к сезону итогов, если все они из одного сезона (смешанный список — текущее `bestN`).
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
  Гости ачивки не получают. `diffAchievements(before, after)` — новые для поста бота. `AchievementInput.bestNBySeason?`
  — замороженные «лучшие N» для `champion` (`rebuy_king` и `iron_chair` от N не зависят).
  Названия/описания по-русски в `ACHIEVEMENT_META`. `chronological(summaries)` — итоги по дате, общий порядок для
  ачивок, званий, рекордов и ленты.
- `records.ts` («Жизнь клуба»): `RECORD_KINDS` — `biggest_win` (нетто игрока за вечер), `most_kos` (нокауты за вечер),
  `win_streak` (победы подряд в вечерах, где играл; рекорд — с 2), `biggest_pool` (фонд вечера), `longest_game`
  (`durationMs`); рекорда по ребаям нет. `RECORD_META` — `{title, scope: 'player'|'evening', unit: 'rub'|'count'|'ms', min}`.
  `recordsTable(summaries, {excluded}) → ClubRecord[]` (всегда 5 строк, `value: null` — рекорда нет; держатели —
  все при ничьей, первым — кто раньше, свой повтор — один раз с первым вечером); `recordsBroken(...) →
  Record<eveningId, RecordBreak[]>` (`status: 'new'|'equalled'`, `previous`). Первый вечер клуба рекордов не ставит.
  Рекорды игрока — только постоянные (`excluded` — гости), рекорды вечера (фонд, длина) — все вечера.
- `progress.ts`: `achievementProgress(input, playerId) → AchievementProgress[]` — прогресс до неполученных ачивок
  (`measure: 'count'|'place'|'condition'`, `current`/`target`, `possible`, `victimId` у `sworn_enemy`, `leaders`/
  `leaderValue` у `rebuy_king`/`champion`); сезонные (`champion`, `rebuy_king`, `iron_chair`) — всегда, по текущему
  сезону; `first_blood` — пока в клубе не было нокаутов. `hint` домена — на «ты», карточка игрока свои подписи
  собирает сама (`pages/player/progress.ts`: на чужой карточке нужны нейтральные).
- `feed.ts`: лента «В клубе». `clubEvents(input: ClubFeedInput)` — события, не зависящие от «сейчас» (итог вечера,
  ачивки без `star`, смена званий `titleChanges`, рекорды), уже в порядке ленты; `clubMoments(input, {nowMs})` —
  победители номинаций по голосованиям с `voting_closes_at <= nowMs` (ничья — момент каждому; «лучший голос»: фото
  и подпись → фото → подпись → ранний); `momentItems`, `mergeFeed(events, moments, limit?)`; `clubFeed(input,
  {nowMs, limit?})` = всё вместе. Время: события вечера — `evenings.finished_at` (без него finish журнала, иначе
  дата вечера), момент — закрытие голосования, сезонная ачивка — `seasonEndIso`. Новые сверху, при равном времени —
  итог, рекорды, ачивки, звания, моменты. id детерминированы (`result:<ev>`, `record:<kind>:<ev>`, …). Смена звания —
  только когда его получает другой игрок.
- `recap.ts`: `eveningRecap(input, eveningId, playerId) → EveningRecap | null` — «Твой вечер»: место, очки, нетто,
  `kosBy` (с дележом), `bustedBy` (каждый вылет, `final`), прогноз и очки Оракула, новые ачивки вечера, место в сезоне
  до/после (`standingPlace`, как на главной), смена званий, рекорды (свои и вечера). `played: false` — не играл, но
  делал прогноз; null — не играл и прогноза не было.
- `format.ts`: `DEFAULT_FORMAT` (клубный: 500 ₽/500 фишек, баунти 100, ребаи до конца 5-го уровня без лимита,
  70/30, уровни по 40 мин: 5/10, 10/20, 15/30, 20/40, 25/50, 50/100, 75/150, 100/200), `validateFormat`.
- `showdown.ts` (миграция 017): нотация карт (`CARD_RANKS` '23456789TJQKA', `CARD_SUITS` 'shdc', `isCardCode`),
  `readShowdown`/`readShowdownId` — форма payload, `streetOf(boardSize)` → `'preflop'|'flop'|'turn'|'river'`,
  `isShowdownEvent(type)`, `visibleShowdown(showdown, nowMs)` — показывать ли раздачу: после ривера —
  `SHOWDOWN_RIVER_HOLD_MS` (2 мин) с последней правки, на любой улице — не дольше `SHOWDOWN_IDLE_HIDE_MS` (10 мин)
  без правок; время серверное, поэтому табло, пульт и экраны игроков прячут раздачу одновременно. Типы
  олл-ина (`SHOWDOWN_EVENT_TYPES`) — в `types.ts`.
- `index.ts` — реэкспорт всего.

## База данных (public)

| Таблица | Колонки |
|---|---|
| `players` | `id uuid pk`, `auth_user_id uuid unique → auth.users on delete set null`, `tg_id bigint unique null`, `display_name text not null`, `username text`, `photo_url text`, `is_guest bool default false`, `is_admin bool default false`, `is_active bool default true`, `created_at` |
| `settings` | singleton `id int pk check (id = 1)`; `group_chat_id bigint`, `bot_username text`, `game_weekday int` (1=пн…7=вс), `game_time time`, `announce_hours_before int default 48`, `gameday_hours_before int default 5` (1–48: за сколько часов до начала пост в день игры; миграция 014), `default_location text`, `default_format_id uuid → formats`, `season_best_n int default 10`, `ko_points numeric default 0.5`, `win_bonus numeric default 1`, `updated_at` |
| `formats` | `id uuid pk`, `name text`, `config jsonb` (TournamentFormat), `is_archived bool default false`, `created_at` |
| `evenings` | `id uuid pk`, `scheduled_at timestamptz not null`, `location text`, `note text`, `status text` (`announced`→`live`→`finished`→`settled`, или `cancelled`), `banker_id uuid → players`, `format jsonb not null` (снимок формата на момент создания; `payoutPct` до старта меняет `set_payout`), `board_token uuid unique default gen_random_uuid()`, `started_at`, `finished_at`, `settled_at`, `voting_closes_at`, `announce_posted_at`, `gameday_posted_at` (пост в день игры ушёл или не понадобился; пишет только cron-tick; перенос на другой московский день снимает отметку — триггер `evenings_reset_gameday_post`, before update of `scheduled_at`, любой путь записи, включая upsert формы админки; перенос в пределах дня не трогает; миграция 014), `results_posted_at`, `voting_posted_at`, `results_revision int default 0` (сколько раз опубликованный итог устарел; > 0 — пост «Исправленные итоги», миграция 007), `settle_reopened_at timestamptz` (закрытый расчёт открылся сам из-за правки журнала; снимают `mark_settled`/`unmark_settled`, миграция 008), `announce_snapshot jsonb` (что группа знает о вечере из постов бота: `{scheduledAt: ISO UTC, location: text|null, cancelled: bool}`; пишут только функции, миграция 008), `slot_date date` (московский день, за которым вечер закреплён в расписании: ставит триггер `evenings_set_slot_date` при вставке по `scheduled_at`, перенос его не меняет; миграция 010), `cancel_reason text` (1–200 символов; причина отмены для поста в группу — пишет админ вместе с отменой, возврат снимает; заметку `note` отмена не трогает; миграция 010), `scoring jsonb` (снимок правил очков `{koPoints, winBonus}` из settings в момент завершения; есть ровно у `finished`/`settled` — constraint `evenings_scoring_when_closed`, форма — `evenings_scoring_shape`; ставит и снимает триггер `evenings_scoring_snapshot`, снаружи не пишется; миграция 013), `created_by`, `created_at` |
| `evening_events` | `id bigserial pk`, `evening_id uuid → evenings on delete cascade`, `type text check (EventType)`, `payload jsonb default '{}'`, `at timestamptz default now()`, `created_by uuid → players`, `voided_at timestamptz`, `voided_by uuid → players`, `client_id uuid` (ключ повтора, unique `(evening_id, client_id)`, миграция 007) |
| `rsvps` | pk `(evening_id, player_id)`, `status text check in ('yes','no','maybe')`, `updated_at` |
| `predictions` | pk `(evening_id, player_id)`, `winner_id uuid → players`, `first_out_id uuid → players`, `updated_at` |
| `votes` | pk `(evening_id, voter_id, category)`, `category text check in ('hand','bluff','badbeat')`, `nominee_id uuid → players`, `caption text check (char_length <= 200)`, `photo_path text`, `created_at`; `check (voter_id <> nominee_id)` |
| `season_rules` | `season_key text pk` (`'2026-Q3'`, квартал по Москве, как `seasonKey` домена), `best_n int ≥ 1`, `frozen_at timestamptz default now()` — «лучшие N» закрытых сезонов; пишет только триггер `settings_freeze_season_best_n` (и backfill 013); `authenticated` — select (RLS: участник клуба), `service_role` — select/insert/update/delete. Миграция 013 |
| `admin_alerts` | `key text pk` (1–200 символов: вид сбоя или `telegram:<код>`), `last_sent_at timestamptz not null`, `suppressed_count int ≥ 0 default 0`, `updated_at timestamptz default now()` — журнал троттлинга оповещений админа о сбоях (`_shared/alerts.ts`, раздел Edge Functions). RLS без политик, права только у `service_role` (select/insert/update/delete); клиенту не виден. Миграция 012 |

**Правила подсчёта не переписывают прошлое** (миграция 013):
- Очки вечера. Триггер `evenings_scoring_snapshot` (before insert/update на `evenings`, security definer): вечер
  становится `finished`/`settled` из другого статуса (finish в `add_event`, вставка уже завершённого) — `scoring` =
  текущие `settings.ko_points`/`win_bonus`; был и остался завершённым (finished ↔ settled, открытие расчёта правкой
  журнала, форма админки, upsert) — прежний снимок, присланное значение игнорируется; любой другой статус (отмена
  finish в `void_event`, отмена вечера) — null. Повторный finish берёт правила на свой момент.
- «Лучшие N». Значение закрытого сезона расходится с настройкой, только если её поменяли после конца сезона, —
  поэтому заморозка в этот момент: триггер `settings_freeze_season_best_n` (before update of `season_best_n`, при
  реальной смене) вызывает `private.freeze_past_seasons(old.season_best_n)` — строки всем прошедшим кварталам без
  записи, от квартала самого раннего вечера клуба (любой статус) до предыдущего. Пока правки не было, домен берёт
  текущее значение — оно и есть значение на конец сезона. Текущий сезон живёт по `settings.season_best_n`. Cron для
  этого не нужен. Вечер, созданный задним числом в квартале раньше первого вечера клуба после заморозки, —
  единственный случай, когда закрытый сезон пойдёт по текущей настройке.
- Backfill 013: завершённым вечерам — снимок текущих настроек, прошедшим кварталам — текущее `season_best_n`
  (прежних значений история не хранила).
- Клиент: `fetchClubHistory` читает `season_rules` (`ClubHistory.bestNBySeason`, он же в `achievementInput`) и передаёт
  снимок вечера в `summarize`; экраны закрытых сезонов, Зал славы, значок чемпиона и ачивки — с `bestNBySeason`;
  подписи правил (`scoringRuleOf` в `shared/lib/text`) — по снимкам вечеров. Таблицы ещё нет (фронт выложен раньше,
  чем докатилась миграция; PostgREST `PGRST205`) — пустой список, как до 013. `FinishedView` — очки по снимку вечера.
  Функции: `loadHistory` (`notify/results.ts`) — то же, `season_rules` под service_role, `EVENING_COLUMNS` с `scoring`.
- Админка «Клуб»: при правке очков или «лучших N» — пометка `scoringChangeNote` (`pages/admin/settingsDraft.ts`):
  очки — для вечеров, которые завершатся после сохранения; «лучшие N» — для текущего сезона; прошедшие вечера и
  закрытые сезоны не пересчитываются.

Стартовые данные облака (seed туда не идёт) — миграция 011: строка `settings` (id=1; дефолты из 001:
четверг 19:00 МСК, анонс за 48 ч, `group_chat_id`/`bot_username` пусты; пост в день игры за 5 ч — умолчание 014) и, если форматов ещё нет и
`default_format_id` пуст, клубный формат `f0000000-0000-4000-8000-000000000001` «Клубный» = `DEFAULT_FORMAT`
(сверяет `_shared/bootstrap-format.test.ts`) как `default_format_id`. Повторный прогон ничего не меняет.

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
  (тип/игрок/кратность не совпадают → 22023). Клиент держит ключ неудавшейся записи 2 минуты (useEveningActions).
  Payload `join`/`rebuy` — `{playerId, stacks?}` (миграция 015): `stacks` — целое 1..10, иначе 22023
  «Кратность входа — целое число от 1 до 10» (`private.json_entry_stacks`); в нормализованной копии
  хранится только при k > 1 — стандартный вход неотличим от событий до 015. Клиент тоже шлёт `stacks`
  только при k > 1 (`entryPayload` в `pages/evening/lib.ts`).
  Олл-ин (миграция 017): `showdown` — `{showdownId, hands: [{playerId, cards: [c1, c2]}], board}`, нормализованная
  копия — uuid в нижнем регистре; 22023, если: id не uuid (`private.json_showdown_id`), рук не 2..9, игрок
  повторяется или не за столом вечера (нет действующего join, `is_participant`), карт в руке не две, карта не в
  нотации 'As'/'Td'/'9h' (`private.json_card`, регистр строгий), карта повторяется, на столе не 0/3/4/5 карт,
  лишний ключ (в payload и в руке). `showdown_close` — `{showdownId}`. Жив ли игрок — правило replay. Ключ
  повтора у олл-ина сверяет и id раздачи, и карты рук и стола (другая карта — другое намерение).
  `finish` у вечера в `announced` → P0001. Побочные эффекты: первый `timer_start` → `status='live'`,
  `started_at=now()`; `finish` (из `live`) → при идущем таймере сначала `timer_pause`, затем
  `status='finished'`, `finished_at=now()`, `voting_closes_at=now()+interval '24 hours'`.
- `add_guest(p_evening uuid, p_name text, p_stacks integer default 1) → uuid` — банкир вечера или админ
  (права как у `add_event` для `join`): создаёт игрока `is_guest = true` (имя 1–40 символов, пробелы
  схлопываются) и сразу добавляет его `join` кратности `p_stacks` (1..10, проверка до создания игрока)
  в этот вечер (через `add_event`). Возвращает id гостя. Миграция 006, `p_stacks` — 015 (сигнатура
  `(uuid, text)` удалена, вызов с двумя аргументами работает). Клиент — `addGuest(eveningId, name,
  stacks)` / `useAddGuest` в `src/shared/api/rpc.ts` (`p_stacks` шлёт только при k > 1).
- **Правка журнала открывает закрытый расчёт** (миграция 008): любой новый `evening_events` (add_event любого
  типа, в том числе платёж банкира и join из `add_guest`) или отмена события (`voided_at` null → не null) у вечера
  в `settled` в той же транзакции возвращает его в `finished`: `settled_at = null`, `settle_reopened_at = now()`.
  Сделано триггерами `evening_events_reopen_settlement_on_insert/_on_void` (функция
  `private.reopen_settlement_on_journal_change`) — одна точка на все пути записи; правка payload/created_by
  (как в `merge_players`) его не трогает. В `seed.sql` на время заливки журналов триггеры выключены.
  Фронт: `reopenedNotice` (`pages/evening/lib.ts`) — пометка «Расчёт снова открыт» на экранах вечера и расчёта
  (банкиру и админу — закрыть заново, игроку вечера — проверить свой остаток, не игравшим — нейтрально; на экране
  вечера без своей кнопки: «Открыть расчёт» там уже есть); закрытый расчёт с ненулевыми остатками на экране —
  предупреждение вместо «сошёлся в ноль» (`settledNotice`);
  на главной — пометка в долгах и напоминании банкиру (`openSettlements(...).reopened`).
- `void_event(p_event bigint) → void` — те же права; отмена последнего неотменённого `finish` возвращает
  `status='live'` (или `announced`, если `started_at` пуст), обнуляет finished_at/settled_at/voting_closes_at,
  снимает `results_posted_at` и `voting_posted_at` (если итог уже публиковался — `results_revision += 1`):
  повторное завершение опубликует «Исправленные итоги» и новое голосование.
- `set_payout(p_evening uuid, p_pct numeric[])` — банкир вечера или админ, только пока `announced`:
  `format.payoutPct` вечера (1–10 долей > 0, сумма 100 — как `validateFormat`). Миграция 007.
- `server_now() → timestamptz` — время сервера (clock_timestamp) для сверки часов клиента; доступна anon
  (её же раз в сутки дёргает `keepalive` из `poker-club-ops`).
- `verify_cron_secret(p_secret text) → boolean` — только `service_role` (anon/authenticated — revoke):
  совпадает ли заголовок `x-cron-secret` с `cron_secret` из Vault. Сравнение HMAC обеих строк на случайном
  ключе вызова (время не зависит от общего префикса секрета); пустой аргумент или нет секрета — false.
  Миграция 011.
- `mark_settled(p_evening uuid, p_last_event_id bigint, p_voided_count int)` / `unmark_settled(p_evening uuid)` —
  банкир или админ; `status='settled'` / обратно в `finished`; оба снимают `settle_reopened_at` (миграция 008).
  `mark_settled` получает журнал, который видел экран расчёта (`journalVersion` в `pages/evening/lib.ts`: последний
  id и число отменённых записей); если на сервере журнал другой (платёж записали или отменили с другого устройства,
  пока Realtime не обновил экран) — P0001 «Журнал вечера изменился…», клиент перечитывает журнал (миграция 010).
  Сам баланс по-прежнему считает домен на клиенте (`isSettled`).
- `set_rsvp(p_evening uuid, p_status text)` — любой участник клуба, пока `status='announced'`.
- `set_prediction(p_evening uuid, p_winner uuid, p_first_out uuid)` — пока `status='announced'`; победителем
  и первым вылетом можно назвать любого существующего игрока, гостя тоже (проверено в миграции 008, правка
  не понадобилась). Фронт предлагает всех активных: постоянных по ответу на анонс, за ними гостей по имени
  (`predictionCandidates` в `pages/home/lib.ts`; гость на анонс не отвечает — войти он не может).
- `merge_players(p_guest uuid, p_target uuid) → jsonb` — только админ (миграция 008). `p_guest` — игрок без
  `tg_id` и без входа (гость или сделанный постоянным), `p_target` — игрок с `tg_id`. Атомарно, под блокировкой
  всех вечеров (тот же порядок, что у add_event): в `evening_events` — `payload.playerId`, элементы `payload.by` и
  игроки рук олл-ина `payload.hands[].playerId` (017) точной заменой значения (порядок `by` и рук сохраняется,
  `private.payload_replace_player`; какие записи трогать — `private.payload_mentions_player`, то же правило у
  `player_references` и счёта `events` в отчёте), `created_by`/`voided_by`;
  `rsvps`, `predictions` (свои строки и `winner_id`/`first_out_id`), `votes` (`voter_id`, `nominee_id`) —
  удалить и вставить заново с прежними `updated_at`/`created_at`; `evenings.banker_id`/`created_by`;
  `p_target.is_guest = false`; гость удаляется. Все внешние ключи на `players` — `on delete cascade`/`set null`,
  удаление само не упало бы, поэтому перед ним `private.player_references` обходит `pg_constraint` (каждый внешний
  ключ на `players`, новые таблицы — автоматически) и payload журнала: осталась ссылка — отказ XX000, слияние
  откатывается целиком (миграция 010).
  Отказ P0001 «Привязать профиль «…» к профилю «…» нельзя: …» с перечнем причин, если: оба в действующих
  записях журнала одного вечера (совет — сначала выбрать другой профиль, правка журнала — если гостя вписали по
  ошибке; миграция 010); разные
  ответы на один анонс; разные прогнозы на один вечер; разные голоса в одной номинации; один голосовал за
  другого (после слияния — голос за себя); у гостя фото к голосу, а голосование вечера ещё открыто.
  Совпадающие строки (тот же ответ/прогноз/голос) схлопываются в строку профиля. Ошибки аргументов — 22023
  (гость с Telegram, профиль без Telegram, один и тот же игрок), не админ — 42501. Ответ — отчёт
  `{guest:{id,name}, target:{id,name}, evenings, events, votesReceived, votesCast, predictionsAbout,
  predictionsMade, rsvps, bankerOf, photosKept, blockers: text[]}`.
  **Фото голосов** при слиянии не переносятся: объекты Storage SQL переименовать нельзя (файл в хранилище
  привязан к имени), `votes.photo_path` остаётся `{вечер}/{гость}/…`. Политики продолжают работать: после
  закрытия голосования фото видят все участники (как и раньше), админ — всегда и может удалить; поэтому
  слияние, пока у гостя есть фото в ещё открытом голосовании, запрещено (профиль не смог бы переголосовать
  с этим фото — `cast_vote` принимает только свою папку). Гость без Telegram войти не может, так что на
  практике фото у него нет.
- `merge_players_preview(p_guest uuid, p_target uuid) → jsonb` — то же без записи: отчёт и `blockers`
  (подтверждение в админке). Клиент — `mergePlayersPreview`/`useMergePreview`, `mergePlayers`/`useMergePlayers`.
- `cast_vote(p_evening uuid, p_category text, p_nominee uuid, p_caption text, p_photo_path text)` —
  голосующий и номинант — участники вечера, `now() < voting_closes_at`, не за себя; upsert.
- `delete_vote(p_evening uuid, p_voter uuid, p_category text)` — свой голос, пока голосование открыто;
  любой — админ. Фото из Storage удаляется отдельно.
- `set_my_name(p_name text)` — 1–40 символов, пробелы схлопываются; имя другого активного игрока
  (без учёта регистра) → 23505 «уже занято». Уникального индекса нет: тёзки из Telegram и гости законны.
- `board_state(p_token uuid) → jsonb` — **доступен anon**; для `status in ('announced','live')` или
  `finished` не старше 6 часов: `{evening:{id,scheduled_at,location,status,started_at,finished_at}, format, events:[без payment, без voided], players:[{id,display_name}], server_now}`
  (`players` — только упомянутые в событиях); иначе null. События олл-ина (`showdown`, `showdown_close`) идут
  как все; имена игроков рук в `players` есть всегда — у каждого из них есть join этого вечера (017 board_state не
  меняет).
- Служебные функции — в схеме `private` (не выставлена в API). Коды ошибок RPC: 42501 нет прав,
  22023 неверные данные (лишний ключ в payload — тоже), P0001 недопустимо в текущем состоянии.

### RLS
- Все таблицы: `select` для `current_player_id() is not null` (активный участник клуба), кроме:
  `predictions` — свои всегда, чужие только когда вечер уже не `announced`;
  `votes` — свои всегда, чужие только после `voting_closes_at`;
  `admin_alerts` — RLS включён без политик: клиенту не видна вовсе (только `service_role`, миграция 012).
- `evening_events`, `rsvps`, `predictions`, `votes` — запись только через RPC.
- `players`, `settings`, `formats`, `evenings` — insert/update только `is_admin()`; игрок может менять
  у себя только `display_name` (через RPC `set_my_name(p_name text)`).
- Storage: приватный бакет `vote-photos`, лимит 2 МБ, `image/jpeg`/`image/webp`; путь
  `{evening_id}/{player_id}/{12 hex}.jpg` (номинации в имени нет); загрузка — только в свою папку,
  участнику вечера при открытом голосовании, по шаблону имени и не больше 6 файлов на игрока и вечер
  (`public.can_upload_vote_photo`); чтение — своё, админу, остальным после `voting_closes_at` (как `votes`);
  удаление — владельцу или админу. Миграция 007.
- Realtime: в публикации `supabase_realtime` — `evening_events`, `evenings`, `rsvps`.

### Гранты
Прав по умолчанию нет: облачный проект создан после 30.05.2026, когда Supabase перестал выдавать
`anon`/`authenticated`/`service_role` права на новые объекты `public` (changelog «Tables not exposed to Data
and GraphQL API automatically»); локально так же — `[api] auto_expose_new_tables = false` в `config.toml`.
- `authenticated` — ровно нужное, миграция 002 (select на все таблицы, insert/update на `players`, `settings`,
  `formats`, `evenings`; `season_rules` — select, миграция 013); `anon` — только RPC `board_state`, `server_now`.
  Исключение — `admin_alerts` (012): у `anon`/`authenticated` прав нет вовсе (`revoke all`), только `service_role`.
- `service_role` (Edge Functions через `adminClient`) — select/insert/update/delete на все таблицы и
  usage/select на sequences `public`, миграция 011; execute на RPC — поимённо в миграциях.
- **Правило:** новая таблица (sequence) в миграции — сразу с явным `grant` для `service_role` и, если нужна
  клиенту, для `authenticated`. Забытый грант в облаке ловит проверка после деплоя (`deploy.yml`), локально —
  ручной вызов функций после `db reset`. Новой колонке существующей таблицы отдельный грант не нужен: права выданы
  на таблицу целиком, а не по колонкам (так в 014 — `settings.gameday_hours_before`, `evenings.gameday_posted_at`).

### Cron
`pg_cron` раз в 15 минут: `net.http_post` на `{project_url}/functions/v1/cron-tick` с заголовком
`x-cron-secret`. Оба значения — в Vault, в коде и окружении функций их нет:
- `cron_secret` создаёт миграция 011 (32 случайных байта в hex), если его ещё нет; `cron-tick` сверяет
  заголовок RPC `verify_cron_secret`. Локально `seed.sql` переписывает его на `local-cron-secret`
  (`vault.update_secret`) — чтобы дёргать `cron-tick` руками.
- `project_url` миграция не создаёт: в облаке его ставит деплой (Management API, `deploy.yml`), локально —
  `seed.sql` (`http://host.docker.internal:57321`). Пока его нет, `private.invoke_cron_tick` тихо возвращает null.

Время в БД — UTC; клубное расписание — Europe/Moscow.

## Edge Functions

Окружение: `TELEGRAM_BOT_TOKEN`, `ADMIN_TG_ID` (tg id админа клуба), `APP_URL`
(адрес Mini App; сейчас ни одна функция его не читает), `TELEGRAM_DRY_RUN=1` (локально: не слать в Telegram,
а логировать), встроенные `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (или `SUPABASE_SECRET_KEY`, если задан).
Секрета cron в окружении нет (миграция 011, см. «Cron»). Локально — `supabase/functions/.env` (в git только
`.env.example`); в облаке `TELEGRAM_BOT_TOKEN`, `ADMIN_TG_ID`, `APP_URL` ставит деплой (`supabase secrets set`).
Права вызывающего по JWT — `resolveCaller` в `_shared/admin.ts` (getUser + активный игрок `{id, is_admin, tg_id}`;
notify, bot-setup). supabase-js в функциях — `npm:@supabase/supabase-js@2.117.2`, версия точная (как у фронта
в package-lock), обновлять в трёх импортах сразу. Сетевые ошибки Bot API (`callBotApi`) выходят без токена:
сообщение fetch в Deno содержит URL с токеном, его вырезает `redactBotToken`; это `TelegramNetworkError`
(ответ Telegram с ошибкой — `TelegramApiError`). `describeError` живёт в `_shared/errors.ts` (без зависимостей,
`admin.ts` его реэкспортирует) — его импортирует и то, что гоняет vitest под Node.

**Оповещение админа о сбоях** (`_shared/alerts.ts`, миграция 012): `alertAdmin(db, kind, detail, err)` пишет в
личный чат `ADMIN_TG_ID` (id личного чата = tg id) от бота клуба, parse_mode HTML. Вызывают: `cron-tick` — по
каждому виду сбоя за тик (`cron_schedule`, `cron_changes`, `cron_announce`, `cron_gameday`, `cron_results`, `cron_voting`; первая
ошибка вида + «ещё N в этом же шаге»), `cron_crash` — тик упал целиком (`loadSettings` и т. п.) или не проверить
`x-cron-secret` (500 `not_configured`; 401 `bad_secret` не алертится); `notify` — `notify_post`, когда Telegram не
принял пост (`TelegramApiError`, `TelegramNetworkError`); `bot-setup` и `tg-auth` не алертят. Ответы функций и
`report.errors` от алертов не меняются.
- Ключ сбоя: ошибки Telegram — `telegram:<код>` / `telegram:network` (общий для всех шагов и функций: бот,
  выкинутый из группы, — одно сообщение), кроме 400: потеря группы — `telegram:400:upgraded` /
  `telegram:400:chat_not_found`, прочие 400 (разметка, длина поста) — `telegram:400:<kind>`, чтобы мелкая ошибка
  одного поста не глушила сообщение о том, что встала вся автоматика; остальное — `kind`. Троттлинг: по ключу не чаще раза в 6 ч
  (`ALERT_WINDOW_MS`); подавленные повторы копятся в `suppressed_count`, следующее сообщение — «Ещё N раз с прошлого
  сообщения», счётчик обнуляется. Решение — чистая `decideAlert`, запись — compare-and-set по
  (`last_sent_at`, `suppressed_count`) с перечитыванием (до 5 попыток): одновременные `notify` и `cron-tick`
  шлют одно сообщение. Не дошло до админа — журнал откатывается (по `last_sent_at`, накопленные параллельными
  вызовами повторы сохраняются), следующий сбой пробует снова.
- Таблица `public.admin_alerts` (`key text pk`, `last_sent_at timestamptz`, `suppressed_count int ≥ 0`,
  `updated_at`): RLS включён без политик, права — только `service_role` (select/insert/update/delete).
- Текст (`alertText`): что не случилось, подробности (вечер по дате, без uuid), причина — первая строка ошибки
  до 300 символов без стектрейса, токен бота, ключи `sb_…`, JWT и строки подключения вырезаются (`redactSecrets`),
  время МСК, подсказка (для ошибок Telegram — по коду: 403 — бот выкинут, 400 chat not found, супергруппа,
  401/404 — токен, 429, 5xx/сеть), ссылка `https://supabase.com/dashboard/project/<ref>/functions/<функция>/logs`
  (`ref` из `SUPABASE_URL`; локально — путь словами). Обращение на «ты» (личка админа, не группа).
- Никогда не бросает: свои сбои — `console.error`. Нет/кривой `ADMIN_TG_ID` — только лог. Журнал недоступен
  (база лежит) — запасной троттлинг в памяти экземпляра: по ключу не чаще раза в час (`FALLBACK_WINDOW_MS`),
  с пометкой об этом в тексте. Он важен для `cron-tick`: алерт `cron_crash` при сбое проверки секрета уходит
  до авторизации, и без него любой запрос с непустым `x-cron-secret` при лежащей базе был бы сообщением админу. `TELEGRAM_DRY_RUN=1` — троттлинг как в проде,
  текст только в лог (`[admin-alert dry-run]`). Бот не может писать первым — админ однажды жмёт Start в личке с
  ботом (`DEPLOY.md`, «Оповещения о сбоях»); иначе Telegram отвечает 403 и алерт остаётся в логах.

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
  `kind: 'evening_changed'` — только админ, сразу после сохранения вечера в админке (миграция 008,
  `notify/changes.ts`): если анонс уже в группе (`announce_posted_at` не null) и вечер в `announced`/`cancelled`,
  сервер сравнивает `announce_snapshot` с текущим вечером (`decideAnnounceChange` в `_shared/announce.ts`):
  новое время или место будущего вечера → `change: 'moved'`, а какой пост — решает `moveKind` (там же) по
  тому, что знала группа: новое время или дата → `rescheduled`, «Вечер перенесён» (новое время с прежним;
  место — «Новое место: … (было …)», если сменилось вместе со временем, иначе «Место: …» или «Место уточним
  позже»); время то же, а в анонсе места не было → `place_set`, «Место вечера: …» (уточнение, без слова
  «перенесён» и без строки про планы); время то же, место было и сменилось → `relocated`, «Вечер переезжает: …»
  с прежним местом (убрали место — «Вечер переезжает» и «Новое место уточним позже»). В `place_set` и
  `relocated` время повторяется строкой «Время то же: …»; у всех трёх кнопка `e_<id>` «Иду / не иду»;
  тексты — `_shared/messages.ts`;
  отмена будущего → «Вечер <дата> отменён» с причиной из `cancel_reason`, если есть (миграция 010); возврат отменённого → «Вечер <дата>
  всё-таки состоится» (дополнение: иначе группа осталась бы с постом об отмене). Сохранение без изменения
  времени и места — без поста; правка прошедшего или отменённого вечера и вечер без снимка — снимок
  обновляется молча. Защита от дублей — снимок переставляется по старому значению (`eq` jsonb), при ошибке
  Telegram возвращается; каждый пост несёт актуальные данные. Анонс ещё не уходил → `not_announced`.
  Ответ `{ok: true, outcome: 'posted'|'already_posted'|'no_group'|'no_changes'|'not_announced', change?:
  'moved'|'cancelled'|'restored', move?: 'rescheduled'|'place_set'|'relocated'}` (`move` — только при
  `posted` и `moved`; `change` прежний, старый клиент его понимает); клиент —
  `notifyEveningFinished(eveningId, kind)` и `notifyEveningChanged(eveningId) → {outcome, change, move}` в
  `src/shared/api/rpc.ts`; тост админа после сохранения — по `move` (`announceChangeText` в `pages/admin/lib.ts`:
  «о переносе» / «где пройдёт вечер» / «о смене места»; без `move` — «о переносе»).
- `cron-tick` (`verify_jwt = false`, проверка `x-cron-secret` через RPC `verify_cron_secret`: пустой или
  неверный → 401 `bad_secret`, RPC недоступна → 500 `not_configured`): (1) если до ближайшей игры по
  расписанию осталось ≤ `announce_hours_before` и слот свободен — нет вечера (в любом статусе) ни в этот
  московский день по `scheduled_at`, ни закреплённого за ним по `slot_date` (перенесённый на другой день вечер
  держит свой слот: второго вечера и свежего анонса на опустевший день нет; `holdsSlot`/`slotFilter` в
  `cron-tick/schedule.ts`, миграция 010) — создаёт `evenings`
  (формат по умолчанию, банкир не назначен) и постит анонс — вместе с `announce_posted_at` пишет
  `announce_snapshot` того, что ушло в пост; (2) постит итоги голосования для вечеров
  с прошедшим `voting_closes_at` и пустым `voting_posted_at`; (3) добивает неотправленные итоги вечеров;
  (4) подстраховка `evening_changed`: для объявленных вечеров (`announced`/`cancelled`, не старше недели) тот же
  `postAnnounceChange` — если вызов из админки не дошёл, пост уйдёт с ближайшим тиком (в отчёте тика —
  `changes[id]` вида `posted:moved:place_set`); (5) **пост в день игры** (миграция 014, шаг идёт сразу после
  анонсов, алерт `cron_gameday`): вечера `announced` с началом в `(now, now + gameday_hours_before]` и пустым
  `gameday_posted_at`. Решение — `decideGamedayPost` (`_shared/gameday.ts`): анонс ещё не уходил →
  `wait_announce` (ничего не пишем, сначала уйдёт анонс); анонс ушёл уже внутри окна (`announce_posted_at >=
  начало − N ч`, в том числе в этот же тик) → `fresh_announce`, `gameday_posted_at` ставится без поста — анонс и
  пост дня игры в один тик (и подряд) группа не получает; иначе `post`. Посты о правке вечера (перенос, место,
  возврат отменённого) свежестью не считаются: `announce_posted_at` они не трогают, и пост дня игры, если окно уже
  открыто, приходит следом — ближайшим тиком или, если пост о правке отправила подстраховка шага (4), в тот же тик.
  Пост — `gamedayPost` (`_shared/messages.ts`): «Сегодня покер в 19:00» («Завтра …», если окно
  переходит через полночь, дальше — с датой), место или «Место пока не назначено», банкир или «Банкир пока не
  назначен», «Идут (n)» (пусто — «пока никто»), «Под вопросом (n)», «Не идут (n)» — имена в порядке ответа;
  «Ещё не ответили (n)» — `gamedayRoster`: активные постоянные игроки (`is_active`, не `is_guest`) без строки
  `rsvps` на вечер, по имени, с упоминанием (`mentionHtml`: «Имя (@username)», без username —
  `<a href="tg://user?id=…">Имя</a>`, без `tg_id` — имя). Списки — по правилам `groupRsvps` главной Mini App
  (`src/pages/home/lib.ts`; совпадение проверяет `gameday.test.ts`): игрок, выключенный после ответа, остаётся
  среди ответивших. Видимый текст держится в лимите Telegram (4096 символов после разбора разметки, `visibleLength`):
  не влезает — самый длинный список укорачивается до первых имён и хвоста «и ещё N» без упоминаний; кнопка
  `e_<id>` «♣️ Иду / не иду» (из эмодзи в посте — только масти: решение пользователя). Публикация — `publishOnce(…, 'gameday_posted_at', …, ['announced'], {},
  {scheduled_at})`: застолбить, только если вечер не перенесли между чтением и отметкой (параметр `match` у
  `claimPost`/`publishOnce`). В отчёте тика — `gameday[id]`: `posted`/`already_posted`/`fresh_announce`/
  `wait_announce`.
- `bot-setup` (`verify_jwt = true`, только админ — `resolveCaller` + `is_admin`, иначе 403): POST
  `{action: 'me'}` → `getMe` → `{bot: {username, name, canJoinGroups, canReadAllGroupMessages}}`;
  `{action: 'chats'}` → `getUpdates` с `allowed_updates: ['my_chat_member', 'message']`, `limit 100`, **без
  offset** (обновления не подтверждаются: повторный поиск видит их снова; Telegram хранит их не дольше 24 ч) →
  `groupsFromUpdates` (`_shared/botChats.ts`: group/supergroup, членство по последнему `my_chat_member`,
  сообщение — признак членства, если о чате больше ничего нет; группа, ставшая супергруппой, — только под
  `migrate_to_chat_id`) → до 10 кандидатов перепроверяются `getChatMember(чат, бот)` → `{chats: [{id, title,
  type, status}], updates}` — только группы, где состоит и вызывающий админ (`getChatMember(чат,
  players.tg_id)`; чужую группу с ботом выбрать нельзя), у вызывающего без `tg_id` → 403 `no_tg_id`; `{action: 'test', chatId}` (целое < 0) → пост `botConnectedPost` («Бот клуба
  подключён», кнопка на Mini App, если `bot_username` сохранён) → `{dryRun}`. Ошибки Telegram: 401/404 →
  502 `bad_token`, 409 (webhook или чужой getUpdates) → 409 `updates_conflict`, 429 → 429, пост в чат без
  бота → 409 `cannot_post`; без токена → 503 `no_token`. Dry-run: бот `DRY_RUN_BOT`, обновления
  `DRY_RUN_UPDATES` (две группы), пост в лог. Клиент — `fetchBotInfo`/`fetchBotChats`/`sendBotTestMessage`
  и хуки `useFetchBotInfo`/`useFetchBotChats`/`useSendBotTestMessage` в `src/shared/api/rpc.ts`.
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
  `materia.css`). Обновление — `node scripts/sync-materia.mjs [путь]`, руками не править.
  Порядок стилей в `main.tsx`: `materia.css` → `styles/base.css` (`@import` своих шрифтов `fonts.css`,
  safe-area Telegram `--pc-safe-*`, `--pc-app-height`, на тач-экранах `--m-control-h` = 48 px) →
  `styles/app.css`; стили кита — `src/shared/ui/ui.css`, только на переменных «Материи».
- Шрифты «Материи» — **свои файлы**, Google Fonts не используется (из РФ он открывается не всегда, а
  `@import` шрифтов в листе блокировал запуск). Sync-скрипт вырезает `@import` Google из `materia.css` и
  сверяет: каждое семейство «Материи» есть у нас или явно не нужно (`UNUSED_FAMILIES`), новых осей в
  `font-variation-settings` нет (`KNOWN_VARIATION_AXES`). Файлы скачивает `node scripts/fetch-fonts.mjs`
  (Google Fonts CSS API, только для разработки; сборка и CI в сеть не ходят): woff2 в `public/fonts/`
  (Vite копирует как есть, к путям `/fonts/…` в CSS сам дописывает `BASE_PATH`), `@font-face` с
  `font-display: swap` и `unicode-range` — в `src/styles/fonts.css` (его `@import` — в `styles/base.css`),
  лицензии (SIL OFL 1.1) — `public/fonts/OFL.txt`. Руками эти файлы не править.
  Набор: Кобальт — Geologica (оси `wght` + `SHRP`: «Материя» пишет заголовкам `"SHRP"`) и Martian Mono
  (`wght`); Янтарь — Sofia Sans Condensed, Sofia Sans, JetBrains Mono (`wght`); Фарфор (Literata,
  Commissioner) не скачивается. Неиспользуемые оси зафиксированы на значениях, которые браузер и так
  выбирал: Geologica `slnt` 0 и `CRSV` 0 (курсива нет), Martian Mono `wdth` 100 (`font-stretch: normal`).
  Подмножества — `latin` и `cyrillic` плюс `extra` из символов интерфейса вне них (`EXTRA_CHARS`: ₽, →;
  в `unicode-range` — только те, что есть в шрифте; в Sofia Sans ₽ нет — на табло он из фолбэка). Новый
  такой символ в UI — дописать в `EXTRA_CHARS` и перезапустить. Браузер качает файл, только когда на
  экране есть текст этим семейством и символом из его диапазона: шрифты Янтаря грузятся только на табло.
  Пока файл не пришёл, текст рисуется системным фолбэком из токенов `--font-*`.
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
  primary на экран, обращение — на «ты» (см. ниже). Витрина кита в dev: `/#/dev/kit` (переключатель kobalt/kobalt-dark) и
  `/#/dev/kit-yantar` (табло-цифры), в прод-сборку не попадает.
- Общие помощники экранов — `src/shared/lib` (импорт из `index.ts`; чистые модули тесты берут напрямую):
  `format` (деньги, числа, даты, `NBSP`), `text` (склонения, места, правило очков, `capitalize`, `joinNames`,
  `normalizeName`/`NAME_MAX` как у `set_my_name`/`add_guest`), `season` (подписи квартала), `clubTime`
  (Москва UTC+3 ↔ UTC для форм, `nextGameSlot`/`nextGameAt` — то же правило, что `cron-tick/schedule.ts`,
  сверяется тестом), `voting` (`votingPhase`, `participantIds` как `is_participant`), `paths`, `useNow`,
  `useElementWidth`, `clubLife` (подписи «Жизни клуба»: `ACHIEVEMENT_SHORT` — описания ачивок без рода,
  `recordValueParts`/`recordValueText` — одно значение рекорда на все экраны, выигрыш со знаком); `poker/` — движок
  олл-ина, импорт из `shared/lib/poker` (свой `index.ts`: в нём React-хук с Web Worker, поэтому чистые модули —
  например `pages/evening/lib.ts` — и тесты берут `poker/cards`, `poker/equity` напрямую). Между папками
  `src/pages/*` разрешены только три связи: табло берёт подписи вечера из `pages/evening/lib`, карточка игрока — места
  и чемпиона из `pages/rating/stats`, главная — «Твой вечер» из `pages/evening` (`EveningRecap`, `useEveningRecap`,
  `recap`: та же карточка, что на экране вечера); остальное общее — здесь.
  Статус вечера везде — `EveningStatusBadge` кита; `errorMessage` показывает русские тексты RPC как есть,
  а английские служебные сообщения Postgres/PostgREST заменяет переводом по коду (исходник — в `cause`).
- Никакого `dangerouslySetInnerHTML` и сырого HTML из пользовательских данных.
- Маршруты (HashRouter): `/` главная; `/evening/:id` вечер (живой экран; у банкира — пульт);
  `/evening/:id/settle` расчёт; `/evening/:id/vote` голосование; `/board/:token` табло (публичное,
  вне AuthProvider); `/rating` (сезон / деньги / всё время / оракул / рекорды / зал славы, `?tab=season|money|
  alltime|oracle|records|fame`, `useRatingParams`); `/player/:id`; `/history` (вкладки «Вечера» и «Моменты»,
  `?tab=moments`); `/admin`, `/admin/evening/new`, `/admin/evening/:id`; только в dev — `/dev/kit`, `/dev/kit-yantar`.
  `/admin` без `?tab` (и с неизвестной вкладкой) открывает «Вечера» (`adminTab` в `pages/admin/lib.ts`).
- Админка «Клуб» → «Расписание»: «Анонс за» и рядом «Пост в день игры за» (`gamedayHours` в
  `pages/admin/settingsDraft.ts`, 1–48 ч, как check миграции 014). Подпись раздела — `gamedayNote`: за сколько часов
  бот напишет, кто идёт и кто не ответил, а если окно не меньше срока анонса — что анонс приходит уже внутри окна
  и отдельного поста обычно нет, но он может прийти после переноса вечера на другой день (перенос снимает
  `gameday_posted_at`, а `announce_posted_at` остаётся: анонс, оказавшийся раньше нового окна, пост не гасит).
- Админка «Клуб» → «Группа и бот» (`pages/admin/BotSetup.tsx`): «Подтянуть из бота» (`bot-setup` me) и выбор
  в шторке «Найти группу» (`bot-setup` chats) сохраняют одно поле сразу (`upsertSettings`) и подставляют его
  в открытый черновик формы; «Отправить проверочное сообщение» — в сохранённую группу. Подсказка «Если
  группа не находится»: бот — админ группы, поиск сразу после добавления (Telegram хранит обновление сутки),
  иначе удалить бота и добавить снова. ID группы и имя бота по-прежнему можно вписать руками.
- Админка «Игроки»: у игрока без `tg_id` — «Привязать к Telegram» (`pages/admin/MergeSheet.tsx`): выбор профиля
  с Telegram, предпросмотр `merge_players_preview` (что перенесётся, что мешает), подтверждение с перечнем,
  результат тостом. «Вечер»: после сохранения вечера с уже ушедшим анонсом — `notifyEveningChanged`; отмена
  такого вечера, пока он впереди, — через подтверждение (пост не отзовёшь), причина — отдельное поле «Причина для
  группы» (`cancel_reason`), заметка анонса не меняется; возврат снимает причину, а пометка «Вечер отменён»
  заранее говорит, что бот напишет «всё-таки состоится». О прошедшем вечере сервер молчит — форма поста не
  обещает (`announceReach` в `pages/admin/lib.ts`). Перенос на другой день: пометка, что день по расписанию
  останется без вечера (`vacatedSlot`, по `slot_date`).
- Mini App обращается на «ты» (со строчной) — осознанное отступление от голоса «Материи» (решение пользователя),
  остальные правила голоса в силе: без эмодзи и восклицаний, «ёлочки», ё, кнопка = глагол + объект, ошибка =
  что случилось и как исправить. Формы, где «ты» требует рода (прошедшее время, краткие прилагательные),
  перестраиваем: «В этот вечер тебя не было за столом», а не «Ты не играл». На «ты» и тексты ошибок, которые
  интерфейс показывает как есть: RPC (миграция 009 — `add_event`, `set_my_name`, `cast_vote`) и ответы
  Edge Functions `tg-auth`/`notify`. Посты бота обращаются к группе во множественном числе — как и заметка
  вечера, которая уходит в анонс (отсюда пример «Возьмите наличку на ребаи» в форме вечера).
- «Жизнь клуба» (без новых таблиц: всё из `useClubHistory` и домена). Вход домена — `clubFeedInput(history)`
  (`shared/api/historyFeed.ts`). Голоса до закрытия голосования RLS отдаёт только свои, поэтому `ClubHistory.fetchedAtMs`
  (время загрузки по часам сервера, до запросов) ограничивает моменты: `clubMoments(..., {nowMs: momentsNowMs(history,
  now)})` — голосование, закрывшееся после загрузки, моментов не даёт, а `useClubHistory` сам перезапрашивает историю к
  ближайшему `voting_closes_at` после загрузки (`refetchInterval`, +2 с). Звёзды (`stars`) — по тому же моменту.
  Главная: незакрытые расчёты → ближайший вечер → открытое голосование (`OpenVoting`) → «В клубе» (`FeedSection`:
  `clubEvents` — один раз на историю, моменты — отдельно; 8 строк; Немезиды одного вечера и сезонные ачивки одного
  сезона — одной строкой; события вечера, включая моменты, подписаны днём вечера; ссылки — вечер, игрок, голосование,
  `?tab=records`, `?tab=fame`) → «Последний вечер» с «Твоим вечером» → «Сезон». «Твой вечер» (`pages/evening/
  EveningRecap`, `useEveningRecap`) — на главной и на экране завершённого вечера; не игравшему, но сделавшему прогноз —
  только прогноз и новые ачивки. На экране вечера карточка сверяет журнал истории с живым (`journalVersion`):
  расхождение (админ поправил закрытый вечер с другого устройства) — карточки нет, история перезапрашивается.
  «История → Моменты» (`MomentsTab`): моменты по вечерам, плашка идущего голосования. «Рейтинг → Рекорды»
  (`RecordsTab`): `recordsTable`, держатель — ссылка на вечер. Карточка игрока: «Цифры» (`Numbers`, `stats.ts`:
  личные рекорды с пометкой «Рекорд клуба», доля вечеров в призах, среднее место) и ачивки с прогрессом
  (`progress.ts`: полученные / «На подходе» / сезон / остальные). Гости в ленте и моментах — как есть, ачивок, званий,
  рекордов игрока и прогресса у них нет.
- Кратность входа на пульте банкира (`pages/evening/StacksPicker.tsx`): «−» / «×k» / «+», ×1 по умолчанию,
  до ×10, под значением — сумма и фишки («1 000 ₽ · 1 000 фишек», `stacksAmountText`), подсказка — голова и
  доля фонда (`stacksHint`). В шторке «Кто пришёл» / «Опоздавший игрок» (`SeatSheet`) — одна кратность на всех,
  кого сажают этим нажатием, и на гостя; после гостя кратность возвращается к ×1, при ×k сумма — на главной
  кнопке («Посадить за стол: 6 · по 1 000 ₽», `seatButtonLabel`); в шторке ребая (`PlayerSheet`) — своя у
  каждого ребая. Лента:
  `describeEvent(ev, nameOf, formatRub, format)` — при k > 1 подпись «вход на 1 000 ₽» / «ребай на 1 500 ₽»;
  строка игрока (`playerLine(p, format)`) — «взнос 2 500 ₽», если хоть один вход был кратным; «Баунти»
  на экране вечера — `state.bountyPoolRub`, подпись — головы тех, кто в игре, по текущим входам
  (`bountyNote`: «200 ₽ за голову» или «100–300 ₽ за голову»). Вылет — голова
  текущего входа жертвы (`currentStacks`) в подсказках шторки.
- Время вечера: `useNow(1000)` + `replay(format, events, now)`; `now` — по часам сервера
  (`src/shared/lib/serverClock.ts`: смещение по замерам `server_now` при старте и возврате на экран,
  `board_state.server_now` на каждом опросе табло и `at` из ответов `add_event`; берётся замер с
  наименьшим RTT). После записи `useEveningActions.send` прогоняет replay с новой записью: если журнал
  её не принял (например, ребай пришёл после закрытия), вместо «записан» — предупреждение.
  События вечера — запрос + Realtime-подписка на `evening_events` с фильтром `evening_id=eq.<id>`;
  табло без авторизации опрашивает `board_state` раз в 3 с.

## Олл-ин: карты, шансы и ауты на табло (миграция 017)

Когда игроки в олл-ине вскрываются, банкир отмечает в пульте их карты и стол; табло и экран вечера у всех
показывают руки, стол, шансы на победу и ауты, всё пересчитывается с каждой картой. Железа нет — ручной ввод.

- **Пульт** (`pages/evening/ShowdownSheet.tsx`, логика — чистый `showdownDraft.ts`): «Отметить олл-ин» в пульте
  (раздача на табло — «Продолжить олл-ин») и «Отметить карты» в панели. Шторка: «Кто вскрывается» — `PlayerPicker`
  из тех, кто в игре, и участников раздачи на табло и черновика (`showdownCandidates`: вылетевший участник открытой
  раздачи остаётся в списке и после снятой галочки; вернули — `setPlayers` ставит его на прежнее место и возвращает
  его карты с табло, если их никто не занял), до 9; места карт — руки по очереди, затем флоп, тёрн, ривер;
  колода — сетка 13 рангов × 4 масти, одно касание — одна карта в подсвеченное место, дальше — следующее пустое;
  занятые карты недоступны, повторное касание снимает карту, касание места — поправить его. При 1–3 игроках места
  прилипают к верху шторки, если экран достаточно высокий (600 / 760 px). Главная кнопка (`sendLabel`): «Показать на
  табло» → «Открыть флоп» → «Открыть тёрн» → «Открыть ривер»; правка — «Сохранить правку»; после ривера —
  «Закрыть раздачу» (иначе она — ghost-кнопкой). Каждая отправка — `showdown` с полным состоянием (`checkDraft`:
  «Отметь карты: …», «Отметь все три карты флопа», «Карты стола — по порядку…»), тост с «Отменить» (void).
  `showdownId` — `newClientId()` при открытии раздачи. Олл-ин на флопе/тёрне — руки и стол одной отправкой.
- **Показ** — `ShowdownView` кита (`src/shared/ui`, вариант `board` для табло и `compact` для экрана вечера) и
  `PlayingCard`/`SuitPip`: стол из пяти мест (пустые — пунктиром), руки (карты, рука словами — «Пара дам»,
  «Флеш до туза»), шансы — целые % и полоса (лидер по шансам — accent), «делёж N %» (частота дележа), «Впереди»
  у лучшей руки на текущем столе, ауты; на ривере — «Лучшая рука» / «Делёж банка», проигравшие приглушены.
  Табло (`pages/board/ShowdownBoard.tsx`) показывает панель вместо таймера и стола, пока `visibleShowdown`
  (`BoardPage`), часы уровня — строкой в её шапке; экран вечера (`LiveView`) — первой карточкой, у банкира с
  кнопкой. Масти — значками (SVG, не символами шрифта) и цветом: ♠ ink, ♥ critical, ♦ синий из категориальной
  палитры регистра (Кобальт — chart-1, тёмный — chart-4, Янтарь — chart-5), ♣ positive (`showdown.css`).
  Проценты — `roundShares`: целые, сумма 100, равные доли — равные цифры (тогда сумма может быть 99). Руки, равные
  по шансам из-за равноправия мастей (AhKd и AdKh против 7c7s), и до флопа получают в точности равные доли — движок
  их усредняет (`suitSymmetryGroups`, см. «Движок»), иначе шум Монте-Карло дал бы 18 % и 17 %.
- **Табло на ТВ** (от 1024 px в горизонтали): панель целиком в экране — прокрутить табло нечем. На время олл-ина
  табло во всю ширину (`bd--showdown` в `BoardPage`, без `--container-wide`); размеры панели — в долях `--sd-u`
  (`min(1vh, (100vw − 96px) / 164)`: сотая высоты кадра 16:9 или 1/164 ширины панели), поэтому раскладка одна на
  1280×720, 1920×1080 и 4K; стол — справа от заголовка и часов. Руки по `data-hands`: 2–4 — в один ряд, 5–6 — по
  три, 7–8 — по четыре, 9 — по пять в два ряда, карты и цифры мельче с каждым шагом; имя и рука словами — в одну
  строку с многоточием, ауты — сплошной строкой. Остальное (длинный список аутов в узкой колонке, строки подвала
  табло, низкий экран) ловит `useFitToScreen` (`pages/board/fitToScreen.ts`): если страница длиннее экрана, масштаб
  `--sd-fit` подбирается двоичным поиском по настоящей раскладке (`bestFit`, от 1 до 0,6) при смене раздачи,
  размера окна и высоты страницы (ResizeObserver, не чаще раза за кадр). Проверено в headless Chrome на стенде с
  разметкой табло (длинные имена, строка подвала): 2–9 рук на всех улицах при 1920×1080, 1366×768, 1280×720,
  1024×768, 2560×1440 — без прокрутки и наложений, масштаб меньше 1 понадобился только девятерым на флопе при
  1366×768 и 1280×720 (0,99 и 0,975); худший случай (9 рук с длинными списками аутов, 1280×720, три строки
  подвала) — 0,84.
- **Движок** (`src/shared/lib/poker`, перенос из курса `D:\personal\poker-course\js`: `cards.js`, `evaluator.js`,
  `equity.js`, `pokermath.js` — только `nCk` и `outsEquity`; диапазоны и прочая математика курса не нужны).
  Карта — 0..51 (ранг·4 + масть), `evaluate` — счёт руки 5–7 карт. `computeEquity(hands, board)` по `planEquity`:
  точный перебор, если досок не больше `EXACT_BOARD_LIMIT` (250 000 — флоп, тёрн, ривер при любом числе игроков),
  иначе (до флопа) Монте-Карло: `MC_EVAL_BUDGET / игроков` раздач (не меньше `MC_MIN_SAMPLES`; у двоих — 200 000),
  seed — FNV-1a ключа раздачи `showdownKey` («AsKd|QhQc/2c7d9h»), генератор `mulberry32` курса; без `Date.now` и
  `Math.random` — одни карты дают одни цифры на табло, у банкира и у игроков. Симметрия мастей
  (`suitSymmetryGroups`): перестановки мастей (24), которые оставляют стол на месте, а руки переставляют между собой,
  делят руки на группы с точно равными шансами; доли, победы и дележи группы усредняются (в Монте-Карло и в точном
  переборе), сумма остаётся 100. Эталоны в тестах: cardfight.com
  (AA–KK 81,71/0,46/81,95, AKs–QQ 45,83/0,43/46,05 — агрегат по мастям, точность 0,01), полный перебор
  2 598 960 пятикарточных рук, выборка семикарточных, ауты против точного перебора.
- **Ауты** (`computeOuts`/`analyzeShowdown`): у игрока, чья рука на текущем столе слабее лучшей, — карты из
  невидимой колоды (52 без всех открытых рук и стола: сброшенные карты не видны, их считаем в колоде), после
  которых на следующей улице он впереди один (`outs`) или делит лучшую руку (`splitOuts`). Флоп — ауты к тёрну
  (одна карта; шансы до ривера с раннерами — в процентах), тёрн — к риверу (там ауты и есть шансы), до флопа —
  только проценты, на ривере — итог. У лучшей руки (и у делящих её) аутов нет. На экране: «Ауты к тёрну: 9 · 20 %»
  (`hitPct` = `outsEquity(аутов, 1, невидимых)`) и карты по рангам: «A ♠♥♦ · K ♠♥♦», отдельно «на делёж».
  Побочные банки не считаются: шансы — выиграть раздачу у всех её участников.
- **Производительность** (`useShowdownEquity`/`useShowdownAnalysis`): с флопа — меньше тысячи досок, считаем на
  месте; до флопа Монте-Карло считает Web Worker (`equity.worker.ts`, `?worker`), без воркера — главный поток
  кусками по 2 000 раздач между кадрами (`createMcJob`/`runMcJob`; нарезка на результат не влияет). Кеш — по
  ключу раздачи (48 последних): опрос табло раз в 3 с и секундный тик часов не пересчитывают раздачу. Пока
  считается — «…» и «Считаю шансы».
- **Когда табло возвращается к таймеру**: «Закрыть раздачу» (`showdown_close`), новый олл-ин, finish — или само:
  через 2 минуты после последней правки, если ривер открыт, и через 10 минут без правок на любой улице
  (`visibleShowdown`). Раздача, спрятанная временем, в пульте не продолжается: «Отметить олл-ин» откроет новую.
- Лента и отмена: `describeEvent` — «Олл-ин: Женя и Саша» (руки — подробностью), «Флоп: J♥ 10♥ 2♣», «Тёрн: 5♠»,
  «Ривер: K♠», «Олл-ин закрыт» (правка — по числу карт стола); «Отменить последнее» и строка ленты отменяют
  правку (подтверждение: «Табло покажет раздачу такой, какой она была до этой записи»). Итоги (`postCorrectedResults`,
  пометка «итог устарел» в `FinishedView`) олл-ин не трогает, как и платежи.

## Проверки вне vitest
- `supabase/tests/008_reopen_merge.sql` — SQL-проверки миграции 008 (открытие расчёта правкой, `merge_players`,
  `set_prediction` с гостем) в одной транзакции с rollback:
  `docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/008_reopen_merge.sql`.
- `supabase/tests/010_slot_reason_settle_merge.sql` — то же для 010 (`slot_date` при вставке и переносе,
  `cancel_reason`, `mark_settled` по устаревшему журналу, текст препятствия, забытая ссылка на гостя).
- `supabase/tests/013_scoring_snapshot.sql` — то же для 013 (снимок у завершённых, смена очков не трогает прошлые
  вечера, снимок не пишется снаружи, отмена и повторный finish, заморозка «лучших N» при правке настройки, права
  на `season_rules`, ограничения при выключенном триггере). Требует «сейчас» не раньше 2026-Q4 (seed — 2026-Q3/Q4).
- `supabase/tests/014_gameday_post.sql` — то же для 014 (`gameday_hours_before`: умолчание, границы 1–48, правка
  админом и только им; `service_role` пишет `gameday_posted_at`; перенос в пределах московского дня отметку не
  снимает — в том числе через полночь UTC, на другой день — снимает, в том числе upsert формы админки).
- `supabase/tests/015_entry_stacks.sql` — то же для 015 (`stacks` у join/rebuy: хранение только при k > 1,
  отказы 22023, ключ повтора сверяет кратность, `add_guest` с `p_stacks` и двумя аргументами, права,
  `payload_replace_player` сохраняет `stacks`).
- `supabase/tests/017_showdown.sql` — то же для 017 (нормализация `showdown`/`showdown_close`, отказы 22023 по
  картам, рукам, столу, игрокам не за столом и отменённому входу, ключ повтора сверяет карты, `board_state` отдаёт
  олл-ин и имена его игроков, отменённую правку — нет, check типов в таблице, слияние гостя из руки олл-ина,
  права служебных функций):
  `docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/017_showdown.sql`.
- `node scripts/check-merge-replay.mjs` — слияние гостя «Вова» из seed с новым Telegram-профилем в транзакции
  с rollback: replay, settlement, голоса и прогнозы каждого вечера после слияния совпадают с исходными
  с подменой id.

## Тестовые данные (seed.sql, только локально)
Игроки с `tg_id` 1001–1006 (1001 — админ), один гость, settings (четверг 19:00 МСК, анонс за 48 ч, пост в день игры за 5 ч; клубный формат
создаёт миграция 011, seed на него ссылается), `cron_secret` = `local-cron-secret`, `project_url`, 4–6 завершённых вечеров с реалистичными событиями (ребаи, сплит-нокаут,
платежи) и один `announced` вечер — чтобы рейтинг, ачивки и карточки игроков было на чём смотреть.

## Деплой в облако
Процесс целиком — `DEPLOY.md`. `.github/workflows/deploy.yml` (push в `main` + вручную; триггеров
`pull_request*` нет — репозиторий публичный): `checks` (npm ci, typecheck, lint, test) → `pages-build`
(сборка с `BASE_PATH=/poker-club/` и `.env.production`, проверка, что dev-входа нет в бандле) → `pages-deploy`;
параллельно `backend` (только `refs/heads/main`): без секретов `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` — notice и успех, иначе
`supabase link` → `db push --linked --skip-vault --yes` (без seed) → `functions deploy` → `secrets set`
(`APP_URL` из vars, `ADMIN_TG_ID` и `TELEGRAM_BOT_TOKEN` из секретов) → `project_url` в Vault через Management API →
проверка: `cron-tick` 401 на неверный секрет; SQL — гранты `service_role` на все таблицы/sequences `public`,
`cron_secret` и `project_url` в Vault, активное задание pg_cron; `private.invoke_cron_tick()` → ответ в
`net._http_response` 200 без `errors`. Переменные репозитория: `SUPABASE_PROJECT_REF`, `APP_URL`; секреты —
`SUPABASE_ACCESS_TOKEN` (scoped), `SUPABASE_DB_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `ADMIN_TG_ID`. Actions закреплены SHA,
обновления — Dependabot (`.github/dependabot.yml`). Резервные копии и keepalive — отдельный приватный репозиторий `poker-club-ops`: там же ежемесячная
проверка восстановления копии (`restore-check.yml`) и напоминание о сроке токена Supabase (`reminders.yml`,
переменная `TOKEN_EXPIRES` — дата окончания `SUPABASE_ACCESS_TOKEN`; при замене токена обновлять).

Auth в облаке: `supabase config push` не используется (`[auth]` в `config.toml` — локальные адреса);
регистрация выключена руками. Провайдер Email не выключать: вход `tg-auth` → `verifyOtp(token_hash)` с
выключенным провайдером не проверялся. Сразу после деплоя войти админом (`ADMIN_TG_ID`), до подключения
группы. Участника, вышедшего из группы, админ выключает (`is_active=false`): refresh-токен иначе живёт дальше.
