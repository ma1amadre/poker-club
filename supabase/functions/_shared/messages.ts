// Тексты постов бота в группу клуба — все в одном месте.
// Разметка — Telegram HTML: всё, что пришло от людей (имена, место, заметки), идёт через
// escapeHtml. Даты — по клубному времени (Москва), независимо от часового пояса сервера.
// Форматирование чисел и дат сделано вручную, без локали ru-RU в Intl: ICU-данные локалей
// в рантайме функций не гарантированы, а часовые пояса нужны и так (сезоны домена на них же).
import {
  ACHIEVEMENT_META,
  RECORD_META,
  TITLE_META,
  VOTE_CATEGORIES,
  VOTE_CATEGORY_META,
  type Achievement,
  type EveningClubNews,
  type EveningStakes,
  type MoneyTable,
  type PlayerId,
  type RecordBreak,
  type RecordKind,
  type StakeItem,
  type StoryItem,
  type TitleChange,
  type TournamentFormat,
  type VoteCategory,
  type VoteResult,
} from './domain/index.ts';
import { moveKind, samePlace, type AnnounceChange, type AnnounceSnapshot } from './announce.ts';
import type { GamedayPlayer, GamedayRoster } from './gameday.ts';
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

/** Очки: «1 очко», «12 очков», «12,5 очка» (дробное — всегда «очка»). */
export function formatPoints(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `${formatInt(rounded)}${NBSP}${plural(rounded, ['очко', 'очка', 'очков'])}`;
  }
  const [whole = '0', fraction = ''] = String(Math.abs(rounded)).split('.');
  const sign = rounded < 0 ? MINUS : '';
  return `${sign}${formatInt(Number(whole))},${fraction}${NBSP}очка`;
}

/** «3 ч 20 мин» — как длина игры в приложении (formatDuration во фронте). */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0 && minutes === 0) return 'меньше минуты';
  if (hours === 0) return `${minutes}${NBSP}мин`;
  if (minutes === 0) return `${hours}${NBSP}ч`;
  return `${hours}${NBSP}ч ${minutes}${NBSP}мин`;
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
      `${plural(f.startingChips, ['фишка', 'фишки', 'фишек'])}).`,
  );
  if (input.note) lines.push(`📝 ${escapeHtml(input.note)}`);
  lines.push('', 'Отметьтесь, идёте ли, и сделайте прогноз на победителя 🔮');
  return {
    text: lines.join('\n'),
    buttons: appButton(input.botUsername, '♣️ Иду / не иду', `e_${input.eveningId}`),
  };
}

// ---------------------------------------------------------------------------
// Перенос, смена места, отмена и возврат вечера после анонса (миграция 008, notify kind
// evening_changed)
// ---------------------------------------------------------------------------
// Обращение к группе — на «вы» во множественном числе; из эмодзи — только масти.
// Правка времени или места (change = 'moved') — три поста по moveKind: «Вечер перенесён» (новое
// время), «Место вечера: …» (место вписали впервые), «Вечер переезжает: …» (место сменилось).

export interface AnnounceChangePostInput {
  eveningId: string;
  /** Что группа знала из прошлых постов. */
  before: AnnounceSnapshot;
  /** Вечер сейчас. */
  after: AnnounceSnapshot;
  /** Причина отмены (evenings.cancel_reason, миграция 010); в других постах не нужна. */
  reason: string | null;
  botUsername: string | null;
}

/** «19:00, 8 октября» → для «вместо …». */
function shortWhen(iso: string): string {
  return `${formatClubDate(iso)}, ${formatClubTime(iso)}`;
}

function placeLine(location: string | null): string {
  return location ? `Место: ${escapeHtml(location)}.` : 'Место уточним позже.';
}

/** «Время то же: в четверг, 8 октября, в 19:00.» — когда меняется только место. */
function sameTimeLine(iso: string): string {
  return `Время то же: ${formatWhen(iso)}.`;
}

const PLANS_LINE = 'Если планы поменялись, обновите ответ «иду / не иду».';

const rsvpButton = (input: AnnounceChangePostInput): UrlButton[] =>
  appButton(input.botUsername, '♣️ Иду / не иду', `e_${input.eveningId}`);

/**
 * «Вечер перенесён»: новое время, прежнее — для сверки. Место — если сменилось вместе со временем
 * («Новое место: … (было …)»), иначе как есть; места в анонсе не было — просто «Место: …».
 */
export function eveningRescheduledPost(input: AnnounceChangePostInput): Post {
  const { before, after } = input;
  const lines = [
    '♠️ <b>Вечер перенесён</b>',
    `Новое время: ${formatWhen(after.scheduledAt)} (было ${shortWhen(before.scheduledAt)}).`,
  ];
  if (samePlace(before, after) || before.location === null) {
    if (after.location) lines.push(placeLine(after.location));
  } else {
    lines.push(
      after.location
        ? `Новое место: ${escapeHtml(after.location)} (было ${escapeHtml(before.location)}).`
        : 'Место уточним позже.',
    );
  }
  lines.push('', PLANS_LINE);
  return { text: lines.join('\n'), buttons: rsvpButton(input) };
}

/** «Место вечера: …»: в анонсе места не было, теперь оно известно. Это уточнение, не перенос. */
export function eveningPlaceSetPost(input: AnnounceChangePostInput): Post {
  const { after } = input;
  return {
    text: [
      `♠️ <b>Место вечера: ${escapeHtml(after.location ?? '')}</b>`,
      sameTimeLine(after.scheduledAt),
    ].join('\n'),
    buttons: rsvpButton(input),
  };
}

/** «Вечер переезжает: …»: время прежнее, место сменилось; убрали место — «уточним позже». */
export function eveningRelocatedPost(input: AnnounceChangePostInput): Post {
  const { before, after } = input;
  const lines = after.location
    ? [`♠️ <b>Вечер переезжает: ${escapeHtml(after.location)}</b>`]
    : ['♠️ <b>Вечер переезжает</b>', 'Новое место уточним позже.'];
  if (before.location) lines.push(`Прежнее место: ${escapeHtml(before.location)}.`);
  lines.push(sameTimeLine(after.scheduledAt), '', PLANS_LINE);
  return { text: lines.join('\n'), buttons: rsvpButton(input) };
}

/** Пост о правке времени или места: какой из трёх — решает moveKind (_shared/announce.ts). */
export function eveningMovedPost(input: AnnounceChangePostInput): Post {
  const kind = moveKind(input.before, input.after);
  if (kind === 'place_set') return eveningPlaceSetPost(input);
  if (kind === 'relocated') return eveningRelocatedPost(input);
  return eveningRescheduledPost(input);
}

/** «Вечер 8 октября отменён» и причина отмены, если админ её указал. */
export function eveningCancelledPost(input: AnnounceChangePostInput): Post {
  const lines = [`♠️ <b>Вечер ${formatClubDate(input.before.scheduledAt)} отменён</b>`];
  const reason = input.reason?.trim();
  if (reason) lines.push(`Причина: ${escapeHtml(reason)}`);
  return { text: lines.join('\n'), buttons: [] };
}

/** Отменённый вечер вернули — он всё-таки состоится (возможно, уже в другое время). */
export function eveningRestoredPost(input: AnnounceChangePostInput): Post {
  const { after } = input;
  const lines = [
    `♠️ <b>Вечер ${formatClubDate(after.scheduledAt)} всё-таки состоится</b>`,
    `Приходите ${formatWhen(after.scheduledAt)}.`,
  ];
  if (after.location) lines.push(placeLine(after.location));
  lines.push('', 'Отметьтесь, идёте ли: прошлые ответы сохранились.');
  return {
    text: lines.join('\n'),
    buttons: appButton(input.botUsername, '♣️ Иду / не иду', `e_${input.eveningId}`),
  };
}

export function announceChangePost(change: AnnounceChange, input: AnnounceChangePostInput): Post {
  if (change === 'cancelled') return eveningCancelledPost(input);
  if (change === 'restored') return eveningRestoredPost(input);
  return eveningMovedPost(input);
}

// ---------------------------------------------------------------------------
// Пост в день игры (миграция 014, cron-tick; когда писать — _shared/gameday.ts)
// ---------------------------------------------------------------------------

export interface GamedayPostInput {
  eveningId: string;
  scheduledAt: string;
  location: string | null;
  /** display_name банкира, неэкранированное; null — банкир не назначен. */
  bankerName: string | null;
  roster: GamedayRoster;
  botUsername: string | null;
  /** «Сегодня» / «завтра» — относительно этого момента, по Москве. */
  nowMs: number;
  /** Сколько прогнозов на вечер уже сделано (непустые строки predictions, predictionsMade). */
  predictionsMade: number;
  /** «На кону» (домен — eveningStakes); нет — без этих строк. */
  stakes?: EveningStakes | null;
  /** Имена для «На кону» (display_name), неэкранированные. */
  names?: Record<PlayerId, string>;
}

/**
 * Строка о прогнозах в посте дня игры: прогноз принимается, пока вечер объявлен (set_prediction),
 * то есть до старта таймера. Сколько сделано — без содержимого: чужие прогнозы до старта скрыты (RLS).
 */
export function predictionsLine(made: number): string {
  const n = Math.max(0, Math.trunc(made));
  return `Прогнозы закрываются со стартом — ${n > 0 ? `сделано ${n}` : 'пока ни одного'}.`;
}

/** Сколько московских календарных дней от nowMs до iso: 0 — сегодня, 1 — завтра. */
function clubDaysAhead(nowMs: number, iso: string): number {
  const a = clubParts(nowMs);
  const b = clubParts(Date.parse(iso));
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/**
 * Упоминание игрока, который ещё не ответил. Есть username — «Имя (@username)»: Telegram сам
 * делает из @username упоминание. Нет — ссылка tg://user?id= на имя. Bot API («Formatting options»,
 * проверено 07.10.2026): такая ссылка работает только как inline-ссылка, а оговорка «гарантированно —
 * только если пользователь писал боту» касается тех, кто не состоит в чате; игроки клуба — участники
 * группы (tg-auth пускает только их). Без tg_id (профиль заведён админом) — просто имя.
 */
export function mentionHtml(player: GamedayPlayer): string {
  const name = escapeHtml(player.name);
  if (player.username) {
    const at = `@${player.username}`;
    // Имя из Telegram без имени и фамилии tg-auth собирает как «@username» — не повторяем его.
    return player.name.trim().toLowerCase() === at.toLowerCase() ? at : `${name} (${at})`;
  }
  if (player.tgId) return `<a href="tg://user?id=${player.tgId}">${name}</a>`;
  return name;
}

/**
 * Лимит текста sendMessage: «1-4096 characters after entities parsing» (Bot API, проверено
 * 07.10.2026) — считается видимый текст, без HTML-разметки.
 */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Видимая длина поста с parse_mode HTML — то, что Telegram сверяет с лимитом: без тегов, сущность
 * (&amp;, &lt;, &gt;, &quot; — других escapeHtml не ставит) — один символ. Меряем в UTF-16, как Bot
 * API меряет сущности: так длина не меньше числа символов, и запас — в нашу пользу.
 */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot);/g, '&').length;
}

// ---------------------------------------------------------------------------
// «На кону» в посте дня игры: кто в шаге от ачивки или рекорда и расклад сезона — до двух строк
// ---------------------------------------------------------------------------
// Что на кону, считает домен (eveningStakes); здесь только текст. О людях — без рода, в настоящем
// времени, имена — в именительном («цель — Дима»); эмодзи в этих строках нет.

/** Сколько шагов «На кону» помещается в пост: одна строка, без перегруза. */
export const GAMEDAY_STAKES_MAX = 2;

const winsText = (n: number): string => `${n}${NBSP}${plural(n, ['победа', 'победы', 'побед'])}`;

/** Шаг «На кону» одной фразой: «Саша — в одной победе от ачивки «Хет-трик»». */
export function stakeText(item: StakeItem, name: (id: PlayerId) => string): string {
  switch (item.kind) {
    case 'win_step': {
      const record =
        item.record === 'new'
          ? `рекорда клуба (${winsText(item.streak)} подряд)`
          : item.record === 'equal'
            ? `повтора рекорда клуба (${winsText(item.streak)} подряд)`
            : null;
      const goals = [item.hatTrick ? `ачивки «${ACHIEVEMENT_META.hat_trick.title}»` : null, record]
        .filter((x): x is string => x !== null)
        .join(' и ');
      return `${name(item.playerId)} — в одной победе от ${goals}`;
    }
    case 'enemy_step':
      return (
        `${name(item.playerId)} — в одном нокауте от ачивки «${ACHIEVEMENT_META.sworn_enemy.title}» ` +
        `(цель — ${name(item.victimId)})`
      );
    case 'first_blood':
      return `первый нокаут в истории клуба принесёт ачивку «${ACHIEVEMENT_META.first_blood.title}»`;
    case 'pool_record':
      return (
        `идут ${item.going} — фонд ещё до ребаев ` +
        `${item.status === 'new' ? 'побьёт' : 'повторит'} рекорд клуба (${formatRub(item.recordRub)})`
      );
    case 'oracle_step':
      return `${name(item.playerId)} — в одном угаданном победителе от ачивки «${ACHIEVEMENT_META.oracle.title}»`;
  }
}

/** Расклад сезона одной строкой; null — сказать нечего. */
export function seasonStakeText(
  season: NonNullable<EveningStakes['season']>,
  name: (id: PlayerId) => string,
): string | null {
  if (season.first)
    return `Сезон: первый вечер — ${formatSeason(season.seasonKey)} начинается с нуля.`;
  const [leader] = season.leaders;
  if (!leader) return null;
  if (season.leaders.length > 1)
    return (
      `Сезон: первое место делят ${joinNames(season.leaders.map((l) => name(l.playerId)))} — ` +
      `по ${formatPoints(leader.total)}.`
    );
  const head = `Сезон: лидер — ${name(leader.playerId)}, ${formatPoints(leader.total)}`;
  const [chaser] = season.chasers;
  if (!chaser) return `${head}.`;
  const who = joinNames(season.chasers.map((c) => name(c.playerId)));
  const tail =
    chaser.gap === 0
      ? `${who} — вровень по очкам`
      : `${who} ${season.chasers.length > 1 ? 'отстают' : 'отстаёт'} на ${formatPoints(chaser.gap)}`;
  return `${head}; ${tail}.`;
}

/**
 * «На кону» в посте дня игры: строка с первыми GAMEDAY_STAKES_MAX шагами (по важности домена) и
 * строка сезона. Нечего сказать — пусто.
 */
export function stakesLines(stakes: EveningStakes, names: Record<PlayerId, string>): string[] {
  const name = (id: PlayerId): string => escapeHtml(names[id] ?? 'Игрок');
  const lines: string[] = [];
  const items = stakes.items.slice(0, GAMEDAY_STAKES_MAX).map((i) => stakeText(i, name));
  if (items.length > 0) lines.push(`На кону: ${items.join('; ')}.`);
  const season = stakes.season ? seasonStakeText(stakes.season, name) : null;
  if (season) lines.push(season);
  return lines;
}

type GamedayList = 'yes' | 'maybe' | 'no' | 'pending';

/** Какой список укорачивать первым, если показано поровну: «идут» — последним. */
const GAMEDAY_TRIM_ORDER: readonly GamedayList[] = ['no', 'maybe', 'pending', 'yes'];

/**
 * Пост в день игры: когда и где, банкир, кто идёт, под вопросом, не идёт и кто из постоянных
 * игроков ещё не ответил (с упоминанием), «На кону» и сезон (stakesLines, до двух строк), в конце —
 * сколько сделано прогнозов (predictionsLine). Нет
 * места или банкира — так и пишем. Из эмодзи — только масти:
 * ♠️ в заголовке и ♣️ на кнопке (решение пользователя), строки списков — чистый текст.
 *
 * Длина. В «Ещё не ответили» попадают все активные постоянные игроки, кроме болельщиков (миграция
 * 024: кто ответил «слежу, не играю»), а tg-auth заводит игрока на каждого участника группы,
 * открывшего Mini App, — у большой группы видимый текст перерос бы лимит
 * Telegram (TELEGRAM_TEXT_LIMIT). sendMessage отклонил бы пост, publishOnce снял бы отметку, и пост не
 * ушёл бы ни на одном тике. Поэтому, пока текст не влезает, укорачиваем самый длинный из показанных
 * списков (при равенстве — в порядке GAMEDAY_TRIM_ORDER): первые по порядку остаются, хвост
 * становится «и ещё N» — без имён и упоминаний; число в скобках — по-прежнему все.
 */
export function gamedayPost(input: GamedayPostInput): Post {
  const { roster } = input;
  const time = formatClubTime(input.scheduledAt);
  const ahead = clubDaysAhead(input.nowMs, input.scheduledAt);
  const title =
    ahead === 0
      ? `Сегодня покер в ${time}`
      : ahead === 1
        ? `Завтра покер в ${time}`
        : `Покер ${formatWhen(input.scheduledAt)}`;

  const items: Record<GamedayList, string[]> = {
    yes: roster.yes.map((p) => escapeHtml(p.name)),
    maybe: roster.maybe.map((p) => escapeHtml(p.name)),
    no: roster.no.map((p) => escapeHtml(p.name)),
    pending: roster.pending.map(mentionHtml),
  };
  const shown: Record<GamedayList, number> = {
    yes: items.yes.length,
    maybe: items.maybe.length,
    no: items.no.length,
    pending: items.pending.length,
  };
  const group = (label: string, key: GamedayList): string => {
    const all = items[key];
    const n = shown[key];
    const head = `${label} (${all.length})`;
    if (n >= all.length) return `${head}: ${joinNames(all)}`;
    const rest = `ещё ${all.length - n}`;
    return n === 0 ? head : `${head}: ${all.slice(0, n).join(', ')} и ${rest}`;
  };

  const location = input.location?.trim();
  const banker = input.bankerName?.trim();
  const stakes = input.stakes ? stakesLines(input.stakes, input.names ?? {}) : [];
  const pending = roster.pending.length > 0;
  const maybe = roster.maybe.length > 0;
  const render = (): string => {
    const lines = [
      `♠️ <b>${title}</b>`,
      location ? `Место: ${escapeHtml(location)}` : 'Место пока не назначено',
      banker ? `Банкир: ${escapeHtml(banker)}` : 'Банкир пока не назначен',
      '',
      roster.yes.length > 0 ? group('Идут', 'yes') : 'Идут: пока никто',
    ];
    if (maybe) lines.push(group('Под вопросом', 'maybe'));
    if (roster.no.length > 0) lines.push(group('Не идут', 'no'));
    if (pending) lines.push(group('Ещё не ответили', 'pending'));
    if (stakes.length > 0) lines.push('', ...stakes);
    lines.push(
      '',
      pending && maybe
        ? 'Кто ещё не ответил или под вопросом — отметьтесь, идёте ли.'
        : pending
          ? 'Кто ещё не ответил — отметьтесь, идёте ли.'
          : maybe
            ? 'Кто под вопросом — отметьтесь, идёте ли.'
            : PLANS_LINE,
      predictionsLine(input.predictionsMade),
    );
    return lines.join('\n');
  };

  let text = render();
  let excess = visibleLength(text) - TELEGRAM_TEXT_LIMIT;
  while (excess > 0) {
    let key: GamedayList | null = null;
    for (const k of GAMEDAY_TRIM_ORDER) if (shown[k] > (key ? shown[key] : 0)) key = k;
    if (!key) break; // списки пусты, а текст всё равно длинный — резать больше нечего
    shown[key] -= 1;
    // Оценка: имя и разделитель «, ». Точную длину (с хвостом «и ещё N») проверяет перерисовка.
    excess -= visibleLength(items[key][shown[key]] ?? '') + 2;
    if (excess <= 0) {
      text = render();
      excess = visibleLength(text) - TELEGRAM_TEXT_LIMIT;
    }
  }
  return {
    text,
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
  /** Итог уже публиковался и был исправлен (отмена finish или правка журнала админом). */
  corrected?: boolean;
  /** «Жизнь клуба» (домен — eveningClubNews); нет или рассказывать нечего — блока нет. */
  clubNews?: EveningClubNews | null;
  /** «Сюжет вечера» для поста (домен — eveningStory с forPost); пусто — блока нет. */
  story?: readonly StoryItem[];
}

const MEDALS = ['🥇', '🥈', '🥉'];

const titleOf = (a: Achievement): string => escapeHtml(ACHIEVEMENT_META[a.code]?.title ?? a.code);

/** Сезонные ачивки — по порядку важности, а не по алфавиту кодов. */
const SEASON_ORDER: readonly Achievement['code'][] = ['champion', 'rebuy_king', 'iron_chair'];

/** Ачивки вечера — строкой на игрока. */
function eveningAchievementLines(
  list: readonly Achievement[],
  names: Record<PlayerId, string>,
): string[] {
  const name = (id: PlayerId): string => escapeHtml(names[id] ?? 'Игрок');
  const evening = list.filter((a) => a.seasonKey === null);
  if (evening.length === 0) return [];
  return [
    '',
    '🏅 <b>Новые ачивки</b>',
    ...evening.map(
      (a) => `• ${name(a.playerId)} — «${titleOf(a)}»${a.count > 1 ? ` ×${a.count}` : ''}`,
    ),
  ];
}

/**
 * Сезонные ачивки (их приносит первый вечер нового квартала) — отдельным блоком «итоги сезона»,
 * по званию со списком игроков. В посте — после всего, что касается самого вечера.
 */
function seasonAchievementLines(
  list: readonly Achievement[],
  names: Record<PlayerId, string>,
): string[] {
  const name = (id: PlayerId): string => escapeHtml(names[id] ?? 'Игрок');
  const lines: string[] = [];
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

// ---------------------------------------------------------------------------
// «Жизнь клуба» в посте итогов: прогнозы, рекорды, звания, сезон — по строке на тему
// ---------------------------------------------------------------------------
// Что рассказывать, считает домен (eveningClubNews); здесь только текст. Обращение — к группе, о
// людях — без рода: «Победителя угадали: Саша», «Звания: «Форма» — Саша». Из эмодзи — только масти
// (решение пользователя для новых постов и строк): ♣️ в заголовке блока.

/** Ключ сортировки по имени без локали (как в посте дня игры): регистр и «ё». */
const nameKey = (name: string): string => name.trim().toLowerCase().replace(/ё/g, 'е');

/** Значение рекорда: «+2 300 ₽», «6 000 ₽», «4 нокаута», «3 победы подряд», «3 ч 20 мин». */
export function recordValue(kind: RecordKind, value: number): string {
  switch (kind) {
    case 'biggest_win':
      return value > 0 ? `+${formatRub(value)}` : formatRub(value);
    case 'biggest_pool':
      return formatRub(value);
    case 'longest_game':
      return formatDuration(value);
    case 'most_kos':
      return `${value}${NBSP}${plural(value, ['нокаут', 'нокаута', 'нокаутов'])}`;
    case 'win_streak':
      return `${value}${NBSP}${plural(value, ['победа', 'победы', 'побед'])} подряд`;
  }
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Строка рекордов: «Новый рекорд клуба: самый большой фонд — 6 000 ₽ (прежний — 5 000 ₽).»
 * Несколько — через «;», без прежних значений (их показывает вкладка «Рекорды»); вперемешку новые и
 * повторённые — «Рекорды клуба: …», у повторённых пометка «(повторён)».
 */
function recordsLine(records: readonly RecordBreak[], name: (id: PlayerId) => string): string {
  const allNew = records.every((r) => r.status === 'new');
  const allEqualled = records.every((r) => r.status === 'equalled');
  const single = records.length === 1;
  const label = allNew
    ? single
      ? 'Новый рекорд клуба'
      : 'Новые рекорды клуба'
    : allEqualled
      ? single
        ? 'Рекорд клуба повторён'
        : 'Повторены рекорды клуба'
      : 'Рекорды клуба';
  const parts = records.map((r) => {
    const who = r.playerIds.length > 0 ? `${joinNames(r.playerIds.map(name))}, ` : '';
    const was =
      single && r.status === 'new' && r.previous !== null
        ? ` (прежний — ${recordValue(r.kind, r.previous)})`
        : '';
    const mark = !allNew && !allEqualled && r.status === 'equalled' ? ' (повторён)' : '';
    return `${lowerFirst(RECORD_META[r.kind].title)} — ${who}${recordValue(r.kind, r.value)}${was}${mark}`;
  });
  return `${label}: ${parts.join('; ')}.`;
}

/**
 * Строка званий: «Звания: «Форма» — Саша (прежде — Дима); Дима — Немезида игрока Лёша.» Немезиды
 * одного держателя — вместе: «Дима — Немезида игроков Саша и Лёша».
 */
function titlesLine(changes: readonly TitleChange[], name: (id: PlayerId) => string): string {
  const parts: string[] = [];
  const form = changes.find((t) => t.title === 'form');
  if (form) {
    const before = form.from !== null ? ` (прежде — ${name(form.from)})` : '';
    parts.push(`«${TITLE_META.form.title}» — ${name(form.to)}${before}`);
  }
  const victimsBy = new Map<PlayerId, PlayerId[]>();
  for (const t of changes) {
    if (t.title !== 'nemesis' || t.victimId === null) continue;
    victimsBy.set(t.to, [...(victimsBy.get(t.to) ?? []), t.victimId]);
  }
  for (const [holder, victims] of victimsBy) {
    const whom = `${victims.length > 1 ? 'игроков' : 'игрока'} ${joinNames(victims.map(name))}`;
    parts.push(`${name(holder)} — ${TITLE_META.nemesis.title} ${whom}`);
  }
  return `Звания: ${parts.join('; ')}.`;
}

/** Строка сезона: новый лидер (или делёж первого места) и самый большой подъём в таблице. */
function seasonLine(
  season: NonNullable<EveningClubNews['season']>,
  name: (id: PlayerId) => string,
): string {
  const parts: string[] = [];
  const [leader] = season.leaders;
  if (leader && season.leaders.length === 1) {
    parts.push(
      season.leadersBefore.includes(leader.playerId)
        ? `${name(leader.playerId)} — единоличный лидер, ${formatPoints(leader.total)}`
        : `новый лидер — ${name(leader.playerId)}, ${formatPoints(leader.total)}`,
    );
  } else if (leader) {
    parts.push(
      `первое место делят ${joinNames(season.leaders.map((l) => name(l.playerId)))} — ` +
        `по ${formatPoints(leader.total)}`,
    );
  }
  const [climb] = season.climbers;
  if (climb && season.climbers.length === 1) {
    parts.push(`рывок — ${name(climb.playerId)}, с ${climb.from}-го места на ${climb.to}-е`);
  } else if (climb) {
    const by = climb.from - climb.to;
    parts.push(
      `рывок на ${by} ${plural(by, ['место', 'места', 'мест'])} вверх — ` +
        joinNames(season.climbers.map((c) => name(c.playerId))),
    );
  }
  return `Сезон: ${parts.join('; ')}.`;
}

/**
 * Блок «Жизнь клуба» поста итогов: заголовок и до четырёх строк — прогнозы, рекорды, звания, сезон.
 * Строка темы — только если в ней есть что сказать; нечего во всех — блока нет (пустой массив).
 */
export function clubNewsLines(news: EveningClubNews, names: Record<PlayerId, string>): string[] {
  const name = (id: PlayerId): string => escapeHtml(names[id] ?? 'Игрок');
  const byName = (ids: readonly PlayerId[]): string =>
    joinNames(
      [...ids]
        .sort((a, b) => {
          const x = nameKey(names[a] ?? '');
          const y = nameKey(names[b] ?? '');
          return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
        })
        .map(name),
    );

  const lines: string[] = [];
  const p = news.predictions;
  if (p.made > 0) {
    const guessed = [
      p.winnerGuessedBy.length > 0 && `Победителя угадали: ${byName(p.winnerGuessedBy)}.`,
      p.firstOutGuessedBy.length > 0 && `Первый вылет угадали: ${byName(p.firstOutGuessedBy)}.`,
    ].filter((s): s is string => typeof s === 'string');
    lines.push(
      guessed.length > 0
        ? guessed.join(' ')
        : `${p.made === 1 ? 'Прогноз не сбылся' : 'Прогнозы не сбылись'}: ` +
            'победителя и первый вылет никто не угадал.',
    );
  }
  // Повторённый рекорд вечера (фонд, длина игры) — не новость: фонд повторяется всякий раз, когда
  // играет столько же человек без ребаев. Повторённый рекорд игрока — история, его оставляем.
  const records = news.records.filter(
    (r) => r.status === 'new' || RECORD_META[r.kind].scope === 'player',
  );
  if (records.length > 0) lines.push(recordsLine(records, name));
  if (news.titleChanges.length > 0) lines.push(titlesLine(news.titleChanges, name));
  if (news.season) lines.push(seasonLine(news.season, name));
  return lines.length > 0 ? ['', '♣️ <b>Жизнь клуба</b>', ...lines] : [];
}

// ---------------------------------------------------------------------------
// «Сюжет вечера» в посте итогов (домен — eveningStory с forPost): главное о вечере, без того, что
// пост говорит другими блоками. О людях — в настоящем времени, без рода, имена — в именительном;
// из эмодзи — ♠️ в заголовке блока (решение пользователя для новых строк: только масти).
// ---------------------------------------------------------------------------

const STREET_PHRASE: Record<'preflop' | 'flop' | 'turn' | 'river', string> = {
  preflop: 'до флопа',
  flop: 'на флопе',
  turn: 'на тёрне',
  river: 'на ривере',
};

/** «18 %»; ноль на табло — «меньше 1 %». */
function pctText(pct: number): string {
  return pct > 0 ? `${pct}${NBSP}%` : `меньше 1${NBSP}%`;
}

/** Строка сюжета: «Женя забирает олл-ин с 13 % до флопа; фаворит — Саша, 87 %.» */
export function storyText(item: StoryItem, name: (id: PlayerId) => string): string {
  switch (item.kind) {
    case 'swing': {
      const s = item.swing;
      const favs = s.favoriteIds.map(name);
      const fav =
        favs.length > 1
          ? `фавориты — ${joinNames(favs)}, по ${pctText(s.favoritePct)}`
          : `фаворит — ${favs[0] ?? 'Игрок'}, ${pctText(s.favoritePct)}`;
      return `${name(s.winnerId)} забирает олл-ин с ${pctText(s.pct)} ${STREET_PHRASE[s.street]}; ${fav}.`;
    }
    case 'revenge':
      return `Месть Немезиде: ${name(item.playerId)} выбивает игрока ${name(item.nemesisId)}.`;
    case 'phoenix':
      return `Феникс вечера — ${name(item.playerId)}: первый вылет и победа.`;
    case 'comeback':
      return item.rebuys === 1
        ? `${name(item.playerId)} выигрывает вечер после ребая.`
        : `${name(item.playerId)} выигрывает вечер после ${item.rebuys} ребаев.`;
    case 'record': {
      const r = item.record;
      const who = r.playerIds.length > 0 ? `${joinNames(r.playerIds.map(name))}, ` : '';
      const label = r.status === 'new' ? 'Новый рекорд клуба' : 'Рекорд клуба повторён';
      return `${label}: ${lowerFirst(RECORD_META[r.kind].title)} — ${who}${recordValue(r.kind, r.value)}.`;
    }
    case 'season_leader': {
      const [leader] = item.leaders;
      if (!leader) return '';
      if (item.leaders.length > 1)
        return `Первое место сезона делят ${joinNames(item.leaders.map((l) => name(l.playerId)))}.`;
      return item.leadersBefore.includes(leader.playerId)
        ? `${name(leader.playerId)} — единоличный лидер сезона, ${formatPoints(leader.total)}.`
        : `Новый лидер сезона — ${name(leader.playerId)}, ${formatPoints(leader.total)}.`;
    }
  }
}

/** Блок «Сюжет вечера»: заголовок и строки; сюжета нет — пусто. */
export function storyLines(items: readonly StoryItem[], names: Record<PlayerId, string>): string[] {
  const name = (id: PlayerId): string => escapeHtml(names[id] ?? 'Игрок');
  const lines = items.map((item) => storyText(item, name)).filter((line) => line !== '');
  return lines.length > 0 ? ['', '♠️ <b>Сюжет вечера</b>', ...lines] : [];
}

export function resultsPost(input: ResultsPostInput): Post {
  const name = (id: PlayerId): string => escapeHtml(input.names[id] ?? 'Игрок');
  const header = [
    input.corrected
      ? `♠️ <b>Исправленные итоги вечера ${formatClubDate(input.scheduledAt)}</b>`
      : `♠️ <b>Итоги вечера ${formatClubDate(input.scheduledAt)}</b>`,
  ];
  if (input.corrected) header.push('Прошлый пост с итогами устарел — верны эти.');
  if (input.location) header.push(`📍 ${escapeHtml(input.location)}`);

  // Выигрыш — только призовые за место: денег за нокауты нет (баунти убрано 07.10.2026).
  const placeLines = input.places.map((id, i) => {
    const prizeRub = input.money[id]?.prizeRub ?? 0;
    const mark = MEDALS[i] ?? `${i + 1}.`;
    const who = i === 0 ? `<b>${name(id)}</b>` : name(id);
    return `${mark} ${who}${prizeRub > 0 ? ` — приз ${formatRub(prizeRub)}` : ''}`;
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

  // Лучший охотник: больше всех нокаутов (только статистика, денег за нокаут нет); ничья — все лидеры.
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

  lines.push(...eveningAchievementLines(input.newAchievements, input.names));
  if (input.story) lines.push(...storyLines(input.story, input.names));
  if (input.clubNews) lines.push(...clubNewsLines(input.clubNews, input.names));
  lines.push(...seasonAchievementLines(input.newAchievements, input.names));

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

// ---------------------------------------------------------------------------
// Напоминание о голосовании (cron-tick, за 3 ч до закрытия; когда — _shared/votingReminder.ts)
// ---------------------------------------------------------------------------

export interface VotingReminderPostInput {
  eveningId: string;
  scheduledAt: string;
  votingClosesAt: string;
  /** Сколько игроков вечера уже проголосовали хотя бы в одной номинации. */
  voted: number;
  /** Сколько игроков вечера могут голосовать (votingTurnout). */
  eligible: number;
  botUsername: string | null;
}

/**
 * «проголосовали 3 из 7», «проголосовал 1 из 7» (число на 1 — глагол в единственном),
 * «пока никто не проголосовал».
 */
export function turnoutText(voted: number, eligible: number): string {
  if (voted <= 0) return 'пока никто не проголосовал';
  const one = voted % 10 === 1 && voted % 100 !== 11;
  return `${one ? 'проголосовал' : 'проголосовали'} ${voted} из ${eligible}`;
}

/** Из эмодзи — только масти (решение пользователя для новых постов): ♠️ в заголовке, ♣️ на кнопке. */
export function votingReminderPost(input: VotingReminderPostInput): Post {
  return {
    text: [
      `♠️ <b>Голосование закрывается в ${formatClubTime(input.votingClosesAt)} — ` +
        `${turnoutText(input.voted, input.eligible)}</b>`,
      `Кто играл и ещё не голосовал — выберите руку, блеф и бэд-бит вечера ${formatClubDate(input.scheduledAt)}.`,
    ].join('\n'),
    buttons: appButton(input.botUsername, '♣️ Голосовать', `v_${input.eveningId}`),
  };
}

// ---------------------------------------------------------------------------
// Проверка подключения группы (bot-setup, action 'test')
// ---------------------------------------------------------------------------

/**
 * Проверочный пост из админки «Клуб»: бот может писать в группу. Кнопка — ссылка на Mini App
 * (если имя бота уже сохранено): заодно видно, что прямая ссылка открывает приложение.
 */
export function botConnectedPost(botUsername: string | null): Post {
  return {
    text: [
      '♠️ <b>Бот клуба подключён</b>',
      'Сюда будут приходить анонсы вечеров, итоги и результаты голосований.',
      'Это проверочное сообщение, отвечать на него не нужно.',
    ].join('\n'),
    buttons: appButton(botUsername, '♣️ Открыть клуб', ''),
  };
}
