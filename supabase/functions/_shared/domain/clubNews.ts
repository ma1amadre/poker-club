// «Жизнь клуба» в посте итогов вечера: что вечер изменил в клубе — кто угадал победителя и первый
// вылет, рекорды, смена переходящих званий и сдвиг в таблице сезона. Всё выводится из истории и
// остального домена (прогнозы — scorePrediction, рекорды — recordsBroken, звания — titleChanges,
// сезон — seasonStandings и standingPlace, как в «Твоём вечере»); тексты собирает пост (messages.ts).
import { chronological, type AchievementInput } from './achievements.ts';
import { titleChanges, type TitleChange } from './feed.ts';
import { scorePrediction, type Prediction } from './predictions.ts';
import { recordsBroken, type RecordBreak } from './records.ts';
import { standingPlace } from './recap.ts';
import { sameRank, seasonStandings, type StandingRow } from './season.ts';
import type { PlayerId } from './types.ts';

/** Прогноз игрока на вечер как он лежит в базе (predictions): поля могут быть пустыми. */
export interface ClubNewsPrediction extends Prediction {
  eveningId: string;
  playerId: PlayerId;
}

export interface ClubNewsInput extends Pick<
  AchievementInput,
  'summaries' | 'excluded' | 'bestN' | 'bestNBySeason'
> {
  /** Прогнозы — все или только этого вечера; пустые (оба поля null) не считаются. */
  predictions: readonly ClubNewsPrediction[];
}

export interface ClubNewsPredictions {
  /** Сколько непустых прогнозов было на вечер. */
  made: number;
  /** Угадали победителя / первый вылет (по id игрока). */
  winnerGuessedBy: PlayerId[];
  firstOutGuessedBy: PlayerId[];
}

export interface SeasonLeader {
  playerId: PlayerId;
  total: number; // очки сезона сразу после вечера
}

export interface SeasonClimb {
  playerId: PlayerId;
  from: number; // место в сезоне до вечера (с дележом, как на главной)
  to: number; // сразу после
}

export interface ClubNewsSeason {
  seasonKey: string;
  /** Сменилось первое место: кто на нём теперь (ничья — все). Пусто — лидер прежний. */
  leaders: SeasonLeader[];
  /** Кто был на первом месте до вечера — пост отличает «новый лидер» от «лидирует один». */
  leadersBefore: PlayerId[];
  /** Наибольший подъём в таблице (ничья — все), кроме тех, кто вышел в лидеры. */
  climbers: SeasonClimb[];
}

export interface EveningClubNews {
  eveningId: string;
  predictions: ClubNewsPredictions;
  /** Рекорды, установленные или повторённые этим вечером (recordsBroken). */
  records: RecordBreak[];
  /** Звания, перешедшие после этого вечера (titleChanges). */
  titleChanges: TitleChange[];
  /**
   * Сдвиг в сезоне вечера; null — рассказывать нечего: первый вечер сезона (до него таблицы нет),
   * после вечера в том же сезоне уже были другие (пост итогов не говорит о прошлом положении как о
   * нынешнем) или первое место и порядок не сдвинулись ни у кого.
   */
  season: ClubNewsSeason | null;
}

const byId = (a: PlayerId, b: PlayerId): number => (a < b ? -1 : a > b ? 1 : 0);

function leadersOf(rows: readonly StandingRow[]): StandingRow[] {
  const top = rows[0];
  return top ? rows.filter((r) => sameRank(r, top)) : [];
}

function seasonShift(input: ClubNewsInput, eveningId: string): ClubNewsSeason | null {
  const evenings = chronological(input.summaries);
  const index = evenings.findIndex((s) => s.eveningId === eveningId);
  const s = evenings[index];
  if (!s) return null;
  if (evenings.slice(index + 1).some((x) => x.seasonKey === s.seasonKey)) return null;

  const opts = {
    bestN: input.bestN,
    excluded: input.excluded,
    seasonKey: s.seasonKey,
    bestNBySeason: input.bestNBySeason,
  };
  const before = seasonStandings(evenings.slice(0, index), opts);
  if (before.length === 0) return null;
  const after = seasonStandings(evenings.slice(0, index + 1), opts);

  const leadersBefore = leadersOf(before).map((r) => r.playerId);
  const was = new Set(leadersBefore);
  const now = leadersOf(after);
  const changed = now.length !== was.size || now.some((r) => !was.has(r.playerId));
  const leaders = changed ? now.map((r) => ({ playerId: r.playerId, total: r.total })) : [];
  const newLeaders = new Set(leaders.map((l) => l.playerId));

  const climbs: SeasonClimb[] = [];
  for (const row of after) {
    if (newLeaders.has(row.playerId)) continue;
    const from = standingPlace(before, row.playerId);
    const to = standingPlace(after, row.playerId);
    if (from !== null && to !== null && to < from)
      climbs.push({ playerId: row.playerId, from, to });
  }
  const best = Math.max(0, ...climbs.map((c) => c.from - c.to));
  const climbers = climbs
    .filter((c) => c.from - c.to === best)
    .sort((a, b) => a.to - b.to || byId(a.playerId, b.playerId));

  if (leaders.length === 0 && climbers.length === 0) return null;
  return { seasonKey: s.seasonKey, leaders, leadersBefore: leadersBefore.sort(byId), climbers };
}

/**
 * «Жизнь клуба» вечера eveningId. null — вечера нет среди итогов (не завершён по журналу).
 * Гости в звания, рекорды игрока и таблицу сезона не попадают (excluded), как и везде в домене.
 */
export function eveningClubNews(input: ClubNewsInput, eveningId: string): EveningClubNews | null {
  const s = input.summaries.find((x) => x.eveningId === eveningId);
  if (!s) return null;

  const predictions: ClubNewsPredictions = { made: 0, winnerGuessedBy: [], firstOutGuessedBy: [] };
  for (const p of input.predictions) {
    if (p.eveningId !== eveningId || (p.winnerId === null && p.firstOutId === null)) continue;
    predictions.made += 1;
    const score = scorePrediction(p, s);
    if (score.winner > 0) predictions.winnerGuessedBy.push(p.playerId);
    if (score.firstOut > 0) predictions.firstOutGuessedBy.push(p.playerId);
  }
  predictions.winnerGuessedBy.sort(byId);
  predictions.firstOutGuessedBy.sort(byId);

  return {
    eveningId,
    predictions,
    records: recordsBroken(input.summaries, { excluded: input.excluded })[eveningId] ?? [],
    titleChanges: titleChanges(input).filter((t) => t.eveningId === eveningId),
    season: seasonShift(input, eveningId),
  };
}

/** Есть ли что рассказать: без прогнозов, рекордов, званий и сдвига в сезоне блока в посте нет. */
export function hasClubNews(news: EveningClubNews | null): news is EveningClubNews {
  return (
    news !== null &&
    (news.predictions.made > 0 ||
      news.records.length > 0 ||
      news.titleChanges.length > 0 ||
      news.season !== null)
  );
}
