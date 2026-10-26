// Перекидные цифры табло ТВ (флапы): чистая логика без DOM — какие ячейки у строки, какие из них
// переворачивать и через какие промежуточные знаки («барабан» цифр, «перебор» букв), сколько длится
// падение листа. DOM и движение — flap.ts; тесты — flapLogic.test.ts. Перенесено из движка
// одобренного макета доработки табло v3 (engine.js), логика та же.

export const DIGITS = '0123456789';
/** Буквы перебора: лист «ВЫЛЕТ» и слова улиц перелистываются через случайную букву. */
export const RIFFLE_LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЫЭЮЯ';

/** Неразрывные пробелы разрядов («1 000»): узкая ячейка без плитки, как отбивка в числе. */
const GROUP_SEPARATORS = new Set([' ', ' ']);

/** Ячейка строки флапов: обычная плитка, печать без плитки («/»), узкий пробел. */
export type CellKind = 'tile' | 'plain' | 'narrow';

export interface RowLayoutOptions {
  /** Знаки, которые печатаются без плитки (дробь блайндов): «/». */
  plain?: string;
  /** Пробел — узкой ячейкой (0,4 плитки): «ДО ФЛОПА» без двойного пробела. */
  narrow?: boolean;
}

/** Вид ячейки для знака. Неразрывный пробел разрядов — всегда узкая ячейка. */
export function cellKind(ch: string, o: RowLayoutOptions): CellKind {
  if (GROUP_SEPARATORS.has(ch)) return 'narrow';
  if (ch === ' ' && o.narrow) return 'narrow';
  if (o.plain?.includes(ch)) return 'plain';
  return 'tile';
}

/**
 * Раскладка строки: вид каждой ячейки одной строкой («xx/xxx»). Если у нового текста раскладка
 * другая (75/150 → 100/200), строку нельзя перевернуть по ячейкам — её пересобирают: старое
 * уходит в пусто, новое встаёт на пустые плитки.
 */
export function rowPattern(text: string, o: RowLayoutOptions): string {
  return [...text]
    .map((ch) => {
      const k = cellKind(ch, o);
      return k === 'tile' ? 'x' : k === 'narrow' ? '_' : ch;
    })
    .join('');
}

/** Ширина ячейки по виду: печать — 0,66 плитки, узкий пробел — 0,4 (разряд — 0,3). */
export function cellWidth(ch: string, tileW: number, o: RowLayoutOptions): number {
  const k = cellKind(ch, o);
  if (k === 'plain') return Math.round(tileW * 0.66);
  if (k === 'narrow') return Math.round(tileW * (GROUP_SEPARATORS.has(ch) ? 0.3 : 0.4));
  return tileW;
}

/** Ширина строки флапов при плитке tileW и зазоре gap. */
export function rowWidth(text: string, tileW: number, gap: number, o: RowLayoutOptions): number {
  const chars = [...text];
  return chars.reduce((sum, ch) => sum + cellWidth(ch, tileW, o), 0) + gap * (chars.length - 1);
}

/**
 * Плитка, при которой строка не шире maxW: от wanted вниз до min. Ряд блайндов из шести и больше
 * знаков (100/200, 1 000/2 000) ужимает плитку, а не вылезает за колонку.
 */
export function fitTileWidth(
  text: string,
  wanted: number,
  maxW: number,
  gap: number,
  o: RowLayoutOptions,
  min = 36,
): number {
  let w = wanted;
  while (w > min && rowWidth(text, w, gap, o) > maxW) w -= 1;
  return w;
}

/**
 * Промежуточные знаки «барабана»: цифры идут вперёд (up) или назад (down) от from к to, не больше
 * max штук (ближайшие к to). Не цифра — один знак перебора; пусто — сразу.
 */
export function drumVia(
  from: string,
  to: string,
  dir: 'up' | 'down',
  max: number,
  riffle: Riffle,
): string[] {
  if (!DIGITS.includes(to)) return to === ' ' ? [] : riffle.take(to, 1);
  const i = DIGITS.indexOf(from);
  const j = DIGITS.indexOf(to);
  if (i < 0 || from === '') return riffle.take(to, 1);
  const n = dir === 'down' ? (i - j + 10) % 10 : (j - i + 10) % 10;
  const k = Math.min(Math.max(n - 1, 0), max);
  const out: string[] = [];
  for (let q = k; q >= 1; q -= 1) {
    out.push(DIGITS[(dir === 'down' ? j + q : j - q + 10) % 10] ?? '0');
  }
  return out;
}

/**
 * Перебор: n случайных знаков перед нужным — цифр для цифры, букв для буквы. Генератор
 * детерминированный (линейный конгруэнтный, как в макете): одни и те же перевороты дают один кадр.
 */
export class Riffle {
  private seed: number;

  constructor(seed = 7) {
    this.seed = seed;
  }

  take(to: string, n: number): string[] {
    const pool = DIGITS.includes(to) ? DIGITS : RIFFLE_LETTERS;
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      this.seed = (this.seed * 9301 + 49297) % 233280;
      out.push(pool[this.seed % pool.length] ?? pool[0] ?? '');
    }
    return out;
  }
}

/**
 * Время падения листа: крупный флап тяжелее (как у механики), но не дольше 340 мс и не быстрее
 * 170 — 120 × √(высота / 50).
 */
export function fallMs(height: number): number {
  return Math.round(Math.max(170, Math.min(340, 120 * Math.sqrt(height / 50))));
}

/** Порядок позиций при перевороте строки: слева направо, у чисел — младший разряд первым. */
export function flipOrder(length: number, lowFirst: boolean): number[] {
  const order = Array.from({ length }, (_, i) => i);
  return lowFirst ? order.reverse() : order;
}

/** Часы «28:00» → цифры минут и секунд: ['2','8'] и ['0','0']; минут бывает больше двух знаков. */
export function clockParts(text: string): { minutes: string; seconds: string } {
  const colon = text.lastIndexOf(':');
  if (colon < 0) return { minutes: text, seconds: '' };
  return { minutes: text.slice(0, colon), seconds: text.slice(colon + 1) };
}

/** Проценты флапами — два знака, число прижато вправо: 5 → « 5», 100 → «100». */
export function pctText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '  ';
  return String(Math.round(value)).padStart(2, ' ');
}
