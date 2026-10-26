// Бомб-пот на табло ТВ: DOM и движение сцены (что и когда — bombScene.ts, моменты — moments.ts,
// очередь — TvBoard). Перенос сцены одобренного макета tv-bomb/v2 с поправками судей и решениями
// пользователя: один борд, флоп рубашками, переброс — новый бросок с пометкой.
//
// Почему так устроено:
// - React рисует только две пустые подложки (bombPanel — в левой колонке, bombTable — на столе); их
//   содержимое строит режиссёр: флапы, карты и подписи живут, пока идёт бомб-пот, а движение у них —
//   тактами на часах табло (motion.ts), как у моментов уровня и нокаута. Тексты — только textContent.
// - Двигаются только transform и opacity: цвет таблички у места забравшего — второй, янтарный ряд
//   поверх тёмного, плитки проявляются по одной (как «ВЫЛЕТ» — красный).
// - Один центр внимания за раз: на розыгрыше стол в тени, на взносах панель отдаёт взгляд столу.
// - Отмена снимает всё запланированное сценой (stopBeats) и честно доводит окно до выпавшего: на
//   экране не остаётся промежуточного числа.
// - Спокойный режим (motion.calm): ячейки шкалы загораются одним проходом до выпавшего, взносы не
//   летят (места загораются разом, банк — итоговым числом), карты проявляются, табличка — на месте.
import type { BombPotState, PlayerId } from '@domain/types.ts';
import type { Announcement } from '@domain/voice.ts';
import type { NameOf } from '../../evening/lib';
import { rollPlan } from '../../evening/bombPotView';
import {
  bombColumn,
  CANCEL,
  CARD,
  formText,
  inNest,
  oddsText,
  POT,
  potRowWidth,
  RESULT,
  resultCaption,
  scaleCells,
  sceneBeats,
  FULL_PACE,
  type ScenePace,
  seatNest,
  STAKE_FLY,
  STAKE_HOLD,
  STAKE_STEP,
  STAKE_UP,
  stakeFlapText,
  stakeTarget,
  TAG,
  TAG_W,
  UNSEATED_ORIGIN,
  type BombColumn,
} from './bombScene';
import { clockTo } from './choreo';
import { Flap, FlapRow, type FlapRowStyle, type FlapStyle } from './flap';
import type { Riffle } from './flapLogic';
import { devMark, EASE, type Motion } from './motion';
import type { GameEls } from './stage';
import { MARKER_D_W, markerXY, seatPoint, TABLE_CX } from './tableLayout';
import { formatNumber } from '../../../shared/lib/format';

const TITLE: FlapRowStyle = {
  w: 62,
  h: 92,
  fs: 84,
  wt: 800,
  ink: 'var(--ink)',
  s: 2,
  gap: 6,
  dy: 1,
};
const CANCEL_ROW: FlapRowStyle = { ...TITLE, ink: 'var(--ink-muted)' };
const HERO: FlapStyle = { w: 156, h: 224, fs: 216, wt: 800, ink: 'var(--ink)', s: 3, dy: 2 };
const STAKE: FlapRowStyle = {
  w: 58,
  h: 82,
  fs: 76,
  wt: 800,
  ink: 'var(--ink)',
  s: 2,
  gap: 6,
  dy: 1,
};
const TAG_DARK: FlapRowStyle = {
  w: TAG.w,
  h: TAG.h,
  fs: TAG.fs,
  wt: 800,
  ink: 'var(--accent)',
  s: 2,
  gap: TAG.gap,
  dy: 1,
  ax: false,
};
const TAG_LIT: FlapRowStyle = {
  ...TAG_DARK,
  ink: 'var(--on-accent)',
  bg: 'var(--accent)',
  bgb: 'var(--tv-accent-bottom)',
  cellCls: 'tv-fp--notch',
};
const TAG_MUTED: FlapRowStyle = { ...TAG_DARK, ink: 'var(--ink-muted)' };
const POT_ROW: FlapRowStyle = {
  w: POT.w,
  h: POT.h,
  fs: POT.fs,
  wt: 800,
  ink: 'var(--ink)',
  s: 2,
  gap: POT.gap,
  dy: 1,
  ax: false,
};
const MINI: FlapRowStyle = {
  w: 22,
  h: 32,
  fs: 26,
  wt: 800,
  ink: 'var(--ink)',
  s: 2,
  gap: 2,
  dy: 1,
  ax: false,
};

const WORD = 'БОМБ-ПОТ';
const CANCEL_WORD = 'ОТМЕНЁН';

/** Что сцене нужно знать о бомб-поте и столе. */
export interface BombInput {
  bombPot: BombPotState;
  nameOf: NameOf;
  /** Стол-схема (места по сукну) или список без рассадки. */
  table: boolean;
  /** Место метки баттона — столбец бейджа уходит от неё. */
  dSeat: number | null;
  /** Место участника сейчас (пересел после объявления — к новому месту), null — без места. */
  seatOf: (playerId: PlayerId) => number | null;
  /** Первое слово сейчас (вылетел — следующий участник в игре). */
  firstToAct: PlayerId | null;
}

export interface BombHooks {
  els: GameEls;
  /** «Уровень 6 · 50/100» рядом с часами в углу (тот же элемент, что в олл-ине). */
  aiLevel: HTMLElement | null;
  say: (a: Announcement) => void;
  /** Минуты часов на время сцены белые: янтарь отдан исходу. */
  setClockPlain: (plain: boolean) => void;
  /** true — экран показывает бомб-пот (метки SB и BB гаснут, центр стола — бейджу); false — нет. */
  setShown: (shown: boolean) => void;
  /** Момент доиграл — очередь табло идёт дальше. */
  done: () => void;
}

export interface EndInput extends BombInput {
  winners: PlayerId[];
  /** Баттон остался на месте (решение 8): у метки D — «баттон остаётся». */
  buttonStays: boolean;
}

interface PanelParts {
  root: HTMLElement;
  rule: HTMLElement;
  ruleMuted: HTMLElement;
  titleBox: HTMLElement;
  title: FlapRow;
  cancelBox: HTMLElement;
  cancel: FlapRow;
  body: HTMLElement;
  odds: HTMLElement;
  scale: HTMLElement;
  cells: { root: HTMLElement; cur: HTMLElement; fill: HTMLElement; wt: HTMLElement }[];
  heroBox: HTMLElement;
  hero: Flap;
  bb: HTMLElement;
  stake: HTMLElement;
  stakeEb: HTMLElement;
  stakeRowBox: HTMLElement;
  stakeRow: FlapRow;
  flop: HTMLElement;
  lit: number;
}

interface TagParts {
  root: HTMLElement;
  dark: FlapRow;
  lit: FlapRow;
}

interface TableParts {
  root: HTMLElement;
  column: BombColumn;
  tag: TagParts;
  cards: HTMLElement[];
  pot: HTMLElement;
  potRow: FlapRow;
  potText: string;
  form: HTMLElement;
  first: HTMLElement | null;
  stakes: { el: HTMLElement; from: [number, number]; to: [number, number] }[];
  extra: HTMLElement[];
}

function div(cls: string, parent?: HTMLElement | null, text?: string): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

function span(cls: string, parent: HTMLElement, text: string): HTMLSpanElement {
  const e = document.createElement('span');
  e.className = cls;
  e.textContent = text;
  parent.append(e);
  return e;
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

/** Плитки ряда без знаков (печать «/» и узкие пробелы остаются). */
function blank(text: string): string {
  return [...text].map((c) => (/[0-9A-Za-zА-Яа-яЁё-]/.test(c) ? ' ' : c)).join('');
}

export class BombDirector {
  private ids: number[] = [];
  private p: PanelParts | null = null;
  private t: TableParts | null = null;
  /** Что на экране: idle — ничего, scene — сцена объявления, steady — бейдж раздачи. */
  mode: 'idle' | 'scene' | 'steady' | 'end' | 'cancel' = 'idle';
  /** Чей бейдж стоит (eventId · место D · первое слово): тот же — перестраивать незачем. */
  steadyKey: string | null = null;
  private panelOn = false;
  private rollEndAt = 0;
  private bbs = 0;
  private readonly motion: Motion;
  private readonly riffle: Riffle;

  constructor(motion: Motion, riffle: Riffle) {
    this.motion = motion;
    this.riffle = riffle;
  }

  private at(ms: number, fn: () => void): void {
    this.ids.push(this.motion.after(ms, fn));
  }

  private stopBeats(): void {
    for (const id of this.ids) this.motion.cancel(id);
    this.ids = [];
  }

  // --- Строительство ------------------------------------------------------------------------

  private buildPanel(els: GameEls, bp: BombPotState): PanelParts | null {
    const root = els.bombPanel;
    if (!root) return null;
    this.motion.cancelOn(root);
    root.replaceChildren();
    root.style.opacity = '1';
    root.style.visibility = 'visible';
    const rule = div('tv-bp__rule', root);
    const ruleMuted = div('tv-bp__rule tv-bp__rule--muted', root);
    const titleBox = div('tv-bp__title', root);
    const title = new FlapRow(this.motion, this.riffle, titleBox, ' '.repeat(WORD.length), TITLE);
    const cancelBox = div('tv-bp__cancel', root);
    const cancel = new FlapRow(
      this.motion,
      this.riffle,
      cancelBox,
      ' '.repeat(CANCEL_WORD.length),
      CANCEL_ROW,
    );
    const body = div('tv-bp__body tv-layer', root);
    const odds = div('tv-bp__odds tv-eb', body);
    const o = oddsText(bp);
    odds.textContent = o.text;
    if (o.struck) {
      odds.append(' ');
      span('tv-bp__struck', odds, o.struck);
    }
    const scale = div('tv-bp__scale', body);
    const cells = scaleCells(bp.bb).map(({ k, value }) => {
      const cell = div('tv-bp__cell', scale);
      const face = (cls: string) => {
        const f = div(`tv-bp__face ${cls}`, cell);
        const kk = span('tv-bp__k', f, String(k));
        span('tv-bp__unit', kk, 'BB');
        span('tv-bp__v', f, value);
        return f;
      };
      face('tv-bp__face--base');
      const cur = face('tv-bp__face--cur');
      const fill = div('tv-bp__fill', cell);
      const wt = face('tv-bp__face--wt');
      return { root: cell, cur, fill, wt };
    });
    const heroBox = div('tv-bp__hero', body);
    const hero = new Flap(this.motion, heroBox, HERO, ' ');
    const bb = div('tv-bp__bb', body, 'BB');
    const stake = div('tv-bp__stake', root);
    const stakeEb = div('tv-eb', stake, 'Взнос');
    const stakeRowBox = div('tv-bp__stakerow', stake);
    const stakeText = stakeFlapText(bp);
    const stakeRow = new FlapRow(this.motion, this.riffle, stakeRowBox, blank(stakeText), STAKE);
    const flop = div('tv-bp__flop', root, 'Флоп сразу');
    span('tv-bp__flopsub', flop, ' · префлопа нет');
    for (const el of [
      rule,
      ruleMuted,
      titleBox,
      cancelBox,
      odds,
      scale,
      heroBox,
      bb,
      stake,
      flop,
    ]) {
      el.style.opacity = '0';
    }
    rule.style.opacity = '1';
    rule.style.transform = 'scaleX(0)';
    return {
      root,
      rule,
      ruleMuted,
      titleBox,
      title,
      cancelBox,
      cancel,
      body,
      odds,
      scale,
      cells,
      heroBox,
      hero,
      bb,
      stake,
      stakeEb,
      stakeRowBox,
      stakeRow,
      flop,
      lit: 0,
    };
  }

  private buildTag(root: HTMLElement, x: number, y: number, text: string): TagParts {
    const box = div('tv-bt__tag', root);
    place(box, x, y);
    const darkBox = div('tv-bt__tagrow', box);
    const dark = new FlapRow(this.motion, this.riffle, darkBox, text, TAG_DARK);
    const litBox = div('tv-bt__tagrow', box);
    const lit = new FlapRow(this.motion, this.riffle, litBox, WORD, TAG_LIT);
    for (const c of lit.flaps) c.el.style.opacity = '0';
    return { root: box, dark, lit };
  }

  /** Бейдж раздачи на столе; steady — сразу в покое (поздняя запись, первый кадр). */
  private buildTable(els: GameEls, input: BombInput, steady: boolean): TableParts | null {
    const root = els.bombTable;
    if (!root) return null;
    this.motion.cancelOn(root);
    root.replaceChildren();
    root.style.opacity = '1';
    const bp = input.bombPot;
    const column = input.table ? bombColumn(input.dSeat) : listColumn();
    const centerX = input.table ? TABLE_CX : null;
    const tag = this.buildTag(
      root,
      centerX === null ? column.tag.x : centerX - TAG_W / 2,
      column.tag.y,
      steady ? WORD : ' '.repeat(WORD.length),
    );
    const cards = input.table
      ? [0, 1, 2].map((i) => {
          const c = div('tv-card tv-bt__card', root);
          place(c, column.cards.x + i * (CARD.w + CARD.gap), column.cards.y);
          c.style.width = `${CARD.w}px`;
          c.style.height = `${CARD.h}px`;
          div('tv-card__side tv-card__back', c);
          return c;
        })
      : [];
    const potText = formatNumber(bp.pot);
    const potW = potRowWidth(potText);
    const pot = div('tv-bt__pot', root);
    place(pot, centerX === null ? column.cards.x : centerX - potW / 2, column.potY);
    const potRow = new FlapRow(
      this.motion,
      this.riffle,
      pot,
      steady ? potText : blank(potText),
      POT_ROW,
    );
    const form = div(input.table ? 'tv-bt__form' : 'tv-bt__form tv-bt__form--list', root);
    form.textContent = formText(bp);
    if (input.table) form.style.top = `${column.formY}px`;
    else place(form, column.cards.x + potW + 24, column.potY + POT.h - 30);
    const firstSeat = input.firstToAct ? input.seatOf(input.firstToAct) : null;
    let first: HTMLElement | null = null;
    if (input.table && firstSeat !== null) {
      const n = seatNest(firstSeat);
      first = div('tv-bt__first', root);
      place(first, n.x, n.y);
      first.style.width = `${n.w}px`;
      first.style.height = `${n.h}px`;
      first.style.justifyContent = n.justify;
      span('tv-bt__firsttext', first, 'Первое слово');
    }
    const stakes: TableParts['stakes'] = [];
    if (input.table && !steady) {
      const st = formatNumber(bp.stake);
      const len = [...st].length;
      const w = len * MINI.w + (len - 1) * (MINI.gap ?? 2);
      const potRect = { x: TABLE_CX - potW / 2, y: column.potY, w: potW, h: POT.h };
      for (const id of bp.players) {
        const seat = input.seatOf(id);
        const from: [number, number] =
          seat !== null ? inNest(seat, w, MINI.h) : [UNSEATED_ORIGIN[0], UNSEATED_ORIGIN[1]];
        const c: [number, number] = [from[0] + w / 2, from[1] + MINI.h / 2];
        const target = stakeTarget(c, potRect);
        const el = div('tv-bt__mf', root);
        new FlapRow(this.motion, this.riffle, el, st, MINI);
        el.style.opacity = '0';
        stakes.push({ el, from, to: [target[0] - w / 2, target[1] - MINI.h / 2] });
      }
    }
    const parts: TableParts = {
      root,
      column,
      tag,
      cards,
      pot,
      potRow,
      potText,
      form,
      first,
      stakes,
      extra: [],
    };
    const shown = steady ? '1' : '0';
    for (const el of [tag.root, ...cards, pot, form, ...(first ? [first] : [])])
      el.style.opacity = shown;
    return parts;
  }

  // --- Покой ----------------------------------------------------------------------------------

  /** Бейдж раздачи сразу, без сцены: табло открыли посреди бомб-пота, запись несвежая, сцена доиграла. */
  steady(els: GameEls, input: BombInput, key: string): void {
    this.stopBeats();
    this.hidePanel(els);
    this.t = this.buildTable(els, input, true);
    this.bbs = input.bombPot.bbs;
    this.mode = 'steady';
    this.steadyKey = key;
  }

  /** Убрать всё сразу (бомб-пот закрыт финишем, спрятан временем, табло ушло с вечера). */
  clear(els: GameEls, fade = false): void {
    this.stopBeats();
    this.hidePanel(els);
    const root = els.bombTable;
    if (root && fade) {
      this.motion.fade(root, 0, 240, {
        done: () => {
          root.replaceChildren();
          root.style.opacity = '1';
        },
      });
    } else if (root) {
      this.motion.cancelOn(root);
      root.replaceChildren();
      root.style.opacity = '1';
    }
    this.t = null;
    this.mode = 'idle';
    this.steadyKey = null;
  }

  private hidePanel(els: GameEls): void {
    const root = els.bombPanel;
    if (root) {
      this.motion.cancelOn(root);
      root.replaceChildren();
      root.style.visibility = 'hidden';
    }
    this.p = null;
    this.panelOn = false;
  }

  // --- Сцена объявления -----------------------------------------------------------------------

  /**
   * Сцена объявления. pace — темп (scenePace): сцена, которая ждала в очереди, сокращает вступление
   * и круги перебора, чтобы взнос встал на табло раньше, чем на телефонах (решение 10); вступление
   * (линейка, «БОМБ-ПОТ», шкала) сжимается пропорционально.
   */
  play(input: BombInput, hooks: BombHooks, pace: ScenePace = FULL_PACE): void {
    const m = this.motion;
    const { els } = hooks;
    this.stopBeats();
    this.clear(els);
    this.mode = 'scene';
    this.steadyKey = null;
    devMark('bomb');
    const bp = input.bombPot;
    this.bbs = bp.bbs;
    const p = this.buildPanel(els, bp);
    this.p = p;
    this.panelOn = p !== null;
    const beats = sceneBeats(bp.bbs, bp.players.length, m.calm, pace);
    const plan = rollPlan(bp.bbs, pace.laps);
    this.rollEndAt = m.now + beats.rollStart + (m.calm ? bp.bbs * 300 + 200 : plan.end);
    // Вступление — в долях полного (1,2 с): шкала и окно встают до первого листа перебора.
    const intro = (ms: number) => Math.round((ms * beats.rollStart) / FULL_PACE.rollStart);

    // 0–600: стол в тень, колонка уходит, часы — в угол; метки SB и BB гаснут (блайндов нет).
    m.fade(els.tableBase, 0.4, 320);
    // «В игре» в центре стола уступает место бейджу (без рассадки список остаётся, место — бейджу).
    if (input.table) m.fade(els.center, 0, 200);
    for (const el of columnEls(els)) m.fade(el, 0, 200);
    clockTo(m, els.clock, true, 80);
    this.at(220, () => hooks.setShown(true));
    this.at(300, () => hooks.setClockPlain(true));
    m.fade(hooks.aiLevel, 1, 240, { delay: 640 });
    if (p) {
      this.at(intro(120), () => m.line(p.rule, intro(450)));
      m.fade(p.titleBox, 1, 200, { delay: intro(160) });
      this.at(intro(260), () => {
        if (m.calm) p.title.set(WORD);
        else p.title.flip(WORD, { stagger: intro(60) });
      });
      m.rise(p.odds, 8, intro(320), { delay: intro(700) });
      m.fade(p.scale, 1, 120, { delay: intro(700) });
      p.cells.forEach((c, i) => {
        c.root.style.opacity = '0';
        m.rise(c.root, 8, intro(320), { delay: intro(760 + i * 40) });
      });
      m.fade(p.heroBox, 1, intro(320), { delay: intro(900) });
      m.fade(p.bb, 1, intro(320), { delay: intro(900) });
    }
    this.at(beats.voiceBomb, () => hooks.say({ kind: 'bomb_pot' }));

    // rollStart (1,2 с в полном темпе): розыгрыш — окно листает 1…5 (два круга, в спешке — меньше) с
    // замедлением и садится на выпавшем.
    if (p) {
      if (m.calm) {
        for (let v = 1; v <= bp.bbs; v += 1)
          this.at(beats.rollStart + (v - 1) * 300, () => this.lightCell(v));
        this.at(beats.rollStart + bp.bbs * 300, () => {
          p.hero.set(String(bp.bbs));
          m.A(p.heroBox, [{ opacity: 0.25 }, { opacity: 1 }], 200, { keep: true });
        });
      } else {
        plan.starts.forEach((st, j) => {
          const v = plan.values[j] ?? 1;
          const dur = plan.durations[j] ?? 0;
          const last = j === plan.flips - 1;
          this.at(beats.rollStart + st, () =>
            p.hero.turn(String(v), dur, { bounce: last, heavy: last }),
          );
          this.at(beats.rollStart + st + Math.round(dur / 2), () => this.lightCell(v));
        });
      }
    }
    this.at(beats.hit, () => this.settleRoll(els));
    this.at(beats.voiceStake, () => hooks.say({ kind: 'bomb_stake', bbs: bp.bbs }));

    // Второй шаг раскрытия: «ВЗНОС 300».
    if (p) {
      this.at(beats.stake, () => {
        m.fade(p.stake, 1, 1);
        p.stakeEb.style.opacity = '0';
        m.rise(p.stakeEb, 8, 320);
        p.stakeRowBox.style.opacity = '0';
        m.fade(p.stakeRowBox, 1, 120, { delay: 20 });
        const text = stakeFlapText(bp);
        this.at(60, () => {
          if (m.calm) p.stakeRow.set(text);
          else p.stakeRow.flip(text, { drum: 'up', lowFirst: true, stagger: 60, maxVia: 1 });
        });
      });
    }

    // Взносы: панель отдаёт взгляд столу, взносы встают у мест и сходятся к банку.
    this.at(beats.stakes, () => this.playStakes(els, input, beats.converge - beats.stakes));
    this.at(beats.tag, () => this.showTag());
    this.at(beats.flop, () => this.playFlop());
    this.at(beats.exit, () => this.exitPanel(hooks));
    this.at(beats.end, () => {
      this.mode = 'steady';
      this.steadyKey = null;
      hooks.done();
    });
  }

  /** Подсветить ячейку шкалы, на которой сейчас окно. */
  private lightCell(v: number): void {
    const p = this.p;
    if (!p) return;
    const prev = p.cells[p.lit - 1];
    if (prev) prev.cur.style.opacity = '0';
    const cell = p.cells[v - 1];
    if (cell) cell.cur.style.opacity = '1';
    p.lit = v;
  }

  /** Удар: цифра янтарём, ячейка заливается шторкой слева, стол просыпается; шкала уходит целиком. */
  private settleRoll(els: GameEls): void {
    const m = this.motion;
    const p = this.p;
    if (!p) return;
    p.hero.setInk('var(--accent)');
    const cell = p.cells[this.bbs - 1];
    if (cell) {
      if (m.calm) {
        cell.fill.style.transform = 'scaleX(1)';
        m.A(cell.fill, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
        cell.wt.style.opacity = '1';
        cell.cur.style.opacity = '0';
      } else {
        m.A(cell.fill, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 180, {
          easing: EASE.enter,
          keep: true,
        });
        this.at(140, () => {
          cell.wt.style.opacity = '1';
          cell.cur.style.opacity = '0';
        });
      }
    }
    m.fade(els.tableBase, 0.7, 320);
    // Шкала — память «из пяти» на полсекунды, потом уходит целиком: одинокой ячейки не остаётся.
    m.fade(p.scale, 0, 240, { delay: 680 });
    if (this.p?.odds && !p.odds.querySelector('.tv-bp__struck'))
      m.fade(p.odds, 0, 200, { delay: 680 });
  }

  private playStakes(els: GameEls, input: BombInput, convergeIn: number): void {
    const m = this.motion;
    const p = this.p;
    if (p) {
      // Окно и «BB» уходят, «ВЗНОС 300» переезжает под заголовок: на панели — одна строка.
      m.fade(p.heroBox, 0, 240);
      m.fade(p.bb, 0, 240);
      m.fade(p.odds, 0, 200);
      const dx = 96 - p.stake.offsetLeft;
      if (dx !== 0) m.move(p.stake, 'translateX(0px)', `translateX(${dx}px)`, 320, { delay: 120 });
    }
    m.fade(els.tableBase, 1, 320);
    const t = this.buildTable(els, input, false);
    this.t = t;
    if (!t) return;
    const n = t.stakes.length;
    if (m.calm) {
      for (const s of t.stakes) {
        s.el.style.transform = `translate(${s.from[0]}px, ${s.from[1]}px)`;
        m.fade(s.el, 1, 200, { delay: 200 });
        m.fade(s.el, 0, 200, { delay: 1100 });
      }
      this.at(convergeIn, () => {
        t.potRow.set(t.potText);
        m.fade(t.pot, 1, 200);
      });
    } else {
      const fly = Math.max(0, n - 1) * STAKE_STEP + STAKE_UP + STAKE_HOLD;
      t.stakes.forEach((s, i) => {
        const a = `translate(${s.from[0]}px, ${s.from[1]}px)`;
        const b = `translate(${s.to[0]}px, ${s.to[1]}px)`;
        const mid: [number, number] = [
          s.from[0] + (s.to[0] - s.from[0]) * 0.8,
          s.from[1] + (s.to[1] - s.from[1]) * 0.8,
        ];
        s.el.style.transform = `${a} scale(1, 0.2)`;
        this.at(i * STAKE_STEP, () =>
          m.A(
            s.el,
            [
              { opacity: 0, transform: `${a} scale(1, 0.2)` },
              { opacity: 1, transform: `${a} scale(1, 1)` },
            ],
            STAKE_UP,
            { easing: EASE.enter, keep: true },
          ),
        );
        // Одно схождение: все взносы летят разом и гаснут до кромки банка.
        this.at(fly, () =>
          m.A(
            s.el,
            [
              { opacity: 1, transform: `${a} scale(1, 1)`, offset: 0 },
              {
                opacity: 1,
                transform: `translate(${mid[0].toFixed(1)}px, ${mid[1].toFixed(1)}px) scale(1, 1)`,
                offset: 0.8,
              },
              { opacity: 0, transform: `${b} scale(0.6, 0.6)`, offset: 0.92 },
              { opacity: 0, transform: `${b} scale(0.6, 0.6)`, offset: 1 },
            ],
            STAKE_FLY,
            { easing: EASE.move, keep: true },
          ),
        );
      });
      this.at(convergeIn - 160, () => m.fade(t.pot, 1, 120));
      this.at(convergeIn - 100, () =>
        t.potRow.flip(t.potText, { drum: 'up', maxVia: 3, stagger: 40, lowFirst: true }),
      );
    }
    this.at(convergeIn + 160, () => m.rise(t.form, 6, 320));
  }

  private showTag(): void {
    const m = this.motion;
    const t = this.t;
    if (!t) return;
    m.fade(t.tag.root, 1, 160);
    if (m.calm) t.tag.dark.set(WORD);
    else t.tag.dark.flip(WORD, { stagger: 50 });
  }

  private playFlop(): void {
    const m = this.motion;
    const t = this.t;
    const p = this.p;
    if (t) {
      t.cards.forEach((c, i) => {
        this.at(i * 90, () => {
          if (m.calm) {
            m.A(c, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
            return;
          }
          m.A(
            c,
            [
              { opacity: 0, transform: 'translateY(-16px)' },
              { opacity: 1, transform: 'translateY(0px)' },
            ],
            260,
            { easing: EASE.quiet, keep: true },
          );
        });
      });
      if (t.first) m.rise(t.first, 6, 320, { delay: 400 });
    }
    if (p) {
      // «ФЛОП СРАЗУ · ПРЕФЛОПА НЕТ» встаёт в слот взноса (кросс-фейд), а не новой строкой.
      m.fade(p.stake, 0, 200);
      m.rise(p.flop, 8, 320, { delay: 160 });
    }
  }

  private exitPanel(hooks: BombHooks): void {
    const m = this.motion;
    const { els } = hooks;
    if (!this.panelOn) return;
    this.panelOn = false;
    const root = els.bombPanel;
    if (root) {
      m.fade(root, 0, 200, {
        easing: EASE.exit,
        done: () => {
          root.style.visibility = 'hidden';
          root.replaceChildren();
          root.style.opacity = '1';
        },
      });
    }
    this.p = null;
    m.fade(hooks.aiLevel, 0, 120);
    this.at(220, () => hooks.setClockPlain(false));
    clockTo(m, els.clock, false, 220);
    for (const el of columnEls(els)) m.fade(el, 1, 240, { delay: 400 });
  }

  // --- Отмена ---------------------------------------------------------------------------------

  /**
   * Отмена: всё запланированное снимается; окно доводится до выпавшего (промежуточного числа на
   * экране не остаётся), под заголовком — «ОТМЕНЁН» приглушённо, линейка гаснет; на столе бейдж
   * тускнеет и рядом — «ОТМЕНЁН». Выдержка, потом всё уходит. Голос молчит.
   */
  cancel(hooks: BombHooks): void {
    const m = this.motion;
    const { els } = hooks;
    this.stopBeats();
    this.mode = 'cancel';
    this.steadyKey = null;
    devMark('bomb_cancel');
    const p = this.p;
    const dim = (el: HTMLElement | null | undefined) => {
      if (!el) return;
      const now = Number(getComputedStyle(el).opacity);
      m.fade(el, Math.min(0.25, Number.isFinite(now) ? now : 1), 200);
    };
    if (p && this.panelOn) {
      const k = String(this.bbs);
      const shownNow = p.hero.ch;
      if (shownNow !== ' ' && m.now < this.rollEndAt) {
        p.hero.set(shownNow);
        if (shownNow !== k) p.hero.turn(k, 180);
        this.lightCell(this.bbs);
      }
      m.fade(p.rule, 0, 200);
      m.fade(p.ruleMuted, 1, 200);
      m.fade(p.titleBox, 1, 200);
      // Под «ОТМЕНЁН» — пусто: строка шансов и шкала уходят; выпавшее окно тихо остаётся — бросок
      // был, он отменён (в ленте он тоже виден).
      for (const el of [p.odds, p.scale, p.stake, p.flop]) m.fade(el, 0, 200);
      for (const el of [p.heroBox, p.bb]) dim(el);
      m.fade(p.cancelBox, 1, 120);
      if (m.calm) p.cancel.set(CANCEL_WORD);
      else p.cancel.flip(CANCEL_WORD, { riffle: 1, stagger: 40 });
    }
    const t = this.t;
    if (t) {
      // Табличка гаснет, флоп и банк уходят — на их месте «ОТМЕНЁН» (замечание судей к v2).
      for (const el of [...t.cards, t.pot, t.form, t.first, ...t.stakes.map((s) => s.el)]) {
        m.fade(el, 0, 200);
      }
      m.fade(t.tag.root, 0.4, 200);
      // На столе (панели нет — бомб-пот отменили посреди раздачи): «ОТМЕНЁН» на месте флопа.
      if (!this.panelOn && t.cards.length > 0) {
        const box = div('tv-bt__cancel', t.root);
        place(
          box,
          TABLE_CX - (CANCEL_WORD.length * TAG.w + (CANCEL_WORD.length - 1) * TAG.gap) / 2,
          t.column.cards.y + CARD.h / 2 - TAG.h / 2,
        );
        const row = new FlapRow(
          this.motion,
          this.riffle,
          box,
          ' '.repeat(CANCEL_WORD.length),
          TAG_MUTED,
        );
        t.extra.push(box);
        if (m.calm) row.set(CANCEL_WORD);
        else row.flip(CANCEL_WORD, { riffle: 1, stagger: 40 });
      }
    }
    this.at(CANCEL.hold, () => {
      this.exitPanel(hooks);
      m.fade(els.tableBase, 1, 320);
      const root = els.bombTable;
      if (root) m.fade(root, 0, 200);
      this.at(200, () => hooks.setShown(false));
    });
    this.at(CANCEL.done, () => {
      this.clear(els);
      hooks.done();
    });
  }

  // --- Развязка -------------------------------------------------------------------------------

  /**
   * «Кто забрал»: табличка сама летит к месту забравшего (делёж — копия к каждому), садится и
   * заливается янтарём; под именем — черта, в центре — «БОМБ-ПОТ ЗАБИРАЕТ КОСТЯ» без суммы; потом
   * метки SB и BB встают на те же места (баттон стоит) и у D — «баттон остаётся». Не отмечали —
   * бейдж просто уходит.
   */
  end(input: EndInput, hooks: BombHooks): void {
    const m = this.motion;
    const { els } = hooks;
    this.stopBeats();
    this.mode = 'end';
    this.steadyKey = null;
    devMark('bomb_end');
    if (!this.t || !els.bombTable?.firstChild) this.t = this.buildTable(els, input, true);
    const t = this.t;
    if (!t || input.winners.length === 0) {
      if (els.bombTable) m.fade(els.bombTable, 0, 240);
      this.at(300, () => hooks.setShown(false));
      this.at(700, () => {
        this.clear(els);
        hooks.done();
      });
      return;
    }
    for (const el of [...t.cards, t.pot, t.form, ...(t.first ? [t.first] : [])]) {
      m.fade(el, 0, 200, { easing: EASE.exit });
    }
    const tags = input.winners.map((_, i) =>
      i === 0
        ? t.tag
        : this.buildTag(
            t.root,
            parseFloat(t.tag.root.style.left),
            parseFloat(t.tag.root.style.top),
            WORD,
          ),
    );
    for (const extra of tags.slice(1)) t.extra.push(extra.root);
    const restore: [HTMLElement, number][] = [];
    input.winners.forEach((id, i) => {
      const tag = tags[i];
      if (!tag) return;
      const seat = input.seatOf(id);
      const lag = i * 120;
      if (seat === null) {
        m.fade(tag.root, 0, 200, { delay: RESULT.fly + lag });
        return;
      }
      const x0 = parseFloat(tag.root.style.left);
      const y0 = parseFloat(tag.root.style.top);
      // У места табличка — шириной гнезда (как флап «ВЫЛЕТ»): при дележе соседние не налезают
      // друг на друга. Масштаб — от центра таблички, место — по краю гнезда, как у гнезда.
      const k = landScale(seat);
      const vw = TAG_W * k;
      const vh = TAG.h * k;
      const [vx, vy] = inNest(seat, vw, vh);
      const dx = Math.round(vx - (TAG_W - vw) / 2 - x0);
      const dy = Math.round(vy - (TAG.h - vh) / 2 - y0);
      const len = Math.hypot(dx, dy) || 1;
      const ox = (dx / len) * 7;
      const oy = (dy / len) * 7;
      const to = `translate(${dx}px, ${dy}px) scale(${k})`;
      this.at(RESULT.lift + lag, () => {
        if (m.calm) return;
        m.A(
          tag.root,
          [
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: 'translate(0px, 0px) scale(1.06)' },
          ],
          120,
          {
            easing: EASE.move,
            keep: true,
          },
        );
      });
      this.at(RESULT.fly + lag, () => {
        if (m.calm) {
          m.A(tag.root, [{ opacity: 1 }, { opacity: 0 }], 120, {
            keep: true,
            done: () => {
              tag.root.style.transform = to;
              m.A(tag.root, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
            },
          });
          return;
        }
        m.A(
          tag.root,
          [
            { transform: 'translate(0px, 0px) scale(1.06)', offset: 0 },
            {
              transform: `translate(${(dx + ox).toFixed(1)}px, ${(dy + oy).toFixed(1)}px) scale(${k})`,
              offset: 0.86,
            },
            { transform: to, offset: 1 },
          ],
          RESULT.flyMs,
          { easing: 'cubic-bezier(0.45, 0, 0.2, 1)', keep: true },
        );
      });
      this.at(RESULT.land + lag, () => {
        tag.lit.flaps.forEach((c, j) => m.fade(c.el, 1, 180, { delay: j * 50 }));
        const name = els.names.get(seat);
        const line = underline(t.root, els.bombTable, name);
        if (line) {
          t.extra.push(line);
          m.line(line, 320);
        }
      });
    });
    // Остальные имена — тише, пока стоит развязка; потом — как были.
    const winnerSeats = new Set(
      input.winners.map((id) => input.seatOf(id)).filter((s): s is number => s !== null),
    );
    this.at(RESULT.land + 400, () => {
      for (const [seat, el] of els.names) {
        if (winnerSeats.has(seat)) continue;
        const now = Number(getComputedStyle(el).opacity);
        if (!Number.isFinite(now) || now <= 0.55) continue;
        restore.push([el, now]);
        m.fade(el, 0.55, 400);
      }
    });
    // Подпись в центре — на месте ушедшего флопа, пока табличка садится у места.
    const names = input.winners.map(input.nameOf);
    const caption = resultCaption(names);
    let card: HTMLElement | null = null;
    if (caption) {
      // Без рассадки — на месте бейджа (табличка, банк и «по 300 × 6» к этому такту ушли) и по левому
      // краю списка: ниже стоит «За столом», подпись на него не ложится.
      card = div(input.table ? 'tv-bt__res' : 'tv-bt__res tv-bt__res--list', t.root);
      const w = input.table ? 460 : LIST_RESULT_W;
      place(
        card,
        input.table ? TABLE_CX - w / 2 : t.column.tag.x,
        input.table ? t.column.cards.y : t.column.tag.y,
      );
      card.style.width = `${w}px`;
      const bar = div('tv-bt__bar', card);
      const eb = div('tv-bt__verb tv-eb', card, caption.verb);
      const who = div('tv-bt__who tv-name', card, caption.names);
      t.extra.push(card);
      for (const el of [bar, eb, who]) el.style.opacity = '0';
      bar.style.transform = 'scaleX(0)';
      bar.style.opacity = '1';
      this.at(RESULT.land - 60, () => {
        fitWho(who, w);
        m.line(bar, 320);
        m.rise(eb, 8, 320, { delay: 60 });
        m.rise(who, 16, 420, { delay: 180 });
      });
      this.at(RESULT.captionOut, () => {
        m.fade(eb, 0, 220, { easing: EASE.exit });
        m.fade(who, 0, 220, { easing: EASE.exit });
        if (m.calm) m.fade(bar, 0, 200);
        else
          m.A(bar, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], 320, {
            easing: EASE.exit,
            keep: true,
          });
      });
    }
    this.at(RESULT.release, () => {
      for (const [el, op] of restore) m.fade(el, op, 280);
      hooks.setShown(false);
      if (input.buttonStays && input.table && input.dSeat !== null) {
        const cap = buttonStaysCaption(t.root, input.dSeat);
        t.extra.push(cap);
        m.rise(cap, 6, 320, { delay: 400 });
        this.at(4400, () => m.fade(cap, 0, 200));
      }
    });
    this.at(RESULT.done, () => {
      this.mode = 'idle';
      hooks.done();
    });
    // Табличка у места складывается, черта и всё остальное уходят; новая сцена снимет это раньше.
    this.at(RESULT.fold, () => {
      for (const tag of tags) {
        tag.lit.flaps.forEach((c, j) =>
          this.at(j * 40, () => {
            c.flip(' ', { bounce: false });
            m.fade(c.el, 0, 160, { delay: c.fall + 20 });
          }),
        );
        m.fade(tag.root, 0, 200, { delay: 8 * 40 + 300 });
      }
      for (const el of t.extra) if (el !== card) m.fade(el, 0, 200);
    });
    this.at(RESULT.fold + 900, () => {
      if (this.mode === 'idle') this.clear(els);
    });
  }
}

/**
 * Масштаб таблички у места: уже гнезда стека на 16 px (190 из 293) — таблички соседних мест при
 * дележе не сливаются в одну строку (места сверху и снизу — через 208 px).
 */
function landScale(seat: number): number {
  return Number(Math.min(1, (seatNest(seat).w - 16) / TAG_W).toFixed(3));
}

/**
 * Столбец бейджа без рассадки: в правой части кадра, на месте «В игре N из M» (.tv-list: left 782,
 * top 300; место — .tv-list__bomb, 190 px; ниже через 36 px — «За столом»).
 */
function listColumn(): BombColumn {
  return { tag: { x: 782, y: 300 }, cards: { x: 782, y: 300 }, potY: 366, formY: 366 + POT.h + 10 };
}

/** Подпись развязки без рассадки: шириной списка «За столом» (.tv-list — 1042 px). */
const LIST_RESULT_W = 1042;

/** Элементы колонки игры, которые уходят на время сцены (часы и стол — отдельно). */
function columnEls(els: GameEls): (HTMLElement | null)[] {
  return [els.head, els.lvl, els.bhead, els.blinds, els.below, els.quiet];
}

/** Черта под именем забравшего: по ширине имени, в координатах кадра. */
function underline(
  root: HTMLElement,
  frame: HTMLElement | null,
  name: HTMLElement | undefined,
): HTMLElement | null {
  if (!name || !frame) return null;
  const fr = frame.getBoundingClientRect();
  const nr = name.getBoundingClientRect();
  if (fr.width <= 0 || nr.width <= 0) return null;
  const k = 1920 / fr.width;
  const line = div('tv-bt__wline', root);
  place(line, (nr.left - fr.left) * k, (nr.bottom - fr.top) * k + 4);
  line.style.width = `${Math.round(nr.width * k)}px`;
  line.style.transform = 'scaleX(0)';
  return line;
}

/** «Баттон остаётся» у метки D (решение 8): баттон после бомб-пота не двигается. */
function buttonStaysCaption(root: HTMLElement, dSeat: number): HTMLElement {
  const [x, y] = markerXY(dSeat, 'D', ['D'], { D: MARKER_D_W, SB: 0, BB: 0 });
  const side = seatPoint(dSeat).side;
  const cap = div('tv-bt__dcap', root, 'Баттон остаётся');
  // У правого торца подпись — слева от метки (справа — имена мест); без transform: его занимает движение.
  if (side === 'r') cap.style.right = `${1920 - (x - 14)}px`;
  else cap.style.left = `${x + MARKER_D_W + 14}px`;
  cap.style.top = `${y + 15}px`;
  cap.style.opacity = '0';
  return cap;
}

/** Имя забравшего — 72 вниз до 36 по ширине подписи; дальше — многоточие. */
function fitWho(who: HTMLElement, w: number): void {
  let px = 72;
  who.style.fontSize = `${px}px`;
  // Блок шириной w (left/right 0): шире — только когда текст не помещается (scrollWidth > clientWidth).
  while (who.scrollWidth > Math.min(w, who.clientWidth) + 1 && px > 36) {
    px -= 2;
    who.style.fontSize = `${px}px`;
  }
}
