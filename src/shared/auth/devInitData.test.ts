// Dev-подпись initData должна проходить ту же проверку, что делает tg-auth. Проверяем её
// отдельной реализацией проверки (разбор строки → data_check_string → HMAC), а не тем же кодом,
// что подписывал. WebCrypto, а не node:crypto: тесты в src типизируются без @types/node.
// Совместимость с node:crypto проверена вручную через scripts/dev-initdata.mjs.
import { describe, expect, it } from 'vitest';
import { buildDevInitData, dataCheckString, DEV_PLAYERS } from './devInitData';

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
}

async function verify(initData: string, botToken: string): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dcs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const calc = Array.from(new Uint8Array(await hmac(secret, dcs)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return calc === hash;
}

describe('buildDevInitData', () => {
  const token = '123456:TEST-fake-token';
  const user = DEV_PLAYERS[0]!;

  it('подписывает так, что проверка по алгоритму Telegram проходит', async () => {
    const initData = await buildDevInitData({ user, botToken: token, authDate: 1_790_000_000 });
    expect(await verify(initData, token)).toBe(true);
  });

  it('не проходит проверку с другим токеном', async () => {
    const initData = await buildDevInitData({ user, botToken: token });
    expect(await verify(initData, 'other-token')).toBe(false);
  });

  it('кладёт пользователя, auth_date и start_param; лишних полей в user нет', async () => {
    const initData = await buildDevInitData({
      user,
      botToken: token,
      authDate: 1_790_000_000,
      startParam: 'e_0f0e0d0c-0000-4000-8000-000000000001',
    });
    const params = new URLSearchParams(initData);
    expect(params.get('auth_date')).toBe('1790000000');
    expect(params.get('start_param')).toBe('e_0f0e0d0c-0000-4000-8000-000000000001');
    const parsed = JSON.parse(params.get('user') ?? '{}') as Record<string, unknown>;
    expect(parsed).toMatchObject({ id: 1001, first_name: 'Женя', username: 'zhenya_local' });
    expect(parsed).not.toHaveProperty('note');
    expect(await verify(initData, token)).toBe(true);
  });

  it('dataCheckString сортирует ключи и пропускает hash', () => {
    expect(dataCheckString({ user: 'u', hash: 'h', auth_date: '1', query_id: 'q' })).toBe(
      'auth_date=1\nquery_id=q\nuser=u',
    );
  });
});
