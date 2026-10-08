// Подписи «Итогов сезона» и календаря сезона на экранах: отсчёт «до конца сезона — 3 пятницы», финал
// сезона, «Твой сезон», лауреаты. Что считать — домен (seasonRecap, seasonCalendar); здесь только текст.
// Голос «Материи», к игроку — на «ты», без родовых форм.
import {
  achievementTitle,
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_META,
  type Achievement,
  type AchievementCode,
} from '@domain/achievements.ts';
import { seasonEndMs } from '@domain/seasonCalendar.ts';
import type { RaceTiebreak, SeasonRace } from '@domain/seasonRace.ts';
import type { PlayerSeason, SeasonTop, SeasonRecap } from '@domain/seasonRecap.ts';
import type { PlayerId } from '@domain/types.ts';
import { formatDate, formatPoints, formatRubSigned, NBSP, plural } from './format';
import { formatSeasonGenitive } from './season';
import {
  countedSummary,
  eveningsCount,
  formatPointsWithUnit,
  joinNames,
  kosCount,
  pointsWord,
  winsCount,
} from './text';

/** Строка «До конца сезона» в «Гонке сезона» выделена, когда игровых дней осталось не больше этого. */
export const SEASON_COUNTDOWN_DAYS = 4;

/** Дни недели в нумерации settings.game_weekday (1 = пн): «1 пятница», «3 пятницы», «5 пятниц». */
const WEEKDAY_FORMS: Readonly<Record<number, readonly [string, string, string]>> = {
  1: ['понедельник', 'понедельника', 'понедельников'],
  2: ['вторник', 'вторника', 'вторников'],
  3: ['среда', 'среды', 'сред'],
  4: ['четверг', 'четверга', 'четвергов'],
  5: ['пятница', 'пятницы', 'пятниц'],
  6: ['суббота', 'субботы', 'суббот'],
  7: ['воскресенье', 'воскресенья', 'воскресений'],
};

/** «3 пятницы»; неизвестный день недели — «3 игровых дня». */
export function weekdayCount(n: number, weekday: number): string {
  const forms = WEEKDAY_FORMS[weekday];
  return forms
    ? `${n}${NBSP}${plural(n, forms)}`
    : `${n}${NBSP}${plural(n, ['игровой день', 'игровых дня', 'игровых дней'])}`;
}

/** Дата начала следующего сезона — когда подводятся итоги: «1 января». */
export function seasonResultsDate(seasonKey: string): string {
  const end = seasonEndMs(seasonKey);
  return formatDate(end, end);
}

/** Пометка финала в карточке анонса: «Финал сезона — последний вечер 4-го квартала 2026». */
export function finaleText(seasonKey: string): string {
  return `Финал сезона — последний вечер ${formatSeasonGenitive(seasonKey)}`;
}

/** Показатель «Твоего сезона» для Stats: подпись, число, единица, подпись под числом. */
export interface SeasonStat {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}

/**
 * «Твой сезон»: место, очки (сколько вечеров в зачёте), победы и нокауты, нетто. Без игр в сезоне (только
 * прогнозы или ачивки) — место «—» и «Оракул», если были прогнозы: нулевые очки, победы и нетто ничего не
 * говорят, а подпись к очкам без вечеров («Вечеров в сезоне ещё не было») у прошедшего сезона — неправда.
 * Место в «Оракуле» игрока за столом экран пишет строкой под показателями.
 */
export function mySeasonStats(ps: PlayerSeason): SeasonStat[] {
  if (ps.place === null) {
    const out: SeasonStat[] = [{ label: 'Место', value: '—', note: 'в этом сезоне без игр' }];
    if (ps.oracle) {
      out.push({
        label: 'Оракул',
        value: formatPoints(ps.oracle.total),
        unit: pointsWord(ps.oracle.total),
        note: `${ps.oracle.place}-е место`,
      });
    }
    return out;
  }
  return [
    { label: 'Место', value: String(ps.place), unit: `из${NBSP}${ps.of}` },
    {
      label: 'Очки',
      value: formatPoints(ps.total),
      note: countedSummary(ps.counted, ps.played),
    },
    {
      label: 'Победы и нокауты',
      value: String(ps.wins),
      unit: plural(ps.wins, ['победа', 'победы', 'побед']),
      note: kosCount(ps.kos),
    },
    { label: 'Нетто', value: formatRubSigned(ps.netRub), note: eveningsCount(ps.played) },
  ];
}

/** «Твой сезон» одной строкой (главная): «2-е место из 5 · 18,5 очка · 3 победы · +1 500 ₽». */
export function mySeasonLine(ps: PlayerSeason): string {
  const parts =
    ps.place !== null
      ? [
          `${ps.place}-е место из${NBSP}${ps.of}`,
          formatPointsWithUnit(ps.total),
          winsCount(ps.wins),
          kosCount(ps.kos),
          formatRubSigned(ps.netRub),
        ]
      : ['В этом сезоне без игр'];
  if (ps.oracle) parts.push(`Оракул — ${ps.oracle.place}-е место`);
  return parts.join(' · ');
}

/**
 * Ачивки сезона одной строкой: по коду — старший уровень и число выдач: «Охотник II ×2, Чистая победа,
 * Чемпион сезона». Порядок — каталог.
 */
export function seasonAchievementsLine(list: readonly Achievement[]): string {
  const byCode = new Map<AchievementCode, { level: number; count: number }>();
  for (const a of list) {
    const cur = byCode.get(a.code) ?? { level: 0, count: 0 };
    byCode.set(a.code, { level: Math.max(cur.level, a.level), count: cur.count + a.count });
  }
  return [...byCode]
    .sort(([a], [b]) => ACHIEVEMENT_CODES.indexOf(a) - ACHIEVEMENT_CODES.indexOf(b))
    .map(([code, { level, count }]) => {
      const title = achievementTitle(code, level);
      return count > 1 ? `${title} ×${count}` : title;
    })
    .join(', ');
}

/** Лауреат сезона: номинация, кто (ничья — все) и значение. */
export interface SeasonLaureate {
  id: 'oracle' | 'money' | 'hunter' | 'rebuy_king' | 'iron_chair';
  title: string;
  playerIds: PlayerId[];
  /** «17 очков за прогнозы», «+3 500 ₽», «14 нокаутов»; у ачивок — их описание. */
  value: string;
}

const leaderIds = (leader: SeasonTop | null): PlayerId[] => leader?.playerIds ?? [];

/**
 * Лауреаты сезона кроме подиума: «Оракул сезона», лидер по деньгам, лучший охотник и сезонные ачивки
 * («Ребай-король», «Железный стул» — только у закрытого сезона). Номинации без лауреата нет в списке.
 */
export function seasonLaureates(recap: SeasonRecap): SeasonLaureate[] {
  const out: SeasonLaureate[] = [];
  if (recap.oracleLeader) {
    out.push({
      id: 'oracle',
      title: 'Оракул сезона',
      playerIds: leaderIds(recap.oracleLeader),
      value: `${formatPointsWithUnit(recap.oracleLeader.value)} за${NBSP}прогнозы`,
    });
  }
  if (recap.moneyLeader) {
    out.push({
      id: 'money',
      title: 'Лидер по деньгам',
      playerIds: leaderIds(recap.moneyLeader),
      value: formatRubSigned(recap.moneyLeader.value),
    });
  }
  if (recap.hunters) {
    out.push({
      id: 'hunter',
      title: 'Лучший охотник',
      playerIds: leaderIds(recap.hunters),
      value: kosCount(recap.hunters.value),
    });
  }
  for (const code of ['rebuy_king', 'iron_chair'] as const) {
    const holders = recap.achievements.filter(
      (a) => a.code === code && a.seasonKey === recap.seasonKey,
    );
    if (holders.length > 0) {
      out.push({
        id: code,
        title: ACHIEVEMENT_META[code].title,
        playerIds: holders.map((a) => a.playerId),
        value: ACHIEVEMENT_META[code].description,
      });
    }
  }
  return out;
}

/** «12 вечеров · в зачёт — лучшие 10»: сколько в зачёт, говорим, только если вечеров было больше. */
export function seasonMetaLine(recap: Pick<SeasonRecap, 'eveningIds' | 'bestN'>): string {
  const n = recap.eveningIds.length;
  const counted = n > recap.bestN ? ` · в зачёт — лучшие ${recap.bestN}` : '';
  return `${eveningsCount(n)}${counted}`;
}

/** Подиум для показа: место, кто, очки словами («42,5 очка»). */
export function podiumView(
  recap: Pick<SeasonRecap, 'podium'>,
): { place: number; playerIds: PlayerId[]; value: string }[] {
  return recap.podium.map((step) => ({
    place: step.place,
    playerIds: step.playerIds,
    value: formatPointsWithUnit(step.total),
  }));
}

// --- Гонка сезона (главная) --------------------------------------------------------------------

/** «2-го места». */
const placeOf = (place: number): string => `${place}-го места`;

/** Чем отделено место при равных очках: «по победам», «по нокаутам». */
const TIEBREAK_TEXT: Record<RaceTiebreak, string> = {
  wins: 'по победам',
  kos: 'по нокаутам',
};

/** Строка «Гонки сезона»: о чём она (экран выбирает значок) и текст. */
export interface RaceLine {
  kind: 'top' | 'tie' | 'above' | 'leader' | 'below';
  text: string;
}

/**
 * Строки «Гонки сезона» о соседях, на «ты» и без рода: «До 2-го места — 1,5 очка · Саша», «До 1-го
 * места — 4 очка · Дима», «Отрыв от 4-го места — 2 очка · Женя»; при равных очках — «2-е место —
 * столько же очков, выше по победам · Саша»; делёж — «Делёж 2-го места: ты и Саша»; лидер — «Первое
 * место — твоё».
 */
export function raceLines(race: SeasonRace, nameOf: (id: PlayerId) => string): RaceLine[] {
  const names = (ids: readonly PlayerId[]): string => joinNames(ids.map(nameOf));
  const out: RaceLine[] = [];
  if (race.tiedWith.length > 0) {
    out.push({ kind: 'tie', text: `Делёж ${placeOf(race.place)}: ты и ${names(race.tiedWith)}` });
  } else if (race.place === 1) {
    out.push({ kind: 'top', text: 'Первое место — твоё' });
  }
  for (const [kind, rival] of [
    ['above', race.above],
    ['leader', race.leader],
  ] as const) {
    if (!rival) continue;
    out.push({
      kind,
      text:
        rival.gap > 0
          ? `До ${placeOf(rival.place)} — ${formatPointsWithUnit(rival.gap)} · ${names(rival.playerIds)}`
          : `${rival.place}-е место — столько же очков, выше ${TIEBREAK_TEXT[rival.tiebreak ?? 'wins']} · ${names(rival.playerIds)}`,
    });
  }
  const below = race.below;
  if (below) {
    out.push({
      kind: 'below',
      text:
        below.gap > 0
          ? `Отрыв от ${placeOf(below.place)} — ${formatPointsWithUnit(below.gap)} · ${names(below.playerIds)}`
          : `${below.place}-е место — столько же очков, ты выше ${TIEBREAK_TEXT[below.tiebreak ?? 'wins']} · ${names(below.playerIds)}`,
    });
  }
  return out;
}

/** Очки в родительном после «больше»: «больше 1 очка», «больше 2 очков», «больше 1,5 очка». */
function pointsGenitive(points: number): string {
  const word = Number.isInteger(points) ? plural(points, ['очка', 'очков', 'очков']) : 'очка';
  return `${formatPoints(points)}${NBSP}${word}`;
}

/** Подпись к очкам в гонке: «в зачёте 3 из 10 вечеров». */
export function raceCountedNote(race: Pick<SeasonRace, 'counted' | 'bestN'>): string {
  return `в зачёте ${race.counted} из${NBSP}${race.bestN} ${plural(race.bestN, ['вечера', 'вечеров', 'вечеров'])}`;
}

/**
 * Все места зачёта заняты: «Все 10 мест зачёта заняты — новый вечер пойдёт в зачёт, если даст
 * больше 2 очков». Места есть — null.
 */
export function raceFullHint(race: Pick<SeasonRace, 'bestN' | 'weakestCounted'>): string | null {
  if (race.weakestCounted === null) return null;
  const places =
    race.bestN === 1
      ? 'Единственное место зачёта занято'
      : `Все ${race.bestN} ${plural(race.bestN, ['место', 'места', 'мест'])} зачёта заняты`;
  return `${places} — новый вечер пойдёт в зачёт, если даст больше ${pointsGenitive(race.weakestCounted)}`;
}

/** Лидер сезона для того, кого нет в таблице: «Лидер сезона — Дима · 18 очков» (делёж — все). */
export function raceLeaderLine(
  leaders: readonly PlayerId[],
  total: number,
  nameOf: (id: PlayerId) => string,
): string {
  const who = joinNames(leaders.map(nameOf));
  return `${leaders.length > 1 ? 'Лидеры' : 'Лидер'} сезона — ${who} · ${formatPointsWithUnit(total)}`;
}

/**
 * Сколько игровых дней по расписанию осталось (gameDaysLeft) — всегда, а не только в последние недели:
 * «До конца сезона — 12 пятниц»; 0 — «Игр в сезоне по расписанию больше нет — итоги 1 января». Слотов
 * не осталось, но вечер сезона ещё объявлен или идёт (eveningPending: финал в разгаре, перенесён на
 * другой день или назначен вне расписания) — null: «игр больше нет» было бы неправдой, а строки без
 * отсчёта не нужно — сам вечер на главной выше (анонс или идущая игра).
 */
export function seasonDaysLeftText(
  daysLeft: number,
  weekday: number,
  seasonKey: string,
  eveningPending: boolean,
): string | null {
  if (daysLeft > 0) return `До конца сезона — ${weekdayCount(daysLeft, weekday)}`;
  if (eveningPending) return null;
  return `Игр в сезоне по расписанию больше нет — итоги ${seasonResultsDate(seasonKey)}`;
}
