// Ачивки и переходящие звания. Всё вычисляется заново из итогов вечеров — ничего не хранится,
// поэтому правка закрытого вечера админом автоматически пересчитывает и ачивки.
//
// Уровни (решение клуба 08.10.2026): у «Охотника», «Камбэка», «Заклятого врага» и «Звезды вечера»
// есть уровни I, II, III (у «Камбэка» — I и II), пороги — ACHIEVEMENT_LEVELS. Выданное не отнимается:
// строка ачивки несёт уровень своей выдачи, уровень игрока — наибольший из его строк. Сюжетные ачивки
// того же решения — «Феникс», «Чистая победа», «Месть», «Охота на короля».
import type { ScoredPrediction } from './predictions.ts';
import { roundPoints } from './scoring.ts';
import {
  compareSeasonKeys,
  previousSeasonKey,
  seasonChampions,
  seasonStandings,
  type SeasonBestN,
} from './season.ts';
import { gameDayKey } from './seasonCalendar.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';
import { starWinner, VOTE_CATEGORIES, type VoteCategory, type VoteResult } from './votes.ts';

export type AchievementCode =
  | 'first_blood'
  | 'hunter'
  | 'comeback'
  | 'phoenix'
  | 'clean_win'
  | 'rebuy_king'
  | 'iron_chair'
  | 'hat_trick'
  | 'sworn_enemy'
  | 'revenge'
  | 'king_hunt'
  | 'oracle'
  | 'star'
  | 'champion';

/**
 * Одна строка — одна ачивка, заработанная в конкретном вечере (eveningId) или сезоне (seasonKey).
 * count > 1 — несколько выдач в одном вечере (две номинации у «Звезды вечера»).
 */
export interface Achievement {
  playerId: PlayerId;
  code: AchievementCode;
  eveningId: string | null;
  seasonKey: string | null;
  /**
   * О ком ачивка: «Заклятый враг» — соперник, «Месть» — Немезида, «Охота на короля» — чемпион;
   * у остальных null. Входит в ключ строки: два соперника в одном вечере — две строки.
   */
  targetId: PlayerId | null;
  count: number;
  /** Уровень этой выдачи, 1…levelCount(code); у ачивок без уровней — 1. */
  level: number;
  /**
   * Впервые на этом уровне: по хронологии строк игрока с этим кодом уровень выше всех прежних (у
   * ачивок без уровней — первая выдача вообще). «Новый уровень» в постах, ленте и «Твоём вечере».
   */
  first: boolean;
}

/** Пороги без уровней — в одном месте; по решению клуба их пересматривают после первого сезона. */
export const ACHIEVEMENT_THRESHOLDS = {
  hatTrickWins: 3,
  oracleStreak: 3,
  nemesisMinKos: 2,
  formWindow: 5,
} as const;

/**
 * Пороги уровней I, II, III (решение клуба 08.10.2026):
 * - hunter — нокауты за один вечер;
 * - comeback — ребаи победителя вечера;
 * - sworn_enemy — нокауты одного и того же игрока за всё время;
 * - star — «Звёзды вечера» за всё время.
 */
export const ACHIEVEMENT_LEVELS = {
  hunter: [3, 4, 5],
  comeback: [2, 3],
  sworn_enemy: [5, 10, 15],
  star: [1, 5, 10],
} as const satisfies Partial<Record<AchievementCode, readonly number[]>>;

export type LeveledCode = keyof typeof ACHIEVEMENT_LEVELS;

/** Обозначения уровней — римские цифры: коротко и без рода («Охотник II»). */
export const LEVEL_MARKS = ['I', 'II', 'III'] as const;

export function isLeveled(code: AchievementCode): code is LeveledCode {
  return code in ACHIEVEMENT_LEVELS;
}

/** Сколько уровней у ачивки: у ачивок без уровней — 1. */
export function levelCount(code: AchievementCode): number {
  return isLeveled(code) ? ACHIEVEMENT_LEVELS[code].length : 1;
}

/** Уровень по значению: 0 — первый порог не взят. */
export function levelFor(code: LeveledCode, value: number): number {
  return ACHIEVEMENT_LEVELS[code].filter((t) => value >= t).length;
}

/** Порог уровня level (с 1); null — такого уровня нет. */
export function levelThreshold(code: LeveledCode, level: number): number | null {
  return ACHIEVEMENT_LEVELS[code][level - 1] ?? null;
}

/** «II»; вне 1…3 — число. */
export function levelMark(level: number): string {
  return LEVEL_MARKS[level - 1] ?? String(level);
}

/**
 * Название с уровнем: «Охотник II» (неразрывный пробел — уровень не уезжает на новую строку); без
 * уровней (или level не задан) — просто название.
 */
export function achievementTitle(code: AchievementCode, level?: number | null): string {
  const title = ACHIEVEMENT_META[code].title;
  return isLeveled(code) && level !== undefined && level !== null && level >= 1
    ? `${title}\u00A0${levelMark(level)}`
    : title;
}

function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Что даёт уровень, со строчной и без рода: «4 нокаута за вечер», «5 и больше нокаутов за вечер»
 * (последний уровень — «и больше»), «10 нокаутов одного и того же игрока» (строку дают ровно на
 * пороге — это число, до которого счёт дошёл). У «Звезды вечера» — порог как порог, «от 5 звёзд
 * вечера»: строку дают за каждую звезду, и внутри уровня счёт растёт (4 звезды — всё ещё I).
 */
export function achievementLevelText(code: LeveledCode, level: number): string {
  const n = levelThreshold(code, level) ?? 0;
  const top = level >= levelCount(code);
  switch (code) {
    case 'hunter':
      return top
        ? `${n} и больше ${plural(n, ['нокаута', 'нокаутов', 'нокаутов'])} за вечер`
        : `${n} ${plural(n, ['нокаут', 'нокаута', 'нокаутов'])} за вечер`;
    case 'comeback':
      return top
        ? `победа после ${n} и больше ${plural(n, ['ребая', 'ребаев', 'ребаев'])}`
        : `победа после ${n} ${plural(n, ['ребая', 'ребаев', 'ребаев'])}`;
    case 'sworn_enemy':
      return `${n} ${plural(n, ['нокаут', 'нокаута', 'нокаутов'])} одного и того же игрока`;
    case 'star':
      return `от ${n} ${plural(n, ['звезды', 'звёзд', 'звёзд'])} вечера`;
  }
}

/**
 * За что считается уровень — правило без порогов, со строчной и без рода; каталог ставит его над
 * строками уровней («I — 3 нокаута за вечер»), иначе у «Звезды вечера» не видно, за что звезда.
 */
export const ACHIEVEMENT_LEVEL_RULE: Record<LeveledCode, string> = {
  hunter: 'нокауты за один вечер',
  comeback: 'победа в вечере после ребаев',
  sworn_enemy: 'нокауты одного и того же игрока за всё время',
  star: 'звезда — за единоличную победу в номинации голосования, от 2 голосов; ничья — без звезды',
};

/**
 * Названия и описания — нейтральные, без рода и без «ты»: их показывают и на чужой карточке.
 * Порядок ключей — порядок ачивок в каталоге, на карточке игрока и в прогрессе.
 */
export const ACHIEVEMENT_META: Record<AchievementCode, { title: string; description: string }> = {
  first_blood: { title: 'Первая кровь', description: 'Первый нокаут в истории клуба' },
  hunter: {
    title: 'Охотник',
    description: 'Нокауты за один вечер: 3 — I, 4 — II, 5 и больше — III',
  },
  comeback: {
    title: 'Камбэк',
    description: 'Победа в вечере после ребаев: 2 — I, 3 и больше — II',
  },
  phoenix: { title: 'Феникс', description: 'Первый вылет вечера — и всё равно победа' },
  clean_win: { title: 'Чистая победа', description: 'Победа в вечере без единого ребая' },
  rebuy_king: { title: 'Ребай-король', description: 'Больше всех ребаев за сезон' },
  iron_chair: {
    title: 'Железный стул',
    description: 'Ни одного пропущенного игрового дня за сезон',
  },
  hat_trick: {
    title: 'Хет-трик',
    description: 'Три победы подряд (пропущенный вечер серию не рвёт)',
  },
  sworn_enemy: {
    title: 'Заклятый враг',
    description: 'Нокауты одного и того же игрока за всё время: 5 — I, 10 — II, 15 — III',
  },
  revenge: {
    title: 'Месть',
    description: 'Нокаут своей Немезиды — того, кто чаще всех выбивает игрока',
  },
  king_hunt: { title: 'Охота на короля', description: 'Нокаут действующего чемпиона сезона' },
  oracle: { title: 'Оракул', description: 'Победитель угадан в трёх прогнозах подряд' },
  star: {
    title: 'Звезда вечера',
    description:
      'Единоличная победа в номинации голосования, от 2 голосов: 1 звезда — I, 5 — II, 10 — III',
  },
  champion: { title: 'Чемпион сезона', description: '1-е место по итогам сезона' },
};

/** Все коды в порядке каталога (ACHIEVEMENT_META). */
export const ACHIEVEMENT_CODES = Object.keys(ACHIEVEMENT_META) as AchievementCode[];

/** Сезонные: их дают за каждый завершённый сезон. */
export const SEASONAL_ACHIEVEMENTS: ReadonlySet<AchievementCode> = new Set([
  'rebuy_king',
  'iron_chair',
  'champion',
]);

export const TITLE_META = {
  nemesis: { title: 'Немезида', description: 'Чаще всех выбивает этого игрока (минимум 2 раза)' },
  form: { title: 'Форма', description: 'Больше всех очков за последние 5 вечеров клуба' },
} as const;

/** «Звезда вечера» в одной номинации: единственный лидер голосования (starWinner). */
export interface StarAward {
  eveningId: string;
  category: VoteCategory;
  playerId: PlayerId;
  votes: number;
}

/**
 * Звёзды вечера по итогам его голосования (voteResults): по номинации — единственному лидеру с
 * STAR_MIN_VOTES голосами и больше, ничья или один голос — никому. Только закрытые голосования:
 * пока голосование идёт, лидер может смениться (а до закрытия RLS отдаёт игроку лишь свои голоса).
 */
export function starAwards(
  eveningId: string,
  results: Readonly<Record<VoteCategory, VoteResult>>,
): StarAward[] {
  const out: StarAward[] = [];
  for (const category of VOTE_CATEGORIES) {
    const result = results[category];
    const winner = starWinner(result);
    if (winner !== null)
      out.push({ eveningId, category, playerId: winner, votes: result.counts[winner] ?? 0 });
  }
  return out;
}

export interface AchievementInput {
  summaries: readonly EveningSummary[]; // завершённые вечера, порядок любой
  excluded: ReadonlySet<PlayerId>; // гости: ачивок и званий не получают
  predictions: readonly ScoredPrediction[];
  stars: readonly StarAward[];
  bestN: number; // settings.season_best_n — для чемпиона сезона без замороженного значения
  currentSeasonKey: string; // сезоны с ключом меньше — завершены
  /** Замороженные «лучшие N» закрытых сезонов (season_rules, миграция 013) — для чемпиона. */
  bestNBySeason?: SeasonBestN;
}

/** Хронология: по дате вечера, при равенстве — по id, чтобы порядок был детерминирован. */
export function chronological(summaries: readonly EveningSummary[]): EveningSummary[] {
  return [...summaries].sort(
    (a, b) =>
      Date.parse(a.date) - Date.parse(b.date) ||
      (a.eveningId < b.eveningId ? -1 : a.eveningId > b.eveningId ? 1 : 0),
  );
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const keyOf = (
  a: Pick<Achievement, 'playerId' | 'code' | 'eveningId' | 'seasonKey' | 'targetId'>,
): string =>
  `${a.playerId}|${a.code}|${a.eveningId ?? ''}|${a.seasonKey ?? ''}|${a.targetId ?? ''}`;

/** Сборщик строк: одна строка на ключ, повтор — count += n и наибольший уровень. Гостям — ничего. */
function collector(excluded: ReadonlySet<PlayerId>) {
  const found = new Map<string, Achievement>();
  const add = (
    playerId: PlayerId,
    code: AchievementCode,
    where: { eveningId?: string; seasonKey?: string },
    opts: { targetId?: PlayerId; level?: number; count?: number } = {},
  ): void => {
    if (excluded.has(playerId)) return;
    const a: Achievement = {
      playerId,
      code,
      eveningId: where.eveningId ?? null,
      seasonKey: where.seasonKey ?? null,
      targetId: opts.targetId ?? null,
      count: opts.count ?? 1,
      level: opts.level ?? 1,
      first: false,
    };
    const k = keyOf(a);
    const prev = found.get(k);
    if (prev) {
      prev.count += a.count;
      prev.level = Math.max(prev.level, a.level);
    } else found.set(k, a);
  };
  return { add, rows: () => [...found.values()] };
}

/**
 * Отметить first: строки игрока с одним кодом — по хронологии (вечер по порядку итогов, сезон — по
 * ключу; вечер, которого нет в итогах, — в конце); при равенстве — сначала старший уровень.
 */
function markFirst(rows: Achievement[], order: ReadonlyMap<string, number>): void {
  const pos = (a: Achievement): number =>
    a.eveningId !== null ? (order.get(a.eveningId) ?? Number.MAX_SAFE_INTEGER) : 0;
  const groups = new Map<string, Achievement[]>();
  for (const a of rows) {
    const k = `${a.playerId}|${a.code}`;
    const list = groups.get(k) ?? [];
    list.push(a);
    groups.set(k, list);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        pos(a) - pos(b) ||
        compareSeasonKeys(a.seasonKey ?? '', b.seasonKey ?? '') ||
        cmpStr(a.eveningId ?? '', b.eveningId ?? '') ||
        b.level - a.level ||
        cmpStr(a.targetId ?? '', b.targetId ?? ''),
    );
    let max = 0;
    for (const a of list) {
      a.first = a.level > max;
      max = Math.max(max, a.level);
    }
  }
}

const byKey = (a: Achievement, b: Achievement): number => cmpStr(keyOf(a), keyOf(b));

/**
 * Счёт «кто кого выбивал» для звания «Немезида»: итоги подаются по хронологии. Немезида игрока —
 * кто чаще всех его выбивал (минимум nemesisMinKos раз); при равенстве — кто сделал это позже.
 * Гости не считаются ни выбившими, ни выбитыми.
 */
function nemesisCounter(excluded: ReadonlySet<PlayerId>) {
  let seq = 0;
  const counts = new Map<PlayerId, Map<PlayerId, { n: number; last: number }>>();
  return {
    add(s: EveningSummary): void {
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
    },
    /** Немезида игрока victim сейчас; null — нет. */
    holder(victim: PlayerId): PlayerId | null {
      let best: { id: PlayerId; n: number; last: number } | null = null;
      for (const [id, c] of counts.get(victim) ?? []) {
        if (!best || c.n > best.n || (c.n === best.n && c.last > best.last)) best = { id, ...c };
      }
      return best && best.n >= ACHIEVEMENT_THRESHOLDS.nemesisMinKos ? best.id : null;
    },
    victims(): PlayerId[] {
      return [...counts.keys()];
    },
  };
}

/**
 * «Месть» в вечере: кто выбил свою Немезиду. nemesisOf — звание по вечерам ДО этого (titles);
 * пара (выбивший, Немезида) — один раз за вечер, при дележе нокаута — каждому выбившему.
 */
export function revengesIn(
  summary: Pick<EveningSummary, 'busts'>,
  nemesisOf: (playerId: PlayerId) => PlayerId | null,
): { playerId: PlayerId; nemesisId: PlayerId }[] {
  const seen = new Set<string>();
  const out: { playerId: PlayerId; nemesisId: PlayerId }[] = [];
  for (const b of summary.busts) {
    for (const killer of b.by) {
      const key = `${killer}|${b.victim}`;
      if (seen.has(key) || nemesisOf(killer) !== b.victim) continue;
      seen.add(key);
      out.push({ playerId: killer, nemesisId: b.victim });
    }
  }
  return out;
}

/**
 * Действующий чемпион для вечера сезона key — чемпион(ы) предыдущего сезона (значок чемпиона
 * держится до конца следующего сезона). Пусто — в прошлом сезоне вечеров или очков не было.
 */
export function reigningChampionsFor(
  input: Pick<AchievementInput, 'summaries' | 'excluded' | 'bestN' | 'bestNBySeason'>,
  key: string,
): PlayerId[] {
  let previous: string;
  try {
    previous = previousSeasonKey(key);
  } catch {
    return [];
  }
  return seasonChampions(
    seasonStandings(input.summaries, {
      bestN: input.bestN,
      excluded: input.excluded,
      seasonKey: previous,
      bestNBySeason: input.bestNBySeason,
    }),
  );
}

/**
 * «Охота на короля» в вечере: нокауты действующего чемпиона (champions); пара (выбивший, чемпион) —
 * один раз за вечер, при дележе — каждому выбившему.
 */
export function kingHuntsIn(
  summary: Pick<EveningSummary, 'busts'>,
  champions: readonly PlayerId[],
): { playerId: PlayerId; championId: PlayerId }[] {
  const seen = new Set<string>();
  const out: { playerId: PlayerId; championId: PlayerId }[] = [];
  for (const b of summary.busts) {
    if (!champions.includes(b.victim)) continue;
    for (const killer of b.by) {
      const key = `${killer}|${b.victim}`;
      if (killer === b.victim || seen.has(key)) continue;
      seen.add(key);
      out.push({ playerId: killer, championId: b.victim });
    }
  }
  return out;
}

/**
 * Строки «Звезды вечера»: на (игрок, вечер) — count звёзд этого вечера, уровень — по числу звёзд
 * игрока за всё время после этого вечера (1 — I, 5 — II, 10 — III). Вечера — по хронологии итогов.
 */
function starRows(
  input: Pick<AchievementInput, 'stars' | 'excluded'>,
  order: ReadonlyMap<string, number>,
  add: ReturnType<typeof collector>['add'],
): void {
  const perEvening = new Map<string, { playerId: PlayerId; eveningId: string; n: number }>();
  for (const st of input.stars) {
    const k = `${st.playerId}|${st.eveningId}`;
    const row = perEvening.get(k) ?? { playerId: st.playerId, eveningId: st.eveningId, n: 0 };
    row.n += 1;
    perEvening.set(k, row);
  }
  const pos = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rows = [...perEvening.values()].sort(
    (a, b) => pos(a.eveningId) - pos(b.eveningId) || cmpStr(a.eveningId, b.eveningId),
  );
  const total = new Map<PlayerId, number>();
  for (const r of rows) {
    const n = (total.get(r.playerId) ?? 0) + r.n;
    total.set(r.playerId, n);
    add(r.playerId, 'star', { eveningId: r.eveningId }, { count: r.n, level: levelFor('star', n) });
  }
}

/** Только «Звёзды вечера» — тот же подсчёт, что в computeAchievements (лента моментов). */
export function starAchievements(
  input: Pick<AchievementInput, 'summaries' | 'excluded' | 'stars'>,
): Achievement[] {
  const order = new Map(chronological(input.summaries).map((s, i) => [s.eveningId, i]));
  const c = collector(input.excluded);
  starRows(input, order, c.add);
  const rows = c.rows();
  markFirst(rows, order);
  return rows.sort(byKey);
}

export function computeAchievements(input: AchievementInput): Achievement[] {
  const T = ACHIEVEMENT_THRESHOLDS;
  const { excluded } = input;
  const { add, rows } = collector(excluded);
  const evenings = chronological(input.summaries);
  const order = new Map(evenings.map((s, i) => [s.eveningId, i]));
  const at = (s: EveningSummary) => ({ eveningId: s.eveningId });

  // first_blood: первый нокаут клуба; при дележе — всем выбившим. Если выбил гость, ачивка
  // не достаётся никому (следующий нокаут уже не «первый»).
  for (const s of evenings) {
    const first = s.busts.find((b) => b.by.length > 0);
    if (first) {
      for (const k of first.by) add(k, 'first_blood', at(s));
      break;
    }
  }

  // Действующие чемпионы по сезонам вечеров — для «Охоты на короля». Прошлый сезон вечера из
  // истории всегда завершён: он раньше сезона вечера, а тот — не позже текущего.
  const reigning = new Map<string, PlayerId[]>();
  const championsFor = (key: string): PlayerId[] => {
    let list = reigning.get(key);
    if (list === undefined) {
      list = reigningChampionsFor(input, key);
      reigning.set(key, list);
    }
    return list;
  };

  const winStreak = new Map<PlayerId, number>();
  const pairKos = new Map<string, number>();
  const nemesis = nemesisCounter(excluded);
  for (const s of evenings) {
    const winner = s.places[0];
    for (const id of s.entrants) {
      const kos = s.kos[id] ?? 0;
      const hunter = levelFor('hunter', kos);
      if (hunter > 0) add(id, 'hunter', at(s), { level: hunter });
      // Хет-трик: серии не перекрываются — 6 побед подряд = 2 хет-трика.
      const streak = id === winner ? (winStreak.get(id) ?? 0) + 1 : 0;
      if (streak >= T.hatTrickWins) {
        add(id, 'hat_trick', at(s));
        winStreak.set(id, 0);
      } else winStreak.set(id, streak);
    }
    if (winner !== undefined) {
      const rebuys = s.rebuys[winner] ?? 0;
      const comeback = levelFor('comeback', rebuys);
      if (comeback > 0) add(winner, 'comeback', at(s), { level: comeback });
      // Феникс: первый вылет вечера — и победа (вернулся ребаем).
      if (s.firstBustPlayerId === winner) add(winner, 'phoenix', at(s));
      if (rebuys === 0) add(winner, 'clean_win', at(s));
    }
    // Заклятый враг — по паре: строка в вечере, где пара взяла порог (5, 10, 15 нокаутов), с
    // наибольшим взятым уровнем. Шестой нокаут уровень не повторяет.
    const before = new Map<string, number>();
    for (const [killer, victim] of s.koPairs) {
      const k = `${killer}|${victim}`;
      if (!before.has(k)) before.set(k, pairKos.get(k) ?? 0);
      pairKos.set(k, (pairKos.get(k) ?? 0) + 1);
    }
    for (const [k, was] of before) {
      const [killer = '', victim = ''] = k.split('|');
      const now = levelFor('sworn_enemy', pairKos.get(k) ?? 0);
      if (now > levelFor('sworn_enemy', was))
        add(killer, 'sworn_enemy', at(s), { targetId: victim, level: now });
    }
    // Месть — по Немезиде до этого вечера; потом счёт пополняется этим вечером.
    for (const r of revengesIn(s, (id) => nemesis.holder(id)))
      add(r.playerId, 'revenge', at(s), { targetId: r.nemesisId });
    nemesis.add(s);
    for (const h of kingHuntsIn(s, championsFor(s.seasonKey)))
      add(h.playerId, 'king_hunt', at(s), { targetId: h.championId });
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
        add(playerId, 'oracle', { eveningId: p.eveningId });
        streak = 0;
      }
    }
  }

  starRows(input, order, add);

  // Сезонные — только по завершённым сезонам: в текущем лидер ещё может смениться.
  const seasons = [...new Set(evenings.map((s) => s.seasonKey))].filter(
    (k) => compareSeasonKeys(k, input.currentSeasonKey) < 0,
  );
  for (const key of seasons) {
    const inSeason = evenings.filter((s) => s.seasonKey === key);
    const rebuys = new Map<PlayerId, number>();
    for (const s of inSeason) {
      for (const id of s.entrants) {
        if (excluded.has(id)) continue; // гость не может «отнять» ребай-короля у постоянного
        rebuys.set(id, (rebuys.get(id) ?? 0) + (s.rebuys[id] ?? 0));
      }
    }
    const maxRebuys = Math.max(0, ...rebuys.values());
    if (maxRebuys > 0)
      for (const [id, n] of rebuys) if (n === maxRebuys) add(id, 'rebuy_king', { seasonKey: key });
    const { days, playedDays } = seasonGameDays(inSeason, excluded);
    for (const [id, n] of playedDays) if (n === days) add(id, 'iron_chair', { seasonKey: key });

    const rows = seasonStandings(inSeason, {
      bestN: input.bestN,
      excluded,
      seasonKey: key,
      bestNBySeason: input.bestNBySeason,
    });
    for (const id of seasonChampions(rows)) add(id, 'champion', { seasonKey: key });
  }

  const list = rows();
  markFirst(list, order);
  return list.sort(byKey);
}

/**
 * «Железный стул» по игровым дням (решение клуба 10.10.2026): день — московская дата вечера
 * (gameDayKey), в один день бывает несколько игр (миграция 026). days — сколько игровых дней в
 * сезоне; playedDays — в скольких из них игрок сел хотя бы за одну игру (гости — нет). Стул — у тех,
 * у кого playedDays === days: ушёл после игры 1 — день всё равно засчитан.
 */
export function seasonGameDays(
  inSeason: readonly Pick<EveningSummary, 'date' | 'entrants'>[],
  excluded: ReadonlySet<PlayerId> = new Set(),
): { days: number; playedDays: Map<PlayerId, number> } {
  const all = new Set<string>();
  const byPlayer = new Map<PlayerId, Set<string>>();
  for (const s of inSeason) {
    const day = gameDayKey(s.date);
    all.add(day);
    for (const id of s.entrants) {
      if (excluded.has(id)) continue;
      const set = byPlayer.get(id) ?? new Set<string>();
      set.add(day);
      byPlayer.set(id, set);
    }
  }
  return {
    days: all.size,
    playedDays: new Map([...byPlayer].map(([id, set]) => [id, set.size])),
  };
}

/** Уровень игрока в ачивке — наибольший из его строк; 0 — не получена. */
export function playerLevel(
  achievements: readonly Achievement[],
  playerId: PlayerId,
  code: AchievementCode,
): number {
  let level = 0;
  for (const a of achievements)
    if (a.playerId === playerId && a.code === code) level = Math.max(level, a.level);
  return level;
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
  const counter = nemesisCounter(excluded);
  for (const s of evenings) {
    for (const id of s.entrants) if (!excluded.has(id)) nemesis[id] = null;
    counter.add(s);
  }
  for (const victim of counter.victims()) nemesis[victim] = counter.holder(victim);

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
 * (в поле count — только прирост). Уровень и first — как в after.
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
