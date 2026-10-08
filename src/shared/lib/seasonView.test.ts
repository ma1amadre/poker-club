import type { Achievement, AchievementInput } from '@domain/achievements.ts';
import type { StandingRow } from '@domain/season.ts';
import { seasonRace, type SeasonRace } from '@domain/seasonRace.ts';
import { playerSeason, seasonRecap } from '@domain/seasonRecap.ts';
import { simpleEvening } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import {
  finaleText,
  mySeasonLine,
  mySeasonStats,
  podiumView,
  raceCountedNote,
  raceFullHint,
  raceLeaderLine,
  raceLines,
  seasonAchievementsLine,
  seasonDaysLeftText,
  seasonLaureates,
  seasonMetaLine,
  seasonResultsDate,
  weekdayCount,
} from './seasonView';

/** Неразрывные пробелы — обычными: так проще сравнивать. */
const plain = (text: string): string => text.replace(/ /g, ' ');

/** Родовые формы о человеке, которых в Mini App быть не должно («играл», «выиграла», «сделал»). */
const GENDERED = /\b(играл|играла|выиграл|выиграла|сыграл|сыграла|сделал|сделала|стал|стала)\b/i;

describe('отсчёт до конца сезона', () => {
  it('день недели в нужной форме', () => {
    expect(plain(weekdayCount(1, 5))).toBe('1 пятница');
    expect(plain(weekdayCount(3, 5))).toBe('3 пятницы');
    expect(plain(weekdayCount(5, 5))).toBe('5 пятниц');
    expect(plain(weekdayCount(2, 4))).toBe('2 четверга');
    expect(plain(weekdayCount(11, 7))).toBe('11 воскресений');
    expect(plain(weekdayCount(2, 9))).toBe('2 игровых дня');
  });

  it('сколько игровых дней осталось — всегда; ноль — когда итоги', () => {
    expect(plain(seasonDaysLeftText(12, 5, '2026-Q4', false) ?? '')).toBe(
      'До конца сезона — 12 пятниц',
    );
    expect(plain(seasonDaysLeftText(3, 5, '2026-Q4', false) ?? '')).toBe(
      'До конца сезона — 3 пятницы',
    );
    expect(plain(seasonDaysLeftText(1, 5, '2026-Q4', true) ?? '')).toBe(
      'До конца сезона — 1 пятница',
    );
    expect(seasonDaysLeftText(0, 5, '2026-Q4', false)).toBe(
      'Игр в сезоне по расписанию больше нет — итоги 1 января',
    );
    expect(seasonResultsDate('2026-Q3')).toBe('1 октября');
  });

  it('слотов не осталось, но вечер сезона объявлен или идёт — «игр больше нет» не пишем', () => {
    // Пт 25.12, финал в разгаре, или финал перенесён на субботу 26.12: слотов после «сейчас» нет.
    expect(seasonDaysLeftText(0, 5, '2026-Q4', true)).toBeNull();
  });

  it('пометка финала', () => {
    expect(finaleText('2026-Q4')).toBe('Финал сезона — последний вечер 4-го квартала 2026');
  });
});

describe('итоги сезона на экранах', () => {
  const Q4 = (d: string) => `2026-${d}T12:00:00.000Z`;
  const input: AchievementInput = {
    summaries: [
      simpleEvening('e1', Q4('10-02'), ['A', 'B', 'C'], 'winner'),
      simpleEvening('e2', Q4('10-09'), ['A', 'C', 'B'], 'winner', { B: 2 }),
      simpleEvening('e3', Q4('10-16'), ['C', 'A', 'B']),
    ],
    excluded: new Set(),
    predictions: [{ eveningId: 'e1', playerId: 'D', winner: 3, firstOut: 0, total: 3 }],
    stars: [],
    bestN: 2,
    currentSeasonKey: '2027-Q1',
  };
  const recap = seasonRecap(input, '2026-Q4');

  it('«Твой сезон»: место, очки с зачётом, победы и нокауты, нетто', () => {
    const a = playerSeason(recap, 'A');
    expect(a).not.toBeNull();
    if (!a) return;
    const stats = mySeasonStats(a).map((s) =>
      plain(`${s.label}: ${s.value} ${s.unit ?? ''} / ${s.note ?? ''}`),
    );
    expect(stats[0]).toBe('Место: 1 из 3 / ');
    expect(stats[1]).toMatch(/^Очки: \d+(,\d)? {2}\/ В зачёте лучшие 2 из 3$/);
    expect(stats[2]).toMatch(/^Победы и нокауты: 2 победы \/ \d+ нокаут/);
    expect(stats[3]).toMatch(/^Нетто: [+−]?[\d ]+ ₽ {2}\/ 3 вечера$/);
    expect(plain(mySeasonLine(a))).toMatch(
      /^1-е место из 3 · .* очк.* · 2 победы · \d+ нокаут.* · [+−]?[\d ]+ ₽$/,
    );
    // Только прогнозы — без места, с «Оракулом».
    const d = playerSeason(recap, 'D');
    expect(d && mySeasonStats(d)[0]).toEqual({
      label: 'Место',
      value: '—',
      note: 'в этом сезоне без игр',
    });
    expect(d && mySeasonLine(d)).toBe('В этом сезоне без игр · Оракул — 1-е место');
    // Без игр — только место «—» и «Оракул»: ни нулевых очков с «Вечеров в сезоне ещё не было» у
    // прошедшего сезона, ни «Нетто: 0 ₽ / 0 вечеров».
    expect(
      d &&
        mySeasonStats(d).map((s) =>
          plain(`${s.label}: ${s.value} ${s.unit ?? ''} / ${s.note ?? ''}`),
        ),
    ).toEqual(['Место: —  / в этом сезоне без игр', 'Оракул: 3 очка / 1-е место']);
    // Без игр и без прогнозов (только ачивка) — одно место.
    expect(
      mySeasonStats({
        ...a,
        place: null,
        total: 0,
        counted: 0,
        played: 0,
        wins: 0,
        kos: 0,
        netRub: 0,
        oracle: null,
      }),
    ).toEqual([{ label: 'Место', value: '—', note: 'в этом сезоне без игр' }]);
    for (const id of ['A', 'B', 'C', 'D']) {
      const ps = playerSeason(recap, id);
      if (!ps) continue;
      const texts = [
        ...mySeasonStats(ps).flatMap((s) => [s.label, s.value, s.unit, s.note]),
        mySeasonLine(ps),
      ];
      for (const t of texts) if (t) expect(t).not.toMatch(GENDERED);
    }
  });

  it('ачивки сезона строкой: старший уровень, число выдач, порядок каталога', () => {
    const row = (a: Partial<Achievement> & Pick<Achievement, 'code'>): Achievement => ({
      playerId: 'A',
      eveningId: 'e1',
      seasonKey: null,
      targetId: null,
      count: 1,
      level: 1,
      first: true,
      ...a,
    });
    expect(
      plain(
        seasonAchievementsLine([
          row({ code: 'champion', eveningId: null, seasonKey: '2026-Q4' }),
          row({ code: 'hunter', level: 1 }),
          row({ code: 'clean_win' }),
          row({ code: 'hunter', level: 2, eveningId: 'e2' }),
        ]),
      ),
    ).toBe('Охотник II ×2, Чистая победа, Чемпион сезона');
    expect(seasonAchievementsLine([])).toBe('');
  });

  it('лауреаты, подиум и строка сезона', () => {
    const ids = seasonLaureates(recap).map((l) => l.id);
    expect(ids).toContain('oracle');
    expect(ids).toContain('hunter');
    expect(ids).toContain('rebuy_king');
    expect(ids).toContain('iron_chair');
    const oracle = seasonLaureates(recap).find((l) => l.id === 'oracle');
    expect(oracle && plain(oracle.value)).toBe('3 очка за прогнозы');
    expect(podiumView(recap)[0]).toMatchObject({ place: 1, playerIds: recap.champions });
    expect(plain(seasonMetaLine(recap))).toBe('3 вечера · в зачёт — лучшие 2');
    expect(plain(seasonMetaLine({ eveningIds: ['x'], bestN: 10 }))).toBe('1 вечер');
  });
});

describe('гонка сезона', () => {
  const names: Record<string, string> = { A: 'Дима', B: 'Саша', C: 'Женя', D: 'Лёша', E: 'Вова' };
  const nameOf = (id: string): string => names[id] ?? id;
  const row = (
    playerId: string,
    total: number,
    extra: Partial<Omit<StandingRow, 'playerId' | 'total'>> = {},
  ): StandingRow => ({
    playerId,
    total,
    counted: [total],
    played: 1,
    wins: 0,
    kos: 0,
    netRub: 0,
    ...extra,
  });
  const race = (rows: StandingRow[], id: string, bestN = 10): SeasonRace => {
    const r = seasonRace(rows, id, bestN);
    if (!r) throw new Error('нет в таблице');
    return r;
  };
  const rows = [
    row('A', 20, { wins: 3 }),
    row('B', 18.5, { wins: 1 }),
    row('C', 17, { wins: 1 }),
    row('D', 15),
  ];

  it('соседи сверху и снизу и лидер — разница в очках и имена', () => {
    const texts = (r: SeasonRace) => raceLines(r, nameOf).map((l) => plain(l.text));
    expect(raceLines(race(rows, 'C'), nameOf).map((l) => l.kind)).toEqual([
      'above',
      'leader',
      'below',
    ]);
    expect(texts(race(rows, 'C'))).toEqual([
      'До 2-го места — 1,5 очка · Саша',
      'До 1-го места — 3 очка · Дима',
      'Отрыв от 4-го места — 2 очка · Лёша',
    ]);
    expect(texts(race(rows, 'A'))).toEqual([
      'Первое место — твоё',
      'Отрыв от 2-го места — 1,5 очка · Саша',
    ]);
    expect(texts(race(rows, 'D'))).toEqual([
      'До 3-го места — 2 очка · Женя',
      'До 1-го места — 5 очков · Дима',
    ]);
  });

  it('делёж места и равные очки — без рода, с тем, что решает', () => {
    const tied = [
      row('A', 10, { wins: 2 }),
      row('B', 10, { wins: 1, kos: 3 }),
      row('C', 10, { wins: 1, kos: 3 }),
      row('D', 10, { wins: 1, kos: 1 }),
    ];
    const texts = (r: SeasonRace) => raceLines(r, nameOf).map((l) => plain(l.text));
    expect(texts(race(tied, 'B'))).toEqual([
      'Делёж 2-го места: ты и Женя',
      '1-е место — столько же очков, выше по победам · Дима',
      '4-е место — столько же очков, ты выше по нокаутам · Лёша',
    ]);
    const first = [row('A', 10), row('B', 10), row('C', 4)];
    expect(raceLines(race(first, 'A'), nameOf)[0]).toEqual({
      kind: 'tie',
      text: 'Делёж 1-го места: ты и Саша',
    });
    for (const id of ['A', 'B', 'C', 'D'])
      for (const line of raceLines(race(tied, id), nameOf)) expect(line.text).not.toMatch(GENDERED);
  });

  it('вечера в зачёте и подсказка, когда все места заняты', () => {
    expect(plain(raceCountedNote({ counted: 3, bestN: 10 }))).toBe('в зачёте 3 из 10 вечеров');
    expect(plain(raceCountedNote({ counted: 1, bestN: 1 }))).toBe('в зачёте 1 из 1 вечера');
    expect(raceFullHint({ bestN: 10, weakestCounted: null })).toBeNull();
    expect(plain(raceFullHint({ bestN: 10, weakestCounted: 2 }) ?? '')).toBe(
      'Все 10 мест зачёта заняты — новый вечер пойдёт в зачёт, если даст больше 2 очков',
    );
    expect(plain(raceFullHint({ bestN: 3, weakestCounted: 1.5 }) ?? '')).toBe(
      'Все 3 места зачёта заняты — новый вечер пойдёт в зачёт, если даст больше 1,5 очка',
    );
    expect(plain(raceFullHint({ bestN: 1, weakestCounted: 4 }) ?? '')).toBe(
      'Единственное место зачёта занято — новый вечер пойдёт в зачёт, если даст больше 4 очков',
    );
  });

  it('лидер для того, у кого нет игр', () => {
    expect(plain(raceLeaderLine(['A'], 18, nameOf))).toBe('Лидер сезона — Дима · 18 очков');
    expect(plain(raceLeaderLine(['A', 'B'], 7.5, nameOf))).toBe(
      'Лидеры сезона — Дима и Саша · 7,5 очка',
    );
  });
});
