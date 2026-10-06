// Чистые помощники главной: какой вечер показать, кто идёт, место в сезоне и незакрытые расчёты.
// Следующая игра по расписанию — nextGameAt из shared/lib/clubTime. Деньги и места — только доменными функциями.
import { computeMoney, paymentsFromEvents, settlement } from '@domain/money.ts';
import { replay } from '@domain/replay.ts';
import { sameRank, type StandingRow } from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import type { EveningEvent, PlayerId, TournamentFormat } from '@domain/types.ts';
import type { EveningStatus, Player, Rsvp, RsvpStatus } from '../../shared/api';
import { RSVP_ORDER } from '../../shared/api';

// --- Ближайший вечер -------------------------------------------------------------------------

export interface UpcomingLike {
  status: EveningStatus;
  scheduled_at: string;
  started_at: string | null;
}

/** Анонс, время которого прошло больше чем на столько, считаем забытым (его должен отменить админ). */
export const STALE_ANNOUNCE_MS = 12 * 60 * 60 * 1000;

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Какой вечер показать на главной: идущая игра важнее анонса; среди анонсов — самый ранний
 * из не забытых. Если остались только забытые анонсы — последний из них, чтобы админ его увидел.
 */
export function pickUpcoming<T extends UpcomingLike>(
  evenings: readonly T[],
  nowMs: number,
): T | null {
  const live = evenings
    .filter((e) => e.status === 'live')
    .sort((a, b) => ms(b.started_at ?? b.scheduled_at) - ms(a.started_at ?? a.scheduled_at));
  if (live[0]) return live[0];

  const announced = evenings
    .filter((e) => e.status === 'announced')
    .sort((a, b) => ms(a.scheduled_at) - ms(b.scheduled_at));
  const fresh = announced.find((e) => ms(e.scheduled_at) >= nowMs - STALE_ANNOUNCE_MS);
  return fresh ?? announced[announced.length - 1] ?? null;
}

// --- Состав и прогнозы -----------------------------------------------------------------------

export type PlayerLike = Pick<
  Player,
  'id' | 'display_name' | 'photo_url' | 'is_guest' | 'is_active'
>;
export type RsvpLike = Pick<Rsvp, 'player_id' | 'status'>;

export interface RsvpGroups<P> {
  yes: P[];
  maybe: P[];
  no: P[];
  /** Постоянные участники клуба, которые ещё не ответили. */
  silent: P[];
}

/** Ответы на анонс по группам; внутри группы — в порядке ответов (rsvps приходят по updated_at). */
export function groupRsvps<P extends PlayerLike>(
  players: readonly P[],
  rsvps: readonly RsvpLike[],
): RsvpGroups<P> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const groups: RsvpGroups<P> = { yes: [], maybe: [], no: [], silent: [] };
  const answered = new Set<string>();
  for (const r of rsvps) {
    const p = byId.get(r.player_id);
    if (!p || answered.has(p.id)) continue;
    answered.add(p.id);
    groups[r.status].push(p);
  }
  groups.silent = players
    .filter((p) => p.is_active && !p.is_guest && !answered.has(p.id))
    .sort(byName);
  return groups;
}

function byName(a: PlayerLike, b: PlayerLike): number {
  return a.display_name.localeCompare(b.display_name, 'ru') || (a.id < b.id ? -1 : 1);
}

export interface Candidate<P> {
  player: P;
  rsvp: RsvpStatus | null;
}

/**
 * Кого можно назвать в прогнозе: все активные постоянные игроки и гости, отмеченные «иду».
 * Игроки из уже сохранённого прогноза остаются в списке, даже если перестали подходить.
 * Порядок: идут, под вопросом, не ответили, не идут; внутри — по имени.
 */
export function predictionCandidates<P extends PlayerLike>(
  players: readonly P[],
  rsvps: readonly RsvpLike[],
  keepIds: readonly (string | null | undefined)[] = [],
): Candidate<P>[] {
  const status = new Map<string, RsvpStatus>();
  for (const r of rsvps) status.set(r.player_id, r.status);
  const keep = new Set(keepIds.filter((id): id is string => Boolean(id)));
  return players
    .filter((p) => keep.has(p.id) || (p.is_active && (!p.is_guest || status.get(p.id) === 'yes')))
    .map((player) => ({ player, rsvp: status.get(player.id) ?? null }))
    .sort(
      (a, b) =>
        RSVP_ORDER[a.rsvp ?? 'none'] - RSVP_ORDER[b.rsvp ?? 'none'] || byName(a.player, b.player),
    );
}

/** Подпись к игроку в прогнозе: как он ответил на анонс. */
export function rsvpHint(status: RsvpStatus | null): string {
  if (status === 'yes') return 'идёт';
  if (status === 'maybe') return 'под вопросом';
  if (status === 'no') return 'не идёт';
  return 'без ответа';
}

/**
 * Оптимистичный ответ на анонс: моя строка заменяется и уходит в конец (rsvps приходят по
 * updated_at, поэтому порядок «кто ответил раньше» сохраняется так же, как после перезапроса).
 */
export function upsertRsvp<R extends RsvpLike & { updated_at: string }>(
  rows: readonly R[],
  mine: R,
): R[] {
  return [...rows.filter((r) => r.player_id !== mine.player_id), mine];
}

// --- Сезон -----------------------------------------------------------------------------------

export interface SeasonPosition {
  /** Место с учётом дележа: равные очки, победы и нокауты делят место. */
  place: number;
  of: number;
  row: StandingRow;
}

export function seasonPosition(
  rows: readonly StandingRow[],
  playerId: PlayerId,
): SeasonPosition | null {
  const row = rows.find((r) => r.playerId === playerId);
  if (!row) return null;
  const place = rows.findIndex((r) => sameRank(r, row)) + 1;
  return { place, of: rows.length, row };
}

// --- Незакрытые расчёты ----------------------------------------------------------------------

export interface SettleEveningLike {
  id: string;
  status: EveningStatus;
  scheduled_at: string;
  banker_id: string | null;
  format: TournamentFormat;
}

export interface MyDebt {
  eveningId: string;
  scheduledAt: string;
  bankerId: string | null;
  /** owe — я должен банкиру, await — банкир должен мне. */
  kind: 'owe' | 'await';
  amountRub: number;
}

export interface BankerDuty {
  eveningId: string;
  scheduledAt: string;
  /** Сколько игроков (кроме самого банкира) ещё не рассчитались. */
  pending: number;
}

export interface OpenSettlements {
  debts: MyDebt[];
  banker: BankerDuty[];
}

/**
 * Мои незакрытые расчёты по вечерам «игра окончена» (не settled): settlement домена по журналу.
 * Свою строку банкиру не показываем — с самим собой он не рассчитывается; вместо неё — сколько
 * игроков ему ещё нужно рассчитать.
 */
export function openSettlements(
  evenings: readonly SettleEveningLike[],
  eventsByEvening: ReadonlyMap<string, readonly EveningEvent[]>,
  meId: PlayerId,
): OpenSettlements {
  const out: OpenSettlements = { debts: [], banker: [] };
  for (const evening of evenings) {
    if (evening.status !== 'finished') continue;
    const events = eventsByEvening.get(evening.id) ?? [];
    const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
    const state = replay(evening.format, events, lastMs);
    if (!state.finished) continue;
    const table = settlement(computeMoney(evening.format, state), paymentsFromEvents(events));

    if (evening.banker_id === meId) {
      const pending = Object.entries(table).filter(
        ([id, row]) => id !== meId && row.status !== 'settled',
      ).length;
      if (pending > 0) {
        out.banker.push({ eveningId: evening.id, scheduledAt: evening.scheduled_at, pending });
      }
      continue;
    }
    const row = table[meId];
    if (!row || row.status === 'settled') continue;
    out.debts.push({
      eveningId: evening.id,
      scheduledAt: evening.scheduled_at,
      bankerId: evening.banker_id,
      kind: row.status === 'owes' ? 'owe' : 'await',
      amountRub: Math.abs(row.remainingRub),
    });
  }
  return out;
}

// --- Мой итог вечера -------------------------------------------------------------------------

export interface MyEveningResult {
  /** Место; null — по журналу не определено (не должно случаться после finish). */
  place: number | null;
  /** Сколько было участников (гости тоже). */
  of: number;
  points: number;
  netRub: number;
}

/** Мой результат по итогу вечера из summarize; null — я не играл. Ничего не пересчитывает. */
export function myResult(
  summary: Pick<EveningSummary, 'entrants' | 'places' | 'points' | 'netRub'>,
  meId: PlayerId,
): MyEveningResult | null {
  if (!summary.entrants.includes(meId)) return null;
  const index = summary.places.indexOf(meId);
  return {
    place: index >= 0 ? index + 1 : null,
    of: summary.entrants.length,
    points: summary.points[meId] ?? 0,
    netRub: summary.netRub[meId] ?? 0,
  };
}

// --- Текст -----------------------------------------------------------------------------------

export const UNKNOWN_PLAYER = 'Игрок без имени';

/** Имя игрока по id; null — id пустой. Игрок пропал из справочника — нейтральная подпись. */
export function playerName(
  playersById: ReadonlyMap<string, Pick<Player, 'display_name'>>,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return playersById.get(id)?.display_name ?? UNKNOWN_PLAYER;
}

/** «Саша (вы)» — чтобы в списках себя было видно сразу. */
export function nameWithMe(
  playersById: ReadonlyMap<string, Pick<Player, 'display_name'>>,
  id: string,
  meId: string,
): string {
  const name = playerName(playersById, id) ?? UNKNOWN_PLAYER;
  return id === meId ? `${name} (вы)` : name;
}
