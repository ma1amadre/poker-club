// Лента «В клубе» на главной: подписи строк к событиям доменной ленты (clubEvents + clubMoments).
// Ничего не пересчитывает — события, рекорды и звания считает домен (feed.ts, records.ts); вход
// домена из истории клуба — clubFeedInput (shared/api/history).
import { ACHIEVEMENT_META } from '@domain/achievements.ts';
import type { FeedItem } from '@domain/feed.ts';
import { VOTE_CATEGORY_META } from '@domain/votes.ts';
import type { Player } from '../../shared/api/types';
// Только чистое форматирование (Intl), без React: модуль тестируется в node.
import { CLUB_TZ, formatDate, formatRub, NBSP, plural } from '../../shared/lib/format';
import { paths } from '../../shared/lib/paths';
import { formatSeason } from '../../shared/lib/season';
import { capitalize, joinNames, kosCount, playersCount } from '../../shared/lib/text';
// «Твой вечер», лента и «Рекорды» говорят об ачивках и рекордах одинаково.
import { ACHIEVEMENT_SHORT, recordTitleLower, recordValueText } from '../../shared/lib/clubLife';
import type { IconName } from '../../shared/ui/icons';
import { nameWithMe } from './lib';

/** Сколько событий ленты показывать на главной. */
export const FEED_LIMIT = 8;

// --- Относительная дата ----------------------------------------------------------------------

const clubDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLUB_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clubWeekday = new Intl.DateTimeFormat('en-US', { timeZone: CLUB_TZ, weekday: 'short' });

/** Номер московского дня (дни от эпохи) — для разницы «сегодня/вчера». */
function dayNumber(ms: number): number {
  const [y, m, d] = clubDay.format(new Date(ms)).split('-').map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

const WEEKDAY_ACC: Record<string, string> = {
  Mon: 'в понедельник',
  Tue: 'во вторник',
  Wed: 'в среду',
  Thu: 'в четверг',
  Fri: 'в пятницу',
  Sat: 'в субботу',
  Sun: 'в воскресенье',
};

/** Номер дня недели по Москве: понедельник — 0. */
const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/**
 * Когда это было, по Москве: «сегодня», «вчера», раньше на этой неделе — «в понедельник», ещё
 * раньше — «1 октября» (другой год — с годом). Название дня — только в пределах текущей недели:
 * «в четверг» о прошлом четверге рядом с анонсом на этот четверг читалось бы как будущее.
 */
export function relativeDay(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const diff = dayNumber(nowMs) - dayNumber(ms);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  const todayIndex = WEEKDAY_INDEX[clubWeekday.format(new Date(nowMs))] ?? 0;
  if (diff > 1 && diff <= todayIndex) {
    const day = WEEKDAY_ACC[clubWeekday.format(new Date(ms))];
    if (day) return day;
  }
  return formatDate(ms, nowMs);
}

// --- Строки ленты ----------------------------------------------------------------------------

export interface FeedRow {
  id: string;
  icon: IconName;
  title: string;
  /** Вторая строка: когда и подробности через «·», с заглавной. */
  subtitle: string;
  to: string;
  /** Подпись лучшего голоса момента — экран оборачивает в «ёлочки». */
  caption: string | null;
  /** Путь фото в Storage (vote-photos) — экран берёт подписанную ссылку. */
  photoPath: string | null;
  /** Что на фото — для скринридера. */
  photoAlt: string | null;
}

type Names = ReadonlyMap<string, Pick<Player, 'display_name'>>;

export interface FeedContext {
  names: Names;
  meId: string;
  nowMs: number;
  /**
   * Дата вечера (evenings.scheduled_at) по id: события вечера подписываются его днём, а не
   * моментом finish — игра, закончившаяся после полуночи, всё равно «четверговая».
   */
  eveningDates: ReadonlyMap<string, string>;
}

/**
 * Когда подписать событие: всё, что относится к вечеру (итог, ачивки, звания, рекорды и моменты
 * голосования), — днём вечера, как в «Истории → Моменты»; сезонные ачивки — концом сезона.
 * Момент стоит в ленте по времени закрытия голосования, но «Рука вечера · в пятницу» о четверговой
 * игре читалась бы как рука другого вечера.
 */
function dayOf(item: FeedItem, ctx: FeedContext): string {
  const date = (item.eveningId && ctx.eveningDates.get(item.eveningId)) || item.at;
  return relativeDay(date, ctx.nowMs);
}

function line(parts: readonly (string | null | false | undefined)[]): string {
  return capitalize(parts.filter(Boolean).join(' · '));
}

/** Подписи строки ленты: тип события → значок, фраза «что — кто», когда и куда ведёт тап. */
export function feedRow(item: FeedItem, ctx: FeedContext): FeedRow {
  const { meId } = ctx;
  const name = (id: string) => nameWithMe(ctx.names, id, meId);
  const many = (ids: readonly string[]) => joinNames(ids.map(name));
  const day = dayOf(item, ctx);
  const base = { id: item.id, caption: null, photoPath: null, photoAlt: null };

  switch (item.type) {
    case 'evening_result':
      return {
        ...base,
        icon: 'trophy',
        title: item.winnerId ? `Победа — ${name(item.winnerId)}` : 'Вечер завершён',
        subtitle: line([
          day,
          playersCount(item.entrants),
          item.prizePoolRub !== null && `фонд ${formatRub(item.prizePoolRub)}`,
          item.topHunters.length > 0 &&
            `лучший охотник — ${many(item.topHunters)}, ${kosCount(item.topHunterKos)}`,
          item.winnerGuessedBy.length > 0 && `победителя угадали: ${many(item.winnerGuessedBy)}`,
        ]),
        to: paths.evening(item.eveningId),
      };

    case 'achievement': {
      const meta = ACHIEVEMENT_META[item.code];
      return {
        ...base,
        icon: 'shield-check',
        title: `Ачивка «${meta.title}» — ${name(item.playerId)}`,
        subtitle: line([
          day,
          ACHIEVEMENT_SHORT[item.code],
          item.seasonKey !== null && formatSeason(item.seasonKey),
        ]),
        to: paths.player(item.playerId),
      };
    }

    case 'title_change': {
      const before = item.from !== null && `прежде — ${name(item.from)}`;
      if (item.title === 'form') {
        return {
          ...base,
          icon: 'crown',
          title: `Звание «Форма» — ${name(item.to)}`,
          subtitle: line([day, 'больше всех очков за последние 5 вечеров клуба', before]),
          to: paths.player(item.to),
        };
      }
      const victim = item.victimId ?? '';
      // Подпись согласована с заголовком: подлежащее «ты» — глагол во втором лице.
      const [title, meaning] =
        victim === meId
          ? [`Твоя Немезида — ${name(item.to)}`, 'чаще всех выбивает тебя']
          : item.to === meId
            ? [`Ты — Немезида игрока ${name(victim)}`, 'чаще всех выбиваешь этого игрока']
            : [
                `Немезида игрока ${name(victim)} — ${name(item.to)}`,
                'чаще всех выбивает этого игрока',
              ];
      return {
        ...base,
        icon: 'crown',
        title,
        subtitle: line([day, meaning, before]),
        to: paths.player(item.to),
      };
    }

    case 'moment': {
      const category = VOTE_CATEGORY_META[item.category].title;
      return {
        ...base,
        icon: 'star',
        title: `${category} — ${name(item.nomineeId)}`,
        subtitle: line([
          day,
          `${item.votes}${NBSP}${plural(item.votes, ['голос', 'голоса', 'голосов'])}`,
          item.tie && 'номинацию делят несколько игроков',
        ]),
        to: paths.vote(item.eveningId),
        caption: item.caption,
        photoPath: item.photoPath,
        photoAlt: item.photoPath ? `Фото к номинации «${category}»` : null,
      };
    }

    case 'record': {
      const value = recordValueText(item.kind, item.value);
      return {
        ...base,
        icon: 'trending-up',
        title: `${item.status === 'new' ? 'Новый рекорд' : 'Рекорд повторён'}: ${recordTitleLower(item.kind)}`,
        subtitle: line([
          day,
          item.playerIds.length > 0 ? `${many(item.playerIds)} — ${value}` : value,
          item.previous !== null &&
            item.status === 'new' &&
            `прежний — ${recordValueText(item.kind, item.previous)}`,
        ]),
        to: paths.ratingRecords,
      };
    }
  }
}

type NemesisChange = Extract<FeedItem, { type: 'title_change' }>;

/**
 * Несколько новых Немезид после одного вечера — одной строкой «Новые Немезиды», сгруппировано по
 * новому держателю: «Дима — для игроков Саша и Лёша». Иначе звания вытесняли бы из короткой
 * ленты всё остальное (после вечера с нокаутами их бывает по три-четыре).
 */
function nemesisGroupRow(group: readonly NemesisChange[], ctx: FeedContext): FeedRow {
  const name = (id: string) => nameWithMe(ctx.names, id, ctx.meId);
  const byHolder = new Map<string, string[]>();
  for (const t of group) {
    const list = byHolder.get(t.to) ?? [];
    if (t.victimId) list.push(t.victimId);
    byHolder.set(t.to, list);
  }
  const parts = [...byHolder].map(
    ([holder, victims]) =>
      `${name(holder)} — для ${victims.length > 1 ? 'игроков' : 'игрока'} ${joinNames(victims.map(name))}`,
  );
  const first = group[0] as NemesisChange;
  return {
    id: `titles:nemesis:${first.eveningId}`,
    icon: 'crown',
    title: 'Новые Немезиды',
    subtitle: line([dayOf(first, ctx), ...parts]),
    to: paths.player(first.to),
    caption: null,
    photoPath: null,
    photoAlt: null,
  };
}

type SeasonAchievement = Extract<FeedItem, { type: 'achievement' }> & { seasonKey: string };

function isSeasonAchievement(item: FeedItem): item is SeasonAchievement {
  return item.type === 'achievement' && item.eveningId === null && item.seasonKey !== null;
}

/**
 * Сезонные ачивки одного сезона — одной строкой «Итоги сезона»: «Чемпион сезона» — Саша ·
 * «Железный стул» — Женя, Саша и Дима · «Ребай-король» — Лёша. Они приходят разом, в конце
 * сезона, и по отдельности вытеснили бы из короткой ленты всё остальное (а обрезались бы не по
 * смыслу, а по порядку id).
 */
function seasonGroupRow(group: readonly SeasonAchievement[], ctx: FeedContext): FeedRow {
  const name = (id: string) => nameWithMe(ctx.names, id, ctx.meId);
  const byCode = new Map<SeasonAchievement['code'], string[]>();
  for (const a of group) {
    const list = byCode.get(a.code) ?? [];
    list.push(a.playerId);
    byCode.set(a.code, list);
  }
  // Чемпион — первым, остальные — в порядке домена.
  const codes = [...byCode.keys()].sort(
    (a, b) => Number(b === 'champion') - Number(a === 'champion'),
  );
  const first = group[0] as SeasonAchievement;
  return {
    id: `season:${first.seasonKey}`,
    icon: 'shield-check',
    title: `Итоги сезона: ${formatSeason(first.seasonKey)}`,
    subtitle: line([
      relativeDay(first.at, ctx.nowMs),
      ...codes.map(
        (code) =>
          `«${ACHIEVEMENT_META[code].title}» — ${joinNames((byCode.get(code) ?? []).map(name))}`,
      ),
    ]),
    to: paths.ratingFame,
    caption: null,
    photoPath: null,
    photoAlt: null,
  };
}

/**
 * Строки ленты из всех событий (без limit): Немезиды одного вечера и сезонные ачивки одного
 * сезона склеиваются в одну строку, затем берутся первые limit строк.
 */
export function feedRows(items: readonly FeedItem[], ctx: FeedContext, limit: number): FeedRow[] {
  const nemeses = new Map<string, NemesisChange[]>();
  const seasons = new Map<string, SeasonAchievement[]>();
  for (const item of items) {
    if (item.type === 'title_change' && item.title === 'nemesis') {
      const list = nemeses.get(item.eveningId) ?? [];
      list.push(item);
      nemeses.set(item.eveningId, list);
    } else if (isSeasonAchievement(item)) {
      const list = seasons.get(item.seasonKey) ?? [];
      list.push(item);
      seasons.set(item.seasonKey, list);
    }
  }
  const rows: FeedRow[] = [];
  const done = new Set<string>();
  for (const item of items) {
    if (rows.length >= limit) break;
    if (item.type === 'title_change' && item.title === 'nemesis') {
      const group = nemeses.get(item.eveningId) ?? [];
      if (group.length > 1) {
        const key = `nemesis:${item.eveningId}`;
        if (done.has(key)) continue;
        done.add(key);
        rows.push(nemesisGroupRow(group, ctx));
        continue;
      }
    }
    if (isSeasonAchievement(item)) {
      const group = seasons.get(item.seasonKey) ?? [];
      if (group.length > 1) {
        const key = `season:${item.seasonKey}`;
        if (done.has(key)) continue;
        done.add(key);
        rows.push(seasonGroupRow(group, ctx));
        continue;
      }
    }
    rows.push(feedRow(item, ctx));
  }
  return rows;
}
