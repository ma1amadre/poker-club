import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import {
  RECORD_KINDS,
  RECORD_META,
  recordsBroken,
  recordsTable,
  type ClubRecord,
} from './records.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import { summarize } from './summary.ts';
import { journal, MIN, simpleEvening } from './test-utils.ts';

const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;
const none = { excluded: new Set<string>() };
const withGuest = { excluded: new Set(['G']) };

const row = (table: ClubRecord[], kind: ClubRecord['kind']) => {
  const r = table.find((x) => x.kind === kind);
  if (!r) throw new Error(kind);
  return { value: r.value, holders: r.holders.map((h) => [h.playerId, h.eveningId]) };
};

// simpleEvening(..., 'winner'): победитель выбивает всех; длина игры = число шагов, по минуте.
// e1: A выбивает двоих. Фонд 3·400 = 1200 → 840/360; нетто A = 840 + 3 головы − 500 = 640.
const e1 = simpleEvening('e1', q4(1), ['A', 'B', 'C'], 'winner');
// e2: B выбивает троих. Фонд 1600 → 1120/480; нетто B = 1120 + 400 − 500 = 1020.
const e2 = simpleEvening('e2', q4(8), ['B', 'A', 'C', 'D'], 'winner');
// e3: C повторяет всё за B.
const e3 = simpleEvening('e3', q4(15), ['C', 'A', 'B', 'D'], 'winner');
// e4: B снова 3 нокаута — свой же рекорд.
const e4 = simpleEvening('e4', q4(22), ['B', 'A', 'C', 'D'], 'winner');
// e5: гость G выбивает четверых и выигрывает. Фонд 2000.
const e5 = simpleEvening('e5', q4(29), ['G', 'A', 'B', 'C', 'D'], 'winner');

describe('рекорды: таблица', () => {
  it('пять видов в фиксированном порядке, у каждого русское название', () => {
    expect(recordsTable([], none).map((r) => r.kind)).toEqual([...RECORD_KINDS]);
    expect(recordsTable([], none).every((r) => r.value === null && r.holders.length === 0)).toBe(
      true,
    );
    for (const k of RECORD_KINDS) expect(RECORD_META[k].title).toMatch(/[А-Яа-яЁё]/);
  });

  it('значения и держатели; порядок входа не важен', () => {
    const t = recordsTable([e2, e1], none);
    expect(row(t, 'biggest_win')).toEqual({ value: 1020, holders: [['B', 'e2']] });
    expect(row(t, 'most_kos')).toEqual({ value: 3, holders: [['B', 'e2']] });
    expect(row(t, 'biggest_pool')).toEqual({ value: 1600, holders: [[null, 'e2']] });
    expect(row(t, 'longest_game')).toEqual({ value: 3 * MIN, holders: [[null, 'e2']] });
    // Одна победа — ещё не серия.
    expect(row(t, 'win_streak')).toEqual({ value: null, holders: [] });
  });

  it('ничья — все держатели, первым установивший раньше; тот же игрок — один раз', () => {
    const t = recordsTable([e4, e3, e2, e1], none);
    expect(row(t, 'most_kos')).toEqual({
      value: 3,
      holders: [
        ['B', 'e2'],
        ['C', 'e3'],
      ],
    });
    expect(row(t, 'biggest_win').holders).toEqual([
      ['B', 'e2'],
      ['C', 'e3'],
    ]);
    // У рекордов вечера держатель — каждый вечер с этим значением.
    expect(row(t, 'biggest_pool').holders).toEqual([
      [null, 'e2'],
      [null, 'e3'],
      [null, 'e4'],
    ]);
  });

  it('гость не попадает в рекорды игрока, но его вечер — в рекорды вечера', () => {
    const t = recordsTable([e1, e2, e3, e5], withGuest);
    expect(row(t, 'most_kos')).toEqual({
      value: 3,
      holders: [
        ['B', 'e2'],
        ['C', 'e3'],
      ],
    });
    expect(row(t, 'biggest_pool')).toEqual({ value: 2000, holders: [[null, 'e5']] });
    expect(row(t, 'longest_game')).toEqual({ value: 4 * MIN, holders: [[null, 'e5']] });
    // Без исключения гость — держатель.
    expect(row(recordsTable([e1, e2, e5], none), 'most_kos')).toEqual({
      value: 4,
      holders: [['G', 'e5']],
    });
  });

  it('серия побед — подряд в вечерах, где игрок играл; вечер — где серия достигла длины', () => {
    const s1 = simpleEvening('s1', q4(1), ['A', 'B']);
    const s2 = simpleEvening('s2', q4(2), ['B', 'C']); // A не играл — серия A не рвётся
    const s3 = simpleEvening('s3', q4(3), ['A', 'C']); // A: 2 подряд; B не играл
    const s4 = simpleEvening('s4', q4(4), ['B', 'A']); // B: 2 подряд (s2, s4); у A серия обнулилась
    const list = [s1, s2, s3, s4];
    expect(row(recordsTable(list, none), 'win_streak')).toEqual({
      value: 2,
      holders: [
        ['A', 's3'],
        ['B', 's4'],
      ],
    });
    const s5 = simpleEvening('s5', q4(5), ['B', 'A']);
    expect(row(recordsTable([...list, s5], none), 'win_streak')).toEqual({
      value: 3,
      holders: [['B', 's5']],
    });
    expect(recordsBroken([...list, s5], none)['s5']).toContainEqual({
      kind: 'win_streak',
      value: 3,
      previous: 2,
      status: 'new',
      playerIds: ['B'],
    });
  });

  it('длина игры — чистое время без пауз', () => {
    const j = journal(q4(1)).join('A', 'B');
    j.start();
    j.wait(30).pause();
    j.wait(60).resume();
    j.wait(30).bust('B', ['A']);
    j.finish();
    const s = summarize('p', q4(1), DEFAULT_FORMAT, j.events, DEFAULT_SCORING);
    expect(s.durationMs).toBe(60 * MIN);
    expect(s.prizePoolRub).toBe(800);
    expect(s.finishedAt).toBe('2026-10-01T18:00:00.000Z');
  });

  it('длина игры — до решающего вылета, а не до нажатия «Завершить»', () => {
    const j = journal(q4(1)).join('A', 'B', 'C');
    j.start();
    j.wait(100).bust('C', ['A']);
    j.wait(200).bust('B', ['A']); // решающий вылет: 300 минут игры
    j.wait(600).finish(); // «Завершить» нажали на следующее утро
    const s = summarize('late', q4(1), DEFAULT_FORMAT, j.events, DEFAULT_SCORING);
    expect(s.durationMs).toBe(300 * MIN);
    expect(s.finishedAt).toBe(new Date(Date.parse(q4(1)) + 900 * MIN).toISOString());
  });

  it('ребай после вылета продолжает игру: решающим становится следующий вылет', () => {
    const j = journal(q4(1)).join('A', 'B');
    j.start();
    j.wait(30).bust('B', ['A']);
    j.wait(5).rebuy('B');
    j.wait(25).bust('B', ['A']);
    j.wait(120).finish();
    const s = summarize('rb', q4(1), DEFAULT_FORMAT, j.events, DEFAULT_SCORING);
    expect(s.durationMs).toBe(60 * MIN);
  });

  it('итог без новых полей (собран вручную) не ломает таблицу: фонда и длины просто нет', () => {
    const { prizePoolRub: _p, durationMs: _d, ...bare } = e1;
    const t = recordsTable([bare], none);
    expect(row(t, 'biggest_pool').value).toBeNull();
    expect(row(t, 'longest_game').value).toBeNull();
    expect(row(t, 'most_kos').value).toBe(2);
  });
});

describe('рекорды: какой вечер что установил', () => {
  it('первый вечер клуба рекордов не ставит, у каждого вечера есть ключ', () => {
    const b = recordsBroken([e1, e2], none);
    expect(Object.keys(b).sort()).toEqual(['e1', 'e2']);
    expect(b['e1']).toEqual([]);
    expect(b['e2']).toEqual([
      { kind: 'biggest_win', value: 1020, previous: 640, status: 'new', playerIds: ['B'] },
      { kind: 'most_kos', value: 3, previous: 2, status: 'new', playerIds: ['B'] },
      { kind: 'biggest_pool', value: 1600, previous: 1200, status: 'new', playerIds: [] },
      { kind: 'longest_game', value: 3 * MIN, previous: 2 * MIN, status: 'new', playerIds: [] },
    ]);
  });

  it('повторил рекорд — equalled, в том числе свой же', () => {
    const b = recordsBroken([e1, e2, e3, e4], none);
    expect(b['e3']?.map((r) => [r.kind, r.status, r.playerIds])).toEqual([
      ['biggest_win', 'equalled', ['C']],
      ['most_kos', 'equalled', ['C']],
      ['biggest_pool', 'equalled', []],
      ['longest_game', 'equalled', []],
    ]);
    expect(b['e4']?.find((r) => r.kind === 'most_kos')).toEqual({
      kind: 'most_kos',
      value: 3,
      previous: 3,
      status: 'equalled',
      playerIds: ['B'],
    });
  });

  it('первое значение вида после первого вечера — новый рекорд с previous = null', () => {
    const quiet = simpleEvening('q1', q4(1), ['A', 'B', 'C'], 'none');
    const b = recordsBroken([quiet, e2], none);
    expect(b['e2']?.find((r) => r.kind === 'most_kos')).toEqual({
      kind: 'most_kos',
      value: 3,
      previous: null,
      status: 'new',
      playerIds: ['B'],
    });
  });

  it('гость рекорд игрока не ставит, рекорд вечера — ставит', () => {
    const b = recordsBroken([e1, e2, e5], withGuest);
    expect(b['e5']?.map((r) => r.kind)).toEqual(['biggest_pool', 'longest_game']);
  });

  it('ничья внутри вечера — все установившие, по месту', () => {
    // A и B выбивают по одному, победитель A.
    const j = journal(q4(8)).join('A', 'B', 'C', 'D');
    j.start();
    j.wait(1).bust('D', ['B']);
    j.wait(1).bust('C', ['A']);
    j.wait(1).bust('B', []);
    j.finish();
    const tie = summarize('t', q4(8), DEFAULT_FORMAT, j.events, DEFAULT_SCORING);
    const quiet = simpleEvening('q1', q4(1), ['A', 'B', 'C'], 'none');
    expect(recordsBroken([quiet, tie], none)['t']?.find((r) => r.kind === 'most_kos')).toEqual({
      kind: 'most_kos',
      value: 1,
      previous: null,
      status: 'new',
      playerIds: ['A', 'B'],
    });
  });
});
