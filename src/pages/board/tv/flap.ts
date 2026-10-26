// Флап — перекидная плитка табло ТВ (DOM и движение; чистая логика — flapLogic.ts). Перенесено из
// движка одобренного макета v3 (engine.js): плитка — две плоские половины на оси, верх светлее низа,
// между ними шов цветом фона. В покое знак лежит поверх шва (шов виден только между штрихами — не
// читается зачёркиванием); режется знак только в полёте. Переворот: верхняя половина старого знака
// падает к зрителю (0 → −90°), за ней нижняя половина нового встаёт на место (90° → 0) с маленьким
// отскоком на последнем знаке. Перспектива — 9 высот плитки, затемнение листа — не больше 0,32.
// Знаки — только textContent (без innerHTML): на флапах бывают и имена.
import {
  cellKind,
  drumVia,
  fallMs,
  flipOrder,
  rowPattern,
  type Riffle,
  type RowLayoutOptions,
} from './flapLogic';
import type { Motion } from './motion';

export interface FlapStyle {
  /** Плитка, px кадра. */
  w: number;
  h: number;
  /** Кегль и вес знака. */
  fs: number;
  wt?: number;
  /** Цвет знака (CSS). */
  ink?: string;
  /** Верхняя и нижняя половины плитки. */
  bg?: string;
  bgb?: string;
  /** Без плитки («впотай»): в покое плитки нет, переворот виден только при смене. */
  flush?: boolean;
  /** Шов, px. */
  s?: number;
  /** Сдвиг знака по вертикали, px. */
  dy?: number;
  /** Время падения листа, мс (иначе — по высоте). */
  fall?: number;
  cls?: string;
  /** Вырезы оси на концах шва (у цветной плитки «ВЫЛЕТ» — без них). */
  ax?: boolean;
}

export interface FlipOptions {
  via?: string[];
  delay?: number;
  step?: number;
  bounce?: boolean;
}

const TILE_TOP = 'var(--tv-tile-top)';
const TILE_BOTTOM = 'var(--tv-tile-bottom)';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export class Flap {
  readonly el: HTMLSpanElement;
  readonly fall: number;
  ch: string;
  private target: string | null = null;
  private busyTo = 0;
  private readonly o: Required<Omit<FlapStyle, 'cls' | 'fall'>> & { cls: string };
  private readonly hh: number;
  private readonly full: HTMLSpanElement;
  private readonly top: HTMLSpanElement;
  private readonly bottom: HTMLSpanElement;
  private readonly motion: Motion;

  constructor(motion: Motion, parent: HTMLElement | null, style: FlapStyle, ch = ' ') {
    this.motion = motion;
    this.o = {
      w: style.w,
      h: style.h,
      fs: style.fs,
      wt: style.wt ?? 800,
      ink: style.ink ?? 'var(--ink)',
      bg: style.bg ?? TILE_TOP,
      bgb: style.bgb ?? TILE_BOTTOM,
      flush: Boolean(style.flush),
      s: style.s ?? 2,
      dy: style.dy ?? 0,
      ax: style.ax ?? true,
      cls: style.cls ?? '',
    };
    const { w, h, s } = this.o;
    this.hh = (h - s) / 2;
    this.ch = ch;
    this.fall = style.fall ?? fallMs(h);

    const root = el(
      'span',
      `tv-fp${this.o.cls ? ` ${this.o.cls}` : ''}${this.o.flush ? ' tv-fp--flush' : ''}`,
    );
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    root.style.setProperty('--fp-t', this.o.bg);
    root.style.setProperty('--fp-b', this.o.bgb);
    root.style.setProperty('--fp-ink', this.o.ink);
    root.style.perspective = `${Math.round(h * 9)}px`;
    this.el = root;

    const lo = el('i', 'tv-fp__lo');
    lo.style.height = `${this.hh}px`;
    const seam = el('i', 'tv-fp__seam');
    seam.style.top = `${this.hh}px`;
    seam.style.height = `${s}px`;
    root.append(lo, seam);
    if (this.o.ax) {
      // Вырезы оси на концах шва: 3×6 у мелких плиток, пропорционально у крупных.
      const aw = Math.max(2, Math.round(h * 0.014));
      const ah = Math.max(5, Math.round(h * 0.034));
      for (const side of ['left', 'right'] as const) {
        const ax = el('i', 'tv-fp__ax');
        ax.style[side] = '0';
        ax.style.top = `${this.hh + s / 2 - ah / 2}px`;
        ax.style.width = `${aw}px`;
        ax.style.height = `${ah}px`;
        root.append(ax);
      }
    }
    this.full = el('span', 'tv-fp__full');
    this.full.append(this.glyph(ch, 0));
    this.top = el('span', 'tv-fp__half tv-fp__half--t');
    this.top.style.height = `${this.hh}px`;
    this.top.append(this.glyph(ch, 0));
    this.bottom = el('span', 'tv-fp__half tv-fp__half--b');
    this.bottom.style.top = `${this.hh + s}px`;
    this.bottom.style.height = `${this.hh}px`;
    this.bottom.append(this.glyph(ch, -(this.hh + s)));
    root.append(this.full, this.top, this.bottom);
    if (parent) parent.append(root);
  }

  private glyph(c: string, top: number): HTMLElement {
    const { h, fs, wt, dy } = this.o;
    const g = el('b', 'tv-fp__g');
    g.style.top = `${top}px`;
    g.style.height = `${h}px`;
    g.style.lineHeight = `${h}px`;
    g.style.fontSize = `${fs}px`;
    g.style.fontWeight = String(wt);
    if (dy) g.style.transform = `translateY(${dy}px)`;
    g.textContent = c === ' ' ? '' : c;
    return g;
  }

  /** Знак, к которому флап идёт (или стоит). */
  get want(): string {
    return this.target ?? this.ch;
  }

  setInk(color: string): void {
    this.o.ink = color;
    this.el.style.setProperty('--fp-ink', color);
  }

  /** Сразу, без движения (тик секунд, первый кадр). */
  set(c: string): void {
    this.ch = c;
    this.target = c;
    this.busyTo = 0;
    this.full.replaceChildren(this.glyph(c, 0));
    for (const leaf of this.el.querySelectorAll('.tv-fp__leaf')) leaf.remove();
    this.el.classList.remove('tv-fp--flipping');
  }

  /** Перевернуть к знаку c (o.via — промежуточные знаки); возвращает момент, когда флап встанет. */
  flip(c: string, o: FlipOptions = {}): number {
    const m = this.motion;
    const seq = [...(o.via ?? []), c];
    if (c === this.want && !o.via?.length) return m.now;
    this.target = c;
    if (m.calm) {
      // Спокойный режим: смена знака коротким проявлением, без полёта и промежуточных знаков.
      const at = Math.max(m.now + (o.delay ?? 0), this.busyTo);
      m.at(at, () => {
        this.set(c);
        m.A(this.full, [{ opacity: 0.25 }, { opacity: 1 }], 180);
      });
      this.busyTo = at + 180;
      return this.busyTo;
    }
    let t = Math.max(m.now + (o.delay ?? 0), this.busyTo);
    const step = o.step ?? Math.round(this.fall * 0.55);
    seq.forEach((ch, i) => {
      const lastOne = i === seq.length - 1;
      const dur = lastOne ? this.fall : step;
      m.at(t, () => this.leaf(ch, dur, lastOne && o.bounce !== false));
      t += dur + (lastOne ? 0 : 6);
    });
    this.busyTo = t + 40;
    return t;
  }

  private leaf(c: string, dur: number, bounce: boolean): void {
    const m = this.motion;
    const from = this.ch;
    this.ch = c;
    const { s } = this.o;
    const root = this.el;
    root.classList.add('tv-fp--flipping');
    this.top.replaceChildren(this.glyph(c, 0));
    this.bottom.replaceChildren(this.glyph(from, -(this.hh + s)));
    const d1 = Math.round(dur * 0.5);
    const d2 = dur - d1;
    // «Впотай» и облегчённый режим — лист без тени: на тёмном она не видна, анимаций вдвое меньше.
    const lite = m.lite;
    const flat = lite || this.o.flush;
    const top = el('span', 'tv-fp__leaf tv-fp__leaf--t');
    top.style.height = `${this.hh}px`;
    top.style.transformOrigin = `50% ${this.hh + s / 2}px`;
    top.append(this.glyph(from, 0));
    const bot = el('span', 'tv-fp__leaf tv-fp__leaf--b');
    bot.style.top = `${this.hh + s}px`;
    bot.style.height = `${this.hh}px`;
    bot.style.transformOrigin = `50% ${-s / 2}px`;
    bot.style.opacity = '0';
    bot.append(this.glyph(c, -(this.hh + s)));
    const topShade = flat ? null : el('i', 'tv-fp__sh');
    const botShade = flat ? null : el('i', 'tv-fp__sh');
    if (topShade) top.append(topShade);
    if (botShade) bot.append(botShade);
    root.append(top, bot);
    const rx = (a: number) =>
      lite
        ? `scaleY(${Math.max(0.001, Math.cos((a * Math.PI) / 180)).toFixed(4)})`
        : `rotateX(${a}deg)`;
    m.A(top, [{ transform: rx(0) }, { transform: rx(-90) }], d1, {
      easing: 'cubic-bezier(0.55, 0, 1, 0.6)',
    });
    if (topShade) m.A(topShade, [{ opacity: 0 }, { opacity: 0.32 }], d1);
    const kf = bounce
      ? [
          { transform: rx(90), offset: 0 },
          { transform: rx(0), offset: 0.74 },
          { transform: rx(8), offset: 0.86 },
          { transform: rx(0), offset: 1 },
        ]
      : [{ transform: rx(90) }, { transform: rx(0) }];
    const d2b = bounce ? Math.round(d2 * 1.35) : d2;
    m.after(d1, () => {
      top.remove();
      bot.style.opacity = '1';
      m.A(bot, kf, d2b, { easing: bounce ? 'linear' : 'cubic-bezier(0.5, 0, 1, 0.7)' });
      if (botShade) m.A(botShade, [{ opacity: 0.28 }, { opacity: 0 }], d2);
    });
    m.after(d1 + d2b, () => {
      bot.remove();
      if (this.ch === c) {
        this.full.replaceChildren(this.glyph(c, 0));
        if (!root.querySelector('.tv-fp__leaf')) root.classList.remove('tv-fp--flipping');
      }
    });
  }
}

export interface FlapRowStyle extends FlapStyle, RowLayoutOptions {
  /** Зазор между ячейками, px. */
  gap?: number;
  /** Цвет печати («/» блайндов). */
  plainInk?: string;
  /** Класс обычных плиток ряда. */
  cellCls?: string;
}

export interface RowFlipOptions {
  delay?: number;
  /** Промежуточные цифры по барабану: вперёд, назад или по числу (больше — вперёд). */
  drum?: 'up' | 'down' | 'auto';
  maxVia?: number;
  /** n случайных знаков перед нужным. */
  riffle?: number;
  /** Шаг между позициями, мс. */
  stagger?: number;
  /** Младший разряд первым. */
  lowFirst?: boolean;
}

/**
 * Ряд флапов: строка текста, каждая позиция — свой флап. Переворачиваются только изменившиеся
 * позиции. Другая раскладка ячеек (75/150 → 100/200) — старое уходит в пусто, новое встаёт на
 * пустые плитки.
 */
export class FlapRow {
  readonly el: HTMLSpanElement;
  text = '';
  private cells: Flap[] = [];
  private layout = '';
  private readonly o: FlapRowStyle;
  private readonly motion: Motion;
  private readonly riffle: Riffle;

  constructor(
    motion: Motion,
    riffle: Riffle,
    parent: HTMLElement | null,
    text: string,
    style: FlapRowStyle,
  ) {
    this.motion = motion;
    this.riffle = riffle;
    this.o = { gap: 6, ...style };
    this.el = el('span', `tv-fprow${style.cls ? ` ${style.cls}` : ''}`);
    this.el.style.gap = `${this.o.gap ?? 6}px`;
    if (parent) parent.append(this.el);
    this.build(text);
  }

  /** Ячейки по тексту; blank — плитки пустые (печать остаётся). */
  private build(text: string, blank = false): void {
    this.el.replaceChildren();
    const o = this.o;
    this.cells = [...text].map((ch) => {
      const kind = cellKind(ch, o);
      if (kind === 'narrow') {
        const w = Math.round(o.w * (ch === ' ' ? 0.4 : 0.3));
        return new Flap(this.motion, this.el, { ...o, w, flush: true, cls: '' }, ' ');
      }
      if (kind === 'plain') {
        return new Flap(
          this.motion,
          this.el,
          { ...o, w: Math.round(o.w * 0.66), flush: true, s: 0, ink: o.plainInk ?? o.ink, cls: '' },
          ch,
        );
      }
      return new Flap(this.motion, this.el, { ...o, cls: o.cellCls ?? '' }, blank ? ' ' : ch);
    });
    this.text = blank
      ? [...text].map((ch) => (cellKind(ch, o) === 'plain' ? ch : ' ')).join('')
      : text;
    this.layout = rowPattern(text, o);
  }

  /** Другая плитка (ряд блайндов ужимается под шесть цифр): новые ячейки встанут уже с ней. */
  setTile(w: number, fs: number): void {
    this.o.w = w;
    this.o.fs = fs;
  }

  /** Ячейки ряда (для пошагового показа: «ВЫЛЕТ» по букве). */
  get flaps(): readonly Flap[] {
    return this.cells;
  }

  flip(text: string, o: RowFlipOptions = {}): number {
    const m = this.motion;
    if ([...text].length !== this.cells.length || rowPattern(text, this.o) !== this.layout) {
      let end = m.now + (o.delay ?? 0);
      let k = 0;
      this.cells.forEach((cell, i) => {
        const ch = [...this.text][i] ?? ' ';
        if (cellKind(ch, this.o) !== 'tile') return;
        if (cell.want === ' ') return;
        end = Math.max(end, cell.flip(' ', { delay: (o.delay ?? 0) + k * 18, bounce: false }));
        k += 1;
      });
      m.at(end, () => {
        this.build(text, true);
        this.flip(text, { ...o, delay: 0 });
      });
      this.text = text;
      return end + (o.stagger ?? 40) * [...text].length + 420;
    }
    let end = m.now;
    const chars = [...text];
    const drum =
      o.drum === 'auto'
        ? Number.parseInt(text, 10) >= (Number.parseInt(this.text, 10) || 0)
          ? 'up'
          : 'down'
        : o.drum;
    let k = 0;
    for (const i of flipOrder(chars.length, Boolean(o.lowFirst))) {
      const cell = this.cells[i];
      const ch = chars[i] ?? ' ';
      // Печать и узкие пробелы при той же раскладке не меняются; плитка — только если знак другой.
      if (!cell || cellKind(ch, this.o) !== 'tile' || ch === cell.want) continue;
      const via = drum
        ? drumVia(cell.ch, ch, drum, o.maxVia ?? 3, this.riffle)
        : o.riffle
          ? this.riffle.take(ch, o.riffle)
          : undefined;
      end = Math.max(end, cell.flip(ch, { via, delay: (o.delay ?? 0) + k * (o.stagger ?? 40) }));
      k += 1;
    }
    this.text = text;
    return end;
  }

  set(text: string): void {
    if ([...text].length !== this.cells.length || rowPattern(text, this.o) !== this.layout) {
      this.build(text);
    } else {
      [...text].forEach((ch, i) => this.cells[i]?.set(ch));
    }
    this.text = text;
  }

  /** Цвет знаков; пересобранные ячейки получают тот же цвет. */
  setInk(color: string): void {
    this.o.ink = color;
    [...this.text].forEach((ch, i) => {
      if (cellKind(ch, this.o) === 'tile') this.cells[i]?.setInk(color);
    });
  }
}
