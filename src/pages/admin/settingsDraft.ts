// Черновик настроек клуба для формы «Клуб» в админке: строки полей ↔ строка settings.
// Чистые функции: разбор ввода, проверка по ограничениям БД (001_schema.sql) и сравнение с
// сохранённым, чтобы показывать «есть несохранённые правки».
import type { upsertSettings } from '../../shared/api/admin';
import type { Settings } from '../../shared/api/types';
import { decimalToInput, intToInput, parseDecimalInput, parseIntInput } from './lib';
import { normalizeTime } from '../../shared/lib/clubTime';

export type SettingsPatch = Parameters<typeof upsertSettings>[0];

/** Все поля формы, разобранные: годится как SettingsPatch для upsertSettings. */
export interface SettingsValues extends SettingsPatch {
  group_chat_id: number | null;
  bot_username: string | null;
  game_weekday: number;
  game_time: string;
  announce_hours_before: number;
  default_location: string | null;
  default_format_id: string | null;
  season_best_n: number;
  ko_points: number;
  win_bonus: number;
}

export interface SettingsDraft {
  groupChatId: string;
  botUsername: string;
  weekday: string;
  time: string;
  announceHours: string;
  location: string;
  /** '' — формат не выбран (cron-tick возьмёт встроенный клубный). */
  formatId: string;
  bestN: string;
  koPoints: string;
  winBonus: string;
}

export type SettingsField = keyof SettingsDraft;

/** Окно анонса — как check в БД: от 1 часа до двух недель. */
export const ANNOUNCE_HOURS_MAX = 336;

export function draftFromSettings(s: Settings): SettingsDraft {
  return {
    // bigint может прийти и числом, и строкой (так его читает cron-tick) — берём как есть.
    groupChatId: s.group_chat_id === null ? '' : String(s.group_chat_id),
    botUsername: s.bot_username ?? '',
    weekday: String(s.game_weekday),
    time: normalizeTime(s.game_time) ?? '',
    announceHours: intToInput(s.announce_hours_before),
    location: s.default_location ?? '',
    formatId: s.default_format_id ?? '',
    bestN: intToInput(s.season_best_n),
    koPoints: decimalToInput(Number(s.ko_points)),
    winBonus: decimalToInput(Number(s.win_bonus)),
  };
}

/**
 * Имя бота из того, что вставили: «@poker_bot», «t.me/poker_bot», «https://t.me/poker_bot?start=1»
 * → «poker_bot». Пусто → ''.
 */
export function normalizeBotUsername(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
}

// Имя пользователя Telegram — 5–32 символа: латиница, цифры, «_»; у ботов оканчивается на «bot».
const BOT_RE = /^[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$/;

export function parseSettingsDraft(draft: SettingsDraft): {
  patch: SettingsValues;
  errors: Partial<Record<SettingsField, string>>;
} {
  const errors: Partial<Record<SettingsField, string>> = {};

  const chat = parseIntInput(draft.groupChatId);
  if (chat !== null && (Number.isNaN(chat) || chat >= 0)) {
    errors.groupChatId =
      'ID группы — отрицательное число, у супергрупп оно начинается с -100. Скопируй его целиком.';
  }

  const bot = normalizeBotUsername(draft.botUsername);
  if (bot !== '' && !BOT_RE.test(bot)) {
    errors.botUsername =
      'Имя бота — 5–32 латинские буквы, цифры или «_», в конце «bot». Скопируй его из BotFather.';
  }

  const weekday = parseIntInput(draft.weekday);
  if (weekday === null || Number.isNaN(weekday) || weekday < 1 || weekday > 7) {
    errors.weekday = 'Выбери день недели.';
  }

  const time = normalizeTime(draft.time);
  if (!time) errors.time = 'Укажи время начала, например 19:00.';

  const hours = parseIntInput(draft.announceHours);
  if (hours === null || Number.isNaN(hours) || hours < 1 || hours > ANNOUNCE_HOURS_MAX) {
    errors.announceHours = `Целое число часов от 1 до ${ANNOUNCE_HOURS_MAX} (две недели).`;
  }

  const bestN = parseIntInput(draft.bestN);
  if (bestN === null || Number.isNaN(bestN) || bestN < 1) {
    errors.bestN = 'Целое число от 1.';
  }

  const ko = parseDecimalInput(draft.koPoints);
  if (ko === null || Number.isNaN(ko) || ko < 0) {
    errors.koPoints = 'Число от 0, например 0,5.';
  }

  const win = parseDecimalInput(draft.winBonus);
  if (win === null || Number.isNaN(win) || win < 0) {
    errors.winBonus = 'Число от 0, например 1.';
  }

  const location = draft.location.trim();
  return {
    patch: {
      group_chat_id: chat === null || Number.isNaN(chat) ? null : chat,
      bot_username: bot === '' ? null : bot,
      game_weekday: weekday ?? 0,
      game_time: time ?? '',
      announce_hours_before: hours ?? 0,
      default_location: location === '' ? null : location,
      default_format_id: draft.formatId === '' ? null : draft.formatId,
      season_best_n: bestN ?? 0,
      ko_points: ko ?? 0,
      win_bonus: win ?? 0,
    },
    errors,
  };
}

/** Есть ли правки относительно сохранённых настроек (по смыслу, а не по написанию: «0.5» = «0,5»). */
export function settingsDirty(draft: SettingsDraft, saved: Settings): boolean {
  const a = parseSettingsDraft(draft).patch;
  const b = parseSettingsDraft(draftFromSettings(saved)).patch;
  const keys = Object.keys(a) as (keyof SettingsValues)[];
  return keys.some((k) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' && typeof y === 'number')
      return !(x === y || (Number.isNaN(x) && Number.isNaN(y)));
    return x !== y;
  });
}
