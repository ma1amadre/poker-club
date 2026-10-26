// Табло на ТВ — доработка v3 (одобренный живой макет, «Терминал»): кадр 1920×1080, вписанный в экран.
// Экран игры (TvGame: колонка часов и денег, стол-схема) и олл-ин (AllinStage) — слои одного кадра;
// часы — над ними: в олл-ине не исчезают, а уезжают в угол. Моменты — по записям журнала (moments.ts):
// смена уровня (заставка ~5 с), нокаут (карточка в центре стола → флап «ВЫЛЕТ» у места → «в игре»
// на одного меньше), олл-ин (вход шторкой и возврат к столу); такты — choreo.ts. Пока момент не дошёл
// до своего такта, экран держит прежнее (applyHolds): табло опрашивает сервер раз в 3 с, и запись
// приходит раньше, чем её пора показать.
// Бомб-пот (миграция 030) — тоже моменты: сцена объявления от записи bomb_pot (розыгрыш взноса,
// взносы, банк, флоп рубашками), развязка от «Кто забрал» и раздачи, «ОТМЕНЁН» от отмены; DOM и такты
// — bombDirector.ts. Пока бомб-пот на экране, метки SB и BB погашены, центр стола — бейджу; сцена,
// которая ещё ждёт, держит прежний стол, развязка — бейдж до своего такта. Голос сцены («Бомб-пот!» и
// «Взнос — три больших блайнда») — по её тактам (onSay), а не по детектору.
//
// Голос, полноэкранный режим, «Нет связи», ожидание и итог вечера — как были (BoardPage): этот
// компонент только рисует идущий вечер на ТВ.
import { BOMB_REVEAL_MS, visibleBombPot } from '@domain/bombPot.ts';
import { bustedInHand, riverOutcome } from '@domain/riverBusts.ts';
import type {
  BombPotState,
  EveningEvent,
  EveningState,
  ShowdownState,
  TournamentFormat,
} from '@domain/types.ts';
import type { Announcement } from '@domain/voice.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { formatTime } from '../../../shared/lib/format';
import { serverNow } from '../../../shared/lib/serverClock';
import { joinNames } from '../../../shared/lib/text';
import { firstToActNow } from '../../evening/bombPotView';
import { breakView, clockView, type NameOf } from '../../evening/lib';
import { AllinStage } from './AllinStage';
import { BombDirector, type BombHooks, type BombInput } from './bombDirector';
import { scenePace } from './bombScene';
import {
  playBack,
  playEnter,
  playKo,
  playLevel,
  settleAllin,
  type AllinEls,
  type Stagehand,
} from './choreo';
import { ClockFlaps } from './ClockFlaps';
import { clockMode, cornerLevel, finalMinute } from './gameModel';
import { devMark } from './motion';
import { useLatest, useMotion } from './motionContext';
import { MotionProvider } from './MotionProvider';
import {
  closedAtRiver,
  detectMoments,
  dropStale,
  enqueue,
  isBombMoment,
  koPlace,
  stayedAfterRiver,
  stillValid,
  withoutLevel,
  type Moment,
  type MomentFrame,
} from './moments';
import { bindEl, emptyGameEls, NO_MOMENT, type GameEls, type GameMoment } from './stage';
import { applyHolds, placeText, tvTable, type Holds } from './tableModel';
import { TvGame } from './TvGame';
import { useStageScale } from './useStage';
import './tv.css';
import './tv-allin.css';
import './tv-bomb.css';

export interface TvBoardProps {
  format: TournamentFormat;
  events: readonly EveningEvent[];
  state: EveningState;
  applied: readonly EveningEvent[];
  nowMs: number;
  nameOf: NameOf;
  /** Олл-ин, который табло показывает (улицы раскрыты по очереди), или null. */
  showdown: ShowdownState | null;
  pausedMs: number | null;
  /** Шапка: «Тренировка · 08.10 · игра 2 · 14:00 · У Жени». */
  headText: string;
  stale: boolean;
  updatedAt: number;
  /** Кнопки шапки (голос, полный экран) — из BoardPage, как были. */
  tools: ReactNode;
  /** Строки подвала (голос, сон экрана, атрибуция). */
  foot: ReactNode;
  /** Голос по тактам сцены (бомб-пот: «Бомб-пот!», «Взнос — три больших блайнда»). */
  onSay?: (announcement: Announcement) => void;
}

export function TvBoard(props: TvBoardProps) {
  return (
    <MotionProvider>
      <TvStage {...props} />
    </MotionProvider>
  );
}

/** resolve — раздачу закрыл ответ банкира на ривере: экран олл-ина стоит с развязкой, потом back. */
type Mode = 'game' | 'enter' | 'allin' | 'resolve' | 'back';

/** Развязка не дождалась конца тактов ривера (сбой расчёта) — к столу всё равно. */
const RESOLVE_MAX_MS = 15_000;

interface Active {
  m: Moment;
  /** Такт уже отпустил удержание: вылетевший — вне игры, уровень — новый. */
  released: boolean;
  /**
   * Бомб-пот: показывает ли экран бейдж (метки SB и BB погашены). Сцена включает его своим тактом,
   * развязка и отмена — выключают.
   */
  bombOn: boolean;
  /** Бомб-пот отменили, пока шла его сцена: доиграть «ОТМЕНЁН». */
  cancelled?: boolean;
}

function TvStage(p: TvBoardProps) {
  const { motion, riffle } = useMotion();
  const scale = useStageScale();
  const [director] = useState(() => new BombDirector(motion, riffle));
  const [clockPlain, setClockPlain] = useState(false);
  const { format, state } = p;
  const els = useRef<GameEls>(emptyGameEls());
  const aiRef = useRef<HTMLDivElement>(null);
  const aiInRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const aiLvlRef = useRef<HTMLParagraphElement>(null);

  // --- Олл-ин на экране ------------------------------------------------------------------------
  const [mode, setMode] = useState<Mode>(p.showdown ? 'allin' : 'game');
  const [sd, setSd] = useState<ShowdownState | null>(p.showdown);
  // Табло открыли посреди олл-ина: он показывается сразу, без тактов (история не разыгрывается).
  const [firstShowdownId] = useState(p.showdown?.showdownId ?? null);
  const backUntil = useRef(0);

  // --- Моменты: детектор в рендере (удержание — в том же кадре, без вспышки настоящего) ----------
  const [frame, setFrame] = useState<MomentFrame | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [gm, setGm] = useState<GameMoment>(NO_MOMENT);
  /** Заставка уровня идёт и ещё не дошла до такта часов: часы стоят на прежнем. */
  const [clockFrozen, setClockFrozen] = useState(false);
  const [clockDrum, setClockDrum] = useState(false);

  const det = detectMoments(frame, {
    events: p.events,
    applied: p.applied,
    state,
    nowMs: p.nowMs,
    allIn: mode !== 'game' || p.showdown !== null,
  });
  if (!sameFrame(frame, det.frame)) {
    setFrame(det.frame);
    // Отмена бомб-пота, сцена которого идёт сейчас, — не в очередь: сцена доигрывает «ОТМЕНЁН».
    const playing = active?.m.kind === 'bomb' ? active.m.eventId : null;
    const cancelNow = det.moments.some((m) => m.kind === 'bomb_cancel' && m.eventId === playing);
    const add = cancelNow
      ? det.moments.filter((m) => !(m.kind === 'bomb_cancel' && m.eventId === playing))
      : det.moments;
    if (cancelNow) setActive((a) => (a ? { ...a, cancelled: true } : a));
    if (add.length > 0) setQueue(enqueue(queue, add));
  }

  // Олл-ин появился — вход (когда момент на столе доиграл); пропал — возврат к столу. Заставка
  // уровня, ждавшая в очереди, под олл-ином не идёт: часы в углу идут по новому уровню сразу.
  // Раздачу закрыл ответ банкира на ривере — сначала развязка на экране олл-ина (resolve), потом
  // к столу. Ответ отменили, пока развязка стоит, — раздача снова открыта: экран олл-ина остаётся.
  if (p.showdown && mode === 'game' && !active) {
    setMode('enter');
    setSd(p.showdown);
    setQueue((q) => withoutLevel(q));
  } else if (!p.showdown && (mode === 'allin' || mode === 'enter')) {
    setMode(sd && closedAtRiver(sd, p.applied) ? 'resolve' : 'back');
  } else if (p.showdown && mode === 'resolve') {
    if (sd && p.showdown.showdownId === sd.showdownId) {
      setMode('allin');
      setSd(p.showdown);
    } else setMode('back');
  } else if (p.showdown && sd && p.showdown !== sd && mode !== 'back') {
    setSd(p.showdown);
  }

  const holds: Holds = useMemo(() => {
    const alive = queue.flatMap((m) => (m.kind === 'ko' ? [m.victim] : []));
    let levelIndex: number | null = null;
    const queuedLevel = queue.find((m) => m.kind === 'level');
    if (queuedLevel && queuedLevel.kind === 'level') levelIndex = queuedLevel.from;
    if (active && !active.released) {
      if (active.m.kind === 'ko') alive.push(active.m.victim);
      else if (active.m.kind === 'level') levelIndex = active.m.from;
    }
    return { alive, levelIndex };
  }, [queue, active]);
  const shown = applyHolds(state, format, holds);
  // Часы стоят на прежнем, пока смена уровня ждёт заставку (блайнды ещё прежние) и пока заставка не
  // дошла до такта часов; снята из очереди (олл-ин, несвежая) — часы сразу идут.
  const frozen = clockFrozen || queue.some((m) => m.kind === 'level');

  // Бомб-пот на экране: идёт его момент — как решил такт; развязка или отмена ждут в очереди —
  // прежний бейдж; ждёт сцена — пока нет; иначе — открытый бомб-пот (не спрятанный временем).
  const bombNow = visibleBombPot(state, p.nowMs);
  let bombOn = bombNow !== null;
  let bombPot: BombPotState | null = bombNow;
  if (active && isBombMoment(active.m)) {
    bombOn = active.bombOn;
    bombPot = active.m.bombPot;
  } else {
    const ending = queue.find((m) => m.kind === 'bomb_end' || m.kind === 'bomb_cancel');
    if (ending && isBombMoment(ending)) {
      bombOn = true;
      bombPot = ending.bombPot;
    } else if (queue.some((m) => m.kind === 'bomb')) {
      bombOn = false;
      bombPot = null;
    }
  }
  const tableNow = tvTable(shown, { bombOn });
  /** Что сцене нужно о столе: места сейчас, метка D, первое слово (вылетел — следующий). */
  const bombInputOf = (bp: BombPotState): BombInput => ({
    bombPot: bp,
    nameOf: p.nameOf,
    table: tableNow.seated,
    dSeat: tableNow.markers.D,
    seatOf: (id) => state.players[id]?.seat ?? null,
    firstToAct: firstToActNow(bp, state),
  });

  // Вкладка была спрятана: часы табло стояли, а опрос шёл — по возвращении несвежее не разыгрывается.
  // Отметка resumed — до первого кадра часов табло после возврата (такт старта момента идёт раньше).
  const resumed = useRef(false);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      resumed.current = true;
      motion.after(0, () => {
        resumed.current = false;
      });
      setQueue((q) => dropStale(q, serverNow()));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [motion]);

  // --- Исполнение очереди: момент начинается, когда экран — игра и прошлый момент доиграл -------
  const live = useLatest({
    queue,
    active,
    mode,
    state,
    showdown: p.showdown,
    nameOf: p.nameOf,
    format,
    bombInputOf,
    onSay: p.onSay,
  });

  /** Такты бомб-пота: показ бейджа, голос, белые минуты, конец момента. */
  const bombHooks = (done: () => void, table: boolean): BombHooks => ({
    els: els.current,
    aiLevel: aiLvlRef.current,
    say: (a) => live.current.onSay?.(a),
    setClockPlain,
    setShown: (on) => {
      flushSync(() => setActive((a) => (a ? { ...a, bombOn: on } : a)));
      // «В игре» вернулось в центр стола новым элементом — проявляется, а не вспыхивает.
      const center = els.current.center;
      if (!on && table && center) {
        motion.cancelOn(center);
        center.style.opacity = '0';
        motion.fade(center, 1, 240);
      }
    },
    done,
  });
  const starting = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (active || queue.length === 0 || mode !== 'game' || p.showdown || starting.current !== null)
      return;
    starting.current = motion.at(Math.max(motion.now, backUntil.current), () => {
      starting.current = null;
      const cur = live.current;
      // Первый кадр после возврата вкладки мог прийти раньше, чем React применил чистку очереди.
      const q = resumed.current ? dropStale(cur.queue, serverNow()) : cur.queue;
      const [m, ...rest] = q;
      if (!m || cur.active || cur.mode !== 'game' || cur.showdown) {
        if (q !== cur.queue) setQueue(q);
        return;
      }
      setQueue(rest);
      if (!stillValid(m, cur.state, serverNow())) return;
      if (m.kind === 'level') setClockFrozen(true);
      setActive({ m, released: false, bombOn: m.kind === 'bomb_end' || m.kind === 'bomb_cancel' });
      devMark(m.kind);
      const finish = () => setActive(null);
      if (isBombMoment(m)) {
        const input = cur.bombInputOf(m.bombPot);
        const hooks = bombHooks(() => {
          setClockPlain(false);
          finish();
        }, input.table);
        if (m.kind === 'bomb') {
          // Сцена ждала в очереди — короче, чтобы взнос встал раньше, чем на телефонах (решение 10).
          const budget = Date.parse(m.bombPot.at) + BOMB_REVEAL_MS - serverNow();
          director.play(input, hooks, scenePace(m.bombPot.bbs, budget, motion.calm));
        } else if (m.kind === 'bomb_cancel') director.cancel(hooks);
        else {
          const btn = m.bombPot.seating.buttonSeat;
          director.end(
            {
              ...input,
              winners: m.winners,
              buttonStays: btn !== null && cur.state.buttonSeat === btn,
            },
            hooks,
          );
        }
        return;
      }
      const release = () => setActive((a) => (a ? { ...a, released: true } : a));
      const hand: Stagehand = { motion, els: els.current, setGm, setClockFrozen, setClockDrum };
      if (m.kind === 'level') {
        const to = cur.format.levels[m.to];
        if (!to) {
          setClockFrozen(false);
          finish();
          return;
        }
        playLevel(hand, cur.format.levels[m.from], to, m.from + 1, m.to + 1, release, finish);
        return;
      }
      const victim = cur.state.players[m.victim];
      const killers = m.by.map(cur.nameOf);
      playKo(
        hand,
        {
          eyebrow: placeText(koPlace(cur.state, m.victim)),
          name: cur.nameOf(m.victim),
          by:
            killers.length === 0
              ? null
              : { verb: killers.length === 1 ? 'выбивает' : 'выбивают', names: joinNames(killers) },
        },
        victim?.seat ?? null,
        release,
        finish,
      );
    });
  });
  useLayoutEffect(
    () => () => {
      if (starting.current !== null) motion.cancel(starting.current);
    },
    [motion],
  );

  // Бомб-пот отменили посреди его сцены — сцена доигрывает «ОТМЕНЁН» и уходит.
  const cancelPlayed = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!active?.cancelled || active.m.kind !== 'bomb') return;
    if (cancelPlayed.current === active.m.eventId) return;
    cancelPlayed.current = active.m.eventId;
    director.cancel(
      bombHooks(() => {
        setClockPlain(false);
        setActive(null);
      }, live.current.bombInputOf(active.m.bombPot).table),
    );
  });

  // Бейдж раздачи в покое: табло открыли посреди бомб-пота, запись несвежая, сцена доиграла, стол
  // перестроился. Пока идёт момент бомб-пота, бейджем ведают его такты.
  useLayoutEffect(() => {
    if (active && isBombMoment(active.m)) return;
    if (bombOn && bombPot) {
      const input = bombInputOf(bombPot);
      const key = `${bombPot.eventId}:${input.table ? 't' : 'l'}:${input.dSeat ?? '-'}:${input.firstToAct ?? '-'}`;
      if (director.mode !== 'steady' || director.steadyKey !== key) {
        director.steady(els.current, input, key);
      }
    } else if (director.mode === 'steady') {
      director.clear(els.current, true);
    }
  });

  // --- Вход в олл-ин и возврат к столу -----------------------------------------------------------
  const playedMode = useRef<Mode | null>(null);
  const cancelEnter = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const was = playedMode.current;
    playedMode.current = mode;
    if (was === mode) return;
    const ai: AllinEls = {
      ai: aiRef.current,
      inner: aiInRef.current,
      wipe: wipeRef.current,
      level: aiLvlRef.current,
    };
    if (was === null) {
      if (mode === 'allin') settleAllin(els.current, ai);
      return;
    }
    if (mode === 'enter')
      cancelEnter.current = playEnter(motion, els.current, ai, () =>
        setMode((m) => (m === 'enter' ? 'allin' : m)),
      );
    if (mode === 'back') {
      cancelEnter.current?.();
      cancelEnter.current = null;
      playBack(motion, els.current, ai, () => {
        setSd(null);
        setMode('game');
      });
      backUntil.current = motion.now + 1300;
    }
  }, [mode, motion]);

  // --- Олл-ин: места участников и вылеты в раздаче -----------------------------------------------
  const busted = useMemo(() => {
    const out = new Map<string, string>();
    if (!sd) return out;
    for (const id of bustedInHand(p.applied, sd.openedEventId)) {
      const pl = state.players[id];
      if (pl && !pl.alive) out.set(id, placeText(pl.place));
    }
    return out;
  }, [sd, p.applied, state]);
  const players = state.players;
  const seatOf = (id: string) => players[id]?.seat ?? null;
  // Кто из проигравших остался в игре — известно только из ответа банкира (раздача закрыта на
  // ривере); развязка держится и пока шторка уводит олл-ин к столу.
  const answered =
    (mode === 'resolve' || mode === 'back') && sd !== null && closedAtRiver(sd, p.applied);
  const stayed = useMemo(() => {
    if (!answered || !sd) return NO_ONE;
    const losers = riverOutcome(sd)?.losers ?? [];
    return stayedAfterRiver(losers, new Set(busted.keys()), (id) => Boolean(players[id]?.alive));
  }, [answered, sd, busted, players]);
  const onResolved = () => setMode((m) => (m === 'resolve' ? 'back' : m));
  useEffect(() => {
    if (mode !== 'resolve') return;
    const id = motion.after(RESOLVE_MAX_MS, () => setMode((m) => (m === 'resolve' ? 'back' : m)));
    return () => motion.cancel(id);
  }, [mode, motion]);

  const onVyletFolded = (seat: number) =>
    setGm((g) => {
      const vylet = new Map(g.vylet);
      vylet.delete(seat);
      return { ...g, vylet };
    });

  const unseated = tableNow.seated ? tableNow.unseated : [];

  const cv = clockView(state);
  const paused = state.timer.status === 'paused';
  const due = paused && Boolean(breakView(state, p.nowMs)?.due);
  // Подпись часов в углу — по показанному состоянию, как и сами часы (стоят, пока ждёт заставка уровня).
  const corner = cornerLevel(format, shown);

  return (
    <main className="tv" data-mode={mode} aria-label="Табло вечера">
      <div className="tv__stage" style={{ transform: `scale(${scale})` }}>
        <div className="tv-layer" style={{ zIndex: 1 }}>
          <p className="tv-head tv-quiet" ref={bindEl(els, 'head')}>
            {p.headText}
          </p>
          <TvGame
            format={format}
            state={shown}
            liveState={state}
            nowMs={p.nowMs}
            pausedMs={p.pausedMs}
            nameOf={p.nameOf}
            moment={gm}
            onVyletFolded={onVyletFolded}
            bombOn={bombOn}
            els={els}
          />
          <div className="tv-tools">{p.tools}</div>
          {/* «Без места» — в одном столбце с подвалом: строки голоса растут вверх и не наезжают на неё. */}
          <div className="tv-foot">
            {unseated.length > 0 && (
              <p className="tv-unseated tv-quiet">Без места: {unseated.map(p.nameOf).join(', ')}</p>
            )}
            {p.foot}
          </div>
        </div>

        {/* Бомб-пот: панель розыгрыша в левой колонке (содержимое строит bombDirector). */}
        <div className="tv-bp" ref={bindEl(els, 'bombPanel')} aria-hidden="true" />

        <div className="tv-ai" ref={aiRef} style={{ visibility: 'hidden' }}>
          <div ref={aiInRef} className="tv-layer">
            {sd && (
              <AllinStage
                key={sd.showdownId}
                showdown={sd}
                nameOf={p.nameOf}
                seatOf={seatOf}
                busted={busted}
                stayed={stayed}
                instant={sd.showdownId === firstShowdownId}
                resolving={mode === 'resolve'}
                onResolved={onResolved}
                bombPot={Boolean(state.bombPot && state.bombPot.eventId < sd.openedEventId)}
              />
            )}
          </div>
        </div>
        <div className="tv-wipe" ref={wipeRef} />

        {/* Часы — над слоями: в олл-ине уезжают в угол. */}
        <div
          className={`tv-clock${paused ? ' tv-clock--paused' : ''}${due ? ' tv-clock--due' : ''}`}
          ref={bindEl(els, 'clock')}
          role="timer"
          aria-label={cv.aria}
        >
          <div className="tv-clock__frame" />
          {state.timer.status !== 'not_started' && (
            <ClockFlaps
              text={cv.text}
              final={finalMinute(state)}
              tone={clockPlain ? 'plain' : clockMode(state) === 'countdown' ? 'run' : 'muted'}
              frozen={frozen}
              drum={clockDrum}
            />
          )}
        </div>
        <p className="tv-ai-lvl tv-eb" ref={aiLvlRef}>
          Уровень {corner.level} · <b>{corner.blinds}</b>
        </p>

        {/* «Нет связи» — поверх всего, и в олл-ине тоже. */}
        {p.stale && (
          <p className="tv-stale" role="status">
            Нет связи · данные на {formatTime(p.updatedAt)}
          </p>
        )}
      </div>
    </main>
  );
}

const NO_ONE: ReadonlySet<string> = new Set();

function sameFrame(a: MomentFrame | null, b: MomentFrame): boolean {
  if (!a) return false;
  if (a.levelIndex !== b.levelIndex || a.heardLevel !== b.heardLevel) return false;
  if ((a.bomb?.eventId ?? null) !== (b.bomb?.eventId ?? null)) return false;
  if (a.eventIds.size !== b.eventIds.size) return false;
  for (const id of b.eventIds) if (!a.eventIds.has(id)) return false;
  return true;
}
