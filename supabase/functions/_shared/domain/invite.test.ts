import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_RE,
  INVITE_PARAM_PREFIX,
  inviteCodeOf,
  inviteStartParam,
  isInviteParam,
} from './invite.ts';

// Код — как его собирает create_player_invite: 24 байта в base64 без «=», «+/» → «-_».
const CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz01-_9Z';

describe('ссылка-приглашение', () => {
  it('код — 32 знака base64url', () => {
    expect(CODE).toHaveLength(32);
    expect(INVITE_CODE_RE.test(CODE)).toBe(true);
    expect(INVITE_CODE_RE.test(CODE.slice(1))).toBe(false);
    expect(INVITE_CODE_RE.test(`${CODE}x`)).toBe(false);
    expect(INVITE_CODE_RE.test(`${CODE.slice(1)}+`)).toBe(false);
    expect(INVITE_CODE_RE.test(`${CODE.slice(1)}=`)).toBe(false);
  });

  it('параметр запуска i_<код> укладывается в startapp (A-Z a-z 0-9 _ -, до 64 знаков)', () => {
    const param = inviteStartParam(CODE);
    expect(param).toBe(`i_${CODE}`);
    expect(param.startsWith(INVITE_PARAM_PREFIX)).toBe(true);
    expect(/^[A-Za-z0-9_-]{1,64}$/.test(param)).toBe(true);
  });

  it('код не по форме в ссылку не попадает', () => {
    expect(() => inviteStartParam('короткий')).toThrow();
    expect(() => inviteStartParam(`${CODE.slice(1)}/`)).toThrow();
  });

  it('разбор параметра: не приглашение — undefined, кривое — null, иначе код', () => {
    expect(inviteCodeOf(null)).toBeUndefined();
    expect(inviteCodeOf(undefined)).toBeUndefined();
    expect(inviteCodeOf('')).toBeUndefined();
    expect(inviteCodeOf('e_0f0e0d0c-0000-4000-8000-000000000001')).toBeUndefined();
    expect(inviteCodeOf('r')).toBeUndefined();
    expect(inviteCodeOf('i_')).toBeNull();
    expect(inviteCodeOf(`i_${CODE.slice(0, 20)}`)).toBeNull();
    expect(inviteCodeOf(`i_${CODE}x`)).toBeNull();
    expect(inviteCodeOf(`i_${CODE}`)).toBe(CODE);
    expect(inviteCodeOf(inviteStartParam(CODE))).toBe(CODE);
  });

  it('isInviteParam — любая форма i_…', () => {
    expect(isInviteParam(`i_${CODE}`)).toBe(true);
    expect(isInviteParam('i_')).toBe(true);
    expect(isInviteParam('i')).toBe(false);
    expect(isInviteParam(null)).toBe(false);
  });
});
