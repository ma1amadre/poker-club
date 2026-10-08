import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_LEVEL_RULE,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_META,
  achievementLevelText,
  achievementTitle,
  computeAchievements,
  diffAchievements,
  levelFor,
  playerLevel,
  starAchievements,
  starAwards,
  titles,
  type Achievement,
  type AchievementCode,
  type AchievementInput,
  type StarAward,
} from './achievements.ts';
import type { ScoredPrediction } from './predictions.ts';
import { seasonKey } from './season.ts';
import type { EveningSummary } from './summary.ts';
import { playEvening, simpleEvening, type Step } from './test-utils.ts';
import { voteResults, type Vote, type VoteCategory } from './votes.ts';

// Q3 2026 — завершённый сезон, Q4 — текущий.
const CURRENT = '2026-Q4';
const q3 = (n: number) => `2026-07-${String(n).padStart(2, '0')}T16:00:00.000Z`;
const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;

function run(summaries: EveningSummary[], extra: Partial<AchievementInput> = {}): Achievement[] {
  return computeAchievements({
    summaries,
    excluded: new Set(['G']),
    predictions: [],
    stars: [],
    bestN: 10,
    currentSeasonKey: CURRENT,
    ...extra,
  });
}
const only = (list: Achievement[], code: AchievementCode) =>
  list
    .filter((a) => a.code === code)
    .map((a) => [a.playerId, a.eveningId ?? a.seasonKey, a.count] as const);
/** [игрок, вечер, уровень, впервые на уровне] */
const levels = (list: Achievement[], code: AchievementCode) =>
  list
    .filter((a) => a.code === code)
    .map((a) => [a.playerId, a.eveningId ?? a.seasonKey, a.level, a.first] as const);
/**
 * Формы, которым нужен род: прошедшее время («выбил», «выбила»), «первым/первой», «сам/сама».
 * Границы слова — через \p{L}: \b в JS не считает кириллицу буквами и никогда не срабатывает.
 */
const GENDERED =
  /(?<!\p{L})(?:перв(?:ым|ой)|последн(?:им|ей)|сам[аи]?|готова?|должн[аы]?|должен|\p{L}+(?:ал|ял|ил|ыл|ел|ёл|ул)а?)(?!\p{L})/u;
const star = (eveningId: string, playerId: string, category: VoteCategory = 'hand'): StarAward => ({
  eveningId,
  category,
  playerId,
  votes: 2,
});

describe('ачивки', () => {
  it('у каждого кода есть русское название и описание без рода; порядок каталога', () => {
    expect(ACHIEVEMENT_CODES).toEqual([
      'first_blood',
      'hunter',
      'comeback',
      'phoenix',
      'clean_win',
      'rebuy_king',
      'iron_chair',
      'hat_trick',
      'sworn_enemy',
      'revenge',
      'king_hunt',
      'oracle',
      'star',
      'champion',
    ]);
    for (const m of Object.values(ACHIEVEMENT_META)) {
      expect(m.title).toMatch(/[А-Яа-яЁё]/);
      expect(m.description).toMatch(/[А-Яа-яЁё]/);
      expect(m.description).not.toMatch(GENDERED);
    }
    for (const rule of Object.values(ACHIEVEMENT_LEVEL_RULE)) expect(rule).not.toMatch(GENDERED);
  });

  it('проверка рода ловит родовые формы (у кириллицы \\b не работает — границы через \\p{L})', () => {
    expect('кто выбил игрока').toMatch(GENDERED);
    expect('вылети первым').toMatch(GENDERED);
    expect('первый вылет вечера — и всё равно победа').not.toMatch(GENDERED);
  });

  describe('уровни', () => {
    it('пороги решения клуба 08.10.2026', () => {
      expect(ACHIEVEMENT_LEVELS).toEqual({
        hunter: [3, 4, 5],
        comeback: [2, 3],
        sworn_enemy: [5, 10, 15],
        star: [1, 5, 10],
      });
      expect([2, 3, 4, 5, 9].map((n) => levelFor('hunter', n))).toEqual([0, 1, 2, 3, 3]);
      expect([1, 2, 3, 7].map((n) => levelFor('comeback', n))).toEqual([0, 1, 2, 2]);
      expect([4, 5, 9, 10, 15, 30].map((n) => levelFor('sworn_enemy', n))).toEqual([
        0, 1, 1, 2, 3, 3,
      ]);
      expect([0, 1, 4, 5, 10].map((n) => levelFor('star', n))).toEqual([0, 1, 1, 2, 3]);
    });

    it('названия с римскими цифрами и тексты уровней без рода', () => {
      // Уровень — через неразрывный пробел: не уезжает на новую строку.
      expect(achievementTitle('hunter', 2)).toBe('Охотник\u00A0II');
      expect(achievementTitle('comeback', 1)).toBe('Камбэк\u00A0I');
      expect(achievementTitle('star', 3)).toBe('Звезда вечера\u00A0III');
      expect(achievementTitle('hunter')).toBe('Охотник');
      // У ачивки без уровней уровень в названии не пишется.
      expect(achievementTitle('revenge', 1)).toBe('Месть');
      expect(achievementLevelText('hunter', 1)).toBe('3 нокаута за вечер');
      expect(achievementLevelText('hunter', 3)).toBe('5 и больше нокаутов за вечер');
      expect(achievementLevelText('comeback', 1)).toBe('победа после 2 ребаев');
      expect(achievementLevelText('comeback', 2)).toBe('победа после 3 и больше ребаев');
      expect(achievementLevelText('sworn_enemy', 2)).toBe('10 нокаутов одного и того же игрока');
      // «Звезда вечера» — порог как порог: строку дают за каждую звезду, 4 звезды — всё ещё I.
      expect(achievementLevelText('star', 1)).toBe('от 1 звезды вечера');
      expect(achievementLevelText('star', 2)).toBe('от 5 звёзд вечера');
      expect(achievementLevelText('star', 3)).toBe('от 10 звёзд вечера');
      for (const code of Object.keys(ACHIEVEMENT_LEVELS) as (keyof typeof ACHIEVEMENT_LEVELS)[])
        for (let l = 1; l <= ACHIEVEMENT_LEVELS[code].length; l++)
          expect(achievementLevelText(code, l)).not.toMatch(GENDERED);
      // Правило каталога — у каждой уровневой, без порогов.
      expect(Object.keys(ACHIEVEMENT_LEVEL_RULE).sort()).toEqual(
        Object.keys(ACHIEVEMENT_LEVELS).sort(),
      );
    });
  });

  describe('first_blood', () => {
    const noKo = simpleEvening('e1', q3(2), ['A', 'B', 'C'], 'none');
    const split = playEvening(
      'e2',
      q3(9),
      ['A', 'B', 'C'],
      [
        ['bust', 'C', ['A', 'B']],
        ['bust', 'B', ['A']],
      ],
    );

    it('первый нокаут клуба; при дележе — всем выбившим', () => {
      // Порядок массива не важен — хронология по дате.
      expect(only(run([split, noKo]), 'first_blood')).toEqual([
        ['A', 'e2', 1],
        ['B', 'e2', 1],
      ]);
    });
    it('последующие нокауты не дают ачивку', () => {
      const earlier = playEvening(
        'e0',
        q3(1),
        ['A', 'B', 'C'],
        [
          ['bust', 'A', ['C']],
          ['bust', 'B', []],
        ],
      );
      expect(only(run([split, noKo, earlier]), 'first_blood')).toEqual([['C', 'e0', 1]]);
    });
    it('без нокаутов — ни у кого; первый нокаут гостя — тоже ни у кого', () => {
      expect(only(run([noKo]), 'first_blood')).toEqual([]);
      const guest = playEvening(
        'g',
        q3(1),
        ['A', 'G', 'C'],
        [
          ['bust', 'A', ['G']],
          ['bust', 'C', []],
        ],
      );
      expect(only(run([guest, split]), 'first_blood')).toEqual([]);
    });
  });

  describe('hunter: 3 / 4 / 5 нокаутов за вечер', () => {
    it('уровень — по нокаутам вечера; «впервые» — только когда уровень выше прежних', () => {
      const list = [
        simpleEvening('h1', q4(1), ['A', 'B', 'C', 'D'], 'winner'), // 3 KO — I
        simpleEvening('h2', q4(2), ['A', 'B', 'C', 'D', 'E', 'F'], 'winner'), // 5 KO — III
        simpleEvening('h3', q4(3), ['A', 'B', 'C', 'D', 'E'], 'winner'), // 4 KO — II, но III уже есть
        simpleEvening('h4', q4(4), ['A', 'B', 'C', 'D'], 'winner'), // 3 KO — I ещё раз
      ];
      const res = run(list);
      expect(levels(res, 'hunter')).toEqual([
        ['A', 'h1', 1, true],
        ['A', 'h2', 3, true],
        ['A', 'h3', 2, false],
        ['A', 'h4', 1, false],
      ]);
      // Выданное не отнимается: уровень игрока — наибольший.
      expect(playerLevel(res, 'A', 'hunter')).toBe(3);
      expect(playerLevel(res, 'B', 'hunter')).toBe(0);
    });
    it('2 KO — мало; гостю не положено', () => {
      expect(only(run([simpleEvening('h', q4(1), ['A', 'B', 'C'], 'winner')]), 'hunter')).toEqual(
        [],
      );
      expect(
        only(run([simpleEvening('h', q4(1), ['G', 'B', 'C', 'D'], 'winner')]), 'hunter'),
      ).toEqual([]);
    });
  });

  describe('comeback: победа после 2 / 3 ребаев', () => {
    it('2 ребая — I, 3 и больше — II', () => {
      const res = run([
        simpleEvening('c1', q4(1), ['A', 'B', 'C'], 'none', { A: 2 }),
        simpleEvening('c2', q4(2), ['A', 'B', 'C'], 'none', { A: 4 }),
        simpleEvening('c3', q4(3), ['A', 'B', 'C'], 'none', { A: 3 }),
      ]);
      expect(levels(res, 'comeback')).toEqual([
        ['A', 'c1', 1, true],
        ['A', 'c2', 2, true],
        ['A', 'c3', 2, false],
      ]);
    });
    it('1 ребай — не камбэк; 2 ребая без победы — тоже', () => {
      expect(
        only(run([simpleEvening('c', q4(1), ['A', 'B', 'C'], 'none', { A: 1 })]), 'comeback'),
      ).toEqual([]);
      expect(
        only(run([simpleEvening('c', q4(1), ['B', 'A', 'C'], 'none', { A: 2 })]), 'comeback'),
      ).toEqual([]);
    });
  });

  describe('phoenix и clean_win', () => {
    it('«Феникс»: первый вылет вечера — и победа после ребая', () => {
      // simpleEvening ставит ребаи в начало: A вылетает первым, докупается и выигрывает.
      const back = simpleEvening('p1', q4(1), ['A', 'B', 'C'], 'none', { A: 1 });
      expect(only(run([back]), 'phoenix')).toEqual([['A', 'p1', 1]]);
      // Первым вылетел B (ребай), а выиграл A — не феникс; гостю — нет.
      const other = simpleEvening('p2', q4(2), ['A', 'B', 'C'], 'none', { B: 1 });
      expect(only(run([other]), 'phoenix')).toEqual([]);
      const guest = simpleEvening('p3', q4(3), ['G', 'B'], 'none', { G: 1 });
      expect(only(run([guest]), 'phoenix')).toEqual([]);
    });
    it('«Чистая победа»: победа без единого ребая; ребаи других не мешают', () => {
      const clean = simpleEvening('w1', q4(1), ['A', 'B', 'C'], 'none', { B: 2 });
      const dirty = simpleEvening('w2', q4(2), ['A', 'B', 'C'], 'none', { A: 1 });
      expect(only(run([clean, dirty]), 'clean_win')).toEqual([['A', 'w1', 1]]);
      expect(levels(run([clean, dirty]), 'clean_win')).toEqual([['A', 'w1', 1, true]]);
    });
  });

  describe('rebuy_king', () => {
    const r1 = simpleEvening('r1', q3(2), ['A', 'B', 'C'], 'none', { A: 2, B: 1 });
    const r2 = simpleEvening('r2', q3(9), ['B', 'A', 'G'], 'none', { A: 1, B: 1, G: 5 });
    it('больше всех ребаев за завершённый сезон; гость не отнимает титул', () => {
      expect(only(run([r1, r2]), 'rebuy_king')).toEqual([['A', '2026-Q3', 1]]);
    });
    it('текущий сезон не считается; без ребаев — никому; ничья — обоим', () => {
      const cur = simpleEvening('r3', q4(1), ['A', 'B'], 'none', { B: 10 });
      expect(only(run([cur]), 'rebuy_king')).toEqual([]);
      expect(only(run([simpleEvening('z', q3(2), ['A', 'B'])]), 'rebuy_king')).toEqual([]);
      const tie = simpleEvening('t', q3(2), ['A', 'B', 'C'], 'none', { A: 1, B: 1 });
      expect(only(run([tie]), 'rebuy_king')).toEqual([
        ['A', '2026-Q3', 1],
        ['B', '2026-Q3', 1],
      ]);
    });
  });

  describe('iron_chair', () => {
    const i1 = simpleEvening('i1', q3(2), ['A', 'B', 'C']);
    const i2 = simpleEvening('i2', q3(9), ['A', 'B']);
    const i3 = simpleEvening('i3', q3(16), ['C', 'A', 'G']);
    it('все вечера завершённого сезона', () => {
      expect(only(run([i1, i2, i3]), 'iron_chair')).toEqual([['A', '2026-Q3', 1]]);
    });
    it('пропустил хоть один — нет; текущий сезон — нет', () => {
      expect(only(run([i1, i2, i3]), 'iron_chair').some(([p]) => p === 'B' || p === 'C')).toBe(
        false,
      );
      expect(only(run([simpleEvening('x', q4(1), ['A', 'B'])]), 'iron_chair')).toEqual([]);
    });
  });

  describe('hat_trick', () => {
    it('3 победы подряд в вечерах, где играл (пропуск вечера серию не рвёт)', () => {
      const list = [
        simpleEvening('h1', q4(1), ['A', 'B']),
        simpleEvening('h2', q4(2), ['A', 'B']),
        simpleEvening('h3', q4(3), ['B', 'C']), // A не играл
        simpleEvening('h4', q4(4), ['A', 'B']),
      ];
      expect(only(run(list), 'hat_trick')).toEqual([['A', 'h4', 1]]);
    });
    it('проигрыш рвёт серию; 6 побед подряд — два хет-трика', () => {
      const broken = [
        simpleEvening('k1', q4(1), ['A', 'B']),
        simpleEvening('k2', q4(2), ['A', 'B']),
        simpleEvening('k3', q4(3), ['B', 'A']),
        simpleEvening('k4', q4(4), ['A', 'B']),
      ];
      expect(only(run(broken), 'hat_trick')).toEqual([]);
      const six = [1, 2, 3, 4, 5, 6].map((n) => simpleEvening(`s${n}`, q4(n), ['A', 'B']));
      expect(levels(run(six), 'hat_trick')).toEqual([
        ['A', 's3', 1, true],
        ['A', 's6', 1, false],
      ]);
    });
  });

  describe('sworn_enemy: 5 / 10 / 15 нокаутов одного игрока', () => {
    const steps: Step[] = [
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A', 'C']],
      ['rebuy', 'B'], // сплит считается обоим
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A']], // 4-й нокаут A по B
      ['bust', 'C', ['A']],
    ];
    const s1 = playEvening('s1', q4(1), ['A', 'B', 'C'], steps);
    it('уровень I — в вечере, где случился 5-й нокаут; соперник — в targetId', () => {
      const s2 = simpleEvening('s2', q4(8), ['A', 'B'], 'winner');
      const res = run([s1, s2]);
      expect(only(res, 'sworn_enemy')).toEqual([['A', 's2', 1]]);
      expect(res.find((a) => a.code === 'sworn_enemy')).toMatchObject({
        targetId: 'B',
        level: 1,
        first: true,
      });
      // Шестой нокаут ачивку не повторяет.
      const s3 = simpleEvening('s3', q4(15), ['A', 'B'], 'winner');
      expect(only(run([s1, s2, s3]), 'sworn_enemy')).toEqual([['A', 's2', 1]]);
    });
    it('4 нокаута — ещё нет', () => {
      expect(only(run([s1]), 'sworn_enemy')).toEqual([]);
    });
    it('10-й нокаут — уровень II, 15-й — III; два соперника — две строки', () => {
      // Каждый вечер A выбивает B пять раз (B четырежды докупается) и C один раз.
      const five = (id: string, n: number) =>
        playEvening(
          id,
          q4(n),
          ['A', 'B', 'C'],
          [
            ...[1, 2, 3, 4].flatMap((): Step[] => [
              ['bust', 'B', ['A']],
              ['rebuy', 'B'],
            ]),
            ['bust', 'B', ['A']],
            ['bust', 'C', ['A']],
          ],
        );
      const res = run([five('f1', 1), five('f2', 2), five('f3', 3), five('f4', 4), five('f5', 5)]);
      expect(
        res
          .filter((a) => a.code === 'sworn_enemy')
          .map((a) => [a.eveningId, a.targetId, a.level, a.first]),
      ).toEqual([
        ['f1', 'B', 1, true],
        ['f2', 'B', 2, true],
        ['f3', 'B', 3, true],
        ['f5', 'C', 1, false],
      ]);
      expect(playerLevel(res, 'A', 'sworn_enemy')).toBe(3);
    });
    it('порог взят дважды за вечер — одна строка со старшим уровнем', () => {
      const ten = playEvening(
        't',
        q4(1),
        ['A', 'B'],
        [
          ...Array.from({ length: 9 }, (): Step[] => [
            ['bust', 'B', ['A']],
            ['rebuy', 'B'],
          ]).flat(),
          ['bust', 'B', ['A']],
        ],
      );
      expect(levels(run([ten]), 'sworn_enemy')).toEqual([['A', 't', 2, true]]);
    });
  });

  describe('revenge: нокаут своей Немезиды', () => {
    // n1: B дважды выбивает A — B становится Немезидой A. n2: A выбивает B — «Месть».
    const n1 = playEvening(
      'n1',
      q4(1),
      ['A', 'B', 'C'],
      [
        ['bust', 'A', ['B']],
        ['rebuy', 'A'],
        ['bust', 'A', ['B']],
        ['bust', 'C', ['B']],
      ],
    );
    const n2 = playEvening(
      'n2',
      q4(2),
      ['A', 'B', 'C'],
      [
        ['bust', 'B', ['A', 'C']],
        ['rebuy', 'B'],
        ['bust', 'B', ['A']],
        ['bust', 'C', ['A']],
      ],
    );
    it('Немезида — по вечерам ДО этого; пара — один раз за вечер; Немезида — в targetId', () => {
      const res = run([n1, n2]);
      expect(
        res.filter((a) => a.code === 'revenge').map((a) => [a.playerId, a.eveningId, a.targetId]),
      ).toEqual([['A', 'n2', 'B']]);
      // В самом n1 Немезиды ещё не было — мести нет.
      expect(only(run([n1]), 'revenge')).toEqual([]);
    });
    it('Немезида появилась в этом же вечере — месть со следующего', () => {
      const same = playEvening(
        'x',
        q4(1),
        ['A', 'B', 'C'],
        [
          ['bust', 'A', ['B']],
          ['rebuy', 'A'],
          ['bust', 'A', ['B']],
          ['rebuy', 'A'],
          ['bust', 'B', ['A']],
          ['bust', 'C', ['A']],
        ],
      );
      expect(only(run([same]), 'revenge')).toEqual([]);
    });
    it('гость не Немезида и не мститель', () => {
      const g1 = playEvening(
        'g1',
        q4(1),
        ['A', 'G', 'C'],
        [
          ['bust', 'A', ['G']],
          ['rebuy', 'A'],
          ['bust', 'A', ['G']],
          ['bust', 'C', ['G']],
        ],
      );
      const g2 = playEvening(
        'g2',
        q4(2),
        ['A', 'G', 'C'],
        [
          ['bust', 'G', ['A']],
          ['bust', 'C', ['A']],
        ],
      );
      expect(only(run([g1, g2]), 'revenge')).toEqual([]);
    });
  });

  describe('king_hunt: нокаут действующего чемпиона', () => {
    // Q3: чемпион — A (две победы). Q4: B выбивает A.
    const c1 = simpleEvening('c1', q3(2), ['A', 'B', 'C'], 'winner');
    const c2 = simpleEvening('c2', q3(9), ['A', 'C', 'B'], 'winner');
    const hunt = playEvening(
      'k1',
      q4(1),
      ['A', 'B', 'C'],
      [
        ['bust', 'A', ['B', 'C']],
        ['bust', 'C', ['B']],
      ],
    );
    it('чемпион прошлого сезона; при дележе — каждому; чемпион — в targetId', () => {
      const res = run([c1, c2, hunt]);
      expect(
        res.filter((a) => a.code === 'king_hunt').map((a) => [a.playerId, a.eveningId, a.targetId]),
      ).toEqual([
        ['B', 'k1', 'A'],
        ['C', 'k1', 'A'],
      ]);
    });
    it('в сезоне чемпиона охоты нет; в позапрошлом сезоне он уже не действующий', () => {
      // Нокаут A внутри Q3 — чемпион Q3 ещё не определён (и чемпиона Q2 нет).
      const inQ3 = playEvening('k0', q3(16), ['A', 'B'], [['bust', 'A', ['B']]]);
      expect(only(run([c1, c2, inQ3]), 'king_hunt')).toEqual([]);
      // 2027-Q1: действующий — чемпион 2026-Q4 (его нет), не A.
      const later = playEvening(
        'k2',
        '2027-01-15T16:00:00.000Z',
        ['A', 'B'],
        [['bust', 'A', ['B']]],
      );
      expect(only(run([c1, c2, later], { currentSeasonKey: '2027-Q1' }), 'king_hunt')).toEqual([]);
    });
    it('нокаут без выбившего — никому; гостю — нет', () => {
      const none = playEvening(
        'k3',
        q4(1),
        ['A', 'G', 'C'],
        [
          ['bust', 'A', ['G']],
          ['bust', 'C', []],
        ],
      );
      expect(only(run([c1, c2, none]), 'king_hunt')).toEqual([]);
    });
  });

  describe('oracle', () => {
    const ev = [
      simpleEvening('o1', q4(1), ['A', 'B']),
      simpleEvening('o2', q4(2), ['B', 'A']),
      simpleEvening('o3', q4(3), ['A', 'B']),
      simpleEvening('o4', q4(4), ['A', 'B']),
    ];
    const p = (playerId: string, eveningId: string, hit: boolean): ScoredPrediction => ({
      playerId,
      eveningId,
      winner: hit ? 3 : 0,
      firstOut: 0,
      total: hit ? 3 : 0,
    });
    it('3 угаданных победителя подряд в вечерах, где делал прогноз', () => {
      // X не прогнозировал o3 — серия o1, o2, o4 не прерывается.
      const preds = [p('X', 'o4', true), p('X', 'o1', true), p('X', 'o2', true)];
      expect(only(run(ev, { predictions: preds }), 'oracle')).toEqual([['X', 'o4', 1]]);
    });
    it('промах рвёт серию; прогноз на незавершённый вечер не считается; гостю не положено', () => {
      const preds = [
        p('Y', 'o1', true),
        p('Y', 'o2', false),
        p('Y', 'o3', true),
        p('Y', 'o4', true),
        p('Z', 'o1', true),
        p('Z', 'o2', true),
        p('Z', 'o5', true),
        p('G', 'o1', true),
        p('G', 'o2', true),
        p('G', 'o3', true),
      ];
      expect(only(run(ev, { predictions: preds }), 'oracle')).toEqual([]);
    });
  });

  describe('star: «Звезда вечера»', () => {
    const vote = (voterId: string, category: VoteCategory, nomineeId: string): Vote => ({
      voterId,
      category,
      nomineeId,
    });

    it('единственный лидер номинации с 2 голосами и больше; ничья и 1 голос — никому', () => {
      const results = voteResults([
        vote('B', 'hand', 'A'),
        vote('C', 'hand', 'A'),
        vote('D', 'hand', 'B'),
        // Блеф — ничья 2:2.
        vote('A', 'bluff', 'B'),
        vote('C', 'bluff', 'B'),
        vote('B', 'bluff', 'C'),
        vote('D', 'bluff', 'C'),
        // Бэд-бит — один голос.
        vote('A', 'badbeat', 'D'),
      ]);
      expect(starAwards('e1', results)).toEqual([
        { eveningId: 'e1', category: 'hand', playerId: 'A', votes: 2 },
      ]);
      expect(starAwards('e1', voteResults([]))).toEqual([]);
    });

    it('две номинации — count 2; гость-лидер звезду не получает, второму она не переходит', () => {
      const stars = [star('e1', 'A', 'hand'), star('e1', 'A', 'bluff'), star('e1', 'G', 'badbeat')];
      expect(only(run([], { stars }), 'star')).toEqual([['A', 'e1', 2]]);
    });

    it('уровни по звёздам за всё время: 1 — I, 5 — II, 10 — III', () => {
      const ev = [1, 2, 3, 4, 5, 6].map((n) => simpleEvening(`v${n}`, q4(n), ['A', 'B']));
      // v1: 1, v2: 2 (две номинации), v3: 1 → 4; v4: 1 → 5 (II); v5: 3 → 8; v6: 2 → 10 (III).
      const stars = [
        star('v1', 'A'),
        star('v2', 'A', 'hand'),
        star('v2', 'A', 'bluff'),
        star('v3', 'A'),
        star('v4', 'A'),
        star('v5', 'A', 'hand'),
        star('v5', 'A', 'bluff'),
        star('v5', 'A', 'badbeat'),
        star('v6', 'A', 'hand'),
        star('v6', 'A', 'bluff'),
      ];
      // Порядок звёзд в списке не важен — хронология по датам вечеров.
      const res = run(ev, { stars: [...stars].reverse() });
      expect(
        res.filter((a) => a.code === 'star').map((a) => [a.eveningId, a.count, a.level, a.first]),
      ).toEqual([
        ['v1', 1, 1, true],
        ['v2', 2, 1, false],
        ['v3', 1, 1, false],
        ['v4', 1, 2, true],
        ['v5', 3, 2, false],
        ['v6', 2, 3, true],
      ]);
      // Лента моментов считает те же строки.
      expect(starAchievements({ summaries: ev, excluded: new Set(['G']), stars })).toEqual(
        res.filter((a) => a.code === 'star'),
      );
    });

    it('без звёзд — никому', () => {
      expect(only(run([], { stars: [] }), 'star')).toEqual([]);
    });
  });

  describe('champion', () => {
    it('1-е место завершённого сезона, гость пропускается', () => {
      const list = [
        simpleEvening('c1', q3(2), ['G', 'A', 'B'], 'winner'),
        simpleEvening('c2', q3(9), ['A', 'B', 'G']),
        simpleEvening('c3', q4(1), ['B', 'A'], 'winner'),
        simpleEvening('c4', q4(2), ['B', 'A'], 'winner'),
      ];
      expect(only(run(list), 'champion')).toEqual([['A', '2026-Q3', 1]]);
    });
    it('текущий сезон чемпиона не даёт', () => {
      expect(only(run([simpleEvening('c', q4(1), ['A', 'B'])]), 'champion')).toEqual([]);
    });
    it('по «лучшим N» сезона: смена best_n после конца сезона чемпиона не меняет', () => {
      // 2026-Q3: A 4 очка за один вечер, B — 1 + 3 + 3. При N = 10 чемпион B (7), при N = 1 — A (4 > 3).
      const list = [
        simpleEvening('c1', q3(2), ['A', 'B', 'C'], 'winner'),
        simpleEvening('c2', q3(9), ['B', 'C', 'A']),
        simpleEvening('c3', q3(16), ['B', 'C', 'A']),
      ];
      expect(only(run(list), 'champion')).toEqual([['B', '2026-Q3', 1]]);
      // Сейчас настройка — 1, но 2026-Q3 заморожен значением 10.
      expect(only(run(list, { bestN: 1, bestNBySeason: { '2026-Q3': 10 } }), 'champion')).toEqual([
        ['B', '2026-Q3', 1],
      ]);
      // Без заморозки (как до миграции 013) чемпион сменился бы.
      expect(only(run(list, { bestN: 1 }), 'champion')).toEqual([['A', '2026-Q3', 1]]);
    });
  });

  it('гости не получают ничего', () => {
    const list = [
      simpleEvening('a', q3(2), ['G', 'A', 'B', 'C'], 'winner', { G: 2 }),
      simpleEvening('b', q3(9), ['G', 'A'], 'winner'),
      simpleEvening('c', q3(16), ['G', 'A'], 'winner'),
    ];
    const stars = [star('a', 'G')];
    const res = run(list, { stars });
    expect(res.filter((a) => a.playerId === 'G')).toEqual([]);
    // Без исключения тот же гость собрал бы почти всё.
    const raw = computeAchievements({
      summaries: list,
      excluded: new Set(),
      predictions: [],
      bestN: 10,
      currentSeasonKey: CURRENT,
      stars,
    });
    expect(new Set(raw.filter((a) => a.playerId === 'G').map((a) => a.code))).toEqual(
      new Set([
        'first_blood',
        'hunter',
        'comeback',
        'phoenix',
        'clean_win',
        'rebuy_king',
        'iron_chair',
        'hat_trick',
        'star',
        'champion',
      ]),
    );
  });
});

/** Ручной итог — только для званий: нужны участники, очки и пары нокаутов. */
function manual(
  id: string,
  date: string,
  points: Record<string, number>,
  koPairs: [string, string][] = [],
): EveningSummary {
  return {
    eveningId: id,
    date,
    seasonKey: seasonKey(date),
    entrants: Object.keys(points),
    places: [],
    points,
    netRub: {},
    kos: {},
    koPairs,
    rebuys: {},
    bustLevel: {},
    firstBustPlayerId: null,
    busts: [],
  };
}

describe('звания', () => {
  it('немезида: кто чаще всех выбивал, минимум 2 раза; при равенстве — догнавший последним', () => {
    const steps: Step[] = [
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['C']],
      ['rebuy', 'B'],
      ['bust', 'C', ['A']],
      ['rebuy', 'C'],
      ['bust', 'D', ['A']],
      ['rebuy', 'D'],
      ['bust', 'D', ['A']],
      ['rebuy', 'D'],
      ['bust', 'D', ['E']],
      ['rebuy', 'D'],
      ['bust', 'D', ['E']],
      ['rebuy', 'D'],
      // гость выбивает E трижды — немезидой стать не может
      ['bust', 'E', ['G']],
      ['rebuy', 'E'],
      ['bust', 'E', ['G']],
      ['rebuy', 'E'],
      ['bust', 'E', ['G']],
      ['rebuy', 'E'],
      ['bust', 'G', []],
      ['bust', 'E', []],
      ['bust', 'D', []],
      ['bust', 'C', []],
      ['bust', 'B', []],
    ];
    const ev = playEvening('n1', q4(1), ['A', 'B', 'C', 'D', 'E', 'G'], steps);
    const t = titles({ summaries: [ev], excluded: new Set(['G']) });
    expect(t.nemesis).toEqual({ A: null, B: 'A', C: null, D: 'E', E: null });
  });

  it('немезида переходит: догнавший по ходу истории забирает звание', () => {
    const list = [
      manual('m1', q4(1), { A: 1, B: 0, C: 0 }, [
        ['A', 'B'],
        ['A', 'B'],
      ]),
      manual('m2', q4(2), { A: 1, B: 0, C: 0 }, [
        ['C', 'B'],
        ['C', 'B'],
      ]),
    ];
    expect(titles({ summaries: list, excluded: new Set() }).nemesis.B).toBe('C');
    // Порядок массива не важен: по датам m2 позже.
    expect(titles({ summaries: [...list].reverse(), excluded: new Set() }).nemesis.B).toBe('C');
  });

  it('форма: лучшая сумма за последние 5 вечеров клуба', () => {
    const list = [
      simpleEvening('f1', q4(1), ['A', 'X1', 'X2', 'X3', 'X4', 'X5'], 'winner'), // A 8.5 — за окном
      simpleEvening('f2', q4(2), ['B', 'A', 'C']),
      simpleEvening('f3', q4(3), ['C', 'B', 'A']),
      simpleEvening('f4', q4(4), ['B', 'C', 'A']),
      simpleEvening('f5', q4(5), ['C', 'A', 'B']),
      simpleEvening('f6', q4(6), ['A', 'B', 'C']),
    ];
    // В окне f2–f6: B 3+1+3+0+1 = 8, C 7, A 5. С f1 у A было бы 13.5.
    expect(titles({ summaries: list, excluded: new Set() }).form).toBe('B');
    expect(titles({ summaries: list.slice(0, 5), excluded: new Set() }).form).toBe('A');
  });

  it('форма: при равной сумме решает последний вечер; полная ничья или нули — никому; гость не берёт', () => {
    const tie = [
      simpleEvening('g1', q4(1), ['A', 'B', 'C']),
      simpleEvening('g2', q4(2), ['B', 'A', 'C']),
    ];
    expect(titles({ summaries: tie, excluded: new Set() }).form).toBe('B');
    expect(
      titles({ summaries: [manual('x', q4(1), { A: 2, B: 2 })], excluded: new Set() }).form,
    ).toBeNull();
    expect(
      titles({ summaries: [manual('x', q4(1), { A: 0, B: 0 })], excluded: new Set() }).form,
    ).toBeNull();
    expect(
      titles({ summaries: [manual('x', q4(1), { G: 5, A: 2 })], excluded: new Set(['G']) }).form,
    ).toBe('A');
    expect(titles({ summaries: [], excluded: new Set() })).toEqual({ nemesis: {}, form: null });
  });
});

describe('diffAchievements', () => {
  it('новые строки и прирост count — для поста бота; уровень и «впервые» — как после', () => {
    const e1 = simpleEvening('d1', q4(1), ['A', 'B', 'C', 'D'], 'winner');
    const e2 = simpleEvening('d2', q4(2), ['B', 'A', 'C', 'D', 'E'], 'winner');
    const stars1 = [star('d2', 'C', 'hand')];
    const stars2 = [...stars1, star('d2', 'C', 'bluff')];
    const before = run([e1], { stars: stars1 });
    const after = run([e1, e2], { stars: stars2 });
    expect(diffAchievements(before, after)).toEqual([
      {
        playerId: 'B',
        code: 'clean_win',
        eveningId: 'd2',
        seasonKey: null,
        targetId: null,
        count: 1,
        level: 1,
        first: true,
      },
      {
        playerId: 'B',
        code: 'hunter',
        eveningId: 'd2',
        seasonKey: null,
        targetId: null,
        count: 1,
        level: 2,
        first: true,
      },
      {
        playerId: 'C',
        code: 'star',
        eveningId: 'd2',
        seasonKey: null,
        targetId: null,
        count: 1,
        level: 1,
        first: true,
      },
    ]);
    expect(diffAchievements(after, after)).toEqual([]);
    expect(diffAchievements([], before)).toEqual(before);
  });
});
