// Напоминание о голосовании (миграция 021): когда писать и кого считать в «проголосовали N из M».
import { describe, expect, it } from 'vitest';
import {
  decideVotingReminder,
  turnoutDecision,
  votingTurnout,
  VOTING_REMINDER_HOURS,
  type TurnoutPlayerRow,
  type VotingReminderEveningLike,
} from './votingReminder.ts';

const HOUR = 60 * 60 * 1000;
const CLOSES = '2026-10-10T12:00:00.000Z'; // 15:00 МСК, сутки после финала
const CLOSES_MS = Date.parse(CLOSES);

const evening = (over: Partial<VotingReminderEveningLike> = {}): VotingReminderEveningLike => ({
  status: 'finished',
  voting_closes_at: CLOSES,
  results_posted_at: '2026-10-09T12:05:00.000Z', // итоги ушли сразу после финала
  voting_reminder_posted_at: null,
  ...over,
});

describe('decideVotingReminder', () => {
  it('окно — последние 3 часа до закрытия, начало включительно', () => {
    expect(VOTING_REMINDER_HOURS).toBe(3);
    expect(decideVotingReminder(evening(), CLOSES_MS - 3 * HOUR - 1)).toBe('none');
    expect(decideVotingReminder(evening(), CLOSES_MS - 3 * HOUR)).toBe('post');
    expect(decideVotingReminder(evening(), CLOSES_MS - 2 * HOUR)).toBe('post');
    expect(decideVotingReminder(evening(), CLOSES_MS)).toBe('none'); // закрыто — шаг итогов голосования
    expect(decideVotingReminder(evening(), CLOSES_MS + HOUR)).toBe('none');
  });

  it('только у завершённого вечера с открытым голосованием и только один раз', () => {
    const at = CLOSES_MS - 2 * HOUR;
    expect(decideVotingReminder(evening({ status: 'settled' }), at)).toBe('post');
    expect(decideVotingReminder(evening({ status: 'live' }), at)).toBe('none');
    expect(decideVotingReminder(evening({ voting_closes_at: null }), at)).toBe('none');
    expect(decideVotingReminder(evening({ voting_closes_at: 'кривая дата' }), at)).toBe('none');
    expect(
      decideVotingReminder(evening({ voting_reminder_posted_at: '2026-10-10T09:00:00Z' }), at),
    ).toBe('none');
  });

  it('итогов в группе ещё нет — ждём их; итоги ушли уже внутри окна — отметить без поста', () => {
    const at = CLOSES_MS - 2 * HOUR;
    expect(decideVotingReminder(evening({ results_posted_at: null }), at)).toBe('wait_results');
    // Итоги добиты за 2 ч 30 мин до закрытия: в них уже сказано, до какого времени голосовать.
    const late = new Date(CLOSES_MS - 2.5 * HOUR).toISOString();
    expect(decideVotingReminder(evening({ results_posted_at: late }), at)).toBe('fresh_results');
    // Ровно на границе окна — тоже свежие.
    const edge = new Date(CLOSES_MS - 3 * HOUR).toISOString();
    expect(decideVotingReminder(evening({ results_posted_at: edge }), at)).toBe('fresh_results');
  });

  it('до закрытия меньше получаса (будильник стоял) — отметить без поста', () => {
    expect(decideVotingReminder(evening(), CLOSES_MS - 31 * 60_000)).toBe('post');
    expect(decideVotingReminder(evening(), CLOSES_MS - 29 * 60_000)).toBe('too_late');
  });
});

describe('votingTurnout', () => {
  const player = (id: string, over: Partial<TurnoutPlayerRow> = {}): TurnoutPlayerRow => ({
    id,
    tg_id: 1000,
    is_active: true,
    ...over,
  });
  const PLAYERS = [
    player('a'),
    player('b', { tg_id: '1002' }),
    player('c'),
    player('g', { tg_id: null }), // гость: войти не может
    player('x', { is_active: false }), // выключен после игры
    player('n'), // не играл
  ];

  it('голосуют игравшие, кто может войти: активные и с Telegram', () => {
    expect(votingTurnout(['a', 'b', 'c', 'g', 'x'], PLAYERS, [])).toEqual({
      voted: 0,
      eligible: 3,
    });
  });

  it('проголосовал — хотя бы один голос; голоса выключенного и посторонних не в счёт', () => {
    // a — в двух номинациях, x — выключен, n — не играл (RPC такой голос не примет, но не полагаемся).
    expect(votingTurnout(['a', 'b', 'c', 'g', 'x'], PLAYERS, ['a', 'a', 'x', 'n'])).toEqual({
      voted: 1,
      eligible: 3,
    });
  });

  it('игрок без строки players и повтор входа не ломают счёт', () => {
    expect(votingTurnout(['a', 'a', 'zz'], PLAYERS, ['a'])).toEqual({ voted: 1, eligible: 1 });
  });

  it('решение: напоминать, все проголосовали, голосовать некому', () => {
    expect(turnoutDecision({ voted: 2, eligible: 5 })).toBe('post');
    expect(turnoutDecision({ voted: 0, eligible: 5 })).toBe('post');
    expect(turnoutDecision({ voted: 5, eligible: 5 })).toBe('all_voted');
    expect(turnoutDecision({ voted: 0, eligible: 0 })).toBe('no_voters');
  });
});
