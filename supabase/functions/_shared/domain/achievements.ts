// Ачивки и переходящие звания. Всё вычисляется заново из итогов вечеров — ничего не хранится,
// поэтому правка закрытого вечера админом автоматически пересчитывает и ачивки.
import type { ScoredPrediction } from './predictions.ts';
import { roundPoints } from './scoring.ts';
import { compareSeasonKeys, seasonChampions, seasonStandings } from './season.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';
import type { VoteCategory } from './votes.ts';

export type AchievementCode =
  | 'first_blood'
  | 'hunter'
  | 'comeback'
  | 'rebuy_king'
  | 'iron_chair'
  | 'hat_trick'
  | 'sworn_enemy'
  | 'oracle'
  | 'star'
  | 'champion';

/**
 * Одна строка — одна ачивка, заработанная в конкретном вечере (eveningId) или сезоне (seasonKey).
 * count > 1, если в одном вечере/сезоне заработано несколько раз (например, «Звезда» в двух
 * номинациях или «Заклятый враг» сразу к двум игрокам).
 */
export interface Achievement {
  playerId: PlayerId;
  code: AchievementCode;
  eveningId: string | null;
  seasonKey: string | null;
  count: number;
}

/** Пороги в одном месте — по решению клуба их пересматривают после первого сезона. */
export const ACHIEVEMENT_THRESHOLDS = {
  hunterKos: 3,
  comebackRebuys: 2,
  hatTrickWins: 3,
  swornEnemyKos: 5,
  oracleStreak: 3,
  nemesisMinKos: 2,
  formWindow: 5,
} as const;

export const ACHIEVEMENT_META: Record<AchievementCode, { title: string; description: string }> = {
  first_blood: { title: 'Первая кровь', description: 'Первый нокаут в истории клуба' },
  hunter: { title: 'Охотник', description: '3 и больше нокаутов за один вечер' },
  comeback: { title: 'Камбэк', description: 'Победа в вечере, где понадобилось 2 и больше ребаев' },
  rebuy_king: { title: 'Ребай-король', description: 'Больше всех ребаев за сезон' },
  iron_chair: { title: 'Железный стул', description: 'Не пропустил ни одного вечера сезона' },
  hat_trick: { title: 'Хет-трик', description: 'Три победы подряд в вечерах, где играл' },
  sworn_enemy: { title: 'Заклятый враг', description: 'Выбил одного и того же игрока 5 раз' },
  oracle: { title: 'Оракул', description: 'Угадал победителя в трёх вечерах подряд' },
  star: { title: 'Звезда вечера', description: 'Победа в номинации голосования' },
  champion: { title: 'Чемпион сезона', description: '1-е место по итогам сезона' },
};

export const TITLE_META = {
  nemesis: { title: 'Немезида', description: 'Чаще всех выбивал этого игрока (минимум 2 раза)' },
  form: { title: 'Форма', description: 'Больше всех очков за последние 5 вечеров клуба' },
} as const;

export interface StarAward {
  eveningId: string;
  category: VoteCategory;
  winners: PlayerId[]; // из voteResults — только по закрытым голосованиям
}

export interface AchievementInput {
  summaries: readonly EveningSummary[]; // завершённые вечера, порядок любой
  excluded: ReadonlySet<PlayerId>; // гости: ачивок и званий не получают
  predictions: readonly ScoredPrediction[];
  stars: readonly StarAward[];
  bestN: number; // settings.season_best_n — для чемпиона
  currentSeasonKey: string; // сезоны с ключом меньше — завершены
}

/** Хронология: по дате вечера, при равенстве — по id, чтобы порядок был детерминирован. */
function chronological(summaries: readonly EveningSummary[]): EveningSummary[] {
  return [...summaries].sort(
    (a, b) =>
      Date.parse(a.date) - Date.parse(b.date) ||
      (a.eveningId < b.eveningId ? -1 : a.eveningId > b.eveningId ? 1 : 0),
  );
}

const keyOf = (a: Pick<Achievement, 'playerId' | 'code' | 'eveningId' | 'seasonKey'>): string =>
  `${a.playerId}|${a.code}|${a.eveningId ?? ''}|${a.seasonKey ?? ''}`;

export function computeAchievements(input: AchievementInput): Achievement[] {
  const T = ACHIEVEMENT_THRESHOLDS;
  const { excluded } = input;
  const found = new Map<string, Achievement>();
  const add = (
    playerId: PlayerId,
    code: AchievementCode,
    eveningId: string | null,
    seasonKey: string | null,
  ) => {
    if (excluded.has(playerId)) return;
    const a: Achievement = { playerId, code, eveningId, seasonKey, count: 1 };
    const k = keyOf(a);
    const prev = found.get(k);
    if (prev) prev.count += 1;
    else found.set(k, a);
  };

  const evenings = chronological(input.summaries);
  const order = new Map(evenings.map((s, i) => [s.eveningId, i]));

  // first_blood: первый нокаут клуба; при дележе — всем выбившим. Если выбил гость, ачивка
  // не достаётся никому (следующий нокаут уже не «первый»).
  for (const s of evenings) {
    const first = s.busts.find((b) => b.by.length > 0);
    if (first) {
      for (const k of first.by) add(k, 'first_blood', s.eveningId, null);
      break;
    }
  }

  const winStreak = new Map<PlayerId, number>();
  const pairKos = new Map<string, number>();
  for (const s of evenings) {
    const winner = s.places[0];
    for (const id of s.entrants) {
      if ((s.kos[id] ?? 0) >= T.hunterKos) add(id, 'hunter', s.eveningId, null);
      // Хет-трик: серии не перекрываются — 6 побед подряд = 2 хет-трика.
      const streak = id === winner ? (winStreak.get(id) ?? 0) + 1 : 0;
      if (streak >= T.hatTrickWins) {
        add(id, 'hat_trick', s.eveningId, null);
        winStreak.set(id, 0);
      } else winStreak.set(id, streak);
    }
    if (winner !== undefined && (s.rebuys[winner] ?? 0) >= T.comebackRebuys)
      add(winner, 'comeback', s.eveningId, null);
    // Заклятый враг — один раз на пару, в вечере, где случился 5-й нокаут.
    for (const [killer, victim] of s.koPairs) {
      const k = `${killer}|${victim}`;
      const n = (pairKos.get(k) ?? 0) + 1;
      pairKos.set(k, n);
      if (n === T.swornEnemyKos) add(killer, 'sworn_enemy', s.eveningId, null);
    }
  }

  // oracle: серия угаданных победителей по вечерам, где игрок делал прогноз (в хронологии вечеров).
  const byPlayer = new Map<PlayerId, ScoredPrediction[]>();
  for (const p of input.predictions) {
    if (!order.has(p.eveningId)) continue; // прогноз на незавершённый вечер не считается
    const list = byPlayer.get(p.playerId) ?? [];
    list.push(p);
    byPlayer.set(p.playerId, list);
  }
  for (const [playerId, list] of byPlayer) {
    list.sort((a, b) => (order.get(a.eveningId) ?? 0) - (order.get(b.eveningId) ?? 0));
    let streak = 0;
    for (const p of list) {
      streak = p.winner > 0 ? streak + 1 : 0;
      if (streak >= T.oracleStreak) {
        add(playerId, 'oracle', p.eveningId, null);
        streak = 0;
      }
    }
  }

  for (const st of input.stars) for (const w of st.winners) add(w, 'star', st.eveningId, null);

  // Сезонные — только по завершённым сезонам: в текущем лидер ещё может смениться.
  const seasons = [...new Set(evenings.map((s) => s.seasonKey))].filter(
    (k) => compareSeasonKeys(k, input.currentSeasonKey) < 0,
  );
  for (const key of seasons) {
    const inSeason = evenings.filter((s) => s.seasonKey === key);
    const rebuys = new Map<PlayerId, number>();
    const played = new Map<PlayerId, number>();
    for (const s of inSeason) {
      for (const id of s.entrants) {
        if (excluded.has(id)) continue; // гость не может «отнять» ребай-короля у постоянного
        rebuys.set(id, (rebuys.get(id) ?? 0) + (s.rebuys[id] ?? 0));
        played.set(id, (played.get(id) ?? 0) + 1);
      }
    }
    const maxRebuys = Math.max(0, ...rebuys.values());
    if (maxRebuys > 0)
      for (const [id, n] of rebuys) if (n === maxRebuys) add(id, 'rebuy_king', null, key);
    for (const [id, n] of played) if (n === inSeason.length) add(id, 'iron_chair', null, key);

    const rows = seasonStandings(inSeason, { bestN: input.bestN, excluded });
    for (const id of seasonChampions(rows)) add(id, 'champion', null, key);
  }

  return [...found.values()].sort((a, b) =>
    keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0,
  );
}

export interface Titles {
  nemesis: Record<PlayerId, PlayerId | null>; // жертва → её немезида
  form: PlayerId | null;
}

/**
 * Переходящие звания.
 * Немезида: кто чаще всех выбивал игрока (минимум 2 раза); при равенстве — тот, кто сделал это
 * позже, — звание «переходит» к последнему догнавшему.
 * Форма: лучшая сумма очков за последние 5 вечеров клуба; при равенстве сравниваются очки
 * в последнем вечере, потом в предыдущем и т.д.; полная ничья — звание никому.
 */
export function titles(input: Pick<AchievementInput, 'summaries' | 'excluded'>): Titles {
  const T = ACHIEVEMENT_THRESHOLDS;
  const { excluded } = input;
  const evenings = chronological(input.summaries);

  const nemesis: Record<PlayerId, PlayerId | null> = {};
  const counts = new Map<PlayerId, Map<PlayerId, { n: number; last: number }>>();
  let seq = 0;
  for (const s of evenings) {
    for (const id of s.entrants) if (!excluded.has(id)) nemesis[id] = null;
    for (const [killer, victim] of s.koPairs) {
      seq += 1;
      if (excluded.has(killer) || excluded.has(victim)) continue;
      const m = counts.get(victim) ?? new Map<PlayerId, { n: number; last: number }>();
      const c = m.get(killer) ?? { n: 0, last: 0 };
      c.n += 1;
      c.last = seq;
      m.set(killer, c);
      counts.set(victim, m);
    }
  }
  for (const [victim, m] of counts) {
    let best: { id: PlayerId; n: number; last: number } | null = null;
    for (const [id, c] of m) {
      if (!best || c.n > best.n || (c.n === best.n && c.last > best.last)) best = { id, ...c };
    }
    nemesis[victim] = best && best.n >= T.nemesisMinKos ? best.id : null;
  }

  const recent = evenings.slice(-T.formWindow).reverse(); // последний вечер — первым
  const rows = new Map<PlayerId, { sum: number; perEvening: number[] }>();
  recent.forEach((s, i) => {
    for (const id of s.entrants) {
      if (excluded.has(id)) continue;
      const r = rows.get(id) ?? { sum: 0, perEvening: recent.map(() => 0) };
      const pts = s.points[id] ?? 0;
      r.sum = roundPoints(r.sum + pts);
      r.perEvening[i] = pts;
      rows.set(id, r);
    }
  });
  const cmp = (
    a: { sum: number; perEvening: number[] },
    b: { sum: number; perEvening: number[] },
  ): number => {
    if (a.sum !== b.sum) return b.sum - a.sum;
    for (let i = 0; i < a.perEvening.length; i++) {
      const d = (b.perEvening[i] ?? 0) - (a.perEvening[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const ranked = [...rows.entries()].sort((a, b) => cmp(a[1], b[1]));
  let form: PlayerId | null = null;
  const top = ranked[0];
  const second = ranked[1];
  if (top && top[1].sum > 0 && (!second || cmp(top[1], second[1]) !== 0)) form = top[0];

  return { nemesis, form };
}

/**
 * Новые ачивки для поста бота: строки, которых не было раньше, и прирост count у существующих
 * (в поле count — только прирост).
 */
export function diffAchievements(
  before: readonly Achievement[],
  after: readonly Achievement[],
): Achievement[] {
  const prev = new Map(before.map((a) => [keyOf(a), a.count]));
  const result: Achievement[] = [];
  for (const a of after) {
    const was = prev.get(keyOf(a)) ?? 0;
    if (a.count > was) result.push({ ...a, count: a.count - was });
  }
  return result;
}
