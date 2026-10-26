// Такты олл-ина на табло ТВ (макет доработки v3): что и когда встаёт на экране на каждой улице.
// Экран (AllinStage) рисует снимок Shown; такты меняют его по часам табло (motion.ts) — флоп по одной
// карте, тёрн и ривер с выдержкой, проценты, ауты, подписи следующей карты, развязка. Улица
// начинается, когда отыграла прошлая; правка раздачи — новое поколение (gen): такты прошлого
// поколения молча пропускаются.
import { streetOf, type Street } from '@domain/showdown.ts';
import type { ShowdownHand } from '@domain/types.ts';
import type { Dispatch, SetStateAction } from 'react';
import type { ShowdownAnalysis } from '../../../shared/lib/poker/analysis';
import {
  handViews,
  outsByPlayer,
  riverHits,
  winningCards,
  type HandResult,
  type HandView,
  type OutsView,
} from './allinModel';
import { devMark, type Motion } from './motion';

export interface HandShown {
  pct: number | null;
  bar: number;
  made: string;
  madeHidden: boolean;
  lead: boolean;
  ahead: boolean;
  outs: OutsView | null;
  outsCount: number;
  noOuts: string | null;
  caption: [string, string] | null;
  captionHidden: boolean;
  /** Сработавший на ривере аут. */
  hit: string | null;
  /** Остальные ранги гаснут (у руки со сработавшим аутом). */
  dimRanks: boolean;
  /** Плашки целиком гаснут (у остальных рук на ривере). */
  platesDim: boolean;
  fxHidden: boolean;
  /** Яркость колонки: проигравшие на развязке в тени. */
  dim: number;
  fin: string | null;
  result: HandResult | null;
  /** Карты руки, подчёркнутые у победителя. */
  combo: number[];
}

export interface Shown {
  /** Раздача и руки; другое — сразу как есть. */
  key: string;
  /** Поколение тактов: правка раздачи — новое. */
  gen: number;
  /** Без тактов (первый кадр, правка раздачи): всё встаёт сразу. */
  instant: boolean;
  street: Street;
  /** Карт стола, положенных в гнёзда. */
  board: number;
  /** Какие карты стола показаны в гнёздах (как были, когда легли): банкир поправил карту — правка. */
  cards: string[];
  /** Выдержка вскрытия карт стола (мс после посадки в гнездо). */
  hold: number[];
  lifted: boolean;
  handsIn: boolean;
  hands: HandShown[];
  comboBoard: number[];
}

export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];
const SIZE: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const PREV: Record<Street, Street | null> = {
  preflop: null,
  flop: 'preflop',
  turn: 'flop',
  river: 'turn',
};

export function dimOf(r: HandResult | null): number {
  if (!r) return 1;
  if (r.kind === 'out') return 0.32;
  if (r.kind === 'lose' || r.kind === 'stay') return 0.45;
  return 1;
}

/**
 * Итог руки на ривере поменялся после развязки: вылет или «остаётся в игре» пришли ответом банкира,
 * у победителя появилась подпись «удвоение».
 */
export function resultChanged(was: HandResult | null, now: HandResult | null | undefined): boolean {
  return Boolean(was && now && (was.kind !== now.kind || was.note !== now.note));
}

export function fromView(v: HandView): HandShown {
  return {
    pct: v.pct,
    bar: (v.pct ?? 0) / 100,
    made: v.made,
    madeHidden: false,
    lead: v.lead,
    ahead: v.ahead,
    outs: v.outs,
    outsCount: v.outs?.count ?? 0,
    noOuts: v.noOuts,
    caption: v.caption,
    captionHidden: false,
    hit: null,
    dimRanks: false,
    platesDim: false,
    fxHidden: false,
    dim: 1,
    fin: null,
    result: null,
    combo: [],
  };
}

function resolvedHand(v: HandView, combo: number[]): HandShown {
  const r = v.result;
  return {
    ...fromView(v),
    outs: null,
    caption: null,
    ahead: false,
    noOuts: null,
    fxHidden: true,
    madeHidden: true,
    dim: dimOf(r),
    fin: v.made,
    result: r,
    bar: r?.kind === 'win' ? 1 : r?.kind === 'split' ? (v.pct ?? 0) / 100 : 0,
    combo,
  };
}

/** Данные раздачи на сейчас: руки, стол, шансы по улицам, вылетевшие участники. */
export interface ScriptData {
  hands: readonly ShowdownHand[];
  board: readonly string[];
  analyses: Record<Street, ShowdownAnalysis | null>;
  busted: ReadonlySet<string>;
  /** Проигравшие, оставшиеся в игре по ответу банкира (раздача закрыта на ривере). */
  stayed: ReadonlySet<string>;
}

export function viewsOf(d: ScriptData, street: Street): HandView[] {
  const prev = PREV[street];
  return handViews({
    hands: d.hands,
    board: d.board.slice(0, SIZE[street]),
    analysis: d.analyses[street],
    previousOuts: prev ? outsByPlayer(d.hands, d.analyses[prev]) : new Map(),
    busted: d.busted,
    stayed: d.stayed,
  });
}

/** Всё как есть сейчас — без тактов (первый кадр, правка раздачи). */
export function settledShown(d: ScriptData, key: string, gen: number): Shown {
  const street = streetOf(d.board.length);
  const views = viewsOf(d, street);
  const winner = views.findIndex((v) => v.result?.kind === 'win');
  const combo = winner >= 0 ? winningCards(d.hands[winner]?.cards ?? [], d.board) : null;
  return {
    key,
    gen,
    instant: true,
    street,
    board: d.board.length,
    cards: [...d.board],
    hold: [0, 0, 0, 0, 0],
    lifted: street !== 'preflop',
    handsIn: true,
    hands: views.map((v, i) =>
      street === 'river' ? resolvedHand(v, i === winner && combo ? combo.hole : []) : fromView(v),
    ),
    comboBoard: combo?.board ?? [],
  };
}

/** До входа: руки ещё не встали, проценты не показаны. */
export function initialShown(d: ScriptData, key: string): Shown {
  return {
    key,
    gen: 0,
    instant: false,
    street: 'preflop',
    board: 0,
    cards: [],
    hold: [0, 0, 0, 0, 0],
    lifted: false,
    handsIn: false,
    hands: viewsOf(d, 'preflop').map((v) => ({
      ...fromView(v),
      pct: null,
      bar: 0,
      fxHidden: true,
    })),
    comboBoard: [],
  };
}

/**
 * Раздачу поправили так, что показанное уже не верно: карту стола убрали или заменили (банкир
 * поправил «Снять борд» или опечатку). Шансы, ауты и развязка посчитаны по прежнему столу — экран
 * встаёт заново как есть (новое поколение тактов).
 */
export function boardEdited(
  shown: Pick<Shown, 'board' | 'cards'>,
  board: readonly string[],
): boolean {
  if (board.length < shown.board) return true;
  for (let i = 0; i < shown.board; i += 1) if (board[i] !== shown.cards[i]) return true;
  return false;
}

/** Какую улицу играть следующей (или null — догнали стол). */
export function nextStreet(shown: Shown, boardSize: number): Street | null {
  const target = streetOf(boardSize);
  const next: Street | null = !shown.handsIn
    ? 'preflop'
    : (STREETS[STREETS.indexOf(shown.street) + 1] ?? null);
  if (!next || STREETS.indexOf(next) > STREETS.indexOf(target)) return null;
  return next;
}

export class AllinScript {
  private busyUntil = 0;
  private busyGen = -1;
  private pending: number | null = null;
  private readonly motion: Motion;
  private readonly set: Dispatch<SetStateAction<Shown>>;
  private readonly data: () => ScriptData & { gen: number };

  constructor(
    motion: Motion,
    set: Dispatch<SetStateAction<Shown>>,
    data: () => ScriptData & { gen: number },
  ) {
    this.motion = motion;
    this.set = set;
    this.data = data;
  }

  /** Идут такты прошлой улицы этого поколения. */
  busy(gen: number): boolean {
    return this.busyGen === gen && this.motion.now < this.busyUntil;
  }

  /**
   * Следующая улица, если стол её уже показывает и прошлая отыграла; иначе — проверить, когда
   * отыграет. Улица запускается отдельным тактом (не внутри рендера экрана).
   */
  step(shown: Shown, boardSize: number): void {
    if (this.pending !== null || (shown.instant && !shown.handsIn)) return;
    const next = nextStreet(shown, boardSize);
    if (!next) return;
    const at = this.busy(shown.gen) ? this.busyUntil : this.motion.now;
    const gen = shown.gen;
    this.pending = this.motion.at(at, () => {
      this.pending = null;
      if (this.data().gen !== gen || this.busy(gen)) return;
      // Дальше — с тактами (первый кадр показал стол как есть, новые улицы играются).
      this.set((s) => (s.instant ? { ...s, instant: false } : s));
      const dur = this.play(next, gen);
      this.busyGen = gen;
      this.busyUntil = this.motion.now + dur;
      // Проверить следующую улицу, когда эта отыграет (стол мог уйти вперёд за это время).
      this.motion.at(this.busyUntil, () => this.set((s) => ({ ...s })));
    });
  }

  /**
   * Вне тактов догнать то, что пришло позже: шансы до флопа (воркер), вылет участника после
   * развязки.
   */
  fill(shown: Shown): void {
    if (this.pending !== null || this.busy(shown.gen) || !shown.handsIn) return;
    const d = this.data();
    if (shown.street === 'preflop') {
      const views = viewsOf(d, 'preflop');
      if (!shown.hands.some((h, i) => h.pct === null && views[i]?.pct != null)) return;
      this.later(shown.gen, () =>
        this.set((s) => ({
          ...s,
          hands: s.hands.map((h, i) => {
            const v = views[i];
            return h.pct === null && v?.pct != null
              ? { ...h, pct: v.pct, bar: v.pct / 100, lead: v.lead }
              : h;
          }),
        })),
      );
      return;
    }
    if (shown.street === 'river') {
      const views = viewsOf(d, 'river');
      const changed = shown.hands.some((h, i) => resultChanged(h.result, views[i]?.result));
      if (!changed) return;
      this.later(shown.gen, () =>
        this.set((s) => ({
          ...s,
          hands: s.hands.map((h, i) => {
            const r = views[i]?.result ?? null;
            return r && resultChanged(h.result, r) ? { ...h, result: r, dim: dimOf(r) } : h;
          }),
        })),
      );
    }
  }

  private later(gen: number, fn: () => void): void {
    this.pending = this.motion.after(0, () => {
      this.pending = null;
      if (this.data().gen === gen) fn();
    });
  }

  private at(gen: number, ms: number, fn: () => void): void {
    this.motion.after(ms, () => {
      if (this.data().gen === gen) fn();
    });
  }

  private patch(gen: number, ms: number, i: number, p: Partial<HandShown>): void {
    this.at(gen, ms, () =>
      this.set((s) => ({ ...s, hands: s.hands.map((h, k) => (k === i ? { ...h, ...p } : h)) })),
    );
  }

  private patchAll(
    gen: number,
    ms: number,
    f: (h: HandShown, i: number) => Partial<HandShown>,
  ): void {
    this.at(gen, ms, () =>
      this.set((s) => ({ ...s, hands: s.hands.map((h, i) => ({ ...h, ...f(h, i) })) })),
    );
  }

  private play(street: Street, gen: number): number {
    devMark('street', street);
    if (street === 'preflop') return this.enter(gen);
    if (street === 'flop') return this.flop(gen);
    if (street === 'turn') return this.turn(gen);
    return this.river(gen);
  }

  /** Карты стола from..to-1 садятся в гнёзда с шагом step и вскрываются после выдержки hold. */
  private placeCards(
    gen: number,
    from: number,
    to: number,
    start: number,
    step: number,
    hold: number,
  ): number {
    let end = start;
    for (let c = from; c < to; c += 1) {
      const t = start + (c - from) * step;
      this.at(gen, t, () => {
        const placed = this.data().board;
        this.set((s) => {
          const board = Math.max(s.board, c + 1);
          return {
            ...s,
            board,
            cards: placed.slice(0, board),
            hold: s.hold.map((x, k) => (k === c ? hold : x)),
          };
        });
      });
      end = t + 160 + hold + 450;
    }
    return end;
  }

  /** Вход: руки поднимаются, проценты до флопа перекатываются, полосы растут. */
  private enter(gen: number): number {
    const n = this.data().hands.length;
    const now = () => viewsOf(this.data(), 'preflop');
    this.set((s) => ({ ...s, handsIn: true }));
    for (let i = 0; i < n; i += 1) {
      this.at(gen, 1400 + i * 100, () => {
        const v = now()[i];
        this.set((s) => ({
          ...s,
          hands: s.hands.map((h, k) =>
            k === i ? { ...h, fxHidden: false, pct: v?.pct ?? null } : h,
          ),
        }));
      });
      this.at(gen, 1900 + i * 40, () => {
        const v = now()[i];
        this.set((s) => ({
          ...s,
          hands: s.hands.map((h, k) => (k === i ? { ...h, bar: (v?.pct ?? 0) / 100 } : h)),
        }));
      });
    }
    this.at(gen, 2200, () => {
      const views = now();
      this.set((s) => ({
        ...s,
        hands: s.hands.map((h, i) => ({ ...h, lead: views[i]?.lead ?? false })),
      }));
    });
    return 2600;
  }

  /** Флоп: руки поднимаются, карты по одной, проценты, ауты, подписи следующей карты. */
  private flop(gen: number): number {
    const views = viewsOf(this.data(), 'flop');
    this.set((s) => ({ ...s, street: 'flop', lifted: true }));
    const d = this.placeCards(gen, 0, 3, 320, 520, 0) + 250;
    views.forEach((v, i) => {
      this.patch(gen, d + i * 90, i, { pct: v.pct });
      this.patch(gen, d + 300 + i * 40, i, { bar: (v.pct ?? 0) / 100 });
      this.patch(gen, d + 600 + i * 40, i, { made: v.made });
    });
    this.patchAll(gen, d + 300, (_, i) => ({ lead: views[i]?.lead ?? false }));
    // Ауты — после процентов: в кадре одна группа движения за раз.
    let k = 0;
    views.forEach((v, i) => {
      if (v.outs || v.noOuts) {
        this.patch(gen, d + 1000 + k * 180, i, {
          outs: v.outs,
          outsCount: v.outs?.count ?? 0,
          noOuts: v.noOuts,
        });
        k += 1;
      } else if (v.ahead) this.patch(gen, d + 900, i, { ahead: true });
    });
    // Подписи следующей карты — у всех рук разом, одной строкой, после аутов.
    const tc = d + 1000 + k * 180 + 200;
    views.forEach((v, i) => this.patch(gen, tc + i * 60, i, { caption: v.caption }));
    return tc + views.length * 60 + 500;
  }

  /** Тёрн: выдержка (рубашка в гнезде 0,9 с), проценты, погасшие ауты. */
  private turn(gen: number): number {
    const views = viewsOf(this.data(), 'turn');
    this.set((s) => ({ ...s, street: 'turn' }));
    // Подписи следующей карты уходят: на тёрне процент и есть шанс последней карты.
    views.forEach((_, i) => this.patch(gen, i * 40, i, { captionHidden: true }));
    const d = this.placeCards(gen, 3, 4, 0, 0, 900) + 250;
    views.forEach((v, i) => {
      this.patch(gen, d + i * 90, i, { pct: v.pct });
      this.patch(gen, d + 300 + i * 40, i, { bar: (v.pct ?? 0) / 100 });
      // Погасшие ауты — на месте, число аутов перелистывается чуть позже.
      this.patch(gen, d + 500, i, { outs: v.outs, noOuts: v.noOuts, ahead: v.ahead });
      this.patch(gen, d + 700, i, { outsCount: v.outs?.count ?? 0 });
      this.patch(gen, d + 600 + i * 40, i, { made: v.made });
    });
    this.patchAll(gen, d + 200, (_, i) => ({ lead: views[i]?.lead ?? false }));
    return d + 1300;
  }

  /** Ривер: выдержка дольше (ривер решает), сработавший аут, развязка, комбинация победителя. */
  private river(gen: number): number {
    const data = this.data();
    const views = viewsOf(data, 'river');
    const hits = riverHits(outsByPlayer(data.hands, data.analyses.turn), data.board);
    this.set((s) => ({ ...s, street: 'river' }));
    const t = this.placeCards(gen, 4, 5, 0, 0, 1400);
    // Связь с аутом: сработавший ранг подчёркнут, остальные гаснут; у остальных рук плашки гаснут.
    this.patchAll(gen, t + 60, (h, i) => {
      const hit = hits.get(data.hands[i]?.playerId ?? '') ?? null;
      return hit ? { hit, dimRanks: true } : h.outs ? { platesDim: true } : {};
    });
    const d = t + 900;
    const winner = views.findIndex((v) => v.result?.kind === 'win');
    const combo = winner >= 0 ? winningCards(data.hands[winner]?.cards ?? [], data.board) : null;
    // Развязка, такт 1: проценты и ауты уходят одним слоем, проигравшие — в тень.
    this.patchAll(gen, d, (_, i) => ({ fxHidden: true, dim: dimOf(views[i]?.result ?? null) }));
    this.patchAll(gen, d + 200, () => ({ madeHidden: true }));
    this.patchAll(gen, d + 560, (_, i) => {
      const r = views[i]?.result;
      return r && r.kind !== 'win' && r.kind !== 'split' ? { bar: 0 } : {};
    });
    // Такт 2: итог каждой руки крупно на месте аутов; у победителя полоса во всю длину.
    views.forEach((v, i) => this.patch(gen, d + 300 + i * 80, i, { fin: v.made }));
    this.patchAll(gen, d + 300, (_, i) => ({ lead: views[i]?.lead ?? false }));
    if (winner >= 0) this.patch(gen, d + 340, winner, { bar: 1 });
    // Такт 3: итог по банку и вылет — на месте процента (вылет — из журнала, когда он пришёл).
    this.at(gen, d + 760, () => {
      const now = viewsOf(this.data(), 'river');
      this.set((s) => ({
        ...s,
        hands: s.hands.map((h, i) => {
          const r = now[i]?.result ?? null;
          return { ...h, result: r, dim: dimOf(r) };
        }),
      }));
    });
    // Такт 4: комбинация победителя — подчёркнуты карты стола и руки, которые её составили.
    if (combo && winner >= 0) {
      this.at(gen, d + 1400, () =>
        this.set((s) => ({
          ...s,
          comboBoard: combo.board,
          hands: s.hands.map((h, i) => (i === winner ? { ...h, combo: combo.hole } : h)),
        })),
      );
    }
    return d + 2000;
  }
}
