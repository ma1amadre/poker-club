import { describe, expect, it } from 'vitest';
import { chronological } from './achievements.ts';
import { lastEveningMoves, placeDelta, tiedPlaces } from './placeMoves.ts';
import type { ScoredPrediction } from './predictions.ts';
import { standingPlace } from './recap.ts';
import {
  allTimeStandings,
  moneyStandings,
  oracleStandings,
  sameRank,
  seasonStandings,
  type StandingRow,
} from './season.ts';
import type { EveningSummary } from './summary.ts';
import { prng, simpleEvening } from './test-utils.ts';

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12)).toISOString();

function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const season = (list: readonly EveningSummary[]) =>
  seasonStandings(list, { bestN: 10, excluded: new Set(['G']), seasonKey: '2026-Q4' });

describe('tiedPlaces', () => {
  it('равные соседние строки делят место, следующее пропускается', () => {
    expect(tiedPlaces([5, 4, 4, 3, 3, 3, 1], (a, b) => a === b)).toEqual([1, 2, 2, 4, 4, 4, 7]);
    expect(tiedPlaces([], (a, b) => a === b)).toEqual([]);
  });
});

describe('lastEveningMoves', () => {
  // A выигрывает первые два вечера, третий — C (B вылетает вторым, A — последним).
  const e1 = simpleEvening('e1', day(2), ['A', 'B', 'C', 'D'], 'winner');
  const e2 = simpleEvening('e2', day(9), ['A', 'B', 'D', 'C'], 'winner');
  const e3 = simpleEvening('e3', day(16), ['C', 'B', 'D', 'A'], 'winner');

  it('сдвиг после последнего вечера: кто поднялся, кто опустился, кто на месте', () => {
    const moves = lastEveningMoves([e3, e1, e2], season, sameRank);
    expect(moves?.eveningId).toBe('e3');
    const before = season([e1, e2]);
    const after = season([e1, e2, e3]);
    for (const r of after) {
      expect(moves?.moves[r.playerId]).toEqual({
        from: standingPlace(before, r.playerId),
        to: standingPlace(after, r.playerId),
      });
    }
    const c = moves?.moves.C;
    expect(c && placeDelta(c)).toBeGreaterThan(0);
  });

  it('новичок таблицы — from: null, сдвига нет', () => {
    const late = simpleEvening('e4', day(23), ['E', 'A', 'B'], 'winner');
    const moves = lastEveningMoves([e1, e2, e3, late], season, sameRank);
    expect(moves?.moves.E).toEqual({ from: null, to: expect.any(Number) });
    const e = moves?.moves.E;
    expect(e && placeDelta(e)).toBeNull();
  });

  it('первый вечер таблицы и пустая таблица — сдвигов нет', () => {
    expect(lastEveningMoves([e1], season, sameRank)).toBeNull();
    expect(lastEveningMoves([], season, sameRank)).toBeNull();
  });

  it('гости в таблицу не входят — и в сдвигах их нет', () => {
    const withGuest = simpleEvening('e4', day(23), ['G', 'A', 'B'], 'winner');
    const moves = lastEveningMoves([e1, e2, withGuest], season, sameRank);
    expect(moves?.moves.G).toBeUndefined();
  });

  it('делёж места: равные строки получают одно место до и после', () => {
    // Два вечера с зеркальными итогами: A и B равны по очкам, победам и нокаутам.
    const x1 = simpleEvening('x1', day(2), ['A', 'B'], 'winner');
    const x2 = simpleEvening('x2', day(9), ['B', 'A'], 'winner');
    const moves = lastEveningMoves([x1, x2], season, sameRank);
    expect(moves?.moves.A).toEqual({ from: 1, to: 1 });
    expect(moves?.moves.B).toEqual({ from: 2, to: 1 });
  });

  it('деньги и всё время — те же таблицы, что на экране', () => {
    const list = [e1, e2, e3];
    const money = (s: readonly EveningSummary[]) => moneyStandings(s, { excluded: new Set() });
    const sameNet = (a: StandingRow, b: StandingRow) => a.netRub === b.netRub;
    const moves = lastEveningMoves(list, money, sameNet);
    const placeIn = (rows: StandingRow[], id: string) => {
      const places = tiedPlaces(rows, sameNet);
      return places[rows.findIndex((r) => r.playerId === id)];
    };
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(moves?.moves[id]).toEqual({
        from: placeIn(money([e1, e2]), id),
        to: placeIn(money(list), id),
      });
    }
    const all = lastEveningMoves(
      list,
      (s) => allTimeStandings(s, { excluded: new Set() }),
      sameRank,
    );
    expect(all?.eveningId).toBe('e3');
  });

  it('«Оракул»: таблица по прогнозам вечеров таблицы', () => {
    const scores: ScoredPrediction[] = [
      { eveningId: 'e1', playerId: 'A', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'e2', playerId: 'B', winner: 3, firstOut: 2, total: 5 },
      { eveningId: 'e3', playerId: 'A', winner: 3, firstOut: 2, total: 5 },
    ];
    const oracle = (s: readonly EveningSummary[]) => {
      const ids = new Set(s.map((x) => x.eveningId));
      return oracleStandings(scores.filter((p) => ids.has(p.eveningId)));
    };
    const moves = lastEveningMoves([e1, e2, e3], oracle, (a, b) => a.total === b.total);
    expect(moves?.moves.A).toEqual({ from: 2, to: 1 });
    expect(moves?.moves.B).toEqual({ from: 1, to: 2 });
  });

  it('сгенерированные истории: from и to — места таблицы без последнего вечера и с ним', () => {
    const rand = prng(91026);
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    for (let n = 0; n < 80; n++) {
      const list: EveningSummary[] = [];
      const count = 1 + Math.floor(rand() * 7);
      for (let e = 0; e < count; e++) {
        const players = ids.filter(() => rand() < 0.65);
        if (players.length < 2) continue;
        list.push(
          simpleEvening(`g${n}-${e}`, day(1 + e * 7), shuffle(players, rand), 'winner', {
            [players[0] as string]: Math.floor(rand() * 2),
          }),
        );
      }
      const moves = lastEveningMoves(shuffle(list, rand), season, sameRank);
      if (list.length < 2) {
        expect(moves).toBeNull();
        continue;
      }
      const ordered = chronological(list);
      const before = season(ordered.slice(0, -1));
      const after = season(ordered);
      expect(moves?.eveningId).toBe(ordered.at(-1)?.eveningId);
      expect(Object.keys(moves?.moves ?? {}).sort()).toEqual(after.map((r) => r.playerId).sort());
      for (const r of after) {
        expect(moves?.moves[r.playerId]).toEqual({
          from: standingPlace(before, r.playerId),
          to: standingPlace(after, r.playerId),
        });
      }
    }
  });
});
