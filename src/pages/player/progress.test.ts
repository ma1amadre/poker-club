import { ACHIEVEMENT_CODES, isLeveled } from '@domain/achievements.ts';
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
    level: 0,
    nextLevel: isLeveled(over.code) ? (over.level ?? 0) + 1 : null,
    ...over,
  };
}

describe('строка прогресса', () => {
  it('«4 из 5» с полосой и подсказкой про соперника', () => {
    const enemy = p({ code: 'sworn_enemy', current: 4, target: 5, victimId: 'L' });
    const v = progressView(enemy, me);
    expect(v.bar).toEqual({ value: 4, max: 5, text: '4 из 5' });
    // Строка — о следующем уровне: неполученная — к уровню I.
    expect(sp(v.title)).toBe('Заклятый враг I');
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

  it('уровни: строка — о следующем уровне, название с римской цифрой', () => {
    const hunter = progressView(p({ code: 'hunter', current: 3, target: 4, level: 1 }), me);
    expect(sp(hunter.title)).toBe('Охотник II');
    expect(sp(hunter.bar?.text)).toBe('3 из 4');
    expect(sp(hunter.hint)).toBe('Лучший вечер — 3 нокаута, для «Охотник II» нужно 4 за вечер');
    expect(sp(progressView(p({ code: 'hunter', current: 2 }), me).title)).toBe('Охотник I');
    const enemy = progressView(
      p({ code: 'sworn_enemy', current: 7, target: 10, level: 1, victimId: 'L' }),
      me,
    );
    expect(sp(enemy.title)).toBe('Заклятый враг II');
    expect(sp(enemy.hint)).toBe(
      'Больше всего нокаутов у тебя — против игрока Лёша: 7. До «Заклятый враг II» — 3 нокаута',
    );
    const star = progressView(p({ code: 'star', current: 3, target: 5, level: 1 }), me);
    expect([sp(star.title), sp(star.bar?.text), sp(star.hint)]).toEqual([
      'Звезда вечера II',
      '3 из 5',
      'Звёзд вечера: 3, до «Звезда вечера II» — 2 звезды',
    ]);
    const comeback = progressView(
      p({ code: 'comeback', measure: 'condition', current: null, target: null, level: 1 }),
      me,
    );
    expect([sp(comeback.title), sp(comeback.hint)]).toEqual([
      'Камбэк II',
      'Выиграй вечер, в котором понадобилось 3 ребая и больше',
    ]);
    // На чужой карточке после «после» — родительный падеж.
    const cond = { measure: 'condition' as const, current: null, target: null };
    expect(sp(progressView(p({ code: 'comeback', ...cond }), other).hint)).toBe(
      'Победа в вечере после 2 и больше ребаев',
    );
    expect(sp(progressView(p({ code: 'comeback', ...cond, level: 1 }), other).hint)).toBe(
      'Победа в вечере после 3 и больше ребаев',
    );
  });

  it('сюжетные: «Месть» — своя Немезида, «Охота на короля» — действующий чемпион', () => {
    const cond = { measure: 'condition' as const, current: null, target: null };
    expect(sp(progressView(p({ code: 'revenge', ...cond, victimId: 'D' }), me).hint)).toBe(
      'Твоя Немезида — Дима: выбей в ответ',
    );
    expect(sp(progressView(p({ code: 'revenge', ...cond }), other).hint)).toBe('Немезиды пока нет');
    const king = (over: Partial<AchievementProgress>) =>
      progressView(p({ code: 'king_hunt', ...cond, ...over }), { ...me, self: 'M' });
    expect(sp(king({ leaders: ['D'] }).hint)).toBe('Выбей действующего чемпиона: Дима');
    const self = king({ leaders: ['M'], possible: false });
    expect([sp(self.hint), self.muted]).toEqual([
      'Действующий чемпион — ты: охотятся на тебя',
      true,
    ]);
    expect(sp(king({ leaders: [], possible: false }).hint)).toBe(
      'Действующего чемпиона нет — охота откроется со следующего сезона',
    );
    expect(sp(progressView(p({ code: 'phoenix', ...cond }), me).hint)).toBe(
      'Выиграй вечер, в котором первый вылет — твой: вернись ребаем',
    );
    expect(sp(progressView(p({ code: 'clean_win', ...cond }), other).hint)).toBe(
      'Победа в вечере без единого ребая',
    );
  });

  it('«Охота на короля»: себя в целях нет, на чужой карточке — без «ты»', () => {
    const cond = { measure: 'condition' as const, current: null, target: null };
    const king = (over: Partial<AchievementProgress>, opts: { isMe: boolean; self: string }) =>
      progressView(p({ code: 'king_hunt', ...cond, ...over }), { ...opts, nameOf: me.nameOf });
    // Чужая карточка единственного чемпиона: не «ты» о другом человеке.
    const sole = king({ leaders: ['M'], possible: false }, { isMe: false, self: 'M' });
    expect([sp(sole.hint), sole.muted]).toEqual(['Действующий чемпион — этот игрок', true]);
    // Ничья в прошлом сезоне, владелец карточки — один из чемпионов: в целях только остальные.
    expect(sp(king({ leaders: ['D', 'M'] }, { isMe: true, self: 'M' }).hint)).toBe(
      'Выбей действующего чемпиона: Дима',
    );
    expect(sp(king({ leaders: ['D', 'L', 'M'] }, { isMe: true, self: 'M' }).hint)).toBe(
      'Выбей одного из действующих чемпионов: Дима и Лёша',
    );
    expect(sp(king({ leaders: ['D', 'M'] }, { isMe: false, self: 'M' }).hint)).toBe(
      'Цель — действующий чемпион: Дима',
    );
    expect(sp(king({ leaders: ['D', 'L'] }, { isMe: false, self: 'M' }).hint)).toBe(
      'Цель — действующие чемпионы: Дима и Лёша',
    );
  });

  it('подсказки без рода: ни одна форма «ты» не требует рода', () => {
    // Слова, у которых при «ты» есть род: «первым/первой», «сам/сама», прошедшее время («выбил»).
    const GENDERED =
      /(?<!\p{L})(?:перв(?:ым|ой)|последн(?:им|ей)|сам[аи]?|готова?|должн[аы]?|должен|\p{L}+(?:ал|ял|ил|ыл|ел|ёл|ул)а?)(?!\p{L})/u;
    const cond = { measure: 'condition' as const, current: null, target: null };
    const states: AchievementProgress[] = ACHIEVEMENT_CODES.flatMap((code) => [
      p({ code }),
      p({ code, current: 2, target: 3, victimId: 'L', leaders: ['L'], leaderValue: 3 }),
      p({ code, ...cond, victimId: 'L', leaders: ['L', 'M'] }),
      p({ code, ...cond, possible: false, leaders: ['M'] }),
      p({ code, current: 1, target: 5, level: 1 }),
    ]);
    for (const state of states)
      for (const opts of [
        { ...me, self: 'M' },
        { ...other, self: 'M' },
      ]) {
        const hint = progressView(state, opts).hint;
        expect(hint, `${state.code}: ${hint}`).not.toMatch(GENDERED);
      }
  });

  it('условие без счётчика — без полосы', () => {
    const v = progressView(
      p({ code: 'star', measure: 'condition', current: null, target: null }),
      me,
    );
    expect(v.bar).toBeNull();
    expect(v.aside).toBeNull();
    expect(sp(v.hint)).toBe(
      'Выиграй номинацию голосования после вечера — без ничьей и с 2 голосами и больше',
    );
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
