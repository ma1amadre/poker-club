// Форматирование для UI. Время клуба — Europe/Moscow независимо от часового пояса устройства:
// игрок в командировке должен видеть «19:00», как в анонсе в группе.

export const CLUB_TZ = 'Europe/Moscow';

/** Неразрывный пробел: между числом и словом, перед тире, в разрядах. */
export const NBSP = ' ';
const MINUS = '−';

const intFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const pointsFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** 1500 → «1 500 ₽», −300 → «−300 ₽» (типографский минус, неразрывные пробелы). */
export function formatRub(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? MINUS : '';
  return `${sign}${intFormatter.format(Math.abs(rounded))}${NBSP}₽`;
}

/** Баланс со знаком: «+1 500 ₽», «−300 ₽», «0 ₽». */
export function formatRubSigned(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${formatRub(rounded)}` : formatRub(rounded);
}

/** Число с разделителем разрядов: 12500 → «12 500» (фишки, блайнды). */
export function formatNumber(value: number): string {
  const sign = value < 0 ? MINUS : '';
  return `${sign}${intFormatter.format(Math.abs(value))}`;
}

/** Очки рейтинга: 12.5 → «12,5», 12 → «12». */
export function formatPoints(value: number): string {
  const sign = value < 0 ? MINUS : '';
  return `${sign}${pointsFormatter.format(Math.abs(value))}`;
}

/** Блайнды уровня: «25/50», с анте — «25/50 (50)». */
export function formatBlinds(level: { sb: number; bb: number; ante?: number }): string {
  const base = `${formatNumber(level.sb)}/${formatNumber(level.bb)}`;
  return level.ante ? `${base} (${formatNumber(level.ante)})` : base;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Время уровня «mm:ss»; минуты не обрезаются на 59 («65:00»). Обратный отсчёт округляем вверх:
 * на старте 40-минутного уровня видно «40:00», а «00:00» — только когда время вышло.
 */
export function formatClock(ms: number, mode: 'countdown' | 'elapsed' = 'countdown'): string {
  const safe = Math.max(0, ms);
  const totalSeconds = mode === 'countdown' ? Math.ceil(safe / 1000) : Math.floor(safe / 1000);
  return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
}

/** Длительность словами: «3 ч 20 мин», «45 мин», «меньше минуты». */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0 && minutes === 0) return 'меньше минуты';
  if (hours === 0) return `${minutes}${NBSP}мин`;
  if (minutes === 0) return `${hours}${NBSP}ч`;
  return `${hours}${NBSP}ч ${minutes}${NBSP}мин`;
}

/** Русское склонение: plural(5, ['вечер', 'вечера', 'вечеров']) → 'вечеров'. */
export function plural(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «5 вечеров». */
export function pluralWithNumber(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  return `${n}${NBSP}${plural(n, forms)}`;
}

type DateInput = string | number | Date;
const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value));

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: CLUB_TZ, ...options });

const dayMonth = fmt({ day: 'numeric', month: 'long' });
const dayMonthYear = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
const weekdayDayMonth = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const shortWeekday = fmt({ weekday: 'short' });
const time = fmt({ hour: '2-digit', minute: '2-digit' });
const numericDate = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
const yearOnly = fmt({ year: 'numeric' });

function sameClubYear(a: Date, b: Date): boolean {
  return yearOnly.format(a) === yearOnly.format(b);
}

/** «8 октября»; для другого года — «8 октября 2025 г.». */
export function formatDate(value: DateInput, now: DateInput = Date.now()): string {
  const date = toDate(value);
  return sameClubYear(date, toDate(now)) ? dayMonth.format(date) : dayMonthYear.format(date);
}

/** «четверг, 8 октября». */
export function formatWeekdayDate(value: DateInput): string {
  return weekdayDayMonth.format(toDate(value));
}

/** «19:00» по Москве. */
export function formatTime(value: DateInput): string {
  return time.format(toDate(value));
}

/** «чт, 8 октября, 19:00». */
export function formatDateTime(value: DateInput, now: DateInput = Date.now()): string {
  const date = toDate(value);
  return `${shortWeekday.format(date)}, ${formatDate(date, now)}, ${time.format(date)}`;
}

/** «08.10.2026» — для плотных таблиц. */
export function formatDateNumeric(value: DateInput): string {
  return numericDate.format(toDate(value));
}
