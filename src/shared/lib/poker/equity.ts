// Эквити олл-ина: у каждого игрока — доля банка, частота чистой победы и частота дележа (%).
// Перенос equity.js из курса (D:\personal\poker-course\js\equity.js, сверен там с cardfight.com до
// 0,01 п. п.) для конкретных рук — диапазоны табло не нужны.
//
// Два режима, как в курсе:
//   точный перебор — когда досок для перебора не больше EXACT_BOARD_LIMIT (флоп, тёрн, ривер при
//                    любом числе игроков);
//   Монте-Карло    — до флопа (1,7 млн досок у двоих). Seed берётся из самих карт раздачи
//                    (seedFor), число раздач — из числа игроков: одни и те же карты дают одни и
//                    те же проценты на табло, у банкира и у игроков. Ни Date.now, ни Math.random.
// Монте-Карло можно считать кусками (createMcJob / runMcJob): результат от нарезки не зависит —
// так считает и Web Worker, и запасной путь на главном потоке.
// Руки, равные по шансам из-за равноправия мастей (AhKd и AdKh против 7c7s), получают одинаковые
// цифры в обоих режимах: доли таких рук усредняются (suitSymmetryGroups) — иначе шум Монте-Карло
// показал бы двум одинаковым AK 18 % и 17 %.
import { deckWithout, parseCards, type Card } from './cards';
import { evaluate } from './evaluator';
import { nCk } from './pokermath';

/** Наибольшее число досок для точного перебора (как EXACT_LIMIT курса). */
export const EXACT_BOARD_LIMIT = 250_000;
/** Сколько оценок рук тратит одна раздача Монте-Карло: у двоих — 200 тыс. раздач. */
export const MC_EVAL_BUDGET = 400_000;
/** Меньше раздач не берём и при девяти игроках: погрешность доли — около 0,2 п. п. */
export const MC_MIN_SAMPLES = 40_000;

export interface EquityResult {
  /** Доля банка, %: чистые победы плюс доли дележей. В сумме по игрокам — 100. */
  equity: number[];
  /** Частота чистой победы, %. */
  win: number[];
  /** Частота дележа банка (с кем угодно), %. */
  tie: number[];
  /** Сколько досок перебрано (точно) или разыграно (Монте-Карло). */
  samples: number;
  exact: boolean;
}

/** Генератор mulberry32 — тот же, что в курсе: одинаковый seed — одинаковая последовательность. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-битный FNV-1a: seed Монте-Карло из текста раздачи. */
export function seedFor(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Ключ раздачи: «AsKd|QhQc/2c7d9h». По нему кешируются шансы и берётся seed. */
export function showdownKey(
  hands: readonly (readonly string[])[],
  board: readonly string[],
): string {
  return `${hands.map((h) => h.join('')).join('|')}/${board.join('')}`;
}

/** Обратно из ключа: руки и стол (для воркера — в сообщении только ключ). */
export function parseShowdownKey(key: string): { hands: string[][]; board: string[] } {
  const [handsPart = '', boardPart = ''] = key.split('/');
  const pairs = (s: string) => s.match(/../g) ?? [];
  return {
    hands: handsPart === '' ? [] : handsPart.split('|').map(pairs),
    board: pairs(boardPart),
  };
}

export type EquityPlan =
  { kind: 'exact'; boards: number } | { kind: 'mc'; samples: number; seed: number };

/** Как считать: точный перебор, если досок мало, иначе Монте-Карло с seed из ключа раздачи. */
export function planEquity(players: number, boardSize: number, key: string): EquityPlan {
  const unseen = 52 - boardSize - 2 * players;
  const boards = nCk(unseen, 5 - boardSize);
  if (boards <= EXACT_BOARD_LIMIT) return { kind: 'exact', boards };
  return {
    kind: 'mc',
    samples: Math.max(MC_MIN_SAMPLES, Math.floor(MC_EVAL_BUDGET / players)),
    seed: seedFor(key),
  };
}

// --- симметрия мастей ---------------------------------------------------------------------------

/** Все 24 перестановки мастей: p[масть] — во что она переходит. */
const SUIT_PERMUTATIONS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  const walk = (prefix: number[]) => {
    if (prefix.length === 4) {
      out.push(prefix);
      return;
    }
    for (let suit = 0; suit < 4; suit += 1) {
      if (!prefix.includes(suit)) walk([...prefix, suit]);
    }
  };
  walk([]);
  return out;
})();

/**
 * Группы рук, у которых шансы равны точно: масти в покере равноправны, поэтому если перестановка
 * мастей оставляет стол на месте, а руки переставляет между собой, то у рук, переходящих друг в
 * друга, шансы одинаковые (AhKd и AdKh против 7c7s — обмен червей и бубён). Ответ — разбиение
 * индексов рук на группы (по возрастанию индексов); у несимметричной раздачи все группы — по одной руке.
 */
export function suitSymmetryGroups(
  hands: readonly (readonly Card[])[],
  board: readonly Card[],
): number[][] {
  const n = hands.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  const pairKey = (a: Card, b: Card) => (a < b ? a * 52 + b : b * 52 + a);
  const handIndex = new Map(hands.map((h, i) => [pairKey(h[0] ?? 0, h[1] ?? 0), i]));
  const onBoard = new Set(board);

  for (const p of SUIT_PERMUTATIONS) {
    const move = (card: Card): Card => (card & ~3) | (p[card & 3] ?? 0);
    if (!board.every((c) => onBoard.has(move(c)))) continue;
    const images = hands.map((h) => handIndex.get(pairKey(move(h[0] ?? 0), move(h[1] ?? 0))));
    if (images.some((j) => j === undefined)) continue;
    images.forEach((j, i) => {
      const a = find(i);
      const b = find(j ?? i);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    });
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()];
}

/** Доли и частоты рук одной группы (suitSymmetryGroups) — их среднее: равные руки, равные цифры. */
function symmetrize(r: EquityResult, groups: readonly (readonly number[])[]): EquityResult {
  if (groups.every((g) => g.length === 1)) return r;
  const mean = (values: readonly number[]) => {
    const out = [...values];
    for (const g of groups) {
      const avg = g.reduce((acc, i) => acc + (values[i] ?? 0), 0) / g.length;
      for (const i of g) out[i] = avg;
    }
    return out;
  };
  return { ...r, equity: mean(r.equity), win: mean(r.win), tie: mean(r.tie) };
}

// --- подсчёт -----------------------------------------------------------------------------------

interface Tally {
  wins: Float64Array; // чистые победы
  tieShare: Float64Array; // доля банка от дележей
  tieHits: Float64Array; // сколько раз делил
}

function newTally(n: number): Tally {
  return { wins: new Float64Array(n), tieShare: new Float64Array(n), tieHits: new Float64Array(n) };
}

function tally(scores: Float64Array, n: number, t: Tally): void {
  let best = -1;
  let cnt = 0;
  for (let i = 0; i < n; i += 1) {
    const s = scores[i]!;
    if (s > best) {
      best = s;
      cnt = 1;
    } else if (s === best) cnt += 1;
  }
  if (cnt === 1) {
    for (let i = 0; i < n; i += 1) {
      if (scores[i] === best) {
        t.wins[i] = t.wins[i]! + 1;
        break;
      }
    }
  } else {
    for (let i = 0; i < n; i += 1) {
      if (scores[i] === best) {
        t.tieShare[i] = t.tieShare[i]! + 1 / cnt;
        t.tieHits[i] = t.tieHits[i]! + 1;
      }
    }
  }
}

function result(t: Tally, total: number, n: number, exact: boolean): EquityResult {
  const pct = (x: number) => (total ? (x / total) * 100 : 0);
  const equity: number[] = [];
  const win: number[] = [];
  const tie: number[] = [];
  for (let i = 0; i < n; i += 1) {
    equity.push(pct(t.wins[i]! + t.tieShare[i]!));
    win.push(pct(t.wins[i]!));
    tie.push(pct(t.tieHits[i]!));
  }
  return { equity, win, tie, samples: total, exact };
}

/** Семь карт каждой руки: две свои, дальше стол; свободные места заполняет перебор. */
function sevens(hands: readonly (readonly Card[])[], board: readonly Card[]): Int32Array[] {
  return hands.map((h) => {
    const a = new Int32Array(7);
    a[0] = h[0]!;
    a[1] = h[1]!;
    board.forEach((c, j) => (a[2 + j] = c));
    return a;
  });
}

function assertDistinct(hands: readonly (readonly Card[])[], board: readonly Card[]): void {
  if (hands.length < 2) throw new Error('Нужно минимум два игрока');
  if (board.length > 5) throw new Error('На столе не может быть больше пяти карт');
  const used = [...board, ...hands.flat()];
  if (hands.some((h) => h.length !== 2)) throw new Error('У каждого игрока — две карты');
  if (new Set(used).size !== used.length) throw new Error('Одна и та же карта указана дважды');
}

/** Точный перебор всех досок. */
export function exactEquity(
  hands: readonly (readonly Card[])[],
  board: readonly Card[],
): EquityResult {
  assertDistinct(hands, board);
  const n = hands.length;
  const deck = deckWithout([...board, ...hands.flat()]);
  const need = 5 - board.length;
  const cards = sevens(hands, board);
  const scores = new Float64Array(n);
  const t = newTally(n);
  let count = 0;

  const pick = (start: number, depth: number): void => {
    if (depth === need) {
      for (let i = 0; i < n; i += 1) scores[i] = evaluate(cards[i]!, 7);
      tally(scores, n, t);
      count += 1;
      return;
    }
    const slot = 2 + board.length + depth;
    for (let i = start; i <= deck.length - (need - depth); i += 1) {
      const c = deck[i]!;
      for (let h = 0; h < n; h += 1) cards[h]![slot] = c;
      pick(i + 1, depth + 1);
    }
  };
  pick(0, 0);
  return symmetrize(result(t, count, n, true), suitSymmetryGroups(hands, board));
}

/** Монте-Карло, которое можно считать кусками: состояние генератора живёт в задаче. */
export interface McJob {
  readonly target: number;
  samples: number;
  readonly n: number;
  readonly need: number;
  readonly boardSize: number;
  readonly fixed: Uint8Array; // карты рук и стола: в добор не идут
  readonly blocked: Uint8Array;
  readonly cards: Int32Array[];
  readonly scores: Float64Array;
  readonly rng: () => number;
  readonly tally: Tally;
  /** Руки, равные по шансам (suitSymmetryGroups): в ответе их доли усредняются. */
  readonly groups: readonly (readonly number[])[];
}

export function createMcJob(
  hands: readonly (readonly Card[])[],
  board: readonly Card[],
  samples: number,
  seed: number,
): McJob {
  assertDistinct(hands, board);
  const fixed = new Uint8Array(52);
  for (const c of [...board, ...hands.flat()]) fixed[c] = 1;
  return {
    target: samples,
    samples: 0,
    n: hands.length,
    need: 5 - board.length,
    boardSize: board.length,
    fixed,
    blocked: new Uint8Array(52),
    cards: sevens(hands, board),
    scores: new Float64Array(hands.length),
    rng: mulberry32(seed),
    tally: newTally(hands.length),
    groups: suitSymmetryGroups(hands, board),
  };
}

/** Посчитать ещё до maxSamples раздач; true — задача досчитана. */
export function runMcJob(job: McJob, maxSamples = Number.POSITIVE_INFINITY): boolean {
  const { n, need, boardSize, blocked, cards, scores, rng } = job;
  const stop = Math.min(job.target, job.samples + maxSamples);
  while (job.samples < stop) {
    blocked.set(job.fixed);
    // Добор недостающих карт стола — как в курсе: случайная карта, пока не попадётся свободная.
    for (let i = 0; i < need; i += 1) {
      let c: number;
      do c = (rng() * 52) | 0;
      while (blocked[c]);
      blocked[c] = 1;
      const slot = 2 + boardSize + i;
      for (let h = 0; h < n; h += 1) cards[h]![slot] = c;
    }
    for (let i = 0; i < n; i += 1) scores[i] = evaluate(cards[i]!, 7);
    tally(scores, n, job.tally);
    job.samples += 1;
  }
  return job.samples >= job.target;
}

export function mcJobResult(job: McJob): EquityResult {
  return symmetrize(result(job.tally, job.samples, job.n, false), job.groups);
}

/** Монте-Карло целиком. */
export function monteCarloEquity(
  hands: readonly (readonly Card[])[],
  board: readonly Card[],
  samples: number,
  seed: number,
): EquityResult {
  const job = createMcJob(hands, board, samples, seed);
  runMcJob(job);
  return mcJobResult(job);
}

/**
 * Шансы раздачи в нотации журнала (['As','Kd'], стол ['2c','7d','9h']) по плану planEquity:
 * точно или Монте-Карло с seed из карт. Один и тот же вход — один и тот же ответ на любом экране.
 */
export function computeEquity(
  hands: readonly (readonly string[])[],
  board: readonly string[],
): EquityResult {
  const parsedHands = hands.map((h) => parseCards(h));
  const parsedBoard = parseCards(board);
  const plan = planEquity(hands.length, board.length, showdownKey(hands, board));
  return plan.kind === 'exact'
    ? exactEquity(parsedHands, parsedBoard)
    : monteCarloEquity(parsedHands, parsedBoard, plan.samples, plan.seed);
}
