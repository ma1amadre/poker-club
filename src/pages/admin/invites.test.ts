import { describe, expect, it } from 'vitest';
import type { PlayerInvite } from '../../shared/api';
import {
  groupInvites,
  inviteRow,
  inviteShareText,
  inviteShareUrl,
  inviteStatusAt,
  inviteTermNote,
} from './invites';

const NOW = '2026-10-25T19:00:00Z'; // 22:00 МСК

const invite = (over: Partial<PlayerInvite> & Pick<PlayerInvite, 'id'>): PlayerInvite => ({
  status: 'active',
  createdAt: '2026-10-25T19:10:00Z',
  expiresAt: '2026-11-01T19:10:00Z',
  usedAt: null,
  usedBy: null,
  usedByName: null,
  revokedAt: null,
  ...over,
});

const LINK = 'https://t.me/club_bot?startapp=i_AbCdEfGhIjKlMnOpQrStUvWxYz01-_9Z';

describe('подписи приглашения', () => {
  it('срок под ссылкой: одному человеку, 7 дней, до какого момента по Москве', () => {
    expect(inviteTermNote('2026-11-01T19:10:00Z', NOW)).toBe(
      'Одному человеку, действует 7 дней — до 1 ноября, 22:10.',
    );
  });

  it('другой год — с годом', () => {
    expect(inviteTermNote('2027-01-01T09:00:00Z', NOW)).toMatch(/до 1 января 2027 г\., 12:00\.$/);
  });

  it('текст сообщения — на «ты», без рода, с ограничениями ссылки', () => {
    const text = inviteShareText('2026-11-01T19:10:00Z', NOW);
    expect(text).toMatch(/^Приглашение в покерный клуб: открой ссылку/);
    expect(text).toContain('сработает один раз, до 1 ноября, 22:10');
  });

  it('«Поделиться» — t.me/share/url, url и text закодированы', () => {
    const url = new URL(inviteShareUrl(LINK, '2026-11-01T19:10:00Z', NOW));
    expect(url.origin + url.pathname).toBe('https://t.me/share/url');
    expect(url.searchParams.get('url')).toBe(LINK);
    expect(url.searchParams.get('text')).toBe(inviteShareText('2026-11-01T19:10:00Z', NOW));
    // В адресе — ни одного «?»/«&» ссылки в открытом виде: иначе startapp ушёл бы параметром share.
    expect(inviteShareUrl(LINK, '2026-11-01T19:10:00Z', NOW)).not.toContain('startapp=i_');
  });
});

describe('статус и группы', () => {
  it('действующее с прошедшим сроком — истёкшее, не дожидаясь перечитывания', () => {
    const a = invite({ id: 'a', expiresAt: '2026-10-25T18:59:59Z' });
    expect(inviteStatusAt(a, NOW)).toBe('expired');
    expect(inviteStatusAt(invite({ id: 'b' }), NOW)).toBe('active');
    expect(inviteStatusAt(invite({ id: 'c', status: 'used' }), '2030-01-01T00:00:00Z')).toBe(
      'used',
    );
  });

  it('действуют — ближе к концу срока выше; вошли — свежие выше; закрытые — по моменту закрытия', () => {
    const groups = groupInvites(
      [
        invite({ id: 'late', expiresAt: '2026-11-01T20:00:00Z' }),
        invite({ id: 'soon', expiresAt: '2026-10-28T10:00:00Z' }),
        invite({ id: 'stale', expiresAt: '2026-10-25T18:00:00Z' }),
        invite({ id: 'u-old', status: 'used', usedAt: '2026-10-20T10:00:00Z', usedByName: 'Оля' }),
        invite({ id: 'u-new', status: 'used', usedAt: '2026-10-24T10:00:00Z', usedByName: 'Петя' }),
        invite({ id: 'rev', status: 'revoked', revokedAt: '2026-10-25T10:00:00Z' }),
        invite({ id: 'exp', status: 'expired', expiresAt: '2026-10-22T10:00:00Z' }),
      ],
      NOW,
    );
    expect(groups.active.map((i) => i.id)).toEqual(['soon', 'late']);
    expect(groups.used.map((i) => i.id)).toEqual(['u-new', 'u-old']);
    expect(groups.closed.map((i) => i.id)).toEqual(['stale', 'rev', 'exp']);
    expect(groups.closed[0]?.status).toBe('expired');
  });
});

describe('строка списка', () => {
  it('действует — до какого момента и когда создана', () => {
    expect(inviteRow(invite({ id: 'a' }), NOW)).toEqual({
      title: 'До 1 ноября, 22:10',
      subtitle: 'Создана 25 октября, 22:10',
    });
  });

  it('вошли — кто и когда; профиль удалён — так и сказано', () => {
    expect(
      inviteRow(
        invite({ id: 'a', status: 'used', usedAt: '2026-10-26T09:00:00Z', usedByName: 'Оля' }),
        NOW,
      ),
    ).toEqual({ title: 'Оля', subtitle: 'Вход по ссылке 26 октября, 12:00' });
    expect(
      inviteRow(invite({ id: 'a', status: 'used', usedAt: '2026-10-26T09:00:00Z' }), NOW).title,
    ).toBe('Профиль удалён');
  });

  it('отозвана и истекла', () => {
    expect(
      inviteRow(invite({ id: 'a', status: 'revoked', revokedAt: '2026-10-25T18:30:00Z' }), NOW)
        .title,
    ).toBe('Отозвана 25 октября, 21:30');
    expect(
      inviteRow(invite({ id: 'a', status: 'expired', expiresAt: '2026-10-24T18:30:00Z' }), NOW)
        .title,
    ).toBe('Истекла 24 октября, 21:30');
  });
});
