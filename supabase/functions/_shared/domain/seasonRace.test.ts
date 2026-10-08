import { describe, expect, it } from 'vitest';
import { standingPlace } from './recap.ts';
import { seasonKey, seasonStandings, type StandingRow } from './season.ts';
import { seasonRace } from './seasonRace.ts';
import type { EveningSummary } from './summary.ts';
import { prng, simpleEvening } from './test-utils.ts';

/** Строка таблицы вручную: для гонки важны очки, победы, нокауты и засчитанные вечера. */
function row(
  playerId: string,
  total: number,
  extra: Partial<Omit<StandingRow, 'playerId' | 'total'>> = {},
): StandingRow {
  return {
    playerId,
    total,
    counted: [total],
    played: 1,
    wins: 0,
    kos: 0,
    netRub: 0,
    ...extra,
  };
}

/** Перемешивание Фишера — Йетса на детерминированном генераторе. */
function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('seasonRace', () => {
  const rows = [
    row('A', 20, { wins: 3 }),
    row('B', 18.5, { wins: 1 }),
    row('C', 17, { wins: 1 }),
    row('D', 15),
  ];

  it('место, соседи сверху и снизу, лидер — с разницей в очках', () => {
    const race = seasonRace(rows, 'C', 10);
    expect(race).toMatchObject({ place: 3, of: 4, total: 17, tiedWith: [] });
    expect(race?.above).toEqual({
      playerIds: ['B'],
      place: 2,
      total: 18.5,
      gap: 1.5,
      tiebreak: null,
    });
    expect(race?.leader).toEqual({ playerIds: ['A'], place: 1, total: 20, gap: 3, tiebreak: null });
    expect(race?.below).toEqual({ playerIds: ['D'], place: 4, total: 15, gap: 2, tiebreak: null });
  });

  it('второе место: лидер — это сосед сверху, отдельно не повторяется', () => {
    const race = seasonRace(rows, 'B', 10);
    expect(race?.above?.playerIds).toEqual(['A']);
    expect(race?.leader).toBeNull();
  });

  it('лидер: выше никого, отрыв от второго', () => {
    const race = seasonRace(rows, 'A', 10);
    expect(race?.place).toBe(1);
    expect(race?.above).toBeNull();
    expect(race?.leader).toBeNull();
    expect(race?.below).toMatchObject({ playerIds: ['B'], gap: 1.5 });
  });

  it('последнее место: ниже никого', () => {
    expect(seasonRace(rows, 'D', 10)?.below).toBeNull();
  });

  it('делёж места: соседи — следующие группы, места пропускаются как в рейтинге', () => {
    const tied = [
      row('A', 20, { wins: 2 }),
      row('B', 12, { wins: 1, kos: 1 }),
      row('C', 12, { wins: 1, kos: 1 }),
      row('D', 9),
    ];
    const race = seasonRace(tied, 'C', 10);
    expect(race).toMatchObject({ place: 2, tiedWith: ['B'] });
    expect(race?.above).toMatchObject({ playerIds: ['A'], place: 1, gap: 8 });
    expect(race?.below).toMatchObject({ playerIds: ['D'], place: 4, gap: 3 });
    expect(seasonRace(tied, 'D', 10)?.above).toMatchObject({ playerIds: ['B', 'C'], place: 2 });
  });

  it('равные очки: соседа отделяют победы, а при равных победах — нокауты', () => {
    const close = [
      row('A', 10, { wins: 2, kos: 0 }),
      row('B', 10, { wins: 1, kos: 4 }),
      row('C', 10, { wins: 1, kos: 2 }),
    ];
    const b = seasonRace(close, 'B', 10);
    expect(b?.above).toMatchObject({ playerIds: ['A'], gap: 0, tiebreak: 'wins' });
    expect(b?.below).toMatchObject({ playerIds: ['C'], gap: 0, tiebreak: 'kos' });
  });

  it('вечера в зачёте: пока места есть — weakestCounted нет, все N заняты — худший засчитанный', () => {
    const open = [row('A', 9, { counted: [5, 4], played: 2 })];
    expect(seasonRace(open, 'A', 3)).toMatchObject({
      counted: 2,
      played: 2,
      bestN: 3,
      weakestCounted: null,
    });
    const full = [row('A', 12, { counted: [5, 4, 3], played: 5 })];
    expect(seasonRace(full, 'A', 3)).toMatchObject({ counted: 3, played: 5, weakestCounted: 3 });
  });

  it('игрока нет в таблице — null', () => {
    expect(seasonRace(rows, 'Z', 10)).toBeNull();
    expect(seasonRace([], 'A', 10)).toBeNull();
  });

  it('разница округляется, как очки (без хвостов 0,1 + 0,2)', () => {
    const r = [row('A', 0.3), row('B', 0.1)];
    expect(seasonRace(r, 'B', 10)?.above?.gap).toBe(0.2);
  });

  it('сгенерированные сезоны: место, соседи и разницы сходятся с таблицей сезона', () => {
    const rand = prng(20261009);
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    for (let n = 0; n < 60; n++) {
      const summaries: EveningSummary[] = [];
      const evenings = 1 + Math.floor(rand() * 8);
      for (let e = 0; e < evenings; e++) {
        const players = ids.filter(() => rand() < 0.7);
        if (players.length < 2) continue;
        const date = new Date(Date.UTC(2026, 9, 2 + e * 7, 12)).toISOString();
        summaries.push(simpleEvening(`s${n}e${e}`, date, shuffle(players, rand), 'winner'));
      }
      const bestN = 1 + Math.floor(rand() * 5);
      const table = seasonStandings(summaries, {
        bestN,
        excluded: new Set(),
        seasonKey: seasonKey('2026-10-02T12:00:00.000Z'),
      });
      for (const r of table) {
        const race = seasonRace(table, r.playerId, bestN);
        expect(race).not.toBeNull();
        if (!race) continue;
        const place = standingPlace(table, r.playerId);
        expect(race.place).toBe(place);
        expect(race.of).toBe(table.length);
        expect(race.counted).toBe(Math.min(bestN, r.played));
        // Сосед сверху — ближайшее меньшее место, все его игроки делят место.
        const higher = table.filter((x) => (standingPlace(table, x.playerId) ?? 0) < race.place);
        if (higher.length === 0) expect(race.above).toBeNull();
        else {
          const abovePlace = Math.max(...higher.map((x) => standingPlace(table, x.playerId) ?? 0));
          expect(race.above?.place).toBe(abovePlace);
          for (const id of race.above?.playerIds ?? [])
            expect(standingPlace(table, id)).toBe(abovePlace);
          expect(race.above?.gap).toBeCloseTo((race.above?.total ?? 0) - r.total, 9);
          expect(race.above?.gap).toBeGreaterThanOrEqual(0);
        }
        const lower = table.filter((x) => (standingPlace(table, x.playerId) ?? 0) > race.place);
        if (lower.length === 0) expect(race.below).toBeNull();
        else {
          const belowPlace = Math.min(...lower.map((x) => standingPlace(table, x.playerId) ?? 0));
          expect(race.below?.place).toBe(belowPlace);
          expect(race.below?.gap).toBeCloseTo(r.total - (race.below?.total ?? 0), 9);
        }
        if (race.leader) {
          expect(race.leader.place).toBe(1);
          expect(race.above?.place).toBeGreaterThan(1);
        }
      }
    }
  });
});
