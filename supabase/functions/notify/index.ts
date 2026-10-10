// notify — пост итогов вечера в группу клуба по команде банкира или админа.
// POST {kind: 'evening_finished' | 'evening_corrected', eveningId} с JWT игрока. evening_corrected —
// только админ: исправленный итог закрытого вечера после правки журнала. Текст сервер собирает сам из БД
// доменными функциями: клиенту не доверяем ни цифры, ни имена. Идемпотентно по results_posted_at.
// evening_changed — только админ, после сохранения вечера: если анонс уже в группе и изменились
// время, место или отмена — пост «Вечер перенесён» / «отменён» / «всё-таки состоится» (changes.ts).
// Telegram не принял пост (бот выкинут из группы, 403, сеть…) — сообщение админу в личку
// (_shared/alerts.ts, не чаще раза в 6 ч на один и тот же сбой); ответ клиенту прежний.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'; // версия — как в _shared/admin.ts
import {
  adminClient,
  describeError,
  errorResponse,
  json,
  preflight,
  readJsonBody,
  resolveCaller,
  UUID_RE,
} from '../_shared/admin.ts';
import { alertAdmin } from '../_shared/alerts.ts';
import { formatEveningDate } from '../_shared/messages.ts';
import { TelegramApiError, TelegramNetworkError } from '../_shared/telegram.ts';
import { postAnnounceChange } from './changes.ts';
import {
  EVENING_COLUMNS,
  NotReadyError,
  postCorrectedResults,
  postEveningResults,
  type EveningRow,
} from './results.ts';

type Kind = 'evening_finished' | 'evening_corrected' | 'evening_changed';

/** Что не ушло — для сообщения админу. Исправленные итоги cron-tick не повторяет — об этом прямо. */
function failedPostDetail(kind: Kind | null, evening: EveningRow | null): string {
  const when = evening
    ? `вечер ${formatEveningDate(evening.scheduled_at, evening.game_no)}`
    : 'вечер';
  switch (kind) {
    case 'evening_finished':
      return `итоги, ${when}. cron-tick повторит отправку сам через 15 минут`;
    case 'evening_corrected':
      return `исправленные итоги, ${when}. cron-tick их не повторяет — после починки отправь их из приложения ещё раз`;
    case 'evening_changed':
      return `пост о переносе или отмене, ${when}. cron-tick повторит отправку сам через 15 минут`;
    default:
      return when;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Только POST');

  let db: SupabaseClient | null = null;
  let kind: Kind | null = null;
  let evening: EveningRow | null = null;
  try {
    db = adminClient();

    const who = await resolveCaller(db, req);
    if ('response' in who) return who.response;
    const { caller } = who;

    const body = await readJsonBody(req);
    const rawKind = body?.kind;
    if (
      rawKind !== 'evening_finished' &&
      rawKind !== 'evening_corrected' &&
      rawKind !== 'evening_changed'
    ) {
      return errorResponse(400, 'bad_kind', 'Неизвестный тип уведомления');
    }
    kind = rawKind;
    const eveningId = body?.eveningId;
    if (typeof eveningId !== 'string' || !UUID_RE.test(eveningId)) {
      return errorResponse(400, 'bad_evening', 'Некорректный id вечера');
    }

    const { data: found, error: eveningError } = await db
      .from('evenings')
      .select(EVENING_COLUMNS)
      .eq('id', eveningId)
      .maybeSingle<EveningRow>();
    if (eveningError) throw new Error(describeError(eveningError));
    if (!found) return errorResponse(404, 'not_found', 'Вечер не найден');
    evening = found;

    if (kind === 'evening_changed') {
      // Вечер правит только админ (RLS evenings), он же сообщает группе о правке.
      if (!caller.is_admin) {
        return errorResponse(403, 'forbidden', 'О переносе и отмене вечера пишет админ');
      }
      const result = await postAnnounceChange(db, evening, Date.now());
      return json({ ok: true, ...result });
    }

    if (!caller.is_admin && evening.banker_id !== caller.id) {
      return errorResponse(403, 'forbidden', 'Итоги публикует банкир вечера или админ');
    }
    if (kind === 'evening_corrected' && !caller.is_admin) {
      return errorResponse(403, 'forbidden', 'Исправленный итог публикует админ');
    }
    if (evening.status !== 'finished' && evening.status !== 'settled') {
      return errorResponse(409, 'not_finished', 'Вечер ещё не завершён');
    }

    const outcome =
      kind === 'evening_corrected'
        ? await postCorrectedResults(db, evening, Date.now())
        : await postEveningResults(db, evening, Date.now());
    return json({ ok: true, outcome });
  } catch (error) {
    if (error instanceof NotReadyError) return errorResponse(409, 'not_finished', error.message);
    if (error instanceof TelegramApiError) {
      // Отметка о посте снята — cron-tick повторит отправку сам.
      console.error(`notify: ${error.message}`);
      await alertAdmin(db, 'notify_post', failedPostDetail(kind, evening), error);
      return errorResponse(502, 'telegram', 'Telegram не принял пост, бот повторит попытку позже');
    }
    console.error(`notify: ${describeError(error)}`);
    if (error instanceof TelegramNetworkError) {
      await alertAdmin(db, 'notify_post', failedPostDetail(kind, evening), error);
    }
    return errorResponse(500, 'internal', 'Не удалось отправить пост в группу, попробуй позже');
  }
});
