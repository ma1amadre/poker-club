// Право войти в tg-auth (access.ts): порядок проверок, когда спрашиваем Telegram и когда тратим код.
import { describe, expect, it, vi } from 'vitest';
import { decideAccess, type KnownPlayer, type Membership } from './access.ts';

const CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz01-_9Z';
const INVITE = `i_${CODE}`;

const member: KnownPlayer = { is_active: true, joined_by_invite: false };
const invited: KnownPlayer = { is_active: true, joined_by_invite: true };

/** Проверка группы с заданным ответом; считает вызовы (каждый — запрос в Telegram). */
const group = (answer: Membership | Error) =>
  vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));

const decide = (
  over: Partial<Parameters<typeof decideAccess>[0]> & {
    membership: Parameters<typeof decideAccess>[0]['membership'];
  },
) => decideAccess({ isAdminTg: false, player: null, startParam: null, ...over });

describe('decideAccess — без запроса в Telegram', () => {
  it('админ входит всегда, код из ссылки не тратится', async () => {
    const membership = group(new Error('Telegram лежит'));
    await expect(decide({ isAdminTg: true, startParam: INVITE, membership })).resolves.toEqual({
      kind: 'allow',
    });
    expect(membership).not.toHaveBeenCalled();
  });

  it('вошедший по приглашению — сам, пока профиль включён; отключённый — inactive', async () => {
    const membership = group('not_member');
    await expect(decide({ player: invited, membership })).resolves.toEqual({ kind: 'allow' });
    await expect(
      decide({ player: { ...invited, is_active: false }, startParam: INVITE, membership }),
    ).resolves.toEqual({ kind: 'deny', code: 'inactive' });
    expect(membership).not.toHaveBeenCalled();
  });
});

describe('decideAccess — по группе и по ссылке', () => {
  it('участник группы входит по группе, код из ссылки цел', async () => {
    for (const player of [null, member]) {
      await expect(
        decide({ player, startParam: INVITE, membership: group('member') }),
      ).resolves.toEqual({ kind: 'allow' });
    }
  });

  it('не участник или группа не задана — по коду из ссылки', async () => {
    for (const answer of ['not_member', 'no_group'] as const) {
      await expect(decide({ startParam: INVITE, membership: group(answer) })).resolves.toEqual({
        kind: 'redeem',
        code: CODE,
      });
    }
    // Ссылка обрезана — всё равно попытка по коду: tg-auth ответит invite_unknown.
    await expect(
      decide({ startParam: 'i_short', membership: group('not_member') }),
    ).resolves.toEqual({ kind: 'redeem', code: null });
  });

  it('без ссылки — отказ: not_member или no_group', async () => {
    await expect(decide({ membership: group('not_member') })).resolves.toEqual({
      kind: 'deny',
      code: 'not_member',
    });
    await expect(decide({ startParam: 'e_123', membership: group('no_group') })).resolves.toEqual({
      kind: 'deny',
      code: 'no_group',
    });
  });

  it('Telegram не ответил — ошибка наружу, код не тратится ни на участника, ни на новичка', async () => {
    // Находка ревью: раньше сбой проверки группы со ссылкой в start_param считался «не участник» —
    // и код сгорал на участнике группы, а тот получал пометку «по приглашению» навсегда.
    const down = new Error('Telegram getChatMember: 429 Too Many Requests');
    for (const player of [null, member]) {
      await expect(decide({ player, startParam: INVITE, membership: group(down) })).rejects.toBe(
        down,
      );
    }
  });
});
