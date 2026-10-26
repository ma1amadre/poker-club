// Олл-ин на табло ТВ (макет доработки v3): борд — главный объект сверху, слева подпись к нему
// («олл-ин · 3 руки», улица флапами), ниже — руки колонками с одной крупной цифрой шансов. Улица
// разыгрывается тактами: флоп по одной карте, тёрн и ривер с выдержкой (рубашка лежит в гнезде),
// проценты перекатываются, ауты загораются и гаснут, развязка — победитель, банк, вылет.
//
// Данные — журнал: руки и стол — раздача (ShowdownState, улицы по очереди — streetReveal), шансы и
// ауты — движок олл-ина (useShowdownAnalysis на каждую улицу: флоп и дальше — точно и сразу, до
// флопа — Монте-Карло в воркере), вылет — записи bust после открытия раздачи. Табло показывает
// улицы по очереди: следующая начинается, когда отыграла прошлая. Правка раздачи (другие руки,
// карта стола убрана или заменена) и первый кадр табло посреди олл-ина — сразу как есть, без тактов.
import type { Street } from '@domain/showdown.ts';
import type { ShowdownHand } from '@domain/types.ts';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NameOf } from '../../evening/lib';
import { useShowdownAnalysis } from '../../../shared/lib/poker/useShowdownEquity';
import type { ShowdownAnalysis } from '../../../shared/lib/poker/analysis';
import { allinLayout, allinTitle, BOARD_SLOT_LABELS, STREET_WORD } from './allinModel';
import {
  AllinScript,
  boardEdited,
  initialShown,
  settledShown,
  type ScriptData,
  type Shown,
} from './allinScript';
import { FlapText } from './FlapText';
import type { FlapRowStyle } from './flap';
import { EASE } from './motion';
import { useLatest, useMotion } from './motionContext';
import { HandColumn } from './AllinHand';
import { TvCard } from './TvCard';

export interface AllinStageProps {
  showdown: { showdownId: string; hands: readonly ShowdownHand[]; board: readonly string[] };
  nameOf: NameOf;
  seatOf: (playerId: string) => number | null;
  /** Участники раздачи, вылетевшие после её открытия: место («6-е место» / «вне игры»). */
  busted: ReadonlyMap<string, string>;
  /** Проигравшие, оставшиеся в игре по ответу банкира: «остаётся в игре». */
  stayed: ReadonlySet<string>;
  /** Табло открыто посреди олл-ина: без тактов. */
  instant: boolean;
  /**
   * Раздачу закрыл ответ банкира на ривере (TvBoard держит экран олл-ина): когда ривер отыграл и
   * развязка постояла RESOLVE_SHOW_MS — onResolved, табло уходит к столу.
   */
  resolving?: boolean;
  onResolved?: () => void;
}

/** Сколько развязка с ответом банкира («6-е место», «ВЫЛЕТ», «остаётся в игре») стоит на экране. */
export const RESOLVE_SHOW_MS = 3600;

function useStreetAnalyses(hands: readonly ShowdownHand[], board: readonly string[]) {
  const pre = useShowdownAnalysis({ hands, board: [] });
  const flop = useShowdownAnalysis(board.length >= 3 ? { hands, board: board.slice(0, 3) } : null);
  const turn = useShowdownAnalysis(board.length >= 4 ? { hands, board: board.slice(0, 4) } : null);
  const river = useShowdownAnalysis(board.length >= 5 ? { hands, board: board.slice(0, 5) } : null);
  const analyses = useMemo<Record<Street, ShowdownAnalysis | null>>(
    () => ({
      preflop: pre.analysis,
      flop: flop.analysis,
      turn: turn.analysis,
      river: river.analysis,
    }),
    [pre.analysis, flop.analysis, turn.analysis, river.analysis],
  );
  return { analyses, failed: pre.failed || flop.failed || turn.failed || river.failed };
}

export function AllinStage({
  showdown,
  nameOf,
  seatOf,
  busted,
  stayed,
  instant,
  resolving = false,
  onResolved,
}: AllinStageProps) {
  const { motion } = useMotion();
  const { hands, board } = showdown;
  const L = useMemo(() => allinLayout(hands.length), [hands.length]);
  const handsKey = `${showdown.showdownId}|${hands.map((h) => `${h.playerId}:${h.cards.join('')}`).join(',')}`;
  const { analyses, failed } = useStreetAnalyses(hands, board);
  const bustedSet = useMemo(() => new Set(busted.keys()), [busted]);
  const data: ScriptData = { hands, board, analyses, busted: bustedSet, stayed };

  const [shown, setShown] = useState<Shown>(() =>
    instant ? settledShown(data, handsKey, 0) : initialShown(data, handsKey),
  );
  // Правка раздачи (другие руки, карта стола убрана или заменена) — сразу как есть, новое поколение
  // тактов: шансы, ауты и развязка прежнего стола уже не верны.
  if (shown.key !== handsKey || boardEdited(shown, board)) {
    setShown(settledShown(data, handsKey, shown.gen + 1));
  }

  const latest = useLatest({ ...data, gen: shown.gen });
  const [script] = useState(() => new AllinScript(motion, setShown, () => latest.current));
  useLayoutEffect(() => {
    script.step(shown, board.length);
    script.fill(shown);
  }, [script, shown, board.length, analyses, bustedSet, stayed]);

  // Развязка с ответом банкира: ждём, пока ривер отыграет такты (ответ мог прийти раньше), потом
  // даём ей постоять и отпускаем экран. Один раз на раздачу.
  const resolved = useLatest(onResolved);
  const resolveAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!resolving || resolveAt.current !== null) return;
    if (shown.street !== 'river' || script.busy(shown.gen)) return;
    resolveAt.current = motion.after(RESOLVE_SHOW_MS, () => resolved.current?.());
  }, [resolving, shown, script, motion, resolved]);
  useLayoutEffect(
    () => () => {
      if (resolveAt.current !== null) motion.cancel(resolveAt.current);
    },
    [motion],
  );

  // --- Раскладка -----------------------------------------------------------------------------------

  const handsRef = useRef<HTMLDivElement>(null);
  const liftedShown = useRef<boolean | null>(null);
  const { lifted, instant: still } = shown;
  useLayoutEffect(() => {
    const el = handsRef.current;
    if (!el) return;
    const was = liftedShown.current;
    liftedShown.current = lifted;
    const to = `translateY(${lifted ? 0 : L.shift}px)`;
    if (was === null || was === lifted || still) {
      motion.cancelOn(el);
      el.style.transform = to;
      return;
    }
    if (motion.calm) {
      motion.A(el, [{ opacity: 1 }, { opacity: 0.2 }], 140, {
        keep: true,
        done: () => {
          el.style.transform = to;
          motion.A(el, [{ opacity: 0.2 }, { opacity: 1 }], 220, { keep: true });
        },
      });
      return;
    }
    motion.move(el, `translateY(${L.shift}px)`, to, 560, { easing: EASE.move });
  }, [lifted, still, L.shift, motion]);

  const B = L.board;
  // Слово улицы — подпись к борду: база слова — по нижнему краю борда; над ним — «олл-ин · 3 руки».
  const streetTop = B.y + B.h - L.street.h + 6;

  return (
    <div
      className={`tv-ai__in${L.n >= 5 ? ' tv-ai__in--dense' : ''}`}
      aria-label={`Олл-ин: ${STREET_WORD[shown.street].toLowerCase()}`}
    >
      <p className="tv-ai__eb tv-eb" style={{ top: streetTop - 40 }}>
        {allinTitle(hands.length)}
      </p>
      <div className="tv-ai__street" style={{ top: streetTop }}>
        <FlapText
          key={L.street.h}
          text={STREET_WORD[shown.street]}
          style={{ ...STREET_STYLE, w: L.street.w, h: L.street.h, fs: L.street.fs }}
          flip={STREET_FLIP}
        />
      </div>
      {BOARD_SLOT_LABELS.map((label, i) => (
        <BoardSlot
          key={i}
          label={label}
          code={board[i] ?? null}
          placed={i < shown.board}
          hold={shown.hold[i] ?? 0}
          instant={shown.instant}
          x={B.xs[i] ?? 0}
          y={B.y}
          w={B.w}
          h={B.h}
          underline={shown.comboBoard.includes(i)}
        />
      ))}
      <div className="tv-ai__hands" ref={handsRef}>
        {hands.map((h, i) => {
          const hs = shown.hands[i];
          if (!hs) return null;
          return (
            <HandColumn
              key={h.playerId}
              index={i}
              L={L}
              hand={h}
              name={nameOf(h.playerId)}
              seat={seatOf(h.playerId)}
              shown={hs}
              handsIn={shown.handsIn}
              instant={shown.instant}
              bustPlace={busted.get(h.playerId) ?? null}
            />
          );
        })}
      </div>
      {failed && (
        <p className="tv-ai__foot tv-quiet" role="status">
          Шансы не посчитались — карты на месте
        </p>
      )}
    </div>
  );
}

const STREET_STYLE: FlapRowStyle = {
  w: 44,
  h: 80,
  fs: 72,
  wt: 800,
  ink: 'var(--ink-muted)',
  flush: true,
  s: 0,
  gap: 1,
  dy: 1,
  narrow: true,
};
const STREET_FLIP = { riffle: 1, stagger: 40 };

// --- Борд ------------------------------------------------------------------------------------------

function BoardSlot(p: {
  label: string;
  code: string | null;
  placed: boolean;
  hold: number;
  instant: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  underline: boolean;
}) {
  const { motion } = useMotion();
  const card = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const placedShown = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    const was = placedShown.current;
    placedShown.current = p.placed;
    const el = card.current;
    if (!p.placed || !el) {
      if (label.current) label.current.style.opacity = '1';
      return;
    }
    if (was === null || was === p.placed || p.instant) {
      if (label.current) label.current.style.opacity = '0';
      return;
    }
    motion.fade(label.current, 0, 120);
    if (motion.calm) motion.A(el, [{ opacity: 0 }, { opacity: 1 }], 160, { keep: true });
    else
      motion.A(
        el,
        [
          { opacity: 0, transform: 'translateY(-16px)' },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        260,
        { easing: EASE.quiet, keep: true },
      );
  }, [p.placed, p.instant, motion]);

  useLayoutEffect(() => {
    const el = line.current;
    if (!el) return;
    if (!p.underline) {
      motion.cancelOn(el);
      el.style.transform = 'scaleX(0)';
      return;
    }
    if (p.instant) el.style.transform = 'scaleX(1)';
    else motion.line(el, 320);
  }, [p.underline, p.instant, motion]);

  return (
    <>
      <div className="tv-slot" style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
        <span ref={label}>{p.label}</span>
      </div>
      {p.placed && p.code && (
        <div ref={card} className="tv-layer" style={{ pointerEvents: 'none' }}>
          <TvCard
            code={p.code}
            x={p.x}
            y={p.y}
            w={p.w}
            h={p.h}
            open
            flipDelay={p.instant ? null : 160 + p.hold}
          />
        </div>
      )}
      <div ref={line} className="tv-uline" style={{ left: p.x, top: p.y + p.h + 14, width: p.w }} />
    </>
  );
}
