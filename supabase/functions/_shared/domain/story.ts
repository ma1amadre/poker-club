// «Сюжет вечера»: 2–4 строки о главном в завершённом вечере — «победа с 18 %» в олл-ине, месть
// Немезиде, рекорд клуба, новый лидер сезона, «феникс» (первый вылет вечера и победа), победа после
// ребаев. Всё выводится из итогов вечеров, журнала олл-инов и остального домена (titles,
// eveningClubNews, allInSwing); тексты собирают экраны (src/shared/lib/story.ts) и пост
// (_shared/messages.ts) — о людях в настоящем времени, без рода.
//
// Где показывается и что видно:
// - экран итога в приложении — всё (история клуба есть);
// - табло — только то, что видно из журнала самого вечера (club не передаётся): табло без входа
//   видит только свой вечер, поэтому месть, рекорд и лидер сезона там не считаются;
// - пост итогов (forPost) — без рекордов и лидера сезона (они уже в «Жизни клуба») и без победы
//   после ребаев, если за неё выдана ачивка «Камбэк» (она уже в «Новых ачивках»).
import {
  ACHIEVEMENT_THRESHOLDS,
  chronological,
  titles,
  type AchievementInput,
} from './achievements.ts';
import { allInSwing, bestSwing, type AllIn, type AllInEquity, type AllInSwing } from './allins.ts';
import { eveningClubNews, type SeasonLeader } from './clubNews.ts';
import { RECORD_META, type RecordBreak } from './records.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';

/** Больше строк сюжет не показывает: главное, а не пересказ вечера. */
export const STORY_MAX_ITEMS = 4;

export type StoryItem =
  /** Самая невероятная победа в олл-ине вечера. */
  | { kind: 'swing'; swing: AllInSwing }
  /** Игрок выбил свою Немезиду (звание до этого вечера). */
  | { kind: 'revenge'; playerId: PlayerId; nemesisId: PlayerId }
  /** Рекорд клуба, установленный или повторённый вечером (как в «Жизни клуба»). */
  | { kind: 'record'; record: RecordBreak }
  /** Первое место сезона сменилось: leaders — кто на нём теперь, leadersBefore — кто был. */
  | { kind: 'season_leader'; leaders: SeasonLeader[]; leadersBefore: PlayerId[] }
  /** Первый вылет вечера — и победа (вернулся ребаем). */
  | { kind: 'phoenix'; playerId: PlayerId }
  /** Победа после ребаев; achievement — за неё выдана ачивка «Камбэк». */
  | { kind: 'comeback'; playerId: PlayerId; rebuys: number; achievement: boolean };

export type StoryKind = StoryItem['kind'];

/** История клуба для сюжета: все итоги (с этим вечером), гости, «лучшие N» для сезона. */
export type StoryClub = Pick<
  AchievementInput,
  'summaries' | 'excluded' | 'bestN' | 'bestNBySeason'
>;

export interface StoryInput {
  /** Итог этого вечера (summarize). */
  summary: EveningSummary;
  /** Олл-ины этого вечера (eveningAllIns). */
  allIns: readonly AllIn[];
  /** Гости: «Камбэк» им не выдаётся. */
  excluded: ReadonlySet<PlayerId>;
  /** История клуба; нет — только то, что видно из журнала вечера (табло). */
  club?: StoryClub;
  /** Шансы олл-ина (по умолчанию — движок; клиент подставляет кеш табло). */
  equity?: AllInEquity;
  /** Готовые «победы с N %» (клиент уже посчитал) — тогда equity не нужен. */
  swings?: ReadonlyMap<string, AllInSwing>;
  /**
   * Сюжет для поста итогов: без того, что пост говорит другими блоками, — рекордов и лидера сезона
   * («Жизнь клуба») и победы после ребаев с ачивкой «Камбэк» («Новые ачивки»). Отсев — до предела
   * строк, чтобы место выбывших заняли следующие по важности.
   */
  forPost?: boolean;
}

/** Строка, которую пост итогов уже говорит другим блоком (см. StoryInput.forPost). */
export function toldElsewhereInPost(item: StoryItem): boolean {
  return (
    item.kind === 'record' ||
    item.kind === 'season_leader' ||
    (item.kind === 'comeback' && item.achievement)
  );
}

function revenges(summary: EveningSummary, club: StoryClub): StoryItem[] {
  const evenings = chronological(club.summaries);
  const index = evenings.findIndex((s) => s.eveningId === summary.eveningId);
  const before = index === -1 ? evenings : evenings.slice(0, index);
  const { nemesis } = titles({ summaries: before, excluded: club.excluded });
  const seen = new Set<string>();
  const out: StoryItem[] = [];
  for (const b of summary.busts) {
    for (const killer of b.by) {
      const key = `${killer}|${b.victim}`;
      if (seen.has(key) || nemesis[killer] !== b.victim) continue;
      seen.add(key);
      out.push({ kind: 'revenge', playerId: killer, nemesisId: b.victim });
    }
  }
  return out;
}

/** Порядок строк: чем выше — тем главнее. */
function rank(item: StoryItem): number {
  switch (item.kind) {
    case 'swing':
      return 0;
    case 'revenge':
      return 1;
    case 'record':
      if (item.record.status === 'equalled') return 7;
      return RECORD_META[item.record.kind].scope === 'player' ? 2 : 6;
    case 'season_leader':
      return 3;
    case 'phoenix':
      return 4;
    case 'comeback':
      return 5;
  }
}

/**
 * Сюжет вечера: до STORY_MAX_ITEMS строк по важности (swing → месть → рекорд игрока → лидер сезона
 * → феникс → победа после ребаев → рекорд вечера → повторённый рекорд). Пусто — рассказывать нечего.
 */
export function eveningStory(input: StoryInput): StoryItem[] {
  const { summary, club } = input;
  const items: StoryItem[] = [];

  const swings =
    input.swings ??
    new Map(
      input.allIns.flatMap((a) => {
        const s = allInSwing(a, input.equity);
        return s ? [[a.showdownId, s] as const] : [];
      }),
    );
  const swing = bestSwing(input.allIns, swings);
  if (swing) items.push({ kind: 'swing', swing });

  const winner = summary.places[0];
  if (winner !== undefined) {
    const rebuys = summary.rebuys[winner] ?? 0;
    if (summary.firstBustPlayerId === winner) items.push({ kind: 'phoenix', playerId: winner });
    else if (rebuys > 0)
      items.push({
        kind: 'comeback',
        playerId: winner,
        rebuys,
        achievement: !input.excluded.has(winner) && rebuys >= ACHIEVEMENT_THRESHOLDS.comebackRebuys,
      });
  }

  if (club) {
    items.push(...revenges(summary, club));
    const news = eveningClubNews({ ...club, predictions: [] }, summary.eveningId);
    // Как в «Жизни клуба»: повторённый рекорд вечера (фонд, длина игры) — не новость.
    for (const record of news?.records ?? [])
      if (record.status === 'new' || RECORD_META[record.kind].scope === 'player')
        items.push({ kind: 'record', record });
    const season = news?.season;
    if (season && season.leaders.length > 0)
      items.push({
        kind: 'season_leader',
        leaders: season.leaders,
        leadersBefore: season.leadersBefore,
      });
  }

  return items
    .filter((item) => !input.forPost || !toldElsewhereInPost(item))
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .slice(0, STORY_MAX_ITEMS)
    .map((x) => x.item);
}
