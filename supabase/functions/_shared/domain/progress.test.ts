import { describe, expect, it } from 'vitest';
import type { AchievementInput } from './achievements.ts';
import { achievementProgress, type AchievementProgress } from './progress.ts';
import { simpleEvening } from './test-utils.ts';

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
    stars: [{ eveningId: 'c3', category: 'hand', winners: ['B'] }],
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

  it('порядок кодов фиксирован; у каждого есть подпись', () => {
    expect([...a.keys()]).toEqual([
      'hunter',
      'comeback',
      'rebuy_king',
      'iron_chair',
      'hat_trick',
      'sworn_enemy',
      'oracle',
      'star',
      'champion',
    ]);
    for (const p of a.values()) expect(p.hint).toMatch(/[а-яё]/);
  });

  it('first_blood — только пока в клубе не было нокаута', () => {
    expect(a.has('first_blood')).toBe(false);
    const quiet = byCode(
      achievementProgress(input({ summaries: [p1], predictions: [], stars: [] }), 'A'),
    );
    expect(quiet.get('first_blood')).toMatchObject({ measure: 'count', current: 0, target: 1 });
  });

  it('hunter: лучший вечер по нокаутам из 3', () => {
    expect(a.get('hunter')).toMatchObject({ measure: 'count', current: 2, target: 3 });
    expect(c.get('hunter')).toMatchObject({ current: 0, target: 3 });
  });

  it('hunter пропадает, когда получен', () => {
    const big = simpleEvening('c4', q4(22), ['A', 'B', 'C', 'D'], 'winner');
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, big] }), 'A');
    expect(list.some((p) => p.code === 'hunter')).toBe(false);
  });

  it('sworn_enemy: больше всего нокаутов одного соперника, при равенстве — последний', () => {
    // A выбил C и B по 2 раза; последним в c2 был B.
    expect(a.get('sworn_enemy')).toEqual(
      expect.objectContaining({ current: 2, target: 5, victimId: 'B' }),
    );
    expect(c.get('sworn_enemy')?.current).toBe(0);
    expect(c.get('sworn_enemy')?.victimId).toBeUndefined();
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

  it('comeback и star — без счётчика, только условие', () => {
    expect(a.get('comeback')).toMatchObject({ measure: 'condition', current: null, target: null });
    expect(a.get('comeback')?.hint).toMatch(/2 и больше ребаев/);
    expect(a.get('star')).toMatchObject({ measure: 'condition', current: null, target: null });
    // У B есть «Звезда» — её в списке нет.
    expect(b.has('star')).toBe(false);
  });

  it('comeback пропадает, когда получен', () => {
    const back = simpleEvening('c4', q4(22), ['A', 'B'], 'none', { A: 2 });
    const list = achievementProgress(input({ summaries: [p1, c1, c2, c3, back] }), 'A');
    expect(list.some((p) => p.code === 'comeback')).toBe(false);
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
