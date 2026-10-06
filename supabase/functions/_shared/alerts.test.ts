// Оповещения админа о сбоях (alerts.ts): троттлинг, дедупликация и текст сообщения.
// Журнал — в памяти с тем же compare-and-set, что у public.admin_alerts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_WINDOW_MS,
  alertAdmin,
  alertKey,
  alertText,
  decideAlert,
  FALLBACK_WINDOW_MS,
  functionLogsUrl,
  projectRefFromUrl,
  redactSecrets,
  resetFallbackThrottle,
  summarizeError,
  type AlertState,
  type AlertStore,
} from './alerts.ts';
import { TelegramApiError, TelegramNetworkError } from './telegram.ts';

const HOUR = 60 * 60 * 1000;
// 07.10.2026 11:15 UTC = 14:15 МСК.
const NOW = Date.UTC(2026, 9, 7, 11, 15);
const TOKEN = '123456:LOCAL_FAKE_TOKEN';
const REAL_LOOKING_TOKEN = '7234567890:AAHk3x9_Zq-8bWfLr2mNcVd4TeYuIoP1sAz';

/** Журнал в памяти. Каждый вызов уступает очередь (await), чтобы параллельные вызовы чередовались. */
class MemoryStore implements AlertStore {
  rows = new Map<string, AlertState>();
  failGet = false;

  async get(key: string): Promise<AlertState | null> {
    await Promise.resolve();
    if (this.failGet) throw new Error('permission denied for table admin_alerts');
    const row = this.rows.get(key);
    return row ? { ...row } : null;
  }

  async swap(key: string, expected: AlertState | null, next: AlertState | null): Promise<boolean> {
    await Promise.resolve();
    const cur = this.rows.get(key) ?? null;
    const same =
      cur === null || expected === null
        ? cur === expected
        : cur.lastSentAt === expected.lastSentAt &&
          cur.suppressedCount === expected.suppressedCount;
    if (!same) return false;
    if (next === null) this.rows.delete(key);
    else this.rows.set(key, { ...next });
    return true;
  }
}

const kicked = () =>
  new TelegramApiError(
    'sendMessage',
    403,
    'Forbidden: bot was kicked from the supergroup chat',
    null,
  );

describe('decideAlert', () => {
  it('первый сбой — сообщение без повторов', () => {
    const d = decideAlert(null, NOW);
    expect(d).toEqual({
      send: true,
      repeats: 0,
      next: { lastSentAt: new Date(NOW).toISOString(), suppressedCount: 0 },
    });
  });

  it('в пределах 6 ч — только счётчик, время прошлого сообщения не двигается', () => {
    const prev = { lastSentAt: new Date(NOW).toISOString(), suppressedCount: 2 };
    const d = decideAlert(prev, NOW + ALERT_WINDOW_MS - 1);
    expect(d).toEqual({ send: false, repeats: 3, next: { ...prev, suppressedCount: 3 } });
  });

  it('ровно через 6 ч — снова сообщение с числом повторов, счётчик обнуляется', () => {
    const prev = { lastSentAt: new Date(NOW).toISOString(), suppressedCount: 5 };
    const d = decideAlert(prev, NOW + ALERT_WINDOW_MS);
    expect(d.send).toBe(true);
    expect(d.repeats).toBe(5);
    expect(d.next).toEqual({
      lastSentAt: new Date(NOW + ALERT_WINDOW_MS).toISOString(),
      suppressedCount: 0,
    });
  });

  it('битая или далёкая будущая дата в журнале не глушит алерты', () => {
    expect(decideAlert({ lastSentAt: 'мусор', suppressedCount: 1 }, NOW).send).toBe(true);
    const future = new Date(NOW + 2 * ALERT_WINDOW_MS).toISOString();
    expect(decideAlert({ lastSentAt: future, suppressedCount: 0 }, NOW).send).toBe(true);
  });

  it('окно — 6 часов', () => {
    expect(ALERT_WINDOW_MS).toBe(6 * HOUR);
  });
});

describe('alertKey', () => {
  it('ошибки Telegram — по коду ответа, общие для всех видов; остальное — по виду', () => {
    expect(alertKey('cron_announce', kicked())).toBe('telegram:403');
    expect(alertKey('notify_post', kicked())).toBe('telegram:403');
    expect(alertKey('cron_results', new TelegramNetworkError('sendMessage', 'dns'))).toBe(
      'telegram:network',
    );
    expect(alertKey('cron_schedule', new Error('permission denied'))).toBe('cron_schedule');
  });

  it('400: потеря группы — свои ключи, прочие 400 — по виду сбоя', () => {
    const tg400 = (msg: string) => new TelegramApiError('sendMessage', 400, msg, null);
    const upgraded = tg400('Bad Request: group chat was upgraded to a supergroup chat');
    const notFound = tg400('Bad Request: chat not found');
    const parse = tg400("Bad Request: can't parse entities: Unsupported start tag");
    expect(alertKey('cron_announce', upgraded)).toBe('telegram:400:upgraded');
    expect(alertKey('notify_post', upgraded)).toBe('telegram:400:upgraded');
    expect(alertKey('cron_results', notFound)).toBe('telegram:400:chat_not_found');
    expect(alertKey('cron_results', parse)).toBe('telegram:400:cron_results');
    expect(alertKey('cron_announce', parse)).toBe('telegram:400:cron_announce');
    expect(
      alertKey('cron_announce', new TelegramApiError('sendMessage', 429, 'Too Many', null)),
    ).toBe('telegram:429');
  });
});

describe('текст сообщения', () => {
  const base = {
    kind: 'cron_announce' as const,
    detail: 'вечер 8 октября',
    err: kicked(),
    nowMs: NOW,
    repeats: 0,
    projectRef: 'rgykkewfrefdeyxltzwp',
  };

  it('что сломалось, когда (МСК), что делать, ссылка на логи функции', () => {
    const text = alertText(base);
    expect(text.split('\n')).toEqual([
      '<b>Сбой автоматики клуба</b>',
      'Не ушёл анонс вечера в группу.',
      'Подробности: вечер 8 октября',
      'Причина: Telegram sendMessage: 403 Forbidden: bot was kicked from the supergroup chat',
      'Когда: 7 октября, 14:15 МСК (cron-tick)',
      'Бота удалили из группы клуба или запретили ему писать. Добавь его обратно администратором и отправь проверочное сообщение в «Группа и бот».',
      'Логи: https://supabase.com/dashboard/project/rgykkewfrefdeyxltzwp/functions/cron-tick/logs',
      'О том же сбое напишу снова не раньше чем через 6 ч.',
    ]);
  });

  it('повторы — «ещё N раз с прошлого сообщения» с правильным склонением', () => {
    expect(alertText({ ...base, repeats: 1 })).toContain('Ещё 1 раз с прошлого сообщения.');
    expect(alertText({ ...base, repeats: 3 })).toContain('Ещё 3 раза с прошлого сообщения.');
    expect(alertText({ ...base, repeats: 11 })).toContain('Ещё 11 раз с прошлого сообщения.');
    expect(alertText(base)).not.toContain('с прошлого сообщения');
  });

  it('ошибка не от Telegram — подсказка вида сбоя; без ref — путь к логам словами', () => {
    const text = alertText({
      ...base,
      kind: 'cron_crash',
      detail: '',
      err: { code: '42501', message: 'permission denied for table settings' },
      projectRef: null,
    });
    expect(text).toContain('cron-tick не отработал целиком');
    expect(text).toContain('Причина: 42501 permission denied for table settings');
    expect(text).toContain('нет прав на таблицу');
    expect(text).toContain('Логи: дашборд Supabase → Edge Functions → cron-tick → Logs.');
    expect(text).not.toContain('Подробности:');
  });

  it('notify — ссылка на логи notify', () => {
    const text = alertText({ ...base, kind: 'notify_post' });
    expect(text).toContain('/functions/notify/logs');
  });

  it('разметка из текста ошибки экранируется', () => {
    const text = alertText({ ...base, err: new Error('bad <b>tag</b> & co'), detail: 'a<b' });
    expect(text).toContain('Причина: Error: bad &lt;b&gt;tag&lt;/b&gt; &amp; co');
    expect(text).toContain('Подробности: a&lt;b');
  });

  it('без стектрейса, токенов и ключей; длинная ошибка обрезается', () => {
    const err = new Error(
      `boom https://api.telegram.org/bot${TOKEN}/sendMessage ${REAL_LOOKING_TOKEN}\n    at foo (file.ts:1:1)`,
    );
    const text = alertText({ ...base, err, botToken: TOKEN });
    expect(text).not.toContain('LOCAL_FAKE_TOKEN');
    expect(text).not.toContain(REAL_LOOKING_TOKEN);
    expect(text).not.toContain('at foo');
    expect(text).toContain('/bot&lt;token&gt;/sendMessage &lt;token&gt;');

    const long = summarizeError(new Error('x'.repeat(1000)));
    expect(Array.from(long)).toHaveLength(300);
    expect(long.endsWith('…')).toBe(true);
  });

  it('redactSecrets: ключи Supabase, JWT, строка подключения к БД', () => {
    const out = redactSecrets(
      'k=sb_secret_abcDEF123 jwt=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln db=postgresql://postgres:pw@db.x.supabase.co:5432/postgres',
      '',
    );
    expect(out).toBe('k=<key> jwt=<jwt> db=<db-url>');
  });

  it('ref проекта — из SUPABASE_URL облака; локальный адрес — null', () => {
    expect(projectRefFromUrl('https://rgykkewfrefdeyxltzwp.supabase.co')).toBe(
      'rgykkewfrefdeyxltzwp',
    );
    expect(projectRefFromUrl('https://rgykkewfrefdeyxltzwp.supabase.co/')).toBe(
      'rgykkewfrefdeyxltzwp',
    );
    expect(projectRefFromUrl('http://kong:8000')).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
    expect(functionLogsUrl('abc', 'notify')).toBe(
      'https://supabase.com/dashboard/project/abc/functions/notify/logs',
    );
  });
});

describe('alertAdmin', () => {
  let store: MemoryStore;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new MemoryStore();
    send = vi.fn(async () => undefined);
    resetFallbackThrottle();
    vi.stubEnv('ADMIN_TG_ID', '1001');
    vi.stubEnv('TELEGRAM_DRY_RUN', '');
    vi.stubEnv('SUPABASE_URL', 'https://rgykkewfrefdeyxltzwp.supabase.co');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const call = (
    nowMs: number,
    kind: Parameters<typeof alertAdmin>[1] = 'cron_announce',
    err: unknown = kicked(),
  ) => alertAdmin(null, kind, 'вечер 8 октября', err, { store, nowMs, send });

  it('пишет в личный чат ADMIN_TG_ID; повтор в течение 6 ч не шлёт, а считает', async () => {
    expect(await call(NOW)).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(1001);

    expect(await call(NOW + 15 * 60 * 1000)).toBe('suppressed');
    expect(await call(NOW + 5 * HOUR)).toBe('suppressed');
    expect(send).toHaveBeenCalledOnce();
    expect(store.rows.get('telegram:403')).toEqual({
      lastSentAt: new Date(NOW).toISOString(),
      suppressedCount: 2,
    });

    expect(await call(NOW + 6 * HOUR)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
    expect(String(send.mock.calls[1]?.[1])).toContain('Ещё 2 раза с прошлого сообщения.');
    expect(store.rows.get('telegram:403')?.suppressedCount).toBe(0);
  });

  it('бот выкинут из группы: сбой анонса и notify — одно сообщение', async () => {
    expect(await call(NOW, 'cron_announce')).toBe('sent');
    expect(await call(NOW + 1000, 'notify_post')).toBe('suppressed');
    expect(send).toHaveBeenCalledOnce();
  });

  it('разные сбои троттлятся независимо', async () => {
    expect(await call(NOW, 'cron_announce')).toBe('sent');
    expect(await call(NOW, 'cron_schedule', new Error('permission denied'))).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('два одновременных вызова по одному ключу — одно сообщение', async () => {
    const outcomes = await Promise.all([call(NOW), call(NOW), call(NOW)]);
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'suppressed')).toHaveLength(2);
    expect(send).toHaveBeenCalledOnce();
    expect(store.rows.get('telegram:403')?.suppressedCount).toBe(2);
  });

  it('не дошло до админа — не бросает, журнал откатывается, следующий сбой пробует снова', async () => {
    send.mockRejectedValueOnce(
      new TelegramApiError(
        'sendMessage',
        403,
        "Forbidden: bot can't initiate conversation with a user",
        null,
      ),
    );
    expect(await call(NOW)).toBe('failed');
    expect(store.rows.has('telegram:403')).toBe(false);
    expect(await call(NOW + 1000)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('журнал недоступен — сообщение уходит и предупреждает об этом', async () => {
    store.failGet = true;
    expect(await call(NOW)).toBe('sent');
    expect(String(send.mock.calls[0]?.[1])).toContain(
      'Журнал повторов недоступен — пока он не заработает, о том же сбое напишу примерно раз в 1 ч.',
    );
  });

  it('журнал недоступен — поток вызовов упирается в запасной троттлинг (раз в час на ключ)', async () => {
    const broken: AlertStore = {
      get: async () => {
        throw new Error('PGRST 503');
      },
      swap: async () => {
        throw new Error('PGRST 503');
      },
    };
    const crash = (nowMs: number) =>
      alertAdmin(null, 'cron_crash', 'не удалось проверить x-cron-secret', new Error('503'), {
        store: broken,
        nowMs,
        send,
      });
    const outcomes = [];
    for (let i = 0; i < 20; i++) outcomes.push(await crash(NOW + i * 1000));
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
    // Другой ключ — своё окно.
    expect(await call(NOW + 2000)).toBe('sent');
    // Через час настоящий сбой базы снова напоминает о себе.
    expect(await crash(NOW + FALLBACK_WINDOW_MS)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('гонка: параллельный вызов подавлен, а наше сообщение не дошло — откат всё равно срабатывает', async () => {
    let fail!: (e: unknown) => void;
    send.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const first = call(NOW, 'cron_results');
    // Дать первому вызову занять ключ и дойти до отправки.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(await call(NOW + 500, 'notify_post')).toBe('suppressed');
    fail(new TelegramNetworkError('sendMessage', 'timeout'));
    expect(await first).toBe('failed');
    // Журнал не остался «отправлено»: подавленный повтор сохранён, следующий сбой уходит сразу.
    expect(store.rows.get('telegram:403')).toEqual({
      lastSentAt: new Date(0).toISOString(),
      suppressedCount: 1,
    });
    expect(await call(NOW + HOUR, 'cron_announce')).toBe('sent');
    expect(String(send.mock.calls.at(-1)?.[1])).toContain('Ещё 1 раз с прошлого сообщения.');
  });

  it('откат после неудачи возвращает прошлое сообщение и складывает повторы', async () => {
    expect(await call(NOW)).toBe('sent');
    expect(await call(NOW + HOUR)).toBe('suppressed');
    send.mockRejectedValueOnce(new TelegramNetworkError('sendMessage', 'timeout'));
    expect(await call(NOW + 7 * HOUR)).toBe('failed');
    expect(store.rows.get('telegram:403')).toEqual({
      lastSentAt: new Date(NOW).toISOString(),
      suppressedCount: 1,
    });
  });

  it('400 в разметке одного поста не глушит сообщение о потере группы', async () => {
    const parse = new TelegramApiError(
      'sendMessage',
      400,
      "Bad Request: can't parse entities",
      null,
    );
    const upgraded = new TelegramApiError(
      'sendMessage',
      400,
      'Bad Request: group chat was upgraded to a supergroup chat',
      null,
    );
    expect(await call(NOW, 'cron_results', parse)).toBe('sent');
    expect(await call(NOW + HOUR, 'cron_announce', upgraded)).toBe('sent');
    expect(String(send.mock.calls[1]?.[1])).toContain('Группа стала супергруппой');
  });

  it('db = null и журнала нет — то же: лучше лишнее сообщение, чем молчание', async () => {
    expect(await alertAdmin(null, 'cron_crash', '', new Error('x'), { nowMs: NOW, send })).toBe(
      'sent',
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it('TELEGRAM_DRY_RUN=1 — только лог, троттлинг тот же', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await call(NOW)).toBe('dry_run');
    expect(await call(NOW + 1000)).toBe('suppressed');
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toMatch(
      /^\[admin-alert dry-run\] telegram:403 → 1001\n<b>Сбой/,
    );
  });

  it('dry-run по умолчанию не ходит в Telegram (sendMessage не нужен)', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await alertAdmin(null, 'cron_crash', '', new Error('x'), { store, nowMs: NOW })).toBe(
      'dry_run',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('по умолчанию шлёт через sendMessage в Bot API', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    expect(await alertAdmin(null, 'cron_crash', '', new Error('x'), { store, nowMs: NOW })).toBe(
      'sent',
    );
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: 1001, parse_mode: 'HTML' });
  });

  it('без ADMIN_TG_ID — только лог, журнал не трогает', async () => {
    vi.stubEnv('ADMIN_TG_ID', '');
    expect(await call(NOW)).toBe('no_admin');
    vi.stubEnv('ADMIN_TG_ID', 'abc');
    expect(await call(NOW)).toBe('no_admin');
    expect(send).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it('сбой внутри самого алерта не выходит наружу', async () => {
    const broken: AlertStore = {
      get: async () => null,
      swap: async () => {
        throw new Error('swap');
      },
    };
    send.mockRejectedValue(new Error('send'));
    await expect(
      alertAdmin(null, 'cron_crash', '', new Error('x'), { store: broken, nowMs: NOW, send }),
    ).resolves.toBe('failed');
  });
});
