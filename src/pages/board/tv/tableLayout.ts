// Стол на табло ТВ: геометрия в пикселях кадра 1920×1080 (макет доработки табло v3). Чистые функции
// (тесты — tableLayout.test.ts): где стоит место, его номер, имя и гнёзда камеры, где метки D / SB /
// BB и по какому пути они едут вдоль борта к следующей раздаче.
//
// Места — по сукну клуба: ближний край 1·10·9 слева направо, дальний 4·5·6, левый торец 2·3 снизу
// вверх, правый 7·8 сверху вниз (номера растут по часовой, как раздача). Стол — объект 624×440 со
// срезанными углами; его центр — в центре кадра по вертикали. Места у торцов — на 0,34 высоты от
// края: метки торцов не встают в ряд со ставками.
import { TABLE_SEATS } from '@domain/types.ts';

/** Прямоугольник стола (борт), px кадра. */
export const TABLE = { x0: 976, x1: 1600, y0: 320, y1: 760 } as const;
export const TABLE_W = TABLE.x1 - TABLE.x0;
export const TABLE_H = TABLE.y1 - TABLE.y0;
export const TABLE_CX = (TABLE.x0 + TABLE.x1) / 2;
export const TABLE_CY = (TABLE.y0 + TABLE.y1) / 2;
/** Срез угла стола, px. */
export const TABLE_CUT = 40;

export type Side = 't' | 'b' | 'l' | 'r';

export interface SeatPoint {
  x: number;
  y: number;
  side: Side;
}

const W6 = TABLE_W / 6;

/** Точка места на борту по номеру сукна 1..10. */
export const SEAT_POINTS: Readonly<Record<number, SeatPoint>> = {
  4: { x: TABLE.x0 + W6, y: TABLE.y0, side: 't' },
  5: { x: TABLE_CX, y: TABLE.y0, side: 't' },
  6: { x: TABLE.x1 - W6, y: TABLE.y0, side: 't' },
  1: { x: TABLE.x0 + W6, y: TABLE.y1, side: 'b' },
  10: { x: TABLE_CX, y: TABLE.y1, side: 'b' },
  9: { x: TABLE.x1 - W6, y: TABLE.y1, side: 'b' },
  3: { x: TABLE.x0, y: TABLE.y0 + TABLE_H * 0.34, side: 'l' },
  2: { x: TABLE.x0, y: TABLE.y1 - TABLE_H * 0.34, side: 'l' },
  7: { x: TABLE.x1, y: TABLE.y0 + TABLE_H * 0.34, side: 'r' },
  8: { x: TABLE.x1, y: TABLE.y1 - TABLE_H * 0.34, side: 'r' },
};

export function seatPoint(seat: number): SeatPoint {
  const p = SEAT_POINTS[seat];
  if (!p) throw new Error(`Нет места ${seat} на столе`);
  return p;
}

/** Номер места — моно 20 px, два знака по 0,6 em с разрядкой 0,02 em. */
export const SEAT_NO_W = 25;
const SEAT_NO_H = 20;
/** Имя — Inter 40 px (подгоняется вниз по ширине до NAME_MIN). */
export const NAME_H = 40;
/** Межстрочный интервал имени двумя строками (tv.css, .tv-seat__name--two): выше области глифов. */
export const NAME_TWO_LH = 1.3;
export const NAME_MIN = 24;
/** Одно длинное слово («Константин» у торца) переносить некуда — оно мельчает ещё до этого кегля. */
export const NAME_WORD_MIN = 20;
/**
 * Длинное имя из нескольких слов («Евгений Козлов» из Telegram), которое и при NAME_MIN не
 * помещается, — двумя строками не крупнее этого кегля: две строки не задевают номер места и гнездо
 * стека (флап «ВЫЛЕТ»).
 */
export const NAME_TWO_MAX = 26;
/** От борта до кольца номеров. */
const RING = 12;
/** Гнездо стека (оно же место флапа «ВЫЛЕТ»): ширина и высота. */
export const STACK_W = 206;
export const STACK_H = 50;

/**
 * Наибольшая ширина имени: сверху и снизу — треть стола без зазора до соседа; у левого торца — до
 * x 761 (выросший ряд блайндов заставки уровня кончается на 750), у правого — до безопасной зоны
 * кадра 1824.
 */
export function nameLimit(side: Side): number {
  if (side === 't' || side === 'b') return 186;
  return side === 'l' ? 160 : 168;
}

/**
 * Верх блока имени высотой h: строка имени держит общую линию ряда — сверху у стола низ блока
 * (к номеру), у торцов — середина; снизу — верх (две строки растут вниз, к гнезду стека, а не на
 * номер). y — верх строки имени высотой NAME_H (seatLabels).
 */
export function nameTop(side: Side, y: number, h: number): number {
  if (side === 't') return y + NAME_H - h;
  if (side === 'b') return y;
  return y + NAME_H / 2 - h / 2;
}

/**
 * Верх гнезда под стеком (флап «ВЫЛЕТ», тихое «6-е место», позже — стек с камеры) при имени высотой
 * h. Имя двумя строками растёт от места: сверху — вверх, снизу — вниз, у торцов — в обе стороны;
 * гнездо отходит вместе с ним и не ложится на вторую строку (живая проверка 26.10: флап «ВЫЛЕТ»
 * закрывал «ШЕРЕМЕТЕВА» у места 10).
 */
export function stackTop(side: Side, y: number, h: number): number {
  const extra = Math.max(0, h - NAME_H);
  if (side === 't') return y - extra;
  if (side === 'b') return y + extra;
  return y + extra / 2;
}

/**
 * Без рассадки — список «За столом» (TvList): имена с кеглем LIST_NAME_PX, и низ списка — не ниже
 * LIST_BOTTOM (низа подписей нижнего края стола): ниже — подвал (строки голоса, «Без места»).
 */
export const LIST_NAME_PX = 40;
export const LIST_NAME_MIN = 24;
export const LIST_BOTTOM = 880;

/**
 * Кегль имён списка «За столом»: наибольший от base до min, при котором низ блока (bottomAt(px)) —
 * не ниже limit; не помещается и на min — min. Десять длинных имён по одному в строку на 40 px
 * уходили под подвал (живая проверка 26.10).
 */
export function fitDown(
  bottomAt: (px: number) => number,
  limit: number,
  base: number = LIST_NAME_PX,
  min: number = LIST_NAME_MIN,
): number {
  let px = base;
  while (px > min && bottomAt(px) > limit) px -= 1;
  return px;
}

/** Привязка подписи: точка и как выровнен блок относительно неё. */
export interface Anchor {
  x: number;
  y: number;
  /** start — блок начинается в x, end — кончается в x, center — по центру x. */
  align: 'start' | 'end' | 'center';
}

export interface SeatLabels {
  side: Side;
  /** Номер места (верх блока — y). */
  no: Anchor;
  /** Имя (верх блока — y). */
  name: Anchor;
  /** Гнездо стека и флапа «ВЫЛЕТ» (левый верх — x, y; ширина STACK_W). */
  stack: { x: number; y: number; justify: 'center' | 'flex-end' | 'flex-start' };
  /** Гнездо ставки на «кольце ставок» между меткой у борта и центром стола. */
  bet: { x: number; y: number; w: number; h: number };
}

/**
 * Подписи места: номер — кольцом вплотную к борту (у пустого места — только номер), имя — снаружи
 * кольца, гнездо стека — ещё дальше от стола. Сверху и снизу всё по центру места; у левого торца —
 * прижато к борту справа налево (имя, затем номер), у правого — слева направо.
 */
export function seatLabels(seat: number): SeatLabels {
  const { x, y, side } = seatPoint(seat);
  if (side === 't') {
    const noY = TABLE.y0 - RING - SEAT_NO_H;
    const nameY = noY - 10 - NAME_H;
    return {
      side,
      no: { x, y: noY, align: 'center' },
      name: { x, y: nameY, align: 'center' },
      stack: { x: x - STACK_W / 2, y: nameY - 14 - STACK_H, justify: 'center' },
      bet: { x: x - 42, y: TABLE.y0 + 80, w: 84, h: 32 },
    };
  }
  if (side === 'b') {
    const noY = TABLE.y1 + RING;
    const nameY = noY + SEAT_NO_H + 10;
    return {
      side,
      no: { x, y: noY, align: 'center' },
      name: { x, y: nameY, align: 'center' },
      stack: { x: x - STACK_W / 2, y: nameY + NAME_H + 14, justify: 'center' },
      bet: { x: x - 42, y: TABLE.y1 - 80 - 32, w: 84, h: 32 },
    };
  }
  if (side === 'l') {
    const noRight = TABLE.x0 - 16;
    const nameY = y - NAME_H / 2;
    return {
      side,
      no: { x: noRight, y: y - SEAT_NO_H / 2, align: 'end' },
      name: { x: noRight - SEAT_NO_W - 14, y: nameY, align: 'end' },
      stack: { x: TABLE.x0 - 16 - STACK_W, y: nameY + NAME_H + 12, justify: 'flex-end' },
      bet: { x: TABLE.x0 + 168, y: y - 16, w: 60, h: 32 },
    };
  }
  const noLeft = TABLE.x1 + 16;
  const nameY = y - NAME_H / 2;
  return {
    side,
    no: { x: noLeft, y: y - SEAT_NO_H / 2, align: 'start' },
    name: { x: noLeft + SEAT_NO_W + 14, y: nameY, align: 'start' },
    stack: { x: TABLE.x1 + 16, y: nameY + NAME_H + 12, justify: 'flex-start' },
    bet: { x: TABLE.x1 - 168 - 60, y: y - 16, w: 60, h: 32 },
  };
}

// --- Метки D / SB / BB -------------------------------------------------------------------------

export type Marker = 'D' | 'SB' | 'BB';
export const MARKERS: readonly Marker[] = ['D', 'SB', 'BB'];
/** Высота метки; ширина D — 48, у SB и BB — по сумме (меряется на экране). */
export const MARKER_H = 48;
export const MARKER_D_W = 48;

export type MarkerSeats = Record<Marker, number | null>;

/**
 * Где стоит метка (левый верх, px кадра) у места seat. Две метки на одном месте (вдвоём: баттон и
 * SB) — рядом вдоль кромки: same — метки этого места по порядку, widths — их ширины.
 */
export function markerXY(
  seat: number,
  kind: Marker,
  same: readonly Marker[],
  widths: Readonly<Record<Marker, number>>,
): [number, number] {
  const { x, y, side } = seatPoint(seat);
  const w = widths[kind];
  let shift = 0;
  const idx = same.indexOf(kind);
  if (same.length > 1 && idx >= 0) {
    const ws = same.map((k) => widths[k] + 10);
    const total = ws.reduce((a, b) => a + b, 0) - 10;
    shift = -total / 2 + ws.slice(0, idx).reduce((a, b) => a + b, 0) + w / 2;
  }
  const stackDy = same.length > 1 && idx >= 0 ? (idx - 0.5) * 58 : 0;
  if (side === 't') return [x - w / 2 + shift, TABLE.y0 + 22];
  if (side === 'b') return [x - w / 2 + shift, TABLE.y1 - 22 - MARKER_H];
  if (side === 'l') return [TABLE.x0 + 22, y - 24 + stackDy];
  return [TABLE.x1 - 22 - w, y - 24 + stackDy];
}

/** Метки на одном месте — в порядке D, SB, BB. */
export function markersAt(seats: MarkerSeats, seat: number): Marker[] {
  return MARKERS.filter((k) => seats[k] === seat);
}

// --- Путь метки вдоль борта ---------------------------------------------------------------------

type Point = [number, number];

/**
 * «Кольцо меток» — прямоугольник со срезанными углами, по которому метки стоят у мест (центр метки
 * шириной w), по часовой на экране: вверх по левому торцу, вправо по дальнему краю, вниз по правому,
 * влево по ближнему.
 */
export function railPoints(w: number): Point[] {
  const L = TABLE.x0 + 22 + w / 2;
  const R = TABLE.x1 - 22 - w / 2;
  const Tp = TABLE.y0 + 46;
  const Bt = TABLE.y1 - 46;
  const c = 28;
  return [
    [L, Bt - c],
    [L, Tp + c],
    [L + c, Tp],
    [R - c, Tp],
    [R, Tp + c],
    [R, Bt - c],
    [R - c, Bt],
    [L + c, Bt],
  ];
}

/** Ближайшая точка кольца: путь от начала кольца до неё и длина кольца. */
export function railPosition(P: readonly Point[], pt: Point): { s: number; length: number } {
  let best = Infinity;
  let bs = 0;
  let acc = 0;
  for (let i = 0; i < P.length; i += 1) {
    const a = P[i] as Point;
    const b = P[(i + 1) % P.length] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const t =
      len === 0
        ? 0
        : Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (len * len)));
    const d = Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy));
    if (d < best) {
      best = d;
      bs = acc + t * len;
    }
    acc += len;
  }
  return { s: bs, length: acc };
}

/**
 * Путь метки по часовой от from к to (центры метки): точки на углах кольца между ними с долей
 * пути — смещения ключевых кадров пропорциональны длине, скорость по пути ровная. Всегда вперёд
 * (по часовой), даже если короче было бы назад: раздача идёт по часовой.
 */
export function railPath(
  w: number,
  from: Point,
  to: Point,
): { length: number; points: [number, Point][] } {
  const P = railPoints(w);
  const { s: sa, length: per } = railPosition(P, from);
  let sb = railPosition(P, to).s;
  if (sb <= sa + 1) sb += per;
  const corners: [number, Point][] = [];
  let acc = 0;
  P.forEach((p, i) => {
    corners.push([acc, p]);
    const q = P[(i + 1) % P.length] as Point;
    acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const pts: [number, Point][] = [[0, from]];
  for (const k of [0, 1]) {
    for (const [s, p] of corners) {
      const s2 = s + k * per;
      if (s2 > sa + 2 && s2 < sb - 2) pts.push([s2 - sa, p]);
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  pts.push([sb - sa, to]);
  return { length: sb - sa, points: pts };
}

/**
 * Баттон перешёл так, как его двигает раздача ('hand', nextButtonSeat домена): вперёд по часовой, и
 * между прежним и новым местом нет игроков в игре (alive — места игроков в игре). Только тогда метки
 * едут вдоль борта; отмена «Следующей раздачи» или баттон, поставленный руками на другое место,
 * идут назад или через игроков — метки встают на место без переезда (иначе почти полный круг стола
 * по часовой читается как баттон на 9 мест вперёд).
 */
export function dealMove(from: number, to: number, alive: ReadonlySet<number>): boolean {
  if (from === to) return false;
  for (let k = 1; k < TABLE_SEATS; k += 1) {
    const seat = ((from - 1 + k) % TABLE_SEATS) + 1;
    if (seat === to) return true;
    if (alive.has(seat)) return false;
  }
  return false;
}

/** Длительность переезда метки: 420–600 мс, длиннее путь — дольше. */
export function railDuration(length: number): number {
  return Math.round(Math.max(420, Math.min(600, 360 + length * 0.25)));
}

// --- Центр и карточка нокаута -------------------------------------------------------------------

/** Карточка нокаута — в центре стола, по его оси. */
export const KO_CARD = { w: 300, h: 208, x: TABLE_CX - 150, y: TABLE_CY - 104 } as const;

/** Многоугольник борта (SVG), px внутри рамки стола с полем 1 px под обводку 2 px. */
export function feltPolygon(): string {
  const c = TABLE_CUT;
  const w = TABLE_W;
  const h = TABLE_H;
  const p = (x: number, y: number) => `${x + 1},${y + 1}`;
  return [
    p(c, 0),
    p(w - c, 0),
    p(w, c),
    p(w, h - c),
    p(w - c, h),
    p(c, h),
    p(0, h - c),
    p(0, c),
  ].join(' ');
}
