// Вызов Claude для «Снять борд»: фото стола (base64) и промпт → JSON по схеме (structured outputs).
// Только официальный SDK, версия закреплена точно (как supabase-js в _shared/admin.ts): каждый деплой
// собирает функцию заново, плавающая версия подтянула бы любую свежую из npm в код с ключом API.
// 0.134.0 — на ней прошёл тест на 17 фото (15.10.2026); обновлять осознанно.
//
// Модель — Sonnet 5.5, рассуждение adaptive с effort low (короткий ответ, тест: медиана 2,5 с).
// Отказ модели (stop_reason 'refusal') проверяется до чтения content; серверный резерв
// (fallbacks 'default', бета server-side-fallback-2026-07-01) сам перезапускает отказанный запрос на
// модели, которую Anthropic рекомендует для этой категории отказа. Ошибки SDK — по типам: таймаут и
// сеть — «повтори», 429 — «перегружено», 5xx — «сбой сервиса», 401/403 — ключ, прочие 4xx — баг.
// Фото, ключ и тело запроса в лог не пишутся.
import Anthropic from 'npm:@anthropic-ai/sdk@0.134.0';
import {
  CARD_VISION_MAX_TOKENS,
  CARD_VISION_MODEL,
  CARD_VISION_PROMPT,
  CARD_VISION_SCHEMA,
  CARD_VISION_TIMEOUT_MS,
  failureForStatus,
  type RecognizeOutcome,
  type VisionFailureCode,
  type VisionPhoto,
} from '../_shared/cardVision.ts';

let client: Anthropic | null = null;
let clientKey = '';

function claude(apiKey: string): Anthropic {
  if (!client || clientKey !== apiKey) {
    // Один повтор SDK (429, 5xx, обрыв связи) укладывается в общий предел функции (20 с): дольше
    // ждать банкир не будет.
    client = new Anthropic({ apiKey, maxRetries: 1 });
    clientKey = apiKey;
  }
  return client;
}

/** Ошибка SDK → код ошибки функции. Порядок — от частного к общему (APIConnectionError ⊂ APIError). */
function classify(error: unknown): VisionFailureCode {
  if (error instanceof Anthropic.APIUserAbortError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'network';
  if (error instanceof Anthropic.APIError) return failureForStatus(error.status);
  return 'bug';
}

/** Первая строка ошибки для лога, без тела запроса (в нём фото). */
function detailOf(error: unknown): string {
  const status = error instanceof Anthropic.APIError && error.status ? ` ${error.status}` : '';
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
  return `${name}${status}: ${message.slice(0, 300)}`;
}

export async function recognizeWithClaude(
  apiKey: string,
  photo: VisionPhoto,
  signal: AbortSignal,
): Promise<RecognizeOutcome> {
  try {
    const response = await claude(apiKey).beta.messages.create(
      {
        model: CARD_VISION_MODEL,
        max_tokens: CARD_VISION_MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: CARD_VISION_SCHEMA },
        },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
              },
              { type: 'text', text: CARD_VISION_PROMPT },
            ],
          },
        ],
      },
      { signal, timeout: CARD_VISION_TIMEOUT_MS },
    );
    if (response.stop_reason === 'refusal') {
      return { kind: 'refusal', category: response.stop_details?.category ?? null };
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    return { kind: 'answer', text };
  } catch (error) {
    return { kind: 'failure', failure: classify(error), detail: detailOf(error) };
  }
}
