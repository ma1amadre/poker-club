import { describe, expect, it } from 'vitest';
import {
  adminErrorText,
  adminTab,
  announceChangeText,
  announceReach,
  bankerCandidates,
  cancelConfirmMessage,
  cancelFooter,
  cancelledNoticeText,
  decimalToInput,
  type EveningLike,
  groupPlayers,
  intToInput,
  mergeSummary,
  mergeTargets,
  nameError,
  noteHint,
  parseDecimalInput,
  parseIntInput,
  type PlayerLike,
  splitEvenings,
  takenDates,
  vacatedSlot,
} from './lib';
import { normalizeName } from '../../shared/lib/text';

describe('parseIntInput', () => {
  it('целые числа, разряды и знаки минуса', () => {
    expect(parseIntInput('500')).toBe(500);
    expect(parseIntInput(' 1 500 ')).toBe(1500);
    expect(parseIntInput('1 500')).toBe(1500);
    expect(parseIntInput('-1001234567890')).toBe(-1001234567890);
    expect(parseIntInput('−1001234567890')).toBe(-1001234567890);
    expect(parseIntInput('–100')).toBe(-100);
  });

  it('пусто — null, мусор и дроби — NaN', () => {
    expect(parseIntInput('')).toBeNull();
    expect(parseIntInput('   ')).toBeNull();
    expect(parseIntInput('12,5')).toBeNaN();
    expect(parseIntInput('abc')).toBeNaN();
    expect(parseIntInput('1e3')).toBeNaN();
    expect(parseIntInput('99999999999999999999')).toBeNaN();
  });
});

describe('parseDecimalInput / decimalToInput / intToInput', () => {
  it('запятая и точка', () => {
    expect(parseDecimalInput('0,5')).toBe(0.5);
    expect(parseDecimalInput('0.5')).toBe(0.5);
    expect(parseDecimalInput('1')).toBe(1);
    expect(parseDecimalInput(',5')).toBe(0.5);
    expect(parseDecimalInput('33,3')).toBe(33.3);
  });

  it('пусто — null, мусор — NaN', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('0,5,1')).toBeNaN();
    expect(parseDecimalInput('пол')).toBeNaN();
  });

  it('обратно в поле — с запятой', () => {
    expect(decimalToInput(0.5)).toBe('0,5');
    expect(decimalToInput(1)).toBe('1');
    expect(decimalToInput(null)).toBe('');
    expect(decimalToInput(Number.NaN)).toBe('');
    expect(intToInput(500)).toBe('500');
    expect(intToInput(undefined)).toBe('');
  });
});

describe('имена', () => {
  it('схлопывает пробелы как сервер', () => {
    expect(normalizeName('  Вова   Петров ')).toBe('Вова Петров');
  });

  it('1–40 символов', () => {
    expect(nameError('Вова')).toBeNull();
    expect(nameError('   ')).toMatch(/Введи имя/);
    expect(nameError('я'.repeat(40))).toBeNull();
    expect(nameError('я'.repeat(41))).toMatch(/длиннее 40/);
  });
});

const player = (id: string, name: string, extra: Partial<PlayerLike> = {}): PlayerLike => ({
  id,
  display_name: name,
  is_guest: false,
  is_active: true,
  is_admin: false,
  ...extra,
});

describe('groupPlayers / bankerCandidates', () => {
  const list = [
    player('3', 'Саша'),
    player('1', 'Женя', { is_admin: true }),
    player('9', 'Вова (гость)', { is_guest: true }),
    player('5', 'Миша', { is_active: false }),
    player('6', 'Костя', { is_guest: true, is_active: false }),
  ];

  it('участники, гости и отключённые — по имени', () => {
    const g = groupPlayers(list);
    expect(g.members.map((p) => p.display_name)).toEqual(['Женя', 'Саша']);
    expect(g.guests.map((p) => p.display_name)).toEqual(['Вова (гость)']);
    expect(g.inactive.map((p) => p.display_name)).toEqual(['Костя', 'Миша']);
  });

  it('банкир — активный участник с Telegram, но назначенного не теряем', () => {
    const withExGuest = [...list, player('8', 'Боря', { tg_id: null })];
    expect(bankerCandidates(withExGuest, null).map((p) => p.id)).toEqual(['1', '3']);
    expect(bankerCandidates(withExGuest, '8').map((p) => p.id)).toEqual(['1', '3', '8']);
    expect(bankerCandidates(list, '5').map((p) => p.id)).toEqual(['1', '3', '5']);
    expect(bankerCandidates(list, '3').map((p) => p.id)).toEqual(['1', '3']);
  });
});

describe('splitEvenings / takenDates', () => {
  const ev = (id: string, status: EveningLike['status'], at: string): EveningLike => ({
    id,
    status,
    scheduled_at: at,
  });
  const list = [
    ev('a', 'settled', '2026-09-24T16:00:00Z'),
    ev('b', 'announced', '2026-10-15T16:00:00Z'),
    ev('c', 'cancelled', '2026-09-03T16:00:00Z'),
    ev('d', 'announced', '2026-10-08T16:00:00Z'),
    ev('e', 'live', '2026-10-01T16:00:00Z'),
    ev('f', 'finished', '2026-10-01T15:00:00Z'),
  ];

  it('впереди — идущий вечер, затем анонсы от ближайшего; прошли — новые сверху', () => {
    const { upcoming, past } = splitEvenings(list);
    expect(upcoming.map((e) => e.id)).toEqual(['e', 'd', 'b']);
    expect(past.map((e) => e.id)).toEqual(['f', 'a', 'c']);
  });

  it('занятые дни — по Москве, без отменённых и без самого вечера', () => {
    const late = ev('g', 'announced', '2026-10-21T22:30:00Z'); // 22 октября, 01:30 МСК
    const taken = takenDates([...list, late], 'd');
    expect(taken.has('2026-10-08')).toBe(false);
    expect(taken.has('2026-10-15')).toBe(true);
    expect(taken.has('2026-09-03')).toBe(false);
    expect(taken.has('2026-10-22')).toBe(true);
    expect(taken.has('2026-10-21')).toBe(false);
  });
});

describe('adminErrorText', () => {
  it('второй вечер на день — по-русски и с подсказкой', () => {
    const pg = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "evenings_one_per_club_day_idx"',
    };
    const wrapped = Object.assign(new Error(pg.message), { cause: pg });
    expect(adminErrorText(wrapped)).toMatch(/На этот день уже есть вечер/);
    expect(adminErrorText(pg)).toMatch(/На этот день уже есть вечер/);
  });

  it('нарушение check — общая подсказка', () => {
    expect(adminErrorText({ code: '23514', message: 'violates check constraint' })).toMatch(
      /вне допустимых пределов/,
    );
  });

  it('остальное — как errorMessage', () => {
    expect(adminErrorText(new Error('Нет прав'))).toBe('Нет прав');
    expect(adminErrorText({ message: 'Failed to fetch' })).toMatch(/Нет связи/);
  });
});

describe('adminTab', () => {
  it('без ?tab и с неизвестной вкладкой — «Вечера»', () => {
    expect(adminTab(null)).toBe('evenings');
    expect(adminTab('')).toBe('evenings');
    expect(adminTab('nope')).toBe('evenings');
  });

  it('известная вкладка из адреса', () => {
    expect(adminTab('club')).toBe('club');
    expect(adminTab('formats')).toBe('formats');
    expect(adminTab('players')).toBe('players');
    expect(adminTab('evenings')).toBe('evenings');
  });
});

describe('привязка к Telegram', () => {
  const list = [
    player('g', 'Вова (гость)', { is_guest: true, tg_id: null }),
    player('p', 'Петя', { tg_id: null }),
    player('s', 'Саша', { tg_id: 1002 }),
    player('v', 'Вова', { tg_id: 1007 }),
    player('m', 'Миша', { tg_id: 1005, is_active: false }),
  ];

  it('цели — профили с Telegram, кроме самого игрока; активные сверху, по имени', () => {
    expect(mergeTargets(list, 'g').map((p) => p.id)).toEqual(['v', 's', 'm']);
    expect(mergeTargets(list, 'v').map((p) => p.id)).toEqual(['s', 'm']);
  });

  it('перечень того, что перенесётся: только ненулевое, с числом и склонением', () => {
    const lines = mergeSummary({
      evenings: 2,
      events: 10,
      votesReceived: 1,
      votesCast: 0,
      predictionsAbout: 4,
      predictionsMade: 0,
      rsvps: 0,
      bankerOf: 5,
    }).map((l) => l.replace(/\u00a0/g, ' '));
    expect(lines).toEqual([
      '2 сыгранных вечера',
      '10 записей журнала',
      '1 полученный голос',
      '4 прогноза других игроков',
      '5 вечеров в роли банкира',
    ]);
    expect(
      mergeSummary({
        evenings: 0,
        events: 0,
        votesReceived: 0,
        votesCast: 0,
        predictionsAbout: 0,
        predictionsMade: 0,
        rsvps: 0,
        bankerOf: 0,
      }),
    ).toEqual([]);
  });
});

describe('announceChangeText', () => {
  it('что бот написал в группу после правки вечера', () => {
    expect(announceChangeText('moved')).toBe('Бот написал в группу о переносе.');
    expect(announceChangeText('moved', 'rescheduled')).toBe('Бот написал в группу о переносе.');
    expect(announceChangeText('moved', 'place_set')).toBe(
      'Бот написал в группу, где пройдёт вечер.',
    );
    expect(announceChangeText('moved', 'relocated')).toBe('Бот написал в группу о смене места.');
    expect(announceChangeText('cancelled')).toBe('Бот написал в группу, что вечер отменён.');
    expect(announceChangeText('restored')).toBe(
      'Бот написал в группу, что вечер всё-таки состоится.',
    );
  });
});

describe('правка вечера с анонсом в группе', () => {
  // 06.10.2026, вторник, 15:00 МСК.
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const THU = '2026-10-08T16:00:00Z';
  const plain = (text: string | undefined) => text?.replace(/ /g, ' ');

  it('announceReach: в группу — только о будущем вечере с анонсом', () => {
    expect(announceReach({ announce_posted_at: null, scheduled_at: THU }, NOW)).toBe('none');
    expect(
      announceReach({ announce_posted_at: '2026-10-06T10:00:00Z', scheduled_at: THU }, NOW),
    ).toBe('group');
    // Устаревший анонс: время вечера прошло — сервер правку запомнит молча.
    expect(
      announceReach(
        { announce_posted_at: '2026-09-29T10:00:00Z', scheduled_at: '2026-10-01T16:00:00Z' },
        NOW,
      ),
    ).toBe('past');
  });

  it('подпись раздела «Отмена» обещает пост только будущему вечеру', () => {
    expect(cancelFooter('group')).toMatch(/^Бот напишет в группу/);
    expect(plain(cancelFooter('past'))).toBe(
      'Время вечера уже прошло — в группу ничего не уйдёт. Вернуть вечер можно здесь же.',
    );
    expect(cancelFooter('past')).not.toMatch(/Бот напишет/);
    expect(cancelFooter('none')).toMatch(/не создаст новый/);
  });

  it('подтверждение отмены: причина из своего поля, а не из заметки', () => {
    expect(cancelConfirmMessage('Женя заболел')).toMatch(/с причиной «Женя заболел»\./);
    expect(cancelConfirmMessage('')).toMatch(/отменён, без причины\./);
    expect(cancelConfirmMessage('')).not.toMatch(/заметк/);
  });

  it('пометка отменённого вечера: причина и что будет при возврате', () => {
    const group = cancelledNoticeText('Женя заболел', 'group');
    expect(group).toMatch(/^Причина: «Женя заболел»\./);
    expect(group).toMatch(/бот напишет в группу, что он всё-таки состоится\.$/);
    expect(cancelledNoticeText(null, 'past')).toBe(
      'Его нет среди ближайших, бот не создаст новый вечер на этот день.',
    );
    expect(cancelledNoticeText('  ', 'none')).not.toMatch(/Причина/);
  });

  it('подсказка заметки больше не про причину отмены', () => {
    expect(noteHint('announced', false)).toBe('Попадёт в анонс в группе.');
    expect(noteHint('announced', true)).toMatch(/правка заметки туда не попадёт/);
    expect(noteHint('live', true)).toBeUndefined();
  });
});

describe('vacatedSlot: перенос на другой день освобождает слот расписания', () => {
  const NOW = Date.parse('2026-10-06T12:00:00Z'); // вторник
  const thursdaySlot = { slot_date: '2026-10-08' };

  it('четверг по расписанию → пятница: предупредить про четверг', () => {
    expect(vacatedSlot(thursdaySlot, '2026-10-09', 4, NOW)).toBe('2026-10-08');
  });

  it('тот же день, неверная дата, не день игры или прошедший слот — молчим', () => {
    expect(vacatedSlot(thursdaySlot, '2026-10-08', 4, NOW)).toBeNull();
    expect(vacatedSlot(thursdaySlot, '', 4, NOW)).toBeNull();
    expect(vacatedSlot(thursdaySlot, '2026-10-09', 5, NOW)).toBeNull();
    expect(vacatedSlot(thursdaySlot, '2026-10-09', null, NOW)).toBeNull();
    expect(vacatedSlot({ slot_date: null }, '2026-10-09', 4, NOW)).toBeNull();
    expect(vacatedSlot({ slot_date: '2026-10-01' }, '2026-10-09', 4, NOW)).toBeNull();
  });
});
