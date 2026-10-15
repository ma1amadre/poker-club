// «Снять борд»: фото стола → Edge Function card-vision → открытые карты (руки и стол). Ответ функции
// читает и проверяет чистый pages/evening/boardPhoto.ts (readBoardPhotoAnswer); здесь — только вызов:
// JWT игрока, отмена по сигналу, свой предел ожидания и ошибки словами на «ты».
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';

/** Сервер ждёт модель до 20 с; сверху — загрузка фото по мобильной связи. */
export const BOARD_PHOTO_TIMEOUT_MS = 35_000;

export interface BoardPhotoRequest {
  eveningId: string;
  /** JPEG в base64 (без префикса data:). */
  image: string;
  mediaType: 'image/jpeg';
}

/**
 * Ошибка распознавания: code — код функции (not_configured, timeout, refused, …) или свой:
 * cancelled (отменил банкир), client_timeout, network, http.
 */
export class BoardPhotoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BoardPhotoError';
    this.code = code;
  }
}

async function readError(
  response: Response | undefined,
): Promise<{ error?: string; code?: string }> {
  if (!response) return {};
  try {
    const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
    return {
      error: typeof body.error === 'string' ? body.error : undefined,
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  } catch {
    return {};
  }
}

/** Отправить фото на распознавание. Ответ — как есть (его проверяет readBoardPhotoAnswer). */
export async function recognizeBoardPhoto(
  request: BoardPhotoRequest,
  signal: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BOARD_PHOTO_TIMEOUT_MS);
  const onCancel = () => controller.abort();
  signal.addEventListener('abort', onCancel);
  try {
    const { data, error } = await supabase.functions.invoke<unknown>('card-vision', {
      body: { ...request },
      signal: controller.signal,
    });
    if (signal.aborted) throw new BoardPhotoError('cancelled', 'Распознавание отменено.');
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const response = (error as { context?: unknown }).context;
        const parsed = await readError(response instanceof Response ? response : undefined);
        const status = response instanceof Response ? response.status : 0;
        throw new BoardPhotoError(
          parsed.code ?? 'http',
          parsed.error ??
            `Не удалось распознать фото (код ${status}). Сними стол ещё раз или отметь карты касанием.`,
        );
      }
      if (timedOut)
        throw new BoardPhotoError(
          'client_timeout',
          'Сервер не ответил за 35 секунд. Сними стол ещё раз или отметь карты касанием.',
        );
      throw new BoardPhotoError(
        'network',
        'Нет связи с сервером. Проверь интернет и сними стол ещё раз.',
      );
    }
    if (data === null || data === undefined)
      throw new BoardPhotoError('empty', 'Сервер распознавания вернул пустой ответ.');
    return data;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onCancel);
  }
}
