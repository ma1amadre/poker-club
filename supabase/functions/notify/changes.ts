// Посты о переносе, смене места, отмене и возврате вечера, чей анонс уже ушёл в группу
// (миграция 008).
// Вызывают notify (kind evening_changed — админ сразу после сохранения вечера) и cron-tick
// (подстраховка, если вызов с фронта не дошёл). Решение «писать ли» — _shared/announce.ts.
//
// Защита от дублей — тот же приём «застолбить → отправить → при ошибке снять», что у итогов:
// announce_snapshot переставляется на новое значение, только если в БД всё ещё лежит прочитанное.
// Два одновременных вызова (фронт и cron-tick) прочитают один снимок — застолбит один.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'; // версия — как в _shared/admin.ts
import { describeError } from '../_shared/admin.ts';
import {
  announceSnapshot,
  decideAnnounceChange,
  moveKind,
  parseSnapshot,
  type AnnounceChange,
  type AnnounceSnapshot,
  type MoveKind,
} from '../_shared/announce.ts';
import { announceChangePost } from '../_shared/messages.ts';
import { sendMessage } from '../_shared/telegram.ts';
import { loadSettings, type EveningRow, type PostOutcome, type SettingsRow } from './results.ts';

type Db = SupabaseClient;

/** О переносе и отмене пишем, пока вечер не начался (и об отменённом). */
const CHANGE_STATUSES: readonly EveningRow['status'][] = ['announced', 'cancelled'];

export interface ChangeResult {
  outcome: PostOutcome;
  /** Что сообщили группе (только при outcome = 'posted'). */
  change?: AnnounceChange;
  /**
   * Для change = 'moved' — какой пост ушёл: «Вечер перенесён» (rescheduled), «Место вечера: …»
   * (place_set), «Вечер переезжает: …» (relocated).
   */
  move?: MoveKind;
}

/**
 * Переставить снимок с known на next. Условие — снимок в БД всё ещё known (для null — is null)
 * и вечер в одном из CHANGE_STATUSES. false — кто-то успел раньше.
 */
async function swapSnapshot(
  db: Db,
  eveningId: string,
  known: unknown,
  next: AnnounceSnapshot | unknown,
): Promise<boolean> {
  let query = db
    .from('evenings')
    .update({ announce_snapshot: next })
    .eq('id', eveningId)
    .not('announce_posted_at', 'is', null)
    .in('status', [...CHANGE_STATUSES]);
  // jsonb = jsonb сравнивается по содержимому (порядок ключей не важен): передаём ровно прочитанное.
  query =
    known === null || known === undefined
      ? query.is('announce_snapshot', null)
      : query.eq('announce_snapshot', JSON.stringify(known));
  const { data, error } = await query.select('id');
  if (error) throw new Error(`announce_snapshot: ${describeError(error)}`);
  return (data ?? []).length > 0;
}

/**
 * Сообщить группе о правке вечера, если она её касается. Идемпотентно: повтор после поста видит
 * новый снимок и отвечает no_changes. settings — если уже загружены (cron-tick).
 */
export async function postAnnounceChange(
  db: Db,
  evening: EveningRow,
  nowMs: number,
  settings?: SettingsRow,
): Promise<ChangeResult> {
  if (!evening.announce_posted_at) return { outcome: 'not_announced' };
  if (!CHANGE_STATUSES.includes(evening.status)) return { outcome: 'no_changes' };

  const rawKnown = evening.announce_snapshot ?? null;
  const known = parseSnapshot(rawKnown);
  const current = announceSnapshot(evening);
  const decision = decideAnnounceChange(known, current, nowMs);
  if (decision.action === 'none') return { outcome: 'no_changes' };

  if (decision.action === 'silent') {
    // Запоминаем молча: снимка не было, вечер уже прошёл или правят отменённый.
    const swapped = await swapSnapshot(db, evening.id, rawKnown, current);
    return { outcome: swapped ? 'no_changes' : 'already_posted' };
  }

  const s = settings ?? (await loadSettings(db));
  if (s.group_chat_id === null || s.group_chat_id === '') return { outcome: 'no_group' };
  // known не null: без снимка решение было бы silent.
  const before = known as AnnounceSnapshot;
  const post = announceChangePost(decision.change, {
    eveningId: evening.id,
    before,
    after: current,
    reason: evening.cancel_reason,
    botUsername: s.bot_username,
  });

  if (!(await swapSnapshot(db, evening.id, rawKnown, current))) {
    return { outcome: 'already_posted' };
  }
  try {
    await sendMessage(s.group_chat_id, post.text, { buttons: post.buttons });
    return decision.change === 'moved'
      ? { outcome: 'posted', change: 'moved', move: moveKind(before, current) }
      : { outcome: 'posted', change: decision.change };
  } catch (error) {
    // Снимаем свою отметку, только если её никто не сменил после нас: cron-tick повторит пост.
    const { error: undoError } = await db
      .from('evenings')
      .update({ announce_snapshot: rawKnown })
      .eq('id', evening.id)
      .eq('announce_snapshot', JSON.stringify(current));
    if (undoError)
      console.error(`release announce_snapshot ${evening.id}: ${describeError(undoError)}`);
    throw error;
  }
}
