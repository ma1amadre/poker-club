// Решение «писать ли в группу после правки вечера» и тексты постов о переносе, отмене и возврате.
import { describe, expect, it } from 'vitest';
import {
  announceSnapshot,
  decideAnnounceChange,
  parseSnapshot,
  sameSnapshot,
  type AnnounceSnapshot,
} from './announce.ts';
import { announceChangePost, type AnnounceChangePostInput } from './messages.ts';

const NOW = Date.parse('2026-10-06T12:00:00Z'); // вторник
const THU = '2026-10-08T16:00:00.000Z'; // четверг, 19:00 МСК
const FRI = '2026-10-09T17:00:00.000Z'; // пятница, 20:00 МСК

const snap = (over: Partial<AnnounceSnapshot> = {}): AnnounceSnapshot => ({
  scheduledAt: THU,
  location: 'У Жени',
  cancelled: false,
  ...over,
});

describe('announceSnapshot / parseSnapshot', () => {
  it('нормализует время и место из строки вечера', () => {
    expect(
      announceSnapshot({
        scheduled_at: '2026-10-08T16:00:00+00:00',
        location: '  У Жени ',
        status: 'announced',
      }),
    ).toEqual(snap());
    expect(announceSnapshot({ scheduled_at: THU, location: '   ', status: 'cancelled' })).toEqual(
      snap({ location: null, cancelled: true }),
    );
  });

  it('снимок из jsonb: формат SQL-заполнения миграции и кривые значения', () => {
    expect(
      parseSnapshot({
        scheduledAt: '2026-10-08T16:00:00.000Z',
        location: 'У Жени',
        cancelled: false,
      }),
    ).toEqual(snap());
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ scheduledAt: 'вчера', location: null, cancelled: false })).toBeNull();
    expect(parseSnapshot({ scheduledAt: THU, location: 5, cancelled: false })).toBeNull();
    expect(parseSnapshot({ scheduledAt: THU, location: null })).toBeNull();
  });

  it('одно и то же время в разной записи — без изменений', () => {
    expect(sameSnapshot(snap(), snap({ scheduledAt: '2026-10-08T19:00:00+03:00' }))).toBe(true);
  });
});

describe('decideAnnounceChange', () => {
  it('сохранение без изменения даты и места — без поста', () => {
    expect(decideAnnounceChange(snap(), snap(), NOW)).toEqual({ action: 'none' });
  });

  it('новое время или место будущего вечера — «перенесён»', () => {
    expect(decideAnnounceChange(snap(), snap({ scheduledAt: FRI }), NOW)).toEqual({
      action: 'post',
      change: 'moved',
    });
    expect(decideAnnounceChange(snap(), snap({ location: 'У Саши' }), NOW)).toEqual({
      action: 'post',
      change: 'moved',
    });
  });

  it('несколько правок подряд: сравнение всегда с тем, что знает группа', () => {
    // Первая правка ушла постом — группа знает пятницу; вернули четверг — снова пост.
    const known = snap({ scheduledAt: FRI });
    expect(decideAnnounceChange(known, snap(), NOW)).toEqual({ action: 'post', change: 'moved' });
    // Правка и обратная правка до поста — группе сообщать нечего.
    expect(decideAnnounceChange(snap(), snap(), NOW)).toEqual({ action: 'none' });
  });

  it('отмена будущего вечера — пост; отмена прошедшего — молча', () => {
    expect(decideAnnounceChange(snap(), snap({ cancelled: true }), NOW)).toEqual({
      action: 'post',
      change: 'cancelled',
    });
    const past = snap({ scheduledAt: '2026-10-01T16:00:00.000Z' });
    expect(decideAnnounceChange(past, { ...past, cancelled: true }, NOW)).toEqual({
      action: 'silent',
    });
  });

  it('возврат отменённого — «всё-таки состоится»; правка отменённого — молча', () => {
    const cancelled = snap({ cancelled: true });
    expect(decideAnnounceChange(cancelled, snap({ scheduledAt: FRI }), NOW)).toEqual({
      action: 'post',
      change: 'restored',
    });
    expect(
      decideAnnounceChange(cancelled, snap({ cancelled: true, location: 'У Саши' }), NOW),
    ).toEqual({
      action: 'silent',
    });
  });

  it('перенос в прошлое и неизвестное прошлое — без поста', () => {
    expect(
      decideAnnounceChange(snap(), snap({ scheduledAt: '2026-10-05T16:00:00.000Z' }), NOW),
    ).toEqual({ action: 'silent' });
    expect(decideAnnounceChange(null, snap(), NOW)).toEqual({ action: 'silent' });
  });
});

describe('посты о переносе, отмене и возврате', () => {
  const input = (over: Partial<AnnounceChangePostInput> = {}): AnnounceChangePostInput => ({
    eveningId: 'e1',
    before: snap(),
    after: snap({ scheduledAt: FRI, location: 'У Саши <дача>' }),
    reason: null,
    botUsername: 'club_bot',
    ...over,
  });
  // Даты склеены неразрывным пробелом — для сравнения заменяем обычным.
  const plain = (text: string) => text.replace(/ /g, ' ');
  const emoji = /\p{Extended_Pictographic}/gu;
  const suits = new Set(['♠', '♣', '♥', '♦']);

  it('перенос: новое время и место с прежними, кнопка на вечер', () => {
    const post = announceChangePost('moved', input());
    expect(plain(post.text)).toBe(
      [
        '♠️ <b>Вечер перенесён</b>',
        'Новое время: в пятницу, 9 октября, в 20:00 (было 8 октября, 19:00).',
        'Новое место: У Саши &lt;дача&gt; (было У Жени).',
        '',
        'Если планы поменялись, обновите ответ «иду / не иду».',
      ].join('\n'),
    );
    expect(post.buttons).toEqual([
      { text: '♣️ Иду / не иду', url: expect.stringContaining('startapp=e_e1') },
    ]);
  });

  it('перенос только места — время повторяется', () => {
    const text = plain(
      announceChangePost('moved', input({ after: snap({ location: 'У Саши' }) })).text,
    );
    expect(text).toContain('Время то же: в четверг, 8 октября, в 19:00.');
    expect(text).toContain('Новое место: У Саши (было У Жени).');
  });

  it('отмена: дата из анонса и причина отмены', () => {
    const post = announceChangePost(
      'cancelled',
      input({ after: snap({ cancelled: true }), reason: 'Не собрали состав' }),
    );
    expect(plain(post.text)).toBe('♠️ <b>Вечер 8 октября отменён</b>\nПричина: Не собрали состав');
    expect(post.buttons).toEqual([]);
    expect(plain(announceChangePost('cancelled', input({ reason: '  ' })).text)).toBe(
      '♠️ <b>Вечер 8 октября отменён</b>',
    );
  });

  it('возврат: новые данные и кнопка', () => {
    const post = announceChangePost('restored', input({ before: snap({ cancelled: true }) }));
    expect(plain(post.text)).toContain('♠️ <b>Вечер 9 октября всё-таки состоится</b>');
    expect(plain(post.text)).toContain('Приходите в пятницу, 9 октября, в 20:00.');
    expect(post.buttons).toHaveLength(1);
  });

  it('без эмодзи, кроме мастей, и без восклицаний', () => {
    for (const change of ['moved', 'cancelled', 'restored'] as const) {
      const text = announceChangePost(change, input({ reason: 'Заболел банкир' })).text;
      const found = [...text.matchAll(emoji)].map((m) => m[0]).filter((c) => !suits.has(c));
      expect(found).toEqual([]);
      expect(text).not.toContain('!');
    }
  });
});
