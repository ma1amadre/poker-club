import type { FeedItem } from '@domain/feed.ts';
import type { EveningRecap } from '@domain/recap.ts';
import { describe, expect, it } from 'vitest';
import { recordValueText as recordValue } from '../../shared/lib/clubLife';
import { recapLines } from '../evening/recap';
import { feedRows, relativeDay, type FeedContext } from './feed';

/** Неразрывные пробелы — обычными: так ожидания читаются. */
const sp = (text: string | null | undefined) => text?.replace(/ /g, ' ');

// Среда, 7 октября 2026, 12:00 по Москве.
const NOW = Date.parse('2026-10-07T09:00:00Z');

describe('relativeDay', () => {
  it('сегодня, вчера и дни текущей недели', () => {
    expect(sp(relativeDay('2026-10-07T05:00:00Z', NOW))).toBe('сегодня');
    expect(sp(relativeDay('2026-10-06T05:00:00Z', NOW))).toBe('вчера');
    expect(sp(relativeDay('2026-10-05T05:00:00Z', NOW))).toBe('в понедельник');
  });

  it('прошлая неделя — датой, а не днём недели', () => {
    // Четверг прошлой недели рядом с анонсом на этот четверг читался бы как будущее.
    expect(sp(relativeDay('2026-10-01T16:00:00Z', NOW))).toBe('1 октября');
  });

  it('день — по Москве, а не по UTC', () => {
    // 21:30 UTC 6 октября — уже 7 октября по Москве.
    expect(sp(relativeDay('2026-10-06T21:30:00Z', NOW))).toBe('сегодня');
  });
});

describe('recordValue', () => {
  it('единицы рекордов; выигрыш со знаком, как во вкладке «Рекорды»', () => {
    expect(sp(recordValue('biggest_win', 2300))).toBe('+2 300 ₽');
    expect(sp(recordValue('biggest_pool', 2300))).toBe('2 300 ₽');
    expect(sp(recordValue('most_kos', 4))).toBe('4 нокаута');
    expect(sp(recordValue('win_streak', 3))).toBe('3 победы подряд');
    expect(sp(recordValue('longest_game', (4 * 60 + 10) * 60_000))).toBe('4 ч 10 мин');
  });
});

const names = new Map([
  ['a', { display_name: 'Саша' }],
  ['b', { display_name: 'Дима' }],
  ['c', { display_name: 'Лёша' }],
  ['d', { display_name: 'Миша' }],
]);
const ctx: FeedContext = {
  names,
  meId: 'a',
  nowMs: NOW,
  eveningDates: new Map([['e1', '2026-10-01T16:00:00Z']]),
};

function nemesis(to: string, victimId: string, from: string | null = null): FeedItem {
  return {
    type: 'title_change',
    id: `title:nemesis:${victimId}:e1`,
    at: '2026-10-01T21:00:00Z',
    title: 'nemesis',
    from,
    to,
    victimId,
    eveningId: 'e1',
  };
}

describe('feedRows', () => {
  it('Немезиды одного вечера — одной строкой по держателям', () => {
    const rows = feedRows([nemesis('b', 'a'), nemesis('b', 'c'), nemesis('d', 'c')], ctx, 8);
    expect(rows).toHaveLength(1);
    expect(sp(rows[0]?.title)).toBe('Новые Немезиды');
    expect(sp(rows[0]?.subtitle)).toBe(
      '1 октября · Дима — для игроков Саша (ты) и Лёша · Миша — для игрока Лёша',
    );
  });

  it('одна Немезида — обычная строка; про себя — на «ты», подпись согласована с заголовком', () => {
    const mine = feedRows([nemesis('b', 'a', 'c')], ctx, 8);
    expect(sp(mine[0]?.title)).toBe('Твоя Немезида — Дима');
    expect(sp(mine[0]?.subtitle)).toBe('1 октября · чаще всех выбивает тебя · прежде — Лёша');

    const me = feedRows([nemesis('a', 'c')], ctx, 8);
    expect(sp(me[0]?.title)).toBe('Ты — Немезида игрока Лёша');
    expect(sp(me[0]?.subtitle)).toBe('1 октября · чаще всех выбиваешь этого игрока');

    const others = feedRows([nemesis('b', 'c')], ctx, 8);
    expect(sp(others[0]?.title)).toBe('Немезида игрока Лёша — Дима');
    expect(sp(others[0]?.subtitle)).toBe('1 октября · чаще всех выбивает этого игрока');
  });

  it('момент голосования подписан днём вечера, а не закрытием голосования', () => {
    const moment: FeedItem = {
      type: 'moment',
      id: 'moment:e1:hand:b',
      at: '2026-10-03T16:00:00Z', // голосование закрылось в субботу
      eveningId: 'e1',
      category: 'hand',
      nomineeId: 'b',
      votes: 3,
      tie: false,
      caption: 'Каре',
      photoPath: null,
      noteBy: 'c',
    };
    const [row] = feedRows([moment], ctx, 8);
    expect(sp(row?.title)).toBe('Рука вечера — Дима');
    expect(sp(row?.subtitle)).toBe('1 октября · 3 голоса');
  });

  it('сезонные ачивки одного сезона — одной строкой «Итоги сезона», чемпион первым', () => {
    const season = (
      code: 'champion' | 'iron_chair' | 'rebuy_king',
      playerId: string,
    ): FeedItem => ({
      type: 'achievement',
      id: `achievement:${code}:${playerId}:2026-Q3`,
      at: '2026-09-30T21:00:00.000Z',
      playerId,
      code,
      eveningId: null,
      seasonKey: '2026-Q3',
      count: 1,
    });
    const rows = feedRows(
      [
        season('iron_chair', 'c'),
        season('champion', 'a'),
        season('iron_chair', 'a'),
        season('rebuy_king', 'd'),
        nemesis('b', 'a'),
      ],
      ctx,
      8,
    );
    expect(rows).toHaveLength(2);
    expect(sp(rows[0]?.title)).toBe('Итоги сезона: 3-й квартал 2026');
    expect(sp(rows[0]?.subtitle)).toBe(
      '1 октября · «Чемпион сезона» — Саша (ты) · «Железный стул» — Лёша и Саша (ты) · «Ребай-король» — Миша',
    );
    expect(rows[0]?.to).toBe('/rating?tab=fame');
    // Одна сезонная ачивка — обычная строка.
    const single = feedRows([season('champion', 'b')], ctx, 8);
    expect(sp(single[0]?.title)).toBe('Ачивка «Чемпион сезона» — Дима');
  });

  it('событие вечера подписано днём вечера, а не моментом finish после полуночи', () => {
    const result: FeedItem = {
      type: 'evening_result',
      id: 'result:e1',
      at: '2026-10-01T21:30:00Z', // 00:30 2 октября по Москве
      eveningId: 'e1',
      winnerId: 'b',
      entrants: 5,
      prizePoolRub: 2000,
      topHunters: [],
      topHunterKos: 0,
      winnerGuessedBy: ['a'],
      firstOutId: null,
      firstOutGuessedBy: [],
    };
    const [row] = feedRows([result], ctx, 8);
    expect(sp(row?.title)).toBe('Победа — Дима');
    expect(sp(row?.subtitle)).toBe(
      '1 октября · 5 игроков · фонд 2 000 ₽ · победителя угадали: Саша (ты)',
    );
  });

  it('обрезает по limit после склейки', () => {
    const rows = feedRows(
      [nemesis('b', 'a'), nemesis('b', 'c'), nemesis('d', 'c'), nemesis('b', 'd')],
      ctx,
      1,
    );
    expect(rows).toHaveLength(1);
  });
});

function recap(patch: Partial<EveningRecap>): EveningRecap {
  return {
    eveningId: 'e1',
    seasonKey: '2026-Q4',
    played: true,
    guest: false,
    entrants: 5,
    place: 2,
    points: 4.5,
    netRub: 300,
    rebuys: 1,
    kos: 0,
    kosBy: [],
    bustedBy: [],
    prediction: { made: false, winnerHit: false, firstOutHit: false, points: 0 },
    newAchievements: [],
    seasonPlaceBefore: null,
    seasonPlaceAfter: null,
    seasonPlaceDelta: null,
    titleChanges: [],
    records: [],
    ...patch,
  };
}

const nameOf = (id: string) => names.get(id)?.display_name ?? '?';

describe('recapLines', () => {
  it('не игравшему и без прогноза — ничего', () => {
    expect(recapLines(recap({ played: false }), 'a', nameOf, null)).toEqual([]);
  });

  it('не игравшему с прогнозом — прогноз с очками Оракула и новые ачивки', () => {
    const lines = recapLines(
      recap({
        played: false,
        place: null,
        points: null,
        netRub: null,
        prediction: { made: true, winnerHit: true, firstOutHit: true, points: 5 },
        newAchievements: [
          { playerId: 'a', code: 'oracle', eveningId: 'e1', seasonKey: null, count: 1 },
        ],
      }),
      'a',
      nameOf,
      { winnerId: 'b', firstOutId: 'c' },
    );
    expect(lines.map((l) => l.key)).toEqual(['prediction', 'achievement:oracle']);
    expect(sp(lines[0]?.title)).toBe('Прогноз — +5 очков Оракула');
    expect(sp(lines[0]?.detail)).toBe('Победитель угадан, первый вылет угадан');
    expect(sp(lines[1]?.title)).toBe('Новая ачивка «Оракул»');
  });

  it('нокауты, вылеты с ребаем, прогноз и сдвиг в сезоне словами', () => {
    const lines = recapLines(
      recap({
        kos: 3,
        kosBy: [
          { victimId: 'b', count: 2, shared: 1 },
          { victimId: 'c', count: 1, shared: 1 },
        ],
        bustedBy: [
          { by: ['d'], final: false },
          { by: ['b', 'c'], final: true },
        ],
        prediction: { made: true, winnerHit: true, firstOutHit: false, points: 3 },
        seasonPlaceBefore: 4,
        seasonPlaceAfter: 2,
        seasonPlaceDelta: 2,
      }),
      'a',
      nameOf,
      { winnerId: 'b', firstOutId: 'c' },
    );
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(sp(byKey.kos?.title)).toBe('Твои нокауты — 3');
    expect(sp(byKey.kos?.detail)).toBe('Дима — 2 (1 в дележе), Лёша — 1 (в дележе)');
    expect(sp(byKey.busted?.title)).toBe('Кто тебя выбивал');
    // Нокаут в дележе помечен: иначе «Дима и Лёша» читались бы как два вылета.
    expect(sp(byKey.busted?.detail)).toBe('Миша (до ребая), Дима и Лёша (в дележе)');
    expect(sp(byKey.prediction?.title)).toBe('Прогноз — +3 очка Оракула');
    expect(sp(byKey.prediction?.detail)).toBe('Победитель угадан, первый вылет не угадан');
    expect(sp(byKey.season?.title)).toBe('Место в сезоне: 4-е → 2-е');
    expect(byKey.season?.icon).toBe('trending-up');
    expect(sp(byKey.season?.detail)).toBe('Выше на 2 места · 4-й квартал 2026');
  });

  it('делёж до ребая — обе пометки', () => {
    const lines = recapLines(
      recap({
        bustedBy: [
          { by: ['b', 'c'], final: false },
          { by: ['d'], final: true },
        ],
      }),
      'a',
      nameOf,
      null,
    );
    const busted = lines.find((l) => l.key === 'busted');
    expect(sp(busted?.detail)).toBe('Дима и Лёша (в дележе, до ребая), Миша');
  });

  it('прогноз только на победителя — о первом вылете молчит', () => {
    const lines = recapLines(
      recap({ prediction: { made: true, winnerHit: false, firstOutHit: false, points: 0 } }),
      'a',
      nameOf,
      { winnerId: 'b', firstOutId: null },
    );
    const p = lines.find((l) => l.key === 'prediction');
    expect(sp(p?.title)).toBe('Прогноз без очков');
    expect(sp(p?.detail)).toBe('Победитель не угадан');
  });

  it('свои новые Немезиды — одной строкой', () => {
    const lines = recapLines(
      recap({
        titleChanges: [
          { title: 'nemesis', from: null, to: 'a', victimId: 'b', eveningId: 'e1' },
          { title: 'nemesis', from: 'd', to: 'a', victimId: 'c', eveningId: 'e1' },
          { title: 'nemesis', from: null, to: 'd', victimId: 'b', eveningId: 'e1' },
        ],
      }),
      'a',
      nameOf,
      null,
    );
    const titles = lines.filter((l) => l.icon === 'crown').map((l) => l.title);
    expect(titles).toEqual(['Ты — Немезида игроков Дима и Лёша']);
  });
});
