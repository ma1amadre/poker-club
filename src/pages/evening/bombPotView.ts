// Бомб-пот на экранах вечера (миграция 030, решения пользователя 23.10.2026): шторка «Бомб-пот»,
// полоса бомб-пота на пульте и у игроков, ряд «Кто забрал бомб-пот?» вместо «Следующей раздачи»,
// тосты и розыгрыш взноса без табло. Чистый модуль (тесты — bombPotView.test.ts): кто играет, какой
// взнос и куда встанет баттон, решает домен (bombPot.ts, replay); здесь — тексты и время показа.
//
// Почему так устроено:
// - Табло узнаёт число первым (решение 10): пульт и экраны игроков показывают взнос не раньше
//   at + BOMB_REVEAL_MS по серверному времени, до этого — «кубик брошен — смотри на табло». Если
//   табло не на связи (board_presence старше минуты), телефоны разыгрывают взнос сами — той же
//   партитурой, что табло (rollPlan: два круга 1…5 и посадка на выпавшем, интервалы растут).
// - Число лежит в данных телефона сразу — его прячет интерфейс, а не сервер. Честность бомб-пота —
//   невозможность выбрать число (кубик на сервере), а не невозможность подсмотреть.
// - Банк — номинальный «взнос × участники»: ставок на улицах и коротких стеков приложение не знает.
//
// Тексты без рода (на «ты», имена бывают и мужские, и женские): «Бомб-пот забирает Костя», «У тебя
// первое слово», «Баттон остаётся: Миша».
import {
  BOMB_REVEAL_MS,
  bombPotPreview,
  bombPotWinnerChoices,
  buttonAfterBombPot,
  isBombPotRevealed,
  type BombPotPreview,
} from '@domain/bombPot.ts';
import { bombPotAllInWinners } from '@domain/riverBusts.ts';
import { tablePositions } from '@domain/seats.ts';
import {
  BOMB_POT_MAX_BBS,
  BOMB_POT_MIN_BBS,
  type BombPotState,
  type EveningEvent,
  type EveningState,
  type PlayerId,
} from '@domain/types.ts';
import { formatBlinds, formatNumber, NBSP, pluralWithNumber } from '../../shared/lib/format';
import { joinNames } from '../../shared/lib/text';
import { bombRerollText, type FeedContext, type NameOf } from './lib';
import { BOARD_FRESH_MS } from './pregame';
import { positionsText, type ToastText } from './seating';

const SEP = `${NBSP}· `;

// --- Розыгрыш: одна партитура у табло и у телефонов --------------------------------------------

/** Кругов перебора 1…5 до посадки: исход виден только по остановке, а не по темпу. */
export const ROLL_LAPS = 2;

/**
 * Интервал между листами розыгрыша, мс: IV(i) = 80 · 1,137^i (замечание судей к макету v2 — рост без
 * потолка: торможение непрерывное при любом исходе, кадр до остановки одинаковый).
 */
export function rollInterval(i: number): number {
  return Math.round(80 * 1.137 ** i);
}

export interface RollPlan {
  /** Сколько листов: два круга и выпавшее (10 + k). */
  flips: number;
  /** Когда начинается каждый лист, мс от начала перебора. */
  starts: number[];
  /** Знак на каждом листе: 1, 2, 3, 4, 5, 1, 2, … k. */
  values: number[];
  /** Длительность каждого листа (последний — самый медленный, посадка тяжёлая). */
  durations: number[];
  /** Удар: последний лист лёг (отскок пошёл), мс от начала перебора. */
  hit: number;
  /** Последний лист встал совсем. */
  end: number;
}

/**
 * Партитура розыгрыша при исходе k (1..5): листы идут только вперёд, как у механического табло, два
 * полных круга и посадка на k. Последний лист — max(340, 1,25 × свой интервал), посадка тяжёлая:
 * первая половина — падение, вторая — в 1,5 раза длиннее (отскок 12°). Вне 1..5 — как 1 (не бывает:
 * бросок сервера всегда 1..5). laps — кругов до посадки: меньше двух — только у табло, когда сцена
 * ждала в очереди и должна успеть до телефонов (scenePace); телефоны всегда листают два.
 */
export function rollPlan(k: number, laps: number = ROLL_LAPS): RollPlan {
  const kk =
    Number.isInteger(k) && k >= BOMB_POT_MIN_BBS && k <= BOMB_POT_MAX_BBS ? k : BOMB_POT_MIN_BBS;
  const turns = Number.isInteger(laps) && laps >= 0 && laps <= ROLL_LAPS ? laps : ROLL_LAPS;
  const flips = turns * BOMB_POT_MAX_BBS + kk;
  const starts: number[] = [];
  const values: number[] = [];
  const durations: number[] = [];
  let t = 0;
  for (let j = 0; j < flips; j += 1) {
    starts.push(t);
    values.push((j % BOMB_POT_MAX_BBS) + 1);
    if (j < flips - 1) {
      durations.push(rollInterval(j));
      t += rollInterval(j);
    }
  }
  const last = Math.max(340, Math.round(1.25 * rollInterval(flips - 1)));
  durations.push(last);
  const fall = Math.round(last / 2);
  const rise = Math.round((last - fall) * 1.5);
  return {
    flips,
    starts,
    values,
    durations,
    hit: t + fall + Math.round(0.74 * rise),
    end: t + fall + rise,
  };
}

/**
 * Знак в окне розыгрыша через t мс от начала перебора: меняется на середине листа (когда новый знак
 * встал наполовину). До первого листа — null (окно пустое), после посадки — выпавшее.
 */
export function rollFace(plan: RollPlan, t: number): number | null {
  let face: number | null = null;
  for (let j = 0; j < plan.flips; j += 1) {
    const mid = (plan.starts[j] ?? 0) + Math.round((plan.durations[j] ?? 0) / 2);
    if (t >= mid) face = plan.values[j] ?? null;
    else break;
  }
  return face;
}

// --- Число на телефонах -----------------------------------------------------------------------

/** Без табло телефон начинает перебор через столько после записи (момент «бомб-пот объявлен»). */
export const PHONE_ROLL_LEAD_MS = 600;

export interface BoardPresenceRead {
  /** Ответа ещё нет (грузится) или запрос упал. */
  missing: boolean;
  /** Отметка табло (seen_at); null — табло этого вечера не открывали. */
  seenAt: string | null;
  /**
   * Ответ получен в этом окне чтения. Отметку табло читаем только в окна бомб-пота (useBombPot), и при
   * новом окне в кеше лежит ответ прошлого: отметка в нём старше минуты, и, пока свежий запрос в пути,
   * телефон считал табло выключенным — начинал свой розыгрыш (живая проверка 26.10.2026: «табло не на
   * связи» на доли секунды при работающем табло, а на медленной сети число встало бы раньше табло).
   */
  current: boolean;
}

/**
 * Табло вечера на связи по ответу board_presence: отметка свежее минуты (nowMs — серверное «сейчас»)
 * — true, старше или её нет — false; ответа нет или он из прошлого окна чтения — null (не известно:
 * телефоны ждут, как с табло).
 */
export function boardOnlineFrom(read: BoardPresenceRead, nowMs: number): boolean | null {
  if (read.missing || !read.current) return null;
  const seen = read.seenAt === null ? Number.NaN : Date.parse(read.seenAt);
  return Number.isFinite(seen) && nowMs - seen <= BOARD_FRESH_MS;
}

export type PhoneBombPhase = 'hidden' | 'rolling' | 'shown';

export interface PhoneBombView {
  /**
   * hidden — «кубик брошен — смотри на табло» (табло на связи, ещё не at + 9 с); rolling — телефон
   * разыгрывает сам (табло не на связи); shown — взнос.
   */
  phase: PhoneBombPhase;
  /** Знак в окне розыгрыша (rolling; null — ещё пусто) или выпавшее (shown). */
  face: number | null;
  /** Когда телефону показать взнос, мс серверного времени (для перерисовки ровно в этот миг). */
  revealAtMs: number;
}

/**
 * Что телефону показать на месте числа (nowMs — серверное «сейчас»). boardOnline: табло вечера на
 * связи (true), не на связи (false), неизвестно (null — отметка ещё грузится: ждём, как с табло).
 * calm — спокойный режим (prefers-reduced-motion): без перебора, число сразу. Черновик (bbs 0) —
 * hidden: кубик бросит сервер.
 */
export function phoneBombView(
  bombPot: Pick<BombPotState, 'at' | 'bbs'>,
  nowMs: number,
  boardOnline: boolean | null,
  calm = false,
): PhoneBombView {
  const at = Date.parse(bombPot.at);
  const revealAtMs = at + BOMB_REVEAL_MS;
  if (bombPot.bbs === 0) return { phase: 'hidden', face: null, revealAtMs };
  if (boardOnline !== false || !Number.isFinite(at)) {
    return isBombPotRevealed(bombPot, nowMs)
      ? { phase: 'shown', face: bombPot.bbs, revealAtMs }
      : { phase: 'hidden', face: null, revealAtMs };
  }
  const plan = rollPlan(bombPot.bbs);
  const t = nowMs - at - PHONE_ROLL_LEAD_MS;
  if (calm || t >= plan.end) return { phase: 'shown', face: bombPot.bbs, revealAtMs: at };
  return {
    phase: 'rolling',
    face: rollFace(plan, t),
    revealAtMs: at + PHONE_ROLL_LEAD_MS + plan.end,
  };
}

/**
 * Лента экрана вечера с тем же мигом показа взноса, что у полосы бомб-пота (решение 10): табло не на
 * связи — взнос разыгрывают телефоны, и лента называет его, когда розыгрыш кончился, а до того пишет
 * «кубик брошен» без «смотри на табло». Табло на связи — как без контекста: at + 9 с. null — не
 * известно: лента как есть.
 */
export function feedWithBombReveal(
  feed: FeedContext,
  boardOnline: boolean | null,
  calm: boolean,
): FeedContext {
  if (boardOnline === null) return feed;
  const nowMs = feed.nowMs;
  return {
    ...feed,
    boardOnline,
    bombShown: (bombPot) =>
      nowMs === null || phoneBombView(bombPot, nowMs, boardOnline, calm).phase === 'shown',
  };
}

// --- Тексты полосы бомб-пота ---------------------------------------------------------------------

/** «3 BB — по 300». */
export function bombStakeText(bombPot: Pick<BombPotState, 'bbs' | 'stake'>): string {
  return `${bombPot.bbs}${NBSP}BB — по${NBSP}${formatNumber(bombPot.stake)}`;
}

/** Номинальный банк: «банк 1 800 · в игре 6» — «взнос × участники», без ставок на улицах. */
export function bombPotText(bombPot: Pick<BombPotState, 'pot' | 'players'>): string {
  return `банк ${formatNumber(bombPot.pot)}${SEP}в${NBSP}игре ${bombPot.players.length}`;
}

/**
 * Первое слово сейчас: снимок на объявлении, а если этот игрок с тех пор вылетел — следующий
 * участник в игре по часовой (порядок участников — от первого слова). null — позиций не было.
 */
export function firstToActNow(
  bombPot: Pick<BombPotState, 'firstToAct' | 'players'>,
  state: Pick<EveningState, 'players'>,
): PlayerId | null {
  const first = bombPot.firstToAct;
  if (first === null) return null;
  const order = bombPot.players;
  const from = Math.max(0, order.indexOf(first));
  for (let k = 0; k < order.length; k += 1) {
    const id = order[(from + k) % order.length];
    if (id !== undefined && state.players[id]?.alive) return id;
  }
  return null;
}

export interface BombPotBar {
  /** Надзаголовок: «Бомб-пот» / «Бомб-пот · переброс». */
  eyebrow: string;
  /** Главная строка: взнос «3 BB — по 300» или «Кубик брошен — смотри на табло». */
  main: string;
  /** Вторая строка: банк, участники, первое слово; до показа — вилка взноса. */
  detail: string | null;
  /** Отменённые броски раздачи (переброс) — отдельной строкой, тише. */
  reroll: string | null;
}

/**
 * Полоса бомб-пота на пульте и у игроков. До показа числа — «Кубик брошен — смотри на табло» и
 * вилка взноса (табло на связи) или «Кубик катится» (розыгрыш на телефоне); после — взнос и банк.
 */
export function bombPotBar(
  bombPot: BombPotState,
  state: Pick<EveningState, 'players'>,
  view: PhoneBombView,
  nameOf: NameOf,
): BombPotBar {
  const eyebrow = bombPot.reroll ? `Бомб-пот${SEP}переброс` : 'Бомб-пот';
  const reroll = bombRerollText(bombPot.previousBbs);
  const range = `взнос от ${formatNumber(BOMB_POT_MIN_BBS * bombPot.bb)} до ${formatNumber(BOMB_POT_MAX_BBS * bombPot.bb)}${SEP}в${NBSP}игре ${bombPot.players.length}`;
  if (view.phase === 'hidden') {
    return { eyebrow, main: 'Кубик брошен — смотри на табло', detail: capitalize(range), reroll };
  }
  if (view.phase === 'rolling') {
    return {
      eyebrow,
      main: 'Кубик катится — табло не на связи',
      detail: capitalize(range),
      reroll,
    };
  }
  const first = firstToActNow(bombPot, state);
  return {
    eyebrow,
    main: bombStakeText(bombPot),
    detail: [capitalize(bombPotText(bombPot)), first ? `первое слово — ${nameOf(first)}` : null]
      .filter(Boolean)
      .join(SEP),
    reroll,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Своя строка игрока в бомб-поте: «У тебя первое слово» (после показа — и взнос), «Твой взнос — 300»;
 * не участник — null. До показа числа взнос не называется.
 */
export function myBombText(
  bombPot: BombPotState,
  state: Pick<EveningState, 'players'>,
  meId: PlayerId | null,
  shown: boolean,
): string | null {
  if (!meId || !bombPot.players.includes(meId)) return null;
  const first = firstToActNow(bombPot, state) === meId;
  const stake = shown ? `Твой взнос — ${formatNumber(bombPot.stake)}` : null;
  if (first)
    return stake ? `У тебя первое слово${SEP}${stake.toLowerCase()}` : 'У тебя первое слово';
  return stake;
}

/**
 * Позиции раздачи в бомб-поте: блайндов нет (взнос их заменяет, решение 4) — «Баттон — Миша ·
 * блайндов нет»; баттона нет — null.
 */
export function bombPositionsText(state: EveningState, nameOf: NameOf): string | null {
  const pos = tablePositions(state);
  if (pos.buttonSeat === null) return null;
  const button = pos.dealer
    ? `Баттон — ${nameOf(pos.dealer.playerId)}`
    : `Баттон — место ${pos.buttonSeat}`;
  return `${button}${SEP}блайндов нет`;
}

// --- Шторка «Бомб-пот» ---------------------------------------------------------------------------

/** На какую раздачу объявить: на эту (после последней «Следующей раздачи») или на следующую. */
export type BombTarget = 'this' | 'next';

export interface BombSheetView {
  /** «BB 100 — взнос от 100 до 500». */
  range: string;
  /** «Платят все в игре: 6». */
  players: string;
  /**
   * На какую раздачу: «Баттон — Миша · первое слово — Вова» — по этой строке банкир видит, нажата ли
   * уже «Следующая раздача». Баттона нет — «Баттон не задан — кто говорит первым, решает стол».
   */
  positions: string;
}

/** Тексты шторки по состоянию, на которое ляжет бросок (для «следующей» — после записи раздачи). */
export function bombSheetView(state: EveningState, nameOf: NameOf): BombSheetView {
  const preview: BombPotPreview = bombPotPreview(state);
  const pos = tablePositions(state);
  const button = pos.dealer
    ? `Баттон — ${nameOf(pos.dealer.playerId)}`
    : pos.buttonSeat !== null
      ? `Баттон — место ${pos.buttonSeat}`
      : null;
  const positions =
    button === null
      ? 'Баттон не задан — кто говорит первым, решает стол.'
      : preview.firstToAct
        ? `${button}${SEP}первое слово — ${nameOf(preview.firstToAct)}`
        : button;
  return {
    range: `BB ${formatNumber(preview.bb)} — взнос от ${formatNumber(preview.minStake)} до ${formatNumber(preview.maxStake)}`,
    players: `Платят все в игре: ${preview.players.length}`,
    positions,
  };
}

/**
 * Добавка к ключу повтора объявления (SendOptions.intentKey): «hand-<id последней принятой раздачи>».
 * payload бомб-пота всегда {}, и ключ неудачной записи (живёт 5 мин) иначе повторился бы в следующей
 * раздаче: сервер вернул бы прежний бомб-пот вместо нового броска. Шторка берёт её при первом
 * нажатии «Следующей» и держит до закрытия: эта запись сама пишет раздачу.
 */
export function bombIntentKey(applied: readonly Pick<EveningEvent, 'id' | 'type'>[]): string {
  let last = 0;
  for (const e of applied) if (e.type === 'hand' && e.id > last) last = e.id;
  return `hand-${last}`;
}

/** Тост объявления: число покажет табло (или телефоны, если табло не на связи). */
export function bombAnnounceToast(boardOnline: boolean | null): ToastText {
  return {
    title: 'Бомб-пот объявлен',
    detail:
      boardOnline === false
        ? 'Табло не на связи — взнос разыграют экраны вечера.'
        : 'Кубик брошен — смотри на табло.',
  };
}

// --- «Кто забрал бомб-пот?» -----------------------------------------------------------------------

export interface BombWinnerChoice {
  playerId: PlayerId;
  /** Победитель олл-ина, доигранного до ривера внутри бомб-пота: главная кнопка ряда. */
  main: boolean;
}

/**
 * Ряд «Кто забрал бомб-пот?»: участники, кто сейчас в игре, по часовой от первого слова; победитель
 * олл-ина — главной кнопкой. Решает всё равно банкир: при побочных банках «победитель» неоднозначен.
 */
export function bombWinnerChoices(state: EveningState): BombWinnerChoice[] {
  const best = new Set(bombPotAllInWinners(state));
  return bombPotWinnerChoices(state).map((playerId) => ({ playerId, main: best.has(playerId) }));
}

/**
 * Делёж, подсказанный олл-ином (несколько равных рук на ривере): режим «Делёж» открывается с ними.
 * Один победитель или олл-ина не было — пусто.
 */
export function bombSplitSuggestion(state: EveningState): PlayerId[] {
  const best = bombPotAllInWinners(state);
  return best.length > 1 ? best : [];
}

/**
 * Тост после «Кто забрал»: «Бомб-пот забирает Костя» / «Бомб-пот делят Костя и Саша» / «Бомб-пот
 * сыгран» (не отмечать); второй строкой — баттон и блайнды следующей раздачи: баттон после бомб-пота
 * стоит (решение 8) — «Баттон остаётся: Миша · SB Вова 50 · BB Лёша 100», игрок на баттоне вылетел —
 * «Баттон — Петя · …» как у «Следующей раздачи». Раздача сменила уровень — ещё строка.
 */
export function bombCloseToast(
  before: EveningState,
  after: EveningState,
  winners: readonly PlayerId[],
  nameOf: NameOf,
): ToastText {
  const names = winners.map(nameOf);
  const title =
    names.length === 0
      ? 'Бомб-пот сыгран'
      : names.length === 1
        ? `Бомб-пот забирает ${names[0]}`
        : `Бомб-пот делят ${joinNames(names)}`;
  const positions = positionsText(tablePositions(after), nameOf, after.currentLevel);
  const stays =
    before.buttonSeat !== null &&
    after.buttonSeat === before.buttonSeat &&
    buttonAfterBombPot(before) === before.buttonSeat;
  const buttonLine =
    positions === null
      ? null
      : stays
        ? positions
            .replace(/^Баттон и SB — /, 'Баттон и SB остаются: ')
            .replace(/^Баттон — /, 'Баттон остаётся: ')
        : positions;
  const level =
    after.timer.levelIndex !== before.timer.levelIndex
      ? `Уровень ${after.timer.levelIndex + 1}: блайнды ${formatBlinds(after.currentLevel)}`
      : null;
  const detail = [buttonLine, level].filter(Boolean).join('. ');
  return { title, detail: detail || null };
}

/**
 * Ряд «Кто забрал», когда отметка уже есть (раздачу, закрывшую бомб-пот, отменили отдельно):
 * «Отмечено: бомб-пот забирает Костя» / «Отмечено: бомб-пот делят Костя и Саша».
 */
export function bombMarkedText(names: readonly string[]): string {
  return names.length > 1
    ? `Отмечено: бомб-пот делят ${joinNames(names)}`
    : `Отмечено: бомб-пот забирает ${names[0] ?? 'игрок'}`;
}

/** Подпись кнопки «Делёж» в режиме выбора: «Записать делёж · 2 игрока». */
export function splitButtonLabel(count: number): string {
  return count < 2
    ? 'Делёж — выбери двоих и больше'
    : `Записать делёж${SEP}${pluralWithNumber(count, ['игрок', 'игрока', 'игроков'])}`;
}
