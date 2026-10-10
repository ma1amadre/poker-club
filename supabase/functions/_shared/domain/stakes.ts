// «На кону»: что может случиться на объявленном вечере — кто в одном шаге от ачивки или её уровня,
// какие рекорды клуба досягаемы и расклад сезона перед игрой. Всё выводится из итогов прошедших
// вечеров, прогнозов и звёзд по тем же правилам, что computeAchievements и recordsTable (пороги —
// ACHIEVEMENT_THRESHOLDS, ACHIEVEMENT_LEVELS); тексты собирают карточка анонса
// (src/shared/lib/stories.ts) и пост в день игры (_shared/messages.ts).
//
// Что считается «в шаге»:
// - «Хет-трик»: две победы подряд в вечерах, где игрок играл (серии не перекрываются, как у ачивки) —
//   третья даст ачивку; заодно — рекорд клуба по серии побед, если победа его побьёт или повторит
//   (серия после неё — от трёх побед);
// - «Заклятый враг»: до порога уровня (5, 10, 15) не хватает одного нокаута того же соперника (только
//   если оба могут прийти);
// - «Первая кровь»: в клубе ещё не было нокаута — первый нокаут вечера даст ачивку;
// - «Охота на короля»: действующий чемпион (чемпион прошлого сезона) может прийти, и есть кому на него
//   охотиться впервые — постоянный игрок без этой ачивки;
// - «Месть»: Немезида игрока может прийти, а «Мести» у игрока ещё не было;
// - «Звезда вечера»: до уровня II или III не хватает одной звезды (звезда — по голосованию вечера);
// - рекорд фонда: ответившие «иду» уже без ребаев дают фонд не меньше рекорда;
// - «Оракул»: два угаданных победителя подряд — угадать третьего.
// Ачивки, которые даёт сама игра вечера («Охотник», «Камбэк», «Феникс», «Чистая победа»), в «На кону»
// не попадают: они возможны у каждого в каждом вечере — это не шаг, а условие.
// Кто может прийти — постоянные игроки, кроме ответивших «не иду» (гостей в списке нет: ачивок и
// рекордов игрока у них не бывает). «Оракул» — у всех переданных игроков: прогноз делают и те, кто не
// играет.
import {
  ACHIEVEMENT_THRESHOLDS,
  chronological,
  computeAchievements,
  levelFor,
  levelThreshold,
  reigningChampionsFor,
  titles,
  type AchievementCode,
  type AchievementInput,
} from './achievements.ts';
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
  /** Ещё нокаут victimId даст «Заклятого врага» уровня level (target — его порог). */
  | {
      kind: 'enemy_step';
      playerId: PlayerId;
      victimId: PlayerId;
      kos: number;
      target: number;
      level: number;
    }
  /** Первый нокаут в истории клуба ещё впереди. */
  | { kind: 'first_blood' }
  /** Действующий чемпион может прийти: его нокаут даст «Охоту на короля». */
  | { kind: 'king_step'; championIds: PlayerId[] }
  /** Немезида игрока может прийти: её нокаут даст первую «Месть». */
  | { kind: 'revenge_step'; playerId: PlayerId; nemesisId: PlayerId }
  /** Ещё одна звезда даст «Звезду вечера» уровня level (II или III). */
  | { kind: 'star_step'; playerId: PlayerId; stars: number; target: number; level: number }
  /**
   * «Иду» со стандартными входами уже дают фонд не меньше рекорда клуба. Оценка: вход бывает любой
   * суммой (027), поэтому фонд считается по входу формата — entryRub с каждого «иду».
   */
  | {
      kind: 'pool_record';
      going: number;
      /** Вход формата, по которому посчитан фонд (going · entryRub). */
      entryRub: number;
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
> & {
  /** Звёзды вечера по закрытым голосованиям; нет — шагов к «Звезде вечера» не будет. */
  stars?: AchievementInput['stars'];
};

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
  /** Вход формата вечера (format.buyInRub) — оценка фонда для рекорда: по входу с каждого «иду». */
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
    case 'king_step':
      return 4;
    case 'star_step':
      return 5;
    case 'pool_record':
      return 6;
    case 'revenge_step':
      return 7;
    case 'oracle_step':
      return 8;
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
 * «Заклятый враг» → «Первая кровь» → «Охота на короля» → «Звезда вечера» → рекорд фонда → «Месть» →
 * «Оракул»; внутри вида — по id игрока) и расклад сезона вечера. «Месть» — ниже фонда: Немезида
 * есть почти у каждого, и в посте дня игры (две строки) она вытесняла бы рекорд клуба.
 * input.summaries — только прошедшие вечера (объявленного среди них нет).
 */
export function eveningStakes(input: StakesInput, opts: StakesOptions): EveningStakes {
  const T = ACHIEVEMENT_THRESHOLDS;
  const evenings = chronological(input.summaries);
  const key = seasonKey(opts.eveningDate);
  const earned = computeAchievements({
    ...input,
    stars: input.stars ?? [],
    currentSeasonKey: key,
  });
  const has = (playerId: PlayerId, code: AchievementCode): boolean =>
    earned.some((a) => a.playerId === playerId && a.code === code);
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

  // «Заклятый враг»: до порога уровня — один нокаут того же соперника; оба могут прийти.
  const pairs = new Map<string, number>();
  for (const s of evenings)
    for (const [killer, victim] of s.koPairs)
      pairs.set(`${killer}|${victim}`, (pairs.get(`${killer}|${victim}`) ?? 0) + 1);
  for (const [pair, kos] of [...pairs].sort((a, b) => byId(a[0], b[0]))) {
    const level = levelFor('sworn_enemy', kos + 1);
    if (level === levelFor('sworn_enemy', kos)) continue;
    const [killer = '', victim = ''] = pair.split('|');
    if (expected.has(killer) && expected.has(victim))
      items.push({
        kind: 'enemy_step',
        playerId: killer,
        victimId: victim,
        kos,
        target: levelThreshold('sworn_enemy', level) ?? kos + 1,
        level,
      });
  }

  if (!evenings.some((s) => s.busts.some((b) => b.by.length > 0)))
    items.push({ kind: 'first_blood' });

  // «Охота на короля»: действующий чемпион может прийти, и есть кому охотиться впервые.
  const kings = reigningChampionsFor(input, key).filter((id) => expected.has(id));
  if (kings.some((king) => [...expected].some((id) => id !== king && !has(id, 'king_hunt'))))
    items.push({ kind: 'king_step', championIds: [...kings].sort(byId) });

  // «Месть»: своя Немезида может прийти, «Мести» ещё не было.
  const { nemesis } = titles(input);
  for (const id of [...expected].sort(byId)) {
    const target = nemesis[id];
    if (target && expected.has(target) && !has(id, 'revenge'))
      items.push({ kind: 'revenge_step', playerId: id, nemesisId: target });
  }

  // «Звезда вечера»: до уровня II или III — одна звезда (первая — не шаг: её может взять каждый).
  const stars = new Map<PlayerId, number>();
  for (const a of earned)
    if (a.code === 'star') stars.set(a.playerId, (stars.get(a.playerId) ?? 0) + a.count);
  for (const id of [...expected].sort(byId)) {
    const n = stars.get(id) ?? 0;
    const level = levelFor('star', n + 1);
    if (level >= 2 && level > levelFor('star', n))
      items.push({ kind: 'star_step', playerId: id, stars: n, target: n + 1, level });
  }

  const poolRecord =
    recordsTable(evenings, { excluded: input.excluded }).find((r) => r.kind === 'biggest_pool')
      ?.value ?? null;
  const going = regulars.filter((p) => p.rsvp === 'yes' && p.spectator !== true).length;
  const poolRub = going * opts.buyInRub;
  if (poolRecord !== null && going > 0 && poolRub >= poolRecord)
    items.push({
      kind: 'pool_record',
      going,
      entryRub: opts.buyInRub,
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
    season: seasonStakes(input, key),
  };
}
