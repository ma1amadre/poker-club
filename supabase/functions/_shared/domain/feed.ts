// Лента «В клубе»: итоги вечеров, новые ачивки, смена званий, моменты голосования и рекорды —
// одним списком по убыванию времени. Всё выводится из истории (итоги, прогнозы, голоса) и
// остального домена; ничего не хранится.
import {
  chronological,
  computeAchievements,
  starAchievements,
  starAwards,
  titles,
  type AchievementCode,
  type AchievementInput,
  type StarAward,
} from './achievements.ts';
import { recordsBroken, type RecordKind } from './records.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';
import { starWinner, VOTE_CATEGORIES, voteResults, type VoteCategory } from './votes.ts';

/** Служебные поля вечера, которых нет в итоге: строки evenings. */
export interface FeedEvening {
  eveningId: string;
  finishedAt: string | null; // evenings.finished_at
  votingClosesAt: string | null; // evenings.voting_closes_at
}

/** Голос с подписью и фото (строка votes). */
export interface MomentVote {
  eveningId: string;
  voterId: PlayerId;
  category: VoteCategory;
  nomineeId: PlayerId;
  caption: string | null;
  photoPath: string | null;
  createdAt?: string; // votes.created_at — для выбора голоса при равенстве
}

export interface ClubFeedInput extends AchievementInput {
  evenings: readonly FeedEvening[];
  votes: readonly MomentVote[];
}

interface FeedBase {
  /** Детерминированный id — для key в React; одинаков при каждом пересчёте. */
  id: string;
  at: string; // ISO
}

export interface EveningResultItem extends FeedBase {
  type: 'evening_result';
  eveningId: string;
  winnerId: PlayerId | null;
  entrants: number;
  prizePoolRub: number | null; // null — в итоге нет фонда (старый итог)
  topHunters: PlayerId[]; // больше всех нокаутов (ничья — все); пусто, если нокаутов не было
  topHunterKos: number;
  winnerGuessedBy: PlayerId[]; // угадали победителя
  firstOutId: PlayerId | null;
  firstOutGuessedBy: PlayerId[]; // угадали первый вылет
}

export interface AchievementItem extends FeedBase {
  type: 'achievement';
  playerId: PlayerId;
  code: AchievementCode;
  eveningId: string | null;
  seasonKey: string | null;
  count: number;
  /** Уровень выдачи (1 у ачивок без уровней) и «впервые на этом уровне» — как в Achievement. */
  level: number;
  first: boolean;
  /** Соперник «Заклятого врага», Немезида у «Мести», чемпион у «Охоты на короля»; иначе null. */
  targetId: PlayerId | null;
}

export interface TitleChange {
  title: 'form' | 'nemesis';
  from: PlayerId | null; // прежний держатель; null — звания ещё ни у кого не было
  to: PlayerId;
  victimId: PlayerId | null; // для немезиды — чья; у формы null
  eveningId: string; // вечер, после которого звание перешло
}

export interface TitleChangeItem extends FeedBase, TitleChange {
  type: 'title_change';
}

export interface Moment {
  eveningId: string;
  category: VoteCategory;
  nomineeId: PlayerId;
  votes: number; // голосов за номинанта
  tie: boolean; // номинацию делят несколько победителей
  caption: string | null; // подпись лучшего голоса
  photoPath: string | null; // фото лучшего голоса (путь в Storage)
  noteBy: PlayerId | null; // автор лучшего голоса
  /**
   * Номинация дала «Звезду вечера» (единственный лидер, от STAR_MIN_VOTES голосов, не гость): уровень
   * игрока после звёзд этого вечера и «впервые на этом уровне»; null — звезды нет.
   */
  star: { level: number; first: boolean } | null;
}

export interface MomentItem extends FeedBase, Moment {
  type: 'moment';
}

export interface RecordItem extends FeedBase {
  type: 'record';
  eveningId: string;
  kind: RecordKind;
  value: number;
  previous: number | null;
  status: 'new' | 'equalled';
  playerIds: PlayerId[];
}

export type FeedItem =
  EveningResultItem | AchievementItem | TitleChangeItem | MomentItem | RecordItem;

const TYPE_ORDER: Record<FeedItem['type'], number> = {
  evening_result: 0,
  record: 1,
  achievement: 2,
  title_change: 3,
  moment: 4,
};

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Конец сезона '2026-Q3' — начало следующего квартала по Москве (UTC+3, без перехода на летнее
 * время с 2014 года). Момент сезонных ачивок в ленте.
 */
export function seasonEndIso(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) throw new Error(`Некорректный ключ сезона: ${key}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) * 3, 1) - 3 * 3_600_000;
  return new Date(ms).toISOString();
}

/** Момент вечера: evenings.finished_at, без него — finish из журнала, иначе дата вечера. */
function eveningTime(s: EveningSummary, meta: FeedEvening | undefined): string {
  return meta?.finishedAt ?? s.finishedAt ?? s.date;
}

/**
 * Смена переходящих званий — пошагово по истории: после каждого вечера звания считаются заново
 * по вечерам до него включительно и сравниваются с последним держателем. Событие — только когда
 * звание получает новый игрок: потеря звания «в никуда» (ничья в форме) события не даёт, а если
 * потом звание вернулось к тому же, это тоже не смена.
 */
export function titleChanges(
  input: Pick<AchievementInput, 'summaries' | 'excluded'>,
): TitleChange[] {
  const evenings = chronological(input.summaries);
  const out: TitleChange[] = [];
  let form: PlayerId | null = null;
  const nemesis = new Map<PlayerId, PlayerId>();
  for (let i = 0; i < evenings.length; i++) {
    const s = evenings[i] as EveningSummary;
    const t = titles({ summaries: evenings.slice(0, i + 1), excluded: input.excluded });
    if (t.form !== null && t.form !== form) {
      out.push({ title: 'form', from: form, to: t.form, victimId: null, eveningId: s.eveningId });
      form = t.form;
    }
    for (const victim of Object.keys(t.nemesis).sort()) {
      const holder = t.nemesis[victim] ?? null;
      const prev = nemesis.get(victim) ?? null;
      if (holder !== null && holder !== prev) {
        out.push({
          title: 'nemesis',
          from: prev,
          to: holder,
          victimId: victim,
          eveningId: s.eveningId,
        });
        nemesis.set(victim, holder);
      }
    }
  }
  return out;
}

/** Лучший голос за номинанта: с фото и подписью, потом с фото, потом с подписью; затем ранний. */
function bestVote(votes: readonly MomentVote[]): MomentVote | null {
  const weight = (v: MomentVote) => (v.photoPath ? 2 : 0) + (v.caption ? 1 : 0);
  const sorted = [...votes].sort(
    (a, b) =>
      weight(b) - weight(a) ||
      cmpStr(a.createdAt ?? '', b.createdAt ?? '') ||
      cmpStr(a.voterId, b.voterId),
  );
  const top = sorted[0];
  return top && weight(top) > 0 ? top : null;
}

/**
 * Моменты: победители номинаций по вечерам с закрытым голосованием (voting_closes_at <= nowMs) —
 * как сейчас видны голоса: до закрытия RLS отдаёт только свои. Новые сверху; внутри вечера — по
 * порядку категорий. Ничья — по моменту на каждого победителя (звезды у ничьей нет). Звёзды —
 * starAchievements по тем же голосованиям, что и моменты (excluded — гости: звезды им нет).
 */
export function clubMoments(
  input: Pick<ClubFeedInput, 'summaries' | 'evenings' | 'votes'> &
    Partial<Pick<ClubFeedInput, 'excluded'>>,
  opts: { nowMs: number },
): (Moment & { at: string })[] {
  const excluded = input.excluded ?? new Set<PlayerId>();
  const finished = new Set(input.summaries.map((s) => s.eveningId));
  const votesBy = new Map<string, MomentVote[]>();
  for (const v of input.votes) {
    const list = votesBy.get(v.eveningId) ?? [];
    list.push(v);
    votesBy.set(v.eveningId, list);
  }
  const closed: { e: FeedEvening; closesMs: number; votes: MomentVote[] }[] = [];
  const stars: StarAward[] = [];
  for (const e of input.evenings) {
    if (!finished.has(e.eveningId) || !e.votingClosesAt) continue;
    const closesMs = Date.parse(e.votingClosesAt);
    if (Number.isNaN(closesMs) || closesMs > opts.nowMs) continue;
    const votes = (votesBy.get(e.eveningId) ?? []).filter((v) => v.voterId !== v.nomineeId);
    closed.push({ e, closesMs, votes });
    stars.push(...starAwards(e.eveningId, voteResults(votes)));
  }
  const starOf = new Map(
    starAchievements({ summaries: input.summaries, excluded, stars }).map((a) => [
      `${a.playerId}|${a.eveningId}`,
      { level: a.level, first: a.first },
    ]),
  );

  const out: (Moment & { at: string })[] = [];
  for (const { e, closesMs, votes } of closed) {
    const results = voteResults(votes);
    for (const category of VOTE_CATEGORIES) {
      const r = results[category];
      const star = starWinner(r);
      for (const nomineeId of r.winners) {
        const note = bestVote(
          votes.filter((v) => v.category === category && v.nomineeId === nomineeId),
        );
        out.push({
          at: new Date(closesMs).toISOString(),
          eveningId: e.eveningId,
          category,
          nomineeId,
          votes: r.counts[nomineeId] ?? 0,
          tie: r.winners.length > 1,
          caption: note?.caption ?? null,
          photoPath: note?.photoPath ?? null,
          noteBy: note?.voterId ?? null,
          star: star === nomineeId ? (starOf.get(`${nomineeId}|${e.eveningId}`) ?? null) : null,
        });
      }
    }
  }
  const catIndex = (c: VoteCategory) => VOTE_CATEGORIES.indexOf(c);
  return out.sort(
    (a, b) =>
      cmpStr(b.at, a.at) ||
      cmpStr(a.eveningId, b.eveningId) ||
      catIndex(a.category) - catIndex(b.category) ||
      cmpStr(a.nomineeId, b.nomineeId),
  );
}

/** Порядок ленты: новые сверху; при равном времени — итог, рекорды, ачивки, звания, моменты. */
function sortFeed<T extends FeedItem>(items: T[]): T[] {
  // Моменты одного вечера — в порядке категорий (рука, блеф, бэд-бит), остальное — по id.
  const tieKey = (i: FeedItem): string =>
    i.type === 'moment'
      ? `${i.eveningId}:${VOTE_CATEGORIES.indexOf(i.category)}:${i.nomineeId}`
      : i.id;
  return items.sort(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      cmpStr(tieKey(a), tieKey(b)),
  );
}

/**
 * События ленты, которые не зависят от «сейчас»: итоги вечеров, ачивки, смена званий, рекорды —
 * в порядке ленты. Самая дорогая часть (computeAchievements, titleChanges — звания на каждом
 * префиксе истории): экран считает её один раз на историю, а не на каждом тике часов.
 */
export function clubEvents(input: ClubFeedInput): FeedItem[] {
  const meta = new Map(input.evenings.map((e) => [e.eveningId, e]));
  const byId = new Map(input.summaries.map((s) => [s.eveningId, s]));
  const timeOf = (eveningId: string): string | null => {
    const s = byId.get(eveningId);
    return s ? eveningTime(s, meta.get(eveningId)) : null;
  };
  const items: FeedItem[] = [];

  for (const s of input.summaries) {
    const preds = input.predictions.filter((p) => p.eveningId === s.eveningId);
    const maxKos = Math.max(0, ...s.entrants.map((id) => s.kos[id] ?? 0));
    items.push({
      type: 'evening_result',
      id: `result:${s.eveningId}`,
      at: eveningTime(s, meta.get(s.eveningId)),
      eveningId: s.eveningId,
      winnerId: s.places[0] ?? null,
      entrants: s.entrants.length,
      prizePoolRub: s.prizePoolRub ?? null,
      topHunters: maxKos > 0 ? s.entrants.filter((id) => (s.kos[id] ?? 0) === maxKos) : [],
      topHunterKos: maxKos,
      winnerGuessedBy: preds
        .filter((p) => p.winner > 0)
        .map((p) => p.playerId)
        .sort(),
      firstOutId: s.firstBustPlayerId,
      firstOutGuessedBy: preds
        .filter((p) => p.firstOut > 0)
        .map((p) => p.playerId)
        .sort(),
    });
  }

  for (const a of computeAchievements(input)) {
    // «Звезду вечера» показывает момент голосования (Moment.star).
    if (a.code === 'star') continue;
    const at =
      a.eveningId !== null
        ? timeOf(a.eveningId)
        : a.seasonKey !== null
          ? seasonEndIso(a.seasonKey)
          : null;
    if (at === null) continue;
    items.push({
      type: 'achievement',
      id:
        `achievement:${a.code}:${a.playerId}:${a.eveningId ?? a.seasonKey ?? ''}` +
        (a.targetId !== null ? `:${a.targetId}` : ''),
      at,
      playerId: a.playerId,
      code: a.code,
      eveningId: a.eveningId,
      seasonKey: a.seasonKey,
      count: a.count,
      level: a.level,
      first: a.first,
      targetId: a.targetId,
    });
  }

  for (const t of titleChanges(input)) {
    const at = timeOf(t.eveningId);
    if (at === null) continue;
    items.push({
      type: 'title_change',
      id: `title:${t.title}:${t.victimId ?? ''}:${t.eveningId}`,
      at,
      ...t,
    });
  }

  const broken = recordsBroken(input.summaries, { excluded: input.excluded });
  for (const [eveningId, list] of Object.entries(broken)) {
    const at = timeOf(eveningId);
    if (at === null) continue;
    for (const r of list) {
      items.push({ type: 'record', id: `record:${r.kind}:${eveningId}`, at, eveningId, ...r });
    }
  }

  return sortFeed(items);
}

/** Моменты (clubMoments) как события ленты. */
export function momentItems(moments: readonly (Moment & { at: string })[]): MomentItem[] {
  return moments.map((m) => ({
    type: 'moment',
    id: `moment:${m.eveningId}:${m.category}:${m.nomineeId}`,
    ...m,
  }));
}

/** Слить готовые события (clubEvents) и моменты в одну ленту; limit — первые N. */
export function mergeFeed(
  events: readonly FeedItem[],
  moments: readonly MomentItem[],
  limit?: number,
): FeedItem[] {
  const items = sortFeed([...events, ...moments]);
  return limit === undefined ? items : items.slice(0, Math.max(0, limit));
}

/**
 * Лента «В клубе», новые сверху. Время событий вечера — evenings.finished_at (итог, ачивки,
 * звания, рекорды), момента — voting_closes_at, сезонной ачивки — конец сезона. При равном
 * времени: итог, рекорды, ачивки, звания, моменты; дальше по id (моменты — по категориям).
 * Ачивка «Звезда вечера» в ленту не идёт отдельно — её показывает момент голосования (Moment.star).
 * То же, что mergeFeed(clubEvents(input), momentItems(clubMoments(input, opts)), opts.limit).
 */
export function clubFeed(
  input: ClubFeedInput,
  opts: { nowMs: number; limit?: number },
): FeedItem[] {
  return mergeFeed(clubEvents(input), momentItems(clubMoments(input, opts)), opts.limit);
}
