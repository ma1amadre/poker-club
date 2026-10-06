// Проверка initData по алгоритму Telegram (core.telegram.org/bots/webapps). Запускается vitest-ом
// из корня под Node: WebCrypto там встроенный, Deno не нужен.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDevInitData } from '../../../src/shared/auth/devInitData.ts';
import {
  dataCheckString,
  escapeHtml,
  isChatMember,
  miniAppLink,
  redactBotToken,
  sendMessage,
  signInitDataFields,
  telegramDisplayName,
  timingSafeEqual,
  validateInitData,
} from './telegram.ts';

const TOKEN = '123456:LOCAL_FAKE_TOKEN';
const NOW = 1_791_000_000; // фиксированное «сейчас», секунды
const DAY = 24 * 60 * 60;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** initData, подписанный так же, как это делает Telegram. */
async function signed(fields: Record<string, string>, token = TOKEN): Promise<string> {
  const params = new URLSearchParams(fields);
  params.set('hash', toHex(await signInitDataFields(fields, token)));
  return params.toString();
}

const user = { id: 1001, first_name: 'Женя', username: 'zhenya_local', language_code: 'ru' };
const baseFields = (authDate = NOW - 60): Record<string, string> => ({
  auth_date: String(authDate),
  query_id: 'AAE-test',
  user: JSON.stringify(user),
});

describe('validateInitData', () => {
  it('принимает корректную подпись и разбирает пользователя', async () => {
    const res = await validateInitData(
      await signed({ ...baseFields(), start_param: 'e_abc' }),
      TOKEN,
      DAY,
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.user).toEqual(user);
    expect(res.data.authDate).toBe(NOW - 60);
    expect(res.data.startParam).toBe('e_abc');
    expect(res.data.queryId).toBe('AAE-test');
  });

  it('отвергает подменённое поле', async () => {
    const initData = await signed(baseFields());
    const forged = new URLSearchParams(initData);
    forged.set('user', JSON.stringify({ ...user, id: 1002 }));
    expect(await validateInitData(forged.toString(), TOKEN, DAY, NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
  });

  it('отвергает добавленное поле', async () => {
    const forged = new URLSearchParams(await signed(baseFields()));
    forged.set('start_param', 'v_hack');
    expect(await validateInitData(forged.toString(), TOKEN, DAY, NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
  });

  it('отвергает подпись чужим токеном', async () => {
    const initData = await signed(baseFields(), '654321:OTHER_TOKEN');
    expect(await validateInitData(initData, TOKEN, DAY, NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
  });

  it('отвергает просроченный auth_date и пропускает свежий на границе', async () => {
    const old = await signed(baseFields(NOW - DAY - 1));
    expect(await validateInitData(old, TOKEN, DAY, NOW)).toEqual({ ok: false, error: 'expired' });
    const edge = await signed(baseFields(NOW - DAY));
    expect((await validateInitData(edge, TOKEN, DAY, NOW)).ok).toBe(true);
  });

  it('отвергает auth_date из будущего сверх допуска на часы', async () => {
    const future = await signed(baseFields(NOW + 3600));
    expect(await validateInitData(future, TOKEN, DAY, NOW)).toEqual({
      ok: false,
      error: 'bad_auth_date',
    });
  });

  it('без hash, с битым hash и с повтором ключа — отказ', async () => {
    const params = new URLSearchParams(baseFields());
    expect(await validateInitData(params.toString(), TOKEN, DAY, NOW)).toEqual({
      ok: false,
      error: 'missing_hash',
    });
    params.set('hash', 'zz');
    expect(await validateInitData(params.toString(), TOKEN, DAY, NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
    const dup = `${await signed(baseFields())}&auth_date=${NOW}`;
    expect(await validateInitData(dup, TOKEN, DAY, NOW)).toEqual({ ok: false, error: 'malformed' });
    expect(await validateInitData('', TOKEN, DAY, NOW)).toEqual({ ok: false, error: 'malformed' });
  });

  it('поле signature входит в строку проверки (исключается только hash)', async () => {
    const fields = { ...baseFields(), signature: 'ed25519-signature-for-third-parties' };
    expect(dataCheckString({ ...fields, hash: 'x' })).toContain('signature=ed25519');
    expect((await validateInitData(await signed(fields), TOKEN, DAY, NOW)).ok).toBe(true);
  });

  it('подпись без пользователя — отказ bad_user', async () => {
    const res = await validateInitData(await signed({ auth_date: String(NOW) }), TOKEN, DAY, NOW);
    expect(res).toEqual({ ok: false, error: 'bad_user' });
  });

  it('совпадает с подписью dev-входа фронта (src/shared/auth/devInitData.ts)', async () => {
    const initData = await buildDevInitData({
      user: { id: 1003, first_name: 'Дима', username: 'dima_local' },
      botToken: TOKEN,
      authDate: NOW - 5,
      startParam: 'r',
    });
    const res = await validateInitData(initData, TOKEN, DAY, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user.id).toBe(1003);
      expect(res.data.startParam).toBe('r');
    }
  });

  // Скрипт пишет другая часть проекта; пока его нет — кейс пропускается.
  const devScript = fileURLToPath(new URL('../../../scripts/dev-initdata.mjs', import.meta.url));
  it.skipIf(!existsSync(devScript))('совпадает с подписью scripts/dev-initdata.mjs', async () => {
    const mod = (await import(/* @vite-ignore */ devScript)) as {
      signInitData: (fields: Record<string, string>, botToken: string) => string;
    };
    const fields = { ...baseFields(NOW), start_param: 'v_x' };
    const initData = mod.signInitData(fields, TOKEN);
    // Та же подпись байт в байт, что и у нас, — а значит, и у Telegram.
    expect(initData).toBe(await signed(fields));
    expect((await validateInitData(initData, TOKEN, DAY, NOW)).ok).toBe(true);
    expect(
      await validateInitData(mod.signInitData(fields, 'другой:токен'), TOKEN, DAY, NOW),
    ).toEqual({
      ok: false,
      error: 'bad_hash',
    });
  });
});

describe('утилиты', () => {
  it('timingSafeEqual', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('escapeHtml экранирует разметку в именах', () => {
    expect(escapeHtml('<b>Вася</b> & "Ко"')).toBe('&lt;b&gt;Вася&lt;/b&gt; &amp; &quot;Ко&quot;');
  });

  it('miniAppLink строит прямую ссылку и отвергает мусор в параметре', () => {
    const id = 'e0000000-0000-4000-8000-000000000006';
    expect(miniAppLink('@poker_club_local_bot', `e_${id}`)).toBe(
      `https://t.me/poker_club_local_bot?startapp=e_${id}`,
    );
    expect(miniAppLink('poker_club_local_bot')).toBe('https://t.me/poker_club_local_bot?startapp');
    expect(() => miniAppLink('poker_club_local_bot', 'a&b=c')).toThrow();
  });

  it('telegramDisplayName склеивает имя и режет до 40 символов', () => {
    expect(telegramDisplayName({ id: 1, first_name: ' Женя ', last_name: 'К.' })).toBe('Женя К.');
    expect(telegramDisplayName({ id: 1, first_name: '', username: 'nick' })).toBe('@nick');
    expect(telegramDisplayName({ id: 7, first_name: '' })).toBe('Игрок 7');
    expect(Array.from(telegramDisplayName({ id: 1, first_name: 'Я'.repeat(60) }))).toHaveLength(40);
  });

  it('isChatMember по статусам getChatMember', () => {
    expect(isChatMember({ status: 'member' })).toBe(true);
    expect(isChatMember({ status: 'creator' })).toBe(true);
    expect(isChatMember({ status: 'administrator' })).toBe(true);
    expect(isChatMember({ status: 'restricted', is_member: true })).toBe(true);
    expect(isChatMember({ status: 'restricted', is_member: false })).toBe(false);
    expect(isChatMember({ status: 'left' })).toBe(false);
    expect(isChatMember({ status: 'kicked' })).toBe(false);
  });
});

describe('sendMessage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('в dry-run пишет в лог и не ходит в сеть', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await sendMessage(-100, '<b>Тест</b>', {
      buttons: [{ text: 'Открыть', url: 'https://t.me/x?startapp=r' }],
    });
    expect(res).toEqual({ messageId: 0, dryRun: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });

  it('без dry-run шлёт HTML с URL-кнопками в Bot API', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const res = await sendMessage(-100, 'текст', {
      buttons: [{ text: 'Открыть', url: 'https://t.me/x?startapp=r' }],
    });
    expect(res).toEqual({ messageId: 42, dryRun: false });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      chat_id: -100,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: 'https://t.me/x?startapp=r' }]] },
    });
  });

  it('ошибку Bot API пробрасывает исключением', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, error_code: 400, description: 'chat not found' }),
            { status: 400 },
          ),
      ),
    );
    await expect(sendMessage(-100, 'текст')).rejects.toThrow(/chat not found/);
  });

  it('сетевая ошибка fetch не выносит токен из URL', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    // Так Deno описывает DNS/TCP-сбой: URL запроса целиком, вместе с токеном.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        throw new TypeError(
          `error sending request for url (${url}): client error (Connect): dns error`,
        );
      }),
    );
    const err = await sendMessage(-100, 'текст').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/^Telegram sendMessage: сеть: TypeError: /);
    expect(err?.message).toContain('/bot<token>/sendMessage');
    expect(err?.message).not.toContain('LOCAL_FAKE_TOKEN');
    expect(err?.cause).toBeUndefined();
  });
});

describe('redactBotToken', () => {
  it('вырезает токен как есть, percent-encoded и любой сегмент /bot…/', () => {
    expect(redactBotToken(`x https://api.telegram.org/bot${TOKEN}/getMe y`, TOKEN)).toBe(
      'x https://api.telegram.org/bot<token>/getMe y',
    );
    expect(redactBotToken(`url /bot${encodeURIComponent(TOKEN)}/getMe`, TOKEN)).toBe(
      'url /bot<token>/getMe',
    );
    expect(redactBotToken('(https://api.telegram.org/bot999:OTHER/getUpdates)', TOKEN)).toBe(
      '(https://api.telegram.org/bot<token>/getUpdates)',
    );
    expect(redactBotToken(`голый ${TOKEN}`, TOKEN)).toBe('голый <token>');
  });
});
