// «На кону» перед вечером: шаги к ачивкам по правилам computeAchievements, досягаемые рекорды по
// правилам recordsTable, расклад сезона вечера; кто может прийти — по ответам на анонс.
import { describe, expect, it } from 'vitest';
import { computeAchievements, type AchievementInput } from './achievements.ts';
import type { ScoredPrediction } from './predictions.ts';
import { eveningStakes, type StakesInput, type StakesPlayer } from './stakes.ts';
import { playEvening, simpleEvening } from './test-utils.ts';

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`;
const ALL: StakesPlayer[] = ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, rsvp: null }));

function input(summaries: StakesInput['summaries'], extra: Partial<StakesInput> = {}): StakesInput {
  return { summaries, excluded: new Set(), predictions: [], bestN: 10, ...extra };
}

const opts = (players: StakesPlayer[] = ALL, eveningDate = day(29)) => ({
  eveningDate,
  players,
  buyInRub: 500,
});

describe('шаг к «Хет-трику» и рекорду серии', () => {
  it('две победы подряд — третья даст «Хет-трик» и новый рекорд серии', () => {
    const s = [
      simpleEvening('e1', day(1), ['A', 'B', 'C'], 'winner'),
      simpleEvening('e2', day(8), ['A', 'C', 'B'], 'winner'),
    ];
    expect(eveningStakes(input(s), opts()).items).toEqual([
      { kind: 'win_step', playerId: 'A', hatTrick: true, streak: 3, record: 'new' },
    ]);
  });

  it('серии «Хет-трика» не перекрываются: после трёх побед счёт заново, рекорд серии — подряд', () => {
    const s = [1, 8, 15, 22].map((d, i) => simpleEvening(`e${i}`, day(d), ['A', 'B'], 'winner'));
    // Четыре победы: один «Хет-трик» уже есть, до следующего — две; рекорд серии 4 — у самого A.
    // (Заодно у A четыре нокаута B — шаг к «Заклятому врагу», он проверяется ниже.)
    const steps = (list: StakesInput['summaries'], o = opts()) =>
      eveningStakes(input(list), o).items.filter((i) => i.kind === 'win_step');
    expect(steps(s)).toEqual([
      { kind: 'win_step', playerId: 'A', hatTrick: false, streak: 5, record: 'new' },
    ]);
    const five = [...s, simpleEvening('e5', day(29), ['A', 'B'], 'winner')];
    expect(steps(five, opts(ALL, '2026-11-05T12:00:00.000Z'))[0]).toMatchObject({
      hatTrick: true,
      streak: 6,
    });
    // «Хет-трик» по тем же правилам, что у ачивки: после пятой победы второй ещё не выдан.
    const achInput: AchievementInput = {
      ...input(five),
      stars: [],
      currentSeasonKey: '2026-Q4',
    };
    expect(computeAchievements(achInput).filter((a) => a.code === 'hat_trick')).toHaveLength(1);
  });

  it('рекорд серии: повторить — equal, не дотянуть — нет строки', () => {
    // Рекорд серии — 3 у B. У A сейчас 2 подряд: победа повторит рекорд.
    const s = [
      simpleEvening('e1', day(1), ['B', 'A'], 'winner'),
      simpleEvening('e2', day(2), ['B', 'A'], 'winner'),
      simpleEvening('e3', day(3), ['B', 'A'], 'winner'),
      simpleEvening('e4', day(4), ['A', 'B'], 'winner'),
      simpleEvening('e5', day(5), ['A', 'B'], 'winner'),
    ];
    const items = eveningStakes(input(s), opts()).items;
    expect(items).toEqual([
      { kind: 'win_step', playerId: 'A', hatTrick: true, streak: 3, record: 'equal' },
    ]);
    // Одна победа при рекорде 3 — ни «Хет-трика», ни рекорда.
    // (И первая серия из двух побед рекордом не объявляется — см. «Оракул» ниже: у B одна победа.)
    const one = s.slice(0, 4);
    expect(eveningStakes(input(one), opts()).items).toEqual([]);
  });

  it('гость и ответивший «не иду» — без шагов', () => {
    const s = [
      simpleEvening('e1', day(1), ['A', 'B'], 'winner'),
      simpleEvening('e2', day(8), ['A', 'B'], 'winner'),
    ];
    expect(eveningStakes(input(s, { excluded: new Set(['A']) }), opts()).items).toEqual([]);
    const no = ALL.map((p) => (p.playerId === 'A' ? { ...p, rsvp: 'no' as const } : p));
    expect(eveningStakes(input(s), opts(no)).items).toEqual([]);
  });
});

describe('шаг к «Заклятому врагу»', () => {
  // A выбивает B четыре раза за два вечера.
  const s = [
    playEvening(
      'e1',
      day(1),
      ['A', 'B', 'C'],
      [
        ['bust', 'B', ['A']],
        ['rebuy', 'B'],
        ['bust', 'B', ['A']],
        ['bust', 'C', []],
      ],
    ),
    playEvening(
      'e2',
      day(8),
      ['C', 'A', 'B'],
      [
        ['bust', 'B', ['A']],
        ['rebuy', 'B'],
        ['bust', 'B', ['A']],
        ['bust', 'A', ['C']],
      ],
    ),
  ];

  it('четыре нокаута одного соперника — пятый даст ачивку', () => {
    expect(eveningStakes(input(s), opts()).items).toContainEqual({
      kind: 'enemy_step',
      playerId: 'A',
      victimId: 'B',
      kos: 4,
      target: 5,
    });
  });

  it('жертва ответила «не иду» — шага нет', () => {
    const players = ALL.map((p) => (p.playerId === 'B' ? { ...p, rsvp: 'no' as const } : p));
    expect(eveningStakes(input(s), opts(players)).items.map((i) => i.kind)).not.toContain(
      'enemy_step',
    );
  });
});

describe('«Первая кровь», рекорд фонда, «Оракул»', () => {
  it('в клубе не было нокаутов — первый даст «Первую кровь»; после нокаута — нет', () => {
    expect(eveningStakes(input([]), opts()).items).toEqual([{ kind: 'first_blood' }]);
    const calm = [simpleEvening('e1', day(1), ['A', 'B'])];
    expect(eveningStakes(input(calm), opts()).items).toContainEqual({ kind: 'first_blood' });
    const ko = [simpleEvening('e1', day(1), ['A', 'B'], 'winner')];
    expect(eveningStakes(input(ko), opts()).items).not.toContainEqual({ kind: 'first_blood' });
  });

  it('«иду» уже дают фонд не меньше рекорда', () => {
    // Рекорд фонда — 1 500 ₽ (трое по 500).
    const s = [simpleEvening('e1', day(1), ['A', 'B', 'C'], 'winner')];
    const yes = (n: number): StakesPlayer[] =>
      ALL.map((p, i) => ({ ...p, rsvp: i < n ? ('yes' as const) : null }));
    expect(eveningStakes(input(s), opts(yes(4))).items).toContainEqual({
      kind: 'pool_record',
      going: 4,
      poolRub: 2000,
      recordRub: 1500,
      status: 'new',
    });
    expect(eveningStakes(input(s), opts(yes(3))).items).toContainEqual(
      expect.objectContaining({ kind: 'pool_record', status: 'equal' }),
    );
    expect(eveningStakes(input(s), opts(yes(2))).items.map((i) => i.kind)).not.toContain(
      'pool_record',
    );
  });

  it('два угаданных победителя подряд — третий даст «Оракула», и прогноз делают не только игроки', () => {
    const s = [
      simpleEvening('e1', day(1), ['A', 'B'], 'winner'),
      simpleEvening('e2', day(8), ['B', 'A'], 'winner'),
    ];
    const predictions: ScoredPrediction[] = [
      { eveningId: 'e1', playerId: 'D', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'e2', playerId: 'D', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'e2', playerId: 'C', winner: 3, firstOut: 0, total: 3 },
    ];
    const players = ALL.map((p) => (p.playerId === 'D' ? { ...p, rsvp: 'no' as const } : p));
    expect(eveningStakes(input(s, { predictions }), opts(players)).items).toEqual([
      { kind: 'oracle_step', playerId: 'D', streak: 2, target: 3 },
    ]);
  });
});

describe('болельщик (миграция 024)', () => {
  const s = [
    simpleEvening('e1', day(1), ['A', 'B'], 'winner'),
    simpleEvening('e2', day(8), ['A', 'B'], 'winner'),
  ];
  const predictions: ScoredPrediction[] = [
    { eveningId: 'e1', playerId: 'A', winner: 3, firstOut: 0, total: 3 },
    { eveningId: 'e2', playerId: 'A', winner: 3, firstOut: 0, total: 3 },
  ];
  const as = (spectator: boolean, rsvp: StakesPlayer['rsvp'] = null): StakesPlayer[] =>
    ALL.map((p) => (p.playerId === 'A' ? { ...p, rsvp, spectator } : p));

  it('болельщик на вечер: шагов за столом нет, шаг к «Оракулу» остаётся', () => {
    expect(eveningStakes(input(s, { predictions }), opts(as(true))).items).toEqual([
      { kind: 'oracle_step', playerId: 'A', streak: 2, target: 3 },
    ]);
  });

  it('тот же человек игроком (флаг снят вызывающим: «иду», «под вопросом», за столом) — шаги есть', () => {
    const kinds = eveningStakes(input(s, { predictions }), opts(as(false, 'maybe'))).items.map(
      (i) => i.kind,
    );
    expect(kinds).toEqual(['win_step', 'oracle_step']);
  });

  it('болельщик не делает фонд: в «идут» для рекорда фонда считаются только игроки', () => {
    const one = [simpleEvening('e1', day(1), ['A', 'B'], 'winner')];
    const players: StakesPlayer[] = ALL.map((p, i) => ({
      ...p,
      rsvp: i < 2 ? ('yes' as const) : null,
      // Противоречивый вход (болельщик и «иду» сразу) не раздувает фонд.
      spectator: i === 1,
    }));
    expect(eveningStakes(input(one), opts(players)).items.map((i) => i.kind)).not.toContain(
      'pool_record',
    );
  });
});

describe('расклад сезона', () => {
  // Очки: N − место + 0.5·KO + 1 за победу.
  const s = [
    simpleEvening('e1', day(1), ['A', 'B', 'C', 'D']),
    simpleEvening('e2', day(8), ['B', 'A', 'C', 'D']),
    simpleEvening('e3', day(15), ['A', 'C', 'B', 'D']),
  ];

  it('лидер, следующее место и отставание; таблица — до вечера', () => {
    const season = eveningStakes(input(s), opts()).season;
    expect(season?.seasonKey).toBe('2026-Q4');
    expect(season?.first).toBe(false);
    expect(season?.leaders).toEqual([{ playerId: 'A', total: 10 }]);
    expect(season?.chasers).toEqual([{ playerId: 'B', total: 7, gap: 3 }]);
    expect(season?.rows.map((r) => r.playerId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('вечер в новом сезоне — первый вечер сезона, таблицы ещё нет', () => {
    const season = eveningStakes(input(s), opts(ALL, '2027-01-08T12:00:00.000Z')).season;
    expect(season).toEqual({
      seasonKey: '2027-Q1',
      first: true,
      leaders: [],
      chasers: [],
      rows: [],
    });
  });

  it('делёж первого места — все лидеры', () => {
    const tie = s.slice(0, 2);
    const season = eveningStakes(input(tie), opts()).season;
    expect(season?.leaders.map((l) => l.playerId)).toEqual(['A', 'B']);
    expect(season?.chasers.map((c) => c.playerId)).toEqual(['C']);
  });
});

describe('порядок строк', () => {
  it('рекорд серии → «Хет-трик» → «Заклятый враг» → «Первая кровь» → фонд → «Оракул»', () => {
    const s = [
      simpleEvening('e1', day(1), ['A', 'B', 'C']),
      simpleEvening('e2', day(8), ['A', 'C', 'B']),
    ];
    const predictions: ScoredPrediction[] = [
      { eveningId: 'e1', playerId: 'B', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'e2', playerId: 'B', winner: 3, firstOut: 0, total: 3 },
    ];
    const players = ALL.map((p) => ({ ...p, rsvp: 'yes' as const }));
    expect(
      eveningStakes(input(s, { predictions }), opts(players)).items.map((i) => i.kind),
    ).toEqual(['win_step', 'first_blood', 'pool_record', 'oracle_step']);
  });
});
