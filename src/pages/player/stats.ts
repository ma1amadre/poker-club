// Чистые вычисления карточки игрока поверх итогов вечеров (EveningSummary). Очки, места, нетто
// и нокауты за вечер посчитаны доменом в summarize — здесь они только собираются по игроку:
// хронология, накопленный нетто для графика, форма, личные встречи, ачивки для показа.
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_META,
  achievementTitle,
  levelCount,
  type Achievement,
  type AchievementCode,
} from '@domain/achievements.ts';
import { payouts } from '@domain/money.ts';
import type { EveningSummary } from '@domain/summary.ts';
import type { PlayerId } from '@domain/types.ts';

export interface PlayerEvening {
  eveningId: string;
  date: string;
  seasonKey: string;
  /** Место (с 1); null — игрока нет в местах (по журналу так быть не должно, но не падаем). */
  place: number | null;
  /** Сколько участников было в вечере (гости тоже). */
  entrants: number;
  points: number;
  netRub: number;
  kos: number;
  rebuys: number;
}

/** Хронология как в домене (achievements.chronological): по дате, при равенстве — по id. */
function byDate(a: { date: string; eveningId: string }, b: { date: string; eveningId: string }) {
  return (
    Date.parse(a.date) - Date.parse(b.date) ||
    (a.eveningId < b.eveningId ? -1 : a.eveningId > b.eveningId ? 1 : 0)
  );
}

/** Вечера, где игрок участвовал, от старых к новым. */
export function playerEvenings(
  summaries: readonly EveningSummary[],
  playerId: PlayerId,
): PlayerEvening[] {
  const result: PlayerEvening[] = [];
  for (const s of summaries) {
    if (!s.entrants.includes(playerId)) continue;
    const index = s.places.indexOf(playerId);
    result.push({
      eveningId: s.eveningId,
      date: s.date,
      seasonKey: s.seasonKey,
      place: index >= 0 ? index + 1 : null,
      entrants: s.entrants.length,
      points: s.points[playerId] ?? 0,
      netRub: s.netRub[playerId] ?? 0,
      kos: s.kos[playerId] ?? 0,
      rebuys: s.rebuys[playerId] ?? 0,
    });
  }
  return result.sort(byDate);
}

export interface NetPoint {
  eveningId: string;
  date: string;
  /** Нетто вечера (домен, computeMoney через summarize). */
  netRub: number;
  /** Накопленный нетто после этого вечера. */
  cumulativeRub: number;
}

/** Накопленный нетто по вечерам — точки графика. Вход — хронология playerEvenings. */
export function cumulativeNet(evenings: readonly PlayerEvening[]): NetPoint[] {
  let sum = 0;
  return evenings.map((e) => {
    sum += e.netRub;
    return { eveningId: e.eveningId, date: e.date, netRub: e.netRub, cumulativeRub: sum };
  });
}

/** Форма: последние n сыгранных вечеров, от старых к новым (самый свежий — справа). */
export function recentForm(evenings: readonly PlayerEvening[], n = 5): PlayerEvening[] {
  return evenings.slice(-n);
}

export interface HeadToHeadRow {
  opponentId: PlayerId;
  /** Сколько раз игрок выбил соперника (при дележе нокаут засчитывается каждому). */
  knockedOut: number;
  /** Сколько раз соперник выбил игрока. */
  knockedOutBy: number;
  /** Вечеров за одним столом. */
  together: number;
}

/**
 * Личные встречи против каждого, с кем игрок сидел за столом. Нокауты — из koPairs домена:
 * каждый bust считается, даже если жертва потом сделала ребай.
 * Порядок: больше нокаутов в паре — выше, потом больше общих вечеров.
 */
export function headToHead(
  summaries: readonly EveningSummary[],
  playerId: PlayerId,
): HeadToHeadRow[] {
  const rows = new Map<PlayerId, HeadToHeadRow>();
  const row = (id: PlayerId): HeadToHeadRow => {
    let r = rows.get(id);
    if (!r) {
      r = { opponentId: id, knockedOut: 0, knockedOutBy: 0, together: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const s of summaries) {
    if (!s.entrants.includes(playerId)) continue;
    for (const id of new Set(s.entrants)) if (id !== playerId) row(id).together += 1;
    for (const [killer, victim] of s.koPairs) {
      if (killer === victim) continue;
      if (killer === playerId) row(victim).knockedOut += 1;
      else if (victim === playerId) row(killer).knockedOutBy += 1;
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.knockedOut + b.knockedOutBy - (a.knockedOut + a.knockedOutBy) ||
      b.together - a.together ||
      (a.opponentId < b.opponentId ? -1 : 1),
  );
}

/** Жертвы, для которых игрок — немезида (из titles().nemesis домена: жертва → немезида). */
export function nemesisOf(
  nemesis: Readonly<Record<PlayerId, PlayerId | null>>,
  playerId: PlayerId,
): PlayerId[] {
  return Object.entries(nemesis)
    .filter(([victim, holder]) => holder === playerId && victim !== playerId)
    .map(([victim]) => victim)
    .sort();
}

export interface AchievementView {
  code: AchievementCode;
  /** Название; у уровневой полученной — с уровнем игрока: «Охотник II». */
  title: string;
  description: string;
  /** Сколько раз получена (сумма count по вечерам и сезонам); 0 — ещё нет. */
  count: number;
  /** Уровень игрока — наибольший из выдач; 0 — ещё нет. У ачивок без уровней — 0 или 1. */
  level: number;
  /** Сколько уровней у ачивки (1 — без уровней). */
  levels: number;
  /**
   * Дата последнего вечера, где получена (для вечерних ачивок); у уровневых — последняя выдача на
   * уровне игрока: карточка пишет дату рядом с правилом этого уровня («5 и больше нокаутов за вечер
   * · 27 августа»), и выдача уровня ниже её не сдвигает.
   */
  lastDate: string | null;
  /** Последний сезон, где получена (для сезонных: ребай-король, железный стул, чемпион). */
  lastSeasonKey: string | null;
}

/**
 * Ачивки игрока для показа: все коды из ACHIEVEMENT_META в их порядке, у каждой — сколько раз
 * получена, наибольший уровень и когда в последний раз. Сами ачивки считает computeAchievements.
 */
export function achievementsForPlayer(
  all: readonly Achievement[],
  playerId: PlayerId,
  dateOf: (eveningId: string) => string | undefined,
): AchievementView[] {
  const views = new Map<AchievementCode, AchievementView>();
  for (const code of ACHIEVEMENT_CODES) {
    const meta = ACHIEVEMENT_META[code];
    views.set(code, {
      code,
      title: meta.title,
      description: meta.description,
      count: 0,
      level: 0,
      levels: levelCount(code),
      lastDate: null,
      lastSeasonKey: null,
    });
  }
  for (const a of all) {
    if (a.playerId !== playerId) continue;
    const v = views.get(a.code);
    if (!v) continue;
    v.count += a.count;
    const date = a.eveningId ? dateOf(a.eveningId) : undefined;
    if (a.level > v.level) {
      v.level = a.level;
      v.title = achievementTitle(a.code, a.level);
      // Новый наибольший уровень: дата — только его выдач.
      v.lastDate = date ?? null;
    } else if (
      a.level === v.level &&
      date &&
      (!v.lastDate || Date.parse(date) > Date.parse(v.lastDate))
    )
      v.lastDate = date;
    if (a.seasonKey && (!v.lastSeasonKey || a.seasonKey > v.lastSeasonKey))
      v.lastSeasonKey = a.seasonKey;
  }
  return [...views.values()];
}

const NICE_STEPS = [1, 2, 2.5, 5] as const;

/**
 * «Круглые» деления оси, включающие min и max (0 — тоже, если он внутри диапазона):
 * niceTicks(-300, 1250, 5) → [-500, 0, 500, 1000, 1500]. Не больше maxTicks делений.
 */
export function niceTicks(min: number, max: number, maxTicks = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    if (lo === 0) return [0];
    // Одно значение: ось от нуля до него, чтобы была видна величина.
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const intervals = Math.max(1, maxTicks - 1);
  const raw = (hi - lo) / intervals;
  const base = 10 ** Math.floor(Math.log10(raw));
  // Деления по краям округляются наружу и могут добавить по одному — тогда берём шаг крупнее.
  for (let magnitude = base; magnitude <= base * 1000; magnitude *= 10) {
    for (const m of NICE_STEPS) {
      const step = m * magnitude;
      const start = Math.floor(lo / step + 1e-9) * step;
      const end = Math.ceil(hi / step - 1e-9) * step;
      const count = Math.round((end - start) / step) + 1;
      if (count <= maxTicks) {
        // Округление убирает хвосты двоичной арифметики (0.30000000000000004).
        return Array.from(
          { length: count },
          (_, i) => Math.round((start + i * step) * 1e6) / 1e6 || 0,
        );
      }
    }
  }
  return [lo, hi];
}

export interface StandingPosition<R> {
  row: R;
  /** Место с дележом (из rankPlaces / standingPlaces). */
  place: number;
  /** Сколько строк в таблице. */
  of: number;
}

/** Строка игрока в отсортированной таблице домена и её место с дележом; null — игрока нет. */
export function standingPosition<R extends { playerId: PlayerId }>(
  rows: readonly R[],
  places: readonly number[],
  playerId: PlayerId,
): StandingPosition<R> | null {
  const index = rows.findIndex((r) => r.playerId === playerId);
  const row = rows[index];
  if (index < 0 || !row) return null;
  return { row, place: places[index] ?? index + 1, of: rows.length };
}

// --- Цифры игрока: личные рекорды, призы, среднее место ------------------------------------

export interface PersonalBest {
  value: number;
  /** Вечер, где результат впервые достигнут (при равенстве — более ранний). */
  eveningId: string;
  date: string;
}

export interface PlayerNumbers {
  /** Лучший вечер по нетто (может быть и отрицательным, если в плюс ещё не выходил). */
  bestNet: PersonalBest | null;
  /** Больше всего нокаутов за вечер; null — нокаутов не было. */
  mostKos: PersonalBest | null;
  /** Самая длинная серия побед подряд в вечерах, где играл; null — побед не было. */
  bestStreak: PersonalBest | null;
  /** Вечера в призах: место среди оплачиваемых. of — вечера, где число призовых мест известно. */
  inTheMoney: { count: number; of: number };
  /** Среднее место по вечерам с определённым местом; null — таких нет. */
  averagePlace: number | null;
  /** По скольким вечерам посчитано среднее место. */
  placed: number;
}

/**
 * Сколько мест вечера получило приз: доли формата на первые min(участники, доли) мест —
 * та же раскладка, что у выплат домена (payouts); нулевая доля приза не даёт.
 */
export function paidPlaces(
  payoutPct: readonly number[],
  entrants: number,
  prizePoolRub: number,
): number {
  return payouts(prizePoolRub, payoutPct, entrants).filter((rub) => rub > 0).length;
}

/**
 * Личные цифры игрока поверх его вечеров (хронология playerEvenings). Серия побед — как у
 * рекорда клуба: подряд в вечерах, где игрок играл. paidOf — число призовых мест вечера
 * (paidPlaces), undefined — неизвестно, такой вечер в долю призов не входит.
 */
export function playerNumbers(
  evenings: readonly PlayerEvening[],
  paidOf: (eveningId: string) => number | undefined,
): PlayerNumbers {
  let bestNet: PersonalBest | null = null;
  let mostKos: PersonalBest | null = null;
  let bestStreak: PersonalBest | null = null;
  let streak = 0;
  let itm = 0;
  let known = 0;
  let placeSum = 0;
  let placed = 0;
  const at = (value: number, e: PlayerEvening): PersonalBest => ({
    value,
    eveningId: e.eveningId,
    date: e.date,
  });

  for (const e of [...evenings].sort(byDate)) {
    if (!bestNet || e.netRub > bestNet.value) bestNet = at(e.netRub, e);
    if (e.kos > 0 && (!mostKos || e.kos > mostKos.value)) mostKos = at(e.kos, e);
    streak = e.place === 1 ? streak + 1 : 0;
    if (streak > 0 && (!bestStreak || streak > bestStreak.value)) bestStreak = at(streak, e);
    if (e.place !== null) {
      placeSum += e.place;
      placed += 1;
    }
    const paid = paidOf(e.eveningId);
    if (paid !== undefined) {
      known += 1;
      if (e.place !== null && e.place <= paid) itm += 1;
    }
  }

  return {
    bestNet,
    mostKos,
    bestStreak,
    inTheMoney: { count: itm, of: known },
    averagePlace: placed > 0 ? placeSum / placed : null,
    placed,
  };
}
