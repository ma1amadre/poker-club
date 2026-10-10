import { describe, expect, it } from 'vitest';
import type { AchievementInput } from './achievements.ts';
import { achievementProgress, type AchievementProgress } from './progress.ts';
import { playEvening, simpleEvening, type Step } from './test-utils.ts';

const q3 = (n: number) => `2026-07-${String(n).padStart(2, '0')}T16:00:00.000Z`;
const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;

// Q3 (завершён): B выигрывает без нокаутов → B чемпион Q3; A, B, C — «Железный стул» Q3.
const p1 = simpleEvening('p1', q3(1), ['B', 'A', 'C']);
// Q4 (текущий): A выигрывает два вечера подряд, выбивая всех (C, потом B); в c3 A нет,
// C дважды делает ребай, побеждает B.
const c1 = simpleEvening('c1', q4(1), ['A', 'B', 'C'], 'winner');
const c2 = simpleEvening('c2', q4(8), ['A', 'B', 'C'], 'winner');
const c3 = simpleEvening('c3', q4(15), ['B', 'C'], 'none', { C: 2 });

function input(extra: Partial<AchievementInput> = {}): AchievementInput {
  return {
    summaries: [c3, p1, c1, c2],
    excluded: new Set(['G']),
    predictions: [
      { eveningId: 'c1', playerId: 'A', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'c2', playerId: 'A', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'c2', playerId: 'B', winner: 0, firstOut: 2, total: 2 },
    ],
    stars: [{ eveningId: 'c3', category: 'hand', playerId: 'B', votes: 2 }],
    bestN: 10,
    currentSeasonKey: '2026-Q4',
    ...extra,
  };
}

const byCode = (list: AchievementProgress[]) => new Map(list.map((p) => [p.code, p]));

describe('прогресс до ачивок', () => {
  const a = byCode(achievementProgress(input(), 'A'));
  const b = byCode(achievementProgress(input(), 'B'));
  const c = byCode(achievementProgress(input(), 'C'));

  it('порядок кодов фиксирован (как в каталоге); у каждого есть подпись', () => {
    // У A получены «Чистая победа» (c1, c2) и «Охота на короля» (в c1 выбит B, чемпион Q3) — их нет.
    expect([...a.keys()]).toEqual([
      'hunter',
      'comeback',
      'phoenix',
      'rebuy_king',
      'iron_chair',
      'hat_trick',
      'sworn_enemy',
      'revenge',
      'oracle',
      'star',
      'champion',
    ]);
    for (const p of a.values()) expect(p.hint).toMatch(/[а-яё]/);
    // У новичка без вечеров — весь каталог, кроме полученной кем-то «Первой крови».
    expect([...byCode(achievementProgress(input(), 'N')).keys()]).toEqual([
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
  });

  it('first_blood — только пока в клубе не было нокаута', () => {
    expect(a.has('first_blood')).toBe(false);
    const quiet = byCode(
      achievementProgress(input({ summaries: [p1], predictions: [], stars: [] }), 'A'),
    );
    expect(quiet.get('first_blood')).toMatchObject({ measure: 'count', current: 0, target: 1 });
  });

  it('hunter: лучший вечер по нокаутам из 3 — к уровню I', () => {
    expect(a.get('hunter')).toMatchObject({
      measure: 'count',
      current: 2,
      target: 3,
      level: 0,
      nextLevel: 1,
    });
    expect(c.get('hunter')).toMatchObject({ current: 0, target: 3 });
  });

  it('hunter: после уровня — счётчик до следующего; после III — пропадает', () => {
    const three = simpleEvening('c4', q4(22), ['A', 'B', 'C', 'D'], 'winner');
    const four = byCode(achievementProgress(input({ summaries: [p1, c1, c2, c3, three] }), 'A'));
    expect(four.get('hunter')).toMatchObject({
      current: 3,
      target: 4,
      level: 1,
      nextLevel: 2,
      obtained: 1,
    });
    const five = simpleEvening('c5', q4(29), ['A', 'B', 'C', 'D', 'E', 'F'], 'winner');
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, three, five] }), 'A');
    expect(list.some((p) => p.code === 'hunter')).toBe(false);
  });

  it('sworn_enemy: больше всего нокаутов одного соперника, при равенстве — последний', () => {
    // A выбил C и B по 2 раза; последним в c2 был B.
    expect(a.get('sworn_enemy')).toEqual(
      expect.objectContaining({ current: 2, target: 5, victimId: 'B', level: 0, nextLevel: 1 }),
    );
    expect(c.get('sworn_enemy')?.current).toBe(0);
    expect(c.get('sworn_enemy')?.victimId).toBeUndefined();
  });

  it('sworn_enemy: после уровня I — те же нокауты до 10 (уровень II)', () => {
    const six = [1, 2, 3].map((n) => simpleEvening(`s${n}`, q4(n), ['A', 'B'], 'winner'));
    const more = [4, 5, 6].map((n) => simpleEvening(`s${n}`, q4(n), ['A', 'B'], 'winner'));
    const list = byCode(achievementProgress(input({ summaries: [...six, ...more] }), 'A'));
    expect(list.get('sworn_enemy')).toMatchObject({
      current: 6,
      target: 10,
      victimId: 'B',
      level: 1,
      nextLevel: 2,
    });
  });

  it('hat_trick: текущая серия побед в вечерах, где играл', () => {
    // c1, c2 — победы; в c3 A не играл — серия не рвётся.
    expect(a.get('hat_trick')).toMatchObject({ current: 2, target: 3 });
    // B: p1 победа, c1 и c2 поражения, c3 победа → 1.
    expect(b.get('hat_trick')).toMatchObject({ current: 1, target: 3 });
  });

  it('hat_trick пропадает после третьей победы подряд', () => {
    const third = simpleEvening('c4', q4(22), ['A', 'B']);
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, third] }), 'A');
    expect(list.some((p) => p.code === 'hat_trick')).toBe(false);
  });

  it('oracle: серия угаданных победителей по вечерам, где был прогноз', () => {
    expect(a.get('oracle')).toMatchObject({ current: 2, target: 3 });
    expect(b.get('oracle')).toMatchObject({ current: 0, target: 3 });
  });

  it('comeback и первая звезда — без счётчика, только условие', () => {
    expect(a.get('comeback')).toMatchObject({
      measure: 'condition',
      current: null,
      target: null,
      nextLevel: 1,
    });
    expect(a.get('comeback')?.hint).toMatch(/2 и больше ребаев/);
    expect(a.get('star')).toMatchObject({ measure: 'condition', current: null, target: null });
    expect(a.get('star')?.hint).toMatch(/от 2 голосов/);
  });

  it('star: со звездой — звёзды за всё время до следующего уровня', () => {
    // У B одна звезда — до «Звезды вечера II» нужно 5.
    expect(b.get('star')).toMatchObject({
      measure: 'count',
      current: 1,
      target: 5,
      level: 1,
      nextLevel: 2,
      obtained: 1,
    });
  });

  it('comeback: после уровня I — условие уровня II (3 ребая); после II — пропадает', () => {
    const back = simpleEvening('c4', q4(22), ['A', 'B'], 'none', { A: 2 });
    const one = byCode(achievementProgress(input({ summaries: [p1, c1, c2, c3, back] }), 'A'));
    expect(one.get('comeback')).toMatchObject({ level: 1, nextLevel: 2 });
    expect(one.get('comeback')?.hint).toMatch(/3 и больше ребаев/);
    const big = simpleEvening('c5', q4(29), ['A', 'B'], 'none', { A: 3 });
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, back, big] }), 'A');
    expect(list.some((p) => p.code === 'comeback')).toBe(false);
  });

  it('phoenix и clean_win — условие, пропадают, когда получены', () => {
    expect(a.get('phoenix')).toMatchObject({ measure: 'condition', nextLevel: null });
    // A выиграл c1 и c2 без ребаев — «Чистая победа» уже есть.
    expect(a.has('clean_win')).toBe(false);
    expect(c.get('clean_win')).toMatchObject({ measure: 'condition', obtained: 0 });
    // C вылетает первым в c3 (ребаи — в начале) и проигрывает — не феникс; у B в c3 — тоже нет.
    const back = simpleEvening('c4', q4(22), ['C', 'A'], 'none', { C: 1 });
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, back] }), 'C');
    expect(list.some((p) => p.code === 'phoenix')).toBe(false);
  });

  it('revenge: своя Немезида сейчас; нет Немезиды — подпись об этом', () => {
    // B выбит A дважды (c1, c2) — Немезида B — A.
    expect(b.get('revenge')).toMatchObject({ measure: 'condition', victimId: 'A' });
    expect(a.get('revenge')?.victimId).toBeUndefined();
    expect(a.get('revenge')?.hint).toMatch(/нет Немезиды/);
    // B отомстил: выбил A — ачивка получена, строки нет.
    const revenge = playEvening('c4', q4(22), ['A', 'B'], [['bust', 'A', ['B']]] as Step[]);
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, revenge] }), 'B');
    expect(list.some((p) => p.code === 'revenge')).toBe(false);
  });

  it('king_hunt: действующий чемпион — чемпион прошлого сезона', () => {
    // Чемпион Q3 — B: охотиться на него может C (A уже выбил B в c1 — ачивка есть), сам B — нет
    // (строка приглушена).
    expect(a.has('king_hunt')).toBe(false);
    expect(c.get('king_hunt')).toMatchObject({ leaders: ['B'], possible: true });
    expect(b.get('king_hunt')).toMatchObject({ leaders: ['B'], possible: false });
    expect(b.get('king_hunt')?.hint).toMatch(/охотятся на тебя/);
    // Без прошлого сезона — чемпиона нет.
    const none = byCode(
      achievementProgress(input({ summaries: [c1, c2, c3], stars: [] }), 'A'),
    ).get('king_hunt');
    expect(none).toMatchObject({ leaders: [], possible: false });
  });

  it('iron_chair: вечера текущего сезона; пропуск делает недостижимой', () => {
    expect(a.get('iron_chair')).toMatchObject({
      current: 2,
      target: 3,
      possible: false,
      seasonKey: '2026-Q4',
      obtained: 1, // за Q3
    });
    expect(b.get('iron_chair')).toMatchObject({ current: 3, target: 3, possible: true });
  });

  it('iron_chair по игровым дням: вторая игра того же дня не добавляет день', () => {
    // Игра 2 в день c3 (22:30 МСК), в ней только A: у A день c3 есть, пропуска больше нет.
    const c3b = simpleEvening('c3b', '2026-10-15T19:30:00.000Z', ['A', 'C']);
    const withSecond = input({ summaries: [c3, p1, c1, c2, c3b] });
    expect(byCode(achievementProgress(withSecond, 'A')).get('iron_chair')).toMatchObject({
      current: 3,
      target: 3,
      possible: true,
    });
    // B сел только за игру 1 — день засчитан, стул по-прежнему возможен.
    expect(byCode(achievementProgress(withSecond, 'B')).get('iron_chair')).toMatchObject({
      current: 3,
      target: 3,
      possible: true,
    });
  });

  it('rebuy_king: мои ребаи против лидера сезона', () => {
    expect(a.get('rebuy_king')).toMatchObject({
      current: 0,
      target: 2,
      leaders: ['C'],
      leaderValue: 2,
    });
    expect(c.get('rebuy_king')).toMatchObject({ current: 2, target: 2 });
    expect(c.get('rebuy_king')?.hint).toMatch(/у тебя/);
  });

  it('champion: место в текущем сезоне; сезонные видны и у прошлого чемпиона', () => {
    // Q4: A 4 + 4 = 8, B 1 + 1 + 2 = 4, C 0.
    expect(a.get('champion')).toMatchObject({
      measure: 'place',
      current: 1,
      target: 1,
      leaders: ['A'],
      leaderValue: 8,
    });
    expect(b.get('champion')).toMatchObject({ current: 2, obtained: 1 });
    expect(c.get('champion')?.current).toBe(3);
  });

  it('новый игрок без вечеров в сезоне', () => {
    const d = byCode(achievementProgress(input(), 'D'));
    expect(d.get('champion')).toMatchObject({ current: null, target: 1 });
    expect(d.get('iron_chair')).toMatchObject({ current: 0, target: 3, possible: false });
    expect(d.get('hunter')).toMatchObject({ current: 0 });
  });

  it('гость ачивок не получает — прогресса нет', () => {
    expect(achievementProgress(input(), 'G')).toEqual([]);
  });
});
