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
    _shared/votingReminder.ts    # напоминание о голосовании: писать ли сейчас, кто может голосовать (чистое, vitest)
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
  shared/lib/poker/*             # олл-ин на клиенте: ауты, подписи, хуки шансов с Web Worker (раздел «Олл-ин»);
                                 # сам движок (карты, оценка рук, эквити) — в домене: _shared/domain/poker/*
  vendor/materia/*               # вендоренная «Материя» (scripts/sync-materia.mjs)
  styles/fonts.css               # @font-face своих шрифтов (пишет scripts/fetch-fonts.mjs)
public/fonts/                    # woff2 шрифтов «Материи» + OFL.txt (scripts/fetch-fonts.mjs)
scripts/                         # node-скрипты разработки (check-merge-replay.mjs — оба вида слияния на seed;
                                 # sync-materia.mjs — вендоринг «Материи»; fetch-fonts.mjs — шрифты)
scripts/voice/                   # генератор голоса табло (его запускает voice.yml в poker-club-ops):
                                 # manifest.mjs — манифест фраз (Node), generate.py — Silero → MP3 →
                                 # voice_clips, requirements*.txt, test_generate.py
```

Правило импорта домена: во фронте `import { replay } from '@domain/replay.ts'` (alias в vite и
tsconfig), в функциях — относительным путём `../_shared/domain/replay.ts`. Внутри домена — только
относительные импорты с расширением `.ts`, никаких npm-пакетов, `Date.now()` не вызывать (время
передаётся параметром `nowMs`).

## Доменная модель (supabase/functions/_shared/domain)

Вечер — **журнал событий** (event sourcing). Всё состояние (уровень, кто в игре, места, нокауты,
фонд, долги) вычисляется функцией `replay` из формата и событий. Отмена действия —
пометка события `voided`, история сохраняется.

### Баунти убрано (решение клуба 07.10.2026, миграция 018)
Денег «за голову» больше нет: весь взнос входа и ребая идёт в призовой фонд, фонд = Σ `buyInRub·k` по всем входам
и ребаям (кратность k из 015 сохраняется: вход ×2 = 1 000 ₽ = 1 000 фишек, всё в фонд), выигрыш игрока — только
призовые за место. Из домена убраны `TournamentFormat.bountyRub`, `PlayerState.bountyWonRub` и `currentStacks`,
`EveningState.bountyPoolRub`, `MoneyRow.bountyRub`, `EntryAmounts.bountyRub`/`poolRub`, сиротские головы и деление
головы при дележе; из интерфейса — статы «Баунти», подсказки «Голова — …, в фонд — …», поле баунти в редакторе
формата, «за голову» в анонсе и посте итогов. Нокауты остаются статистикой: кто выбил — в журнале, +`koPoints` за
нокаут в очках, ачивки «Первая кровь», «Охотник», «Заклятый враг», звание «Немезида», рекорд нокаутов, лента,
«Лучший охотник» (по числу нокаутов, без денег) и голос табло («Выбил X»). Совместимость: `bountyRub` в старом jsonb
(`formats.config`, `evenings.format`) домен молча игнорирует (`validateFormat`, `replay`, форма админки при
сохранении его отбрасывает), а миграция 018 вычищает ключ из конфигов форматов и снимков формата всех вечеров;
SQL-функции поля не читали, их тела не менялись. Платежи `seed.sql` пересчитаны.

Выкладка 018 и нового домена (ревью 08.10.2026) — два условия, оба зависят от того, когда и как выкатить:
- **Сыгранные вечера пересчитываются по новым правилам.** Домен ключ не читает, и от миграции это не зависит: вечер,
  сыгранный по старому коду со 100 ₽ за голову, после деплоя считается без неё — фонд и призовые больше, записанные
  платежи перестают сходиться в ноль (у закрытого вечера в расчёте снова долги), меняются «Деньги» в рейтинге, нетто
  и рекорд выигрыша этого вечера. Это допущение, а не факт: оно безвредно, только пока в облаке нет вечеров в
  `finished`/`settled` со снимком `bountyRub > 0`. При подготовке 018 облако не открывали; на момент запуска
  (07.10.2026) сыгранных вечеров не было, первый вечер клуба назначен на пятницу 09.10, 15:00 МСК (по памяти проекта,
  не проверено). Выкатить до него — вопроса нет; после — проверка и развилка в DEPLOY.md («Обновления»): пересчитать
  такие вечера и поправить платежи или сохранить им старые правила (тогда баунти в домене вернётся для старых снимков).
- **Открытые на старой сборке клиенты получают `NaN`.** Старый `replay` считал `buyInRub − bountyRub` без значения по
  умолчанию, а новый формат доходит до них без перезагрузки: `evenings` в Realtime (004) — UPDATE из 018 сам рассылает
  изменение, табло опрашивает `board_state` раз в 3 с. «Фонд», призы и расчёт показывают «NaN ₽», старая форма админки
  отклоняет формат без ключа («Баунти должно быть целым числом рублей») — до перезагрузки страницы; табло на ТВ само
  не перезагружается. Поэтому порядок выкладки важен: не выкатывать во время вечера, после деплоя перезагрузить
  табло и открытые Mini App (DEPLOY.md, «Обновления»).

### Уровни и сюжетные ачивки (решение клуба 08.10.2026, без миграций)
Ачивки, как и раньше, нигде не хранятся: `computeAchievements` пересчитывает их из итогов вечеров, прогнозов и
голосов при каждом показе и посте. Снимка правил ачивок в данных нет (в отличие от очков — `evenings.scoring`,
миграция 013), поэтому новые правила сразу действуют и на прошлые вечера. По словам пользователя на 08.10.2026
сыгранных вечеров в облаке нет — пересчитывать задним числом нечего (облако при подготовке не открывали, не
проверено). Выданное не отнимается: каждая строка ачивки несёт уровень своей выдачи, уровень игрока — наибольший.
- **Уровни** (`ACHIEVEMENT_LEVELS`, римские цифры I/II/III — коротко и без рода: «Охотник II»):
  «Охотник» — 3 / 4 / 5+ нокаутов за вечер (уровень выдачи — по нокаутам этого вечера); «Камбэк» — победа после
  2 / 3+ ребаев (два уровня); «Заклятый враг» — 5 / 10 / 15 нокаутов одного и того же игрока за всё время (строка — в
  вечере, где пара взяла порог, с соперником в `targetId`; два порога за вечер — одна строка со старшим уровнем);
  «Звезда вечера» — 1 / 5 / 10 звёзд за всё время (строка на вечер: `count` — звёзды вечера, уровень — по счёту
  после него).
- **«Звезда вечера»**: по номинации — только единственному лидеру голосования с `STAR_MIN_VOTES` (2) голосами и
  больше; ничья или один голос — никому; гость-лидер звезду не получает, второму месту она не переходит
  (`starWinner`, `starAwards`). Номинации прежние — рука, блеф, бэд-бит вечера.
- **Сюжетные**: «Феникс» — первый вылет вечера (`firstBustPlayerId`) и победа; «Чистая победа» — победа без
  ребаев; «Месть» — нокаут своей Немезиды (звание по вечерам ДО этого, как в «Сюжете вечера»; пара — раз за вечер,
  при дележе — каждому; Немезида в `targetId`); «Охота на короля» — нокаут действующего чемпиона: чемпиона
  предыдущего сезона (тот же, что носит значок «до конца следующего сезона»; `reigningChampionsFor`), а не держателя
  «Формы» — чемпион и есть «король», трофей клуба; до конца первого сезона клуба (2026-Q4) её не получить.
- Гости и тренировки ачивок не получают (тренировка не входит в историю клуба; в «Сюжете вечера» — флаг `training`).

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
  buyInRub: number;        // 500 — цена стандартного входа и ребая (вход ×k — buyInRub·k), весь взнос — в фонд
  startingChips: number;   // 500 — фишек за стандартный вход и ребай (×k — startingChips·k)
  // bountyRub (баунти «за голову») убран 07.10.2026 — см. «Баунти убрано»; в старом jsonb игнорируется
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
  | 'showdown' | 'showdown_close'            // олл-ин на табло (миграция 017), на игру не влияет
  | 'amend' | 'time_adjust';                 // правка записи на месте, ±время уровня (миграция 022)

export const MAX_ENTRY_STACKS = 10;
export const AMENDABLE_EVENT_TYPES = ['join', 'rebuy', 'bust'];         // что исправляет amend (022)
export type AmendPayload =
  | { eventId: number; stacks: number }      // join, rebuy: новая кратность 1..10 (хранится и 1)
  | { eventId: number; by: PlayerId[] };     // bust: новые выбившие
export const MAX_PAUSE_MINUTES = 120;
export const PAUSE_MINUTES_OPTIONS = [5, 10, 15, 20, 30]; // длительности перерыва на пульте (фразы озвучены)
export type PausePayload = { minutes?: number };          // timer_pause; нет поля — пауза без срока
export const MAX_TIME_ADJUST_SECONDS = 3600;
export type TimeAdjustPayload = { seconds: number };      // time_adjust: ± к остатку уровня

export type EventPayload =
  | { playerId: PlayerId; stacks?: number }                  // join, rebuy; stacks — кратность k (1..10, нет = 1)
  | { playerId: PlayerId; by: PlayerId[] }                   // bust; by = кто выбил (0..n)
  | { playerId: PlayerId; amountRub: number; note?: string } // payment: + игрок→банкир, − банкир→игрок
  | ShowdownPayload                                          // showdown
  | { showdownId: string }                                   // showdown_close
  | AmendPayload | PausePayload | TimeAdjustPayload           // amend, timer_pause, time_adjust (022)
  | Record<string, never>;                                   // timer_start, timer_resume, level_*, hand, finish

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
  это k стандартных входов: взнос `buyInRub·k` (весь — в призовой фонд), фишки `startingChips·k`.
  Пример: вход на 1 000 ₽ — 1 000 фишек и +1 000 ₽ к фонду. Некорректное `stacks` (0, 11, дробь, строка,
  null) — событие отбрасывается с ошибкой «Кратность входа — целое число от 1 до 10» (`readStacks` →
  null). Число входов (`entries`, `totalEntries`) считается штуками, деньги и фишки — по сумме кратностей.
- `join`: игрок входит (entries += 1, stacks = k, alive). Разрешён, пока вход открыт
  (`rebuysOpen`) — то есть это и поздняя регистрация. Повторный join того же игрока — ошибка.
- `rebuy`: только для вылетевшего игрока (alive=false), пока `rebuysOpen` и не превышен лимит;
  stacks += k (своя кратность у каждого ребая).
- `bust {playerId, by}`: игрок вылетел. Каждый игрок из `by` получает +1 нокаут (KO засчитывается
  каждому при дележе), пустой `by` — нокаут никому. Нокаут — только статистика (очки, ачивки, звания,
  рекорды, лента, голос табло): на деньги он не влияет, денег «за голову» нет (с 07.10.2026). Каждый
  bust считается нокаутом, даже если жертва потом сделала ребай.
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
  buyInRub` (все взносы), `totalChips = totalStacks * startingChips`; взнос игрока `owesRub = stacks *
  buyInRub`. Выплаты по `payoutPct` для первых min(n_игроков, payoutPct.length) мест с перенормировкой
  до 100%, вниз до рубля, остаток 1-му месту. Выигрыш игрока — только призовые за место, нетто =
  приз − взносы. Сумма всех призовых ровно равна сумме всех взносов — это инвариант, его проверяют
  тесты (`money.test.ts`: ручные сценарии, 3000 сгенерированных вечеров со смешанными кратностями —
  независимый пересчёт взносов и нокаутов, раскладка фонда по местам, тот же журнал без выбивших даёт
  ту же денежную таблицу, — полный перебор ~22 тыс. вечеров на троих со входом 333 ₽).
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
- **Правка записи на месте** (аудит 07.10.2026, миграция 022, `amend.test.ts`): `amend {eventId, stacks | by}` исправляет
  у более ранней записи вечера кратность (`join`/`rebuy`) или выбивших (`bust`) и применяется **в позиции исходной
  записи**, а не в своей: исправленная запись проходит `validate` с новым значением там, где стоит, — порядок мест
  (`finalBustEventId` — id исходной записи), ребаи и уровни после неё не сдвигаются (раньше «отменить и записать
  заново» ставило вылет в конец журнала, и ребай после него становился «не принят»). Поправки собираются заранее
  (`collectAmends`); каждая проверяется в позиции исходной записи, в силе — **последняя принятая** (отмена её
  возвращает предыдущую или исходное значение); ни одной принятой — запись как была. Отказы поправки (её id в
  `errors`): форма (`readAmend`: id — целое > 0, ровно одно из `stacks` 1..10 / `by` — список строк), записи нет,
  она не раньше поправки, отменена, не вход/ребай/вылет, значение не к той записи, исправленная запись не проходит
  правила («Правка не подходит: выбить может только игрок, который сейчас в игре» и т. п.); исходная запись не
  принята по другой причине (сломанное время) — «Правка: исправляемая запись не принята журналом». Поправка может и
  починить непринятую запись (вылет с выбывшим выбившим). Поправка законна и после `finish` (правка закрытого вечера
  — админ): места и завершение не меняются, меняются нокауты и деньги. Кратность и выбившие не участвуют ни в одном
  правиле приёма записей, поэтому поправка **принятой** записи не меняет приём других записей журнала. Починка
  непринятой — меняет: запись вступает в силу в своей позиции, и записи после неё журнал может принять иначе
  (повторно записанный вылет того же игрока — «Игрок уже выбыл», ребай вслед — вступает в силу, «Игра окончена» —
  «не принято», места и деньги сдвигаются). replay такие поправки читает, как раньше (старые журналы не меняются), а
  пульт их не пишет: `canAmend` отказывает, если правка задевает другие записи (`amendImpact`, ревью 08.10.2026).
  `ReplayLog.applied` несёт
  исправленную запись на её месте **с payload в силе** (summary, «Ты за столом», табло видят исправленное), принятые
  поправки — в своих позициях; `ReplayLog.amended: Map<id записи, id поправки в силе>`. `canApply` для `amend`
  проверяет только форму — целиком `canAmend` (`amend.ts`). Тесты: сценарий аудита (ребай после исправленного
  вылета принят, нокаут у нового выбившего, деньги и места те же), отмена правки, цепочка правок, все отказы, правка
  после финиша (инвариант призовые = взносы), summarize, 2000 сгенерированных вечеров с правками (в т. ч. неверными
  и отменёнными): replay ≡ журнал «как будто так и записали» (поправки вписаны в исходные записи), без правок журнал
  принимает и отклоняет то же, инвариант денег и независимый пересчёт взносов, summarize того же итога.
- **Пауза на N минут** (миграция 022, `clock.test.ts`): `timer_pause {minutes?}` — целое 1..`MAX_PAUSE_MINUTES` (120),
  нет поля — пауза без срока (все паузы до 022). Неверное — запись не принята («Пауза: длительность — целое число
  минут от 1 до 120»), часы идут. Принятая пауза кладёт `timer.pause = {eventId, at, minutes}`; `timer_resume`,
  `timer_start` и `finish` её снимают. `pauseLeftMs(state, nowMs)` — до конца перерыва (меньше нуля — срок вышел),
  null — не пауза, пауза без срока или вечер завершён. **Таймер сам не продолжает**: по истечении экраны зовут
  продолжить, продолжает `timer_resume` банкира.
- **Поправка остатка уровня ±1 мин** (миграция 022, `clock.test.ts`): `time_adjust {seconds}` — целое, не 0, по модулю до
  `MAX_TIME_ADJUST_SECONDS` (3600); прибавляет к остатку текущего уровня (`levelElapsedMs −= seconds·1000`), игровое
  время (`totalElapsedMs`) не трогает. Только уровень по времени, не последний («Последний уровень сам не кончается»),
  таймер запущен (на паузе — можно), вечер не завершён. Не в минус: остаток после поправки должен быть больше нуля
  (ноль — это переход уровня: «Убавить нельзя: уровень бы закончился — для этого есть «Уровень вперёд»»); не
  длиннее уровня («Прибавить нельзя: остаток стал бы больше длины уровня»). Окно ребаев сдвигается вместе с уровнем.
- Ошибочные события (ребай живого, bust мёртвого, join после закрытия) не ломают replay: они
  пропускаются и попадают в `state.errors: {eventId, message}[]`. `canApply(format, state, type, payload, nowMs)`
  возвращает текст ошибки или null — фронт проверяет перед отправкой.
- **Несколько записей одним действием** (аудит 07.10.2026, миграция 020): `canApplySequence(format, events, drafts:
  EventDraft[], nowMs) → {index, message} | null` — журнал проигрывается до `nowMs`, затем черновики (`EventDraft =
  {type, payload}`) применяются по порядку, каждый к состоянию после предыдущего, теми же правилами replay (вылет и
  сразу ребай: по отдельности ребай живому не положен; вылет, который сам переводит уровень и закрывает ребаи, —
  отказ на ребае). Журнал не меняется; пустой список — null.

```ts
export interface PlayerState {
  playerId: PlayerId; joinedAt: string; entries: number; rebuys: number;
  stacks: number;        // Σ k входа и ребаев: взнос = stacks × buyInRub
  alive: boolean; busts: number; finalBustEventId: number | null; place: number | null;
  kos: number; koVictims: PlayerId[]; bustLevel: number | null;
}
export interface PauseState { eventId: number; at: string; minutes: number | null } // 022
export interface TimerState {
  status: 'not_started' | 'running' | 'paused';
  levelIndex: number;          // 0-based
  levelElapsedMs: number;
  levelRemainingMs: number | null; // null для не-time триггеров
  handsInLevel: number; bustsInLevel: number;
  totalElapsedMs: number;      // чистое игровое время без пауз
  pause: PauseState | null;    // текущая пауза (status 'paused', вечер не завершён), миграция 022
}
export interface EveningState {
  players: Record<PlayerId, PlayerState>;
  joinOrder: PlayerId[];
  timer: TimerState;
  currentLevel: BlindLevel; nextLevel: BlindLevel | null;
  rebuysOpen: boolean; aliveCount: number; totalEntries: number; // штуки
  totalStacks: number; totalChips: number; prizePoolRub: number; // по кратностям; фонд = все взносы
  finished: boolean;
  places: PlayerId[];          // index 0 = 1-е место; полон только при finished
  firstBustPlayerId: PlayerId | null; // для прогноза «кто вылетит первым» = первый bust вечера
  showdown: ShowdownState | null; // открытый олл-ин (только показ; см. «Олл-ин»)
  errors: { eventId: number; message: string }[];
}
```

### Остальные модули
- `money.ts`: `entryAmounts(format, k=1) → {stacks, rub, chips}` — во что обходится вход/ребай
  кратности k (пульт банкира, подписи ленты); `prepaidPayment(format, playerId, k=1) → Payment` — «Оплачено сразу»:
  платёж игрока банкиру на взнос входа/ребая кратности k, пульт пишет его тем же действием, что и вход (020; тесты:
  оплата сразу закрывает взносы по ходу игры, после финала остаток каждого — минус его приз, 1000 сгенерированных
  вечеров);
  `computeMoney(format, state) → Record<PlayerId, {owesRub, prizeRub, netRub}>`;
  `settlement(money, payments: {playerId, amountRub}[]) → Record<PlayerId, {dueRub, paidRub, remainingRub, status: 'owes'|'awaits'|'settled'}>`
  (`dueRub = owesRub - prizeRub`, >0 — игрок платит банкиру; `paid` — сумма payment;
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
  в типе ради итогов, собранных в тестах; summarize ставит всегда): `prizePoolRub` (фонд — все взносы), `durationMs` —
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
  `voteResults(votes) → Record<category, {winners: PlayerId[], counts: Record<PlayerId, number>}>` (ничья — несколько победителей);
  `STAR_MIN_VOTES` (2), `starWinner(result) → PlayerId | null` — кому номинация даёт «Звезду вечера» (единственный
  лидер с 2 голосами и больше; гостей отсеивает `computeAchievements`).
- `achievements.ts`: `computeAchievements(input) → Achievement[]`, строка — `{playerId, code, eveningId|null,
  seasonKey|null, targetId|null, count, level, first}` (ключ — игрок, код, вечер/сезон и `targetId`; `level` — уровень
  этой выдачи, 1 у ачивок без уровней; `first` — впервые на этом уровне по хронологии строк игрока с этим кодом, у
  ачивок без уровней — первая выдача). Коды в порядке каталога (`ACHIEVEMENT_CODES` = порядок `ACHIEVEMENT_META`):
  `first_blood` (первый нокаут в истории клуба), `hunter` (3/4/5+ KO за вечер, уровни), `comeback` (победа после
  2/3+ ребаев, уровни), `phoenix` (первый вылет вечера и победа), `clean_win` (победа без ребаев), `rebuy_king`
  (больше всех ребаев за завершённый сезон), `iron_chair` (не пропущен ни один вечер завершённого сезона), `hat_trick`
  (3 победы подряд в своих вечерах), `sworn_enemy` (5/10/15 KO одного и того же игрока, уровни, `targetId` — соперник),
  `revenge` (нокаут своей Немезиды, `targetId` — она), `king_hunt` (нокаут действующего чемпиона, `targetId` — он),
  `oracle` (угадан победитель в 3 прогнозах подряд), `star` (единоличная победа в номинации от 2 голосов, уровни
  по 1/5/10 звёздам), `champion` (1-е место завершённого сезона); правила — «Уровни и сюжетные ачивки» выше.
  `ACHIEVEMENT_LEVELS`, `LeveledCode`, `isLeveled`, `levelCount`, `levelFor(code, value)`, `levelThreshold`,
  `levelMark` («II»), `achievementTitle(code, level?)` («Охотник II»), `achievementLevelText(code, level)` («4 нокаута
  за вечер», последний уровень — «и больше»; у `star` — порог как порог, «от 5 звёзд вечера»: строку дают за каждую
  звезду, и внутри уровня счёт растёт), `ACHIEVEMENT_LEVEL_RULE` (правило уровневой без порогов — для каталога), `playerLevel`; `ACHIEVEMENT_THRESHOLDS` — пороги без уровней
  (хет-трик, оракул, Немезида, окно формы); `SEASONAL_ACHIEVEMENTS`. Звёзды: `StarAward = {eveningId, category,
  playerId, votes}`, `starAwards(eveningId, voteResults(...))` — по закрытому голосованию (клиент — `history.ts`,
  сервер — `starAwards` в `notify/results.ts`); `starAchievements(input)` — только строки «Звезды вечера» тем же
  подсчётом (моменты ленты). Помощники сюжетных: `revengesIn(summary, nemesisOf)`, `reigningChampionsFor(input,
  seasonKey)` (чемпионы предыдущего сезона), `kingHuntsIn(summary, champions)` — их же берут «Сюжет вечера» и «На
  кону». Переходящие звания: `titles(input) → {nemesis: Record<PlayerId, PlayerId|null>, form: PlayerId|null}`
  (немезида — кто чаще всех выбивал игрока, минимум 2 раза; форма — лучшая сумма очков за последние 5 вечеров
  клуба). Гости ачивки не получают. `diffAchievements(before, after)` — новые для поста бота (уровень и `first` — как
  в `after`). `AchievementInput.bestNBySeason?` — замороженные «лучшие N» для `champion` и действующего чемпиона
  (`rebuy_king` и `iron_chair` от N не зависят). Названия и описания по-русски, нейтральные и без рода, — в
  `ACHIEVEMENT_META`. `chronological(summaries)` — итоги по дате, общий порядок для ачивок, званий, рекордов и ленты.
- `records.ts` («Жизнь клуба»): `RECORD_KINDS` — `biggest_win` (нетто игрока за вечер), `most_kos` (нокауты за вечер),
  `win_streak` (победы подряд в вечерах, где играл; рекорд — с 2), `biggest_pool` (фонд вечера), `longest_game`
  (`durationMs`); рекорда по ребаям нет. `RECORD_META` — `{title, scope: 'player'|'evening', unit: 'rub'|'count'|'ms', min}`.
  `recordsTable(summaries, {excluded}) → ClubRecord[]` (всегда 5 строк, `value: null` — рекорда нет; держатели —
  все при ничьей, первым — кто раньше, свой повтор — один раз с первым вечером); `recordsBroken(...) →
  Record<eveningId, RecordBreak[]>` (`status: 'new'|'equalled'`, `previous`). Первый вечер клуба рекордов не ставит.
  Рекорды игрока — только постоянные (`excluded` — гости), рекорды вечера (фонд, длина) — все вечера.
- `progress.ts`: `achievementProgress(input, playerId) → AchievementProgress[]` — прогресс до неполученных ачивок и
  следующих уровней (`measure: 'count'|'place'|'condition'`, `current`/`target`, `possible`, `obtained`, `level` —
  уровень игрока, `nextLevel` — к какому уровню счётчик, у ачивок без уровней null; `victimId` у `sworn_enemy` —
  соперник с лучшим счётом, у `revenge` — своя Немезида; `leaders`/`leaderValue` у `rebuy_king`/`champion`, у
  `king_hunt` — действующие чемпионы); порядок — `ACHIEVEMENT_CODES`. Уровневые — пока не взят последний уровень
  (`hunter`: лучший вечер до порога следующего, `sworn_enemy`: лучшая пара, `star`: звёзды за всё время — первая звезда
  условием, `comeback` — условием); остальные вечерние — пока не получены; сезонные (`champion`, `rebuy_king`,
  `iron_chair`) — всегда, по текущему сезону; `first_blood` — пока в клубе не было нокаутов; `king_hunt` без
  действующего чемпиона или у него самого — `possible: false`. `hint` домена — на «ты», карточка игрока свои подписи
  собирает сама (`pages/player/progress.ts`: на чужой карточке нужны нейтральные).
- `feed.ts`: лента «В клубе». `clubEvents(input: ClubFeedInput)` — события, не зависящие от «сейчас» (итог вечера,
  ачивки без `star` — у `AchievementItem` есть `level`, `first`, `targetId`, id с целью — `achievement:<код>:<игрок>:
  <вечер>:<цель>`; смена званий `titleChanges`, рекорды), уже в порядке ленты; `clubMoments(input, {nowMs})` —
  победители номинаций по голосованиям с `voting_closes_at <= nowMs` (ничья — момент каждому; «лучший голос»: фото
  и подпись → фото → подпись → ранний; `Moment.star` — `{level, first}`, если номинация дала «Звезду вечера», иначе
  null: ничья, один голос, гость; подсчёт — `starAchievements` по тем же голосованиям, `excluded` — гости);
  `momentItems`, `mergeFeed(events, moments, limit?)`; `clubFeed(input,
  {nowMs, limit?})` = всё вместе. Время: события вечера — `evenings.finished_at` (без него finish журнала, иначе
  дата вечера), момент — закрытие голосования, сезонная ачивка — `seasonEndIso`. Новые сверху, при равном времени —
  итог, рекорды, ачивки, звания, моменты. id детерминированы (`result:<ev>`, `record:<kind>:<ev>`, …). Смена звания —
  только когда его получает другой игрок.
- `recap.ts`: `eveningRecap(input, eveningId, playerId) → EveningRecap | null` — «Твой вечер»: место, очки, нетто,
  `kosBy` (с дележом), `bustedBy` (каждый вылет, `final`), прогноз и очки Оракула, ачивки вечера (строки
  `computeAchievements` с уровнем, `first` и `targetId`), место в сезоне
  до/после (`standingPlace`, как на главной), смена званий, рекорды (свои и вечера). `played: false` — не играл, но
  делал прогноз; null — не играл и прогноза не было.
- `clubNews.ts` («Жизнь клуба» в посте итогов, аудит 07.10.2026): `eveningClubNews(input, eveningId) →
  EveningClubNews | null` — что вечер изменил в клубе: `predictions` (`made` — непустые прогнозы на вечер,
  `winnerGuessedBy`/`firstOutGuessedBy` — по `scorePrediction`; вход — сырые прогнозы `{eveningId, playerId, winnerId,
  firstOutId}`), `records` (`recordsBroken` этого вечера), `titleChanges` (`titleChanges` этого вечера), `season` —
  сдвиг в таблице сезона вечера (`seasonStandings` до и сразу после него, места — `standingPlace`, как в «Твоём
  вечере»): `leaders` — кто на первом месте, если оно сменилось (ничья — все; пусто — лидер прежний), `leadersBefore`,
  `climbers` — наибольший подъём (ничья — все), без вышедших в лидеры; `season = null` у первого вечера сезона, у
  вечера, после которого в том же сезоне уже были другие (исправленный итог старого вечера не говорит о прошлом как
  о нынешнем), и когда никто не сдвинулся. Гости — `excluded`, как везде. `hasClubNews(news)` — есть ли что
  рассказать. Тексты — `clubNewsLines` в `_shared/messages.ts`.
- `format.ts`: `DEFAULT_FORMAT` (клубный: 500 ₽/500 фишек, весь взнос в фонд, ребаи до конца 5-го уровня без лимита,
  70/30, уровни по 40 мин: 5/10, 10/20, 15/30, 20/40, 25/50, 50/100, 75/150, 100/200), `validateFormat` (лишние ключи, в том числе `bountyRub` старых
  форматов, молча игнорирует).
- `voice.ts` — голос табло (миграция 016), один источник текста фраз для табло и генератора озвучки. Silero
  v5_5_ru выбрасывает латиницу и не читает цифры (проверено на модели), поэтому: `numberWords(n)` — целое
  0…999 999 999 999 словами, именительный, мужской род (5 → «пять», 1000 → «тысяча», 2500 → «две тысячи пятьсот»,
  21 000 → «двадцать одна тысяча»; иначе RangeError); имена — только кириллица, ударение — «+» перед гласной.
  `VOICE_ID = 'silero-v5_5-xenia'`, `VOICE_CREDIT` (подпись «Голос: Silero (CC BY-NC-SA 4.0)»). Текст клипа —
  `normalizeSpeech` (NFC, любые пробелы → один обычный, без краёв); **хеш** — `clipHash(text, voice)` = SHA-256
  (hex) от UTF-8 строки «voice + перевод строки + normalizeSpeech(text)» через WebCrypto (браузер, Node, Deno) —
  тот же, что проверяет constraint `voice_clips_hash_matches`. Фразы (решения пользователя: без обращения, имена
  без склонения): `startPhrase` «Поехали! Блайнды пять — десять.», `levelPhrase` «Новый уровень. Блайнды десять —
  двадцать.» (+ «, анте пять» при ante > 0; так же и у старта), `PHRASES` — «Голос включён.» (проверка звука, первой:
  порядок ключей — порядок `FIXED_TEXTS` и подгрузки табло), «Минута до повышения блайндов.», «Последний уровень
  ребаев.», «Пять минут до закрытия ребаев.» (обе — аудит 07.10.2026), «Ребаи закрыты.», «Пауза.», «Продолжаем.»,
  «Нокаут!» (назвать некого), «Игра окончена!» (победителя назвать нельзя); `Announcement` — `voice_on`, `start`,
  `level`, `minute`, `rebuys_last_level`, `rebuys_soon`, `rebuys_closed`, `pause`, `resume`, `knockout`, `winner`;
  перерыв (миграция 022): `PHRASES.breakMinute` «Минута до конца перерыва.», `breakPhrase(n)` «Перерыв десять минут.»
  (`minutesWords(n)` — минуты с согласованием: «одна минута», «две минуты», «двадцать одна минута»), `BREAK_TEXTS` —
  фразы для `PAUSE_MINUTES_OPTIONS` (5/10/15/20/30), входят в `FIXED_TEXTS` (их подхватывают манифест генератора и
  предзагрузка табло; на seed манифест — 98 фраз вместо 92); объявления `break {minutes}` (варианты: «Перерыв N
  минут.», запасной — «Пауза.»: длительность не из пульта не озвучена) и `break_minute`; `knockoutPhrase(victim, killers)` — «Нокаут! Вылетает Эрдни. Выбил Саша.» / «… Выбили Саша и Дима.» /
  «… Выбили Саша, Дима и Женя.» / без выбивших «Нокаут! Вылетает Эрдни.» / без жертвы «Нокаут! Выбил Саша.»;
  `winnerPhrase` — «Победитель вечера — Женя!». Куски для сборки (`SEGMENTS`, `knockoutSegments`): «Нокаут!
  Вылетает», «Выбил», «Выбили», «и», «Победитель вечера —» и имя отдельным клипом.
  Имена: `speakableName({display_name, spoken_name})` — `spoken_name`, иначе отображаемое имя, если оно целиком
  из русских букв, пробелов, дефисов и апострофов, иначе null (фраза звучит без имени); `normalizeSpokenName` /
  `spokenNameError` — те же правила, что у constraint и RPC (тексты на «ты»).
  `announcementVariants(announcement, nameOf)` — варианты от полного к запасным (вариант = клипы подряд): целая
  фраза → она же кусками → с меньшим числом имён → без имён; выбивших называем всех или никого.
  Что нужно: `eveningVoiceTexts(format, names)` — всё, что табло может сказать на вечере (фиксированные и куски,
  уровни формата, на игрока — имя, «Вылетает X.», «Выбил X.», победитель; целые фразы всех упорядоченных пар);
  `voiceManifestTexts(input, {pairPlayers = 16, maxTexts = 1000}) → {texts, notes}` и `voiceManifest(input) →
  {clips: [{voice, hash, text}], notes}` — то же по всему клубу: вход — `private.voice_manifest_input()`, только
  активные игроки с озвучиваемым именем; целые фразы пар — для 16 недавних (по `last_played_at`), остальным
  нокауты собираются кусками; что урезано — в `notes`. Уровни формата — до первого нечитаемого (`speakableLevels`).
- `showdown.ts` (миграция 017): нотация карт (`CARD_RANKS` '23456789TJQKA', `CARD_SUITS` 'shdc', `isCardCode`),
  `readShowdown`/`readShowdownId` — форма payload, `streetOf(boardSize)` → `'preflop'|'flop'|'turn'|'river'`,
  `isShowdownEvent(type)`, `visibleShowdown(showdown, nowMs)` — показывать ли раздачу: после ривера —
  `SHOWDOWN_RIVER_HOLD_MS` (2 мин) с последней правки, на любой улице — не дольше `SHOWDOWN_IDLE_HIDE_MS` (10 мин)
  без правок; время серверное, поэтому табло, пульт и экраны игроков прячут раздачу одновременно. Типы
  олл-ина (`SHOWDOWN_EVENT_TYPES`) — в `types.ts`.
- `amend.ts` (миграция 022) — помощники пульта для правки на месте: `amendField(ev)` → `'stacks'` (вход, ребай) |
  `'by'` (вылет) | null; `currentAmendValue(format, events, eventId, nowMs)` → `{stacks}` | `{by}` — значение записи с
  правкой в силе; `amendDraft(eventId, value)` → `EventDraft` `amend`; `canAmend(format, events, payload, nowMs)` →
  текст отказа или null: форма, запись есть и не отменена, исправляется, значение не то же самое («Правка ничего не
  меняет»; порядок выбивших не важен), исправленная запись проходит правила (replay журнала с поправкой в хвосте —
  тексты те же, что даст replay) и **не задевает другие записи** — иначе `AMEND_IMPACT_ERROR` («Правка заденет другие
  записи журнала — так исправить нельзя. Отмени непринятую запись и, если нужно, запиши её заново»).
  `amendImpact(format, events, payload, nowMs)` → `{revived, rejected: {eventId, message}[], resultChanged}` — что
  правка заденет, кроме самой записи: какие записи журнал примет / перестанет принимать, перестанет ли завершённый
  вечер быть завершённым или сдвинутся ли в нём места; `hasAmendImpact`. У принятой записи всегда пусто (тест: 600
  сгенерированных вечеров с непринятыми вылетами и ребаями вслед, починки и отказы; пропущенная правка не меняет
  приём других записей, места и завершение, инвариант денег, summarize не падает).
- `poker/` — движок олл-ина (истории клуба, аудит 07.10.2026: перенесён из `src/shared/lib/poker`, чтобы сюжет
  вечера в посте итогов считал те же шансы, что табло): `cards.ts`, `evaluator.ts`, `equity.ts`, `pokermath.ts`,
  `shares.ts` (`roundShares` — целые проценты, как на табло) и их тесты; описание движка — раздел «Олл-ин», «Движок».
  Без зависимостей и `Date.now`/`Math.random` (Монте-Карло — `mulberry32` с seed из карт), импорты с `.ts`. В
  `index.ts` домена не реэкспортируется (имена `Street`, `Card` не смешиваются с остальными) — импорт по пути. Во
  фронте `src/shared/lib/poker/{cards,evaluator,equity,pokermath}.ts` — реэкспорт отсюда (прежние пути импорта).
- `allins.ts` («Олл-ины вечера», истории клуба): `eveningAllIns(format, events, nowMs?)` / `allInsFromApplied(applied)`
  → `AllIn[]` — все раздачи вечера из **принятых** replay событий `showdown` (отклонённые и отменённые — нет), в
  порядке первой версии: `{showdownId, openedEventId, openedAt, updatedAt, hands, board, boardSizes, winners}`. Руки и
  стол — последней версии (опечатку в карте банкир правит новой версией); `boardSizes` — размеры стола (0/3/4/5), с
  которыми раздачу показывали, не больше итогового (ривер, снятый правкой, не в счёт; олл-ин с флопа — без улицы «до
  флопа»); `winners` — `riverWinners(hands, board)` (лучшая рука на полном столе, делёж — все; до ривера — null;
  ею же пользуется `riverOutcome` пульта). `allInStreets(allIn)` — улицы с префиксом итогового стола и ключом движка;
  `allInShares(allIn, street, equity?)` — доли банка, целые % (`roundShares`). **«Победа с N %»** —
  `swingFromShares(allIn, sharesBySize)`: победитель один, на какой-то улице до ривера его доля меньше, чем у кого-то
  из соперников, и не больше `ALLIN_SWING_MAX_PCT` (35); N — наименьшая такая доля (равные — ранняя улица), фаворит —
  у кого на той улице доля больше всех (ничья — все), `favoritePct`. `allInSwing(allIn, equity?)` — то же со
  счётом движка: до флопа полный Монте-Карло (~0,1 с на руку) только там, где быстрая прикидка (`ALLIN_QUICK_SAMPLES`
  = 3 000 раздач) оставляет победителю не больше 35 + `ALLIN_QUICK_MARGIN_PCT` (8, около 8 погрешностей прикидки);
  ответ совпадает со `swingFromShares` по всем улицам (тест: 300 случайных раздач с флопа и тёрна и 24 — с улицей до
  флопа). `allInSwings`, `bestSwing` — по всем раздачам вечера. На деньги, места и очки олл-ин по-прежнему не влияет.
- `story.ts` («Сюжет вечера»): `eveningStory({summary, allIns, excluded, club?, equity?, swings?, forPost?})` →
  `StoryItem[]`, до `STORY_MAX_ITEMS` (4) по важности: `swing` (самая невероятная «победа с N %» вечера) → `revenge`
  (игрок выбил свою Немезиду — звание `titles` по вечерам ДО этого, `revengesIn`) → `record` (рекорд игрока, установленный вечером:
  `eveningClubNews(...).records`, как в «Жизни клуба» — повторённый рекорд вечера не новость) → `season_leader`
  (первое место сезона сменилось: `eveningClubNews(...).season.leaders`, с `leadersBefore`) → `phoenix` (первый вылет
  вечера — и победа) → `comeback` (победа после ребаев; «феникс» её заменяет) → рекорд вечера (фонд, длина) →
  повторённый рекорд игрока. `achievement` у `revenge`, `phoenix`, `comeback` — за строку выдана ачивка («Месть»,
  «Феникс», «Камбэк» от 2 ребаев) тем же правилом, что в `computeAchievements` (тест сверяет): не гость и не
  тренировка (`StoryInput.training`, экран итога передаёт его для тренировки). Без
  `club` (история клуба) — только то, что видно из журнала вечера (`swing`, `phoenix`, `comeback`): так считает
  табло. `swings` — готовые «победы с N %» (клиент считает их воркером, `useAllInSwings`), иначе — `allInSwing` с
  `equity`. `forPost` — для поста итогов: без того, что пост говорит другими блоками (`toldElsewhereInPost`: рекорды
  и лидер сезона — «Жизнь клуба», строки с `achievement` — месть, феникс, камбэк — «Новые ачивки»: дублей нет), отсев
  до предела строк. `shownAchievements` — для экрана итога: ачивки, которые зритель уже видит в «Твоём вечере»
  (`eveningRecap(...).newAchievements`); строка, чья ачивка (`storyAchievement(item)` — игрок, код, цель) среди них,
  не показывается (у других зрителей остаётся), отсев тоже до предела строк. Тексты: экраны —
  `storyLine` (`src/shared/lib/stories.ts`), пост — `storyText`/`storyLines` (`_shared/messages.ts`): о людях в
  настоящем времени и без рода, имена в именительном («Месть Немезиде: Лёша выбивает игрока Дима», «Феникс вечера —
  Лёша: первый вылет и победа», «Лёша забирает олл-ин с 13 % до флопа; фаворит — Саша, 87 %», ноль — «меньше 1 %»).
- `stakes.ts` («На кону»): `eveningStakes(input, {eveningDate, players, buyInRub})` → `{items, season}` перед
  объявленным вечером (`input.summaries` — только прошедшие вечера; `input.stars?` — звёзды по закрытым голосованиям;
  `players` — постоянные игроки с ответом на анонс: кто может прийти — все, кроме «не иду» и болельщиков на этот вечер
  — `StakesPlayer.spectator`, миграция 024: у них только шаг к «Оракулу», в «идут» для рекорда фонда они не
  считаются). Шаги по правилам `computeAchievements`/`recordsTable`: `win_step` (две победы подряд — третья даст
  «Хет-трик», серии не перекрываются, как у ачивки; и/или рекорд клуба по серии — `record: 'new' | 'equal'`, только
  если серия после победы от трёх и не короче рекорда: первая серия из двух побед «рекордом» не объявляется),
  `enemy_step` (до порога уровня «Заклятого врага» — 5, 10, 15 — один нокаут того же соперника, оба могут прийти;
  `level`, `target`), `first_blood` (в клубе ещё не было нокаута), `king_step` (действующий чемпион может прийти, и
  есть постоянный игрок без «Охоты на короля»; `championIds`), `star_step` (до «Звезды вечера» II или III — одна
  звезда; первая — не шаг), `pool_record` («иду» × взнос уже не меньше рекорда фонда), `revenge_step` (Немезида игрока
  может прийти, а «Мести» у него ещё не было), `oracle_step` (два угаданных победителя подряд — у всех переданных
  игроков: прогноз делают и не играющие). Ачивки, которые даёт сама игра вечера («Охотник», «Камбэк», «Феникс»,
  «Чистая победа»), в «На кону» не попадают: они возможны у каждого — это условие, а не шаг. Порядок: рекорд серии →
  «Хет-трик» → «Заклятый враг» → «Первая кровь» → «Охота на короля» → «Звезда вечера» → фонд → «Месть» → «Оракул»
  («Месть» ниже фонда: Немезида есть почти у каждого, и в посте дня игры — две строки — она вытесняла бы рекорд
  клуба), внутри — по id. `season` — сезон вечера по его дате: `first` (вечеров в сезоне ещё не было), `leaders`
  (первое место, ничья — все), `chasers` (следующее место и отставание `gap`), `rows` (таблица до вечера — экран
  показывает своё место). Тексты: экраны — `stakeLine`, `seasonStakeLines`; пост дня игры — `stakeText`,
  `seasonStakeText`, `stakesLines` (имена ачивок в именительном, с уровнем: «в одной победе от ачивки «Хет-трик»»,
  «(цель — Лёша)», «в одном нокауте от ачивки «Заклятый враг II»», «нокаут действующего чемпиона принесёт ачивку
  «Охота на короля» (чемпион — Саша)», «в одной звезде от ачивки «Звезда вечера II»», «(Немезида — Дима)»).
- `spectators.ts` (болельщик, миграция 024): `spectatesEvening({spectator, rsvp?, seated?})` — болельщик на этот вечер:
  флаг `players.is_spectator = true`, и нет ни «иду»/«под вопросом», ни места за столом; `seatedIds(events)` — кто за
  столом (действующий `join`, как `is_participant` в SQL; принял ли его replay — не важно). Правило — чтение: флаг от
  ответа или посадки не меняется, отмена ответа/входа возвращает всё как было. Одно правило на «Без ответа» главной
  (`groupRsvps`), пост дня игры (`gamedayRoster`), кандидатов прогноза (`predictionCandidates`), посадку
  (`seatCandidates`) и «На кону» (клиент `useEveningStakes`, сервер `stakesOf`).
- `index.ts` — реэкспорт всего.

## База данных (public)

| Таблица | Колонки |
|---|---|
| `players` | `id uuid pk`, `auth_user_id uuid unique → auth.users on delete set null`, `tg_id bigint unique null`, `display_name text not null`, `username text`, `photo_url text`, `is_guest bool default false`, `is_admin bool default false`, `is_active bool default true`, `created_at`, `spoken_name text` (имя для озвучки на табло: 1–50 символов, русские буквы, пробел, дефис, апостроф и «+» только перед гласной, хотя бы одна буква, без пробелов по краям и двойных — constraint `players_spoken_name_shape`; null — голос берёт `display_name`, если оно кириллическое; миграция 016), `is_spectator bool` (болельщик, миграция 024: true — «слежу, не играю»: не в «Без ответа», без упоминания в посте дня игры, не кандидат прогноза и не «может прийти» у «На кону», но видит всё и делает прогнозы; на вечер с «иду»/«под вопросом» или входом за стол — игрок, `spectatesEvening` домена; false — играет; null — ещё не выбирал, считается игроком, главная задаёт вопрос «Играешь или следишь?». Свой меняет `set_my_spectator`, чужой — админ формой «Игроки». Backfill 024: сыгравшим настоящий вечер — false; seed.sql повторяет это после заливки) |
| `settings` | singleton `id int pk check (id = 1)`; `group_chat_id bigint`, `bot_username text`, `game_weekday int` (1=пн…7=вс), `game_time time`, `announce_hours_before int default 48`, `gameday_hours_before int default 5` (1–48: за сколько часов до начала пост в день игры; миграция 014), `default_location text`, `default_format_id uuid → formats`, `season_best_n int default 10`, `ko_points numeric default 0.5`, `win_bonus numeric default 1`, `updated_at`, `club_board_token text not null` (код постоянной ссылки «табло клуба» `/tv/<код>`: 12 hex — 48 случайных бит, `substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)`, check `settings_club_board_token_shape`; читают все участники — его показывают «Вывести на ТВ» и админка; меняет только `rotate_club_board_token`, миграция 023) |
| `formats` | `id uuid pk`, `name text`, `config jsonb` (TournamentFormat), `is_archived bool default false`, `created_at` |
| `evenings` | `id uuid pk`, `scheduled_at timestamptz not null`, `location text`, `note text`, `status text` (`announced`→`live`→`finished`→`settled`, или `cancelled`), `banker_id uuid → players`, `format jsonb not null` (снимок формата на момент создания; `payoutPct` до старта меняет `set_payout`), `board_token uuid unique default gen_random_uuid()`, `started_at`, `finished_at`, `settled_at`, `voting_closes_at`, `announce_posted_at`, `gameday_posted_at` (пост в день игры ушёл или не понадобился; пишет только cron-tick; перенос на другой московский день снимает отметку — триггер `evenings_reset_gameday_post`, before update of `scheduled_at`, любой путь записи, включая upsert формы админки; перенос в пределах дня не трогает; миграция 014), `results_posted_at`, `voting_posted_at`, `voting_reminder_posted_at` (напоминание о голосовании ушло или не понадобилось; пишет только cron-tick; смена `voting_closes_at` — отмена finish, новое завершение, правка админом — снимает отметку триггером `evenings_reset_voting_reminder`, before update of `voting_closes_at`, то же значение не трогает; миграция 021), `results_revision int default 0` (сколько раз опубликованный итог устарел; > 0 — пост «Исправленные итоги», миграция 007), `settle_reopened_at timestamptz` (закрытый расчёт открылся сам из-за правки журнала; снимают `mark_settled`/`unmark_settled`, миграция 008), `announce_snapshot jsonb` (что группа знает о вечере из постов бота: `{scheduledAt: ISO UTC, location: text|null, cancelled: bool}`; пишут только функции, миграция 008), `slot_date date` (московский день, за которым вечер закреплён в расписании: ставит триггер `evenings_set_slot_date` при вставке по `scheduled_at`, перенос его не меняет; миграция 010), `cancel_reason text` (1–200 символов; причина отмены для поста в группу — пишет админ вместе с отменой, возврат снимает; заметку `note` отмена не трогает; миграция 010), `is_training bool not null default false` (тренировочный вечер, миграция 023: ставится только при создании — триггер `evenings_training_guard` отказывает 22023 на смену пометки в любую сторону; у тренировки `voting_closes_at` всегда null — тот же триггер снимает его при finish; день клуба она не занимает — см. индекс ниже; удаляется целиком `delete_training_evening`), `scoring jsonb` (снимок правил очков `{koPoints, winBonus}` из settings в момент завершения; есть ровно у `finished`/`settled` — constraint `evenings_scoring_when_closed`, форма — `evenings_scoring_shape`; ставит и снимает триггер `evenings_scoring_snapshot`, снаружи не пишется; миграция 013), `created_by`, `created_at` |
| `evening_events` | `id bigserial pk`, `evening_id uuid → evenings on delete cascade`, `type text check (EventType)`, `payload jsonb default '{}'`, `at timestamptz default now()`, `created_by uuid → players`, `voided_at timestamptz`, `voided_by uuid → players`, `client_id uuid` (ключ повтора, unique `(evening_id, client_id)`, миграция 007) |
| `rsvps` | pk `(evening_id, player_id)`, `status text check in ('yes','no','maybe')`, `updated_at` |
| `predictions` | pk `(evening_id, player_id)`, `winner_id uuid → players`, `first_out_id uuid → players`, `updated_at` |
| `votes` | pk `(evening_id, voter_id, category)`, `category text check in ('hand','bluff','badbeat')`, `nominee_id uuid → players`, `caption text check (char_length <= 200)`, `photo_path text`, `created_at`; `check (voter_id <> nominee_id)` |
| `season_rules` | `season_key text pk` (`'2026-Q3'`, квартал по Москве, как `seasonKey` домена), `best_n int ≥ 1`, `frozen_at timestamptz default now()` — «лучшие N» закрытых сезонов; пишет только триггер `settings_freeze_season_best_n` (и backfill 013); `authenticated` — select (RLS: участник клуба), `service_role` — select/insert/update/delete. Миграция 013 |
| `admin_alerts` | `key text pk` (1–200 символов: вид сбоя или `telegram:<код>`), `last_sent_at timestamptz not null`, `suppressed_count int ≥ 0 default 0`, `updated_at timestamptz default now()` — журнал троттлинга оповещений админа о сбоях (`_shared/alerts.ts`, раздел Edge Functions). RLS без политик, права только у `service_role` (select/insert/update/delete); клиенту не виден. Миграция 012 |
| `board_presence` | `evening_id uuid pk → evenings on delete cascade`, `seen_at timestamptz not null` (последняя отметка табло, показывающего этот вечер — по ссылке вечера или табло клуба), `voice_at timestamptz` (последняя отметка с включённым голосом) — «табло на связи» для проверки перед игрой. Пишет только `board_ping` (anon, security definer), не чаще раза в 5 с; ни адреса, ни устройства. RLS: select — участник клуба; `authenticated` — select, `service_role` — select/insert/update/delete, `anon` — ничего. Не в публикации Realtime (отметка раз в 20 с будила бы все экраны). Миграция 023 |
| `cron_heartbeat` | одна строка: `id int pk default 1 check (id = 1)`, `last_run_at timestamptz` (тик `cron-tick` отработал), `last_ok_at timestamptz` (отработал без единой ошибки), `updated_at` — сторож будильника. Пишет только `mark_cron_tick` (service_role), читает `cron_last_tick` (anon). RLS без политик, права только у `service_role` (select/insert/update/delete). Миграция 021 |
| `voice_clips` | pk `(voice, text_hash)`; `voice text` (`^[a-z0-9][a-z0-9_.-]{0,63}$`, сейчас `silero-v5_5-xenia`), `text_hash text` (64 hex = SHA-256 от «voice + перевод строки + text» в UTF-8 — constraint `voice_clips_hash_matches`), `text text` (что озвучено: 1–300 символов, NFC, без пробелов по краям, двойных и переводов строк — `voice_clips_text_normalized`), `audio bytea` (1 байт – 256 КБ), `mime text default 'audio/mpeg'` (только MP3), `duration_ms int` (1–30 000), `created_at` — клипы голоса табло (MP3 моно). Пишет генератор (`scripts/voice/generate.py`, запуск — `voice.yml` в `poker-club-ops`) ролью `postgres` (владелец таблицы, RLS его не касается); RLS без политик, у `anon`/`authenticated` прав нет, `service_role` — select/insert/update/delete; табло читает через `board_voice_clips`. Миграция 016 |

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
(сверяет `_shared/bootstrap-format.test.ts`; литерал 011 ещё несёт `bountyRub: 100`, миграция 018 его вычищает —
тест сверяет итог обеих) как `default_format_id`. Повторный прогон ничего не меняет.

Индексы-ограничения: `evenings_one_per_club_day_idx` — unique по `((scheduled_at at time zone 'Europe/Moscow')::date)`
`where status <> 'cancelled' and not is_training`: не больше одного неотменённого настоящего вечера на московскую дату
(вставка второго → 23505). Миграция 006; тренировки — вне индекса с 023 (тренировка в день игры законна).

Хелперы (security definer, stable): `current_player_id() → uuid` (по `auth.uid()`, только `is_active`),
`is_admin() → bool`, `is_banker(evening uuid) → bool`, `is_participant(evening uuid, player uuid) → bool`
(есть не-voided join).

### RPC (security definer, `set search_path = ''`, проверяют права сами)
- `add_event(p_evening uuid, p_type text, p_payload jsonb, p_client_id uuid default null) → evening_events` —
  банкир вечера или админ. После `finished` банкир может добавлять только `payment`; остальное — только
  админ (правка закрытого вечера). `p_client_id` — ключ повтора (один на намерение пользователя): если
  событие с тем же ключом уже есть, возвращается оно, без вставки и до проверки состояния вечера
  (тип/игрок/кратность не совпадают → 22023). Клиент держит ключ неудавшейся записи 5 минут от последней неудачи
  в sessionStorage (`retryKeys` в `shared/api/rpc.ts` поверх `shared/lib/retryKeys.ts`: переживает перезагрузку
  страницы WebView, не закрытие Mini App; хранилище недоступно — ключи в памяти), см. «Надёжность связи».
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
  stacks, clientId)` / `useAddGuest` в `src/shared/api/rpc.ts` (`p_stacks` шлёт только при k > 1).
  **Ключ повтора** (миграция 019): `add_guest(p_evening, p_name, p_stacks default 1, p_client_id uuid default
  null)`, сигнатура `(uuid, text, integer)` удалена, вызовы с 2–3 аргументами работают. Ключ уходит в `join` гостя
  (`add_event` с `p_client_id`); тот же ключ — вернуть id гостя этой записи без вставки
  (`private.guest_by_client_id`): до блокировки вечера (повтор потерянного ответа не падает на «журнал закрыт») и ещё
  раз после неё (повтор, ждавший блокировку первой попытки, видит уже посаженного). Намерение сверяется: `join` того
  же автора, той же кратности, игрок — гость с тем же именем без учёта регистра; иначе 22023 «Ключ повтора уже занят
  другой записью — обнови экран». Без ключа — как раньше. Клиент: ключ — по намерению «вечер + имя в нижнем регистре
  + кратность» в том же хранилище `retryKeys`.
- **Несколько записей одним действием** (миграция 020): `add_events(p_evening uuid, p_events jsonb, p_client_id uuid
  default null) → setof evening_events` — банкир вечера или админ (права, блокировка, нормализация и сверка ключа —
  через `add_event` на каждую запись), одна транзакция: лягут все или ни одной. `p_events` — `[{type, payload}]`,
  1..50, только `join`/`rebuy`/`bust`/`payment` (то, что пульт пишет вместе), лишнее поле записи — 22023; форма всей
  пачки проверяется до первой записи. Ключ повтора — один на действие: у i-й записи (с 0)
  `private.derived_client_id(p_client_id, i)` (0 — сам ключ, дальше `md5(ключ:i)::uuid`), повтор тем же ключом
  возвращает уже записанные события (каждое сверяет `add_event`). Одна транзакция — одно `at` у всех записей
  действия: по нему фронт узнаёт оплату, записанную вместе со входом (`linkedPayment`). Правила игры сервер, как и
  раньше, не проверяет — клиент проверяет цепочку `canApplySequence`. Клиент — `addEvents`/`useAddEvents` в
  `shared/api/rpc.ts`.
  `void_events(p_events bigint[]) → void` — отмена нескольких записей одного вечера одной транзакцией через
  `void_event` в порядке списка (1..50, без null и повторов, записи разных вечеров — 22023; любой отказ — уже
  отменена, нет прав — откатывает всё). Клиент — `voidEvents`/`useVoidEvents`.
  `add_guest(…, p_paid_rub integer default null)` — «Оплачено сразу» у гостя: тем же вызовом платёж гостя на эту
  сумму (1..1 000 000, иначе 22023 до создания игрока; сумму считает домен на клиенте), ключ платежа —
  `derived_client_id(p_client_id, 1)`. Повтор тем же ключом сверяет и оплату (`private.check_guest_payment`: была ли,
  того же гостя, на ту же сумму; иначе 22023 «Ключ повтора уже занят другой записью — обнови экран»). Сигнатура
  `(uuid, text, integer, uuid)` заменена на `(uuid, text, integer, uuid, integer)`, вызовы с 2–4 аргументами работают.
  Клиент — `addGuest(…, paidRub)`, `useAddGuest({name, stacks, paidRub})`, намерение `guestRetryIntent(…, paidRub)`
  (без оплаты строка та же, что до 020). Гранты всех трёх — `authenticated`, `service_role`; служебные `private.*` —
  revoke у `public`/`anon`/`authenticated`.
- **Правка записи на месте, перерыв, ±время уровня** (миграция 022, `supabase/tests/022_amend_pause_time_adjust.sql`):
  `add_event` (тело из 017) принимает:
  `amend` — `{eventId, stacks}` или `{eventId, by}` (ровно одно значение; лишний ключ — 22023). `eventId` — число
  (`private.json_event_id`: целое ≥ 1), запись **этого вечера** (иначе 22023 «Правка: записи № N нет в журнале этого
  вечера»), не отменена (P0001 «Правка: запись отменена — исправлять нечего»), типа join/rebuy/bust (22023). `stacks`
  — только у входа и ребая (`json_entry_stacks`, 1..10, **хранится и 1**), `by` — только у вылета: разбор как у
  bust (`private.json_bust_by(by, жертва исходной записи)`: список, ≤ 10, без повторов и самой жертвы, игроки
  существуют; нормализованная копия — uuid в нижнем регистре, порядок сохранён). Нормализованная копия —
  `{eventId, stacks}` / `{eventId, by}`. Права — как у всех записей (`lock_evening_for_write`: банкир вечера или админ,
  после завершения — только админ); правка закрытого расчёта открывает его (триггер 008); отмена — `void_event`.
  `timer_pause` — `{}` или `{minutes}` (целое 1..120, `3.0` → 3); `time_adjust` — `{seconds}` (целое, не 0, по
  модулю ≤ 3600); границы времени (уровень по времени, не последний, остаток > 0 и ≤ длины) — правило replay.
  Ключ повтора (как раньше — до блокировки вечера) сверяет и `eventId`, `by` правки (списком, регистр не важен, порядок
  важен), `minutes`, `seconds`: то же намерение с другим значением — 22023 «Ключ повтора уже занят…». Служебная пауза
  перед `finish` по-прежнему `{}`; паузы с минутами автомат статуса таймера считает как обычные. `add_events` (020)
  новые типы не принимает. `private.json_event_id`/`json_bust_by` — revoke у `public`/`anon`/`authenticated`.
  `board_state` не менялся: правки и поправки времени уходят на табло как все события. Слияние гостя переносит игрока и
  в `by` правки (`payload_replace_player`/`payload_mentions_player` из 017 смотрят на `by` любого события).
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
- **Сторож будильника** (миграция 021). `mark_cron_tick(p_ok boolean) → void` — только `service_role`: upsert
  единственной строки `cron_heartbeat`, `last_run_at = now()`, при `p_ok` ещё и `last_ok_at = now()` (null — как
  false); время ставит база. Вызывает `cron-tick` в конце каждого тика, прошедшего проверку секрета, с `p_ok` = «в
  `errors` пусто»; сбой записи — только лог. `cron_last_tick() → jsonb` — **доступна anon**: `{last_ok_at,
  last_run_at, server_now}` (отметки нет — null), только время; её раз в сутки читает `keepalive` из
  `poker-club-ops` и краснеет, если `last_ok_at` старше часа (раздел «Деплой в облако»).
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
  (`predictionCandidates` в `pages/evening/predictions.ts`; гость на анонс не отвечает — войти он не может).
- `merge_players(p_guest uuid, p_target uuid) → jsonb` — только админ (миграция 008). `p_guest` — игрок без
  `tg_id` и без входа (гость или сделанный постоянным), `p_target` — игрок с `tg_id`. Атомарно, под блокировкой
  всех вечеров (тот же порядок, что у add_event): в `evening_events` — `payload.playerId`, элементы `payload.by` и
  игроки рук олл-ина `payload.hands[].playerId` (017) точной заменой значения (порядок `by` и рук сохраняется,
  `private.payload_replace_player`; какие записи трогать — `private.payload_mentions_player`, то же правило у
  `player_references` и счёта `events` в отчёте), `created_by`/`voided_by`;
  `rsvps`, `predictions` (свои строки и `winner_id`/`first_out_id`), `votes` (`voter_id`, `nominee_id`) —
  удалить и вставить заново с прежними `updated_at`/`created_at`; `evenings.banker_id`/`created_by`;
  `p_target.is_guest = false`; `spoken_name` гостя переходит профилю, если у профиля своего нет (миграция 016:
  имя для озвучки чаще задают гостю, а Telegram-профиль бывает с латинским именем); гость удаляется. Все внешние
  ключи на `players` — `on delete cascade`/`set null`,
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
  `finished`/`settled` не старше 6 часов (правило — `private.board_evening_id(p_token) → uuid`, миграция 016: одно
  на все RPC табло): `{evening:{id,scheduled_at,location,status,started_at,finished_at}, format, events:[без payment, без voided], players:[{id,display_name,spoken_name}], server_now}`
  (`players` — только упомянутые в событиях; `spoken_name` — с 016); иначе null. События олл-ина (`showdown`,
  `showdown_close`, миграция 017) идут как все; имена игроков рук в `players` есть всегда — у каждого из них есть
  join этого вечера (017 board_state не меняет).
- `board_voice_clips(p_token uuid, p_voice text, p_hashes text[]) → jsonb` — **доступен anon** (миграция 016): по
  живому токену (то же правило) — `[{hash, mime, duration_ms, audio}]` найденных клипов `voice_clips` этого голоса
  (`audio` — base64 без переводов строк); не озвученных в ответе нет; токен погас — null; больше 100 хешей — 22023.
  Клиент — `fetchVoiceClips` в `src/shared/api/board.ts` (пачками по 40).
- **Табло клуба, «табло на связи», тренировка** (миграция 023, `supabase/tests/023_club_board_pregame_training.sql`):
  - `board_state` пересоздан на `private.board_payload(evening uuid)` (тело из 016; правило срока — то же
    `board_evening_id`); в `evening` добавлено `is_training`. Старые ссылки вечеров работают как раньше.
  - `club_board_state(p_code text) → jsonb` — **доступен anon**: код не тот (`private.club_board_token_ok`) — null;
    иначе `{board, next_at, schedule: {weekday, time: 'HH:MM'}, server_now}`. `board` — ответ как у `board_state`
    для вечера, который сейчас важен (`private.club_board_evening_id()`), или null. Выбор по ступеням: идущий
    настоящий → идущая тренировка → итог настоящего (finished/settled, до 6 ч после `finished_at`) → сегодняшний (по
    Москве) анонс настоящего → итог тренировки → сегодняшний анонс тренировки; внутри ступени — последний начатый /
    последний завершённый / самый ранний анонс. Идущая тренировка важнее анонса и итога настоящего вечера (её
    сейчас и прогоняют), но не идущего вечера. `next_at` — ближайший будущий анонс настоящего вечера.
  - `club_board_voice_clips(p_code text, p_voice text, p_hashes text[]) → jsonb` — **доступен anon**: как
    `board_voice_clips`, но по коду клуба и даже между вечерами (проверка звука «Голос включён.»); код не тот — null;
    больше 100 хешей — 22023.
  - `board_ping(p_token text, p_voice boolean default false) → boolean` — **доступен anon**: токен вечера (uuid,
    правило срока `board_state`) или код клуба (вечер, который табло клуба сейчас показывает); upsert
    `board_presence` (`seen_at`, при `p_voice` — и `voice_at`), не чаще раза в 5 с; true — отметка относится к вечеру,
    false — токен чужой, null, длиннее 64 или между вечерами.
  - `voice_clips_present(p_voice text, p_hashes text[]) → text[]` — участник клуба (`require_player`): какие хеши
    уже озвучены, без звука; до 300 за запрос (22023).
  - `rotate_club_board_token() → text` — только админ (42501): новый код; старая ссылка гаснет сразу.
  - `delete_training_evening(p_evening uuid) → jsonb` — только админ (42501); вечера нет — 22023; не тренировка —
    P0001 «Удалить можно только тренировочный вечер…». Под блокировкой вечера удаляет его (журнал, ответы, прогнозы,
    голоса, отметки табло — cascade) и гостей, которых завели на нём: `is_guest`, без `tg_id` и входа, созданы не
    раньше вечера и после удаления не упомянуты нигде (`private.player_references`). Ответ `{evening, guestsDeleted}`.
  - `private.voice_manifest_input()`: `last_played_at` — без тренировок; форматы объявленных и идущих тренировок
    в манифесте остаются (их уровни озвучатся).
  Гранты: `club_board_state`, `club_board_voice_clips`, `board_ping` — anon, authenticated, service_role;
  `voice_clips_present`, `rotate_club_board_token`, `delete_training_evening` — authenticated, service_role; служебные
  `private.*` — revoke у public/anon/authenticated. Все — security definer с пустым `search_path`.
- `set_my_spoken_name(p_name text) → text` — своё имя для озвучки (миграция 016): нормализация как
  `normalizeSpokenName` (типографские апострофы → «'», пробелы схлопываются), пустое — сброс в null, иначе
  проверки и тексты 22023 как у `spokenNameError` домена; возвращает сохранённое. Клиент — `setMySpokenName` /
  `useSetMySpokenName`. Чужое имя для озвучки пишет только админ — формой «Игроки» (upsert `players` под RLS).
- **Болельщик и слияние гостя с гостем** (миграция 024, `supabase/tests/024_spectator_merge_guests.sql`):
  - `set_my_spectator(p_spectator boolean) → boolean` — участник клуба (`require_player`, отключённый — 42501): свой
    `is_spectator`; null — 22023 «Выбери: играешь или следишь за игрой». Клиент — `setMySpectator` /
    `useSetMySpectator` (обновляет игрока в контексте входа, справочник и историю).
  - `merge_guests(p_guest uuid, p_target uuid) → jsonb` / `merge_guests_preview(p_guest, p_target) → jsonb` — только
    админ (42501 «Объединять игроков может только админ»): дубль гостя `p_guest` → профиль `p_target`, оба без
    Telegram (`tg_id` и `auth_user_id` пусты; иначе 22023 — у профиля с Telegram совет «Привязать к Telegram»), одно и
    то же, null, нет профиля — 22023. Перенос, препятствия (P0001 «Объединить профиль «…» с профилем «…» нельзя: …»;
    «оба в журнале» — с советом отменить лишние записи, если одного человека посадили дважды) и проверка остатков
    ссылок (XX000) — те же, что у `merge_players`. Флаги профиля после слияния: `is_guest` — гость, только если гостями
    были оба (решение админа «постоянный» не теряется); `is_active` — включён, если включён хоть один; `spoken_name` и
    `is_spectator` — свои, а нет своих — дубля; имя (`display_name`) — своё. Отчёт — как у `merge_players` плюс
    `becomesPermanent`, `becomesActive`. Клиент — `mergeGuestsPreview`/`mergeGuests`, хуки `useMergePreview(…, kind)`
    и `useMergePlayers(kind)` с `MergeKind = 'telegram' | 'guest'` (ключ предпросмотра — с видом).
  - Общая часть слияния вынесена: `private.merge_report_body(guest, target, kind)` (препятствия и счётчики; `kind`
    меняет только тексты двух препятствий) и `private.merge_move(guest, target)` (журнал, банкир/автор вечера, ответы,
    прогнозы, голоса, имя для озвучки). `private.merge_players_report` и `merge_players` пересозданы на них —
    поведение и тексты прежние (их держат тесты 008/010/016/017 и `check-merge-replay`).
    `private.merge_guests_report` — проверка аргументов вида «дубль». Гранты: `set_my_spectator`, `merge_guests`,
    `merge_guests_preview` — authenticated, service_role; `private.merge_*` — revoke у public/anon/authenticated.
- `private.voice_manifest_input() → jsonb` — для генератора озвучки (роль `postgres`; у anon/authenticated права
  нет): `{players: [{id, display_name, spoken_name, is_guest, is_active, last_played_at}], formats: [TournamentFormat]}`
  — активные игроки (с гостями), `last_played_at` — `scheduled_at` последнего вечера с их неотменённым `join`;
  форматы — `config` неархивных `formats` и снимки `evenings.format` вечеров `announced`/`live`. Миграция 016.
- Служебные функции — в схеме `private` (не выставлена в API). Коды ошибок RPC: 42501 нет прав,
  22023 неверные данные (лишний ключ в payload — тоже), P0001 недопустимо в текущем состоянии.

### RLS
- Все таблицы: `select` для `current_player_id() is not null` (активный участник клуба), кроме:
  `predictions` — свои всегда, чужие только когда вечер уже не `announced`;
  `votes` — свои всегда, чужие только после `voting_closes_at`;
  `admin_alerts` — RLS включён без политик: клиенту не видна вовсе (только `service_role`, миграция 012);
  `voice_clips` — так же (016): табло читает клипы только через `board_voice_clips`.
  `board_presence` (023) — select участнику клуба, запись только через `board_ping`.
- `evening_events`, `rsvps`, `predictions`, `votes` — запись только через RPC.
- `players`, `settings`, `formats`, `evenings` — insert/update только `is_admin()`; игрок может менять
  у себя только `display_name` (через RPC `set_my_name(p_name text)`), `spoken_name` (`set_my_spoken_name`, 016) и
  `is_spectator` (`set_my_spectator`, 024). Политики «своя строка» нет намеренно: права `authenticated` на `players`
  выданы на таблицу целиком, и такая политика открыла бы игроку и `is_admin`.
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
  `formats`, `evenings`; `season_rules` — select, миграция 013; свои флаги игрок меняет только RPC — см. RLS);
  `anon` — только RPC `board_state`, `server_now`,
  `board_voice_clips` (016), `cron_last_tick` (021), `club_board_state`, `club_board_voice_clips`, `board_ping` (023);
  `board_presence` (023) — `authenticated` только select, `anon` — ничего. Исключения — `admin_alerts` (012), `voice_clips` (016) и
  `cron_heartbeat` (021): у `anon`/`authenticated` прав нет вовсе (`revoke all`), только `service_role`.
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
каждому виду сбоя за тик (`cron_schedule`, `cron_changes`, `cron_announce`, `cron_gameday`, `cron_results`, `cron_voting`, `cron_voting_reminder`; первая
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
  админ; сервер сам собирает текст (итог, места, деньги, новые ачивки, «Жизнь клуба», итоги прошедшего сезона,
  приглашение голосовать) из БД доменными функциями и шлёт в `settings.group_chat_id`. **«Новые ачивки»** (уровни,
  08.10.2026): `newAchievementsFor` — разница истории без вечера и с ним, только строки этого вечера и сезонные
  (исправленный итог старого вечера сдвигает пороги в последующих — это не новости поста); блок «🏅 Новые ачивки» —
  строкой на игрока, ачивки в порядке каталога, `achievementPhrase`: «• Лёша — «Охотник II» (новый уровень), «Чистая
  победа», «Месть» (Немезида — Дима)»; «новый уровень» — только уровни от II, взятые впервые; о ком — «соперник» у
  «Заклятого врага», «Немезида», «чемпион»; две звезды за вечер — «×2». **«Жизнь клуба»** (аудит
  07.10.2026): `clubNewsOf` (`notify/results.ts`) считает `eveningClubNews` по уже загруженной истории (`loadHistory`:
  итоги, прогнозы, «лучшие N» сезонов), `clubNewsLines` (`_shared/messages.ts`) — блок «♣️ Жизнь клуба» после ачивок
  вечера и до итогов сезона, по строке на тему: «Победителя угадали: …. Первый вылет угадали: …» (или «Прогнозы не
  сбылись: …»), рекорды («Новый рекорд клуба: … (прежний — …)», несколько — через «;» без прежних значений;
  повторённые рекорды вечера — фонд, длина игры — не идут, повторённые рекорды игрока — с пометкой «(повторён)»),
  звания («Звания: «Форма» — Саша (прежде — Дима); Дима — Немезида игрока Лёша»), сезон («Сезон: новый лидер — …,
  12,5 очка; рывок — …, с 5-го места на 2-е»). Нечего сказать — блока нет; подсчёт упал — пост уходит без блока
  (ошибка в лог). О людях — без рода, из эмодзи — только масти (решение пользователя для новых строк).
  **«Сюжет вечера»** (истории клуба): `storyOf` (`notify/results.ts`) — `eveningStory` с `forPost` по той же истории
  (олл-ины — `eveningAllIns` из журнала вечера в `loadHistory`, шансы — движок домена: до флопа полный Монте-Карло
  только у раздач, где прикидка не исключает «победу с N %»), `storyLines` — блок «♠️ Сюжет вечера» сразу перед
  «Жизнью клуба»: олл-ин и то, за что ачивка не выдана (месть, феникс, победа после ребаев — у гостя; победа после
  одного ребая); месть, феникс и «Камбэк» с ачивкой — только в «Новых ачивках», рекорды и лидер сезона — только в
  «Жизни клуба», дублей нет. Подсчёт упал — пост без блока. Проверено
  локально (dry-run, cron-tick добил итоги вечера с тремя олл-инами): весь тик — около 0,35 с. Идемпотентно по `results_posted_at`; при
  `results_revision > 0` заголовок «Исправленные итоги». Уровни, сюжетные ачивки и звёзды проверены локально
  (08.10.2026, dry-run): cron-tick добил итоги и голосование вечера seed с подменёнными отметками — «Новые ачивки» с
  уровнем и целями, месть — только там (других строк сюжета у вечера нет — блока «Сюжет вечера» не было),
  «⭐ Ачивка «Звезда вечера»: Дима.»; пост дня игры — «На кону» с «Заклятым
  врагом I». `kind: 'evening_corrected'` — только админ:
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
  с прошедшим `voting_closes_at` и пустым `voting_posted_at` (`votingPost`: победители номинаций и «⭐ Ачивка «Звезда
  вечера»: Саша, Дима ×2 («Звезда вечера II» — новый уровень).» с правилом строкой ниже — звезда единоличному
  победителю от 2 голосов, ничья без звезды; звёзд нет — «⭐ В этот раз без ачивки «Звезда вечера».»; гости —
  `loadPlayerNames`, уровни — `eveningStarLevels` по истории клуба, одна загрузка на шаг; история не загрузилась —
  звёзды без уровней, ошибка в лог); (3) добивает неотправленные итоги вечеров;
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
  «На кону» (истории клуба; `stakesOf(…, nowMs)` в `notify/results.ts` — со звёздами закрытых голосований, история —
  `loadHistory` один раз на шаг) — после всех списков
  (и «Ещё не ответили» ниже), до призыва отметиться, строка «На кону: …» с двумя первыми шагами `eveningStakes` и строка сезона («Сезон: лидер — Дима, 8 очков; Лёша
  отстаёт на 3,5 очка.»), `stakesLines`; история не загрузилась или подсчёт упал — пост без этих строк (ошибка в
  лог), кто может прийти — постоянные игроки, кроме «не иду» и болельщиков на этот вечер (выключенный, но ответивший
  «иду» / «под вопросом», — тоже);
  «Ещё не ответили (n)» — `gamedayRoster`: активные постоянные игроки (`is_active`, не `is_guest`) без строки
  `rsvps` на вечер, кроме болельщиков (миграция 024; болельщик, которого уже посадили за стол, — игрок: cron-tick
  читает действующие `join` вечера и передаёт `seatedIds` в `gamedayRoster` и `stakesOf`), по имени, с упоминанием (`mentionHtml`: «Имя (@username)», без username —
  `<a href="tg://user?id=…">Имя</a>`, без `tg_id` — имя); под призывом отметиться — последняя строка «Прогнозы
  закрываются со стартом — сделано N» (аудит 07.10.2026; `predictionsLine`, N — `predictionsMade`: строки
  `predictions` вечера хотя бы с одним полем, только число — содержимое до старта скрыто RLS; ноль — «пока ни
  одного»). Списки — по правилам `groupRsvps` главной Mini App
  (`src/pages/home/lib.ts`; совпадение проверяет `gameday.test.ts`): игрок, выключенный после ответа, остаётся
  среди ответивших. Видимый текст держится в лимите Telegram (4096 символов после разбора разметки, `visibleLength`):
  не влезает — самый длинный список укорачивается до первых имён и хвоста «и ещё N» без упоминаний; кнопка
  `e_<id>` «♣️ Иду / не иду» (из эмодзи в посте — только масти: решение пользователя). Публикация — `publishOnce(…, 'gameday_posted_at', …, ['announced'], {},
  {scheduled_at})`: застолбить, только если вечер не перенесли между чтением и отметкой (параметр `match` у
  `claimPost`/`publishOnce`). В отчёте тика — `gameday[id]`: `posted`/`already_posted`/`fresh_announce`/
  `wait_announce`.
  (6) **напоминание о голосовании** (миграция 021, шаг идёт после итогов голосования, алерт
  `cron_voting_reminder`): вечера `finished`/`settled` с пустым `voting_reminder_posted_at` и закрытием голосования в
  `(now, now + 3 ч]`. Решение — `decideVotingReminder` (`_shared/votingReminder.ts`): итогов вечера в группе ещё нет
  → `wait_results` (ничего не пишем); итоги ушли уже внутри этих 3 ч (в них сказано, до какого времени голосовать) →
  `fresh_results`, до закрытия меньше 30 мин (будильник стоял) → `too_late` — обе отметка без поста; иначе — явка
  `votingTurnout`: голосовать может игрок вечера (действующий join) с Telegram и `is_active` (гость без Telegram войти
  не может), проголосовал — есть хотя бы один голос; голосовать некому (`no_voters`) или проголосовали все
  (`all_voted`) — отметка без поста, иначе пост `votingReminderPost`: «♠️ Голосование закрывается в 18:00 —
  проголосовали 3 из 7» («проголосовал 1 из 7», «пока никто не проголосовал»), «Кто играл и ещё не голосовал —
  выберите руку, блеф и бэд-бит вечера 9 октября.», кнопка «♣️ Голосовать» (`v_<id>`). Публикация — `publishOnce(…,
  'voting_reminder_posted_at', …, ['finished', 'settled'], {}, {voting_closes_at})`: застолбить, только если
  закрытие не сдвинули между чтением и отметкой. В отчёте тика — `votingReminder[id]`.
  **Отметка тика** (миграция 021): в конце каждого тика, прошедшего проверку секрета, — `mark_cron_tick(p_ok)`,
  `p_ok` — `errors` пуст (`markTick`, не бросает).
  **Тренировки** (миграция 023): ни один шаг их не выбирает — у всех выборок вечеров `.eq('is_training', false)`, в
  том числе у проверки слота (тренировка в день игры не мешает создать настоящий вечер); страховка — `claimPost`
  тоже с `is_training = false` (тренировку не застолбит ни один пост). Проверено локально (dry-run): тренировки
  в окне анонса, дня игры и добивки итогов — без постов, настоящий вечер на день с тренировкой создан и объявлен.
- `notify` и тренировка (миграция 023): `EVENING_COLUMNS` с `is_training`; `loadHistory` — без тренировок (итоги,
  ачивки, «Жизнь клуба»); `postEveningResults`/`postCorrectedResults` и `postAnnounceChange` для тренировки — outcome
  `'training'` без поста (`PostOutcome`, клиентский `NotifyOutcome`). Пульт после финиша тренировки notify не зовёт.
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
  `verifyOtp` → сессия. Весь вход — не дольше `SIGN_IN_TIMEOUT_MS` (12 с, `signInOnce` через `withTimeout`; tg-auth
  и запрос профиля получают сигнал отмены, после отмены `verifyOtp` не зовётся) → `AuthError` вида `timeout`, экран
  «Связь слишком медленная» с «Повторить вход». Через `SIGN_IN_SLOW_MS` (7 с) на заставке — «Связь медленная — вход
  идёт дольше обычного…» и «Повторить вход» (`SplashScreen`, повтор монтирует её заново); повтор отменяет прежнюю
  попытку (`forgetSignIn`), а состояние ставит только последняя (номер попытки в `AuthProvider`). **Сессия только в памяти** (`persistSession: false`, своё in-memory storage):
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
  `recordValueParts`/`recordValueText` — одно значение рекорда на все экраны, выигрыш со знаком), `timeout`
  (`withTimeout`, `TimeoutError`, пределы ожидания), `retryKeys` (ключи повтора в sessionStorage), `wakeLock` +
  `useWakeLock` (удержание экрана, подсказка `wakeLockHint`) — см. «Надёжность связи»; `clipboard` (`copyText` — ссылки
  табло); `stories` (истории клуба: `storyLine`, `stakeLine`, `seasonStakeLines`, `swingPill`, `favoritePill`,
  `allInCaption`, `pctText` — о себе на «ты»: «Ты забираешь олл-ин…», «цель — ты»); `poker/` — олл-ин
  на клиенте, импорт из `shared/lib/poker` (свой `index.ts`: в нём React-хуки с Web Worker — `useShowdownEquity`,
  `useShowdownEquities` (шансы списка ключей тем же кешем и воркером), `useAllInSwings` (`swingFromShares` по долям
  воркера: экран итога, табло и шторка голосования не считают Монте-Карло на главном потоке); чистые модули —
  например `pages/evening/lib.ts` — и тесты берут `poker/cards`, `poker/equity` напрямую; сами карты, оценка рук и
  эквити — в домене, `domain/poker`). Между папками
  `src/pages/*` разрешены только три связи: табло берёт подписи вечера из `pages/evening/lib`, карточка игрока — места
  и чемпиона из `pages/rating/stats`, главная — «Твой вечер», блок прогноза и «На кону» из `pages/evening`
  (`EveningRecap`, `useEveningRecap`, `recap`, `PredictionSection`, `EveningStakes`, `useEveningStakes`: те же карточки,
  что на экране вечера); остальное общее — здесь.
  Статус вечера везде — `EveningStatusBadge` кита; `errorMessage` показывает русские тексты RPC как есть,
  а английские служебные сообщения Postgres/PostgREST заменяет переводом по коду (исходник — в `cause`).
- Никакого `dangerouslySetInnerHTML` и сырого HTML из пользовательских данных.
- Маршруты (HashRouter): `/` главная; `/evening/:id` вечер (живой экран; у банкира — пульт);
  `/evening/:id/settle` расчёт; `/evening/:id/vote` голосование; `/board/:token` табло (публичное,
  вне AuthProvider); `/tv/:code` табло клуба (так же, миграция 023); `/rating` (сезон / деньги / всё время / оракул / рекорды / зал славы, `?tab=season|money|
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
  результат тостом. Там же «Объединить с другим профилем» (миграция 024; есть, если в клубе есть другой профиль без
  Telegram) — та же шторка с `kind="guest"` («Объединить дубли»): профиль, из карточки которого открыли, удаляется,
  выбранный остаётся; в выборе (`guestMergeTargets` в `pages/admin/lib.ts`) — профили без Telegram, сначала с тем же
  именем (`nameMatchKey`, переехал в `shared/lib/text`: регистр, «ё» и пометка в скобках не важны), подпись
  `guestMergeHint` («то же имя · гость · 2 вечера»; вечера — по истории клуба), под перечнем и в подтверждении — что
  станет с флагами профиля (`guestMergeFlagNotes`). У постоянного игрока — переключатель «Болельщик» (upsert под RLS,
  как «Активен»), в строке списка — «болельщик».
- **Болельщик на экранах** (миграция 024; тексты — `SPECTATOR_*` в `shared/lib/text`). Главная: вопрос «Играешь или
  следишь?» (`pages/home/RoleQuestion.tsx`) под ближайшим вечером, пока `is_spectator` = null и это не гость: «Играю» /
  «Слежу за игрой» с тостом, крестик — остаться игроком без тоста (пишет false: второй раз вопрос не появится ни на
  каком устройстве). Своя карточка: раздел «Участие в играх» с переключателем «Слежу, не играю» (сохраняется сразу);
  у болельщика в шапке карточки — пометка «Болельщик». Анонс (главная и экран вечера): у болельщика без ответа под
  «Твой ответ» — «Ты болельщик — отвечать не обязательно…»; после «Иду» — тост «На этот вечер ты в игре» с кнопкой
  «Стать игроком» (`set_my_spectator(false)`); сам флаг ответ не меняет. «Без ответа» главной (`groupRsvps(players,
  rsvps, seated)`), кандидаты прогноза (`predictionCandidates(…, seated)`; уже названный болельщик остаётся с подписью
  «болельщик · …»), «На кону» (`useEveningStakes` сам читает журнал вечера тем же запросом) — по `spectatesEvening`;
  `seated` — `seatedIds` журнала, поэтому посаженный до старта болельщик сразу игрок. Шторка посадки: болельщиков можно
  посадить — после игроков своей группы ответа и до гостей, с подписью «болельщик» (`seatSpectator`). После старта всё
  считается по журналу (участники вечера), флаг ни на что не влияет; рейтинг и ачивки флаг не трогает (`excluded` — по-
  прежнему только гости). «Вечер»: после сохранения вечера с уже ушедшим анонсом — `notifyEveningChanged`; отмена
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
  `?tab=records`, `?tab=fame`; ачивки одного вечера — одной строкой «Ачивки вечера»: «Дима — «Охотник II» (новый
  уровень), «Месть» (Немезида — Лёша) · Женя — «Чистая победа»» — цель в скобках, как в посте (`achievementPhrase`):
  две строки одного кода у игрока («Заклятый враг» против двух соперников, «Охота на короля» на двух со-чемпионов)
  иначе неотличимы; своя цель — «ты» без вложенных скобок; одна — «Ачивка «Охотник II» — Дима» с правилом уровня, целью и
  «новый уровень»; момент со звездой — «· звезда вечера» или «· новый уровень «Звезда вечера II»», `starNote`) →
  «Последний вечер» с «Твоим вечером» → «Сезон». «Твой вечер» (`pages/evening/
  EveningRecap`, `useEveningRecap`) — на главной и на экране завершённого вечера; не игравшему, но сделавшему прогноз —
  только прогноз и новые ачивки. На экране вечера карточка сверяет журнал истории с живым (`journalVersion`):
  расхождение (админ поправил закрытый вечер с другого устройства) — карточки нет, история перезапрашивается.
  «История → Моменты» (`MomentsTab`): моменты по вечерам, плашка идущего голосования. «Рейтинг → Рекорды»
  (`RecordsTab`): `recordsTable`, держатель — ссылка на вечер. Карточка игрока: «Цифры» (`Numbers`, `stats.ts`:
  личные рекорды с пометкой «Рекорд клуба», доля вечеров в призах, среднее место) и ачивки с прогрессом
  (`progress.ts`: полученные — с уровнем игрока в названии «Охотник II», правилом уровня, «уровень II из III» и датой
  последней выдачи на этом уровне (`AchievementView.lastDate`: выдача уровня ниже дату не сдвигает) / «На
  подходе» — следующий уровень: «Охотник III», «4 из 5» / сезон / «Ещё не получены» / «Все ачивки и уровни» — каталог
  всех 14 ачивок, у уровневых — правило (`ACHIEVEMENT_LEVEL_RULE`, у «Звезды вечера» — за что звезда) и уровни
  «I — 3 нокаута за вечер», своим уровнем справа, у новичка без ачивок раскрыт). Подсказки прогресса на «ты» — без
  родовых форм (тест прогоняет все коды и состояния): «Феникс» — «Выиграй вечер, в котором первый вылет — твой: вернись
  ребаем»; «Охота на короля» — цели без игрока карточки (ничья в прошлом сезоне: «Выбей действующего чемпиона: Саша»),
  на чужой карточке чемпиона — «Действующий чемпион — этот игрок». «Твой
  вечер» — «Новая ачивка «Охотник I»», «Новый уровень: «Охотник II»», повтор — «Ачивка «Чистая победа» — ещё раз»,
  в подробностях правило уровня и цель; у «Звезды вечера» правило уровня («от 5 звёзд вечера») — только у нового
  уровня от II, иначе — за что звезда (её дают за каждую звезду, и 4 звезды — всё ещё I). Экран итогов голосования (`VoteResults`, `winnerBadge` в `pages/vote/lib.ts`):
  у победителя номинации — «Звезда вечера», «Ничья» или «Победитель» с причиной без звезды («Звезда вечера — от
  2 голосов», «гостю звезда вечера не положена»). Подписи ачивок — `shared/lib/clubLife` (`ACHIEVEMENT_SHORT`,
  `achievementShort({code, level, first})`, `isNewLevel`, `ACHIEVEMENT_TARGET_ROLE`, `starNote`). Иконка «Охоты на короля» —
  `crosshair` (Lucide, добавлена в `EXTRA`). Гости в ленте и моментах — как есть, ачивок, званий,
  рекордов игрока и прогресса у них нет.
- **Истории клуба** (аудит 07.10.2026, без новых таблиц и миграций — всё из журналов и истории клуба доменом):
  - «Олл-ины вечера» — `AllInList` кита (`src/shared/ui/AllInList.tsx`, стили `allins.css`): карточка на раздачу —
    время, «Банк — Лёша» / «Делёж банка — …» / «Раздача без ривера», стол (пустые места пунктиром), таблица «Игрок ×
    улицы до ривера» с долями банка (целые %, как на табло; доли — `useShowdownEquities`, до флопа — воркер), у
    победителя — рука словами и «победа с 13 %», у проигравшего фаворита — «фаворит, 87 %» (`swingFromShares`),
    проигравшие приглушены. Экран итога (`FinishedView`): раздел «Олл-ины вечера» после «Мест» (раздачи —
    `allInsFromApplied` живого журнала). «История → Моменты» (`MomentsTab`, `momentEvenings`): вечера с моментами или
    олл-инами в порядке истории, под моментами — кнопка «Олл-ины вечера: 3 раздачи»; раздачи (и их шансы) — только у
    раскрытых, иначе вкладка пересчитывала бы олл-ины всей истории.
  - Подсказки в шторке голосования (`VoteSheet`, «Рука» и «Бэд-бит»): `allInSuggestions(category, allIns, swings,
    candidates)` (`pages/vote/lib.ts`) — «Рука»: победитель раздачи (делёж — нет), «Бэд-бит»: проигравший фаворит
    «победы с N %»; только участники вечера и не я, сначала самые невероятные. Кнопка-раздача: карты номинанта, имя,
    «05:08 · 7♣ 2♥ против A♠ A♦ — стол …», пометка; нажатие выбирает номинанта, а пустую подпись заполняет картами
    (`allInCaption`, свою подпись не трогает). Раздачи — `eveningAllIns` журнала, который `VotePage` уже грузит.
  - «Сюжет вечера» — экран итога (`useEveningStory` + `StoryFacts`, раздел под лучшим охотником, когда шансы и история
    посчитаны: строки не перестраиваются на глазах): итог вечера сводится из журнала на экране и подменяет этот вечер
    в истории клуба (история на чужом устройстве после правки админом может отставать); у тренировки — без истории.
    Свои «Месть», «Феникс», «Камбэк» зритель видит в «Твоём вечере» — в сюжете их нет (`shownAchievements` из
    `useEveningRecap`; нет карточки «Твой вечер» — ничего не прячется), у остальных зрителей строка остаётся.
    Табло (`FinishedBoard`, `useBoardStory`): только строки журнала вечера (табло без входа не видит истории клуба,
    поэтому месть, рекорды и лидер сезона — в приложении и посте), строками `m-h3` с полосой `accent` под «Игра шла»;
    `useFitToScreen` пересчитывает масштаб по числу строк. `bestFit` теперь проверяет итог ещё раз и уменьшает масштаб
    шагом поиска, пока не поместится: с полосой прокрутки раскладка уже, и масштаб, поместившийся после меньшего, после
    большего не помещался (табло 1280×720 с сюжетом оставалось с прокруткой 30 px; тест в `fitToScreen.test.ts`).
  - «На кону» — `useEveningStakes(evening, rsvps, players)` (`pages/evening/useEveningStakes.ts`, история —
    `useClubHistory`; у тренировки нет) и `StakesList` (`EveningStakes.tsx`, свой лист `stakes.css`: главная не грузит
    `evening.css`): до `STAKES_SHOWN` (4) шагов и строки сезона (с моим местом, если его не назвали). Экран
    объявленного вечера — раздел «На кону» под прогнозом; главная — в карточке анонса под составом.
- Кратность входа на пульте банкира (`pages/evening/StacksPicker.tsx`): «−» / «×k» / «+», ×1 по умолчанию,
  до ×10, под значением — сумма и фишки («1 000 ₽ · 1 000 фишек», `stacksAmountText`). В шторке «Кто пришёл» /
  «Опоздавший игрок» (`SeatSheet`) — одна кратность на всех, кого сажают этим нажатием, и на гостя (подсказка
  об этом — под выбором); после гостя кратность возвращается к ×1, при ×k сумма — на главной кнопке
  («Посадить: 6 · по 1 000 ₽», `seatButtonLabel`); в шторке ребая (`PlayerSheet`) — своя у каждого ребая. Лента:
  `describeEvent(ev, nameOf, formatRub, format)` — при k > 1 подпись «вход на 1 000 ₽» / «ребай на 1 500 ₽»;
  вылет при дележе — «выбивают Саша и Дима — нокаут каждому»; строка игрока (`playerLine(p, format)`) —
  «взнос 2 500 ₽», если хоть один вход был кратным. Денег за голову на экранах нет (см. «Баунти убрано»).
- **Шторка вылета** (`PlayerSheet`, аудит 07.10.2026): «Кто выбил» — набор без переключателя дележа: два и больше
  отмеченных и есть «выбили вместе» (нокаут каждому), второй тап добавляет, а не молча заменяет первого. Отдельная
  кнопка-переключатель «Никто / не знаю, кто выбил» (`aria-pressed`, отметка игрока её снимает). В хедз-апе соперник
  отмечен заранее (`initialKillers`). Подсказка — `killersHint` («Нокаут засчитается: Саша. Выбили вместе — отметь
  и остальных.», «Выбивают вместе Саша и Дима — нокаут засчитается каждому.», «Нокаут никому не засчитается.»),
  главная кнопка — «Выбери, кто выбил», пока выбора нет (`bustButtonLabel`). Отмеченный, успевший вылететь
  (Realtime), в запись не идёт. Всё — `pages/evening/lib.ts`.
- **«Вылет и ребай ×k» и «Оплачено сразу»** (аудит 07.10.2026, миграция 020). Шторка вылета, пока игрок сможет
  сразу докупиться (`canApplySequence` цепочки «вылет → ребай ×1»: ребаи открыты, лимит не исчерпан, вылет сам не
  закроет ребаи), — под выбором выбивших группа «Ребай» (`StacksPicker`, ×1 по умолчанию) и «Оплачено сразу»; кнопки:
  главная «Отметить вылет» и вторая `bustRebuyLabel` («Вылет и ребай», при k > 1 — «Вылет и ребай ×3»). Тост после
  простого вылета, пока игрок может докупиться, — с кнопкой «Ребай» (у Toast «Материи» одна кнопка; открывает
  шторку ребая по свежему журналу, `SendOptions.action`), иначе — «Отменить». «Оплачено сразу» (`PaidNowCheckbox` в
  `StacksPicker.tsx`; Checkbox, а не Switch: применяется с главной кнопкой) — в шторке ребая, в «Вылет и ребай» и в
  шторке посадки (на всех отмеченных и на гостя, подсказка `prepaidHint`), по умолчанию выключено. Черновики —
  `seatDrafts`, `rebuyDrafts`, `bustRebuyDrafts` (`pages/evening/lib.ts`): вход/ребай и, если оплачено, следом платёж
  `prepaidPayment`. Действие из нескольких записей уходит `actions.sendAll` (`useEveningActions`): проверка
  `canApplySequence` по свежему журналу (отказ называет запись: «Вход: Саша. Игрок уже в турнире»), намерение
  `retryIntent(вечер, 'batch', drafts)` с тем же вопросом «Запись уже в журнале», одна транзакция `add_events`,
  проверка, принял ли журнал каждую запись, тост «Отменить» — всё действие одной `void_events`. Журнал принял не всё
  (вылет пришёл до закрытия ребаев, ребай — после): `rejectedPart` (`lib.ts`) отделяет непринятое и оплату, записанную
  с ним, от принятого, тост `rejectedToast` — «Ребай не принят: Ребаи закрыты», «Вылет записан. Ребай пришёл на
  сервер в 21:20 и помечен в ленте «Не принято». «Отменить ребай» снимет и оплату — деньги верни игроку.»; кнопка
  отменяет только непринятое (принятый вылет остаётся), шторка закрывается (`SendOptions.onRejected`). В шторке
  вылета за 10 с до закрытия ребаев — тот же Notice «Ребаи закрываются», что в шторке ребая; спиннер — на нажатой
  кнопке («Отметить вылет» или «Вылет и ребай»). Отмеченные в шторке
  посадки садятся одним действием (все или никто; раньше — по одному с частичной посадкой). В ленте и расчёте платёж
  — обычный. Оплата, записанная вместе со входом или ребаем (`linkedPayment`: платёж того же игрока на сумму этого
  взноса, с тем же `at` и автором, позже по журналу), отменяется вместе с ним — и из тоста, и из ленты, и «Убрать из-за
  стола»; подтверждение говорит об этом («банкир возвращает эти деньги игроку»). `voidImpact` принимает и список id —
  последствия отмены действия целиком. Пульт под статами: «Взносы за вечер — X, у банкира — Y».
- **«Ты за столом»** (аудит 07.10.2026). На экране идущего вечера у того, кто играет и не ведёт пульт, вверху —
  `MySeatCard` (`parts.tsx`) по `mySeat(format, state, applied, payments, playerId)` (`lib.ts`, деньги — `computeMoney`
  и `settlement` домена): статус «В игре» / «Вне игры», вылетевшему — «Можно докупиться — ещё 25 мин» (до конца уровня
  N, до конца игры; нельзя — место, когда оно известно), входы с кратностями («2 входа: ×2, ×1 · взнос 1 500 ₽»),
  нокауты, баланс с банкиром сейчас («Твой долг банкиру — …», «Банкир должен тебе …», «С банкиром в расчёте») и
  «оплачено …». В списках игроков вечера своя строка — «(ты)» (`PlayersList` `meId`); у того, кто не ведёт пульт,
  строки — ссылки в карточку игрока (`linkPlayers`), места на экране итога — тоже.
- **Прогноз на экране вечера и «Прогнозы вечера»** (аудит 07.10.2026). Блок прогноза до старта —
  `PredictionSection` (`pages/evening`, стили — `prediction.css` при компоненте), один на экран вечера (сразу под
  «Твой ответ»: сюда ведут кнопки анонса и поста в день игры) и на главную. Шторка `PredictionSheet` и помощники
  `predictionCandidates`/`candidateHint`/`rsvpHint` переехали из `pages/home` в `pages/evening` (`predictions.ts`);
  в шторке — строка `ORACLE_NOTE` «Очки Оракула — отдельная таблица, в сезон не идут.». На экране итога —
  «Прогнозы вечера» (`FinishedView`): сводка `predictionSummary` («Победитель — Женя: угадали 2 из 5», «Первый вылет —
  Дима: никто не угадал»), строки `predictionResults` (очки — доменная `scorePrediction`; больше очков выше, при
  равенстве свой прогноз; снятые не показываются): «победитель — Женя (+3) · первый вылет — Дима», справа очки
  Оракула; внизу та же строка про Оракул. Прогнозов не было — блока нет.
- **Честные подтверждения** (`pages/evening/lib.ts`, аудит 07.10.2026). Отмена записи: `voidImpact(format, events,
  eventId, nowMs)` — replay «до» и «после»: `revived` (не принятые сейчас, которые вступят в силу), `rejected` (принятые
  сейчас, которые станут «Не принято», с причиной — например ребай после отменяемого вылета), `finishedBefore/After`;
  `voidImpactText` — хвост подтверждения: «Журнал перестанет принимать запись: «Ребай: Саша», 20:15 (игрок ещё в игре
  — ребай только после вылета). Она останется в ленте с пометкой «Не принято», места, нокауты и деньги посчитаются без
  неё.»; вылет финалиста в завершённом вечере — «Вечер перестанет быть завершённым — придётся вернуть его в игру,
  записать недостающее и завершить заново…» (при отмене самой «Игра окончена» эту фразу не пишет). «Отменить» из тоста
  без подтверждения — только если отмена не трогает других записей и не меняет «завершён ли вечер».
  «Уровень вперёд», который закроет ребаи (`levelNextClosesRebuys`: номер уровня после перехода больше
  `rebuyUntilLevel`), переспрашивает всегда: «Перейти на 6-й уровень?» — `rebuysClosingText` «Ребаи закроются —
  вылетевшие Саша и Дима не смогут докупиться. Поздняя регистрация тоже закроется.» (вылетевшие — кому ещё позволял
  лимит ребаев). Если до авто-перехода меньше 5 с — прежний вопрос «Уровень и так сейчас сменится». Вопрос может
  висеть долго (ревью 08.10.2026), поэтому `levelNext` после ответа берёт свежее состояние (`actions.freshState()` —
  replay последнего журнала на эту секунду): уровень сменился сам или с другого устройства — запись не уходит,
  тост «Уровень уже сменился — сейчас 6-й» (`levelMovedText` как `guard` в `send`); до авто-перехода остались секунды
  (`levelEdgeLeftMs`) — ещё и вопрос о краю уровня. Вообще `send` проверяет `canApply` и `guard` по свежему
  состоянию — до своих вопросов и после них, а не по рендеру, в котором нажали кнопку.
- «Твой ответ» на экране вечера (`AnnouncedView`): у не ответившего, в том числе пока ответы грузятся, не выбрано ничего
  (`rsvpSegmentValue` → `''`; Segmented «Материи» при `undefined` подсвечивает первый вариант «Иду») — сюда ведут
  кнопки анонса и поста в день игры; под переключателем — «Ответ нужен банкиру, чтобы собрать список игроков».
- Шторка посадки: имя в поле «Гость» уже есть в клубе (`nameMatches`/`nameMatchNotice`: регистр, ё/е, пробелы и пометка
  в скобках вроде «(гость)» не важны, только активные) — Notice «Такой гость уже есть: Петя» с кнопкой «Посадить этого
  гостя» (игрок клуба — «Посадить этого игрока»; join с выбранной кратностью), несколько — «отметь нужного в списке»,
  уже в вечере — «Петя уже в этом вечере»; новый гость с тем же именем — по-прежнему «Добавить гостя».
- Время вечера: `useNow(1000)` + `replay(format, events, now)`; `now` — по часам сервера
  (`src/shared/lib/serverClock.ts`: смещение по замерам `server_now` при старте и возврате на экран,
  `board_state.server_now` на каждом опросе табло и `at` из ответов `add_event`; берётся замер с
  наименьшим RTT). После записи `useEveningActions.send` прогоняет replay с новой записью: если журнал
  её не принял (например, ребай пришёл после закрытия), вместо «записан» — предупреждение.
  События вечера — запрос + Realtime-подписка на `evening_events` с фильтром `evening_id=eq.<id>`;
  табло без авторизации опрашивает `board_state` раз в 3 с.
- **Надёжность связи и экрана банкира** (аудит 07.10.2026):
  - Тайм-ауты записи — `WRITE_TIMEOUT_MS` (15 с) через `writeRpc` в `shared/api/rpc.ts`: `add_event` (события, платежи,
    олл-ин), `add_events`, `add_guest`, `void_event`, `void_events`, `set_payout`, `mark_settled`/`unmark_settled` —
    `.abortSignal`, зависшее соединение обрывается; `notify` — опция `timeout` functions-js (пост не дошёл — добьёт cron-tick). По тайм-ауту
    мутация отклоняется `TimeoutError`, глобальный тост показывает его текст: «Ответа нет — нажми ещё раз: запись не
    задвоится» (у записей с ключом повтора), у отмены — «проверь ленту: если запись не зачёркнута, отмени ещё раз»,
    у долей и отметки расчёта — «Ответа нет — нажми ещё раз». Шторки закрываются (`dismissible={!sending}`),
    журнал перечитывается (`onError` мутаций). Чтения тайм-аута не получили.
  - Ключи повтора — `retryKeys` (`createRetryKeys(sessionStorage, newClientId)`): намерение `retryIntent(вечер, тип,
    payload)` → ключ; не дошла — ключ запоминается на 5 минут от последней неудачи (не больше 50 ключей), прошла —
    забывается. Хранилище — копия памяти, читается один раз при загрузке; любая ошибка storage — только память.
  - Дошла без ответа (ревью 08.10.2026): сервер записал после тайм-аута клиента, журнал (перезапрос из `onError`,
    Realtime) запись уже показал. `keyFor` такой ключ отдаёт как новое намерение — повтор по совету тоста задвоил бы
    платёж, уровень или раздачу. Поэтому до отправки `retryKeys.landed(intent, now, inJournal)` — ключ последней
    неудачной попытки, если её неотменённая запись видна в журнале, — и вопрос (`confirmIfLanded` в
    `useEveningActions`, текст `landedQuestion`): «Запись уже в журнале» — «„Раздача сыграна“, 20:15 — прошлое
    нажатие дошло до сервера, хотя ответа не было. Повторять не нужно…», кнопки «Записать ещё одну» (новое действие —
    новый ключ) и «Не записывать» (дошедшая запись — результат нажатия, шторка закрывается как после записи). Ключ
    забывается при любом ответе. «Добавить гостя» спрашивает так же (`SeatSheet`, намерение `guestRetryIntent`).
  - Перерыв и ±1 мин (миграция 022). Пауза — одна шторка `PauseSheet` в обоих видах пульта («Пауза» на полосе часов
    «Стола», «Поставить паузу» в «Подробно»): «Пауза без срока» (`timer_pause {}`, как все паузы до 022, тост «Пауза»)
    и длительности `PAUSE_MINUTES_OPTIONS` («5 мин» … «30 мин», `timer_pause {minutes}`, тост «Перерыв 10 мин»); оба
    тоста с «Отменить». Раньше пауза без срока была отдельной кнопкой в одно касание, а «Перерыв» — шторкой рядом
    (решение пульта 08.10.2026: один вход «Пауза» с выбором — на полосе «Стола» нет места на две кнопки, а два касания
    на паузу не мешают). Строка «Время уровня ±1 мин» — у часов: в «Подробно» в карточке часов, в «Столе» — в шторке
    «Часы и уровень» (касание полосы часов). IconButton «Убавить/Прибавить
    минуту уровня», `time_adjust {seconds: ∓60}`, тосты «Минута убавлена/прибавлена» с «Отменить» — пока
    `timeAdjustable(state)` (`lib.ts`: уровень по времени, не последний, таймер запущен, вечер не завершён); кнопка
    недоступна по `canApply` (не в минус, не длиннее уровня). Часы экрана вечера у всех: на перерыве бейдж «Перерыв»
    и строка «Продолжаем через 07:12 · перерыв 10 мин» (`breakView(state, nowMs)` → `{minutes, leftMs, due,
    countdown}`, `breakLine` — «продолжаем через 07:12» / «пора продолжать»), по истечении — «Пора продолжать»
    цветом `critical`.
  - Лента и правка на месте (миграция 022): `describeEvent(ev, nameOf, formatRub, format, ctx?)` — с контекстом
    ленты `FeedContext` (`feedContext(events, replayLog)`: `effective` — исправленные записи с правкой в силе, `byId`,
    `previous` — для каждой правки запись со значением, которое было в силе перед ней: «было» у повторной правки —
    значение после прошлой принятой, а не исходное)
    исправленная запись показана по правке с пометкой «исправлено» («Вылет: Лёша — выбивают Саша и Миша — нокаут
    каждому · исправлено», «Вход: Женя — вход на 1 000 ₽ · исправлено»), сама правка — «Правка вылета: Лёша —
    выбивают Саша и Миша… · было: Женя» / «Правка входа: Женя — ×2 — 1 000 ₽ · было: ×1»; `time_adjust` — «Время
    уровня: +1 мин», пауза с длительностью — «Перерыв 10 мин». `EveningModel.feed` — этот контекст (`EventFeed
    feed`, подтверждения отмены, «Последняя запись»). Иконки ленты: правка — `pencil`, поправка времени — `clock`.
    `actions.check`/`send` для `amend` проверяют `canAmend` по журналу, а не `canApply` по состоянию. Отмена правки
    — как любой записи («Исправленная запись вернётся к прежнему значению…»).
  - **«Изменить запись»** (`AmendSheet`, помощники — чистый `amendView.ts`, `amendView.test.ts`): нажатие на вход, ребай
    или вылет в ленте (у банкира и админа живого вечера, у админа — и в журнале завершённого: правка после `finish` —
    только админ, как в SQL) открывает шторку, остальные записи — по-прежнему подтверждение отмены (`EventFeed
    onSelect` + `canEdit`: у исправляемых строк шеврон, подпись под лентой «Вход, ребай и вылет можно исправить на
    месте»). Вылет — «Кто выбил»: `amendKillerCandidates(format, events, eventId, current, nowMs)` — кто был в игре
    прямо перед этой записью (журнал до неё и поправки к более ранним записям, даже записанные позже: replay применяет
    их на месте исправляемой), без жертвы; отмеченные в записи, но тогда уже вне игры (запись «Не принято»), — следом
    с подписью «тогда уже вне игры» (без рода), чтобы их снять; «Никто / не знаю». Вход и ребай — `StacksPicker`
    («В записи сейчас ×2»). Значение при открытии — `currentAmendValue` (с правкой в силе; время — момент открытия:
    от времени значение не зависит), «Сохранить правку» доступна, когда значение другое (`amendChanged`: набор
    выбивших без порядка) и `actions.check('amend')` (= `canAmend`) молчит; отказ — Notice «Так исправить нельзя»;
    правка, которая задела бы другие записи, — Notice «Правка заденет другие записи» с перечнем (`amendImpactText`:
    какие записи журнал перестанет принимать и почему, какие вступят в силу, «Вечер перестанет быть завершённым», совет
    отменить запись и записать заново). Непринятая запись — Notice «Запись не принята» (правка может её починить, если
    не заденет записи после неё). Запись с оплатой при входе — строка «Оплата, записанная вместе с этой записью, не
    меняется — расчёт сам покажет…»; закрытый расчёт — «правка откроет его»; завершённый вечер — «места и победитель не
    изменятся» (это держит `canAmend`). Тост — `amendToast`: «Вылет исправлен: Лёша» /
    «Выбивают Саша и Миша — нокаут каждому.», «Вход исправлен: Вова» / «×3 — 1 500 ₽.» («исправлен» согласуется с
    записью: вход, ребай, вылет — мужского рода), с «Отменить». «Отменить запись» в шторке закрывает её и открывает
    прежнее подтверждение отмены (окно поверх шторки «Материя» не допускает).
  - Пульт идущего вечера (`LiveView` у банкира и админа): удержание экрана (`useWakeLock(canControl)` →
    `keepScreenAwake`: запрос при показе, повтор при возврате на экран и на касании, отказ — статус `denied`) и
    `useClosingConfirmation` — Telegram переспрашивает при закрытии Mini App. Нет API или отказ — под пультом строка
    «Отключи автоблокировку на время игры: телефон не даёт приложению держать экран включённым.» (`wakeLockHint`).
    Табло берёт тот же хук. Работает ли Screen Wake Lock внутри WebView Telegram на Android и iOS, не проверено —
    для этого и подсказка.
- **«Режим стола» на пульте** (аудит 07.10.2026, «Следующий шаг» 1; `TableView.tsx`, раскладка — чистый `table.ts`,
  стили — `pult.css`, тесты — `table.test.ts`). У банкира и админа идущего вечера над экраном — Segmented «Стол /
  Подробно» (`pultView.ts`: `usePultView` в `EveningScreen`, выбор — localStorage `poker-club:pult-view`, все
  обращения в try/catch, мусор и недоступное хранилище — «Стол»; по умолчанию «Стол»). «Подробно» — прежний экран
  (`DetailsView` в `LiveView`), игроки (не ведут пульт) видят его как раньше, переключателя у них нет. Действия,
  общие для обоих видов (завершить вечер, «Уровень вперёд» с переспросами, «Отменить последнее»), — `usePult.ts`
  (перенесены из `LiveView` без изменения поведения). В «Столе» шапка экрана — без подписи и заметки вечера,
  отступы между группами `space-4` (`ev-page--table`), на 320–359 px заголовок кеглем `m-h3`:
  - Полоса часов (`TableStrip`) прилипает к верху (`position: sticky`, `top: --pc-safe-top`): уровень, блайнды
    (перенос только после «/»), время уровня, справа «Пауза» (шторка `PauseSheet`), на паузе — «Продолжить»
    (`timer_resume`; главная кнопка, если нет финиша и вылета после ривера), до старта — «Запустить». Строка под ней
    — «дальше 15/30 · ребаи ещё 2 ч 34 мин» (`rebuyShortText`), на уровнях по вылетам/раздачам — прогресс; на паузе
    цифр нет, строка — `stripStatus(state, nowMs)`: «Пауза · стоим 3 мин · на часах 34:25» (от `timer.pause.at`, как
    на табло), «Перерыв · продолжаем через 07:12 · …», по истечении — «пора продолжать» (`critical`, фон
    `critical-soft`). Касание полосы — шторка `ClockSheet` «Уровень 3 из 8»: время, состояние, строка ребаев,
    ±1 мин, «Уровень вручную» (переход переспрашивает — шторка закрывается перед вопросом). На 320–359 px у кнопки
    полосы — только иконка (подпись в `aria-label`), цифры мельче.
  - Места за столом (`seatTiles`): плитки сеткой (`minmax(76px, 1fr)` — три в ряд на 320–359 px, четыре на 360–430)
    в порядке посадки `joinOrder` — **сетка не прыгает**: вылетевший остаётся на своём месте пунктиром с приглушённым
    аватаром, после ребая плитка снова живая там же, опоздавший садится в конец. Живой — тап = шторка вылета
    (`PlayerSheet`), вылетевший — ребай, пока можно докупиться (`canApply` домена), иначе карточка игрока; пока
    открыта регистрация, последняя плитка — «Посадить» (шторка `SeatSheet` «Опоздавший игрок»).
  - Ряд «Вылетели» (`bustedRow`): свежий вылет первым, известные места — по месту; подпись «ребай» (accent, иконка)
    / «6-е место» / «вне игры», тап — как у плитки.
  - Под местами: «Завершить вечер» (один живой; главная, когда ребаи закрыты), «Записать вылет: X» после ривера
    (см. «Олл-ин»), «Раздача сыграна · 3 из 10» на уровнях по раздачам, «Отметить олл-ин» / «Продолжить олл-ин» и
    рядом «Отменить последнее» иконкой (что отменится — в подписи кнопки и в вопросе `voidWithConfirm`), подсказка.
    Ниже прокруткой — панель олл-ина (в «Столе» она под пультом), статы, «Открыть расчёт», лента.
  - Проверено в headless Chrome на локальном стенде (6 игроков и гость, 2 вылета): 375×667 — всё до «Отметить
    олл-ин» в первом экране (низ ряда — 563 px), 430×932 — тоже; 320×568 — сетка и «Вылетели» в экране, ряд
    олл-ина — после прокрутки на ~100 px (полоса часов при этом остаётся сверху); горизонтальной прокрутки нет ни
    на одной ширине; светлая и тёмная темы. В настоящем Telegram не проверено.
- **Голос табло** (миграция 016; Silero TTS v5_5_ru, диктор xenia, CC BY-NC-SA 4.0 — клуб некоммерческий). Только
  голос, без звуковых сигналов. Silero работает только в Python, поэтому клипы озвучиваются заранее генератором
  (`scripts/voice/`, запускает `voice.yml` в `poker-club-ops` раз в сутки и вручную) и лежат в БД; табло их скачивает.
  - Генератор: `private.voice_manifest_input()` (psql) → `scripts/voice/manifest.mjs` (домен `voiceManifest`; Node
    23.6+ исполняет `.ts` без сборки, npm ci не нужен) → `scripts/voice/generate.py`. Он проверяет манифест (хеш —
    sha256 от «voice + перевод строки + text», форма текста — как constraint `voice_clips`, голос — из `VOICES`),
    берёт из `voice_clips` уже озвученное и синтезирует только отсутствующее, текст — ровно как в манифесте (с «+»
    и «—»): Silero v5_5_ru (`torch.package`; sha256 файла модели закреплён в `VOICES` — загрузка исполняет код из
    файла), диктор xenia, 48 кГц, `put_accent`/`put_yo`, 4 потока → тишина по краям не длиннее 80 мс (порог −45 дБ
    от пика) с подъёмом и спадом по 5 мс → громкость речи −17 dBFS (RMS звучащих кусков по 20 мс), пик не выше
    −1 dBFS → ffmpeg libmp3lame: MP3 CBR 64 kbps, моно, 48 кГц, без ID3, с заголовком Xing/LAME → `insert … on
    conflict do nothing` по одному клипу (прерванный запуск сделанного не теряет, повторный ничего не озвучивает).
    Одна фраза не озвучилась (Silero, ffmpeg, предел 256 КБ / 30 с, constraint) — остальные идут дальше, код
    выхода 1. `--plan` (без torch, только psycopg) печатает `missing=N` и модель (`model_url`, `model_sha256`,
    `model_file`) для `$GITHUB_OUTPUT`: workflow ставит torch, берёт модель и ffmpeg, только когда есть что
    озвучить. `--prune` — после озвучки без ошибок удаляет клипы любого голоса, которых в манифесте нет (весь
    манифест в этот момент в базе, табло другого не попросит). Строка подключения — только из `SUPABASE_DB_URL`
    (`--db-url-env`), пароль вырезается из текстов ошибок и трассировок. Зависимости — `requirements.txt` (torch
    2.14.1+cpu с индекса PyTorch, numpy, psycopg и зависимости torch — точные версии, только колёса) и
    `requirements-db.txt` (часть для `--plan`); пакет `silero` не нужен (модель тянет только torch и stdlib).
  - Кнопка в шапке табло «Включить голос» / «Выключить голос» (`VoiceButton` в `BoardPage`): звук браузер даёт
    только после нажатия, на ТВ хватает одного нажатия пульта. Что голос включён, табло помнит в localStorage
    (`poker-club:board-voice`, только удобство, всё в try/catch): после перезагрузки звук будится сразу, если
    браузер позволит, иначе первым нажатием любой кнопки (pointerdown/keydown на document). Нажатие самой кнопки
    голоса этот обработчик пропускает (`data-voice-toggle`, `isVoiceToggleGesture` в `voicePlayer.ts`): звук будит
    её `press`, решая «включить или выключить» по состоянию до нажатия — иначе к её click звук уже играл бы, и
    «Включить голос» выключало бы голос. Голос заработал (нажатие, первое нажатие пульта после перезагрузки, звук
    проснулся; после перезагрузки с разрешённым автозапуском — сразу) — проверка звука «Голос включён.»: клип ждём
    до 15 с (`HELLO_WAIT_MS` в `useBoardVoice`), не пришёл — молча. Подвал — `VOICE_CREDIT` (атрибуция лицензии) и
    пробелы озвучки (`gaps` хука → `voiceGapNotes` в `pages/board/boardView.ts`, аудит 07.10.2026): не озвучены
    фразы уровней или фиксированные — «Часть объявлений этого вечера ещё не озвучена — их табло пропустит.» (запасного
    варианта у них нет); не озвучено имя — «Имя Петя ещё не озвучено — нокауты и победу этого игрока табло объявит без
    имени.» (по именам игроков вечера); при любом пробеле — «Новые фразы и имена озвучиваются раз в сутки.». Раньше
    подвал обещал «скажет короче, без имён» и о немых уровнях и фразах. Пробел — хеш, для которого сервер ответил, а
    клипа нет (`ClipLoader.isMissing`). Без WebAudio или WebCrypto (`crypto.subtle` — только https/localhost) кнопки
    и подписи нет.
  - `useBoardVoice` (`pages/board/useBoardVoice.ts`): тексты вечера — `eveningVoiceTexts(format, имена из
    board_state)`, хеши — `clipHash`; пока голос включён, клипы подгружаются `board_voice_clips` пачками по 40.
    Что и когда просить, решает `ClipLoader` (`pages/board/clipLoader.ts`, без React, vitest): новые игроки —
    дозагрузка, не озвученные ещё хеши (сервер ответил, клипа нет) перепроверяются раз в 5 минут, упавший запрос
    (сеть, 4xx/5xx, ссылка погасла — null) — не раньше чем через 30 с (пачка и все следующие; пришедшее остаётся).
    Хук проверяет раз в 5 с и при новых текстах; пока идёт загрузка, новая не начинается.
  - `VoicePlayer` (`pages/board/voicePlayer.ts`): клипы — байтами MP3 в памяти, декодируются (WebAudio,
    `decodeAudioData` в форме с колбэками — для старых ТВ-браузеров) при первом проигрывании, кеш 24
    декодированных; объявления — строго по очереди, без наложений (пауза 60 мс между кусками, 400 мс между
    объявлениями, в очереди не больше 6); контекст уснул — новые объявления не копятся.
  - Детектор `voiceStep(format, prev, next) → {say, frame}` (`detectAnnouncements` — только `say`;
    `pages/board/announcer.ts`, чистый, vitest): кадр — `voiceFrame(format, events, replayLog, nowMs)` раз в секунду
    (useNow) и на каждый опрос, шаг идёт и при выключенном голосе; первый кадр — точка отсчёта (история при
    открытии и до включения голоса не зачитывается). Новые события (id, которого не было в прошлом
    кадре, `at` не старше 90 с) по порядку журнала: `timer_start` → старт, `timer_pause` → «Пауза.» (кроме
    служебной паузы перед `finish` из `add_event`; пауза с длительностью — «Перерыв N минут.», миграция 022),
    `timer_resume` → «Продолжаем.», `bust` → нокаут, `finish` → победитель; `amend` и `time_adjust` не объявляются
    (исправленная запись не новая — её id был в прошлом кадре). «Минута до конца перерыва.» — та же пауза в обоих
    кадрах, `pauseLeftMs` пересёк 60 с в этом шаге и не ниже 45 с, один раз на паузу (`heard.breakMinute` — id её
    `timer_pause`; табло, открытое на последней минуте, не догоняет); по истечении перерыва голос молчит. По состоянию replay: уровень вырос (таймер, `level_next`, вылеты/раздачи) → «Новый уровень»
    (на месте `level_next` в журнале, иначе после событий), ребаи закрылись не из-за finish → «Ребаи закрыты.»
    сразу за уровнем; «Минута до повышения» — уровень по времени, таймер идёт, следующий уровень есть, остаток
    пересёк 60 с в этом шаге и не ниже 45 с. Поправка «−1 мин» (`time_adjust` среди свежих событий шага) — законный
    скачок: перескочила порог — фраза сразу, пока до края больше 15 с; порог, пройденный на паузе (поправкой или
    переходом уровня), — при «Продолжаем» (то же условие 15 с); «+1 мин», поднявшая остаток выше порога, снимает
    отметку «сказано» — часы дойдут до порога снова (так же «Пять минут до закрытия ребаев»). Окно ребаев (аудит 07.10.2026): «Последний уровень ребаев.» — сразу за
    фразой уровня (или за «Поехали», если ребаи только на 1-м уровне), когда начался уровень номер `rebuyUntilLevel`
    (`lastRebuyLevelIndex` в `boardView.ts`: ребаи не на всю игру и не закрыты со старта) и ребаи открыты; «Пять минут
    до закрытия ребаев.» — игровое время до закрытия (`rebuyWindow`, как «ещё N мин» на экранах; уровни не по времени
    — срока нет, фразы нет) пересекло 5 минут в этом шаге при идущих часах и не ниже 4:45; короткий последний уровень
    ребаев — предупреждение ещё на предыдущем. `level_prev` не объявляется. Отмена (void) не объявляется: пропало
    событие — изменения состояния в этом шаге молчат (кроме уровня от нового `level_next`).
    Один раз на уровень: кадр несёт память сказанного (`heard`: наибольший уровень, уровень с отзвучавшей минутой,
    сказаны ли «Пять минут», ребаи уже закрыты; у первого кадра — по его состоянию: табло, открытое за 4 минуты до
    закрытия, о пяти минутах не говорит). Табло узнаёт о паузе с задержкой опроса (до ~3 с):
    replay успевает перевести уровень (или остаток через 60 с), запоздавшая пауза откатывает его, и после
    «Продолжаем» граница пересекается снова — повторно это не объявляется. Память сбрасывается к текущему
    состоянию только настоящим откатом: новый `level_prev`, `timer_start` или отмена (void).
  - Выбор варианта: первый из `announcementVariants`, все клипы которого загружены (имя гостя, заведённого в
    этот вечер, ещё не озвучено — фраза звучит без него).
- **Табло с дивана** (аудит 07.10.2026, `pages/board/BoardPage.tsx`, подписи и сигналы — чистый `boardView.ts`,
  vitest). Шкала ТВ (`board.css`, от 1024 px в горизонтали): на экране табло (`.bd-screen` — часы, ожидание, итог;
  шапка, подвал и олл-ин — в своих размерах) роли «Материи» `--m-*` и шаг `--space-*` переопределены в пикселях
  макета 1920×1080, вписанного в экран: `--bd-px = min(100vw / 1920, 100vh / 1080) × --bd-fit` — подписи 40, строки
  48, `m-h3` 60, `m-h2` 84, цифры 112, часы 300; на 1280×720 всё в 2/3, на 4K — вдвое. Контейнер табло на ТВ — во
  всю ширину (поля `space-7`); экран сообщения («Табло погасло», «Табло не загрузилось», `.bd--message`) — колонкой
  текста по центру экрана. Что не влезло (длинный список имён, строки подвала) — `useFitToScreen(ref, key,
  '--bd-fit')` (тот же хук, что у олл-ина, переменная — параметром), от 1 до 0,6. Проверено в headless Chrome на
  локальном стенде: обычный вечер (6 игроков, 2 выплаты, нокаут) на 1920×1080 — масштаб 1; телефонная раскладка
  (колонка) не меняется.
  - Часы (`boardClock`): пауза — на весь блок (подложка `accent-soft` тенью без размытия, раскладка не прыгает):
    «Пауза», «стоим 6 мин» (`pausedForMs` — от последней принятой паузы, `pauseText`) и «На часах 12:34»; перерыв на N
    минут (миграция 022, `breakView` из `pages/evening/lib`) — «Перерыв» и «продолжаем через 07:12» (`m-h2`, `accent`),
    по истечении — «пора продолжать» (`critical`, иконка часов) и блок часов медленно дышит `accent-soft` ↔
    `accent-6` (`bd-clock--due`, 2 с туда и обратно, 0,25 Гц; при `prefers-reduced-motion` — неподвижная подсветка
    `accent-5`); таймер сам не продолжает. Проверено в headless Chrome на локальном стенде (1920×1080); последний
    уровень — главным числом блайнды под «Последний уровень» вместо счёта вверх (`bigBlinds`: «1 000/2 000» одной
    строкой, кегль вписан в колонку через `100cqi / --bd-em` — ширину строки в em с запасом к замеру шрифта; анте —
    строкой «Анте 3 000» ниже; без единиц контейнера — перенос только после «/»); последняя минута уровня по времени
    — цифры `critical` и строка «Последняя минута уровня» с иконкой; смена уровня (первые 6 с игрового времени
    уровня, `LEVEL_FLASH_MS`, с запасом на опрос) — вспышка блока (две волны `accent-5` по 1,5 с), при
    `prefers-reduced-motion` — неподвижная подсветка `accent-4` на те же секунды. Звука нет — только свет.
  - Строка ребаев (`rebuyLine`): на последнем уровне ребаев — «Последний уровень ребаев — ещё 25 мин» крупно
    (`m-h3`) и `accent`; так же акцентом, когда до закрытия меньше 5 минут ещё на предыдущем уровне.
  - Стол: «В игре 5 из 6» с «6 входов + 1 ребай» (`entriesText`: ребай — тоже вход, поэтому входы без ребаев), «Фонд»
    и выплаты по местам теми же плитками (на ТВ по две в ряд), «Последний нокаут» одной строкой (`lastKnockout`:
    «Миша · выбивают Саша и Дима», глагол без рода), «За столом»; нижняя строка часов — «Средний стек 12,5 BB · игра
    идёт 2:14» (`tableLine`, `averageStackBb`, время без пауз). Денег за голову нет.
  - Ожидание: «Начинаем в 15:00» (другой день — «Начинаем 9 октября в 15:00») и «через 12 мин» (`startsInText`,
    минуты вверх; время прошло — «Таймер запустит банкир»), кто за столом; структура уровней с часами по МСК
    (`levelPlan`: от времени старта, если оно прошло — от следующей минуты, «если начать сейчас»; после уровня не
    по времени — его длина вместо часов) и пометкой «последний с ребаями»; выплаты (`payoutPlan`: доли формата и
    суммы по нынешнему фонду, когда игроков хватает на все призовые места) и стартовый стек в BB (`startingStackBb`).
  - Итог: победитель, «Приз 2 450 ₽ · 4 нокаута», «Лучший охотник — Женя: 4 нокаута» (`bestHunters`, по числу
    нокаутов), «Игра шла 3:12» (`formatGameTime`, время без пауз, как «Игра шла» в приложении), места с призом
    (`computeMoney` домена) и нокаутами.
  - Перенос строк: перед «·» и тире — неразрывный пробел, строка не начинается с разделителя. Блайнды (`blindsParts`,
    `<wbr>` после «/») рвутся только после «/» и перед «(анте)», не внутри числа: у таблицы уровней `nowrap` — только
    у номера и времени. Проверено на стенде (крупные блайнды 1 000/2 000 и 1 500/3 000 (3 000)): главное число — одной
    строкой на 1920×1080, 1280×720, 320 и 375 px; в таблице уровней на 320 px «(2 000)» уходит на вторую строку;
    горизонтальной прокрутки нет.
- **Табло клуба** (аудит 07.10.2026, «Следующий шаг» 3; миграция 023). `/tv/:code` — `pages/board/ClubBoardPage.tsx`:
  код проверяется на клиенте (`CLUB_BOARD_CODE_RE`, 12 hex, как check), `useClubBoardState` (`shared/api/board.ts`)
  опрашивает `club_board_state` раз в 3 с, пока есть вечер, и раз в 30 с между вечерами. Вечер — тот же `Board`, что у
  ссылки вечера (`BoardPage.tsx` экспортирует `Board` и `BoardMessage`; источник — `BoardSource` `{kind: 'evening',
  token} | {kind: 'club', code}`, стабильным объектом): голос (`useBoardVoice` грузит клипы `fetchVoiceClips(source…)`
  — по коду через `club_board_voice_clips`), олл-ин, раскрытие улиц. Смена вечера на табло (тренировка → настоящий) —
  без перезагрузки: детектор голоса берёт новый вечер точкой отсчёта (`prevFrame.eveningId`). Между вечерами —
  `IdleBoard`: «Следующая игра», день и время (`clubIdleView` в `boardView.ts`: `next_at`, иначе ближайший слот
  расписания `nextGameAt`; за сутки — «через …»), «Табло само переключится на вечер в день игры». Код не тот — «Ссылка
  табло устарела». Ссылка: `clubBoardUrl(code)` (`shared/lib/paths.ts`, маршрут `paths.clubBoard`).
  «Вывести на ТВ» (`TvSheet`): главная — «Табло клуба» (QR `LinkQr` из `shared/ui`, «Скопировать ссылку», «Открыть
  табло здесь»), запасная — «Ссылка только на этот вечер» (прежняя `/board/:token`); у тренировки — совет открыть
  ссылку тренировки, если табло клуба занято настоящим вечером; без кода (фронт раньше миграции) — только ссылка
  вечера. Кнопка видна у анонса, идущего вечера и 6 ч после финала. Админка «Клуб» → «Табло клуба»
  (`ClubBoardSection`, вне формы настроек): QR, копирование, «Перевыпустить ссылку» через подтверждение
  (`rotate_club_board_token`, `useRotateClubBoardToken`). Тренировка на табло — «Тренировка · 08.10 · 14:00» в шапке.
- **«Табло на связи»** (023): `useBoardPing(source, eveningId, voiceOn)` — пока табло показывает вечер, `board_ping` сразу
  и раз в `BOARD_PING_MS` (20 с), при смене вечера и включении/выключении голоса; сбой — молча. Банкир читает
  `board_presence` (`useBoardPresence`, раз в 10 с).
- **«Проверка перед игрой»** (аудит, «Следующий шаг» 6; `pages/evening/PregameCheck.tsx`, решения и тексты — чистый
  `pregame.ts`, тесты — `pregame.test.ts`). У банкира и админа: на анонсе за 3 ч до начала — раздел под «Столом»
  (`PregameSection`, все пункты сразу), раньше — строка (`PregameRow`, пункты в шторке); в игре — строка под статами в
  обоих видах пульта. Пункты (`pregameChecks`): банкир назначен (админу — «Назначить банкира» в форму вечера);
  связь — один `server_now` с пределом 5 с (`pingServer`, `shared/api/serverClock.ts`; дольше 1,5 с — «медленная»);
  живое обновление — статус канала журнала (`useRealtimeStatus(eveningRealtimeTopic(id))`, `shared/api/realtime.ts`
  считает состояние каналов: connecting / live / broken / none); экран — раздел за 3 ч до начала и строка в игре
  держат экран сами (`useWakeLock`), статус и есть ответ; строка на анонсе раньше экран не держит
  (`holdScreen: false`) — пункт ждёт («Проверим за 3 часа до начала…»), кроме «API нет»; табло — `board_presence`
  вечера: до дня игры по Москве (`gameDay`; табло клуба берёт анонс только в день игры —
  `private.club_board_evening_id`) без свежей отметки — пункт ждёт («Табло клуба покажет этот вечер в день игры…»), а
  не красный; в день игры нет отметки — «Табло не открыто», старше 60 с — «не на
  связи» с временем последней, свежая без голоса — «голос выключен», иначе ok («Вывести на ТВ» прямо из пункта);
  имена — тех, кто сел, до старта и ответивших «иду» (`pregamePlayerIds`): `speakableName` null — «не прочитает»
  (совет — «Имя на табло»), нет клипа — «не озвучено»; фразы — уровни формата и `FIXED_TEXTS`
  (`pregameVoicePlan`, `voiceCheckFrom`; наличие — `voice_clips_present` по `clipHash`). Совет об озвучке админу —
  запустить `voice.yml` вручную, банкиру — попросить админа. Итог строкой (`pregameSummary`), «Проверить снова».
- **Тренировочный вечер** (аудит, «Следующий шаг» 6; миграция 023). Админка «Вечера» — «Тренировочный вечер» →
  `/admin/evening/new?training=1`: сегодня, ближайшие 5 минут по Москве, банкир — админ (`trainingEveningDraft`),
  занятых дней нет; «Создать тренировку» открывает экран вечера. В форме существующей тренировки вместо «Отмены» —
  «Удалить тренировку» (подтверждение, `useDeleteTrainingEvening`, тост `trainingDeletedText`). Пометка везде, где
  вечер показан: `TrainingBadge` рядом со статусом (админка), «Тренировка 8 октября» и Notice на экране вечера (в
  «Столе» — только заголовок), строка «Тренировка» на главной (`pickTraining`: идущая или объявленная, не забытая;
  ближайший вечер клуба — `pickUpcoming` без тренировок), шапка табло. У тренировки нет ответа «иду», прогноза и «Кто
  идёт»; финиш — «Завершить тренировку?» без поста и голосования (notify не зовётся), на экране итога нет кнопки
  «Перейти к голосованию» (`FinishedView`), экран голосования по прямой ссылке — «Это тренировка». Не попадает в историю, рейтинг, сезоны, ачивки, ленту, рекорды, моменты и долги: `fetchClubHistory`
  берёт `withoutTraining` (`shared/api/types.ts`, фильтр на клиенте — фронт может выйти раньше миграции), список
  «История» — тоже; функции — `loadHistory` и фильтры cron-tick. `takenDates` (форма вечера) тренировки не считает.
- **Имя для озвучки** (`players.spoken_name`, 016). Карточка игрока: своя — «Сменить имя» и «Имя на табло»
  (`SpokenNameSheet`, RPC `set_my_spoken_name`), у админа на любой карточке — «Имя на табло» (upsert под RLS);
  если голос не может назвать тебя (латиница без имени для озвучки) — пометка «Табло не назовёт тебя по имени».
  Админка «Игроки»: у таких игроков в строке «имя не звучит на табло», в шторке игрока — поле «Имя для озвучки».
  Подписи — `shared/lib/spokenName.ts` (`SPOKEN_NAME_HINT` дословно: «Как произносить имя на табло — кириллицей.
  Ударение — знак + перед гласной: Эрдн+и», что скажет табло при пустом поле, тост об озвучке раз в сутки).

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
- **«Записать вылет: X, выбивает Y» после ривера** (аудит 07.10.2026; чистый `pages/evening/riverBusts.ts`, тесты —
  `riverBusts.test.ts`; хуки — `useRiverBusts.ts`, выбор в шторке — `RiverBustsChoice.tsx`). `riverOutcome(showdown)` —
  на ривере (5 карт стола) оценка рук `evaluate` движка: лучшая рука (несколько — делёж) и проигравшие; до ривера и
  при сломанных картах — null. `riverBustSuggestion(showdown, isAlive, applied)` — проигравшие, которые ещё в игре и
  не вылетали в этой раздаче (`bustedInHand(applied, openedEventId)` — принятый вылет после открытия раздачи: вылет
  раздачу не закрывает, ривер висит ещё 2 мин, и после «Ребай» из тоста игрок снова в игре — второй раз его не
  предлагаем), и кто выбивает — победители в игре (делёж — нокаут каждому); null — делёж на всех или все проигравшие
  уже вне игры или уже вылетали в этой раздаче.
  Стеков пульт не знает: проигравший вылетает, только если фишек было не больше, — поэтому это предложение, решает
  банкир. Один проигравший — кнопка «Записать вылет: Миша» на пульте (в «Столе» — под местами, в «Подробно» — под
  панелью олл-ина) с вопросом `riverBustQuestion` («Миша — вылет, выбивает Женя. Фишек хватило и игрок остаётся за
  столом — нажми «Не записывать».»), запись — обычный `bust`, тост с «Ребай», пока игрок может докупиться. Несколько
  — «Записать вылеты: 2» открывает шторку олл-ина: там после ривера «Кто вылетел» (отмечены все проигравшие — снять,
  кому фишек хватило) и «Места по фишкам» (`keepChipOrder`, `moveUp`: выше — у кого фишек перед раздачей было больше,
  ему место выше), главная кнопка шторки — «Записать вылет(ы)», рядом «Закрыть раздачу»; в шторке вопроса нет
  (отметки и порядок и есть подтверждение, окно поверх шторки «Материя» не допускает). Несколько вылетов — одно
  действие `sendAll(riverBustDrafts(byChips, killers))`: записи от меньшего стека к большему, и последний записанный
  (у кого фишек больше) получает место выше — места домен считает в порядке, обратном окончательным вылетам; одна
  транзакция `add_events`, «Отменить» в тосте — всё действие. Тесты: итог раздачи (хедз-ап, делёж, три руки), места
  по порядку фишек и обратный порядок, делёж банка — нокаут каждому, 100 случайных раздач: одно действие ≡ те же
  вылеты по одной (replay совпадает), записи проходят `canApplySequence`, доигранный вечер — призовые = взносы.
- **Раскрытие улиц на табло по очереди** (чистый `pages/board/streetReveal.ts`, тесты — `streetReveal.test.ts`; хук
  `useStreetReveal` в `BoardPage` — память живёт в `Board`, а не в панели олл-ина, которая пропадает между
  раздачами). Банкир внёс несколько улиц одной отправкой — табло показывает флоп, через `REVEAL_STEP_MS` (3 с, при
  тике табло раз в секунду на экране 3–4 с) тёрн, потом ривер; шансы и ауты — по показанному столу. Первый кадр табло
  (открыли посреди раздачи) показывает стол как есть; новая раздача — сразу первая пришедшая улица (до флопа — руки,
  иначе флоп); каждая улица видна не меньше шага (поздний флоп после долгого префлопа — сразу); карт стало меньше
  (отменили ривер) — сразу. Приложение (экран вечера, пульт) показывает стол как в журнале. Проверено в headless
  Chrome на стенде (1920×1080): раздача с пятью картами одной записью — флоп, через 3 с тёрн, ещё через 3 с ривер.
- **Показ** — `ShowdownView` кита (`src/shared/ui`, вариант `board` для табло и `compact` для экрана вечера) и
  `PlayingCard`/`SuitPip`: стол из пяти мест (пустые — пунктиром), руки (карты, рука словами — «Пара дам»,
  «Флеш до туза»), шансы — целые % и полоса (лидер по шансам — accent), «делёж N %» (частота дележа), «Впереди»
  у лучшей руки на текущем столе, ауты; на ривере — «Лучшая рука» / «Делёж банка», проигравшие приглушены.
  Табло (`pages/board/ShowdownBoard.tsx`) показывает панель вместо таймера и стола, пока `visibleShowdown`
  (`BoardPage`), часы уровня — строкой в её шапке; экран вечера (`LiveView`) — первой карточкой (у игроков и в
  «Подробно»; в «Столе» — под пультом), у банкира с кнопкой «Отметить карты». Масти — значками (SVG, не символами шрифта) и цветом: ♠ ink, ♥ critical, ♦ синий из категориальной
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
  табло, низкий экран) ловит `useFitToScreen` (`pages/board/fitToScreen.ts`; переменная масштаба — параметр, у
  олл-ина `--sd-fit`, у экранов табло `--bd-fit`): если страница длиннее экрана, масштаб
  `--sd-fit` подбирается двоичным поиском по настоящей раскладке (`bestFit`, от 1 до 0,6) при смене раздачи,
  размера окна и высоты страницы (ResizeObserver, не чаще раза за кадр). Проверено в headless Chrome на стенде с
  разметкой табло (длинные имена, строка подвала): 2–9 рук на всех улицах при 1920×1080, 1366×768, 1280×720,
  1024×768, 2560×1440 — без прокрутки и наложений, масштаб меньше 1 понадобился только девятерым на флопе при
  1366×768 и 1280×720 (0,99 и 0,975); худший случай (9 рук с длинными списками аутов, 1280×720, три строки
  подвала) — 0,84.
- **Движок** (`supabase/functions/_shared/domain/poker` — с историй клуба в домене, им считает и пост итогов; во
  фронте `src/shared/lib/poker` реэкспортирует его; перенос из курса `D:\personal\poker-course\js`: `cards.js`, `evaluator.js`,
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
- `supabase/tests/016_board_voice.sql` — то же для 016 (форма `spoken_name`, `set_my_spoken_name`: нормализация,
  тексты отказов, сброс, права; админ правит чужое upsert-ом; `voice_clips`: хеш SQL = хеш домена, отказы
  constraint, повтор генератора, RLS и права; `board_voice_clips`: только найденные клипы, base64 без переводов
  строк, срок токена как у `board_state`, предел 100; `board_state` отдаёт `spoken_name`;
  `private.voice_manifest_input()`: активные игроки, `last_played_at`, форматы; `merge_players` переносит
  `spoken_name` гостя профилю без своего и не трогает своё).
- `supabase/tests/017_showdown.sql` — то же для 017 (нормализация `showdown`/`showdown_close`, отказы 22023 по
  картам, рукам, столу, игрокам не за столом и отменённому входу, ключ повтора сверяет карты, `board_state` отдаёт
  олл-ин и имена его игроков, отменённую правку — нет, check типов в таблице, слияние гостя из руки олл-ина,
  права служебных функций):
  `docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/017_showdown.sql`.
- `supabase/tests/018_drop_bounty.sql` — то же для 018 (после миграций и seed `bountyRub` нет ни в `formats.config`, ни
  в `evenings.format`; клубный формат — ровно ключи `DEFAULT_FORMAT`; `board_state` и `voice_manifest_input` отдают
  форматы без него; операторы 018 на старых строках убирают только `bountyRub`, повторный прогон ничего не меняет).
- `supabase/tests/019_add_guest_retry_key.sql` — то же для 019 (повтор `add_guest` тем же ключом — тот же гость, в том
  числе с другим регистром и пробелами, один игрок и один вход; ключ с другой кратностью, другим именем, ключ входа
  постоянного игрока и чужой ключ — 22023 без новых игроков; без ключа — как раньше; повтор после отмены вечера
  возвращает гостя; права и сигнатуры). Одновременный повтор (вторая попытка ждёт блокировку первой и возвращает того
  же гостя) проверен вручную двумя сессиями psql, в файл не входит: внутри одной транзакции его не воспроизвести.
- `supabase/tests/020_entry_with_payment.sql` — то же для 020 (`derived_client_id`; `add_events`: порядок и ключи
  записей, одно `at`, нормализация, повтор тем же ключом — те же записи, чужое намерение под ключом — 22023, ошибка
  второй записи и отказ по правам ничего не записывают, тип вне join/rebuy/bust/payment, пустая и длиннее 50 пачка,
  лишнее поле; `void_events`: отмена всего действия, повтор и смесь с отменённой — отказ целиком, повтор id, записи
  двух вечеров; `add_guest` с `p_paid_rub`: платёж с ключом `derived_client_id(ключ, 1)` в той же транзакции, повтор
  сверяет оплату, без ключа, неверная сумма до создания игрока, старые вызовы без платежа; права и сигнатуры). Тесты
  015 и 019 сверяют права уже по сигнатуре 020.
- `supabase/tests/021_voting_reminder_cron_watch.sql` — то же для 021 (отметка напоминания: пишет service_role,
  то же `voting_closes_at` её не трогает, новое и отмена finish через `void_event` — снимают; `cron_heartbeat`: RLS,
  права только service_role, одна строка; `mark_cron_tick`: только service_role, ok — обе отметки, не ok и null —
  только `last_run_at`; `cron_last_tick`: anon, ровно три ключа, null без отметки; security definer и пустой
  `search_path`).
- `supabase/tests/022_amend_pause_time_adjust.sql` — то же для 022 (`amend`: нормализация `by` и `stacks`, единица
  хранится, исходная запись не меняется; ключ повтора сверяет запись, выбивших с порядком и кратность; отказы 22023 —
  без значения, оба значения, лишний ключ, `eventId` строкой/0/дробью, чужой вечер, нет записи, не тот тип, кратность
  у вылета, выбившие у входа, жертва в выбивших, повтор, не список, несуществующий игрок; отменённая запись — P0001;
  посторонний — 42501; после завершения банкир — 42501, админ — можно, вечер остаётся завершённым; правка закрытого
  расчёта его открывает; отмена правки — `void_event`. Пауза `{minutes}`: нормализация, `{}` как раньше, отказы,
  ключ повтора; `time_adjust {seconds}` — то же; служебная пауза перед `finish` не пишется, если стоит пауза с минутами.
  `board_state` отдаёт правки, поправки и минуты; check типов; слияние гостя из `by` правки; права служебных функций;
  `add_event` — security definer с пустым `search_path`):
  `docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/022_amend_pause_time_adjust.sql`.
- `supabase/tests/023_club_board_pregame_training.sql` — то же для 023 (код табло клуба: форма, check, между вечерами
  — board null, чужой/пустой код — null; выбор вечера по всем ступеням; ответ табло клуба = `board_state` по ссылке
  вечера, `is_training` в ответе; `next_at` без тренировок; перевыпуск — только админ, старый код гаснет;
  `club_board_voice_clips` между вечерами, старый код, предел 100; `voice_clips_present` — участник, без звука, предел
  300, anon и не участник — отказ; `board_ping` по токену вечера и по коду, чужие токены — false, троттлинг 5 с,
  `voice_at` без голоса не меняется, между вечерами — false; `board_presence` — RLS и права; тренировка: день клуба не
  занимает, второй настоящий вечер в день — 23505, пометку не сменить в обе стороны, голосования нет, finish через
  `add_event`; удаление — только админ, только тренировка, гости тренировки — удалены, гости настоящих вечеров —
  нет; `voice_manifest_input` без тренировок в `last_played_at`; гранты и security definer). Не зависит от даты:
  свои вечера ставятся от `now()`:
  `docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/023_club_board_pregame_training.sql`.
- `supabase/tests/024_spectator_merge_guests.sql` — то же для 024 (backfill и null у нового профиля; `set_my_spectator`
  — свой флаг, null — 22023, отключённый и anon — 42501; прямой update своего и чужого флага и своего `is_admin` игроку
  не даёт RLS, админу — даёт; `merge_guests`: права, все отказы аргументов, предпросмотр и счётчики, «оба в журнале» —
  текст для дублей, P0001 и снятие препятствия отменой входа, разные ответы на анонс; перенос журнала, голосов и
  прогнозов, статусы и закрытые расчёты вечеров не тронуты, флаги профиля, имя для озвучки, ответ на анонс с прежним
  временем; гранты публичных и служебных функций):
  `docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/024_spectator_merge_guests.sql`.
- `node scripts/check-merge-replay.mjs` — слияние гостя «Вова» из seed в транзакции с rollback, оба вида: с новым
  Telegram-профилем (`merge_players`) и с новым гостем без Telegram (`merge_guests`, 024; `--kind telegram|guest` —
  один вид): replay, settlement, голоса, прогнозы и статус каждого вечера после слияния совпадают с исходными
  с подменой id.
- `scripts/voice/test_generate.py` — генератор голоса без базы и модели: хеш совпадает с доменом, отказы манифеста,
  пароль вырезается из ошибок, обрезка тишины и громкость, MP3 моно 48 кГц 64 kbps (если найдётся ffmpeg):
  `python -m unittest scripts/voice/test_generate.py` в venv с `requirements.txt` (Python 3.14).
- Генератор голоса целиком на локальном стеке — venv с `requirements.txt`, модель
  (https://models.silero.ai/models/tts/ru/v5_5_ru.pt, sha256 — в `VOICES` generate.py), ffmpeg с libmp3lame в PATH
  или в `FFMPEG` (на Windows без ffmpeg — `pip install imageio-ffmpeg` в тот же venv, путь —
  `python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`):
  ```bash
  docker exec supabase_db_poker-club psql -X -U postgres -At -c 'select private.voice_manifest_input()' > input.json
  node scripts/voice/manifest.mjs input.json > manifest.json
  export SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:57322/postgres PYTHONUTF8=1
  python scripts/voice/generate.py manifest.json --plan
  python scripts/voice/generate.py manifest.json --model v5_5_ru.pt --prune
  ```
  На seed (семь игроков с гостем, клубный формат; 07.10.2026, Windows, 4 потока torch): 89 фраз, 1 780 224 байта
  MP3, 217 с звука; синтез 6–8 с, весь запуск генератора 15–17 с; повторный — 0,4 с, без torch. С тремя фразами
  аудита (08.10.2026, тот же стенд): 92 фразы, 1,73 МБ, 221,6 с звука, синтез 8,2 с, шаг 18,8 с. `db:reset` клипы
  стирает.

## Тестовые данные (seed.sql, только локально)
Игроки с `tg_id` 1001–1006 (1001 — админ), один гость, settings (четверг 19:00 МСК, анонс за 48 ч, пост в день игры за 5 ч; клубный формат
создаёт миграция 011, seed на него ссылается), `cron_secret` = `local-cron-secret`, `project_url`, 4–6 завершённых вечеров с реалистичными событиями (ребаи, сплит-нокаут,
платежи) и один `announced` вечер — чтобы рейтинг, ачивки и карточки игроков было на чём смотреть. У гостя «Вова (гость)» — имя
для озвучки «В+ова» (миграция 016: скобки голос не прочитал бы).

## Деплой в облако
Процесс целиком — `DEPLOY.md`. `.github/workflows/deploy.yml` (push в `main` + вручную; триггеров
`pull_request*` нет — репозиторий публичный): `checks` (npm ci, typecheck, lint, test) → `pages-build`
(сборка с `BASE_PATH=/poker-club/` и `.env.production`, проверка, что dev-входа нет в бандле) → `pages-deploy`;
параллельно `backend` (только `refs/heads/main`): без секретов `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` — notice и успех, иначе
`supabase link` → `db push --linked --skip-vault --yes` (без seed) → `functions deploy` → `secrets set`
(`APP_URL` из vars, `ADMIN_TG_ID` и `TELEGRAM_BOT_TOKEN` из секретов) → `project_url` в Vault через Management API →
проверка: `cron-tick` 401 на неверный секрет; SQL — гранты `service_role` на все таблицы/sequences `public`,
`cron_secret` и `project_url` в Vault, активное задание pg_cron; `private.invoke_cron_tick()` → ответ в
`net._http_response` 200 без `errors`; этот тик записал свежую отметку `cron_heartbeat` (021).
**Запрет выкладки во время игры** (аудит 07.10.2026): job `live-guard` («Нет ли идущей игры») — до сборки сайта и
бэкенда (`pages-build` и `backend` ждут его): SQL через Management API тем же `SUPABASE_ACCESS_TOKEN`, что у
проверки после деплоя (новых секретов нет), — есть вечер в `live` → job падает: «Идёт игра — выложи после финала»
с датой вечера и временем старта по МСК. После финала — Re-run all jobs; срочно — ручной запуск с входом `force`
(`workflow_dispatch`, галочка): предупреждение вместо ошибки. Нет токена — notice и пропуск (бэкенд без него и так
не деплоится); Management API не ответил — ошибка (без `force`). Переменные репозитория: `SUPABASE_PROJECT_REF`, `APP_URL`; секреты —
`SUPABASE_ACCESS_TOKEN` (scoped), `SUPABASE_DB_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `ADMIN_TG_ID`. Actions закреплены SHA,
обновления — Dependabot (`.github/dependabot.yml`). Резервные копии и keepalive — отдельный приватный репозиторий `poker-club-ops` (keepalive раз в сутки ещё и
сторож будильника: `cron_last_tick`, `last_ok_at` старше часа — job красный, письмо от GitHub): там же ежемесячная
проверка восстановления копии (`restore-check.yml`), озвучка фраз голоса табло (`voice.yml`, раз в сутки и вручную;
секрет тот же `SUPABASE_DB_URL`, DEPLOY.md → «Голос табло») и напоминание о сроке токена Supabase (`reminders.yml`,
переменная `TOKEN_EXPIRES` — дата окончания `SUPABASE_ACCESS_TOKEN`; при замене токена обновлять).

Auth в облаке: `supabase config push` не используется (`[auth]` в `config.toml` — локальные адреса);
регистрация выключена руками. Провайдер Email не выключать: вход `tg-auth` → `verifyOtp(token_hash)` с
выключенным провайдером не проверялся. Сразу после деплоя войти админом (`ADMIN_TG_ID`), до подключения
группы. Участника, вышедшего из группы, админ выключает (`is_active=false`): refresh-токен иначе живёт дальше.
