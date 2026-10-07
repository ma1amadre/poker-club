// Помощники ТОЛЬКО для тестов домена (в index.ts не реэкспортируются).
// Журнал вечера собирается как в БД: id растут, `at` — серверное время вставки.
import { DEFAULT_FORMAT } from './format.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import { summarize, type EveningSummary } from './summary.ts';
import type { EveningEvent, EventPayload, EventType, PlayerId, TournamentFormat } from './types.ts';

export const MIN = 60_000;

export interface Journal {
  events: EveningEvent[];
  /** Текущее «серверное» время журнала, мс. */
  now(): number;
  /** Сдвинуть часы на minutes минут (можно дробно). */
  wait(minutes: number): Journal;
  add(type: EventType, payload?: EventPayload): number;
  join(...ids: PlayerId[]): Journal;
  /** Вход кратности stacks (payload с полем stacks). */
  joinStacks(id: PlayerId, stacks: number): number;
  /** Ребай; stacks — кратность (без него payload как у событий до кратных входов). */
  rebuy(id: PlayerId, stacks?: number): number;
  bust(id: PlayerId, by?: PlayerId[]): number;
  start(): number;
  pause(): number;
  resume(): number;
  next(): number;
  prev(): number;
  hand(): number;
  finish(): number;
  payment(id: PlayerId, amountRub: number): number;
  voidEvent(eventId: number): void;
}

export function journal(startIso = '2026-10-08T16:00:00.000Z'): Journal {
  let id = 0;
  let ms = Date.parse(startIso);
  const events: EveningEvent[] = [];
  const j: Journal = {
    events,
    now: () => ms,
    wait(minutes) {
      ms += Math.round(minutes * MIN);
      return j;
    },
    add(type, payload = {}) {
      id += 1;
      events.push({ id, type, payload, at: new Date(ms).toISOString(), voided: false });
      return id;
    },
    join(...ids) {
      for (const p of ids) j.add('join', { playerId: p });
      return j;
    },
    joinStacks: (p, stacks) => j.add('join', { playerId: p, stacks }),
    rebuy: (p, stacks) =>
      j.add('rebuy', stacks === undefined ? { playerId: p } : { playerId: p, stacks }),
    bust: (p, by = []) => j.add('bust', { playerId: p, by }),
    start: () => j.add('timer_start'),
    pause: () => j.add('timer_pause'),
    resume: () => j.add('timer_resume'),
    next: () => j.add('level_next'),
    prev: () => j.add('level_prev'),
    hand: () => j.add('hand'),
    finish: () => j.add('finish'),
    payment: (p, amountRub) => j.add('payment', { playerId: p, amountRub }),
    voidEvent(eventId) {
      const ev = events.find((e) => e.id === eventId);
      if (!ev) throw new Error(`нет события ${eventId}`);
      ev.voided = true;
    },
  };
  return j;
}

/** Детерминированный PRNG (mulberry32): в тестах нужен повторяемый «случай» по seed. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Шаг вечера; у ребая — необязательная кратность. */
export type Step = ['bust', PlayerId, PlayerId[]] | ['rebuy', PlayerId, number?];

/**
 * Завершённый вечер для статистики: все входят, таймер стартует, шаги по порядку, затем finish.
 * Шаги должны оставить в игре ровно одного — иначе summarize бросит ошибку (и это правильно).
 */
export function playEvening(
  eveningId: string,
  dateIso: string,
  players: PlayerId[],
  steps: Step[],
  format: TournamentFormat = DEFAULT_FORMAT,
): EveningSummary {
  const j = journal(dateIso);
  j.join(...players);
  j.start();
  for (const s of steps) {
    j.wait(1);
    if (s[0] === 'bust') j.bust(s[1], s[2]);
    else j.rebuy(s[1], s[2]);
  }
  j.finish();
  return summarize(eveningId, dateIso, format, j.events, DEFAULT_SCORING);
}

/**
 * Простой вечер по итоговым местам (index 0 — победитель). Вылетают снизу вверх.
 * ko: 'winner' — всех выбивает победитель, 'none' — никто (сиротские головы).
 */
export function simpleEvening(
  eveningId: string,
  dateIso: string,
  places: PlayerId[],
  ko: 'winner' | 'none' = 'none',
  rebuys: Partial<Record<PlayerId, number>> = {},
): EveningSummary {
  const winner = places[0];
  if (winner === undefined) throw new Error('пустой вечер');
  const steps: Step[] = [];
  // Ребаи — в начале: игрок вылетает (без выбивших, чтобы не трогать KO) и сразу перезаходит.
  for (const [id, n] of Object.entries(rebuys)) {
    for (let i = 0; i < (n ?? 0); i++) {
      steps.push(['bust', id, []]);
      steps.push(['rebuy', id]);
    }
  }
  for (const id of [...places].reverse()) {
    if (id === winner) continue;
    steps.push(['bust', id, ko === 'winner' ? [winner] : []]);
  }
  return playEvening(eveningId, dateIso, places, steps);
}
