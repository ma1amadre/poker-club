// Такты моментов табло ТВ (макет доработки v3): смена уровня, нокаут, вход в олл-ин и возврат к
// столу. Здесь только движение элементов экрана (motion.ts) и то, что момент держит на экране
// (GameMoment и часы — через сеттеры TvBoard); что и когда показывать — moments.ts. Длительности и
// порядок тактов — как в макете: порядок тактов — как читает зритель.
import type { BlindLevel } from '@domain/types.ts';
import type { Dispatch, SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { rowWidth } from './flapLogic';
import { blindsText } from './gameModel';
import { devMark, EASE, type Motion } from './motion';
import { blindsStyle, COL_W, type GameEls, type GameMoment, type KoCardView } from './stage';

/** Правый край выросшего ряда блайндов: имена левого торца стола начинаются от x 761. */
const GROW_MAX = 750;
/** Часы в углу кадра в олл-ине и на месте. */
export const CLOCK_CORNER = 'translate(0px, -110px) scale(0.3125)';
const CLOCK_HOME = 'translate(0px, 0px) scale(1)';

export interface Stagehand {
  motion: Motion;
  els: GameEls;
  setGm: Dispatch<SetStateAction<GameMoment>>;
  setClockFrozen: (v: boolean) => void;
  setClockDrum: (v: boolean) => void;
}

/**
 * Смена уровня (8 раз за вечер), ~5,3 с. Тот же ряд блайндов на своём месте вырастает и
 * перелистывается; над ним — «УРОВЕНЬ [5] ИЗ 8» (цифра — флап на плитке). Такты: номер уровня →
 * часы на полную длину → блайнды → суммы на метках стола и средний стек. Масштаб ряда — от ширины
 * нового ряда: шесть цифр (100/200) вырастают меньше и не заходят под подписи стола. Янтарь в
 * этот момент — только линейка и блайнды. release — экран отпускает прежний уровень (такт 4).
 */
export function playLevel(
  h: Stagehand,
  from: BlindLevel | undefined,
  to: BlindLevel,
  fromNo: number,
  toNo: number,
  release: () => void,
  finish: () => void,
): void {
  const { motion, els } = h;
  const fromText = from ? blindsText(from) : blindsText(to);
  const toText = blindsText(to);
  const wTo = blindsStyle(toText).w;
  const rw = rowWidth(toText, wTo, 6, { plain: '/' });
  const bsc = Number(Math.min(1.36, (GROW_MAX - 96) / rw).toFixed(3));
  const sh = 24;
  const grow = Math.round(128 * (bsc - 1)) + sh;
  if (els.brule) els.brule.style.width = `${Math.round(Math.max(COL_W, rw * bsc))}px`;
  flushSync(() =>
    h.setGm((g) => ({ ...g, headLevel: fromNo, blinds: fromText, blindsAccent: true })),
  );
  // Такт 0 (0–500): линейка, заголовок, ряд растёт на месте, колонка ниже уступает место, стол тише.
  motion.fade(els.bhead, 0, 160);
  motion.fade(els.lvl, 0, 160);
  motion.line(els.brule, 450, { delay: 40 });
  motion.rise(els.lvlhead, 10, 420, { delay: 140 });
  motion.move(els.blinds, 'translateY(0px) scale(1)', `translateY(${sh}px) scale(${bsc})`, 440, {
    delay: 60,
  });
  motion.move(els.below, 'translateY(0px)', `translateY(${grow}px)`, 440, { delay: 60 });
  motion.fade(els.fund, 0.3, 320, { delay: 60 });
  motion.fade(els.tableBase, 0.4, 320, { delay: 120 });
  // Такт 1 (560): номер уровня.
  motion.after(560, () => h.setGm((g) => ({ ...g, headLevel: toNo })));
  // Такт 2 (1100): часы на полную длину уровня — барабаном.
  motion.after(1100, () => {
    h.setClockDrum(true);
    h.setClockFrozen(false);
  });
  // Такт 3 (1700): блайнды — главное событие; строка ребаев — вместе с ними.
  motion.after(1700, () => h.setGm((g) => ({ ...g, blinds: toText, lift: true })));
  // Такт 4 (2700): суммы на метках стола и средний стек в BB.
  motion.after(2700, release);
  // Выход (4600–5300): всё садится обратно.
  motion.after(4600, () => {
    h.setClockDrum(false);
    motion.move(els.blinds, `translateY(${sh}px) scale(${bsc})`, 'translateY(0px) scale(1)', 440);
    motion.move(els.below, `translateY(${grow}px)`, 'translateY(0px)', 440);
    motion.fade(els.brule, 0, 200);
    motion.fade(els.lvlhead, 0, 200);
    motion.fade(els.fund, 1, 320, { delay: 100 });
    motion.fade(els.tableBase, 1, 400, { delay: 100 });
    h.setGm((g) => ({ ...g, lift: false }));
  });
  motion.after(5060, () => {
    h.setGm((g) => ({ ...g, blinds: null, blindsAccent: false, headLevel: null }));
    motion.fade(els.bhead, 1, 240);
    motion.fade(els.lvl, 1, 240);
  });
  motion.after(5320, () => {
    const rule = els.brule;
    if (rule) {
      motion.cancelOn(rule);
      rule.style.opacity = '';
      rule.style.transform = 'scaleX(0)';
    }
    finish();
  });
}

/**
 * Нокаут (6–10 раз за вечер), ~4,7 с. Одна точка внимания за раз: сначала карточка в центре стола
 * («6-е место · МИША · выбивает ЖЕНЯ»), метки D/SB/BB притушены до 0,25 — оранжевое не спорит с
 * красным; потом карточка уходит, и фокус передаётся месту: у имени встаёт красный флап «ВЫЛЕТ»,
 * затем «в игре» перелистывается на одного меньше (release — экран отпускает вылетевшего). Флап
 * стоит ~12 с и складывается в тихое «6-е место». Без места (рассадки нет) — только карточка.
 */
export function playKo(
  h: Stagehand,
  card: KoCardView,
  seat: number | null,
  release: () => void,
  finish: () => void,
): void {
  const { motion, els } = h;
  flushSync(() => h.setGm((g) => ({ ...g, ko: card })));
  const ko = els.ko;
  const bar = ko?.querySelector<HTMLElement>('.tv-ko__bar') ?? null;
  const body = ko?.querySelector<HTMLElement>('.tv-ko__body') ?? null;
  motion.fade(els.center, 0, 160);
  motion.fade(els.markers, 0.25, 240);
  motion.line(bar, 320, { delay: 100 });
  [...(body?.children ?? [])].forEach((c, i) =>
    motion.rise(c as HTMLElement, i === 1 ? 16 : 8, i === 1 ? 420 : 320, { delay: 160 + i * 120 }),
  );
  if (seat !== null) {
    motion.fade(els.names.get(seat), 0.3, 600, { delay: 900 });
    motion.after(1500, () =>
      h.setGm((g) => ({
        ...g,
        outSeats: new Set([...g.outSeats, seat]),
        vylet: new Map([...g.vylet, [seat, { show: false, fold: false }]]),
      })),
    );
  }
  // Уход карточки (3200): текст гаснет, линейка стягивается к центру — и у места встаёт флап.
  motion.after(3200, () => {
    motion.fade(body, 0, 220, { easing: EASE.exit });
    if (motion.calm) motion.fade(bar, 0, 200);
    else
      motion.A(bar, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], 320, {
        easing: EASE.exit,
        keep: true,
      });
  });
  if (seat !== null) {
    motion.after(3260, () =>
      h.setGm((g) => ({ ...g, vylet: new Map([...g.vylet, [seat, { show: true, fold: false }]]) })),
    );
  }
  motion.after(3700, () => {
    motion.fade(els.center, 1, 240);
    motion.fade(els.markers, 1, 300);
  });
  // «В игре» — на одного меньше: перелистывается, когда центр стола уже виден целиком.
  motion.after(4100, () => {
    release();
    if (seat !== null) {
      h.setGm((g) => {
        const outSeats = new Set(g.outSeats);
        outSeats.delete(seat);
        return { ...g, outSeats };
      });
    }
  });
  motion.after(4700, () => {
    h.setGm((g) => ({ ...g, ko: null }));
    finish();
  });
  if (seat !== null) {
    motion.after(16_000, () =>
      h.setGm((g) => {
        const v = g.vylet.get(seat);
        return v ? { ...g, vylet: new Map([...g.vylet, [seat, { ...v, fold: true }]]) } : g;
      }),
    );
  }
}

export interface AllinEls {
  ai: HTMLElement | null;
  inner: HTMLElement | null;
  wipe: HTMLElement | null;
  level: HTMLElement | null;
}

/** Часы тем же элементом уезжают в угол (translate + scale, 480, move); спокойно — гаснут и встают. */
export function clockTo(
  motion: Motion,
  clock: HTMLElement | null,
  corner: boolean,
  delay: number,
): void {
  if (!clock) return;
  const a = corner ? CLOCK_HOME : CLOCK_CORNER;
  const b = corner ? CLOCK_CORNER : CLOCK_HOME;
  motion.after(delay, () => {
    if (motion.calm) {
      motion.A(clock, [{ opacity: 1 }, { opacity: 0 }], 120, {
        keep: true,
        done: () => {
          clock.style.transform = b;
          motion.A(clock, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
        },
      });
      return;
    }
    motion.move(clock, a, b, 480, { easing: EASE.move });
  });
}

/** Линия шторки идёт ровно по кромке открывающегося слоя: та же кривая и длительность, потом гаснет. */
function wipeLine(motion: Motion, wipe: HTMLElement | null, d: number): void {
  if (!wipe) return;
  motion.A(wipe, [{ transform: 'translateX(0px)' }, { transform: 'translateX(1918px)' }], d, {
    easing: EASE.flat,
    keep: true,
  });
  wipe.style.opacity = '1';
  motion.after(d, () => motion.A(wipe, [{ opacity: 1 }, { opacity: 0 }], 120, { keep: true }));
}

/**
 * Вход в олл-ин: шторка линией — слой олл-ина открывается слева направо за янтарной линией (760),
 * часы — поверх, переезжают в угол; уровень рядом с часами — когда часы встали (без наезда).
 * Возвращает отмену отложенных тактов входа: возврат к столу, начатый раньше, чем вход доиграл
 * (раздача пропала за 640 мс, вкладка была спрятана), не должен получить запоздалое «уровень
 * рядом с часами» поверх стола.
 */
export function playEnter(
  motion: Motion,
  els: GameEls,
  ai: AllinEls,
  done: () => void,
): () => void {
  devMark('enter');
  motion.fade(els.lvl, 0, 100);
  if (ai.ai && ai.inner) {
    ai.ai.style.visibility = 'visible';
    if (motion.calm) motion.A(ai.ai, [{ opacity: 0 }, { opacity: 1 }], 320, { keep: true });
    else {
      motion.A(
        ai.ai,
        [{ transform: 'translateX(-1920px)' }, { transform: 'translateX(0px)' }],
        760,
        {
          easing: EASE.flat,
          keep: true,
        },
      );
      motion.A(
        ai.inner,
        [{ transform: 'translateX(1920px)' }, { transform: 'translateX(0px)' }],
        760,
        {
          easing: EASE.flat,
          keep: true,
        },
      );
      wipeLine(motion, ai.wipe, 760);
    }
  }
  clockTo(motion, els.clock, true, 80);
  const ids = [motion.after(640, () => motion.fade(ai.level, 1, 240)), motion.after(760, done)];
  return () => {
    for (const id of ids) motion.cancel(id);
  };
}

/**
 * Возврат к столу: шторка обратно (700), часы на место; стол проявился целиком — затем подписи мест
 * по одной с шагом 30 мс (по часовой от ближнего левого). Нокаут после олл-ина — на столе, когда
 * стол уже стоит (через 1,3 с).
 */
export function playBack(motion: Motion, els: GameEls, ai: AllinEls, done: () => void): void {
  devMark('back');
  for (const el of els.labels.values()) {
    motion.cancelOn(el);
    el.style.opacity = '0';
  }
  if (ai.ai && ai.inner) {
    if (motion.calm) motion.A(ai.ai, [{ opacity: 1 }, { opacity: 0 }], 320, { keep: true });
    else {
      motion.A(
        ai.ai,
        [{ transform: 'translateX(0px)' }, { transform: 'translateX(1920px)' }],
        700,
        {
          easing: EASE.flat,
          keep: true,
        },
      );
      motion.A(
        ai.inner,
        [{ transform: 'translateX(0px)' }, { transform: 'translateX(-1920px)' }],
        700,
        {
          easing: EASE.flat,
          keep: true,
        },
      );
      wipeLine(motion, ai.wipe, 700);
    }
  }
  motion.fade(ai.level, 0, 120);
  clockTo(motion, els.clock, false, 120);
  motion.fade(els.lvl, 1, 240, { delay: 640 });
  motion.after(720, () => {
    const layer = ai.ai;
    if (layer) {
      motion.cancelOn(layer);
      layer.style.visibility = 'hidden';
      layer.style.opacity = '';
      layer.style.transform = '';
    }
    done();
  });
  [...els.labels.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([seat, el]) => {
      if (motion.calm) {
        motion.fade(el, 1, 200, { delay: 760 });
        return;
      }
      motion.after(760 + (seat - 1) * 30, () =>
        motion.A(
          el,
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0px)' },
          ],
          260,
          { easing: EASE.quiet, keep: true },
        ),
      );
    });
}

/** Первый кадр посреди олл-ина: часы сразу в углу, слой олл-ина открыт. */
export function settleAllin(els: GameEls, ai: AllinEls): void {
  if (els.clock) els.clock.style.transform = CLOCK_CORNER;
  if (ai.level) ai.level.style.opacity = '1';
  if (ai.ai) ai.ai.style.visibility = 'visible';
  if (els.lvl) els.lvl.style.opacity = '0';
}
