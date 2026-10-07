// Чистые помощники админки: разбор чисел из полей ввода, порядок вечеров и игроков, статусы,
// тексты ошибок записи. Деньги, очки и места здесь не считаются — это делает домен.
import { errorMessage } from '../../shared/api/errors';
import type { EveningStatus } from '../../shared/api/types';
import { clubWeekday, moscowDateKey, parseClubDate } from '../../shared/lib/clubTime';
import { pluralWithNumber } from '../../shared/lib/format';
import { NAME_MAX, normalizeName } from '../../shared/lib/text';

// --- Вкладки --------------------------------------------------------------------------------

export type AdminTabId = 'club' | 'formats' | 'players' | 'evenings';
const ADMIN_TABS: readonly AdminTabId[] = ['club', 'formats', 'players', 'evenings'];

/** Вкладка из ?tab=…; без параметра или с неизвестной — «Вечера»: с ними админ работает чаще всего. */
export function adminTab(param: string | null): AdminTabId {
  return ADMIN_TABS.includes(param as AdminTabId) ? (param as AdminTabId) : 'evenings';
}

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
  if (name.length === 0) return 'Введи имя — его видят все участники клуба.';
  if (Array.from(name).length > NAME_MAX) return `Имя длиннее ${NAME_MAX} символов. Сократи его.`;
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

// --- Привязка игрока без Telegram к Telegram-профилю (merge_players, миграция 008) -----------

/**
 * Куда можно привязать игрока без Telegram: профили с tg_id, кроме него самого. Активные сверху,
 * внутри — по имени (отключённого тоже можно выбрать: вдруг человек сначала вошёл, а потом его
 * отключили по ошибке).
 */
export function mergeTargets<T extends PlayerLike>(players: readonly T[], guestId: string): T[] {
  return players
    .filter((p) => p.id !== guestId && p.tg_id !== null && p.tg_id !== undefined)
    .sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        a.display_name.localeCompare(b.display_name, 'ru') ||
        a.id.localeCompare(b.id),
    );
}

export interface MergeCounts {
  evenings: number;
  events: number;
  votesReceived: number;
  votesCast: number;
  predictionsAbout: number;
  predictionsMade: number;
  rsvps: number;
  bankerOf: number;
}

type Forms = readonly [string, string, string];
const MERGE_LINES: readonly [keyof MergeCounts, Forms][] = [
  ['evenings', ['сыгранный вечер', 'сыгранных вечера', 'сыгранных вечеров']],
  ['events', ['запись журнала', 'записи журнала', 'записей журнала']],
  ['votesReceived', ['полученный голос', 'полученных голоса', 'полученных голосов']],
  ['votesCast', ['отданный голос', 'отданных голоса', 'отданных голосов']],
  [
    'predictionsAbout',
    ['прогноз других игроков', 'прогноза других игроков', 'прогнозов других игроков'],
  ],
  ['predictionsMade', ['свой прогноз', 'своих прогноза', 'своих прогнозов']],
  ['rsvps', ['ответ на анонс', 'ответа на анонс', 'ответов на анонс']],
  ['bankerOf', ['вечер в роли банкира', 'вечера в роли банкира', 'вечеров в роли банкира']],
];

/** «2 сыгранных вечера», «4 прогноза других игроков» — только ненулевые, в порядке важности. */
export function mergeSummary(counts: MergeCounts): string[] {
  return MERGE_LINES.filter(([key]) => counts[key] > 0).map(([key, forms]) =>
    pluralWithNumber(counts[key], forms),
  );
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

// --- Посты о правке вечера (notify evening_changed, миграция 008) ---------------------------

export type AnnounceChangeKind = 'moved' | 'cancelled' | 'restored';
export type AnnounceMoveKind = 'rescheduled' | 'place_set' | 'relocated';

/**
 * Вторая строка тоста после сохранения: что бот написал в группу. При `moved` — по `move` из ответа
 * notify: место без смены времени — не «перенос». Без `move` (старый сервер) — «о переносе».
 */
export function announceChangeText(
  change: AnnounceChangeKind,
  move: AnnounceMoveKind | null = null,
): string {
  if (change === 'cancelled') return 'Бот написал в группу, что вечер отменён.';
  if (change === 'restored') return 'Бот написал в группу, что вечер всё-таки состоится.';
  if (move === 'place_set') return 'Бот написал в группу, где пройдёт вечер.';
  if (move === 'relocated') return 'Бот написал в группу о смене места.';
  return 'Бот написал в группу о переносе.';
}

/**
 * Узнает ли группа об отмене или возврате вечера: 'group' — анонс в группе и вечер ещё впереди
 * (бот напишет), 'past' — анонс был, но время вечера прошло (сервер правку запомнит молча,
 * decideAnnounceChange), 'none' — анонса не было.
 */
export type AnnounceReach = 'group' | 'past' | 'none';

export function announceReach(
  evening: { announce_posted_at: string | null; scheduled_at: string },
  nowMs: number,
): AnnounceReach {
  if (!evening.announce_posted_at) return 'none';
  return Date.parse(evening.scheduled_at) > nowMs ? 'group' : 'past';
}

/** Подпись раздела «Отмена» в форме вечера. */
export function cancelFooter(reach: AnnounceReach): string {
  if (reach === 'group')
    return 'Бот напишет в группу, что вечер отменён, и добавит причину, если она указана. Вернуть вечер можно здесь же.';
  if (reach === 'past')
    return 'Время вечера уже прошло — в группу ничего не уйдёт. Вернуть вечер можно здесь же.';
  return 'Вечер пропадёт из ближайших, бот не создаст новый на этот день. Вернуть его можно здесь же.';
}

/** Текст подтверждения отмены вечера, о которой бот напишет в группу. */
export function cancelConfirmMessage(reason: string): string {
  const head = reason
    ? `Бот напишет в группу, что вечер отменён, с причиной «${reason}».`
    : 'Бот напишет в группу, что вечер отменён, без причины.';
  return `${head} Пост не отзовёшь: если вернёшь вечер до начала, бот напишет, что он всё-таки состоится.`;
}

/** Пометка «Вечер отменён» в форме: причина и что будет, если вернуть. */
export function cancelledNoticeText(reason: string | null, reach: AnnounceReach): string {
  const parts = [reason?.trim() ? `Причина: «${reason.trim()}».` : null];
  parts.push('Его нет среди ближайших, бот не создаст новый вечер на этот день.');
  if (reach === 'group')
    parts.push('Если вернёшь вечер, бот напишет в группу, что он всё-таки состоится.');
  return parts.filter(Boolean).join(' ');
}

/** Подсказка поля «Заметка»: куда она попадёт. Причина отмены — отдельное поле. */
export function noteHint(status: EveningStatus, posted: boolean): string | undefined {
  if (status !== 'announced') return undefined;
  return posted
    ? 'Анонс уже в группе — правка заметки туда не попадёт, её увидят в приложении.'
    : 'Попадёт в анонс в группе.';
}

/**
 * День по расписанию, который останется без вечера после переноса на newDate: за ним закреплён
 * этот вечер (evenings.slot_date, миграция 010), и cron-tick новый на него не создаст. null —
 * предупреждать не о чем: день тот же, не день игры по расписанию или уже прошёл.
 */
export function vacatedSlot(
  evening: { slot_date: string | null },
  newDate: string,
  gameWeekday: number | null | undefined,
  nowMs: number,
): string | null {
  const slot = evening.slot_date;
  if (!slot || !parseClubDate(newDate) || newDate === slot) return null;
  if (gameWeekday == null || clubWeekday(slot) !== gameWeekday) return null;
  // Даты «2026-10-08» сравниваются строкой.
  if (slot < moscowDateKey(nowMs)) return null;
  return slot;
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
    return 'На этот день уже есть вечер. Выбери другую дату или сначала отмени тот вечер.';
  }
  if (pg?.code === '23514') {
    return 'Значение вне допустимых пределов. Проверь числа в форме.';
  }
  return errorMessage(error);
}
