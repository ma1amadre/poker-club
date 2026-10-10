// Черновик формы вечера (/admin/evening/new и /admin/evening/:id): поля ↔ строка evenings.
// Дата и время — «стенные» часы Москвы (time.ts), формат — снимок config выбранного пресета.
// Чистые функции без React.
import { DEFAULT_FORMAT, validateFormat } from '@domain/format.ts';
import type { TournamentFormat } from '@domain/types.ts';
import type { EveningStatus } from '../../shared/api/types';
// Только чистое форматирование (Intl), без React: модуль тестируется в node.
import { formatDate } from '../../shared/lib/format';
import {
  firstFreeSlot,
  isoToMoscow,
  moscowToIso,
  normalizeTime,
  parseClubDate,
} from '../../shared/lib/clubTime';

/** Формат вечера не меняется — остаётся его снимок. */
export const KEEP_FORMAT = 'keep';
/** Встроенный клубный формат домена (когда своих форматов нет). */
export const BUILTIN_FORMAT = 'builtin';

export interface EveningDraft {
  date: string;
  time: string;
  location: string;
  note: string;
  /** KEEP_FORMAT, BUILTIN_FORMAT или id формата из formats. */
  formatChoice: string;
  bankerId: string | null;
}

export interface EveningRowLike {
  scheduled_at: string;
  location: string | null;
  note: string | null;
  banker_id: string | null;
  status: EveningStatus;
}

export interface FormatOption {
  id: string;
  name: string;
  is_archived: boolean;
  config: TournamentFormat;
}

export interface ScheduleDefaults {
  game_weekday: number;
  game_time: string;
  default_location: string | null;
  default_format_id: string | null;
}

export function draftFromEvening(evening: EveningRowLike): EveningDraft {
  const { date, time } = isoToMoscow(evening.scheduled_at);
  return {
    date,
    time,
    location: evening.location ?? '',
    note: evening.note ?? '',
    formatChoice: KEEP_FORMAT,
    bankerId: evening.banker_id,
  };
}

/**
 * Новый вечер: ближайший свободный день игры по расписанию, место и формат по умолчанию.
 * Формат по умолчанию в архиве или не задан — первый активный; своих нет — встроенный.
 */
export function newEveningDraft(
  nowMs: number,
  settings: ScheduleDefaults | null,
  formats: readonly Pick<FormatOption, 'id' | 'is_archived'>[],
  taken: ReadonlySet<string>,
): EveningDraft {
  const slot = settings
    ? firstFreeSlot(nowMs, settings.game_weekday, settings.game_time, taken)
    : null;
  const active = formats.filter((f) => !f.is_archived);
  const preferred = active.find((f) => f.id === settings?.default_format_id) ?? active[0];
  return {
    date: slot?.date ?? '',
    time: slot?.time ?? normalizeTime(settings?.game_time) ?? '19:00',
    location: settings?.default_location ?? '',
    note: '',
    formatChoice: preferred?.id ?? BUILTIN_FORMAT,
    bankerId: null,
  };
}

/** Шаг времени тренировки: ближайшие 5 минут по Москве (поле времени — с шагом 300 с). */
const TRAINING_STEP_MS = 5 * 60_000;

/**
 * Тренировочный вечер (миграция 023): сегодня, ближайшие 5 минут, банкир — кто создаёт (прогоняет
 * пульт сам или потом назначит другого), место и формат — как у нового вечера.
 */
export function trainingEveningDraft(
  nowMs: number,
  settings: ScheduleDefaults | null,
  formats: readonly Pick<FormatOption, 'id' | 'is_archived'>[],
  bankerId: string | null,
): EveningDraft {
  const base = newEveningDraft(nowMs, settings, formats, new Set());
  const { date, time } = isoToMoscow(Math.ceil(nowMs / TRAINING_STEP_MS) * TRAINING_STEP_MS);
  return { ...base, date, time, bankerId };
}

export type EveningField = 'date' | 'time' | 'format';

export interface EveningCheck {
  /** Момент начала для scheduled_at; null — дата или время не разобрались. */
  scheduledAt: string | null;
  errors: Partial<Record<EveningField, string>>;
  /** Начало уже прошло — не ошибка (вечер можно внести задним числом), но стоит сказать. */
  past: boolean;
}

/**
 * Проверка формы. taken — московские даты, где игра с тем же номером уже занята (takenDates): БД не
 * даст вторую игру 1 на тот же день (evenings_club_day_game_idx, миграция 026), лучше сказать это у
 * поля даты заранее.
 */
export function checkEveningDraft(
  draft: EveningDraft,
  opts: { taken: ReadonlySet<string>; nowMs: number; format: TournamentFormat | null },
): EveningCheck {
  const errors: EveningCheck['errors'] = {};
  const dateOk = parseClubDate(draft.date) !== null;
  const time = normalizeTime(draft.time);
  if (!dateOk) errors.date = 'Укажи дату вечера.';
  if (!time) errors.time = 'Укажи время начала, например 19:00.';
  const scheduledAt = dateOk && time ? moscowToIso(draft.date, time) : null;
  if (scheduledAt && opts.taken.has(draft.date)) {
    errors.date = `На ${formatDate(scheduledAt, opts.nowMs)} уже есть вечер. Выбери другую дату или открой тот вечер. Вторую игру в тот же день создают кнопкой «Ещё игра сегодня» на экране завершённого вечера.`;
  }
  if (!opts.format) {
    errors.format = 'Выбери формат вечера.';
  } else if (validateFormat(opts.format).length > 0) {
    errors.format =
      'В этом формате есть ошибки. Открой его во вкладке «Форматы», исправь и вернись.';
  }
  return {
    scheduledAt,
    errors,
    past: scheduledAt !== null && Date.parse(scheduledAt) < opts.nowMs,
  };
}

/** Какой формат уйдёт в вечер: снимок вечера, встроенный клубный или копия config пресета. */
export function chosenFormat(
  choice: string,
  formats: readonly FormatOption[],
  current: TournamentFormat | null,
): TournamentFormat | null {
  if (choice === KEEP_FORMAT) return current;
  if (choice === BUILTIN_FORMAT) return DEFAULT_FORMAT;
  const row = formats.find((f) => f.id === choice);
  // Название пресета — в снимок: в config оно может отстать, если пресет переименовали.
  return row ? { ...row.config, name: row.name } : null;
}

/** Правки по смыслу: пробелы по краям места и заметки не в счёт, время «19:00» = «19:00:00». */
export function eveningDirty(draft: EveningDraft, initial: EveningDraft): boolean {
  const norm = (d: EveningDraft) => ({
    ...d,
    time: normalizeTime(d.time) ?? d.time,
    location: d.location.trim(),
    note: d.note.trim(),
  });
  return JSON.stringify(norm(draft)) !== JSON.stringify(norm(initial));
}
