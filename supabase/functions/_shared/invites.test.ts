// Вход по ссылке-приглашению (tg-auth, миграция 029): разбор ответа redeem_player_invite, тексты
// отказов и сверка констант домена с SQL миграции — срок, длина кода, его форма.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INVITE_CODE_RE, INVITE_TTL_DAYS } from './domain/invite.ts';
import { INVITE_DENIALS, parseRedeemResult } from './invites.ts';

const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/029_player_invites.sql', import.meta.url)),
  'utf8',
);

describe('parseRedeemResult', () => {
  it('ok — с игроком', () => {
    expect(parseRedeemResult({ outcome: 'ok', playerId: 'p1' })).toEqual({
      outcome: 'ok',
      playerId: 'p1',
    });
  });

  it('отказы — без игрока', () => {
    for (const outcome of ['inactive', 'unknown', 'used', 'expired', 'revoked'] as const) {
      expect(parseRedeemResult({ outcome })).toEqual({ outcome, playerId: null });
    }
  });

  it('неожиданная форма — ошибка, а не вход наугад', () => {
    expect(() => parseRedeemResult(null)).toThrow();
    expect(() => parseRedeemResult('ok')).toThrow();
    expect(() => parseRedeemResult({})).toThrow();
    expect(() => parseRedeemResult({ outcome: 'welcome' })).toThrow();
    expect(() => parseRedeemResult({ outcome: 'ok' })).toThrow();
    expect(() => parseRedeemResult({ outcome: 'ok', playerId: 42 })).toThrow();
  });
});

describe('отказы по приглашению', () => {
  it('у каждого исхода свой код invite_*', () => {
    expect(INVITE_DENIALS.used.code).toBe('invite_used');
    expect(INVITE_DENIALS.expired.code).toBe('invite_expired');
    expect(INVITE_DENIALS.revoked.code).toBe('invite_revoked');
    expect(INVITE_DENIALS.unknown.code).toBe('invite_unknown');
  });

  it('текст говорит, что делать, — на «ты», без рода и без подробностей о чужом входе', () => {
    for (const { message } of Object.values(INVITE_DENIALS)) {
      expect(message).toMatch(/Попроси у админа новую ссылку\.$/);
      // О людях — без рода: «вошли», «отозвали» (множественное), а не «вошёл» / «отозвал».
      expect(message).not.toMatch(/вош(ёл|ла)|отозвала?(?![а-яё])|использовала?(?![а-яё])/iu);
      // Ни дат, ни имён, ни кода.
      expect(message).not.toMatch(/\d/);
    }
  });
});

describe('домен и миграция 029 — одно правило', () => {
  it('срок: interval в create_player_invite = INVITE_TTL_DAYS', () => {
    const days = /now\(\) \+ interval '(\d+) days'/.exec(migration)?.[1];
    expect(Number(days)).toBe(INVITE_TTL_DAYS);
  });

  it('код: 24 случайных байта → 32 знака base64url, как INVITE_CODE_RE', () => {
    const bytes = Number(/gen_random_bytes\((\d+)\)/.exec(migration)?.[1]);
    // base64 без «=»: 3 байта → 4 знака; 24 байта делятся на 3 — паддинга нет.
    expect(bytes % 3).toBe(0);
    expect((bytes / 3) * 4).toBe(32);
    expect(bytes * 8).toBeGreaterThanOrEqual(128);
    expect(migration).toContain(`p_code !~ '^[A-Za-z0-9_-]{32}$'`);
    expect(INVITE_CODE_RE.source).toBe('^[A-Za-z0-9_-]{32}$');
  });
});
