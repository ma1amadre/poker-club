// Шторка «Изменить запись» (правка на месте, миграция 022): кого предложить выбившим, тексты тоста.
// Правило правки и проверку считает домен (amend.ts: canAmend, currentAmendValue) — здесь только
// раскладка для экрана. Чистый модуль, тесты — amendView.test.ts.
import { entryAmounts } from '@domain/money.ts';
import { readAmend, replay } from '@domain/replay.ts';
import type { AmendImpact, AmendValue } from '@domain/amend.ts';
import type { EveningEvent, PlayerId, TournamentFormat } from '@domain/types.ts';
import { joinNames } from '../../shared/lib/text';

function victimOf(ev: EveningEvent | undefined): PlayerId | null {
  const p = ev?.payload as { playerId?: unknown } | undefined;
  return typeof p?.playerId === 'string' ? p.playerId : null;
}

export interface KillerCandidates {
  /** Кого показать в выборе «Кто выбил»: в игре перед вылетом, затем уже отмеченные вне игры. */
  ids: PlayerId[];
  /** Отмеченные в записи, которых тогда уже не было в игре: правка с ними не пройдёт — их снимают. */
  out: PlayerId[];
}

/**
 * Кто мог выбить при правке вылета: игроки в игре прямо перед этой записью (журнал до неё, в
 * порядке посадки), кроме жертвы. Отмеченные сейчас, но тогда уже не в игре (запись «Не принято»),
 * идут следом — чтобы их можно было снять. «Журнал до неё» — записи раньше неё и поправки к ним,
 * даже записанные позже: replay применяет поправку в позиции исправляемой записи.
 */
export function amendKillerCandidates(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  eventId: number,
  current: readonly PlayerId[],
  nowMs: number,
): KillerCandidates {
  const victim = victimOf(events.find((e) => e.id === eventId));
  const before = replay(
    format,
    events.filter(
      (e) =>
        e.id < eventId ||
        (e.type === 'amend' && (readAmend(e.payload)?.eventId ?? Infinity) < eventId),
    ),
    nowMs,
  );
  const alive = before.joinOrder.filter((id) => id !== victim && before.players[id]?.alive);
  const out = current.filter((id) => id !== victim && !alive.includes(id));
  return { ids: [...alive, ...out], out };
}

/** Новое значение отличается от записи: кратность другая, выбившие — другой набор. */
export function amendChanged(now: AmendValue | null, next: AmendValue): boolean {
  if (!now) return false;
  if ('stacks' in next) return !('stacks' in now) || now.stacks !== next.stacks;
  if (!('by' in now)) return true;
  const a = [...new Set(now.by)].sort();
  const b = [...new Set(next.by)].sort();
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
}

const AMEND_NOUN: Partial<Record<EveningEvent['type'], string>> = {
  join: 'Вход',
  rebuy: 'Ребай',
  bust: 'Вылет',
};

/**
 * Тост после правки: «Вылет исправлен: Лёша» и «Выбивают Саша и Миша — нокаут каждому.», «Вход
 * исправлен: Вова» и «×3 — 1 500 ₽.». Вход, ребай и вылет — мужского рода, поэтому «исправлен»
 * согласуется с записью, а не с игроком; глаголы про выбивших — без рода.
 */
export function amendToast(
  event: EveningEvent,
  value: AmendValue,
  nameOf: (id: PlayerId) => string,
  format: TournamentFormat,
  formatRub: (n: number) => string,
): { title: string; detail: string } {
  const who = victimOf(event);
  const title = `${AMEND_NOUN[event.type] ?? 'Запись'} исправлен${AMEND_NOUN[event.type] ? '' : 'а'}${who ? `: ${nameOf(who)}` : ''}`;
  if ('by' in value) {
    const names = value.by.map(nameOf);
    const detail =
      names.length === 0
        ? 'Кто выбил — не указано.'
        : names.length === 1
          ? `Выбивает ${names[0]}.`
          : `Выбивают ${joinNames(names)} — нокаут каждому.`;
    return { title, detail };
  }
  return {
    title,
    detail: `×${value.stacks} — ${formatRub(entryAmounts(format, value.stacks).rub)}.`,
  };
}

/** Первая буква строчная: причина из домена встаёт внутрь фразы. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Почему правка задела бы другие записи (canAmend её не пропускает): какие записи журнал перестанет
 * принимать, какие вступят в силу, перестанет ли вечер быть завершённым — и что делать. label —
 * «Вылет: Аня», 20:40 (подпись записи со временем). Пусто — правка задевает только саму запись.
 */
export function amendImpactText<T extends EveningEvent>(
  impact: AmendImpact,
  events: readonly T[],
  label: (event: T) => string,
): string {
  const byId = new Map(events.map((e) => [e.id, e]));
  const parts: string[] = [];
  const unfinished =
    impact.resultChanged && impact.rejected.some((r) => byId.get(r.eventId)?.type === 'finish');
  // «Игра окончена» в списке не нужна: о ней — отдельная фраза про завершённый вечер.
  const rejected = impact.rejected.flatMap((r) => {
    const event = byId.get(r.eventId);
    return event && !(unfinished && event.type === 'finish') ? [{ event, message: r.message }] : [];
  });
  if (rejected.length > 0) {
    const many = rejected.length > 1;
    parts.push(
      `Журнал перестанет принимать ${many ? 'записи' : 'запись'}: ${rejected
        .map((r) => `${label(r.event)} (${lowerFirst(r.message)})`)
        .join('; ')}.`,
    );
  }
  const revived = impact.revived.flatMap((id) => byId.get(id) ?? []);
  if (revived.length > 0) {
    const list = revived.map(label).join('; ');
    parts.push(
      revived.length > 1
        ? `Вступят в силу записи, которые журнал сейчас не принимает: ${list}.`
        : `Вступит в силу запись, которую журнал сейчас не принимает: ${list}.`,
    );
  }
  if (unfinished) parts.push('Вечер перестанет быть завершённым.');
  else if (impact.resultChanged) parts.push('Места вечера изменятся.');
  if (parts.length === 0) return '';
  parts.push('Правка исправляет только саму запись: отмени её и, если нужно, запиши заново.');
  return parts.join(' ');
}
