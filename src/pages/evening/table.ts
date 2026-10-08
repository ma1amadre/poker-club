// «Режим стола» на пульте банкира: места за столом, ряд вылетевших и строка полосы часов. Чистый
// модуль (тесты — table.test.ts): деньги, места и права записи считает домен, здесь — раскладка.
//
// Места не прыгают: сетка — все, кто сел за стол, в порядке посадки (joinOrder). Вылетевший
// остаётся на своём месте приглушённым, после ребая плитка снова живая там же; опоздавший садится в
// конец. Раньше список уводил вылетевшего вниз, и строки сдвигались под пальцем.
import { canApply } from '@domain/replay.ts';
import type { EveningState, PlayerId, TournamentFormat } from '@domain/types.ts';
import { formatDuration, NBSP } from '../../shared/lib/format';
import { breakLine, breakView, type RebuyWindow } from './lib';

export interface SeatTile {
  playerId: PlayerId;
  alive: boolean;
  /** Подпись под именем у вылетевшего: «6-е место» или «вне игры»; у живого — null. */
  note: string | null;
}

/** Места за столом в порядке посадки: живые и вылетевшие — каждый на своём месте. */
export function seatTiles(state: EveningState): SeatTile[] {
  return state.joinOrder.flatMap((playerId) => {
    const p = state.players[playerId];
    if (!p) return [];
    return [
      {
        playerId,
        alive: p.alive,
        note: p.alive ? null : p.place !== null ? `${p.place}-е${NBSP}место` : 'вне игры',
      },
    ];
  });
}

export interface BustedChip {
  playerId: PlayerId;
  /** Можно докупиться прямо сейчас (ребаи открыты, лимит не исчерпан). */
  rebuy: boolean;
  /** «ребай», «6-е место», «вне игры». */
  note: string;
}

/**
 * Ряд вылетевших: свежий вылет первым, известные места — по месту. Тап — шторка ребая, пока можно
 * докупиться (canApply домена), иначе — карточка игрока.
 */
export function bustedRow(
  format: TournamentFormat,
  state: EveningState,
  nowMs: number,
): BustedChip[] {
  return state.joinOrder
    .flatMap((id) => {
      const p = state.players[id];
      return p && !p.alive ? [p] : [];
    })
    .sort((a, b) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return 1;
      if (b.place !== null) return -1;
      return (b.finalBustEventId ?? 0) - (a.finalBustEventId ?? 0);
    })
    .map((p) => {
      const rebuy = canApply(format, state, 'rebuy', { playerId: p.playerId }, nowMs) === null;
      return {
        playerId: p.playerId,
        rebuy,
        note: rebuy ? 'ребай' : p.place !== null ? `${p.place}-е${NBSP}место` : 'вне игры',
      };
    });
}

/** Короткая строка ребаев для полосы часов: «ребаи ещё 1 ч 20 мин», «ребаи закрыты». */
export function rebuyShortText(win: RebuyWindow): string {
  switch (win.kind) {
    case 'closed':
      return 'ребаи закрыты';
    case 'whole_game':
      return 'ребаи всю игру';
    case 'not_started':
      return `ребаи до конца ${win.untilLevel}-го уровня`;
    case 'open':
      return win.msLeft === null
        ? `ребаи до конца ${win.untilLevel}-го уровня`
        : `ребаи ещё ${formatDuration(win.msLeft)}`;
  }
}

export type StripMode = 'not_started' | 'running' | 'paused' | 'break' | 'due';

export interface StripStatus {
  mode: StripMode;
  /** Слово вместо цифр на паузе: «Пауза», «Перерыв»; иначе null — цифры. */
  word: string | null;
  /** Строка состояния паузы: «стоим 3 мин», «продолжаем через 07:12», «пора продолжать». */
  line: string | null;
}

/**
 * Что показывает полоса часов. Пауза без срока — «Пауза · стоим 3 мин» (от принятой паузы, как на
 * табло); перерыв на N минут — отсчёт до конца, по истечении — «пора продолжать» (таймер сам не
 * продолжает — только банкир).
 */
export function stripStatus(state: EveningState, nowMs: number): StripStatus {
  const t = state.timer;
  if (t.status === 'not_started') return { mode: 'not_started', word: null, line: null };
  if (t.status === 'running') return { mode: 'running', word: null, line: null };
  const brk = breakView(state, nowMs);
  if (brk) return { mode: brk.due ? 'due' : 'break', word: 'Перерыв', line: breakLine(brk) };
  const at = t.pause ? Date.parse(t.pause.at) : Number.NaN;
  return {
    mode: 'paused',
    word: 'Пауза',
    line: Number.isFinite(at) ? `стоим ${formatDuration(Math.max(0, nowMs - at))}` : null,
  };
}
