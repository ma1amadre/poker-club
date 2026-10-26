// Стол на табло ТВ из состояния вечера (миграция 028): кто на каком месте сукна, в игре или вылетел,
// где метки D / SB / BB и какие на них суммы, сколько в игре. Чистые функции (тесты —
// tableModel.test.ts). Ставки и стеки посчитает камера по зонам сукна позже: поля bet и stack есть,
// сейчас всегда null — табло рисует под них пустые гнёзда.
//
// Удержание (holds): табло показывает событие моментом — нокаут сначала карточкой в центре стола,
// и только потом место гаснет, а «в игре» перелистывается; смена уровня — сначала заставкой. Пока
// момент не дошёл до своего такта, экран держит прежнее: вылетевший — в игре, уровень — прежний.
// applyHolds строит из настоящего состояния то, что табло показывает сейчас.
import { tablePositions } from '@domain/seats.ts';
import {
  TABLE_SEATS,
  type EveningState,
  type PlayerId,
  type TournamentFormat,
} from '@domain/types.ts';
import type { MarkerSeats } from './tableLayout';

export type SeatStatus = 'live' | 'out' | 'empty';

export interface TvSeat {
  seat: number;
  playerId: PlayerId | null;
  status: SeatStatus;
  /** Место в турнире у вылетевшего, когда оно известно (ребаи закрыты или финиш). */
  place: number | null;
  /** Яркость имени: 1 — на D/SB/BB, 0,8 — остальные в игре, 0,3 — вылетевший, 0 — пусто. */
  focus: number;
  /** Ставка и стек — посчитает камера; сейчас всегда null. */
  bet: number | null;
  stack: number | null;
}

export interface TvTable {
  /** Места 1..10 по номерам. */
  seats: TvSeat[];
  /** Метки: место D (баттон), места SB и BB; null — метки нет. */
  markers: MarkerSeats;
  /** Суммы на метках SB и BB — блайнды уровня. */
  sbAmount: number;
  bbAmount: number;
  /** Кто-то держит место — стол рисуется схемой; иначе — прежний список «За столом». */
  seated: boolean;
  /** В игре без места (в порядке входа). */
  unseated: PlayerId[];
}

export const FOCUS_BLIND = 1;
export const FOCUS_LIVE = 0.8;
export const FOCUS_OUT = 0.3;

/**
 * Стол из состояния. bombOn — на экране бомб-пот (030): в раздаче все в игре, имена — полной
 * яркостью (метки SB и BB гасит слой, позиции те же).
 */
export function tvTable(state: EveningState, opts: { bombOn?: boolean } = {}): TvTable {
  const positions = tablePositions(state);
  const holders = new Map<number, PlayerId>();
  for (const id of state.joinOrder) {
    const seat = state.players[id]?.seat;
    if (seat != null) holders.set(seat, id);
  }
  // Метки — когда позиции определены (баттон задан, на местах двое в игре и больше): D — на месте
  // баттона (бывает у вылетевшего или пустого места до следующей раздачи), SB и BB — у игроков.
  const defined = positions.sb !== null;
  const markers: MarkerSeats = {
    D: defined ? positions.buttonSeat : null,
    SB: positions.sb?.seat ?? null,
    BB: positions.bb?.seat ?? null,
  };
  const blindSeats = new Set([markers.D, markers.SB, markers.BB].filter((s) => s !== null));
  const seats = Array.from({ length: TABLE_SEATS }, (_, i): TvSeat => {
    const seat = i + 1;
    const playerId = holders.get(seat) ?? null;
    const p = playerId ? state.players[playerId] : undefined;
    const status: SeatStatus = !p ? 'empty' : p.alive ? 'live' : 'out';
    return {
      seat,
      playerId,
      status,
      place: p && !p.alive ? p.place : null,
      focus:
        status === 'empty'
          ? 0
          : status === 'out'
            ? FOCUS_OUT
            : opts.bombOn || blindSeats.has(seat)
              ? FOCUS_BLIND
              : FOCUS_LIVE,
      bet: null,
      stack: null,
    };
  });
  return {
    seats,
    markers,
    sbAmount: state.currentLevel.sb,
    bbAmount: state.currentLevel.bb,
    seated: holders.size > 0,
    unseated: positions.unseatedAlive,
  };
}

/** «6-е место» или «вне игры»: место известно, когда ребаи закрыты или игра окончена. */
export function placeText(place: number | null): string {
  return place !== null ? `${place}-е место` : 'вне игры';
}

// --- Удержание ----------------------------------------------------------------------------------

export interface Holds {
  /** Вылетевшие, которых табло ещё показывает в игре (нокаут не дошёл до своего такта). */
  alive: readonly PlayerId[];
  /** Уровень (с 0), который табло ещё показывает; null — настоящий. */
  levelIndex: number | null;
}

export const NO_HOLDS: Holds = { alive: [], levelIndex: null };

/**
 * Состояние, которое табло показывает: вылетевшие из holds.alive — снова в игре (позиции, «в игре»,
 * средний стек — как до нокаута), уровень из holds.levelIndex — блайнды, следующий уровень и средний
 * стек в BB как до смены. Часы и время игры — настоящие. Ничего не держим — тот же объект.
 */
export function applyHolds(
  state: EveningState,
  format: TournamentFormat,
  holds: Holds,
): EveningState {
  const revive = holds.alive.filter((id) => state.players[id] && !state.players[id]?.alive);
  const level = holds.levelIndex;
  const levelHeld =
    level !== null && level !== state.timer.levelIndex && format.levels[level] !== undefined;
  if (revive.length === 0 && !levelHeld) return state;
  const players = { ...state.players };
  for (const id of revive) {
    const p = players[id];
    if (p) players[id] = { ...p, alive: true, place: null };
  }
  const next: EveningState = {
    ...state,
    players,
    aliveCount: state.aliveCount + revive.length,
  };
  if (levelHeld && level !== null) {
    const current = format.levels[level];
    if (current) {
      next.currentLevel = current;
      next.nextLevel = format.levels[level + 1] ?? null;
      next.timer = { ...state.timer, levelIndex: level };
    }
  }
  return next;
}
