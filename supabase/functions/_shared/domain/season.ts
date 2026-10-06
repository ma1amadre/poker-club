// Сезоны (календарные кварталы по Москве) и таблицы: сезон, всё время, оракул, зал славы.
import { roundPoints } from './scoring.ts';
import type { ScoredPrediction } from './predictions.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();

function yearMonthIn(dateMs: number, tz: string): { year: number; month: number } {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric' });
    formatters.set(tz, fmt);
  }
  const parts = fmt.formatToParts(new Date(dateMs));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/**
 * Ключ сезона '2026-Q4'. Квартал определяется по клубному часовому поясу, а не по UTC:
 * игра 31.12 в 23:30 UTC — это уже 01.01 по Москве, то есть следующий сезон.
 */
export function seasonKey(dateIso: string, tz = 'Europe/Moscow'): string {
  const ms = Date.parse(dateIso);
  if (Number.isNaN(ms)) throw new Error(`Некорректная дата: ${dateIso}`);
  const { year, month } = yearMonthIn(ms, tz);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** Предыдущий сезон: '2027-Q1' → '2026-Q4'. Нужен для значка чемпиона «до конца следующего сезона». */
export function previousSeasonKey(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) throw new Error(`Некорректный ключ сезона: ${key}`);
  const year = Number(m[1]);
  const q = Number(m[2]);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

/** Строки ключей сравнимы как строки (год из 4 цифр), отдельный парсинг не нужен. */
export function compareSeasonKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface StandingRow {
  playerId: PlayerId;
  total: number; // сумма засчитанных очков
  counted: number[]; // засчитанные вечера (лучшие N), по убыванию
  played: number;
  wins: number;
  kos: number;
  netRub: number; // денежный профит за все сыгранные вечера, не только засчитанные
}

export interface StandingsOptions {
  bestN: number; // settings.season_best_n
  excluded: ReadonlySet<PlayerId>; // гости
  seasonKey?: string; // если задан — берутся только вечера этого сезона
}

/** Порядок таблицы: очки, потом победы, потом нокауты; playerId — только для стабильности. */
function compareRows(a: StandingRow, b: StandingRow): number {
  return b.total - a.total || b.wins - a.wins || b.kos - a.kos || (a.playerId < b.playerId ? -1 : 1);
}

/** Делят место: равны очки, победы и нокауты. */
export function sameRank(a: StandingRow, b: StandingRow): boolean {
  return a.total === b.total && a.wins === b.wins && a.kos === b.kos;
}

function buildStandings(
  summaries: readonly EveningSummary[],
  bestN: number,
  excluded: ReadonlySet<PlayerId>,
): StandingRow[] {
  const acc = new Map<PlayerId, { points: number[]; wins: number; kos: number; netRub: number }>();
  for (const s of summaries) {
    for (const id of s.entrants) {
      if (excluded.has(id)) continue;
      let a = acc.get(id);
      if (!a) {
        a = { points: [], wins: 0, kos: 0, netRub: 0 };
        acc.set(id, a);
      }
      a.points.push(s.points[id] ?? 0);
      if (s.places[0] === id) a.wins += 1;
      a.kos += s.kos[id] ?? 0;
      a.netRub += s.netRub[id] ?? 0;
    }
  }
  const rows: StandingRow[] = [];
  for (const [playerId, a] of acc) {
    const counted = [...a.points].sort((x, y) => y - x).slice(0, Math.max(0, bestN));
    rows.push({
      playerId,
      total: roundPoints(counted.reduce((x, y) => x + y, 0)),
      counted,
      played: a.points.length,
      wins: a.wins,
      kos: a.kos,
      netRub: a.netRub,
    });
  }
  return rows.sort(compareRows);
}

/** Таблица сезона: сумма лучших bestN вечеров, гости исключены. */
export function seasonStandings(summaries: readonly EveningSummary[], opts: StandingsOptions): StandingRow[] {
  const list = opts.seasonKey === undefined ? summaries : summaries.filter((s) => s.seasonKey === opts.seasonKey);
  return buildStandings(list, opts.bestN, opts.excluded);
}

/** Зачёт за всё время: все вечера без ограничения лучших N. */
export function allTimeStandings(
  summaries: readonly EveningSummary[],
  opts: { excluded: ReadonlySet<PlayerId> },
): StandingRow[] {
  return buildStandings(summaries, Number.POSITIVE_INFINITY, opts.excluded);
}

/** Таблица денежного профита: те же строки, отсортированные по netRub. */
export function moneyStandings(
  summaries: readonly EveningSummary[],
  opts: { excluded: ReadonlySet<PlayerId>; seasonKey?: string },
): StandingRow[] {
  const list = opts.seasonKey === undefined ? summaries : summaries.filter((s) => s.seasonKey === opts.seasonKey);
  return buildStandings(list, Number.POSITIVE_INFINITY, opts.excluded).sort(
    (a, b) => b.netRub - a.netRub || (a.playerId < b.playerId ? -1 : 1),
  );
}

export interface OracleRow {
  playerId: PlayerId;
  total: number;
  predictions: number;
  winnerHits: number;
  firstOutHits: number;
}

/** «Оракул сезона»: сумма очков прогнозов. Участвуют и те, кто сам не играл. */
export function oracleStandings(predictionScores: readonly ScoredPrediction[]): OracleRow[] {
  const acc = new Map<PlayerId, OracleRow>();
  for (const p of predictionScores) {
    let row = acc.get(p.playerId);
    if (!row) {
      row = { playerId: p.playerId, total: 0, predictions: 0, winnerHits: 0, firstOutHits: 0 };
      acc.set(p.playerId, row);
    }
    row.total += p.total;
    row.predictions += 1;
    if (p.winner > 0) row.winnerHits += 1;
    if (p.firstOut > 0) row.firstOutHits += 1;
  }
  return [...acc.values()].sort(
    (a, b) =>
      b.total - a.total || b.winnerHits - a.winnerHits || (a.playerId < b.playerId ? -1 : 1),
  );
}

export interface HallOfFameEntry {
  seasonKey: string;
  champions: PlayerId[]; // несколько — если делят 1-е место по очкам, победам и нокаутам
  total: number;
}

/** Чемпионы сезона: все, кто делит первую строку; пусто, если никто не набрал очков. */
export function seasonChampions(rows: readonly StandingRow[]): PlayerId[] {
  const top = rows[0];
  if (!top || top.total <= 0) return [];
  return rows.filter((r) => sameRank(r, top)).map((r) => r.playerId);
}

/** Зал славы: чемпионы завершённых сезонов (ключ меньше текущего), новые сверху. */
export function hallOfFame(
  summaries: readonly EveningSummary[],
  opts: { bestN: number; excluded: ReadonlySet<PlayerId>; currentSeasonKey: string },
): HallOfFameEntry[] {
  const keys = [...new Set(summaries.map((s) => s.seasonKey))]
    .filter((k) => compareSeasonKeys(k, opts.currentSeasonKey) < 0)
    .sort((a, b) => compareSeasonKeys(b, a));
  const result: HallOfFameEntry[] = [];
  for (const key of keys) {
    const rows = seasonStandings(summaries, { bestN: opts.bestN, excluded: opts.excluded, seasonKey: key });
    const champions = seasonChampions(rows);
    if (champions.length > 0) result.push({ seasonKey: key, champions, total: rows[0]?.total ?? 0 });
  }
  return result;
}
