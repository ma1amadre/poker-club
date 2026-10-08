// «На кону»: что может случиться на объявленном вечере — кто в одном шаге от ачивки, какие рекорды
// клуба досягаемы и расклад сезона перед игрой. Всё выводится из итогов прошедших вечеров и прогнозов
// по тем же правилам, что computeAchievements и recordsTable (пороги — ACHIEVEMENT_THRESHOLDS); тексты
// собирают карточка анонса (src/shared/lib/stakes.ts) и пост в день игры (_shared/messages.ts).
//
// Что считается «в шаге»:
// - «Хет-трик»: две победы подряд в вечерах, где игрок играл (серии не перекрываются, как у ачивки) —
//   третья даст ачивку; заодно — рекорд клуба по серии побед, если победа его побьёт или повторит
//   (серия после неё — от трёх побед);
// - «Заклятый враг»: 4 нокаута одного и того же соперника — пятый даст ачивку (только если оба могут
//   прийти);
// - «Первая кровь»: в клубе ещё не было нокаута — первый нокаут вечера даст ачивку;
// - рекорд фонда: ответившие «иду» уже без ребаев дают фонд не меньше рекорда;
// - «Оракул»: два угаданных победителя подряд — угадать третьего.
// Кто может прийти — постоянные игроки, кроме ответивших «не иду» (гостей в списке нет: ачивок и
// рекордов игрока у них не бывает). «Оракул» — у всех переданных игроков: прогноз делают и те, кто не
// играет.
import { ACHIEVEMENT_THRESHOLDS, chronological, type AchievementInput } from './achievements.ts';
import { recordsTable } from './records.ts';
import { roundPoints } from './scoring.ts';
import { sameRank, seasonKey, seasonStandings, type StandingRow } from './season.ts';
import type { PlayerId } from './types.ts';

export type StakeItem =
  /** Победа даст «Хет-трик» и/или рекорд клуба по серии побед (streak — длина серии после неё). */
  | {
      kind: 'win_step';
      playerId: PlayerId;
      hatTrick: boolean;
      streak: number;
      record: 'new' | 'equal' | null;
    }
  /** Ещё нокаут victimId даст «Заклятого врага». */
  | { kind: 'enemy_step'; playerId: PlayerId; victimId: PlayerId; kos: number; target: number }
  /** Первый нокаут в истории клуба ещё впереди. */
  | { kind: 'first_blood' }
  /** «Иду» уже дают фонд не меньше рекорда клуба. */
  | {
      kind: 'pool_record';
      going: number;
      poolRub: number;
      recordRub: number;
      status: 'new' | 'equal';
    }
  /** Ещё один угаданный победитель даст «Оракула». */
  | { kind: 'oracle_step'; playerId: PlayerId; streak: number; target: number };

export type StakeKind = StakeItem['kind'];

export interface SeasonStakesRow {
  playerId: PlayerId;
  total: number;
}

export interface SeasonStakes {
  seasonKey: string;
  /** В сезоне вечера ещё не было — этот вечер его открывает. */
  first: boolean;
  /** Первое место перед вечером (ничья — все). */
  leaders: SeasonStakesRow[];
  /** Следующее за лидером место (ничья — все) и отставание от лидера в очках. */
  chasers: (SeasonStakesRow & { gap: number })[];
  /** Таблица сезона перед вечером — экран показывает по ней место игрока. */
  rows: StandingRow[];
}

export interface EveningStakes {
  items: StakeItem[];
  season: SeasonStakes | null;
}

export type StakesInput = Pick<
  AchievementInput,
  'summaries' | 'excluded' | 'predictions' | 'bestN' | 'bestNBySeason'
>;

/** Постоянный игрок клуба (активный, не гость) и его ответ на анонс; null — не ответил. */
export interface StakesPlayer {
  playerId: PlayerId;
  rsvp: 'yes' | 'maybe' | 'no' | null;
  /**
   * Болельщик на этот вечер (spectatesEvening, миграция 024): прийти не собирается — шагов к
   * ачивкам и рекордам за столом у него нет, а шаг к «Оракулу» есть (прогнозы он делает).
   */
  spectator?: boolean;
}

export interface StakesOptions {
  /** Дата вечера (scheduled_at): по ней — сезон. */
  eveningDate: string;
  players: readonly StakesPlayer[];
  /** Взнос вечера (format.buyInRub) — для рекорда фонда. */
  buyInRub: number;
}

const byId = (a: PlayerId, b: PlayerId): number => (a < b ? -1 : a > b ? 1 : 0);

function rank(item: StakeItem): number {
  switch (item.kind) {
    case 'win_step':
      return item.record === 'new' ? 0 : 1;
    case 'enemy_step':
      return 2;
    case 'first_blood':
      return 3;
    case 'pool_record':
      return 4;
    case 'oracle_step':
      return 5;
  }
}

const playerOf = (item: StakeItem): PlayerId => ('playerId' in item ? item.playerId : '');

function seasonStakes(input: StakesInput, key: string): SeasonStakes {
  const rows = seasonStandings(chronological(input.summaries), {
    bestN: input.bestN,
    excluded: input.excluded,
    seasonKey: key,
    bestNBySeason: input.bestNBySeason,
  });
  const top = rows[0];
  if (!top) return { seasonKey: key, first: true, leaders: [], chasers: [], rows };
  const leaders = rows.filter((r) => sameRank(r, top));
  const next = rows.find((r) => !sameRank(r, top));
  const chasers = next
    ? rows
        .filter((r) => sameRank(r, next))
        .map((r) => ({
          playerId: r.playerId,
          total: r.total,
          gap: roundPoints(top.total - r.total),
        }))
    : [];
  return {
    seasonKey: key,
    first: false,
    leaders: leaders.map((r) => ({ playerId: r.playerId, total: r.total })),
    chasers,
    rows,
  };
}

/**
 * «На кону» перед вечером: шаги к ачивкам и рекордам по важности (рекорд серии → «Хет-трик» →
 * «Заклятый враг» → «Первая кровь» → рекорд фонда → «Оракул»; внутри вида — по id игрока) и расклад
 * сезона вечера. input.summaries — только прошедшие вечера (объявленного среди них нет).
 */
export function eveningStakes(input: StakesInput, opts: StakesOptions): EveningStakes {
  const T = ACHIEVEMENT_THRESHOLDS;
  const evenings = chronological(input.summaries);
  const regulars = opts.players.filter((p) => !input.excluded.has(p.playerId));
  // Кто может прийти: не «не иду» и не болельщик на этот вечер.
  const expected = new Set(
    regulars.filter((p) => p.rsvp !== 'no' && p.spectator !== true).map((p) => p.playerId),
  );
  const items: StakeItem[] = [];

  // Серии побед: «Хет-трик» (не перекрываются) и рекорд клуба (подряд, как в recordsTable).
  const streakRecord =
    recordsTable(evenings, { excluded: input.excluded }).find((r) => r.kind === 'win_streak')
      ?.value ?? null;
  for (const id of [...expected].sort(byId)) {
    let hat = 0;
    let run = 0;
    for (const s of evenings) {
      if (!s.entrants.includes(id)) continue;
      const won = s.places[0] === id;
      run = won ? run + 1 : 0;
      hat = won ? hat + 1 : 0;
      if (hat >= T.hatTrickWins) hat = 0;
    }
    // Рекорд серии — только настоящий: серия после победы от трёх и не меньше рекорда клуба (первая
    // серия из двух побед — не повод: её «рекордом» стал бы каждый, кто выиграл прошлый вечер).
    const after = run + 1;
    const record =
      streakRecord === null || after < Math.max(T.hatTrickWins, streakRecord)
        ? null
        : after > streakRecord
          ? 'new'
          : 'equal';
    const hatTrick = hat === T.hatTrickWins - 1;
    if (hatTrick || record !== null)
      items.push({ kind: 'win_step', playerId: id, hatTrick, streak: after, record });
  }

  // «Заклятый враг»: пятый нокаут одного и того же соперника; оба могут прийти.
  const pairs = new Map<string, number>();
  for (const s of evenings)
    for (const [killer, victim] of s.koPairs)
      pairs.set(`${killer}|${victim}`, (pairs.get(`${killer}|${victim}`) ?? 0) + 1);
  for (const [key, kos] of [...pairs].sort((a, b) => byId(a[0], b[0]))) {
    if (kos !== T.swornEnemyKos - 1) continue;
    const [killer = '', victim = ''] = key.split('|');
    if (expected.has(killer) && expected.has(victim))
      items.push({
        kind: 'enemy_step',
        playerId: killer,
        victimId: victim,
        kos,
        target: T.swornEnemyKos,
      });
  }

  if (!evenings.some((s) => s.busts.some((b) => b.by.length > 0)))
    items.push({ kind: 'first_blood' });

  const poolRecord =
    recordsTable(evenings, { excluded: input.excluded }).find((r) => r.kind === 'biggest_pool')
      ?.value ?? null;
  const going = regulars.filter((p) => p.rsvp === 'yes' && p.spectator !== true).length;
  const poolRub = going * opts.buyInRub;
  if (poolRecord !== null && going > 0 && poolRub >= poolRecord)
    items.push({
      kind: 'pool_record',
      going,
      poolRub,
      recordRub: poolRecord,
      status: poolRub > poolRecord ? 'new' : 'equal',
    });

  // «Оракул»: серия угаданных победителей по вечерам, где был прогноз (не перекрываются).
  const order = new Map(evenings.map((s, i) => [s.eveningId, i]));
  for (const p of [...regulars].sort((a, b) => byId(a.playerId, b.playerId))) {
    const list = input.predictions
      .filter((x) => x.playerId === p.playerId && order.has(x.eveningId))
      .sort((a, b) => (order.get(a.eveningId) ?? 0) - (order.get(b.eveningId) ?? 0));
    let streak = 0;
    for (const x of list) {
      streak = x.winner > 0 ? streak + 1 : 0;
      if (streak >= T.oracleStreak) streak = 0;
    }
    if (streak === T.oracleStreak - 1)
      items.push({
        kind: 'oracle_step',
        playerId: p.playerId,
        streak,
        target: T.oracleStreak,
      });
  }

  return {
    items: items
      .map((item, i) => ({ item, i }))
      .sort(
        (a, b) =>
          rank(a.item) - rank(b.item) || byId(playerOf(a.item), playerOf(b.item)) || a.i - b.i,
      )
      .map((x) => x.item),
    season: seasonStakes(input, seasonKey(opts.eveningDate)),
  };
}
