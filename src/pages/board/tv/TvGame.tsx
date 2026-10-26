// Экран игры на табло ТВ (макет доработки v3): слева — уровень, блайнды флапами, короткая строка
// ребаев, фонд крупно и призовые мелко, тихая строка «средний стек · игра идёт»; справа — стол-схема
// (без рассадки — прежний список «За столом»). Часы — над слоями (TvBoard): в олл-ине они не
// исчезают, а уезжают в угол. Что держит момент (заставка уровня, нокаут) — в moment.
import type { EveningState, TournamentFormat } from '@domain/types.ts';
import { Fragment, useLayoutEffect, useRef } from 'react';
import { formatNumber } from '../../../shared/lib/format';
import type { NameOf } from '../../evening/lib';
import { FlapText } from './FlapText';
import type { FlapRowStyle } from './flap';
import { bindEl, blindsStyle, type ElsRef, type GameMoment } from './stage';
import {
  anteText,
  blindsText,
  levelLine,
  nextText,
  prizeParts,
  quietParts,
  rebuyView,
  type Part,
} from './gameModel';
import { EASE } from './motion';
import { useMotion } from './motionContext';
import { fitDown, LIST_BOTTOM } from './tableLayout';
import { tvTable } from './tableModel';
import { KoCard, TvTable } from './TvTable';
import { useFontsVersion } from './useStage';

const LVL_FLAP: FlapRowStyle = {
  w: 14,
  h: 26,
  fs: 22,
  wt: 500,
  ink: 'var(--ink-muted)',
  flush: true,
  s: 0,
};
const HEAD_FLAP: FlapRowStyle = {
  w: 48,
  h: 64,
  fs: 54,
  wt: 800,
  ink: 'var(--ink)',
  s: 2,
  dy: 1,
  fall: 300,
};
const IN_GAME: FlapRowStyle = { w: 58, h: 82, fs: 76, wt: 800, ink: 'var(--ink)', s: 2, dy: 1 };

function PartsText({ parts }: { parts: readonly Part[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.gs ? (
          <i key={i} className="tv-gs" />
        ) : p.b ? (
          <b key={i}>{p.t}</b>
        ) : (
          <Fragment key={i}>{p.t}</Fragment>
        ),
      )}
    </>
  );
}

/** «4 000» с узкой отбивкой разрядов. */
function Grouped({ text }: { text: string }) {
  const groups = text.split(/[   ]/);
  return (
    <>
      {groups.map((g, i) => (
        <Fragment key={i}>
          {i > 0 && <i className="tv-gs" />}
          {g}
        </Fragment>
      ))}
    </>
  );
}

export interface TvGameProps {
  format: TournamentFormat;
  /** Что табло показывает (настоящее состояние с удержаниями моментов). */
  state: EveningState;
  /**
   * Настоящее состояние — для строки ребаев: её минуты считаются по нему всегда. Удержанный уровень
   * (заставка ещё не дошла до блайндов) — прежний номер при остатке уже нового уровня: минуты
   * ребаев по нему выходили на целый уровень больше.
   */
  liveState: EveningState;
  nowMs: number;
  pausedMs: number | null;
  nameOf: NameOf;
  moment: GameMoment;
  onVyletFolded: (seat: number) => void;
  /** Бомб-пот на экране (030): бейдж раздачи в центре стола, SB и BB погашены. */
  bombOn: boolean;
  els: ElsRef;
}

export function TvGame(p: TvGameProps) {
  const { format, state, moment, els } = p;
  const line = levelLine(format, state, p.nowMs, p.pausedMs);
  const blinds = moment.blinds ?? blindsText(state.currentLevel);
  const bStyle = blindsStyle(blinds);
  const next = nextText(state);
  const ante = anteText(state);
  const rebuy = rebuyView(format, p.liveState, moment.lift);
  const table = tvTable(state, { bombOn: p.bombOn });
  const inGame = moment.inGame ?? state.aliveCount;
  const entries = state.joinOrder.length;

  return (
    <div className="tv-layer tv-game">
      {/* Уровень над часами: «Уровень 4 из 8 · последняя минута». */}
      <div className="tv-lvl tv-eb" ref={bindEl(els, 'lvl')}>
        Уровень
        <FlapText text={String(line.level)} style={LVL_FLAP} />
        <span>из {line.total}</span>
        {line.note && (
          <span
            className={`tv-lvl__note${line.alarm ? ' tv-lvl__note--alarm' : line.hot ? ' tv-lvl__note--hot' : ''}`}
          >
            · {line.note}
          </span>
        )}
      </div>

      <div className="tv-bhead" ref={bindEl(els, 'bhead')}>
        <p className="tv-eb">Блайнды{ante ? ` · анте ${ante}` : ''}</p>
        <p className="tv-eb tv-bhead__next">
          {next.label}
          {next.value && <b>{next.value}</b>}
        </p>
      </div>
      <div className="tv-brule" ref={bindEl(els, 'brule')} />
      <div className="tv-lvlhead" ref={bindEl(els, 'lvlhead')} aria-hidden="true">
        <span>Уровень</span>
        <FlapText text={String(moment.headLevel ?? line.level)} style={HEAD_FLAP} />
        <span className="tv-lvlhead__of">из {line.total}</span>
      </div>
      <div className="tv-blinds" ref={bindEl(els, 'blinds')}>
        <FlapText
          text={blinds}
          style={bStyle}
          ink={moment.blindsAccent ? 'var(--accent)' : 'var(--ink)'}
          flip={{ drum: 'up', maxVia: 2, stagger: 90, lowFirst: true }}
          label={`Блайнды ${blinds}`}
        />
      </div>

      <div className="tv-below" ref={bindEl(els, 'below')}>
        <RebuyLine tone={rebuy.tone} parts={rebuy.parts} />
        <div className="tv-layer" ref={bindEl(els, 'fund')}>
          <div className="tv-fundrule" />
          <p className="tv-fund-eb tv-eb">Фонд</p>
          <p className="tv-fund">
            <Grouped text={formatNumber(state.prizePoolRub)} />
            <small>₽</small>
          </p>
          <Prizes items={prizeParts(format, state)} />
        </div>
      </div>
      <p className="tv-quietline tv-quiet" ref={bindEl(els, 'quiet')}>
        <PartsText parts={quietParts(state)} />
      </p>

      {table.seated ? (
        <TvTable
          seats={table.seats}
          markers={table.markers}
          sb={table.sbAmount}
          bb={table.bbAmount}
          inGame={inGame}
          entries={entries}
          nameOf={p.nameOf}
          outSeats={moment.outSeats}
          vylet={moment.vylet}
          onVyletFolded={p.onVyletFolded}
          ko={moment.ko}
          bombOn={p.bombOn}
          els={els}
        />
      ) : (
        <TvList
          state={state}
          inGame={inGame}
          entries={entries}
          nameOf={p.nameOf}
          moment={moment}
          bombOn={p.bombOn}
          els={els}
        />
      )}
    </div>
  );
}

/** Строка ребаев; сигнал за 5 минут — подложка нарастает и оседает один раз, дальше рамка стоит. */
function RebuyLine({ tone, parts }: { tone: string; parts: readonly Part[] }) {
  const { motion } = useMotion();
  const sw = useRef<HTMLElement>(null);
  const prevTone = useRef<string | null>(null);
  useLayoutEffect(() => {
    const was = prevTone.current;
    prevTone.current = tone;
    const el = sw.current;
    if (!el || tone !== 'signal') return;
    if (was === null || was === 'signal' || motion.calm) {
      el.style.opacity = '0.55';
      return;
    }
    motion.A(el, [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0.55 }], 1400, {
      easing: EASE.swell,
      keep: true,
    });
  }, [tone, motion]);
  return (
    <p className={`tv-rebuy tv-rebuy--${tone}`}>
      <PartsText parts={parts} />
      {tone === 'signal' && <i ref={sw} className="tv-rebuy__sw" />}
    </p>
  );
}

function Prizes({ items }: { items: readonly { place: string; rub: string }[] }) {
  if (items.length === 0) return null;
  return (
    <p className="tv-prizes">
      {items.map((it, i) => (
        <Fragment key={it.place}>
          {i > 0 && <span className="tv-prizes__sep">/</span>}
          {it.place}
          <b>
            <Grouped text={it.rub} />
          </b>
        </Fragment>
      ))}
    </p>
  );
}

/** Без рассадки — «В игре N из M» и имена за столом, как прежде, в правой части кадра. */
function TvList({
  state,
  inGame,
  entries,
  nameOf,
  moment,
  bombOn,
  els,
}: {
  state: EveningState;
  inGame: number;
  entries: number;
  nameOf: NameOf;
  moment: GameMoment;
  bombOn: boolean;
  els: ElsRef;
}) {
  const alive = state.joinOrder.filter((id) => state.players[id]?.alive);
  // Имена — не ниже низа стола: подвал (строки голоса) растёт снизу. Раскладка кадра — до масштаба.
  const namesRef = useRef<HTMLParagraphElement>(null);
  const fonts = useFontsVersion();
  const namesKey = alive.map(nameOf).join('|');
  useLayoutEffect(() => {
    const el = namesRef.current;
    const list = el?.offsetParent as HTMLElement | null | undefined;
    if (!el) return;
    const top = list?.offsetTop ?? 0;
    const px = fitDown((size) => {
      el.style.fontSize = `${size}px`;
      return top + el.offsetTop + el.offsetHeight;
    }, LIST_BOTTOM);
    el.style.fontSize = `${px}px`;
  }, [namesKey, fonts]);
  return (
    <div className="tv-table">
      <div className="tv-layer" ref={bindEl(els, 'tableBase')}>
        <div className="tv-list" ref={bindEl(els, 'center')}>
          {/* Бомб-пот (030): место «В игре» занимает бейдж раздачи (слой .tv-bt ниже). */}
          {bombOn ? (
            <div className="tv-list__bomb" />
          ) : (
            <div>
              <p className="tv-eb">В игре</p>
              <div className="tv-list__count" style={{ marginTop: 14 }}>
                <FlapText text={String(inGame)} style={IN_GAME} />
                <p className="tv-center__of">
                  из <b>{entries}</b>
                </p>
              </div>
            </div>
          )}
          {alive.length > 0 && (
            <div>
              <p className="tv-eb">За столом</p>
              <p className="tv-list__names" ref={namesRef} style={{ marginTop: 18 }}>
                {alive.map((id) => (
                  <span key={id} className="tv-name">
                    {nameOf(id)}
                  </span>
                ))}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="tv-layer" ref={bindEl(els, 'markers')} />
      <div className="tv-bt tv-layer" ref={bindEl(els, 'bombTable')} aria-hidden="true" />
      <KoCard ko={moment.ko} els={els} x={1138} y={436} />
    </div>
  );
}
