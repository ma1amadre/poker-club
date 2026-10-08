// Оповещение админа клуба в личку, когда ломается автоматика (cron-tick, посты notify).
// Без него сбой виден только в логах функций, а их никто не читает, пока клуб не заметит, что
// анонса нет.
//
// Куда: личный чат с ADMIN_TG_ID (id личного чата = tg id пользователя), от бота клуба. Писать
// первым бот не может (core.telegram.org/bots: «Bots can't start conversations with users»), поэтому
// админ хоть раз нажимает Start в чате с ботом — DEPLOY.md, «Оповещения о сбоях».
//
// Троттлинг: одно сообщение на ключ сбоя не чаще раза в ALERT_WINDOW_MS (6 ч); подавленные повторы
// считаются, и следующее сообщение говорит «ещё N раз с прошлого сообщения». Состояние — таблица
// public.admin_alerts (миграция 012, только service_role). Ключ — вид сбоя (шаг cron-tick, пост
// notify), а для ошибок Telegram — код ответа: бот, выкинутый из группы, ломает и анонсы, и итоги,
// и notify, но сообщение об этом одно.
//
// Отправка алерта не роняет функцию: alertAdmin никогда не бросает, всё уходит в console.error.
// TELEGRAM_DRY_RUN=1 — троттлинг работает как в проде, но текст только пишется в лог.
//
// Модуль импортирует только node-совместимое (vitest гоняет его под Node): supabase-js — лишь как тип.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'; // версия — как в _shared/admin.ts
import { describeError } from './errors.ts';
import { formatClubDate, formatClubTime, plural } from './messages.ts';
import {
  escapeHtml,
  isDryRun,
  readEnv,
  redactBotToken,
  sendMessage,
  TelegramApiError,
  TelegramNetworkError,
} from './telegram.ts';

const HOUR_MS = 60 * 60 * 1000;
/** Не чаще одного сообщения на один ключ сбоя. */
export const ALERT_WINDOW_MS = 6 * HOUR_MS;
/**
 * Запасной троттлинг, когда журнал (public.admin_alerts) недоступен: не чаще одного сообщения на ключ
 * за этот срок на один экземпляр функции. Без него каждый вызов при лежащей базе — сообщение админу,
 * а cron-tick шлёт алерт ещё до проверки x-cron-secret: посторонний мог бы засыпать админа запросами
 * и упереть бота в лимит частоты Telegram. Час — чтобы настоящий сбой базы всё же напоминал о себе.
 */
export const FALLBACK_WINDOW_MS = HOUR_MS;
/** Сколько символов ошибки попадает в сообщение: суть, без простыней. */
const MAX_ERROR_LENGTH = 300;

// ---------------------------------------------------------------------------
// Виды сбоев
// ---------------------------------------------------------------------------

export type AlertKind =
  | 'cron_schedule'
  | 'cron_changes'
  | 'cron_announce'
  | 'cron_gameday'
  | 'cron_results'
  | 'cron_voting'
  | 'cron_voting_reminder'
  | 'cron_season'
  | 'cron_crash'
  | 'notify_post';

export type AlertFunction = 'cron-tick' | 'notify';

interface KindInfo {
  fn: AlertFunction;
  /** Что не случилось — первая строка после заголовка. */
  what: string;
  /** Что делать, если ошибка не от Telegram (для Telegram подсказка по коду ответа). */
  check: string;
}

const RETRY_BY_CRON =
  'Проверь логи функции. cron-tick повторит сам через 15 минут, но, пока причина не устранена, это не поможет.';

export const ALERT_KINDS: Record<AlertKind, KindInfo> = {
  cron_schedule: {
    fn: 'cron-tick',
    what: 'Не создался вечер по расписанию.',
    check:
      'Проверь расписание и формат по умолчанию в «Управление клубом» → «Клуб», затем логи функции.',
  },
  cron_changes: {
    fn: 'cron-tick',
    what: 'Не ушёл пост о переносе или отмене вечера.',
    check: RETRY_BY_CRON,
  },
  cron_announce: {
    fn: 'cron-tick',
    what: 'Не ушёл анонс вечера в группу.',
    check: RETRY_BY_CRON,
  },
  cron_gameday: {
    fn: 'cron-tick',
    what: 'Не ушёл пост в день игры в группу.',
    check:
      'Проверь логи функции. cron-tick повторит пост через 15 минут, пока вечер не начался, но, пока причина не устранена, это не поможет.',
  },
  cron_results: {
    fn: 'cron-tick',
    what: 'Не ушли итоги вечера в группу.',
    check: `Проверь журнал вечера в приложении. ${RETRY_BY_CRON}`,
  },
  cron_voting: {
    fn: 'cron-tick',
    what: 'Не ушли итоги голосования в группу.',
    check: RETRY_BY_CRON,
  },
  cron_voting_reminder: {
    fn: 'cron-tick',
    what: 'Не ушло напоминание о голосовании в группу.',
    check:
      'Проверь логи функции. cron-tick повторит напоминание через 15 минут, пока до закрытия голосования больше получаса, но, пока причина не устранена, это не поможет.',
  },
  cron_season: {
    fn: 'cron-tick',
    what: 'Не ушёл пост «Итоги сезона» в группу.',
    check:
      'Проверь логи функции. cron-tick повторит пост через 15 минут — до двух недель после конца сезона, — но, пока причина не устранена, это не поможет.',
  },
  cron_crash: {
    fn: 'cron-tick',
    what: 'cron-tick не отработал целиком: анонсы, итоги и голосования стоят.',
    check:
      'Проверь логи функции. Частые причины — база недоступна или у service_role нет прав на таблицу.',
  },
  notify_post: {
    fn: 'notify',
    what: 'Не ушёл пост в группу по кнопке из приложения.',
    check: 'Проверь логи функции.',
  },
};

/** Подсказка по ответу Telegram: что именно сломалось и как это исправить. */
function telegramHint(err: TelegramApiError | TelegramNetworkError): string {
  if (err instanceof TelegramNetworkError) {
    return 'Telegram не ответил (сеть или его сбой). Обычно проходит само — бот повторит при следующем запуске.';
  }
  const text = err.message.toLowerCase();
  if (text.includes('upgraded to a supergroup')) {
    return 'Группа стала супергруппой, и у неё новый ID. Найди её заново: «Управление клубом» → «Клуб» → «Группа и бот».';
  }
  switch (err.status) {
    case 401:
    case 404:
      return 'Telegram не принимает токен бота. Проверь секрет TELEGRAM_BOT_TOKEN в GitHub и перезапусти деплой.';
    case 403:
      return 'Бота удалили из группы клуба или запретили ему писать. Добавь его обратно администратором и отправь проверочное сообщение в «Группа и бот».';
    case 400:
      return text.includes('chat not found')
        ? 'Telegram не находит группу клуба. Проверь её в «Управление клубом» → «Клуб» → «Группа и бот».'
        : 'Telegram отклонил сообщение. Подробности — в логах функции.';
    case 429:
      return 'Telegram временно ограничил частоту сообщений. Бот повторит сам.';
    default:
      return err.status >= 500
        ? 'Сбой на стороне Telegram. Обычно проходит само — бот повторит при следующем запуске.'
        : 'Ответ Telegram — в строке «Причина», подробности в логах функции.';
  }
}

/**
 * Ключ троттлинга. Ошибки Telegram — по коду ответа, общие для всех шагов и функций: бот, выкинутый
 * из группы (403), ломает всё сразу, а сообщение об этом одно. Исключение — 400: под ним Telegram
 * отдаёт и поломку одного поста (разметка, длина), и потерю группы (стала супергруппой, chat not
 * found). Общий ключ дал бы мелкой ошибке заглушить на 6 ч сообщение о том, что встала вся
 * автоматика, — поэтому потеря группы получает свои ключи, а прочие 400 — по виду сбоя.
 */
export function alertKey(kind: AlertKind, err: unknown): string {
  if (err instanceof TelegramApiError) {
    if (err.status !== 400) return `telegram:${err.status}`;
    const text = err.message.toLowerCase();
    if (text.includes('upgraded to a supergroup')) return 'telegram:400:upgraded';
    if (text.includes('chat not found')) return 'telegram:400:chat_not_found';
    return `telegram:400:${kind}`;
  }
  if (err instanceof TelegramNetworkError) return 'telegram:network';
  return kind;
}

// ---------------------------------------------------------------------------
// Текст
// ---------------------------------------------------------------------------

/**
 * Вычистить из текста ошибки всё похожее на секреты: токен бота (из окружения и по виду), ключи
 * Supabase, JWT, строки подключения к БД. Тексты ошибок — от Telegram, PostgREST и fetch; сами по себе
 * секретов они не несут, это подстраховка.
 */
export function redactSecrets(
  text: string,
  botToken = readEnv('TELEGRAM_BOT_TOKEN') ?? '',
): string {
  return redactBotToken(text, botToken)
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g, '<token>')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '<key>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/\bpostgres(?:ql)?:\/\/\S+/g, '<db-url>');
}

/** Суть ошибки: первая строка (без стектрейса), без секретов, не длиннее MAX_ERROR_LENGTH символов. */
export function summarizeError(err: unknown, botToken?: string): string {
  // Сообщения ошибок Telegram и так начинаются с «Telegram <метод>:» — имя класса лишнее.
  const full =
    err instanceof TelegramApiError || err instanceof TelegramNetworkError
      ? err.message
      : describeError(err);
  const firstLine = full.split(/\r?\n/, 1)[0] ?? '';
  const clean = redactSecrets(firstLine, botToken).trim();
  const chars = Array.from(clean);
  return chars.length > MAX_ERROR_LENGTH
    ? `${chars.slice(0, MAX_ERROR_LENGTH - 1).join('')}…`
    : clean || 'без описания';
}

/** ref проекта из SUPABASE_URL (https://<ref>.supabase.co); локально — null. */
export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(url.trim());
  return m?.[1] ?? null;
}

export function functionLogsUrl(projectRef: string, fn: AlertFunction): string {
  return `https://supabase.com/dashboard/project/${projectRef}/functions/${fn}/logs`;
}

export interface AlertTextInput {
  kind: AlertKind;
  /** Уточнение: какой вечер, что ещё упало в том же шаге. Может быть пустым. */
  detail: string;
  err: unknown;
  nowMs: number;
  /** Сколько раз сбой с этим ключом повторился после прошлого сообщения. */
  repeats: number;
  projectRef: string | null;
  /** Журнал повторов недоступен — троттлинг не сработал. */
  throttleDown?: boolean;
  botToken?: string;
}

/**
 * Сообщение админу (Telegram HTML). Всё переменное — через escapeHtml: в тексте ошибки бывают
 * «<» и «&», и Telegram отверг бы разметку целиком.
 */
export function alertText(input: AlertTextInput): string {
  const info = ALERT_KINDS[input.kind];
  const iso = new Date(input.nowMs).toISOString();
  const err = input.err;
  const check =
    err instanceof TelegramApiError || err instanceof TelegramNetworkError
      ? telegramHint(err)
      : info.check;
  const hours = Math.round(ALERT_WINDOW_MS / HOUR_MS);

  const lines = [`<b>Сбой автоматики клуба</b>`, escapeHtml(info.what)];
  if (input.detail.trim()) lines.push(`Подробности: ${escapeHtml(input.detail.trim())}`);
  lines.push(`Причина: ${escapeHtml(summarizeError(err, input.botToken))}`);
  lines.push(`Когда: ${formatClubDate(iso)}, ${formatClubTime(iso)} МСК (${info.fn})`);
  if (input.repeats > 0) {
    lines.push(
      `Ещё ${input.repeats} ${plural(input.repeats, ['раз', 'раза', 'раз'])} с прошлого сообщения.`,
    );
  }
  lines.push(escapeHtml(check));
  lines.push(
    input.projectRef
      ? `Логи: ${functionLogsUrl(input.projectRef, info.fn)}`
      : `Логи: дашборд Supabase → Edge Functions → ${info.fn} → Logs.`,
  );
  lines.push(
    input.throttleDown
      ? `Журнал повторов недоступен — пока он не заработает, о том же сбое напишу примерно раз в ${Math.round(FALLBACK_WINDOW_MS / HOUR_MS)} ч.`
      : `О том же сбое напишу снова не раньше чем через ${hours} ч.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Троттлинг
// ---------------------------------------------------------------------------

export interface AlertState {
  /** Когда ушло последнее сообщение по ключу — ровно как лежит в БД (строка сравнивается в CAS). */
  lastSentAt: string;
  /** Сколько раз сбой повторился после него. */
  suppressedCount: number;
}

export type AlertDecision =
  | { send: true; repeats: number; next: AlertState }
  | { send: false; repeats: number; next: AlertState };

/**
 * Слать ли сообщение. Первое — всегда; дальше — если с прошлого прошло ALERT_WINDOW_MS, иначе
 * только +1 к счётчику. Битая или далёкая будущая дата в журнале не должна глушить алерты навсегда.
 */
export function decideAlert(
  prev: AlertState | null,
  nowMs: number,
  windowMs: number = ALERT_WINDOW_MS,
): AlertDecision {
  const sent: AlertState = { lastSentAt: new Date(nowMs).toISOString(), suppressedCount: 0 };
  if (!prev) return { send: true, repeats: 0, next: sent };
  const elapsed = nowMs - Date.parse(prev.lastSentAt);
  if (!Number.isFinite(elapsed) || elapsed >= windowMs || elapsed < -windowMs) {
    return { send: true, repeats: prev.suppressedCount, next: sent };
  }
  const suppressed = prev.suppressedCount + 1;
  return {
    send: false,
    repeats: suppressed,
    next: { lastSentAt: prev.lastSentAt, suppressedCount: suppressed },
  };
}

/** Журнал алертов. swap — compare-and-set: записать next, только если в журнале всё ещё expected. */
export interface AlertStore {
  get(key: string): Promise<AlertState | null>;
  /** expected = null — строки нет (вставка); next = null — удалить строку. false — опередили. */
  swap(key: string, expected: AlertState | null, next: AlertState | null): Promise<boolean>;
}

interface AlertRow {
  last_sent_at: string;
  suppressed_count: number;
}

/** Журнал в public.admin_alerts (миграция 012) через service-клиент. */
export function supabaseAlertStore(db: SupabaseClient): AlertStore {
  const table = () => db.from('admin_alerts');
  return {
    async get(key) {
      const { data, error } = await table()
        .select('last_sent_at, suppressed_count')
        .eq('key', key)
        .maybeSingle<AlertRow>();
      if (error) throw new Error(`admin_alerts: ${describeError(error)}`);
      return data
        ? { lastSentAt: data.last_sent_at, suppressedCount: data.suppressed_count }
        : null;
    },
    async swap(key, expected, next) {
      if (expected === null) {
        if (next === null) return true;
        const { error } = await table().insert({
          key,
          last_sent_at: next.lastSentAt,
          suppressed_count: next.suppressedCount,
        });
        // 23505 — строку успел вставить параллельный вызов.
        if (error && (error as { code?: string }).code === '23505') return false;
        if (error) throw new Error(`admin_alerts insert: ${describeError(error)}`);
        return true;
      }
      const base =
        next === null
          ? table().delete()
          : table().update({
              last_sent_at: next.lastSentAt,
              suppressed_count: next.suppressedCount,
              updated_at: new Date().toISOString(),
            });
      const { data, error } = await base
        .eq('key', key)
        .eq('last_sent_at', expected.lastSentAt)
        .eq('suppressed_count', expected.suppressedCount)
        .select('key');
      if (error) throw new Error(`admin_alerts: ${describeError(error)}`);
      return (data ?? []).length > 0;
    },
  };
}

/** Решить и записать решение. Параллельный вызов по тому же ключу — перечитать и решить заново. */
async function claim(
  store: AlertStore,
  key: string,
  nowMs: number,
): Promise<{
  decision: AlertDecision;
  prev: AlertState | null;
}> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prev = await store.get(key);
    const decision = decideAlert(prev, nowMs);
    if (await store.swap(key, prev, decision.next)) return { decision, prev };
  }
  // Пять раз подряд опередили — ключ и так кто-то обрабатывает прямо сейчас.
  return {
    decision: { send: false, repeats: 0, next: { lastSentAt: '', suppressedCount: 0 } },
    prev: null,
  };
}

/** «Сообщения ещё не было» в журнале после отката: эпоха, следующий сбой точно пройдёт окно. */
const UNSENT = new Date(0).toISOString();

/**
 * Вернуть журнал как был, если наше сообщение не дошло до админа. Сравнивать только last_sent_at:
 * параллельный вызов мог успеть добавить к счётчику повтор (CAS по паре полей тогда бы не совпал и
 * журнал остался бы «отправлено» на 6 ч). Накопленные повторы сохраняются: следующий сбой их назовёт.
 */
async function undoClaim(
  store: AlertStore,
  key: string,
  ours: AlertState,
  prev: AlertState | null,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await store.get(key);
    // Журнал уже не наш (строки нет или ушло более позднее сообщение) — откатывать нечего.
    if (!cur || cur.lastSentAt !== ours.lastSentAt) return;
    const restored: AlertState | null =
      prev === null && cur.suppressedCount === 0
        ? null
        : {
            lastSentAt: prev?.lastSentAt ?? UNSENT,
            suppressedCount: (prev?.suppressedCount ?? 0) + cur.suppressedCount,
          };
    if (await store.swap(key, cur, restored)) return;
  }
  console.error(`[admin-alert] ${key}: откат журнала не удался — опередили пять раз подряд`);
}

/** Ключ → когда ушло последнее сообщение без журнала (FALLBACK_WINDOW_MS). Живёт, пока жив экземпляр. */
const fallbackSentAt = new Map<string, number>();

/** Только для тестов: забыть запасной троттлинг. */
export function resetFallbackThrottle(): void {
  fallbackSentAt.clear();
}

/** Запасной троттлинг: можно ли слать и, если да, отметить отправку. */
function takeFallbackSlot(key: string, nowMs: number): boolean {
  const last = fallbackSentAt.get(key);
  if (last !== undefined && nowMs - last < FALLBACK_WINDOW_MS && nowMs >= last) return false;
  fallbackSentAt.set(key, nowMs);
  return true;
}

// ---------------------------------------------------------------------------
// alertAdmin
// ---------------------------------------------------------------------------

export type AlertOutcome = 'sent' | 'dry_run' | 'suppressed' | 'no_admin' | 'failed';

export interface AlertOptions {
  /** Журнал повторов вместо public.admin_alerts (тесты). */
  store?: AlertStore;
  nowMs?: number;
  /** Отправка вместо sendMessage (тесты). */
  send?: (chatId: number, text: string) => Promise<unknown>;
}

function adminChatId(): number | null {
  const raw = readEnv('ADMIN_TG_ID');
  if (!raw || !/^\d{1,16}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Сообщить админу о сбое. Никогда не бросает: собственный сбой — только в console.error.
 * db = null или журнал недоступен — база лежит: сообщение уходит по запасному троттлингу в памяти
 * (FALLBACK_WINDOW_MS; лучше лишнее, чем молчание о том, что встала вся автоматика), текст об этом
 * предупреждает.
 */
export async function alertAdmin(
  db: SupabaseClient | null,
  kind: AlertKind,
  detail: string,
  err: unknown,
  options: AlertOptions = {},
): Promise<AlertOutcome> {
  const key = alertKey(kind, err);
  try {
    const nowMs = options.nowMs ?? Date.now();
    const summary = summarizeError(err);
    const chatId = adminChatId();
    if (chatId === null) {
      console.error(
        `[admin-alert] ADMIN_TG_ID не задан или некорректен — сбой ${key} не отправлен: ${summary}`,
      );
      return 'no_admin';
    }

    const store = options.store ?? (db ? supabaseAlertStore(db) : null);
    let decision: AlertDecision | null = null;
    let prev: AlertState | null = null;
    let throttleDown = false;
    try {
      if (!store) throw new Error('нет клиента базы');
      ({ decision, prev } = await claim(store, key, nowMs));
    } catch (storeErr) {
      console.error(
        `[admin-alert] журнал повторов недоступен (${describeError(storeErr)}) — запасной троттлинг в памяти`,
      );
      throttleDown = true;
    }
    if (throttleDown && !takeFallbackSlot(key, nowMs)) {
      console.warn(`[admin-alert] ${key}: повтор подавлен запасным троттлингом: ${summary}`);
      return 'suppressed';
    }
    if (decision && !decision.send) {
      console.warn(
        `[admin-alert] ${key}: повтор подавлен (${decision.repeats} с прошлого сообщения): ${summary}`,
      );
      return 'suppressed';
    }

    const text = alertText({
      kind,
      detail,
      err,
      nowMs,
      repeats: decision?.repeats ?? 0,
      projectRef: projectRefFromUrl(readEnv('SUPABASE_URL')),
      throttleDown,
    });
    if (isDryRun()) {
      console.log(`[admin-alert dry-run] ${key} → ${chatId}\n${text}`);
      return 'dry_run';
    }
    try {
      await (options.send ?? ((id: number, t: string) => sendMessage(id, t)))(chatId, text);
      return 'sent';
    } catch (sendErr) {
      console.error(`[admin-alert] ${key}: не удалось написать админу: ${summarizeError(sendErr)}`);
      // Сообщение не ушло — вернуть журнал как был, чтобы следующий сбой попробовал снова.
      // Отметку запасного троттлинга не снимаем: иначе при лежащей базе и недоступном Telegram
      // каждый вызов снова стучался бы в Bot API.
      if (store && decision) {
        await undoClaim(store, key, decision.next, prev).catch((undoErr: unknown) => {
          console.error(`[admin-alert] ${key}: откат журнала: ${describeError(undoErr)}`);
        });
      }
      return 'failed';
    }
  } catch (unexpected) {
    console.error(`[admin-alert] ${key}: ${describeError(unexpected)}`);
    return 'failed';
  }
}
