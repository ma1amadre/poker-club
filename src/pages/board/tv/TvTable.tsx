// Стол-схема табло ТВ (макет v3): десять мест по сукну клуба, имена (полной яркостью — на D/SB/BB,
// остальные на ступень тише, вылетевший — приглушён, пустое место — только номер, едва видно), «в
// игре N из M» в центре, метки D / SB / BB с суммами блайндов, которые едут вдоль борта по часовой
// к следующей раздаче. Под ставку и стек заложены гнёзда (камера позже) — сейчас пустые.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { formatNumber } from '../../../shared/lib/format';
import { seatNo, type NameOf } from '../../evening/lib';
import { FlapText } from './FlapText';
import type { FlapRowStyle } from './flap';
import { bindEl, bindSeat, type ElsRef, type KoCardView, type VyletMark } from './stage';
import { devMark, type Motion } from './motion';
import { useLatest, useMotion } from './motionContext';
import {
  dealMove,
  feltPolygon,
  KO_CARD,
  MARKER_D_W,
  MARKERS,
  markerXY,
  markersAt,
  NAME_H,
  NAME_MIN,
  NAME_TWO_MAX,
  NAME_WORD_MIN,
  nameLimit,
  nameTop,
  railDuration,
  railPath,
  seatLabels,
  STACK_H,
  STACK_W,
  stackTop,
  TABLE,
  TABLE_H,
  TABLE_W,
  type Anchor,
  type Marker,
  type MarkerSeats,
} from './tableLayout';
import { placeText, type TvSeat } from './tableModel';
import { useFontsVersion } from './useStage';
import { Vylet } from './Vylet';

const IN_GAME: FlapRowStyle = { w: 58, h: 82, fs: 76, wt: 800, ink: 'var(--ink)', s: 2, dy: 1 };
const AMOUNT: FlapRowStyle = {
  w: 18,
  h: 34,
  fs: 30,
  wt: 700,
  ink: 'var(--accent)',
  flush: true,
  s: 0,
  gap: 0,
};

function anchorStyle(a: Anchor): CSSProperties {
  return {
    left: a.x,
    top: a.y,
    transform:
      a.align === 'center'
        ? 'translateX(-50%)'
        : a.align === 'end'
          ? 'translateX(-100%)'
          : undefined,
  };
}

interface SeatProps {
  seat: TvSeat;
  name: string | null;
  /** Место уже показано вылетевшим, хотя счёт «в игре» ещё прежний (нокаут посреди такта). */
  out: boolean;
  vylet: VyletMark | null;
  onFolded: () => void;
  els: ElsRef;
}

/**
 * Имя не шире своего места: кегль 40 вниз до 24; не помещается и из нескольких слов — двумя
 * строками (26 вниз до 24); одно длинное слово — мельче, до 20; дальше — многоточие. Возвращает,
 * двумя ли строками, и высоту блока.
 */
function fitSeatName(
  box: HTMLElement,
  text: HTMLElement,
  maxW: number,
): { two: boolean; h: number } {
  // Ширины дробные: запас 1 px, иначе имя «впритык» рисуется с многоточием.
  const limit = maxW - 1;
  box.classList.remove('tv-seat__name--two');
  let px = NAME_H;
  box.style.fontSize = `${px}px`;
  while (text.scrollWidth > limit && px > NAME_MIN) {
    px -= 1;
    box.style.fontSize = `${px}px`;
  }
  if (text.scrollWidth <= limit) return { two: false, h: NAME_H };
  if (!/\s/.test((text.textContent ?? '').trim())) {
    while (text.scrollWidth > limit && px > NAME_WORD_MIN) {
      px -= 1;
      box.style.fontSize = `${px}px`;
    }
    return { two: false, h: NAME_H };
  }
  box.classList.add('tv-seat__name--two');
  px = NAME_TWO_MAX;
  box.style.fontSize = `${px}px`;
  while ((text.scrollWidth > limit || text.scrollHeight > text.clientHeight + 1) && px > NAME_MIN) {
    px -= 1;
    box.style.fontSize = `${px}px`;
  }
  return { two: true, h: box.offsetHeight };
}

function Seat({ seat, name, out, vylet, onFolded, els }: SeatProps) {
  const { motion } = useMotion();
  const L = seatLabels(seat.seat);
  const nameRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const shownFocus = useRef<number | null>(null);
  const status = seat.status === 'live' && out ? 'out' : seat.status;
  const focus = status === 'out' ? 0.3 : seat.focus;
  const limit = nameLimit(L.side);
  const fonts = useFontsVersion();
  const [nameBox, setNameBox] = useState({ two: false, h: NAME_H });

  useLayoutEffect(() => {
    const box = nameRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const fit = fitSeatName(box, text, limit);
    setNameBox((b) => (b.two === fit.two && b.h === fit.h ? b : fit));
  }, [name, limit, fonts]);

  // Яркость имени (фокус стола): переход — после того, как метки подъехали.
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) {
      shownFocus.current = null;
      return;
    }
    const was = shownFocus.current;
    shownFocus.current = focus;
    if (was === null) {
      motion.cancelOn(el);
      el.style.opacity = String(focus);
      return;
    }
    if (was !== focus) motion.fade(el, focus, 280, { delay: 260 });
  }, [focus, motion, name]);

  // Флап «ВЫЛЕТ» сложился — на его месте проявляется тихое «6-е место».
  const placeRef = useRef<HTMLSpanElement>(null);
  const hadVylet = useRef(false);
  const flapOn = vylet !== null;
  useLayoutEffect(() => {
    const was = hadVylet.current;
    hadVylet.current = flapOn;
    if (was && !flapOn && placeRef.current) {
      motion.A(placeRef.current, [{ opacity: 0 }, { opacity: 1 }], 320, { keep: true });
    }
  }, [flapOn, motion]);

  const bindName = bindSeat(els, 'names', seat.seat);
  const cls = `tv-seat tv-seat--${status}`;
  const stackY = stackTop(L.side, L.stack.y, nameBox.two ? nameBox.h : NAME_H);
  return (
    <div className={cls}>
      <div className="tv-seat__lab tv-layer" ref={bindSeat(els, 'labels', seat.seat)}>
        <span className="tv-seat__no" style={anchorStyle(L.no)}>
          {seatNo(seat.seat)}
        </span>
        {name !== null && (
          <span
            ref={(el) => {
              nameRef.current = el;
              bindName(el);
            }}
            className={`tv-seat__name tv-name tv-seat__name--${L.side}${nameBox.two ? ' tv-seat__name--two' : ''}`}
            style={{
              ...anchorStyle(L.name),
              top: nameTop(L.side, L.name.y, nameBox.two ? nameBox.h : NAME_H),
              maxWidth: limit,
            }}
          >
            <span ref={textRef} className="tv-seat__nm">
              {name}
            </span>
          </span>
        )}
      </div>
      <div
        className="tv-seat__st"
        style={{ left: L.stack.x, top: stackY, width: STACK_W, justifyContent: L.stack.justify }}
      >
        {vylet ? (
          // Игрок уже в игре (ребай, отмена вылета) — флап складывается, не дожидаясь своих 12 с.
          vylet.show && <Vylet fold={vylet.fold || status !== 'out'} onFolded={onFolded} />
        ) : status === 'out' ? (
          <span ref={placeRef} className="tv-seat__place">
            {placeText(seat.place)}
          </span>
        ) : null}
      </div>
      <div
        className="tv-res"
        style={{ left: L.stack.x, top: stackY, width: STACK_W, height: STACK_H }}
      >
        <span>СТЕК</span>
      </div>
      <div
        className="tv-res"
        style={{ left: L.bet.x, top: L.bet.y, width: L.bet.w, height: L.bet.h }}
      >
        <span>СТАВКА</span>
      </div>
    </div>
  );
}

/** Метка гаснет на старом месте и встаёт на новом (спокойно; и не по раздаче — без переезда). */
function hopMove(motion: Motion, el: HTMLElement, to: [number, number], delay: number): void {
  motion.cancelOn(el);
  motion.after(delay, () =>
    motion.A(el, [{ opacity: 1 }, { opacity: 0 }], 120, {
      keep: true,
      done: () => {
        el.style.transform = `translate(${to[0]}px, ${to[1]}px)`;
        motion.A(el, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
      },
    }),
  );
}

/** Переезд метки по кольцу меток по часовой; спокойно — гаснет на старом месте и встаёт на новом. */
function railMove(
  motion: Motion,
  el: HTMLElement,
  from: [number, number],
  to: [number, number],
  w: number,
  delay: number,
): void {
  motion.cancelOn(el);
  const a = `translate(${from[0]}px, ${from[1]}px)`;
  const b = `translate(${to[0]}px, ${to[1]}px)`;
  el.style.transform = a;
  if (motion.calm) {
    hopMove(motion, el, to, delay);
    return;
  }
  const path = railPath(w, [from[0] + w / 2, from[1] + 24], [to[0] + w / 2, to[1] + 24]);
  const kf = path.points.map(([s, pt], i) => ({
    transform:
      i === 0
        ? a
        : i === path.points.length - 1
          ? b
          : `translate(${(pt[0] - w / 2).toFixed(1)}px, ${(pt[1] - 24).toFixed(1)}px)`,
    offset: path.length > 0 ? Number((s / path.length).toFixed(4)) : i,
  }));
  motion.A(el, kf, railDuration(path.length), {
    easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
    delay,
    keep: true,
  });
}

/**
 * Ставит метки у мест: по раздаче (баттон ушёл к следующему игроку, dealMove) — вдоль борта по
 * часовой; иначе (отмена раздачи, баттон руками, вылет блайнда) — гаснут и встают на новом месте;
 * та же метка шире — на месте.
 */
function placeMarkers(
  motion: Motion,
  els: Record<Marker, HTMLElement | null>,
  seats: MarkerSeats,
  before: MarkerSeats | null,
  at: Record<Marker, [number, number] | null>,
  alive: ReadonlySet<number>,
): void {
  const deal =
    before !== null && before.D !== null && seats.D !== null && dealMove(before.D, seats.D, alive);
  const widths: Record<Marker, number> = {
    D: MARKER_D_W,
    SB: els.SB?.offsetWidth ?? 120,
    BB: els.BB?.offsetWidth ?? 120,
  };
  MARKERS.forEach((kind, i) => {
    const el = els[kind];
    const seat = seats[kind];
    if (!el) return;
    if (seat === null) {
      motion.cancelOn(el);
      el.style.opacity = '0';
      at[kind] = null;
      return;
    }
    const target = markerXY(seat, kind, markersAt(seats, seat), widths);
    const from = at[kind];
    at[kind] = target;
    const tf = `translate(${target[0]}px, ${target[1]}px)`;
    if (!from || !before || before[kind] === null) {
      // Метка появилась (первый кадр, баттон задан) — встаёт на место.
      motion.cancelOn(el);
      el.style.transform = tf;
      if (before && before[kind] === null) {
        el.style.opacity = '0';
        motion.fade(el, 1, 240);
      } else el.style.opacity = '1';
      return;
    }
    if (from[0] === target[0] && from[1] === target[1]) return;
    if (before[kind] === seat) {
      motion.move(el, `translate(${from[0]}px, ${from[1]}px)`, tf, 300);
      return;
    }
    if (!deal) {
      hopMove(motion, el, target, i * 60);
      return;
    }
    if (kind === 'D') devMark('hand');
    railMove(motion, el, from, target, widths[kind], i * 60);
  });
}

/** Метки D / SB / BB: стоят у мест, к следующей раздаче едут вдоль борта по часовой. */
function Markers({
  seats,
  alive,
  sb,
  bb,
  els,
}: {
  seats: MarkerSeats;
  /** Места игроков в игре — по ним видно, раздача ли сдвинула баттон. */
  alive: ReadonlySet<number>;
  sb: number;
  bb: number;
  els: ElsRef;
}) {
  const { motion } = useMotion();
  const dRef = useRef<HTMLDivElement>(null);
  const sbRef = useRef<HTMLDivElement>(null);
  const bbRef = useRef<HTMLDivElement>(null);
  const at = useRef<Record<Marker, [number, number] | null>>({ D: null, SB: null, BB: null });
  const prev = useRef<MarkerSeats | null>(null);
  const [resized, setResized] = useState(0);
  const { D, SB, BB } = seats;

  // Ширина SB и BB меняется с суммой (75 → 100): метка встаёт заново у своего места.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setResized((n) => n + 1));
    if (sbRef.current) ro.observe(sbRef.current);
    if (bbRef.current) ro.observe(bbRef.current);
    return () => ro.disconnect();
  }, []);

  const aliveNow = useLatest(alive);
  useLayoutEffect(() => {
    const now: MarkerSeats = { D, SB, BB };
    placeMarkers(
      motion,
      { D: dRef.current, SB: sbRef.current, BB: bbRef.current },
      now,
      prev.current,
      at.current,
      aliveNow.current,
    );
    prev.current = now;
  }, [D, SB, BB, resized, motion, aliveNow]);

  return (
    <div className="tv-layer" ref={bindEl(els, 'markers')}>
      <div ref={dRef} className="tv-mk tv-mk--d" aria-hidden="true">
        D
      </div>
      <div ref={sbRef} className="tv-mk tv-mk--b" aria-hidden="true">
        <span>SB</span>
        <FlapText
          className="tv-mk__amt"
          text={formatNumber(sb)}
          style={AMOUNT}
          flip={{ drum: 'up', maxVia: 1, stagger: 60, lowFirst: true }}
        />
      </div>
      <div ref={bbRef} className="tv-mk tv-mk--b" aria-hidden="true">
        <span>BB</span>
        <FlapText
          className="tv-mk__amt"
          text={formatNumber(bb)}
          style={AMOUNT}
          flip={{ drum: 'up', maxVia: 1, stagger: 60, lowFirst: true }}
        />
      </div>
    </div>
  );
}

export interface TvTableProps {
  seats: readonly TvSeat[];
  markers: MarkerSeats;
  sb: number;
  bb: number;
  inGame: number;
  entries: number;
  nameOf: NameOf;
  /** Места, уже показанные вылетевшими посреди нокаута. */
  outSeats: ReadonlySet<number>;
  vylet: ReadonlyMap<number, VyletMark>;
  onVyletFolded: (seat: number) => void;
  ko: KoCardView | null;
  els: ElsRef;
}

export function TvTable(p: TvTableProps) {
  const { seats, markers, els } = p;
  const alive = new Set(seats.filter((s) => s.status === 'live').map((s) => s.seat));
  return (
    <div className="tv-table" aria-label={`В игре ${p.inGame} из ${p.entries}`}>
      <div className="tv-layer" ref={bindEl(els, 'tableBase')}>
        <div
          className="tv-felt"
          style={{ left: TABLE.x0 - 1, top: TABLE.y0 - 1, width: TABLE_W + 2, height: TABLE_H + 2 }}
        >
          <svg
            width={TABLE_W + 2}
            height={TABLE_H + 2}
            viewBox={`0 0 ${TABLE_W + 2} ${TABLE_H + 2}`}
            aria-hidden="true"
          >
            <polygon points={feltPolygon()} />
          </svg>
        </div>
        {seats.map((s) => (
          <Seat
            key={s.seat}
            seat={s}
            name={s.playerId ? p.nameOf(s.playerId) : null}
            out={p.outSeats.has(s.seat)}
            vylet={p.vylet.get(s.seat) ?? null}
            onFolded={() => p.onVyletFolded(s.seat)}
            els={els}
          />
        ))}
        <div className="tv-center" ref={bindEl(els, 'center')}>
          <p className="tv-eb">В игре</p>
          <div className="tv-center__row">
            <FlapText text={String(p.inGame)} style={IN_GAME} />
            <p className="tv-center__of">
              из <b>{p.entries}</b>
            </p>
          </div>
        </div>
      </div>
      <Markers seats={markers} alive={alive} sb={p.sb} bb={p.bb} els={els} />
      <KoCard ko={p.ko} els={els} x={KO_CARD.x} y={KO_CARD.y} />
    </div>
  );
}

/**
 * Имя на карточке нокаута: 80 вниз до 40 по ширине карточки; не помещается и из нескольких слов —
 * двумя строками (40 вниз до 32); дальше — многоточие. Строка «выбивает …» — тоже в ширину
 * карточки (шире — заходит на метки у торцов): 40 вниз до 28; не помещается — «выбивают» над
 * именами, имена 32 вниз до 24; дальше — многоточие у имён.
 */
function fitKoCard(
  who: HTMLElement | null,
  by: HTMLElement | null,
  names: HTMLElement | null,
): void {
  // Ширины дробные: запас 1 px, иначе текст «впритык» рисуется с многоточием.
  const wide = (el: HTMLElement) => el.scrollWidth > el.clientWidth - 1;
  if (who) {
    who.classList.remove('tv-ko__who--two');
    let px = 80;
    who.style.fontSize = `${px}px`;
    while (wide(who) && px > 40) {
      px -= 1;
      who.style.fontSize = `${px}px`;
    }
    if (wide(who) && /\s/.test((who.textContent ?? '').trim())) {
      who.classList.add('tv-ko__who--two');
      while ((wide(who) || who.scrollHeight > who.clientHeight + 1) && px > 32) {
        px -= 1;
        who.style.fontSize = `${px}px`;
      }
    }
  }
  if (by && names) {
    const over = () => wide(by) || wide(names);
    by.classList.remove('tv-ko__by--col');
    let px = 40;
    names.style.fontSize = `${px}px`;
    while (over() && px > 28) {
      px -= 1;
      names.style.fontSize = `${px}px`;
    }
    if (over()) {
      by.classList.add('tv-ko__by--col');
      px = 32;
      names.style.fontSize = `${px}px`;
      while (over() && px > 24) {
        px -= 1;
        names.style.fontSize = `${px}px`;
      }
    }
  }
}

/**
 * Карточка нокаута: по оси стола (без рассадки — по центру правой части кадра); показывает и
 * прячет её такт нокаута (TvBoard).
 */
export function KoCard({
  ko,
  els,
  x,
  y,
}: {
  ko: KoCardView | null;
  els: ElsRef;
  x: number;
  y: number;
}) {
  const who = useRef<HTMLDivElement>(null);
  const by = useRef<HTMLDivElement>(null);
  const names = useRef<HTMLSpanElement>(null);
  const fonts = useFontsVersion();
  useLayoutEffect(() => {
    fitKoCard(who.current, by.current, names.current);
  }, [ko?.name, ko?.by?.names, fonts]);
  return (
    <div
      className="tv-ko"
      ref={bindEl(els, 'ko')}
      style={{ left: x, top: y, visibility: ko ? 'visible' : 'hidden' }}
      aria-live="polite"
    >
      {ko && (
        <>
          <div className="tv-ko__bar" />
          <div className="tv-ko__body">
            <div className="tv-ko__eb tv-eb">{ko.eyebrow}</div>
            <div className="tv-ko__who tv-name" ref={who}>
              {ko.name}
            </div>
            {ko.by && (
              <div className="tv-ko__by" ref={by}>
                <span className="tv-eb">{ko.by.verb}</span>
                <span className="tv-name" ref={names}>
                  {ko.by.names}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
