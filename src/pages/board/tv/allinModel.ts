// Олл-ин на табло ТВ (макет доработки v3): раскладка по числу рук и что показать у каждой руки на
// улице — проценты, лидер, ауты с погасшими, подписи следующей карты, развязка. Чистые функции
// (тесты — allinModel.test.ts); шансы и ауты считает движок олл-ина (useShowdownAnalysis), здесь —
// только раскладка посчитанного.
//
// Раскладка: 2–4 руки — колонками в один ряд (размеры — как в макете: на двоих карты и проценты
// крупнее, на четверых мельче, но не мельче прода), 5–9 — плотная сетка в два ряда (3, 4 или 5
// колонок), борд и карты меньше, ауты — не мельче прода. Стол (борд) — главный объект сверху.
import { streetOf, type Street } from '@domain/showdown.ts';
import type { ShowdownHand } from '@domain/types.ts';
import { plural } from '../../../shared/lib/format';
import { roundShares, type ShowdownAnalysis } from '../../../shared/lib/poker/analysis';
import {
  parseCard,
  rankLabel,
  RANKS,
  suitOfCode,
  type SuitCode,
} from '../../../shared/lib/poker/cards';
import { evaluate } from '../../../shared/lib/poker/evaluator';

export const BOARD_SLOT_LABELS = ['флоп', 'флоп', 'флоп', 'тёрн', 'ривер'] as const;

/** Слово улицы флапами: «ДО ФЛОПА», «ФЛОП», «ТЁРН», «РИВЕР». */
export const STREET_WORD: Readonly<Record<Street, string>> = {
  preflop: 'ДО ФЛОПА',
  flop: 'ФЛОП',
  turn: 'ТЁРН',
  river: 'РИВЕР',
};

/** Нижняя безопасная линия кадра: ниже неё — только служебное. */
export const SAFE_BOTTOM = 1026;
/** Левый край колонок и ширина поля (поля 96 px — безопасная зона 5 %). */
const LEFT = 96;
const FIELD = 1728;

export interface BoardGeometry {
  y: number;
  w: number;
  h: number;
  xs: number[];
}

/** Отступы внутри руки (сверху вниз): до имени, до карт, до полосы, до аутов, до плашек, до подписи. */
export interface HandPads {
  name: number;
  cards: number;
  bar: number;
  outs: number;
  plates: number;
  cap: number;
}

export interface AllinLayout {
  n: number;
  /** Рук в каждом ряду. */
  perRow: number[];
  gap: number;
  colW: number;
  /** Карта руки и зазор между картами. */
  cw: number;
  ch: number;
  cg: number;
  /** Кегли: имя, процент, число аутов, плашка (кегль ранга), подпись, статус, итог руки, рука словами. */
  name: number;
  pct: number;
  cnt: number;
  chip: number;
  /** Подпись к числу аутов («аутов», «· на делёж 2»). */
  ol: number;
  /**
   * Высота плашки и сколько строк плашек держит колонка. Одна строка — плашки, которые в неё не
   * помещаются, мельчают до ширины колонки (AllinHand, Plates); две — переносятся на вторую.
   */
  ph: number;
  plateLines: number;
  /** Число аутов и плашки одной строкой (на двоих — колонки широкие). */
  inline: boolean;
  cap: number;
  st: number;
  fin: number;
  made: number;
  /** На четверых и больше итог по банку — строкой аутов, по левому краю. */
  stackRes: boolean;
  pads: HandPads;
  board: BoardGeometry;
  /** Верх первого ряда рук и шаг рядов. */
  top: number;
  rowStep: number;
  /** До флопа блок рук опущен так, чтобы поля над и под ним были равны. */
  shift: number;
  /** Слово улицы флапами: плитка и кегль (у плотной сетки борд ниже — слово мельче). */
  street: { w: number; h: number; fs: number };
}

/** Смещения внутри руки от верха её ряда. */
export interface HandY {
  name: number;
  cards: number;
  cardsB: number;
  bar: number;
  oh: number;
  plates: number;
  cap: number;
  bottom: number;
}

const WIDE_BOARD: BoardGeometry = { y: 72, w: 200, h: 280, xs: [688, 908, 1128, 1376, 1624] };

function narrowBoard(w: number, h: number, y: number): BoardGeometry {
  // Пять гнёзд прижаты к правому краю поля: флоп через 20 px, тёрн и ривер — через 48.
  const total = 5 * w + 2 * 20 + 2 * 48;
  const x0 = LEFT + FIELD - total;
  const xs = [x0, x0 + w + 20, x0 + 2 * (w + 20), x0 + 3 * w + 40 + 48, x0 + 4 * w + 40 + 96];
  return { y, w, h, xs };
}

const MOCK_PADS: HandPads = { name: 24, cards: 28, bar: 24, outs: 28, plates: 14, cap: 22 };
const DENSE_PADS: HandPads = { name: 14, cards: 14, bar: 12, outs: 14, plates: 8, cap: 12 };

type Spec = Omit<
  AllinLayout,
  'n' | 'perRow' | 'colW' | 'board' | 'top' | 'rowStep' | 'shift' | 'pads' | 'street'
> & {
  perRow: number[];
};

// Подписи аутов («аутов», «Впереди», «устоит / догонит на тёрне», «Аутов нет») — не мельче прода:
// --sd-outs-text в showdown.css при 1920×1080 — 27 px у 2–3 рук, 25 у 4, 24 у 5–9; рука словами —
// не мельче --sd-text (22 px у 2–4, 20 у 5–9). Тест — allinModel.test.ts.
const SPECS: Record<number, Spec> = {
  // Макет v3: на двоих колонки широкие — число аутов и плашки одной строкой.
  2: {
    perRow: [2],
    gap: 64,
    cw: 180,
    ch: 252,
    cg: 12,
    name: 60,
    pct: 200,
    cnt: 72,
    ol: 28,
    chip: 46,
    ph: 70,
    plateLines: 1,
    inline: true,
    cap: 27,
    st: 27,
    fin: 56,
    made: 24,
    stackRes: false,
  },
  3: {
    perRow: [3],
    gap: 48,
    cw: 150,
    ch: 210,
    cg: 10,
    name: 52,
    pct: 136,
    cnt: 66,
    ol: 27,
    chip: 44,
    ph: 66,
    plateLines: 1,
    inline: false,
    cap: 27,
    st: 27,
    fin: 48,
    made: 24,
    stackRes: false,
  },
  // На четверых колонка узкая: итог по банку — строкой аутов, итог руки — ниже.
  4: {
    perRow: [4],
    gap: 40,
    cw: 114,
    ch: 160,
    cg: 8,
    name: 44,
    pct: 88,
    cnt: 58,
    ol: 25,
    chip: 36,
    ph: 56,
    plateLines: 1,
    inline: false,
    cap: 25,
    st: 25,
    fin: 36,
    made: 22,
    stackRes: true,
  },
  // Плотная сетка (прод: 5–6 — по три, 7–8 — по четыре, 9 — пять и четыре). Карты, проценты,
  // ауты и плашки — не мельче прода (5–6: карта 76, процент 65, ауты 56, плашка 30; 7–9: карта
  // 54–60, процент 50–58, плашка 24 px кадра).
  5: {
    perRow: [3, 2],
    gap: 40,
    cw: 84,
    ch: 118,
    cg: 8,
    name: 36,
    pct: 84,
    cnt: 56,
    ol: 24,
    chip: 30,
    ph: 46,
    plateLines: 1,
    inline: false,
    cap: 24,
    st: 24,
    fin: 32,
    made: 20,
    stackRes: true,
  },
  6: {
    perRow: [3, 3],
    gap: 40,
    cw: 84,
    ch: 118,
    cg: 8,
    name: 36,
    pct: 84,
    cnt: 56,
    ol: 24,
    chip: 30,
    ph: 46,
    plateLines: 1,
    inline: false,
    cap: 24,
    st: 24,
    fin: 32,
    made: 20,
    stackRes: true,
  },
  7: {
    perRow: [4, 3],
    gap: 32,
    cw: 72,
    ch: 101,
    cg: 8,
    name: 32,
    pct: 72,
    cnt: 40,
    ol: 24,
    chip: 26,
    ph: 38,
    plateLines: 2,
    inline: false,
    cap: 24,
    st: 24,
    fin: 28,
    made: 20,
    stackRes: true,
  },
  8: {
    perRow: [4, 4],
    gap: 32,
    cw: 72,
    ch: 101,
    cg: 8,
    name: 32,
    pct: 72,
    cnt: 40,
    ol: 24,
    chip: 26,
    ph: 38,
    plateLines: 2,
    inline: false,
    cap: 24,
    st: 24,
    fin: 28,
    made: 20,
    stackRes: true,
  },
  9: {
    perRow: [5, 4],
    gap: 24,
    cw: 62,
    ch: 87,
    cg: 6,
    name: 28,
    pct: 60,
    cnt: 36,
    ol: 24,
    chip: 26,
    ph: 40,
    plateLines: 2,
    inline: false,
    cap: 24,
    st: 24,
    fin: 24,
    made: 20,
    stackRes: true,
  },
};

/** Смещения внутри руки по раскладке. */
export function handY(
  L: Pick<AllinLayout, 'name' | 'ch' | 'cnt' | 'ph' | 'plateLines' | 'inline' | 'cap' | 'pads'>,
): HandY {
  const p = L.pads;
  const name = p.name;
  const cards = name + L.name + p.cards;
  const cardsB = cards + L.ch;
  const bar = cardsB + p.bar;
  const oh = bar + 8 + p.outs;
  const plates = oh + L.cnt + p.plates;
  const platesH = L.ph * L.plateLines + 10 * (L.plateLines - 1);
  const cap = L.inline ? oh + L.cnt + p.cap : plates + platesH + p.cap;
  return { name, cards, cardsB, bar, oh, plates, cap, bottom: cap + L.cap };
}

export function allinLayout(hands: number): AllinLayout {
  const n = Math.min(9, Math.max(2, Math.round(hands)));
  const spec = SPECS[n] ?? (SPECS[2] as Spec);
  const dense = n >= 5;
  const board = dense ? narrowBoard(120, 168, 64) : WIDE_BOARD;
  const pads = dense ? DENSE_PADS : MOCK_PADS;
  const top = dense ? board.y + board.h + 44 : 424;
  const cols = Math.max(...spec.perRow);
  const colW = (FIELD - (cols - 1) * spec.gap) / cols;
  const y = handY({ ...spec, pads });
  const rowStep = y.bottom + 20;
  const rows = spec.perRow.length;
  const blockBottom = top + (rows - 1) * rowStep + y.bar + 8;
  const boardBottom = board.y + board.h;
  const shift = Math.max(0, Math.round((boardBottom + SAFE_BOTTOM) / 2 - (top + blockBottom) / 2));
  const street = dense ? { w: 34, h: 62, fs: 56 } : { w: 44, h: 80, fs: 72 };
  return { ...spec, n, colW, board, pads, top, rowStep, shift, street };
}

/** Где стоит рука i: левый край колонки и верх её ряда. */
export function handSlot(L: AllinLayout, i: number): { x: number; y: number; row: number } {
  let row = 0;
  let k = i;
  while (row < L.perRow.length - 1 && k >= (L.perRow[row] ?? 0)) {
    k -= L.perRow[row] ?? 0;
    row += 1;
  }
  return { x: LEFT + k * (L.colW + L.gap), y: L.top + row * L.rowStep, row };
}

// --- Рука словами до флопа ------------------------------------------------------------------------

const RANK_NOM = [
  'двойка',
  'тройка',
  'четвёрка',
  'пятёрка',
  'шестёрка',
  'семёрка',
  'восьмёрка',
  'девятка',
  'десятка',
  'валет',
  'дама',
  'король',
  'туз',
];
const RANK_GEN_PL = [
  'двоек',
  'троек',
  'четвёрок',
  'пятёрок',
  'шестёрок',
  'семёрок',
  'восьмёрок',
  'девяток',
  'десяток',
  'валетов',
  'дам',
  'королей',
  'тузов',
];

/** Карманные карты словами до флопа: «Пара дам», «Туз-король» (старшая первой). */
export function holeCardsText(cards: readonly string[]): string {
  const ranks = cards
    .map((c) => RANKS.indexOf(c.charAt(0)))
    .filter((r) => r >= 0)
    .sort((a, b) => b - a);
  const [a, b] = ranks;
  if (a === undefined || b === undefined) return '';
  if (a === b) return `Пара ${RANK_GEN_PL[a]}`;
  const head = RANK_NOM[a] ?? '';
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}-${RANK_NOM[b]}`;
}

// --- Рука на улице --------------------------------------------------------------------------------

export interface RankChip {
  /** Карта аута ('Js') — для подчёркивания сработавшего на ривере. */
  code: string;
  /** Ранг на экране: «10», «J». */
  rank: string;
  /** Аут с прошлой улицы, который на этой улице больше не аут — гаснет на месте. */
  dead: boolean;
}

export interface SuitPlate {
  suit: SuitCode;
  ranks: RankChip[];
}

export interface OutsView {
  /** Сколько аутов сейчас (с аутами на делёж). */
  count: number;
  /** «аут», «аута», «аутов». */
  word: string;
  plates: SuitPlate[];
  /** Аутов на делёж — подписью «на делёж: 2». */
  split: number;
}

/**
 * Итог руки на ривере: win/split — банк плашкой; out — вылетела в этой раздаче (место и флап
 * «ВЫЛЕТ»); stay — проиграла, а банкир ответил, что фишек хватило («остаётся в игре»); lose —
 * проиграла, ответа банкира ещё нет (без подписи).
 */
export type ResultKind = 'win' | 'split' | 'lose' | 'out' | 'stay';

export interface HandResult {
  kind: ResultKind;
  /** Банк плашкой: «Весь банк» / «Лучшая рука» / «Делёж банка». */
  pot: string | null;
  /** Подпись над банком: «удвоение» — на двоих, когда проигравший остался в игре. */
  note?: string;
}

export interface HandView {
  playerId: string;
  cards: readonly [string, string];
  /** Целый процент шансов; null — шансы ещё считаются. */
  pct: number | null;
  /** Рука словами: до флопа — карты («Пара дам»), дальше — комбинация. */
  made: string;
  /** Подсвеченный лидер (отрыв от 5 п. п.; на ривере — победитель). */
  lead: boolean;
  /** «Впереди» вместо аутов. */
  ahead: boolean;
  outs: OutsView | null;
  /** Аутов нет: «Аутов к тёрну нет» / «Аутов нет». */
  noOuts: string | null;
  /** Подпись следующей карты (только флоп): [подпись, число]. */
  caption: [string, string] | null;
  result: HandResult | null;
}

/** Лидер подсвечивается только при отрыве от 5 п. п. (41 против 40 — не лидер). */
export const LEAD_GAP = 5;

export function outsWord(n: number): string {
  return plural(n, ['аут', 'аута', 'аутов']);
}

const SUIT_ORDER: readonly SuitCode[] = ['s', 'h', 'd', 'c'];

/**
 * Плашки аутов по мастям: сейчас — живые, с прошлой улицы — погасшие (кроме открытой карты). Ранги
 * в плашке — от туза вниз.
 */
export function outsPlates(
  current: readonly string[],
  previous: readonly string[],
  dealt: readonly string[],
): SuitPlate[] {
  const now = new Set(current);
  const all = new Set<string>(current);
  for (const c of previous) if (!dealt.includes(c)) all.add(c);
  return SUIT_ORDER.map((suit) => ({
    suit,
    ranks: [...all]
      .filter((c) => suitOfCode(c) === suit)
      .sort((a, b) => RANKS.indexOf(b.charAt(0)) - RANKS.indexOf(a.charAt(0)))
      .map((code) => ({ code, rank: rankLabel(code.charAt(0)), dead: !now.has(code) })),
  })).filter((p) => p.ranks.length > 0);
}

export interface StreetInput {
  hands: readonly ShowdownHand[];
  board: readonly string[];
  analysis: ShowdownAnalysis | null;
  /** Ауты каждой руки на прошлой улице (флоп — для тёрна), по playerId. */
  previousOuts: ReadonlyMap<string, readonly string[]>;
  /** Участники раздачи, вылетевшие после её открытия. */
  busted: ReadonlySet<string>;
  /**
   * Проигравшие, о которых банкир ответил «остаётся за столом» (раздача закрыта на ривере, см.
   * closedAtRiver); пока ответа нет — пусто, и проигравшие без подписи.
   */
  stayed?: ReadonlySet<string>;
}

const NO_ONE: ReadonlySet<string> = new Set();

/** Что показать у каждой руки на этой улице. */
export function handViews(input: StreetInput): HandView[] {
  const { hands, board, analysis, previousOuts, busted } = input;
  const stayed = input.stayed ?? NO_ONE;
  const street = streetOf(board.length);
  const players = analysis?.players ?? null;
  const shares = players ? roundShares(players.map((p) => p.equity)) : null;
  const sorted = shares ? [...shares].sort((a, b) => b - a) : [];
  const top = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const leadShare = top !== null && second !== null && top - second >= LEAD_GAP ? top : null;
  const winners = analysis?.winners ?? null;
  const anyAhead = players?.some((p) => p.ahead) ?? false;
  const allAhead = players?.every((p) => p.ahead) ?? false;
  const dealt = board.slice(-1);

  return hands.map((h, i): HandView => {
    const p = players?.[i] ?? null;
    const share = shares?.[i] ?? null;
    const made = street === 'preflop' ? holeCardsText(h.cards) : (p?.hand ?? '');
    let result: HandResult | null = null;
    if (winners) {
      const win = winners.includes(i);
      // На двоих проигравший остался в игре — его стек покрывал: победитель удвоился.
      const doubled = hands.length === 2 && hands.some((x, k) => k !== i && stayed.has(x.playerId));
      result = win
        ? winners.length > 1
          ? { kind: 'split', pot: 'Делёж банка' }
          : hands.length === 2
            ? doubled
              ? { kind: 'win', pot: 'Весь банк', note: 'удвоение' }
              : { kind: 'win', pot: 'Весь банк' }
            : { kind: 'win', pot: 'Лучшая рука' }
        : busted.has(h.playerId)
          ? { kind: 'out', pot: null }
          : stayed.has(h.playerId)
            ? { kind: 'stay', pot: null }
            : { kind: 'lose', pot: null };
    }
    const behind = p !== null && !p.ahead && (street === 'flop' || street === 'turn');
    const o = behind ? p.outs : null;
    const count = o ? o.outs.length + o.splitOuts.length : 0;
    const outs: OutsView | null =
      o && count > 0
        ? {
            count,
            word: outsWord(count),
            plates: outsPlates(
              [...o.outs, ...o.splitOuts],
              street === 'turn' ? (previousOuts.get(h.playerId) ?? []) : [],
              dealt,
            ),
            split: o.splitOuts.length,
          }
        : null;
    const ahead = Boolean(p?.ahead) && anyAhead && !allAhead && winners === null;
    let caption: [string, string] | null = null;
    if (street === 'flop' && p && analysis) {
      if (outs && o) caption = ['догонит на тёрне', `${Math.round(o.hitPct)} %`];
      else if (ahead && p.holds !== null)
        caption = ['устоит на тёрне', `${p.holds} из ${analysis.unseen}`];
    }
    return {
      playerId: h.playerId,
      cards: h.cards,
      pct: share,
      made,
      lead: winners
        ? winners.includes(i) && winners.length === 1
        : leadShare !== null && share === leadShare,
      ahead,
      outs,
      noOuts:
        behind && count === 0 ? (street === 'flop' ? 'Аутов к тёрну нет' : 'Аутов нет') : null,
      caption,
      result,
    };
  });
}

/** Ауты каждой руки на улице (для погасших на следующей). */
export function outsByPlayer(
  hands: readonly ShowdownHand[],
  analysis: ShowdownAnalysis | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  hands.forEach((h, i) => {
    const o = analysis?.players[i]?.outs;
    if (o) out.set(h.playerId, [...o.outs, ...o.splitOuts]);
  });
  return out;
}

/** Чей аут сработал на ривере: playerId → карта ривера (была в его аутах на тёрне). */
export function riverHits(
  previousOuts: ReadonlyMap<string, readonly string[]>,
  board: readonly string[],
): Map<string, string> {
  const river = board[4];
  const hits = new Map<string, string>();
  if (!river) return hits;
  for (const [id, codes] of previousOuts) if (codes.includes(river)) hits.set(id, river);
  return hits;
}

/**
 * Карты, из которых собрана лучшая рука на ривере (пять из семи): индексы карт стола и руки — их
 * табло подчёркивает у победителя. Равных пятёрок бывает несколько — берётся первая по порядку.
 */
export function winningCards(
  hole: readonly string[],
  board: readonly string[],
): { board: number[]; hole: number[] } | null {
  if (board.length !== 5 || hole.length !== 2) return null;
  const all = [...board, ...hole].map((c) => parseCard(c));
  const best = evaluate(all);
  const idx = [0, 1, 2, 3, 4, 5, 6];
  for (let a = 0; a < 7; a += 1) {
    for (let b = a + 1; b < 7; b += 1) {
      const five = idx.filter((i) => i !== a && i !== b);
      if (evaluate(five.map((i) => all[i] as number)) !== best) continue;
      return {
        board: five.filter((i) => i < 5),
        hole: five.filter((i) => i >= 5).map((i) => i - 5),
      };
    }
  }
  return null;
}

/**
 * Рука словами короче — для узкой колонки табло (как в макете v3: «Старший туз», «Две пары»):
 * колонка сначала пробует полный текст домена, не помещается — короткий, потом мельче.
 */
export function shortHandText(text: string): string {
  const high = /^Старшая карта: (.+)$/.exec(text);
  if (high) {
    const rank = high[1] ?? '';
    // Туз, король, валет — мужского рода; дама и «-ка» (десятка … двойка) — женского.
    return `${/[ая]$/.test(rank) ? 'Старшая' : 'Старший'} ${rank}`;
  }
  const head = /^(Две пары|Фулл-хаус): /.exec(text);
  return head ? (head[1] ?? text) : text;
}

/** Зазор между картами руки и цифрой шансов, px кадра. */
export const PCT_GAP = 24;

/**
 * Ширина итога руки справа от карт (2–3 руки, итог не строкой): от края карт — 32 px воздуха.
 * На 4+ руках итог стоит строкой аутов (stackRes) — там ширина колонки.
 */
export function resultWidth(L: Pick<AllinLayout, 'colW' | 'cw' | 'cg'>): number {
  return Math.round(L.colW - (2 * L.cw + L.cg) - 32);
}

/** Плашка банка: моно 0,6 em на знак, разрядка 0,12 em, поля 16 + 16 px. */
export function potPlateWidth(text: string, px: number): number {
  return Math.ceil(text.length * px * 0.72) + 32;
}

/**
 * Кегль плашки банка, чтобы она не заходила на карты руки: «Лучшая рука» и «Делёж банка» на троих
 * длиннее «Весь банк» — кегль меньше базового (не мельче 70 %).
 */
export function potFontSize(text: string, base: number, maxW: number): number {
  const min = Math.round(base * 0.7);
  let px = base;
  while (px > min && potPlateWidth(text, px) > maxW) px -= 1;
  return px;
}

/** Ширина «%» за цифрой шансов (моно 0,32 кегля процента, знак 0,62 em) с отступом. */
export function pctSignWidth(pct: number): number {
  return Math.ceil(Math.round(pct * 0.32) * 0.62) + Math.round(pct * 0.04);
}

/**
 * Плитка цифры шансов: две цифры — плитка раскладки; «100» в узкой колонке (3–4 руки) — плитка
 * мельче, чтобы цифра не заходила на карты руки (между ними не меньше PCT_GAP).
 */
export function pctTile(
  L: Pick<AllinLayout, 'pct' | 'colW' | 'cw' | 'cg'>,
  digits: number,
): { w: number; fs: number } {
  const w = Math.round(L.pct * 0.6) + 2;
  const room = L.colW - (2 * L.cw + L.cg) - PCT_GAP - pctSignWidth(L.pct);
  const fit = Math.floor(room / Math.max(1, digits));
  if (fit >= w) return { w, fs: L.pct };
  return { w: fit, fs: Math.floor((fit - 2) / 0.6) };
}

/** «Олл-ин · 3 руки». */
export function allinTitle(hands: number): string {
  return `Олл-ин · ${hands} ${plural(hands, ['рука', 'руки', 'рук'])}`;
}
