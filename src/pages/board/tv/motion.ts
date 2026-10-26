// Движение табло ТВ: свои часы и анимации (перенесено из движка одобренного макета v3, engine.js).
//
// Почему так устроено:
// - Моменты табло (смена уровня, нокаут, олл-ин) — такты по времени: «через 560 мс цифра уровня,
//   через 1100 — часы». Такты стоят в очереди Timeline на часах табло, а не в setTimeout: одна
//   очередь, один кадр (requestAnimationFrame), и всё, что движется, можно остановить и прокрутить
//   (freeze/jump — для снимков посреди движения, только в dev).
// - Движение — только transform и opacity, через Web Animations API: анимация создаётся на паузе,
//   ставится на своё время и запускается; по окончании последний кадр (keep) закрепляется
//   инлайн-стилем, а анимация снимается — за вечер ничего не копится.
// - Спокойный режим (prefers-reduced-motion) — смена без полёта: проявление вместо переворота и
//   переезда. Облегчённый (слабый ТВ) — флап складывается scaleY без 3D и без затемнения листа;
//   включается сам, если 10 кадров подряд во время движения дольше 24 мс.
// - Когда вкладка спрятана, кадров нет — часы табло стоят (шаг кадра не больше 50 мс): моменты
//   доиграют, когда экран снова виден, а не все разом.

/** Кривые движения табло (макет v3). */
export const EASE = {
  move: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  quiet: 'cubic-bezier(0, 0, 0.38, 0.9)',
  turn: 'cubic-bezier(0.4, 0, 1, 1)',
  swell: 'cubic-bezier(0.37, 0, 0.63, 1)',
  push: 'cubic-bezier(0.3, 0, 0.3, 1)',
  flat: 'cubic-bezier(0.25, 0.1, 0.75, 0.9)',
} as const;

interface Timer {
  t: number;
  id: number;
  fn: () => void;
}

/**
 * Очередь тактов на часах табло: чистая логика без DOM (тесты — motion.test.ts). Такт с меньшим
 * сроком — раньше; при равных — в порядке постановки. Такт может ставить новые такты: те, чей срок
 * уже наступил, выполнятся в том же run.
 */
export class Timeline {
  now = 0;
  private timers: Timer[] = [];
  private seq = 0;

  at(t: number, fn: () => void): number {
    const timer = { t, id: this.seq, fn };
    this.seq += 1;
    // Вставка по сроку: очередь всегда отсортирована.
    let i = this.timers.length;
    while (i > 0 && (this.timers[i - 1]?.t ?? 0) > t) i -= 1;
    this.timers.splice(i, 0, timer);
    return timer.id;
  }

  after(ms: number, fn: () => void): number {
    return this.at(this.now + ms, fn);
  }

  cancel(id: number): void {
    this.timers = this.timers.filter((x) => x.id !== id);
  }

  get size(): number {
    return this.timers.length;
  }

  /** Выполнить всё, чей срок наступил. */
  run(): void {
    for (let guard = 0; guard < 100_000; guard += 1) {
      const head = this.timers[0];
      if (!head || head.t > this.now) return;
      this.timers.shift();
      head.fn();
    }
  }

  /** Сдвинуть часы на dt и выполнить наступившее. */
  advance(dt: number): void {
    this.now += dt;
    this.run();
  }
}

export interface AnimOptions {
  delay?: number;
  easing?: string;
  /** Закрепить последний кадр инлайн-стилем по окончании. */
  keep?: boolean;
  done?: () => void;
}

interface LiveAnim {
  a: Animation;
  t0: number;
  dur: number;
  el: Element;
}

type Keyframe = Record<string, string | number>;

export interface MotionOptions {
  calm: boolean;
  /** Облегчённый режим сразу (иначе — самодиагностика). */
  lite?: boolean;
}

/** Часы и анимации одного табло. */
export class Motion {
  readonly tl = new Timeline();
  calm: boolean;
  lite: boolean;
  private frozen = false;
  private fastForward = false;
  private readonly live = new Set<LiveAnim>();
  private raf = 0;
  private last: number | null = null;
  private slow = 0;
  private readonly autoLite: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(o: MotionOptions) {
    this.calm = o.calm;
    this.lite = Boolean(o.lite);
    this.autoLite = !o.lite;
  }

  get now(): number {
    return this.tl.now;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Сколько анимаций идёт сейчас. */
  get running(): number {
    return this.live.size;
  }

  start(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.last === null) this.last = now;
      const raw = now - this.last;
      this.last = now;
      if (this.frozen) return;
      // Самодиагностика слабого ТВ — только пока что-то движется и после прогрева страницы.
      if (this.autoLite && !this.lite && this.live.size > 0 && this.tl.now > 3000) {
        this.slow = raw > 24 ? this.slow + 1 : 0;
        if (this.slow >= 10) {
          this.lite = true;
          console.info('Табло: облегчённый режим флапов (10 кадров подряд дольше 24 мс)');
        }
      }
      this.tl.advance(Math.min(Math.max(raw, 0), 50));
      for (const fn of this.listeners) fn();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = null;
    for (const r of this.live) r.a.cancel();
    this.live.clear();
  }

  /** Подписка на каждый кадр (после тактов). */
  onFrame(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  at(t: number, fn: () => void): number {
    return this.tl.at(t, fn);
  }

  after(ms: number, fn: () => void): number {
    return this.tl.after(ms, fn);
  }

  cancel(id: number): void {
    this.tl.cancel(id);
  }

  /**
   * Анимация на часах табло: kf — ключевые кадры WAAPI (только transform и opacity), dur — мс.
   * o.keep — по окончании закрепить последний кадр инлайн-стилем и снять анимацию.
   */
  A(
    el: HTMLElement | SVGElement | null | undefined,
    kf: Keyframe[],
    dur: number,
    o: AnimOptions = {},
  ): void {
    if (!el || typeof el.animate !== 'function') {
      if (el && o.keep) applyLast(el, kf);
      o.done?.();
      return;
    }
    const t0 = this.tl.now + (o.delay ?? 0);
    const start = () => {
      const a = el.animate(kf as Keyframe[], {
        duration: dur,
        easing: o.easing ?? 'linear',
        fill: 'both',
      });
      const rec: LiveAnim = { a, t0, dur, el };
      this.live.add(rec);
      a.pause();
      a.currentTime = Math.max(0, Math.min(dur, this.tl.now - t0));
      if (!this.frozen && !this.fastForward) a.play();
      this.tl.at(t0 + dur, () => {
        if (!this.live.has(rec)) return;
        this.live.delete(rec);
        if (o.keep) applyLast(el, kf);
        a.cancel();
        o.done?.();
      });
    };
    if (o.delay) this.tl.at(t0, start);
    else start();
  }

  /** Снять анимации элемента (новое движение того же свойства — с места, где он сейчас). */
  cancelOn(el: Element | null | undefined): void {
    if (!el) return;
    for (const r of [...this.live]) {
      if (r.el === el) {
        r.a.cancel();
        this.live.delete(r);
      }
    }
  }

  /** Остановить кадр (снимки посреди движения; только dev). */
  freeze(): void {
    this.frozen = true;
    for (const r of this.live) {
      r.a.pause();
      r.a.currentTime = Math.max(0, Math.min(r.dur, this.tl.now - r.t0));
    }
  }

  play(): void {
    if (!this.frozen) return;
    this.frozen = false;
    this.last = null;
    for (const r of this.live) {
      r.a.currentTime = Math.max(0, Math.min(r.dur, this.tl.now - r.t0));
      r.a.play();
    }
  }

  /** Прокрутить часы табло на ms синхронно и остановить кадр (снимки; только dev). */
  jump(ms: number): void {
    this.fastForward = true;
    const target = this.tl.now + ms;
    while (this.tl.now < target) {
      this.tl.advance(Math.min(4, target - this.tl.now));
      for (const fn of this.listeners) fn();
    }
    this.fastForward = false;
    this.freeze();
  }

  // --- Частые движения табло (макет v3) -------------------------------------------------------

  /** Прозрачность к to за d мс — с текущего значения. */
  fade(el: HTMLElement | null | undefined, to: number, d: number, o: AnimOptions = {}): void {
    if (!el) return;
    const run = () => {
      const from = Number(getComputedStyle(el).opacity);
      this.cancelOn(el);
      el.style.opacity = String(from);
      if (Math.abs(from - to) < 0.01) {
        el.style.opacity = String(to);
        o.done?.();
        return;
      }
      this.A(el, [{ opacity: from }, { opacity: to }], d, {
        easing: o.easing ?? 'linear',
        keep: true,
        done: o.done,
      });
    };
    if (o.delay) this.after(o.delay, run);
    else run();
  }

  /** Появление снизу: прозрачность и сдвиг dy → 0; спокойно — только проявление. */
  rise(el: HTMLElement | null | undefined, dy: number, d: number, o: AnimOptions = {}): void {
    if (!el) return;
    el.style.opacity = '0';
    const run = () => {
      if (this.calm) {
        this.A(el, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true, done: o.done });
        return;
      }
      this.A(
        el,
        [
          { opacity: 0, transform: `translateY(${dy}px)` },
          { opacity: 1, transform: 'translateY(0px)', offset: 0.45 },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        d,
        { easing: o.easing ?? EASE.enter, keep: true, done: o.done },
      );
    };
    if (o.delay) this.after(o.delay, run);
    else run();
  }

  /** Линейка вырастает слева направо (scaleX 0 → 1); спокойно — проявляется целиком. */
  line(el: HTMLElement | null | undefined, d: number, o: AnimOptions = {}): void {
    if (!el) return;
    el.style.transform = 'scaleX(0)';
    const run = () => {
      if (this.calm) {
        el.style.transform = 'scaleX(1)';
        this.A(el, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
        return;
      }
      this.A(el, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], d, {
        easing: EASE.move,
        keep: true,
      });
    };
    if (o.delay) this.after(o.delay, run);
    else run();
  }

  /** Переезд transform from → to; спокойно — сразу на месте. */
  move(
    el: HTMLElement | null | undefined,
    from: string,
    to: string,
    d: number,
    o: AnimOptions = {},
  ): void {
    if (!el) return;
    const run = () => {
      this.cancelOn(el);
      if (this.calm) {
        el.style.transform = to;
        o.done?.();
        return;
      }
      this.A(el, [{ transform: from }, { transform: to }], d, {
        easing: o.easing ?? EASE.move,
        keep: true,
        done: o.done,
      });
    };
    if (o.delay) this.after(o.delay, run);
    else run();
  }
}

function applyLast(el: HTMLElement | SVGElement, kf: Keyframe[]): void {
  const last = kf[kf.length - 1];
  if (!last) return;
  for (const [prop, value] of Object.entries(last)) {
    if (prop === 'offset' || prop === 'easing') continue;
    el.style.setProperty(
      prop === 'transform' || prop === 'opacity' ? prop : kebab(prop),
      String(value),
    );
  }
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Отметка для снимков посреди движения (только dev): момент, улица олл-ина, переворот минуты.
 * Скрипт снимка ловит событие, останавливает часы табло (window.__tvMotion.freeze) и прокручивает
 * их ровно на нужные миллисекунды. В прод-сборку не попадает.
 */
export function devMark(name: string, detail?: unknown): void {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`tv:${name}`, { detail }));
  }
}
