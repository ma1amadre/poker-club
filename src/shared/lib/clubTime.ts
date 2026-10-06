// Дата и время клуба (Москва) ↔ момент UTC: форма вечера, настройки расписания, следующая игра.
//
// Москва с 26.10.2014 живёт по UTC+3 круглый год, без перевода часов, поэтому смещение здесь
// фиксированное и не зависит ни от пояса устройства, ни от базы tzdata в WebView. Для дат до
// осени 2014 результат был бы неточным, но вечеров клуба тогда не было.
// Все функции чистые: «сейчас» передаётся параметром.

export const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEK_MINUTES = 7 * 24 * 60;

/** Значения полей формы: date — «2026-10-08» (input type=date), time — «19:00» (type=time). */
export interface ClubDateTime {
  date: string;
  time: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Postgres отдаёт time как «19:00:00», поле ввода — «19:00»; принимаем оба и «9:05».
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** «2026-10-08» → части даты; несуществующая дата (31 февраля) → null. */
export function parseClubDate(value: string): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** «19:00:00» / «9:05» → «19:00» / «09:05»; мусор и 24:00 → null. */
export function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function timeParts(value: string): { hour: number; minute: number } | null {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  return { hour: Number(normalized.slice(0, 2)), minute: Number(normalized.slice(3, 5)) };
}

/** Дата и время по Москве → ISO UTC для timestamptz; неверный ввод → null. */
export function moscowToIso(date: string, time: string): string | null {
  const d = parseClubDate(date);
  const t = timeParts(time);
  if (!d || !t) return null;
  const wallAsUtc = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute);
  return new Date(wallAsUtc - MOSCOW_OFFSET_MS).toISOString();
}

/** Момент (ISO, мс или Date) → дата и время по Москве для полей формы. */
export function isoToMoscow(value: string | number | Date): ClubDateTime {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Некорректный момент времени: ${String(value)}`);
  const wall = new Date(ms + MOSCOW_OFFSET_MS);
  return {
    date: `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`,
    time: `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`,
  };
}

/** Московский день момента — «2026-10-08»: два вечера в один день клуба — почти всегда ошибка. */
export function moscowDateKey(value: string | number | Date): string {
  return isoToMoscow(value).date;
}

/** День недели даты «2026-10-08» в нумерации settings.game_weekday: 1 = пн … 7 = вс. */
export function clubWeekday(date: string): number | null {
  const d = parseClubDate(date);
  if (!d) return null;
  const js = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * Ближайшая игра по расписанию строго позже nowMs — то же правило, что у cron-tick
 * (nextGameAt): если сегодня день игры, но время прошло, — через неделю.
 * weekday — 1 = пн … 7 = вс, time — время Москвы. Неверные настройки → null.
 */
export function nextGameSlot(nowMs: number, weekday: number, time: string): ClubDateTime | null {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  const t = timeParts(time);
  if (!t) return null;
  const today = isoToMoscow(nowMs).date;
  const base = parseClubDate(today);
  if (!base) return null;
  for (let k = 0; k <= 7; k++) {
    const dayMs = Date.UTC(base.year, base.month - 1, base.day) + k * DAY_MS;
    const day = new Date(dayMs);
    const wd = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (wd !== weekday) continue;
    const atMs = dayMs + (t.hour * 60 + t.minute) * MINUTE_MS - MOSCOW_OFFSET_MS;
    if (atMs > nowMs) return isoToMoscow(atMs);
  }
  return null;
}

/**
 * Момент ближайшей игры по расписанию (мс UTC) строго позже nowMs — как nextGameAt у cron-tick,
 * но неверные настройки дают null, а не исключение.
 */
export function nextGameAt(nowMs: number, weekday: number, time: string): number | null {
  const slot = nextGameSlot(nowMs, weekday, time);
  const iso = slot ? moscowToIso(slot.date, slot.time) : null;
  return iso ? Date.parse(iso) : null;
}

/**
 * Первый слот расписания позже nowMs, на дату которого ещё нет вечера (taken — московские даты
 * «2026-10-08» неотменённых вечеров): cron-tick обычно уже создал вечер на ближайший четверг,
 * и новый вечер по умолчанию предлагаем на следующий свободный. Ищем не дальше maxWeeks недель.
 */
export function firstFreeSlot(
  nowMs: number,
  weekday: number,
  time: string,
  taken: ReadonlySet<string>,
  maxWeeks = 8,
): ClubDateTime | null {
  let from = nowMs;
  for (let week = 0; week < maxWeeks; week++) {
    const slot = nextGameSlot(from, weekday, time);
    if (!slot) return null;
    if (!taken.has(slot.date)) return slot;
    const at = moscowToIso(slot.date, slot.time);
    if (!at) return null;
    from = Date.parse(at);
  }
  return null;
}

/**
 * Когда по расписанию появится анонс: день недели и время за hoursBefore часов до игры.
 * cron-tick проверяет раз в 15 минут, так что анонс уходит в течение 15 минут после этого
 * момента. При окне в неделю и больше день недели ничего не говорит — тогда null.
 */
export function announceMoment(
  weekday: number,
  time: string,
  hoursBefore: number,
): { weekday: number; time: string } | null {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  if (!Number.isInteger(hoursBefore) || hoursBefore < 1 || hoursBefore >= 7 * 24) return null;
  const t = timeParts(time);
  if (!t) return null;
  const gameMinute = (weekday - 1) * 24 * 60 + t.hour * 60 + t.minute;
  const at = (((gameMinute - hoursBefore * 60) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  const minuteOfDay = at % (24 * 60);
  return {
    weekday: Math.floor(at / (24 * 60)) + 1,
    time: `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`,
  };
}

/** Названия дней недели в нумерации settings.game_weekday (индекс 0 = понедельник). */
export const WEEKDAYS: readonly { value: number; title: string; short: string; on: string }[] = [
  { value: 1, title: 'Понедельник', short: 'пн', on: 'в понедельник' },
  { value: 2, title: 'Вторник', short: 'вт', on: 'во вторник' },
  { value: 3, title: 'Среда', short: 'ср', on: 'в среду' },
  { value: 4, title: 'Четверг', short: 'чт', on: 'в четверг' },
  { value: 5, title: 'Пятница', short: 'пт', on: 'в пятницу' },
  { value: 6, title: 'Суббота', short: 'сб', on: 'в субботу' },
  { value: 7, title: 'Воскресенье', short: 'вс', on: 'в воскресенье' },
];
