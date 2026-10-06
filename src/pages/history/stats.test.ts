import { DEFAULT_FORMAT } from '@domain/format.ts';
import { journal } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import { eveningTotals, groupHistory, type HistoryEveningLike } from './stats';

const ev = (
  id: string,
  scheduled_at: string,
  status: HistoryEveningLike['status'],
): HistoryEveningLike => ({ id, scheduled_at, status });

describe('раскладка истории', () => {
  const list = [
    ev('a', '2026-09-03T16:00:00Z', 'cancelled'),
    ev('b', '2026-10-01T16:00:00Z', 'settled'),
    ev('c', '2026-10-15T16:00:00Z', 'announced'),
    ev('d', '2026-10-08T16:00:00Z', 'live'),
    ev('e', '2026-09-24T16:00:00Z', 'finished'),
    ev('f', '2026-08-27T16:00:00Z', 'settled'),
  ];

  it('идущий вечер отдельно сверху, анонсы не попадают', () => {
    const { live, seasons } = groupHistory(list);
    expect(live.map((e) => e.id)).toEqual(['d']);
    const all = seasons.flatMap((s) => s.evenings.map((e) => e.id));
    expect(all).not.toContain('c');
    expect(all).not.toContain('d');
  });

  it('сезоны новые сверху, внутри — по убыванию даты', () => {
    const { seasons } = groupHistory(list);
    expect(seasons.map((s) => [s.seasonKey, s.evenings.map((e) => e.id)])).toEqual([
      ['2026-Q4', ['b']],
      ['2026-Q3', ['e', 'a', 'f']],
    ]);
  });

  it('сезон по московскому времени: 31.12 в 22:00 UTC — уже следующий год', () => {
    const { seasons } = groupHistory([ev('n', '2026-12-31T22:00:00Z', 'finished')]);
    expect(seasons[0]?.seasonKey).toBe('2027-Q1');
  });

  it('битая дата не роняет раскладку', () => {
    const { seasons } = groupHistory([
      ev('x', 'не дата', 'finished'),
      ev('y', '2026-10-01T16:00:00Z', 'finished'),
    ]);
    expect(seasons.flatMap((s) => s.evenings.map((e) => e.id))).toEqual(['y']);
  });

  it('пусто — пусто', () => {
    expect(groupHistory([])).toEqual({ live: [], seasons: [] });
  });
});

describe('итоги вечера по журналу', () => {
  it('фонд — входы и ребаи × (бай-ин − баунти), состав и кто в игре', () => {
    const j = journal();
    j.join('A', 'B', 'C');
    j.start();
    j.wait(5);
    j.bust('C', ['A']);
    j.rebuy('C');
    j.wait(5);
    j.bust('B', ['C']);
    const totals = eveningTotals(DEFAULT_FORMAT, j.events);
    expect(totals).toEqual({
      players: 3,
      alive: 2,
      prizePoolRub: 4 * (DEFAULT_FORMAT.buyInRub - DEFAULT_FORMAT.bountyRub),
    });
  });

  it('пустой журнал — нули', () => {
    expect(eveningTotals(DEFAULT_FORMAT, [])).toEqual({ players: 0, alive: 0, prizePoolRub: 0 });
  });
});
