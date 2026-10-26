// Общее для экрана игры табло ТВ: элементы, которые двигают моменты (смена уровня, нокаут, возврат
// из олл-ина) — их заполняют компоненты экрана через ref, читают такты TvBoard; что держит момент
// на экране (GameMoment); плитка ряда блайндов.
import type { FlapRowStyle } from './flap';
import { fitTileWidth } from './flapLogic';

export interface GameEls {
  head: HTMLElement | null;
  lvl: HTMLElement | null;
  clock: HTMLElement | null;
  bhead: HTMLElement | null;
  brule: HTMLElement | null;
  lvlhead: HTMLElement | null;
  blinds: HTMLElement | null;
  below: HTMLElement | null;
  fund: HTMLElement | null;
  tableBase: HTMLElement | null;
  markers: HTMLElement | null;
  center: HTMLElement | null;
  ko: HTMLElement | null;
  /** Подписи мест (номер и имя) по номеру места — гаснут и встают по одной при возврате к столу. */
  labels: Map<number, HTMLElement>;
  /** Имена по номеру места — их яркость (фокус стола). */
  names: Map<number, HTMLElement>;
}

export function emptyGameEls(): GameEls {
  return {
    head: null,
    lvl: null,
    clock: null,
    bhead: null,
    brule: null,
    lvlhead: null,
    blinds: null,
    below: null,
    fund: null,
    tableBase: null,
    markers: null,
    center: null,
    ko: null,
    labels: new Map(),
    names: new Map(),
  };
}

/** Реестр элементов экрана (ref): его заполняют ref-колбэки, читают такты. */
export interface ElsRef {
  readonly current: GameEls;
}

/** Ref-колбэк, кладущий элемент в поле реестра. */
export function bindEl<K extends Exclude<keyof GameEls, 'labels' | 'names'>>(els: ElsRef, key: K) {
  return (el: HTMLElement | null) => {
    els.current[key] = el;
  };
}

/** Ref-колбэк подписи или имени места. */
export function bindSeat(els: ElsRef, kind: 'labels' | 'names', seat: number) {
  return (el: HTMLElement | null) => {
    if (el) els.current[kind].set(seat, el);
    else els.current[kind].delete(seat);
  };
}

/** Флап «ВЫЛЕТ» у места: место занято под него (show — буквы встают), потом складывается. */
export interface VyletMark {
  show: boolean;
  fold: boolean;
}

export interface KoCardView {
  eyebrow: string;
  name: string;
  /** «выбивает» + «Женя» / «выбивают» + «Саша и Дима»; null — кто выбил, не указано. */
  by: { verb: string; names: string } | null;
}

/** Что держит момент на экране игры. */
export interface GameMoment {
  /** Цифра в заголовке «УРОВЕНЬ [5] ИЗ 8». */
  headLevel: number | null;
  /** Блайнды, которые показывает заставка (до такта блайндов — прежние). */
  blinds: string | null;
  /** Ряд блайндов — янтарём (заставка). */
  blindsAccent: boolean;
  /** Строка ребаев полностью (новый уровень — последний с ребаями). */
  lift: boolean;
  /** «В игре» — прежнее число до такта нокаута. */
  inGame: number | null;
  /** Места, уже показанные вылетевшими (нокаут посреди тактов). */
  outSeats: ReadonlySet<number>;
  vylet: ReadonlyMap<number, VyletMark>;
  ko: KoCardView | null;
}

export const NO_MOMENT: GameMoment = {
  headLevel: null,
  blinds: null,
  blindsAccent: false,
  lift: false,
  inGame: null,
  outSeats: new Set(),
  vylet: new Map(),
  ko: null,
};

/** Левая колонка экрана игры: 96…650. */
export const COL_W = 554;
const BLINDS: FlapRowStyle = {
  w: 82,
  h: 128,
  fs: 120,
  wt: 800,
  ink: 'var(--ink)',
  s: 3,
  gap: 6,
  dy: 1,
  plain: '/',
  plainInk: 'var(--ink-muted)',
};

/** Плитка ряда блайндов: ряд из шести и больше знаков ужимается, а не вылезает за колонку. */
export function blindsStyle(text: string): FlapRowStyle {
  const w = fitTileWidth(text, BLINDS.w, COL_W, BLINDS.gap ?? 6, { plain: '/' }, 44);
  return { ...BLINDS, w, fs: Math.min(BLINDS.fs, Math.round(w * 1.46)) };
}
