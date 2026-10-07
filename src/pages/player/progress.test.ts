import type { AchievementProgress } from '@domain/progress.ts';
import { describe, expect, it } from 'vitest';
import { groupProgress, progressView } from './progress';

const NAMES: Record<string, string> = { L: 'Лёша', D: 'Дима', M: 'Миша' };
const me = { isMe: true, nameOf: (id: string) => NAMES[id] ?? '?' };
const other = { isMe: false, nameOf: me.nameOf };
/** Неразрывные пробелы подписей — обычными, чтобы ожидания читались. */
const sp = (text: string | undefined) => text?.replace(/ /g, ' ');

function p(
  over: Partial<AchievementProgress> & Pick<AchievementProgress, 'code'>,
): AchievementProgress {
  return {
    measure: 'count',
    current: 0,
    target: 3,
    hint: '',
    possible: true,
    obtained: 0,
    ...over,
  };
}

describe('строка прогресса', () => {
  it('«4 из 5» с полосой и подсказкой про соперника', () => {
    const enemy = p({ code: 'sworn_enemy', current: 4, target: 5, victimId: 'L' });
    const v = progressView(enemy, me);
    expect(v.bar).toEqual({ value: 4, max: 5, text: '4 из 5' });
    expect(v.title).toBe('Заклятый враг');
    expect(sp(v.hint)).toBe(
      'Больше всего нокаутов у тебя — против игрока Лёша: 4. До ачивки — 1 нокаут',
    );
    expect(sp(progressView(enemy, other).hint)).toBe(
      'Больше всего нокаутов — против игрока Лёша: 4',
    );
  });

  it('на чужой карточке без «ты» и без призыва', () => {
    const hunter = p({ code: 'hunter', current: 2 });
    expect(sp(progressView(hunter, other).hint)).toBe('Лучший вечер — 2 нокаута');
    expect(sp(progressView(hunter, me).hint)).toBe('Лучший вечер — 2 нокаута, нужно 3 за вечер');
  });

  it('условие без счётчика — без полосы', () => {
    const v = progressView(
      p({ code: 'star', measure: 'condition', current: null, target: null }),
      me,
    );
    expect(v.bar).toBeNull();
    expect(v.aside).toBeNull();
    expect(sp(v.hint)).toBe('Победи в номинации голосования после вечера');
  });

  it('чемпион — место справа и лидер сезона', () => {
    const champion = (over: Partial<AchievementProgress>) =>
      p({ code: 'champion', measure: 'place', target: 1, ...over });
    const v = progressView(champion({ current: 3, leaders: ['D'], leaderValue: 12.5 }), me);
    expect(v.bar).toBeNull();
    expect(v.aside).toBe('3-е место');
    expect(sp(v.hint)).toBe('Лидер сезона: Дима — 12,5 очка');
    const tie = progressView(champion({ current: 1, leaders: ['D', 'M'], leaderValue: 7 }), other);
    expect(sp(tie.hint)).toBe('Первое место делят: Дима и Миша — 7 очков');
    // На своей карточке — «ты» вместо своего имени.
    const mine = progressView(champion({ current: 1, leaders: ['D', 'M'], leaderValue: 7 }), {
      ...me,
      self: 'D',
    });
    expect(sp(mine.hint)).toBe('Первое место делят: ты и Миша — 7 очков');
    const none = progressView(champion({ current: null, leaders: [] }), me);
    expect(none.aside).toBeNull();
    expect(sp(none.hint)).toBe('Твоих вечеров в этом сезоне ещё нет');
  });

  it('железный стул с пропуском — без полосы, приглушён', () => {
    const v = progressView(p({ code: 'iron_chair', current: 2, target: 3, possible: false }), me);
    expect(v.bar).toBeNull();
    expect(v.aside).toBe('пропуск');
    expect(v.muted).toBe(true);
    const ok = progressView(p({ code: 'iron_chair', current: 3, target: 3 }), other);
    expect(sp(ok.bar?.text)).toBe('3 из 3');
    expect(sp(ok.hint)).toBe('Все вечера сезона без пропусков');
  });

  it('ребай-король: мои ребаи из ребаев лидера', () => {
    const v = progressView(
      p({ code: 'rebuy_king', current: 1, target: 4, leaders: ['L'], leaderValue: 4 }),
      me,
    );
    expect(sp(v.bar?.text)).toBe('1 из 4');
    expect(sp(v.hint)).toBe('Больше всех ребаев: Лёша — 4 ребая');
    const empty = progressView(
      p({ code: 'rebuy_king', current: 0, target: 0, leaders: [], leaderValue: 0 }),
      me,
    );
    expect(empty.bar).toBeNull();
    expect(sp(empty.hint)).toBe('В этом сезоне ребаев ещё не было');
  });

  it('первая кровь — без полосы «0 из 1»', () => {
    expect(progressView(p({ code: 'first_blood', current: 0, target: 1 }), me).bar).toBeNull();
  });
});

describe('раскладка прогресса', () => {
  it('сезонные отдельно, начатые — по близости, остальные — в порядке домена', () => {
    const views = [
      p({ code: 'hunter', current: 1, target: 3 }),
      p({ code: 'comeback', measure: 'condition', current: null, target: null }),
      p({ code: 'rebuy_king', current: 1, target: 2, leaders: ['L'], leaderValue: 2 }),
      p({ code: 'iron_chair', current: 2, target: 2 }),
      p({ code: 'hat_trick', current: 0, target: 3 }),
      p({ code: 'sworn_enemy', current: 4, target: 5, victimId: 'L' }),
      p({ code: 'champion', measure: 'place', current: 2, target: 1, leaders: ['D'] }),
    ].map((x) => progressView(x, me));
    const g = groupProgress(views);
    expect(g.season.map((v) => v.code)).toEqual(['rebuy_king', 'iron_chair', 'champion']);
    expect(g.close.map((v) => v.code)).toEqual(['sworn_enemy', 'hunter']);
    expect(g.rest.map((v) => v.code)).toEqual(['comeback', 'hat_trick']);
  });
});
