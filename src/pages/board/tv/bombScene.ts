// Бомб-пот на табло ТВ (миграция 030, решения пользователя 23.10.2026; эталон вида — макет
// tv-bomb/v2 с поправками судей): что и когда показать, где на столе стоят табличка, флоп рубашками
// и банк, откуда летят взносы. Чистые функции (тесты — bombScene.test.ts); DOM и движение —
// bombDirector.ts, исполнение по очереди моментов — TvBoard.
//
// Сцена от одной записи bomb_pot (~9–10 с): объявление флапами «БОМБ-ПОТ» и шкала из пяти равных
// ячеек → розыгрыш (окно листает 1…5 два круга с замедлением и садится на выпавшем — партитура
// rollPlan общая с телефонами) → «ВЗНОС 300» → взносы от мест встают каскадом по часовой от первого
// слова и сходятся к банку одним ударом (не налезают на цифры банка: гаснут до края) → банк флапами →
// табличка «БОМБ-ПОТ» над флопом рубашками и «первое слово» у места → панель уходит, на столе
// остаётся бейдж раздачи. Развязка («Кто забрал»): табличка сама летит к месту забравшего и
// заливается янтарём, в центре — «БОМБ-ПОТ ЗАБИРАЕТ КОСТЯ» (без суммы: итогового банка приложение не
// знает), потом метки SB и BB встают на те же места — баттон после бомб-пота стоит.
import {
  BOMB_POT_MAX_BBS,
  type BombPotState,
  type EveningState,
  type PlayerId,
} from '@domain/types.ts';
import { formatNumber, NBSP } from '../../../shared/lib/format';
import { bombRerollText } from '../../evening/lib';
import { rollPlan } from '../../evening/bombPotView';
import {
  MARKER_H,
  NAME_H,
  seatLabels,
  seatPoint,
  STACK_H,
  STACK_W,
  stackTop,
  TABLE,
  TABLE_CX,
  TABLE_CY,
} from './tableLayout';

/**
 * Запись старше, когда табло её увидело, — сцены нет, сразу бейдж раздачи (табло открыли посреди
 * бомб-пота, табло было без связи): то же правило свежести, что у раскрытия улиц и голоса.
 */
export const BOMB_SCENE_FRESH_MS = 10_000;
/** Сцена ждала в очереди (нокаут, возврат из олл-ина) дольше — уже не розыгрыш, а бейдж. */
export const BOMB_START_MAX_MS = 30_000;

// --- Геометрия стола (px кадра 1920×1080) ------------------------------------------------------

/** Табличка «БОМБ-ПОТ» над флопом: 8 плиток, кегль 40 (с дивана читается, замечание судей к v2). */
export const TAG = { w: 34, h: 46, fs: 40, gap: 3 } as const;
export const TAG_W = 8 * TAG.w + 7 * TAG.gap;
/** Флоп рубашками: три карты. */
export const CARD = { w: 88, h: 124, gap: 12 } as const;
export const CARDS_W = 3 * CARD.w + 2 * CARD.gap;
/** Банк флапами (счётчик) и строка «по 300 × 6» под ним. */
export const POT = { w: 54, h: 76, fs: 68, gap: 5 } as const;
export const FORM_H = 26;
/** Зазоры столбца: табличка — флоп — банк не ближе 24 px (замечание судей к v2). */
export const COLUMN_GAP = 24;
const FORM_GAP = 10;
/** Столбец не ближе к метке баттона и кромке сукна. */
const EDGE_GAP = 16;
const MARKER_GAP = 22;

export const COLUMN_H = TAG.h + COLUMN_GAP + CARD.h + COLUMN_GAP + POT.h + FORM_GAP + FORM_H;

export interface BombColumn {
  /** Левый верх таблички. */
  tag: { x: number; y: number };
  /** Левый верх первой карты флопа. */
  cards: { x: number; y: number };
  /** Верх банка (центр по оси стола). */
  potY: number;
  /** Верх строки «по 300 × 6». */
  formY: number;
}

/**
 * Столбец бейджа раздачи в центре стола: табличка, флоп рубашками, банк, «по 300 × 6». Метка
 * баттона на ближнем или дальнем крае по оси стола (места 10 и 5) — столбец уходит от неё; остальные
 * метки по ширине столбец не задевают (SB и BB в бомб-поте погашены).
 */
export function bombColumn(dSeat: number | null): BombColumn {
  let top = Math.round(TABLE_CY - COLUMN_H / 2);
  if (dSeat === 5) top = TABLE.y0 + 22 + MARKER_H + MARKER_GAP;
  if (dSeat === 10) top = TABLE.y1 - 22 - MARKER_H - MARKER_GAP - COLUMN_H;
  const cardsY = top + TAG.h + COLUMN_GAP;
  const potY = cardsY + CARD.h + COLUMN_GAP;
  return {
    tag: { x: Math.round(TABLE_CX - TAG_W / 2), y: top },
    cards: { x: Math.round(TABLE_CX - CARDS_W / 2), y: cardsY },
    potY,
    formY: potY + POT.h + FORM_GAP,
  };
}

/** Столбец не выходит за сукно с запасом EDGE_GAP (проверка раскладки — в тестах). */
export function columnInsideFelt(c: BombColumn): boolean {
  return c.tag.y >= TABLE.y0 + EDGE_GAP && c.formY + FORM_H <= TABLE.y1 - EDGE_GAP;
}

/** Ширина ряда флапов банка: плитки и узкие пробелы разрядов (0,3 плитки), зазор POT.gap. */
export function potRowWidth(text: string): number {
  const chars = [...text];
  const narrow = chars.filter((c) => c === NBSP || c === ' ' || c === ' ').length;
  const tiles = chars.length - narrow;
  return tiles * POT.w + narrow * Math.round(POT.w * 0.3) + POT.gap * (chars.length - 1);
}

/** Гнездо стека у места (там встаёт «ВЫЛЕТ», сюда же — «первое слово» и взнос). */
export interface Nest {
  x: number;
  y: number;
  w: number;
  h: number;
  justify: 'center' | 'flex-end' | 'flex-start';
}

export function seatNest(seat: number): Nest {
  const L = seatLabels(seat);
  return {
    x: L.stack.x,
    y: stackTop(L.side, L.stack.y, NAME_H),
    w: STACK_W,
    h: STACK_H,
    justify: L.stack.justify,
  };
}

/** Левый верх блока шириной w и высотой h в гнезде места: прижат, как гнездо (к столу у торцов). */
export function inNest(seat: number, w: number, h: number): [number, number] {
  const n = seatNest(seat);
  const x =
    n.justify === 'center' ? n.x + (n.w - w) / 2 : n.justify === 'flex-end' ? n.x + n.w - w : n.x;
  return [Math.round(x), Math.round(n.y + (n.h - h) / 2)];
}

/**
 * Взнос игрока без места летит отсюда (левый нижний угол под столом): мест у него нет, но он за
 * столом и платит.
 */
export const UNSEATED_ORIGIN: [number, number] = [TABLE.x0 - 96, TABLE.y1 + 24];

/**
 * Куда долетает взнос: точка на луче от взноса к центру банка, где луч входит в прямоугольник банка,
 * раздвинутый на margin, — взнос гаснет до цифр банка и не ложится на них (замечание судей к v2).
 */
export function stakeTarget(
  from: [number, number],
  pot: { x: number; y: number; w: number; h: number },
  margin = 40,
): [number, number] {
  const cx = pot.x + pot.w / 2;
  const cy = pot.y + pot.h / 2;
  const dx = cx - from[0];
  const dy = cy - from[1];
  const hw = pot.w / 2 + margin;
  const hh = pot.h / 2 + margin;
  // Доля пути от центра наружу до кромки прямоугольника по этому лучу.
  const t = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );
  if (!Number.isFinite(t) || t >= 1) return [Math.round(from[0]), Math.round(from[1])];
  return [Math.round(cx - dx * t), Math.round(cy - dy * t)];
}

// --- Тексты сцены -------------------------------------------------------------------------------

/** Строка под заголовком до броска: «Взнос — случайно, от 1 до 5 BB»; переброс — с отменённым. */
export function oddsText(bombPot: Pick<BombPotState, 'previousBbs'>): {
  text: string;
  /** Отменённые броски (переброс) — тише и зачёркнуты: они не спорят с выпавшим. */
  struck: string | null;
} {
  const reroll = bombRerollText(bombPot.previousBbs);
  if (!reroll) return { text: `Взнос — случайно, от 1 до ${BOMB_POT_MAX_BBS} BB`, struck: null };
  const prev = bombPot.previousBbs.map((b) => `${b}${NBSP}BB`).join(', ');
  return { text: 'Переброс · отменён бросок', struck: prev };
}

/** «по 300 × 6» — банк номинальный: взнос × участники. */
export function formText(bombPot: Pick<BombPotState, 'stake' | 'players'>): string {
  return `по${NBSP}${formatNumber(bombPot.stake)} × ${bombPot.players.length}`;
}

/** Взнос флапами: ширина ряда — по наибольшему взносу уровня (5 BB), число прижато вправо. */
export function stakeFlapText(bombPot: Pick<BombPotState, 'stake' | 'bb'>): string {
  const max = formatNumber(BOMB_POT_MAX_BBS * bombPot.bb);
  const text = formatNumber(bombPot.stake);
  return text.padStart([...max].length, ' ');
}

/** Ячейки шкалы: «1 BB · 100» … «5 BB · 500» — исходов пять, и они равны. */
export function scaleCells(bb: number): { k: number; value: string }[] {
  return Array.from({ length: BOMB_POT_MAX_BBS }, (_, i) => ({
    k: i + 1,
    value: formatNumber((i + 1) * bb),
  }));
}

/** Подпись развязки: «забирает» и имя; делёж — «делят» и имена через «и». */
export function resultCaption(names: readonly string[]): { verb: string; names: string } | null {
  if (names.length === 0) return null;
  if (names.length === 1) return { verb: 'Бомб-пот забирает', names: names[0] ?? '' };
  return {
    verb: 'Бомб-пот делят',
    names: `${names.slice(0, -1).join(', ')} и ${names[names.length - 1] ?? ''}`,
  };
}

// --- Партитура сцены ----------------------------------------------------------------------------

/** Такты сцены объявления, мс от начала (табло увидело запись). */
export interface SceneBeats {
  /** «Бомб-пот!» голосом. */
  voiceBomb: number;
  /** Начало перебора (шкала и окно уже стоят). */
  rollStart: number;
  /** Удар: выпавшее встало (тяжёлая посадка). */
  hit: number;
  /** «Взнос — три больших блайнда.» голосом — после удара. */
  voiceStake: number;
  /** «ВЗНОС 300» — второй шаг раскрытия. */
  stake: number;
  /** Панель отдаёт взгляд столу: взносы встают у мест. */
  stakes: number;
  /** Взносы сошлись к банку, банк перелистывается на итог. */
  converge: number;
  /** Табличка «БОМБ-ПОТ» над флопом. */
  tag: number;
  /** Флоп рубашками и «первое слово» у места. */
  flop: number;
  /** Панель уходит, часы возвращаются. */
  exit: number;
  /** Сцена кончилась: на столе бейдж раздачи. */
  end: number;
}

/** Шаг каскада взносов по часовой, выдержка у мест и полёт к банку (одно схождение). */
export const STAKE_STEP = 60;
export const STAKE_UP = 180;
export const STAKE_HOLD = 200;
export const STAKE_FLY = 480;

/**
 * Темп сцены объявления: вступление до перебора (линейка, «БОМБ-ПОТ», шкала) и круги перебора. Полный —
 * 1,2 с и два круга; короче — когда сцена ждала в очереди и иначе показала бы число позже телефонов.
 */
export interface ScenePace {
  rollStart: number;
  laps: number;
}

/** Темпы от полного к самому короткому (один круг перебора ещё держит интригу, ноль — уже нет). */
export const SCENE_PACES: readonly ScenePace[] = [
  { rollStart: 1200, laps: 2 },
  { rollStart: 800, laps: 1 },
  { rollStart: 500, laps: 1 },
  { rollStart: 300, laps: 0 },
];
export const FULL_PACE: ScenePace = { rollStart: 1200, laps: 2 };

/** Запас между ударом на табло и показом взноса на телефонах (сеть, кадр, часы). */
export const REVEAL_MARGIN_MS = 600;

/** Удар от начала перебора: два прохода по шкале в спокойном режиме — по 300 мс на ячейку. */
function hitFromRoll(bbs: number, calm: boolean, laps: number): number {
  return calm ? bbs * 300 + 200 : rollPlan(bbs, laps).hit;
}

/**
 * Темп сцены, чтобы табло показало взнос раньше телефонов (решение 10: телефоны открывают его в
 * at + BOMB_REVEAL_MS). budgetMs — сколько от старта сцены до этого мига. Сцена, которая ждала в
 * очереди (нокаут, заставка уровня, «ОТМЕНЁН»), сокращает вступление и круги перебора: самый полный
 * темп, при котором удар успевает с запасом REVEAL_MARGIN_MS; не успевает и самый короткий — он
 * (опоздание меньше всего).
 */
export function scenePace(bbs: number, budgetMs: number, calm: boolean): ScenePace {
  for (const pace of SCENE_PACES) {
    if (pace.rollStart + hitFromRoll(bbs, calm, pace.laps) + REVEAL_MARGIN_MS <= budgetMs)
      return pace;
  }
  return SCENE_PACES[SCENE_PACES.length - 1] ?? FULL_PACE;
}

export function sceneBeats(
  bbs: number,
  participants: number,
  calm: boolean,
  pace: ScenePace = FULL_PACE,
): SceneBeats {
  const rollStart = pace.rollStart;
  const hit = rollStart + hitFromRoll(bbs, calm, pace.laps);
  const stake = hit + 420;
  const stakes = hit + 1600;
  const cascade = Math.max(0, participants - 1) * STAKE_STEP + STAKE_UP + STAKE_HOLD;
  const converge = calm ? stakes + 1100 : stakes + cascade + STAKE_FLY;
  const tag = converge + 160;
  const flop = tag + 560;
  const exit = flop + 1700;
  return {
    voiceBomb: Math.min(300, Math.round(rollStart / 4)),
    rollStart,
    hit,
    voiceStake: hit + 200,
    stake,
    stakes,
    converge,
    tag,
    flop,
    exit,
    end: exit + 640,
  };
}

/** Развязка: табличка летит к месту забравшего; release — метки SB и BB встают, «в игре» в центре. */
export const RESULT = {
  lift: 150,
  fly: 300,
  flyMs: 700,
  land: 1000,
  captionOut: 3400,
  release: 3600,
  done: 4200,
  /** Табличка у места складывается, «баттон остаётся» гаснет. */
  fold: 7000,
} as const;

/** Отмена: «ОТМЕНЁН» стоит, потом всё уходит. */
export const CANCEL = { hold: 2000, done: 2600 } as const;

// --- Что сейчас на столе ------------------------------------------------------------------------

/** Участники с местами (откуда взнос) по порядку бомб-пота и сколько без места. */
export function stakeSeats(bombPot: Pick<BombPotState, 'players' | 'seating'>): {
  seats: { playerId: PlayerId; seat: number }[];
  unseated: PlayerId[];
} {
  const seats: { playerId: PlayerId; seat: number }[] = [];
  const unseated: PlayerId[] = [];
  for (const id of bombPot.players) {
    const seat = bombPot.seating.seats[id] ?? null;
    if (seat !== null && isSeat(seat)) seats.push({ playerId: id, seat });
    else unseated.push(id);
  }
  return { seats, unseated };
}

function isSeat(seat: number): boolean {
  try {
    seatPoint(seat);
    return true;
  } catch {
    return false;
  }
}

/** Место игрока сейчас (пересел после объявления — к новому месту) или null. */
export function seatNow(state: Pick<EveningState, 'players'>, playerId: PlayerId): number | null {
  const seat = state.players[playerId]?.seat ?? null;
  return seat !== null && isSeat(seat) ? seat : null;
}
