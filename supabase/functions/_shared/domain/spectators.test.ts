// Болельщик на вечер (миграция 024): флаг перекрывают «иду» / «под вопросом» и место за столом.
import { describe, expect, it } from 'vitest';
import { seatedIds, spectatesEvening } from './spectators.ts';
import type { EveningEvent } from './types.ts';

describe('spectatesEvening', () => {
  it('без флага — всегда игрок: null (ещё не выбирал) и false', () => {
    for (const spectator of [null, undefined, false]) {
      expect(spectatesEvening({ spectator })).toBe(false);
      expect(spectatesEvening({ spectator, rsvp: 'no' })).toBe(false);
    }
  });

  it('болельщик без ответа и с «не иду» — болельщик и на этот вечер', () => {
    expect(spectatesEvening({ spectator: true })).toBe(true);
    expect(spectatesEvening({ spectator: true, rsvp: null })).toBe(true);
    expect(spectatesEvening({ spectator: true, rsvp: 'no' })).toBe(true);
    expect(spectatesEvening({ spectator: true, rsvp: 'no', seated: false })).toBe(true);
  });

  it('«иду», «под вопросом» или место за столом — на этот вечер игрок', () => {
    expect(spectatesEvening({ spectator: true, rsvp: 'yes' })).toBe(false);
    expect(spectatesEvening({ spectator: true, rsvp: 'maybe' })).toBe(false);
    expect(spectatesEvening({ spectator: true, seated: true })).toBe(false);
    // «Не иду», а банкир всё же посадил — за столом важнее ответа.
    expect(spectatesEvening({ spectator: true, rsvp: 'no', seated: true })).toBe(false);
  });
});

describe('seatedIds', () => {
  const ev = (id: number, type: EveningEvent['type'], payload: object, voided = false) =>
    ({ id, type, payload, voided, at: '2026-10-09T12:00:00.000Z' }) as EveningEvent;

  it('действующие входы; отменённый вход, ребай и вылет — не посадка', () => {
    const events = [
      ev(1, 'join', { playerId: 'A' }),
      ev(2, 'join', { playerId: 'B' }, true),
      ev(3, 'join', { playerId: 'C', stacks: 2 }),
      ev(4, 'bust', { playerId: 'D', by: ['A'] }),
      ev(5, 'rebuy', { playerId: 'E' }),
      ev(6, 'timer_start', {}),
    ];
    expect([...seatedIds(events)].sort()).toEqual(['A', 'C']);
  });

  it('повторный вход того же игрока (replay его не примет) — всё равно один человек за столом', () => {
    expect([
      ...seatedIds([ev(1, 'join', { playerId: 'A' }), ev(2, 'join', { playerId: 'A' })]),
    ]).toEqual(['A']);
  });

  it('вход без игрока в payload пропускается', () => {
    expect(seatedIds([ev(1, 'join', {}), ev(2, 'join', { playerId: '' })]).size).toBe(0);
  });
});
