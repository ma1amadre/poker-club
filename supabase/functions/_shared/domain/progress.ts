// Прогресс до ачивок: для каждой ещё не полученной (у уровневых — до следующего уровня) — счётчик
// «N из M» и подпись к нему. Правила подсчёта повторяют computeAchievements; пороги — из
// ACHIEVEMENT_THRESHOLDS и ACHIEVEMENT_LEVELS.
//
// Какие ачивки показываются:
// - уровневые (hunter, comeback, sworn_enemy, star) — пока не взят последний уровень: счётчик — до
//   следующего («4 из 5» к «Охотнику III»);
// - остальные вечерние (first_blood, phoenix, clean_win, hat_trick, revenge, king_hunt, oracle) —
//   только если игрок ни разу их не получал;
// - сезонные (iron_chair, rebuy_king, champion) — всегда, по текущему сезону: их дают за каждый
//   завершённый сезон заново, и текущий ещё не получен ни у кого; obtained — сколько раз уже были;
// - first_blood — только пока в клубе не было ни одного нокаута (потом её не получить никому);
// - у гостя ачивок нет — пустой список.
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_THRESHOLDS,
  chronological,
  computeAchievements,
  isLeveled,
  levelCount,
  levelThreshold,
  reigningChampionsFor,
  SEASONAL_ACHIEVEMENTS,
  titles,
  type AchievementCode,
  type AchievementInput,
  type LeveledCode,
} from './achievements.ts';
import { standingPlace } from './recap.ts';
import { seasonChampions, seasonStandings } from './season.ts';
import type { PlayerId } from './types.ts';

export interface AchievementProgress {
  code: AchievementCode;
  /**
   * Как показывать: count — «current из target»; place — «current-е место» (target = 1);
   * condition — счётчика нет, только условие в hint.
   */
  measure: 'count' | 'place' | 'condition';
  current: number | null; // null — счётчика нет (или у place — игрок ещё не в таблице)
  target: number | null;
  hint: string; // подпись к счётчику, на «ты», без рода
  /** Ещё достижима: false — например, вечер сезона уже пропущен для «Железного стула». */
  possible: boolean;
  /** Сколько раз уже получена (сумма count; у вечерних без уровней в списке всегда 0). */
  obtained: number;
  /** Уровень игрока сейчас: 0 — не получена; у ачивок без уровней — 0 или 1. */
  level: number;
  /** К какому уровню счётчик (уровневые: level + 1); null — у ачивок без уровней. */
  nextLevel: number | null;
  /** sworn_enemy — соперник с лучшим счётом; revenge — Немезида игрока сейчас. */
  victimId?: PlayerId;
  /** rebuy_king, champion — лидеры сезона сейчас; king_hunt — действующие чемпионы. */
  leaders?: PlayerId[];
  leaderValue?: number; // их ребаи / очки
  seasonKey?: string; // сезонные и king_hunt: текущий сезон
}

export function achievementProgress(
  input: AchievementInput,
  playerId: PlayerId,
): AchievementProgress[] {
  if (input.excluded.has(playerId)) return [];
  const T = ACHIEVEMENT_THRESHOLDS;
  const evenings = chronological(input.summaries);
  const order = new Map(evenings.map((s, i) => [s.eveningId, i]));
  const obtained = new Map<AchievementCode, number>();
  const levels = new Map<AchievementCode, number>();
  for (const a of computeAchievements(input))
    if (a.playerId === playerId) {
      obtained.set(a.code, (obtained.get(a.code) ?? 0) + a.count);
      levels.set(a.code, Math.max(levels.get(a.code) ?? 0, a.level));
    }

  const items = new Map<AchievementCode, AchievementProgress>();
  const put = (
    p: Omit<AchievementProgress, 'possible' | 'obtained' | 'level' | 'nextLevel'> & {
      possible?: boolean;
    },
  ) => {
    const level = levels.get(p.code) ?? 0;
    items.set(p.code, {
      possible: true,
      obtained: obtained.get(p.code) ?? 0,
      level,
      nextLevel: isLeveled(p.code) ? level + 1 : null,
      ...p,
    });
  };
  /** Порог следующего уровня уровневой ачивки (последний взят — порог последнего). */
  const nextTarget = (code: LeveledCode): number => {
    const level = Math.min((levels.get(code) ?? 0) + 1, levelCount(code));
    return levelThreshold(code, level) ?? 0;
  };

  // first_blood: пока в клубе не было нокаута.
  if (!evenings.some((s) => s.busts.some((b) => b.by.length > 0)))
    put({
      code: 'first_blood',
      measure: 'count',
      current: 0,
      target: 1,
      hint: 'первого нокаута в клубе ещё не было',
    });

  // hunter: лучший вечер по нокаутам — до порога следующего уровня.
  const mine = evenings.filter((s) => s.entrants.includes(playerId));
  put({
    code: 'hunter',
    measure: 'count',
    current: Math.max(0, ...mine.map((s) => s.kos[playerId] ?? 0)),
    target: nextTarget('hunter'),
    hint: 'нокауты в твоём лучшем вечере',
  });

  put({
    code: 'comeback',
    measure: 'condition',
    current: null,
    target: null,
    hint: `победа в вечере, где понадобилось ${nextTarget('comeback')} и больше ребаев`,
  });

  put({
    code: 'phoenix',
    measure: 'condition',
    current: null,
    target: null,
    hint: 'первый вылет вечера — и всё равно победа',
  });

  put({
    code: 'clean_win',
    measure: 'condition',
    current: null,
    target: null,
    hint: 'победа в вечере без единого ребая',
  });

  // hat_trick: текущая серия побед в вечерах, где играл (серии не перекрываются, как в ачивке).
  let streak = 0;
  for (const s of mine) {
    streak = s.places[0] === playerId ? streak + 1 : 0;
    if (streak >= T.hatTrickWins) streak = 0;
  }
  put({
    code: 'hat_trick',
    measure: 'count',
    current: streak,
    target: T.hatTrickWins,
    hint: 'победы подряд сейчас',
  });

  // sworn_enemy: больше всего нокаутов одного и того же соперника (уровень — по лучшей паре, так
  // что счёт лучшей пары всегда ниже следующего порога); при равенстве — кого выбивал позже.
  const pairs = new Map<PlayerId, { n: number; last: number }>();
  let seq = 0;
  for (const s of evenings)
    for (const [killer, victim] of s.koPairs) {
      seq += 1;
      if (killer !== playerId) continue;
      const c = pairs.get(victim) ?? { n: 0, last: 0 };
      c.n += 1;
      c.last = seq;
      pairs.set(victim, c);
    }
  let enemy: { id: PlayerId; n: number; last: number } | null = null;
  for (const [id, c] of pairs)
    if (!enemy || c.n > enemy.n || (c.n === enemy.n && c.last > enemy.last)) enemy = { id, ...c };
  put({
    code: 'sworn_enemy',
    measure: 'count',
    current: enemy?.n ?? 0,
    target: nextTarget('sworn_enemy'),
    hint: 'нокауты одного и того же соперника',
    ...(enemy ? { victimId: enemy.id } : {}),
  });

  // revenge: своя Немезида сейчас (звание по всей истории).
  const nemesis = titles(input).nemesis[playerId] ?? null;
  put({
    code: 'revenge',
    measure: 'condition',
    current: null,
    target: null,
    hint: nemesis ? 'нокаут твоей Немезиды' : 'у тебя пока нет Немезиды',
    ...(nemesis ? { victimId: nemesis } : {}),
  });

  // king_hunt: действующий чемпион — чемпион прошлого сезона.
  const key = input.currentSeasonKey;
  const kings = reigningChampionsFor(input, key);
  const huntable = kings.some((id) => id !== playerId);
  put({
    code: 'king_hunt',
    measure: 'condition',
    current: null,
    target: null,
    possible: huntable,
    hint:
      kings.length === 0
        ? 'действующего чемпиона пока нет — охота откроется со следующего сезона'
        : huntable
          ? 'нокаут действующего чемпиона сезона'
          : 'действующий чемпион — ты: охотятся на тебя',
    leaders: [...kings].sort(),
    seasonKey: key,
  });

  // oracle: текущая серия угаданных победителей по вечерам, где был прогноз.
  const preds = input.predictions
    .filter((p) => p.playerId === playerId && order.has(p.eveningId))
    .sort((a, b) => (order.get(a.eveningId) ?? 0) - (order.get(b.eveningId) ?? 0));
  let oracle = 0;
  for (const p of preds) {
    oracle = p.winner > 0 ? oracle + 1 : 0;
    if (oracle >= T.oracleStreak) oracle = 0;
  }
  put({
    code: 'oracle',
    measure: 'count',
    current: oracle,
    target: T.oracleStreak,
    hint: 'угаданные победители подряд',
  });

  // star: первой звезды нет — условие; дальше — звёзды за всё время до следующего уровня.
  const stars = obtained.get('star') ?? 0;
  put(
    stars === 0
      ? {
          code: 'star',
          measure: 'condition',
          current: null,
          target: null,
          hint: 'единоличная победа в номинации голосования, от 2 голосов',
        }
      : {
          code: 'star',
          measure: 'count',
          current: stars,
          target: nextTarget('star'),
          hint: 'звёзды вечера за всё время',
        },
  );

  // Сезонные — по текущему сезону.
  const season = evenings.filter((s) => s.seasonKey === key);
  const played = season.filter((s) => s.entrants.includes(playerId)).length;
  put({
    code: 'iron_chair',
    measure: 'count',
    current: played,
    target: season.length,
    possible: played === season.length,
    hint:
      season.length === 0
        ? 'в этом сезоне ещё не было вечеров'
        : played === season.length
          ? 'вечера сезона без пропусков'
          : 'в этом сезоне уже есть пропуск',
    seasonKey: key,
  });

  const rebuys = new Map<PlayerId, number>();
  for (const s of season)
    for (const id of s.entrants) {
      if (input.excluded.has(id)) continue;
      rebuys.set(id, (rebuys.get(id) ?? 0) + (s.rebuys[id] ?? 0));
    }
  const myRebuys = rebuys.get(playerId) ?? 0;
  const maxRebuys = Math.max(0, ...rebuys.values());
  const rebuyLeaders =
    maxRebuys > 0
      ? [...rebuys]
          .filter(([, n]) => n === maxRebuys)
          .map(([id]) => id)
          .sort()
      : [];
  put({
    code: 'rebuy_king',
    measure: 'count',
    current: myRebuys,
    target: maxRebuys,
    hint:
      maxRebuys === 0
        ? 'в этом сезоне ребаев ещё не было'
        : rebuyLeaders.includes(playerId)
          ? 'больше всех ребаев в сезоне — пока у тебя'
          : 'твои ребаи в сезоне против лидера',
    leaders: rebuyLeaders,
    leaderValue: maxRebuys,
    seasonKey: key,
  });

  const rows = seasonStandings(evenings, {
    bestN: input.bestN,
    excluded: input.excluded,
    seasonKey: key,
    bestNBySeason: input.bestNBySeason,
  });
  const top = rows[0];
  const place = standingPlace(rows, playerId);
  // Лидеры — как чемпионы сезона: все, кто делит первую строку, если у неё есть очки.
  const leaders = top && top.total > 0 ? seasonChampions(rows) : [];
  put({
    code: 'champion',
    measure: 'place',
    current: place,
    target: 1,
    hint: place === null ? 'в этом сезоне ещё нет твоих вечеров' : 'место в сезоне сейчас',
    leaders,
    leaderValue: top?.total ?? 0,
    seasonKey: key,
  });

  const shown = (code: AchievementCode): boolean => {
    if (SEASONAL_ACHIEVEMENTS.has(code)) return true;
    if (isLeveled(code)) return (levels.get(code) ?? 0) < levelCount(code);
    return (obtained.get(code) ?? 0) === 0;
  };
  return ACHIEVEMENT_CODES.filter((code) => items.has(code) && shown(code)).map(
    (code) => items.get(code) as AchievementProgress,
  );
}
