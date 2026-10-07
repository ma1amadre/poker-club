// Рекорды клуба: пять видов, считаются из итогов вечеров, ничего не хранится.
//
// Правила (решение клуба и уточнения домена):
// - Рекорды игрока (выигрыш, нокауты, серия побед) — только у постоянных игроков: гость в
//   рекорды не попадает, как и в ачивки. Рекорды вечера (фонд, длина игры) — у всех вечеров,
//   гости в них просто участвуют.
// - Рекорд засчитывается от минимального значения: выигрыш и нокауты > 0, серия побед ≥ 2
//   (одна победа — ещё не серия), фонд и длина игры > 0.
// - Ничья — все держатели; первым идёт тот, кто установил раньше (хронология вечеров; внутри
//   одного вечера — по занятому месту). Один игрок с одинаковым рекордом в двух вечерах —
//   один держатель, с самым ранним вечером.
// - recordsBroken: первый вечер клуба задаёт отсчёт и рекордом не считается — иначе каждая
//   его цифра была бы «рекордом». Со второго вечера: значение выше прежнего лучшего — новый
//   рекорд (`new`), равное — повторён (`equalled`). Если раньше значения не было вовсе
//   (например, первый нокаут случился только на третьем вечере), это тоже `new` с previous = null.
import { chronological } from './achievements.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';

export type RecordKind =
  | 'biggest_win' // крупнейший выигрыш за вечер: нетто игрока, ₽
  | 'most_kos' // больше всего нокаутов за вечер
  | 'win_streak' // самая длинная серия побед подряд в вечерах, где игрок играл
  | 'biggest_pool' // самый большой фонд вечера, ₽
  | 'longest_game'; // самая длинная игра: чистое игровое время без пауз, мс

export const RECORD_KINDS: readonly RecordKind[] = [
  'biggest_win',
  'most_kos',
  'win_streak',
  'biggest_pool',
  'longest_game',
];

export interface RecordMeta {
  title: string;
  /** player — держатель игрок; evening — держатель вечер (playerId = null). */
  scope: 'player' | 'evening';
  /** Единица значения: рубли, штуки (нокауты, вечера подряд), миллисекунды. */
  unit: 'rub' | 'count' | 'ms';
  /** Минимальное значение, с которого это рекорд. */
  min: number;
}

export const RECORD_META: Record<RecordKind, RecordMeta> = {
  biggest_win: { title: 'Крупнейший выигрыш за вечер', scope: 'player', unit: 'rub', min: 1 },
  most_kos: { title: 'Больше всего нокаутов за вечер', scope: 'player', unit: 'count', min: 1 },
  win_streak: { title: 'Самая длинная серия побед', scope: 'player', unit: 'count', min: 2 },
  biggest_pool: { title: 'Самый большой фонд', scope: 'evening', unit: 'rub', min: 1 },
  longest_game: { title: 'Самая длинная игра', scope: 'evening', unit: 'ms', min: 1 },
};

export interface RecordHolder {
  playerId: PlayerId | null; // null у рекордов вечера
  eveningId: string; // вечер, где установлен (у серии — вечер, где она достигла этой длины)
  date: string; // дата этого вечера (summary.date)
}

export interface ClubRecord {
  kind: RecordKind;
  value: number | null; // null — рекорда пока нет
  holders: RecordHolder[]; // первым — установивший раньше
}

export interface RecordBreak {
  kind: RecordKind;
  value: number;
  previous: number | null; // лучшее значение до этого вечера; null — значения ещё не было
  status: 'new' | 'equalled';
  playerIds: PlayerId[]; // кто установил/повторил; пусто у рекордов вечера
}

export interface RecordsOptions {
  excluded: ReadonlySet<PlayerId>; // гости: в рекорды игрока не попадают
}

interface Performance {
  kind: RecordKind;
  value: number;
  playerId: PlayerId | null;
}

/**
 * Достижения одного вечера по всем видам. streaks — серии побед ДО этого вечера; функция
 * обновляет их (поэтому вечера надо подавать в хронологии).
 */
function eveningPerformances(
  s: EveningSummary,
  excluded: ReadonlySet<PlayerId>,
  streaks: Map<PlayerId, number>,
): Performance[] {
  const out: Performance[] = [];
  // Внутри вечера держатели идут по занятому месту.
  const byPlace = [...s.entrants].sort(
    (a, b) => placeIndex(s, a) - placeIndex(s, b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const winner = s.places[0];
  for (const id of byPlace) {
    // Серия считается и у гостя (чтобы не ломать порядок), но в рекорды он не идёт.
    const streak = id === winner ? (streaks.get(id) ?? 0) + 1 : 0;
    streaks.set(id, streak);
    if (excluded.has(id)) continue;
    out.push({ kind: 'biggest_win', value: s.netRub[id] ?? 0, playerId: id });
    out.push({ kind: 'most_kos', value: s.kos[id] ?? 0, playerId: id });
    if (id === winner) out.push({ kind: 'win_streak', value: streak, playerId: id });
  }
  if (s.prizePoolRub !== undefined)
    out.push({ kind: 'biggest_pool', value: s.prizePoolRub, playerId: null });
  if (s.durationMs !== undefined)
    out.push({ kind: 'longest_game', value: s.durationMs, playerId: null });
  return out.filter((p) => p.value >= RECORD_META[p.kind].min);
}

function placeIndex(s: EveningSummary, id: PlayerId): number {
  const i = s.places.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Текущие рекорды клуба: по одной строке на каждый вид, в порядке RECORD_KINDS. */
export function recordsTable(
  summaries: readonly EveningSummary[],
  opts: RecordsOptions,
): ClubRecord[] {
  const best = new Map<RecordKind, { value: number; holders: RecordHolder[] }>();
  const streaks = new Map<PlayerId, number>();
  for (const s of chronological(summaries)) {
    for (const p of eveningPerformances(s, opts.excluded, streaks)) {
      const holder: RecordHolder = { playerId: p.playerId, eveningId: s.eveningId, date: s.date };
      const cur = best.get(p.kind);
      if (!cur || p.value > cur.value) best.set(p.kind, { value: p.value, holders: [holder] });
      else if (p.value === cur.value) {
        // Тот же игрок повторил свой рекорд — остаётся один держатель с ранним вечером.
        const dup = p.playerId !== null && cur.holders.some((h) => h.playerId === p.playerId);
        if (!dup) cur.holders.push(holder);
      }
    }
  }
  return RECORD_KINDS.map((kind) => {
    const b = best.get(kind);
    return { kind, value: b ? b.value : null, holders: b ? b.holders : [] };
  });
}

/**
 * Рекорды, которые установил или повторил каждый вечер: eveningId → список (у вечера без
 * рекордов — пустой массив; есть ключ у каждого вечера). Порядок входа любой — сортируется
 * по хронологии. Первый вечер клуба рекордов не ставит (см. шапку файла).
 */
export function recordsBroken(
  summaries: readonly EveningSummary[],
  opts: RecordsOptions,
): Record<string, RecordBreak[]> {
  const result: Record<string, RecordBreak[]> = {};
  const best = new Map<RecordKind, number>();
  const streaks = new Map<PlayerId, number>();
  chronological(summaries).forEach((s, index) => {
    const perf = eveningPerformances(s, opts.excluded, streaks);
    const breaks: RecordBreak[] = [];
    for (const kind of RECORD_KINDS) {
      const mine = perf.filter((p) => p.kind === kind);
      if (mine.length === 0) continue;
      const value = Math.max(...mine.map((p) => p.value));
      const previous = best.get(kind) ?? null;
      if (index > 0 && (previous === null || value >= previous)) {
        const playerIds = mine
          .filter((p) => p.value === value && p.playerId !== null)
          .map((p) => p.playerId as PlayerId);
        breaks.push({
          kind,
          value,
          previous,
          status: previous === null || value > previous ? 'new' : 'equalled',
          playerIds,
        });
      }
      if (previous === null || value > previous) best.set(kind, value);
    }
    result[s.eveningId] = breaks;
  });
  return result;
}
