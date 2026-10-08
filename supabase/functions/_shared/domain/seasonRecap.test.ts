import { describe, expect, it } from 'vitest';
import { computeAchievements, type AchievementInput } from './achievements.ts';
import type { ScoredPrediction } from './predictions.ts';
import { recordsTable } from './records.ts';
import { hallOfFame, moneyStandings, seasonStandings } from './season.ts';
import { closedSeasonRecaps, playerSeason, seasonRecap } from './seasonRecap.ts';
import type { EveningSummary } from './summary.ts';
import { playEvening, prng, simpleEvening, type Step } from './test-utils.ts';

const Q3 = (d: string) => `2026-09-${d}T16:00:00.000Z`;
const Q4 = (d: string) => `2026-${d}T12:00:00.000Z`;

function input(
  summaries: EveningSummary[],
  extra: Partial<AchievementInput> = {},
): AchievementInput {
  return {
    summaries,
    excluded: new Set(['G']),
    predictions: [],
    stars: [],
    bestN: 10,
    currentSeasonKey: '2027-Q1',
    ...extra,
  };
}

const pred = (
  eveningId: string,
  playerId: string,
  winner: 0 | 3,
  firstOut: 0 | 2,
): ScoredPrediction => ({ eveningId, playerId, winner, firstOut, total: winner + firstOut });

describe('итоги сезона', () => {
  // Прошлый сезон: один вечер, A выигрывает и выбивает троих.
  const old = simpleEvening('q3', Q3('24'), ['A', 'B', 'C', 'D'], 'winner');
  // Сезон: три вечера, гость G во втором.
  const e1 = playEvening(
    'e1',
    Q4('10-02'),
    ['A', 'B', 'C', 'D'],
    [
      ['bust', 'D', ['B']],
      ['bust', 'C', ['B']],
      ['bust', 'A', ['B']],
    ],
  );
  const e2 = playEvening(
    'e2',
    Q4('10-09'),
    ['A', 'B', 'C', 'G'],
    [
      ['bust', 'B', ['G']],
      ['rebuy', 'B'],
      ['bust', 'B', ['C']],
      ['bust', 'A', ['C']],
      ['bust', 'G', ['C']],
    ],
  );
  const e3 = simpleEvening('e3', Q4('10-16'), ['C', 'A', 'B', 'D'], 'none');
  const summaries = [old, e1, e2, e3];
  const predictions = [
    pred('e1', 'D', 3, 2),
    pred('e2', 'D', 3, 0),
    pred('e3', 'A', 3, 0),
    pred('e2', 'G', 3, 2), // гость — не в «Оракуле»
    pred('q3', 'C', 3, 0), // прошлый сезон
  ];
  const recap = seasonRecap(input(summaries, { predictions }), '2026-Q4');

  it('таблица, места и чемпион — как во вкладке «Сезон» и в зале славы', () => {
    const rows = seasonStandings(summaries, {
      bestN: 10,
      excluded: new Set(['G']),
      seasonKey: '2026-Q4',
    });
    expect(recap.standings).toEqual(rows);
    expect(recap.closed).toBe(true);
    expect(recap.eveningIds).toEqual(['e1', 'e2', 'e3']);
    expect(recap.bestN).toBe(10);
    const hall = hallOfFame(summaries, {
      bestN: 10,
      excluded: new Set(['G']),
      currentSeasonKey: '2027-Q1',
    });
    expect(recap.champions).toEqual(hall.find((h) => h.seasonKey === '2026-Q4')?.champions);
    expect(recap.podium[0]?.playerIds).toEqual(recap.champions);
    expect(recap.podium.map((p) => p.place)).toEqual([1, 2, 3]);
    expect(recap.places).toEqual([1, 2, 3, 4]);
    expect(recap.standings.some((r) => r.playerId === 'G')).toBe(false);
  });

  it('денежный зачёт, «Оракул сезона» и лучший охотник', () => {
    expect(recap.money).toEqual(
      moneyStandings(summaries, { excluded: new Set(['G']), seasonKey: '2026-Q4' }),
    );
    const top = recap.money[0];
    expect(recap.moneyLeader).toEqual({ playerIds: [top?.playerId], value: top?.netRub });
    // D: 5 + 3 = 8, A: 3; гость и прошлый сезон не в счёт.
    expect(recap.oracle.map((r) => [r.playerId, r.total])).toEqual([
      ['D', 8],
      ['A', 3],
    ]);
    expect(recap.oracleLeader).toEqual({ playerIds: ['D'], value: 8 });
    // B — 3 нокаута в e1, C — 3 в e2: делят.
    expect(recap.hunters?.value).toBe(3);
    expect([...(recap.hunters?.playerIds ?? [])].sort()).toEqual(['B', 'C']);
  });

  it('ачивки сезона: вечера сезона и сезонные, без прошлого сезона', () => {
    const all = computeAchievements(input(summaries, { predictions }));
    const ids = new Set(['e1', 'e2', 'e3']);
    const expected = all.filter(
      (a) => (a.eveningId !== null && ids.has(a.eveningId)) || a.seasonKey === '2026-Q4',
    );
    expect(recap.achievements).toHaveLength(expected.length);
    expect(new Set(recap.achievements)).toEqual(new Set(expected));
    expect(recap.achievements.some((a) => a.code === 'champion')).toBe(true);
    expect(recap.achievements.some((a) => a.eveningId === 'q3')).toBe(false);
  });

  it('рекорды, установленные в сезоне: выше, чем к его началу', () => {
    const kinds = recap.records.map((r) => r.kind);
    // Нокауты за вечер: 3 в прошлом сезоне, 3 в этом — повтор, не установлен.
    expect(kinds).not.toContain('most_kos');
    // Фонд: 2 000 → 2 500 (ребай во втором вечере) — установлен.
    const pool = recap.records.find((r) => r.kind === 'biggest_pool');
    expect(pool).toMatchObject({ value: 2500, previous: 2000 });
    expect(pool?.holders.map((h) => h.eveningId)).toEqual(['e2']);
    for (const r of recap.records) {
      expect(r.previous === null || r.value > r.previous).toBe(true);
      for (const h of r.holders) expect(['e1', 'e2', 'e3']).toContain(h.eveningId);
    }
  });

  it('первый сезон клуба — все рекорды его, previous = null', () => {
    const first = seasonRecap(input([old]), '2026-Q3');
    const table = recordsTable([old], { excluded: new Set(['G']) });
    expect(first.records.map((r) => r.kind)).toEqual(
      table.filter((r) => r.value !== null).map((r) => r.kind),
    );
    expect(first.records.every((r) => r.previous === null)).toBe(true);
  });

  it('«Твой сезон»', () => {
    const rowA = recap.standings.find((r) => r.playerId === 'A');
    const a = playerSeason(recap, 'A');
    expect(a).toMatchObject({
      total: rowA?.total,
      played: 3,
      counted: 3,
      wins: rowA?.wins,
      kos: rowA?.kos,
      netRub: rowA?.netRub,
      of: 4,
      bestN: 10,
    });
    expect(a?.place).toBe(recap.places[recap.standings.indexOf(rowA as never)]);
    expect(a?.oracle).toMatchObject({ place: 2, total: 3 });
    expect(a?.achievements.every((x) => x.playerId === 'A')).toBe(true);
    // Не играл, но прогнозировал: место null, «Оракул» есть.
    const onlyPredictions = seasonRecap(
      input(summaries, { predictions: [...predictions, pred('e1', 'Z', 3, 0)] }),
      '2026-Q4',
    );
    expect(playerSeason(onlyPredictions, 'Z')).toMatchObject({ place: null, played: 0 });
    expect(playerSeason(recap, 'G')).toBeNull();
    expect(playerSeason(recap, 'nobody')).toBeNull();
  });

  it('текущий сезон — не закрыт: сезонных ачивок нет', () => {
    const live = seasonRecap(input(summaries, { currentSeasonKey: '2026-Q4' }), '2026-Q4');
    expect(live.closed).toBe(false);
    expect(live.achievements.some((a) => a.seasonKey !== null)).toBe(false);
  });

  it('пустой сезон', () => {
    const empty = seasonRecap(input(summaries), '2026-Q2');
    expect(empty).toMatchObject({
      eveningIds: [],
      standings: [],
      podium: [],
      champions: [],
      moneyLeader: null,
      oracleLeader: null,
      hunters: null,
      records: [],
      achievements: [],
    });
  });
});

describe('подиум с дележом и замороженные «лучшие N»', () => {
  it('делёж второго места: подиум — 1-е и двое на 2-м, третьего нет', () => {
    // A дважды побеждает; B и C по разу вторые и третьи — поровну очков, без побед и нокаутов.
    const s = [
      simpleEvening('e1', Q4('10-02'), ['A', 'B', 'C', 'D']),
      simpleEvening('e2', Q4('10-09'), ['A', 'C', 'B', 'D']),
    ];
    const recap = seasonRecap(input(s), '2026-Q4');
    expect(recap.places).toEqual([1, 2, 2, 4]);
    expect(recap.podium.map((p) => [p.place, [...p.playerIds].sort(), p.total])).toEqual([
      [1, ['A'], 8],
      [2, ['B', 'C'], 3],
    ]);
    expect(recap.champions).toEqual(['A']);
    expect(playerSeason(recap, 'C')).toMatchObject({ place: 2, podiumPlace: 2, champion: false });
    // D — 4-й с нулём очков: не на подиуме.
    expect(playerSeason(recap, 'D')).toMatchObject({ place: 4, podiumPlace: null, total: 0 });
  });

  it('никто не набрал очков — ни чемпиона, ни подиума', () => {
    const s = [simpleEvening('e1', Q4('10-02'), ['A', 'B'])];
    const zero = seasonRecap(
      input(s, { summaries: s.map((x) => ({ ...x, points: {} })) }),
      '2026-Q4',
    );
    expect(zero.champions).toEqual([]);
    expect(zero.podium).toEqual([]);
  });

  it('закрытый сезон считается по замороженному N, а не по текущей настройке', () => {
    const s = [
      simpleEvening('e1', Q4('10-02'), ['A', 'B']),
      simpleEvening('e2', Q4('10-09'), ['B', 'A']),
      simpleEvening('e3', Q4('10-16'), ['B', 'A']),
    ];
    const frozen = seasonRecap(input(s, { bestN: 10, bestNBySeason: { '2026-Q4': 1 } }), '2026-Q4');
    expect(frozen.bestN).toBe(1);
    expect(frozen.standings.every((r) => r.counted.length <= 1)).toBe(true);
    expect(playerSeason(frozen, 'B')?.counted).toBe(1);
  });
});

describe('итоги всех завершённых сезонов', () => {
  it('новые сверху, без текущего; совпадают с залом славы', () => {
    const s = [
      simpleEvening('a', Q3('10'), ['A', 'B']),
      simpleEvening('b', Q4('10-02'), ['B', 'A']),
      simpleEvening('c', '2027-01-08T12:00:00.000Z', ['A', 'B']),
    ];
    const list = closedSeasonRecaps(input(s, { currentSeasonKey: '2027-Q1' }));
    expect(list.map((r) => r.seasonKey)).toEqual(['2026-Q4', '2026-Q3']);
    const hall = hallOfFame(s, {
      bestN: 10,
      excluded: new Set(['G']),
      currentSeasonKey: '2027-Q1',
    });
    expect(list.map((r) => r.champions)).toEqual(hall.map((h) => h.champions));
  });

  it('сгенерированные истории: подиум, чемпион, охотник и «Твой сезон» сходятся с таблицей', () => {
    const rnd = prng(2026);
    const pool = ['A', 'B', 'C', 'D', 'E', 'G'];
    for (let run = 0; run < 120; run++) {
      const summaries: EveningSummary[] = [];
      const n = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const players = pool.filter(() => rnd() < 0.7);
        if (players.length < 2) continue;
        const order = [...players].sort(() => rnd() - 0.5);
        const steps: Step[] = [];
        const alive = new Set(order);
        for (const victim of order.slice(1)) {
          alive.delete(victim);
          const killers = [...alive].filter(() => rnd() < 0.5);
          steps.push(['bust', victim, killers]);
        }
        const month = 10 + Math.floor(rnd() * 3);
        const day = 1 + Math.floor(rnd() * 28);
        const date = `2026-${month}-${String(day).padStart(2, '0')}T${String(10 + i).padStart(2, '0')}:00:00.000Z`;
        summaries.push(playEvening(`r${run}e${i}`, date, order, steps));
      }
      const inp = input(summaries, { bestN: 1 + Math.floor(rnd() * 4) });
      const recap = seasonRecap(inp, '2026-Q4');
      const hall = hallOfFame(summaries, {
        bestN: inp.bestN,
        excluded: inp.excluded,
        currentSeasonKey: '2027-Q1',
      });
      expect(recap.champions).toEqual(hall[0]?.champions ?? []);
      recap.standings.forEach((row, i) => {
        const place = recap.places[i] ?? 0;
        const step = recap.podium.find((p) => p.playerIds.includes(row.playerId));
        expect(Boolean(step)).toBe(place <= 3 && row.total > 0);
        if (step) expect(step.place).toBe(place);
        const mine = playerSeason(recap, row.playerId);
        expect(mine).toMatchObject({ place, total: row.total, kos: row.kos, wins: row.wins });
      });
      const maxKos = Math.max(0, ...recap.standings.map((r) => r.kos));
      expect(recap.hunters?.value ?? 0).toBe(maxKos);
      expect(recap.hunters?.playerIds.sort() ?? []).toEqual(
        maxKos > 0
          ? recap.standings
              .filter((r) => r.kos === maxKos)
              .map((r) => r.playerId)
              .sort()
          : [],
      );
      expect(recap.standings.some((r) => r.playerId === 'G')).toBe(false);
    }
  });
});
