// Тексты постов бота в группу клуба — все в одном месте.
// Разметка — Telegram HTML: всё, что пришло от людей (имена, место, заметки), идёт через
// escapeHtml. Даты — по клубному времени (Москва), независимо от часового пояса сервера.
// Форматирование чисел и дат сделано вручную, без локали ru-RU в Intl: ICU-данные локалей
// в рантайме функций не гарантированы, а часовые пояса нужны и так (сезоны домена на них же).
import {
  ACHIEVEMENT_META,
  VOTE_CATEGORIES,
  VOTE_CATEGORY_META,
  type Achievement,
  type MoneyTable,
  type PlayerId,
  type TournamentFormat,
  type VoteCategory,
  type VoteResult,
} from './domain/index.ts';
import { escapeHtml, miniAppLink, type UrlButton } from './telegram.ts';

export const CLUB_TZ = 'Europe/Moscow';

const NBSP = ' ';
const MINUS = '−';

export interface Post {
  text: string;
  buttons: UrlButton[];
}

// ---------------------------------------------------------------------------
// Время клуба
// ---------------------------------------------------------------------------

export interface ClubParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1=пн … 7=вс, как settings.game_weekday
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLUB_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** «Стенные часы» Москвы в момент ms. */
export function clubParts(ms: number): ClubParts {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof typeof out] = Number(part.value);
  }
  // День недели — из календарной даты, а не из Intl: так не зависим от названий дней в локали.
  const jsDay = new Date(Date.UTC(out.year, out.month - 1, out.day)).getUTCDay(); // 0=вс
  return { ...out, weekday: jsDay === 0 ? 7 : jsDay };
}

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const WEEKDAYS_ACCUSATIVE = [
  'понедельник',
  'вторник',
  'среду',
  'четверг',
  'пятницу',
  'субботу',
  'воскресенье',
];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** «8 октября». */
export function formatClubDate(iso: string): string {
  const p = clubParts(Date.parse(iso));
  return `${p.day}${NBSP}${MONTHS_GENITIVE[p.month - 1] ?? ''}`;
}

/** «19:00». */
export function formatClubTime(iso: string): string {
  const p = clubParts(Date.parse(iso));
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** «в четверг, 8 октября, в 19:00». */
function formatWhen(iso: string): string {
  const p = clubParts(Date.parse(iso));
  return `в ${WEEKDAYS_ACCUSATIVE[p.weekday - 1] ?? ''}, ${formatClubDate(iso)}, в ${formatClubTime(iso)}`;
}

// ---------------------------------------------------------------------------
// Числа
// ---------------------------------------------------------------------------

/** 1960 → «1 960» (неразрывный пробел между разрядами). */
export function formatInt(value: number): string {
  const abs = String(Math.abs(Math.round(value)));
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${value < 0 ? MINUS : ''}${grouped}`;
}

/** «1 960 ₽». */
export function formatRub(value: number): string {
  return `${formatInt(value)}${NBSP}₽`;
}

/** Русское склонение: plural(5, ['нокаут', 'нокаута', 'нокаутов']) → 'нокаутов'. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «2026-Q3» → «III квартал 2026». */
export function formatSeason(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return key;
  return `${['I', 'II', 'III', 'IV'][Number(m[2]) - 1]} квартал ${m[1]}`;
}

/**
 * «3 нокаута», а при ничьей — «по 3 нокаута». После «по» единица требует дательного падежа
 * («по 1 нокауту»), остальные формы совпадают с обычными.
 */
function countPhrase(
  n: number,
  forms: readonly [string, string, string],
  dativeOne: string,
  shared: boolean,
): string {
  if (!shared) return `${n} ${plural(n, forms)}`;
  const one = n % 10 === 1 && n % 100 !== 11;
  return `по ${n} ${one ? dativeOne : plural(n, forms)}`;
}

/** «Саша», «Саша и Дима», «Саша, Дима и Лёша» — имена уже экранированы. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Кнопки
// ---------------------------------------------------------------------------

/** URL-кнопка на Mini App; без bot_username в настройках кнопку не строим (пост уйдёт без неё). */
function appButton(botUsername: string | null, text: string, startParam: string): UrlButton[] {
  if (!botUsername) return [];
  try {
    return [{ text, url: miniAppLink(botUsername, startParam) }];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Анонс
// ---------------------------------------------------------------------------

export interface AnnouncePostInput {
  eveningId: string;
  scheduledAt: string;
  location: string | null;
  note: string | null;
  format: TournamentFormat;
  botUsername: string | null;
}

export function announcePost(input: AnnouncePostInput): Post {
  const f = input.format;
  const lines = [`♠️ <b>Покер ${formatWhen(input.scheduledAt)}</b>`];
  if (input.location) lines.push(`📍 ${escapeHtml(input.location)}`);
  lines.push(
    `Вход и ребай по ${formatRub(f.buyInRub)} (${formatInt(f.startingChips)} ` +
      `${plural(f.startingChips, ['фишка', 'фишки', 'фишек'])}), ${formatRub(f.bountyRub)} из них — за голову.`,
  );
  if (input.note) lines.push(`📝 ${escapeHtml(input.note)}`);
  lines.push('', 'Отметьтесь, идёте ли, и сделайте прогноз на победителя 🔮');
  return {
    text: lines.join('\n'),
    buttons: appButton(input.botUsername, '♣️ Иду / не иду', `e_${input.eveningId}`),
  };
}

// ---------------------------------------------------------------------------
// Итоги вечера
// ---------------------------------------------------------------------------

export interface ResultsPostInput {
  eveningId: string;
  scheduledAt: string;
  location: string | null;
  names: Record<PlayerId, string>; // display_name, неэкранированные
  places: PlayerId[]; // index 0 = 1-е место
  money: MoneyTable;
  kos: Record<PlayerId, number>;
  totalEntries: number;
  rebuysTotal: number;
  prizePoolRub: number;
  newAchievements: Achievement[];
  votingClosesAt: string | null;
  botUsername: string | null;
  nowMs: number; // «голосование открыто до …» пишем, только если оно ещё не закрылось
}

const MEDALS = ['🥇', '🥈', '🥉'];

const titleOf = (a: Achievement): string => escapeHtml(ACHIEVEMENT_META[a.code]?.title ?? a.code);

/** Сезонные ачивки — по порядку важности, а не по алфавиту кодов. */
const SEASON_ORDER: readonly Achievement['code'][] = ['champion', 'rebuy_king', 'iron_chair'];

/**
 * Блок ачивок: ачивки вечера — строкой на игрока, сезонные (их приносит первый вечер нового
 * квартала) — отдельным блоком «итоги сезона», по званию со списком игроков.
 */
function achievementLines(list: readonly Achievement[], names: Record<PlayerId, string>): string[] {
  const name = (id: PlayerId): string => escapeHtml(names[id] ?? 'Игрок');
  const lines: string[] = [];

  const evening = list.filter((a) => a.seasonKey === null);
  if (evening.length > 0) {
    lines.push('', '🏅 <b>Новые ачивки</b>');
    for (const a of evening) {
      lines.push(`• ${name(a.playerId)} — «${titleOf(a)}»${a.count > 1 ? ` ×${a.count}` : ''}`);
    }
  }

  const seasons = [...new Set(list.map((a) => a.seasonKey).filter((k): k is string => k !== null))];
  for (const key of seasons.sort()) {
    const inSeason = list.filter((a) => a.seasonKey === key);
    const codes = [...new Set(inSeason.map((a) => a.code))].sort(
      (x, y) => (SEASON_ORDER.indexOf(x) + 1 || 99) - (SEASON_ORDER.indexOf(y) + 1 || 99),
    );
    lines.push('', `🏆 <b>Итоги сезона: ${formatSeason(key)}</b>`);
    for (const code of codes) {
      const holders = inSeason.filter((a) => a.code === code);
      const first = holders[0];
      if (!first) continue;
      lines.push(`• «${titleOf(first)}»: ${joinNames(holders.map((a) => name(a.playerId)))}`);
    }
  }
  return lines;
}

export function resultsPost(input: ResultsPostInput): Post {
  const name = (id: PlayerId): string => escapeHtml(input.names[id] ?? 'Игрок');
  const header = [`♠️ <b>Итоги вечера ${formatClubDate(input.scheduledAt)}</b>`];
  if (input.location) header.push(`📍 ${escapeHtml(input.location)}`);

  const placeLines = input.places.map((id, i) => {
    const m = input.money[id];
    const parts: string[] = [];
    if (m && m.prizeRub > 0) parts.push(`приз ${formatRub(m.prizeRub)}`);
    if (m && m.bountyRub > 0) parts.push(`головы ${formatRub(m.bountyRub)}`);
    const mark = MEDALS[i] ?? `${i + 1}.`;
    const who = i === 0 ? `<b>${name(id)}</b>` : name(id);
    return `${mark} ${who}${parts.length ? ` — ${parts.join(', ')}` : ''}`;
  });

  const rebuys =
    input.rebuysTotal > 0
      ? `, из них ${input.rebuysTotal} ${plural(input.rebuysTotal, ['ребай', 'ребая', 'ребаев'])}`
      : '';
  const lines = [
    ...header,
    '',
    ...placeLines,
    '',
    `💰 Фонд ${formatRub(input.prizePoolRub)} · ${input.totalEntries} ` +
      `${plural(input.totalEntries, ['вход', 'входа', 'входов'])}${rebuys}`,
  ];

  // Лучший охотник: больше всех нокаутов; ничья — все лидеры.
  const maxKos = Math.max(0, ...input.places.map((id) => input.kos[id] ?? 0));
  if (maxKos > 0) {
    const hunters = input.places.filter((id) => (input.kos[id] ?? 0) === maxKos).map(name);
    const kos = countPhrase(
      maxKos,
      ['нокаут', 'нокаута', 'нокаутов'],
      'нокауту',
      hunters.length > 1,
    );
    lines.push(`🎯 Лучший охотник: ${joinNames(hunters)} — ${kos}`);
  }

  lines.push(...achievementLines(input.newAchievements, input.names));

  let buttons: UrlButton[] = [];
  // Итоги, добитые cron-tick после закрытия голосования, не зовут голосовать «до вчера».
  if (input.votingClosesAt && Date.parse(input.votingClosesAt) > input.nowMs) {
    lines.push(
      '',
      `🗳 Голосование за руку, блеф и бэд-бит вечера открыто до ` +
        `${formatClubDate(input.votingClosesAt)}, ${formatClubTime(input.votingClosesAt)} МСК.`,
    );
    buttons = appButton(input.botUsername, '🗳 Голосовать', `v_${input.eveningId}`);
  } else {
    buttons = appButton(input.botUsername, '♦️ Открыть вечер', `e_${input.eveningId}`);
  }
  return { text: lines.join('\n'), buttons };
}

// ---------------------------------------------------------------------------
// Итоги голосования
// ---------------------------------------------------------------------------

export interface VotingPostInput {
  eveningId: string;
  scheduledAt: string;
  names: Record<PlayerId, string>;
  results: Record<VoteCategory, VoteResult>;
  botUsername: string | null;
}

const CATEGORY_ICON: Record<VoteCategory, string> = { hand: '🃏', bluff: '🎭', badbeat: '💔' };

/** null — голосов не было, постить нечего. */
export function votingPost(input: VotingPostInput): Post | null {
  const lines: string[] = [];
  for (const cat of VOTE_CATEGORIES) {
    const r = input.results[cat];
    if (!r || r.winners.length === 0) continue;
    const votes = r.counts[r.winners[0] ?? ''] ?? 0;
    const names = r.winners.map((id) => escapeHtml(input.names[id] ?? 'Игрок'));
    const count = countPhrase(
      votes,
      ['голос', 'голоса', 'голосов'],
      'голосу',
      r.winners.length > 1,
    );
    lines.push(
      `${CATEGORY_ICON[cat]} ${VOTE_CATEGORY_META[cat].title}: <b>${joinNames(names)}</b> ` +
        `(${count})`,
    );
  }
  if (lines.length === 0) return null;
  return {
    text: [
      `🗳 <b>Итоги голосования · вечер ${formatClubDate(input.scheduledAt)}</b>`,
      '',
      ...lines,
      '',
      `⭐ Победители номинаций получают ачивку «${ACHIEVEMENT_META.star.title}».`,
    ].join('\n'),
    buttons: appButton(input.botUsername, '♥️ Смотреть голоса', `v_${input.eveningId}`),
  };
}
