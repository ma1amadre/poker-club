// «Твой вечер»: что завершённый вечер значил лично для игрока — нокауты в обе стороны, прогноз,
// новые ачивки, сдвиг в сезоне, звания и рекорды. Всё из истории и остального домена.
import {
  chronological,
  computeAchievements,
  type Achievement,
  type AchievementInput,
} from './achievements.ts';
import { titleChanges, type TitleChange } from './feed.ts';
import { recordsBroken, type RecordBreak } from './records.ts';
import { sameRank, seasonStandings, type StandingRow } from './season.ts';
import type { PlayerId } from './types.ts';

/**
 * Место игрока в таблице с дележом (как на главной и в рейтинге: первая строка с тем же
 * рангом по sameRank + 1). null — игрока в таблице нет.
 */
export function standingPlace(rows: readonly StandingRow[], playerId: PlayerId): number | null {
  const row = rows.find((r) => r.playerId === playerId);
  if (!row) return null;
  return rows.findIndex((r) => sameRank(r, row)) + 1;
}

export interface RecapKo {
  victimId: PlayerId;
  count: number; // сколько раз выбил этого игрока за вечер
  shared: number; // из них — в дележе с кем-то (сплит-нокаут)
}

export interface RecapBust {
  by: PlayerId[]; // кто выбил при этом вылете; пусто — никто не записан
  final: boolean; // окончательный вылет (после него не было ребая)
}

export interface RecapPrediction {
  made: boolean; // был прогноз (хоть одно поле)
  winnerHit: boolean;
  firstOutHit: boolean;
  points: number; // очки Оракула за этот вечер
}

export interface EveningRecap {
  eveningId: string;
  seasonKey: string;
  played: boolean; // false — игрок не играл, но делал прогноз
  guest: boolean; // гость: ачивок, мест в сезоне и рекордов игрока нет
  entrants: number;
  place: number | null;
  points: number | null;
  netRub: number | null;
  rebuys: number;
  kos: number;
  kosBy: RecapKo[]; // кого выбил; по убыванию count
  bustedBy: RecapBust[]; // каждый вылет игрока по порядку
  prediction: RecapPrediction;
  newAchievements: Achievement[]; // полученные именно этим вечером (eveningId = этот вечер)
  seasonPlaceBefore: number | null; // место в сезоне вечера до него; null — ещё не играл в сезоне
  seasonPlaceAfter: number | null; // сразу после него (не «сейчас»)
  /** before − after: +2 — поднялся на 2 места; null, если одного из мест нет. */
  seasonPlaceDelta: number | null;
  titleChanges: TitleChange[]; // все смены званий клуба после этого вечера (фильтр — на экране)
  records: RecordBreak[]; // рекорды вечера, где игрок среди установивших, и рекорды самого вечера
}

/**
 * «Твой вечер» игрока playerId в вечере eveningId. null — вечера нет среди итогов или игрок в нём
 * не участвовал и прогноза не делал.
 */
export function eveningRecap(
  input: AchievementInput,
  eveningId: string,
  playerId: PlayerId,
): EveningRecap | null {
  const evenings = chronological(input.summaries);
  const index = evenings.findIndex((s) => s.eveningId === eveningId);
  const s = evenings[index];
  if (!s) return null;

  const played = s.entrants.includes(playerId);
  const scored = input.predictions.find(
    (p) => p.eveningId === eveningId && p.playerId === playerId,
  );
  if (!played && !scored) return null;
  const guest = input.excluded.has(playerId);

  const kosMap = new Map<PlayerId, RecapKo>();
  const bustedBy: RecapBust[] = [];
  s.busts.forEach((b, i) => {
    if (b.by.includes(playerId)) {
      const ko = kosMap.get(b.victim) ?? { victimId: b.victim, count: 0, shared: 0 };
      ko.count += 1;
      if (b.by.length > 1) ko.shared += 1;
      kosMap.set(b.victim, ko);
    }
    if (b.victim === playerId) {
      const later = s.busts.slice(i + 1).some((x) => x.victim === playerId);
      // Ребай после вылета — значит, вылет не окончательный. Последний вылет победителя быть
      // не может: победитель жив в конце вечера.
      bustedBy.push({ by: [...b.by], final: !later && s.places[0] !== playerId });
    }
  });
  const kosBy = [...kosMap.values()].sort(
    (a, b) => b.count - a.count || (a.victimId < b.victimId ? -1 : 1),
  );

  const placeIdx = s.places.indexOf(playerId);

  let seasonPlaceBefore: number | null = null;
  let seasonPlaceAfter: number | null = null;
  if (played && !guest) {
    const opts = {
      bestN: input.bestN,
      excluded: input.excluded,
      seasonKey: s.seasonKey,
      bestNBySeason: input.bestNBySeason,
    };
    seasonPlaceBefore = standingPlace(seasonStandings(evenings.slice(0, index), opts), playerId);
    seasonPlaceAfter = standingPlace(seasonStandings(evenings.slice(0, index + 1), opts), playerId);
  }

  const newAchievements = guest
    ? []
    : computeAchievements(input).filter(
        (a) => a.eveningId === eveningId && a.playerId === playerId,
      );

  const broken = recordsBroken(input.summaries, { excluded: input.excluded })[eveningId] ?? [];

  return {
    eveningId,
    seasonKey: s.seasonKey,
    played,
    guest,
    entrants: s.entrants.length,
    place: placeIdx === -1 ? null : placeIdx + 1,
    points: played ? (s.points[playerId] ?? 0) : null,
    netRub: played ? (s.netRub[playerId] ?? 0) : null,
    rebuys: s.rebuys[playerId] ?? 0,
    kos: s.kos[playerId] ?? 0,
    kosBy,
    bustedBy,
    prediction: {
      made: scored !== undefined,
      winnerHit: (scored?.winner ?? 0) > 0,
      firstOutHit: (scored?.firstOut ?? 0) > 0,
      points: scored?.total ?? 0,
    },
    newAchievements,
    seasonPlaceBefore,
    seasonPlaceAfter,
    seasonPlaceDelta:
      seasonPlaceBefore !== null && seasonPlaceAfter !== null
        ? seasonPlaceBefore - seasonPlaceAfter
        : null,
    titleChanges: titleChanges(input).filter((t) => t.eveningId === eveningId),
    records: broken.filter((r) => r.playerIds.length === 0 || r.playerIds.includes(playerId)),
  };
}
