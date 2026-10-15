// Места и баттон на экранах вечера (миграция 028): строка позиций, шторка «Рассадка», «Следующая
// раздача» и тосты. Чистый модуль (тесты — seating.test.ts): кто где сидит, кто на позициях и куда
// уходит баттон, решает домен (seats.ts, replay); здесь — раскладка и тексты.
//
// Тексты без рода (на «ты», имена бывают и мужские, и женские): «Ты на BB», «Петя вне игры».
import { canApply, canApplySequence, replayLog, type EventDraft } from '@domain/replay.ts';
import {
  readSeat,
  tablePositions,
  tableSeats,
  type SeatedPlayer,
  type TablePositions,
} from '@domain/seats.ts';
import type {
  BlindLevel,
  EveningEvent,
  EveningState,
  PlayerId,
  TournamentFormat,
} from '@domain/types.ts';
import { formatBlinds, formatNumber, NBSP, pluralWithNumber } from '../../shared/lib/format';
import { joinNames } from '../../shared/lib/text';
import { positionRoles, type NameOf, type PositionRole } from './lib';

const SEP = `${NBSP}· `;

/** Рассадка начата: хоть кто-то (в игре или вылетевший) держит место. */
export function seatingStarted(state: EveningState): boolean {
  return state.joinOrder.some((id) => (state.players[id]?.seat ?? null) !== null);
}

/**
 * Игроки в игре без места (в порядке входа) — только когда рассадка начата: до неё без места все,
 * и ряд «Без места» повторял бы стол целиком.
 */
export function unseatedPlayers(state: EveningState): PlayerId[] {
  return seatingStarted(state) ? tablePositions(state).unseatedAlive : [];
}

/**
 * Подсказка у «Следующей раздачи», когда кто-то в игре без места: позиции считаются только по
 * сидящим на местах. null — подсказывать нечего.
 */
export function unseatedHint(state: EveningState, nameOf: NameOf): string | null {
  const ids = unseatedPlayers(state);
  if (ids.length === 0) return null;
  const many = ids.length > 1;
  return `Без места: ${joinNames(ids.map(nameOf))} — в${NBSP}позициях раздачи ${many ? 'не участвуют' : 'не участвует'}, пока не ${many ? 'сядут' : 'сядет'} на место. Место выбирается в${NBSP}«Рассадке».`;
}

// --- Строка позиций ----------------------------------------------------------------------------

/**
 * Позиции раздачи строкой. Без уровня — экран игроков: «Баттон — Петя · SB — Лёня · BB — Саша»; с
 * уровнем — тост после раздачи: «Баттон — Петя · SB Лёня 25 · BB Саша 50». В хедз-апе баттон и SB —
 * один игрок: «Баттон и SB — Петя …». Баттон на пустом месте или у выбывшего (до следующей раздачи) —
 * «Баттон — место 3». null — позиций нет: баттон не задан или в игре на местах меньше двух.
 */
export function positionsText(
  positions: TablePositions,
  nameOf: NameOf,
  level?: Pick<BlindLevel, 'sb' | 'bb'>,
): string | null {
  const { buttonSeat, dealer, sb, bb } = positions;
  if (buttonSeat === null || !sb || !bb) return null;
  // С уровнем — имя и блайнд без тире («SB Лёня 25»), без уровня — «SB — Лёня».
  const withBlind = (p: SeatedPlayer, amount: number) =>
    level ? `${nameOf(p.playerId)}${NBSP}${formatNumber(amount)}` : nameOf(p.playerId);
  const role = (label: string, p: SeatedPlayer, amount: number) =>
    level ? `${label}${NBSP}${withBlind(p, amount)}` : `${label}${NBSP}— ${withBlind(p, amount)}`;
  const bbPart = role('BB', bb, level?.bb ?? 0);
  if (dealer && dealer.playerId === sb.playerId) {
    return `Баттон и SB — ${withBlind(sb, level?.sb ?? 0)}${SEP}${bbPart}`;
  }
  const button = dealer ? `Баттон — ${nameOf(dealer.playerId)}` : `Баттон — место ${buttonSeat}`;
  return [button, role('SB', sb, level?.sb ?? 0), bbPart].join(SEP);
}

/**
 * Своя позиция на экране игрока: «Ты на баттоне», «Ты на SB», «Ты на BB», в хедз-апе — «Ты на
 * баттоне и SB». null — смотрящий не на позиции (или позиций нет).
 */
export function myPositionText(positions: TablePositions, meId: PlayerId | null): string | null {
  if (!meId) return null;
  const mine = (p: SeatedPlayer | null) => p?.playerId === meId;
  const dealer = mine(positions.dealer);
  if (dealer && mine(positions.sb)) return 'Ты на баттоне и SB';
  if (dealer) return 'Ты на баттоне';
  if (mine(positions.sb)) return 'Ты на SB';
  if (mine(positions.bb)) return 'Ты на BB';
  return null;
}

// --- «Следующая раздача» -----------------------------------------------------------------------

export interface HandButtonView {
  /** Кнопку видно: задан баттон или уровень по раздачам. */
  show: boolean;
  /** Подпись: «Следующая раздача», у уровня по раздачам — «Следующая раздача · 3 из 10». */
  label: string;
  /**
   * Почему кнопка сейчас закрыта (подсказка под ней) или null. Пока на пульте вопрос после ривера
   * («Фишек хватило?»), раздачу не записать: запись раздачи молча снимает вопрос (игра ушла дальше,
   * riverSuggestionLive), а вылет, записанный после неё, баттон уже не пропустит — он встанет на
   * место вылетевшего.
   */
  hold: string | null;
}

/** Подсказка у закрытой «Следующей раздачи», пока на пульте вопрос после ривера. */
export const HAND_RIVER_HOLD =
  'Сначала ответь, хватило ли фишек: вылет записывается до следующей раздачи — тогда баттон пропустит вылетевшего.';

/**
 * «Следующая раздача» на пульте — запись 'hand' (одно касание): двигает баттон и считает раздачи
 * уровня. Видна, если задан баттон или уровень по раздачам; счётчик — раздач на этом уровне.
 * riverPending — на пульте вопрос после ривера: кнопка закрыта до ответа (hold).
 */
export function handButton(state: EveningState, riverPending = false): HandButtonView {
  const trig = state.currentLevel.trigger;
  const hands = trig.type === 'hands';
  const show = state.buttonSeat !== null || hands;
  return {
    show,
    label: hands
      ? `Следующая раздача${SEP}${state.timer.handsInLevel} из ${trig.count}`
      : 'Следующая раздача',
    hold: show && riverPending ? HAND_RIVER_HOLD : null,
  };
}

/**
 * Состояние после записей drafts на момент nowMs — как их применит replay (canApplySequence домена
 * проверяет так же): тост после раздачи называет позиции и блайнды следующей раздачи заранее.
 */
export function stateAfter(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  drafts: readonly EventDraft[],
  nowMs: number,
): EveningState {
  const lastId = events.reduce((m, e) => Math.max(m, e.id), 0);
  const at = new Date(nowMs).toISOString();
  const tail: EveningEvent[] = drafts.map((d, i) => ({
    id: lastId + 1 + i,
    type: d.type,
    payload: d.payload,
    at,
    voided: false,
  }));
  return replayLog(format, [...events, ...tail], nowMs).state;
}

export interface ToastText {
  title: string;
  detail: string | null;
}

/**
 * Тост «Следующей раздачи»: позиции новой раздачи с блайндами — «Баттон — Петя · SB Лёня 25 · BB
 * Саша 50» (after — состояние после записи). Баттона нет — «Раздача записана». Раздача сменила
 * уровень — новые блайнды второй строкой.
 */
export function handToast(before: EveningState, after: EveningState, nameOf: NameOf): ToastText {
  const title =
    positionsText(tablePositions(after), nameOf, after.currentLevel) ?? 'Раздача записана';
  const level =
    after.timer.levelIndex !== before.timer.levelIndex
      ? `Уровень ${after.timer.levelIndex + 1}: блайнды ${formatBlinds(after.currentLevel)}`
      : null;
  return { title, detail: level };
}

// --- Шторка «Рассадка» -------------------------------------------------------------------------

/** Ячейка шторки: номер места, кто на нём (null — пусто), в игре ли он, позиции раздачи. */
export interface SeatCell {
  seat: number;
  playerId: PlayerId | null;
  alive: boolean;
  roles: PositionRole[];
}

/** Все места стола по номерам — с позициями раздачи (D, SB, BB). */
export function seatCells(state: EveningState): SeatCell[] {
  const roles = positionRoles(tablePositions(state));
  return tableSeats(state).map((c) => ({ ...c, roles: roles.get(c.seat) ?? [] }));
}

/** Кого можно посадить на место: игрок и место, на котором он сейчас (null — без места). */
export interface SeatChoice {
  playerId: PlayerId;
  from: number | null;
}

/**
 * Кого посадить на место seat: сначала игроки в игре без места (в порядке входа), затем пересадка —
 * игроки в игре на других местах (по номеру места). Место держит игрок в игре — список пуст (место
 * занято). Вылетевших нет: вылетевший сидит, пока место не отдадут, а вернётся ребаем на своё.
 */
export function seatChoices(state: EveningState, seat: number): SeatChoice[] {
  const cells = tableSeats(state);
  if (cells.find((c) => c.seat === seat)?.alive) return [];
  const unseated = tablePositions(state).unseatedAlive.map((playerId) => ({
    playerId,
    from: null,
  }));
  const moving = cells.flatMap((c) =>
    c.playerId !== null && c.alive && c.seat !== seat
      ? [{ playerId: c.playerId, from: c.seat }]
      : [],
  );
  return [...unseated, ...moving];
}

/**
 * Куда можно посадить игрока: пустые места и места вылетевших (вылетевший место теряет) — то, что
 * примет replay (canApply 'seat'). Своё место и места игроков в игре — нет.
 */
export function seatTargets(
  format: TournamentFormat,
  state: EveningState,
  playerId: PlayerId,
): number[] {
  return tableSeats(state)
    .filter((c) => canApply(format, state, 'seat', { playerId, seat: c.seat }, 0) === null)
    .map((c) => c.seat);
}

/**
 * Тост после записи места: «Саша — место 3»; пересадка — «Было место 5.»; место вылетевшего —
 * «Петя вне игры — место 3 отдано.» (вылетевший место теряет).
 */
export function seatToast(
  state: EveningState,
  playerId: PlayerId,
  seat: number,
  nameOf: NameOf,
): ToastText {
  const from = state.players[playerId]?.seat ?? null;
  const holder = tableSeats(state).find((c) => c.seat === seat);
  const taken =
    holder?.playerId && holder.playerId !== playerId && !holder.alive
      ? `${nameOf(holder.playerId)} вне игры — место ${seat} отдано.`
      : null;
  const moved = from !== null && from !== seat ? `Было место ${from}.` : null;
  return {
    title: `${nameOf(playerId)} — место ${seat}`,
    detail: [moved, taken].filter(Boolean).join(' ') || null,
  };
}

/**
 * Тост после выбора баттона: «Баттон — место 3 (Саша)», второй строкой — блайнды раздачи с этим
 * баттоном: «SB Лёня 25 · BB Саша 50» (в хедз-апе SB — игрок на баттоне).
 */
export function buttonToast(state: EveningState, seat: number, nameOf: NameOf): ToastText {
  const holder = tableSeats(state).find((c) => c.seat === seat)?.playerId ?? null;
  const positions = tablePositions({ ...state, buttonSeat: seat });
  const { sb, bb } = positions;
  const level = state.currentLevel;
  return {
    title: `Баттон — место ${seat}${holder ? ` (${nameOf(holder)})` : ''}`,
    detail:
      sb && bb
        ? `SB${NBSP}${nameOf(sb.playerId)}${NBSP}${formatNumber(level.sb)}${SEP}BB${NBSP}${nameOf(bb.playerId)}${NBSP}${formatNumber(level.bb)}`
        : null,
  };
}

// --- Повтор случайного выбора ------------------------------------------------------------------

/**
 * «Рассадить случайно» после попытки без ответа (тайм-аут, ошибка сети): тот же жребий, пока он
 * годится. Ключ повтора строится из записей (retryIntent), и только тот же пакет найдёт дошедший без
 * ответа — сервер вернёт его, а не запишет второй с другими местами (половина пересадила бы уже
 * рассаженных, половина — «Место занято»). Годится — каждый его игрок всё ещё в игре без места и журнал
 * примет пакет целиком; иначе null — нужен новый жребий.
 */
export function repeatSeating(
  pending: readonly EventDraft[] | null,
  format: TournamentFormat,
  events: readonly EveningEvent[],
  nowMs: number,
): EventDraft[] | null {
  if (!pending || pending.length === 0) return null;
  const unseated = new Set(tablePositions(replayLog(format, events, nowMs).state).unseatedAlive);
  const same = pending.every((d) => {
    const read = d.type === 'seat' ? readSeat(d.payload) : null;
    return read !== null && unseated.has(read.playerId);
  });
  if (!same || canApplySequence(format, events, pending, nowMs) !== null) return null;
  return [...pending];
}

/**
 * «Разыграть баттон» после попытки без ответа: то же место (тот же ключ повтора), пока там игрок в
 * игре; иначе null — разыграть заново.
 */
export function repeatButtonDraw(
  pending: number | null,
  format: TournamentFormat,
  state: EveningState,
): number | null {
  if (pending === null) return null;
  return canApply(format, state, 'button', { seat: pending }, 0) === null ? pending : null;
}

/**
 * Тост «Рассадить случайно»: «Места разыграны», второй строкой — кто куда по номерам мест: «Саша —
 * 1, Петя — 3, Лёня — 7». Мест не хватило всем — кто остался без места.
 */
export function randomSeatingToast(
  state: EveningState,
  drafts: readonly EventDraft[],
  nameOf: NameOf,
): ToastText {
  const placed = drafts
    .flatMap((d) => {
      const p = d.payload as { playerId?: unknown; seat?: unknown };
      return typeof p.playerId === 'string' && typeof p.seat === 'number'
        ? [{ playerId: p.playerId, seat: p.seat }]
        : [];
    })
    .sort((a, b) => a.seat - b.seat);
  const seatedIds = new Set(placed.map((p) => p.playerId));
  const left = tablePositions(state).unseatedAlive.filter((id) => !seatedIds.has(id));
  const list = placed.map((p) => `${nameOf(p.playerId)}${NBSP}—${NBSP}${p.seat}`).join(', ');
  return {
    title: `Места разыграны: ${pluralWithNumber(placed.length, ['игрок', 'игрока', 'игроков'])}`,
    detail: [list, left.length > 0 ? `Мест не хватило: ${joinNames(left.map(nameOf))}.` : null]
      .filter(Boolean)
      .join('. '),
  };
}
