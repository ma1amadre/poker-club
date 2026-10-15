// card-vision — «Снять борд» в шторке олл-ина: банкир фотографирует стол, функция спрашивает Claude,
// какие карты открыты, и возвращает руки и стол. POST {eveningId, image: base64, mediaType} с JWT
// игрока → {hands: [[карта, карта]], board: [карта], issues, ms} или {error, code}. Карты — только в
// черновик шторки: на табло их отправляет банкир обычной кнопкой после проверки.
//
// Права и проверки — `cardVision` в _shared/cardVision.ts (банкир вечера или админ, вечер идёт, фото
// JPEG/PNG/WebP до 4 МБ, не чаще 10 снимков в минуту), вызов модели — claude.ts. Ключ — секрет функции
// ANTHROPIC_API_KEY; нет ключа — понятная ошибка 503 not_configured. Локально без ключа —
// CARD_VISION_MOCK (cardVisionFixtures.ts: ответы теста на 17 фото и режимы ошибок).
//
// Фото не сохраняется нигде: ни в Storage, ни в базе, ни в логах — оно уходит в Anthropic и забывается
// вместе с запросом. В лог — только итог, время и класс ошибки.
import {
  adminClient,
  describeError,
  errorResponse,
  json,
  preflight,
  readEnv,
  readJsonBody,
  resolveCaller,
} from '../_shared/admin.ts';
import {
  cardVision,
  createRateLimiter,
  MAX_BODY_BYTES,
  type CardVisionDeps,
  type VisionEvening,
} from '../_shared/cardVision.ts';
import {
  DEFAULT_MOCK_DELAY_MS,
  isKnownMockMode,
  mockRecognize,
} from '../_shared/cardVisionFixtures.ts';
import { recognizeWithClaude } from './claude.ts';

// Окно частоты живёт, пока жив экземпляр функции.
const limiter = createRateLimiter();

/** Чем распознаём: подмена (локально), Claude по ключу или ничем (не настроено). */
function recognizer(): CardVisionDeps['recognize'] {
  const mock = readEnv('CARD_VISION_MOCK');
  if (mock) {
    if (!isKnownMockMode(mock))
      console.warn(
        `card-vision: неизвестный CARD_VISION_MOCK «${mock}» — отвечаю фото по умолчанию`,
      );
    const delay = Number(readEnv('CARD_VISION_MOCK_DELAY_MS') ?? DEFAULT_MOCK_DELAY_MS);
    const delayMs = Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_MOCK_DELAY_MS;
    return (_photo, signal) => mockRecognize(mock, delayMs, signal);
  }
  const apiKey = readEnv('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  return (photo, signal) => recognizeWithClaude(apiKey, photo, signal);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Только POST');

  // Слишком большое тело не читаем: клиент сжимает фото до ~1600 px, это сотни килобайт.
  const length = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      'too_large',
      'Фото больше 4 МБ даже после сжатия. Сними стол ещё раз.',
    );
  }

  try {
    const db = adminClient();
    const who = await resolveCaller(db, req);
    if ('response' in who) return who.response;

    const body = await readJsonBody(req);
    const reply = await cardVision(who.caller, body, {
      async loadEvening(id) {
        const { data, error } = await db
          .from('evenings')
          .select('id, status, banker_id')
          .eq('id', id)
          .maybeSingle<VisionEvening>();
        if (error) throw new Error(describeError(error));
        return data;
      },
      recognize: recognizer(),
      limiter,
      now: () => performance.now(),
      signal: req.signal,
      log: (line) => console.log(line),
    });
    return json(reply.body, reply.status);
  } catch (error) {
    console.error(`card-vision: ${describeError(error)}`);
    return errorResponse(500, 'internal', 'Не удалось распознать фото, попробуй ещё раз');
  }
});
