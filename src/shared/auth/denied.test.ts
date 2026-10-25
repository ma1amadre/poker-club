import { describe, expect, it } from 'vitest';
import { ACCESS_DENIALS } from '../../../supabase/functions/_shared/access.ts';
import { INVITE_DENIALS } from '../../../supabase/functions/_shared/invites.ts';
import { DENIED_TITLES, deniedOf, SIGNATURE_TEXT, type DeniedKind } from './denied';

describe('deniedOf — отказ tg-auth → экран «нет доступа»', () => {
  it('коды приглашения — один экран «Ссылка-приглашение не сработала»', () => {
    for (const code of ['invite_used', 'invite_expired', 'invite_revoked', 'invite_unknown']) {
      const [kind, fallback] = deniedOf(code);
      expect(kind).toBe('invite');
      expect(fallback).toMatch(/Попроси у админа новую ссылку/);
    }
  });

  it('inactive, no_group и остальное — как раньше', () => {
    expect(deniedOf('inactive')[0]).toBe('inactive');
    expect(deniedOf('no_group')[0]).toBe('no_group');
    expect(deniedOf('not_member')[0]).toBe('not_member');
    expect(deniedOf(undefined)[0]).toBe('not_member');
  });

  it('без группы и не участнику подсказывает ссылку-приглашение', () => {
    expect(deniedOf('no_group')[1]).toMatch(/ссылке-приглашению/);
    expect(deniedOf('not_member')[1]).toMatch(/ссылку-приглашение/);
  });
});

describe('экран «нет доступа»: текст под заголовком его не повторяет', () => {
  // Находка ревью: экран ставит заголовок и текст функции подряд, а текст not_member и no_group
  // начинался дословно с заголовка («Вход только для участников клуба. Вход только для…»).
  const texts: [DeniedKind, string][] = [
    ['not_member', ACCESS_DENIALS.not_member],
    ['no_group', ACCESS_DENIALS.no_group],
    ['inactive', ACCESS_DENIALS.inactive],
    ...Object.values(INVITE_DENIALS).map((d): [DeniedKind, string] => ['invite', d.message]),
    ['signature', SIGNATURE_TEXT],
    // Запасные тексты клиента — на ответ без тела.
    ...['not_member', 'no_group', 'inactive', 'invite_used', undefined].map(
      (code): [DeniedKind, string] => {
        const [kind, text] = deniedOf(code);
        return [kind as DeniedKind, text];
      },
    ),
  ];

  it.each(texts)('%s: «%s»', (kind, text) => {
    const title = DENIED_TITLES[kind].toLowerCase();
    expect(text.toLowerCase().startsWith(title)).toBe(false);
    expect(text.toLowerCase()).not.toContain(title);
  });
});
