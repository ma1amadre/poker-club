// notify — пост итогов вечера в группу клуба по команде банкира или админа.
// POST {kind: 'evening_finished' | 'evening_corrected', eveningId} с JWT игрока. evening_corrected —
// только админ: исправленный итог закрытого вечера после правки журнала. Текст сервер собирает сам из БД
// доменными функциями: клиенту не доверяем ни цифры, ни имена. Идемпотентно по results_posted_at.
import {
  adminClient,
  bearerToken,
  describeError,
  errorResponse,
  json,
  preflight,
  readJsonBody,
  UUID_RE,
} from '../_shared/admin.ts';
import { TelegramApiError } from '../_shared/telegram.ts';
import {
  EVENING_COLUMNS,
  NotReadyError,
  postCorrectedResults,
  postEveningResults,
  type EveningRow,
} from './results.ts';

interface CallerRow {
  id: string;
  is_admin: boolean;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Только POST');

  try {
    const db = adminClient();

    // Кто вызывает: JWT проверяем через Auth (getUser), а не только на шлюзе — шлюз пропустил бы
    // и anon-ключ, который тоже JWT.
    const token = bearerToken(req);
    if (!token) return errorResponse(401, 'no_token', 'Нужен вход в приложение');
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) {
      return errorResponse(401, 'bad_token', 'Сессия недействительна, откройте приложение заново');
    }
    const { data: caller, error: callerError } = await db
      .from('players')
      .select('id, is_admin')
      .eq('auth_user_id', userData.user.id)
      .eq('is_active', true)
      .maybeSingle<CallerRow>();
    if (callerError) throw new Error(describeError(callerError));
    if (!caller) return errorResponse(403, 'not_player', 'Вы не участник клуба');

    const body = await readJsonBody(req);
    const kind = body?.kind;
    if (kind !== 'evening_finished' && kind !== 'evening_corrected') {
      return errorResponse(400, 'bad_kind', 'Неизвестный тип уведомления');
    }
    const eveningId = body?.eveningId;
    if (typeof eveningId !== 'string' || !UUID_RE.test(eveningId)) {
      return errorResponse(400, 'bad_evening', 'Некорректный id вечера');
    }

    const { data: evening, error: eveningError } = await db
      .from('evenings')
      .select(EVENING_COLUMNS)
      .eq('id', eveningId)
      .maybeSingle<EveningRow>();
    if (eveningError) throw new Error(describeError(eveningError));
    if (!evening) return errorResponse(404, 'not_found', 'Вечер не найден');

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
      return errorResponse(502, 'telegram', 'Telegram не принял пост, бот повторит попытку позже');
    }
    console.error(`notify: ${describeError(error)}`);
    return errorResponse(500, 'internal', 'Не удалось опубликовать итоги, попробуйте позже');
  }
});
