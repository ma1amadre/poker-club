// Чистые помощники админки: разбор чисел из полей ввода, порядок вечеров и игроков, статусы,
// тексты ошибок записи. Деньги, очки и места здесь не считаются — это делает домен.
import { errorMessage } from '../../shared/api/errors';
import type { EveningStatus } from '../../shared/api/types';
import { moscowDateKey } from '../../shared/lib/clubTime';
import { NAME_MAX, normalizeName } from '../../shared/lib/text';

// --- Числа в полях ввода ---------------------------------------------------------------------
// Поля — type="text" с inputMode: у type="number" нет десятичной запятой, а колесо мыши и
// стрелки меняют значение незаметно для человека.

/** Пробелы разрядов (обычный, неразрывный, узкий) — их вставляет копирование из постов и таблиц. */
const SPACES_RE = /[\s   ]/g;
/** Типографский минус и тире вместо дефиса — частая вставка из мессенджера и из наших подсказок. */
const MINUS_RE = /[−‒–—]/g;

function clean(value: string): string {
  return value.replace(SPACES_RE, '').replace(MINUS_RE, '-');
}

/** «1 500» → 1500, «−100» → −100; пусто → null; не целое число → NaN. */
export function parseIntInput(value: string): number | null {
  const s = clean(value);
  if (s === '') return null;
  if (!/^-?\d+$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

/** «0,5» и «0.5» → 0.5; пусто → null; мусор → NaN. */
export function parseDecimalInput(value: string): number | null {
  const s = clean(value).replace(',', '.');
  if (s === '') return null;
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Число → значение поля ввода по правилам набора: 0.5 → «0,5». */
export function decimalToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}

/** Целое → значение поля без разрядов (его будут править): 1500 → «1500». */
export function intToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(value);
}

// --- Имена -----------------------------------------------------------------------------------

/** Ошибка имени игрока или null: 1–40 символов, как у set_my_name. */
export function nameError(value: string): string | null {
  const name = normalizeName(value);
  if (name.length === 0) return 'Введите имя — его видят все участники клуба.';
  if (Array.from(name).length > NAME_MAX) return `Имя длиннее ${NAME_MAX} символов. Сократите его.`;
  return null;
}

// --- Игроки ----------------------------------------------------------------------------------

export interface PlayerLike {
  id: string;
  display_name: string;
  is_guest: boolean;
  is_active: boolean;
  is_admin: boolean;
  /** null — профиль без Telegram (гость или бывший гость): войти по нему нельзя. */
  tg_id?: number | null;
}

/** Состав клуба по группам: участники (с админами), гости, отключённые. Внутри — по имени. */
export function groupPlayers<T extends PlayerLike>(
  players: readonly T[],
): { members: T[]; guests: T[]; inactive: T[] } {
  const byName = (a: T, b: T) =>
    a.display_name.localeCompare(b.display_name, 'ru') || a.id.localeCompare(b.id);
  const sorted = [...players].sort(byName);
  return {
    members: sorted.filter((p) => p.is_active && !p.is_guest),
    guests: sorted.filter((p) => p.is_active && p.is_guest),
    inactive: sorted.filter((p) => !p.is_active),
  };
}

/**
 * Кто может быть банкиром: активный участник с Telegram — банкир ведёт пульт в приложении, а гость
 * и постоянный игрок без Telegram войти в него не могут.
 */
export function bankerCandidates<T extends PlayerLike>(
  players: readonly T[],
  currentBankerId: string | null,
): T[] {
  const members = groupPlayers(players).members.filter((p) => p.tg_id !== null);
  // Уже назначенного банкира не выкидываем из выбора, даже если его с тех пор отключили.
  const current = players.find((p) => p.id === currentBankerId);
  return current && !members.some((m) => m.id === current.id) ? [...members, current] : members;
}

// --- Вечера ----------------------------------------------------------------------------------

export interface EveningLike {
  id: string;
  status: EveningStatus;
  scheduled_at: string;
}

const UPCOMING: readonly EveningStatus[] = ['live', 'announced'];

/**
 * Вечера для списка админки: «впереди» — идущий сверху, затем анонсы от ближайшего;
 * «прошли» — завершённые и отменённые, новые сверху.
 */
export function splitEvenings<T extends EveningLike>(
  evenings: readonly T[],
): { upcoming: T[]; past: T[] } {
  const at = (e: T) => Date.parse(e.scheduled_at);
  const upcoming = evenings
    .filter((e) => UPCOMING.includes(e.status))
    .sort(
      (a, b) =>
        UPCOMING.indexOf(a.status) - UPCOMING.indexOf(b.status) ||
        at(a) - at(b) ||
        a.id.localeCompare(b.id),
    );
  const past = evenings
    .filter((e) => !UPCOMING.includes(e.status))
    .sort((a, b) => at(b) - at(a) || a.id.localeCompare(b.id));
  return { upcoming, past };
}

/** Московские даты неотменённых вечеров, кроме exceptId, — в один день клуба только один вечер. */
export function takenDates(evenings: readonly EveningLike[], exceptId?: string): Set<string> {
  return new Set(
    evenings
      .filter((e) => e.status !== 'cancelled' && e.id !== exceptId)
      .map((e) => moscowDateKey(e.scheduled_at)),
  );
}

// --- Ошибки записи ---------------------------------------------------------------------------

interface CodeLike {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

function pgCode(error: unknown): { code: string; message: string } | null {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    const c = e as CodeLike;
    if (typeof c.code === 'string')
      return { code: c.code, message: typeof c.message === 'string' ? c.message : '' };
    e = c.cause;
  }
  return null;
}

/**
 * Текст ошибки записи из админки: нарушения ограничений БД приходят по-английски — переводим
 * то, что админ может исправить сам; остальное — общий errorMessage.
 */
export function adminErrorText(error: unknown): string {
  const pg = pgCode(error);
  if (pg?.code === '23505' && pg.message.includes('evenings_one_per_club_day')) {
    return 'На этот день уже есть вечер. Выберите другую дату или сначала отмените тот вечер.';
  }
  if (pg?.code === '23514') {
    return 'Значение вне допустимых пределов. Проверьте числа в форме.';
  }
  return errorMessage(error);
}
