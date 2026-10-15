// Подмена ответа модели для локальной проверки «Снять борд» без ключа Anthropic: переменная
// окружения функции CARD_VISION_MOCK (supabase/functions/.env, в облаке не задаётся).
// Ответы — настоящие ответы Sonnet 5.5 на 17 фото стола клуба (тест 15.10.2026, все верны), как их
// вернула модель (JSON по схеме). Кроме фото — режимы ошибок, чтобы проверить их на экране.
import type { RecognizeOutcome, VisionFailureCode } from './cardVision.ts';

/** Ответы Sonnet 5.5 по номеру фото теста (photo_N_2026-10-15). */
export const CARD_VISION_FIXTURES: Readonly<Record<string, string>> = {
  photo_1: '{"hands":[["10c","8h"],["Jc","10d"],["7c","Ah"]],"board":["Qh","6c","Jd","Ac","Kd"]}',
  photo_2: '{"hands":[["Kd","3c"],["Kh","Qd"]],"board":["6c","7c","10d"]}',
  photo_3: '{"hands":[["3c","Jd"],["Jc","Ac"]],"board":["Qh","Ah","5h","Qc"]}',
  photo_4: '{"hands":[["10d","Qd"],["7c","Kh"]],"board":[]}',
  photo_5: '{"hands":[["5s","8h"],["9c","Jd"]],"board":["Qh","Ks","3c","6h","5d"]}',
  photo_6: '{"hands":[["7h","As"],["2h","7d"]],"board":["4d","Kd","10h","Kc","Jh"]}',
  photo_7: '{"hands":[["5s","Jh"],["4s","2c"]],"board":["4d","Kc","7d","3h"]}',
  photo_8: '{"hands":[["5d","Ac"],["10s","Qh"],["Ad","Qd"]],"board":["6h","3c","5s","9c","Jd"]}',
  photo_9: '{"hands":[["Ad","Jd"],["Qd","3c"],["5s","6h"]],"board":["Qs","2d","9c","10s","5d"]}',
  photo_10: '{"hands":[["5d","9c"],["10s","Qs"],["2d","10d"]],"board":["5s","Qd","3c","Ac","Qc"]}',
  photo_11: '{"hands":[["2h","8d"],["Kd","Js"],["9s","2s"]],"board":["Kh","9h","3s","6d","9d"]}',
  photo_12: '{"hands":[["10d","8c"],["3s","8s"],["4s","9d"]],"board":["6c","2d","Ks","8h","As"]}',
  photo_13: '{"hands":[["10h","As"],["Jd","Ks"],["4c","6s"]],"board":["4s","9d","5c","Ah","7s"]}',
  photo_14: '{"hands":[["8d","2s"],["10s","7d"],["Js","2h"]],"board":["Kd","9s","4h","Kh","3s"]}',
  photo_15: '{"hands":[["Kd","Kh"],["4h","3s"],["Jc","Kc"]],"board":["As","Js","9s","4d","10s"]}',
  photo_16: '{"hands":[["6h","6s"],["5h","6c"],["8c","2s"]],"board":["Kc","7h","Qh","Qc","7s"]}',
  photo_17: '{"hands":[["Qh","Kc"],["4c","4h"],["Jc","6d"]],"board":["10d","Jd","Ah","3d","3s"]}',
  /** Пусто: открытых карт на фото нет. */
  empty: '{"hands":[],"board":[]}',
  /**
   * Ответ с огрехами (как ошибки Haiku в тесте): рука, разбитая на одиночные карты, повтор и не
   * карта — проверка замечаний на экране.
   */
  messy: '{"hands":[["5s"],["8h"],["7h","As"],["As","2d"]],"board":["4d","Kd","10h","1x"]}',
};

/** Фото по умолчанию (CARD_VISION_MOCK=1): хедз-ап, весь стол. */
export const DEFAULT_FIXTURE = 'photo_6';

const FAILURE_MODES: readonly VisionFailureCode[] = [
  'busy',
  'upstream',
  'network',
  'bad_key',
  'billing',
  'bug',
];

/** Пауза «распознавания» в подмене, мс (CARD_VISION_MOCK_DELAY_MS): видно «Распознаю…» и отмену. */
export const DEFAULT_MOCK_DELAY_MS = 1500;

/** Ждать ms или до отмены (true — отменили). */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Известен ли режим подмены (иначе функция пишет в лог и отвечает как фото по умолчанию). */
export function isKnownMockMode(mode: string): boolean {
  return (
    mode === '1' ||
    mode in CARD_VISION_FIXTURES ||
    mode === 'refusal' ||
    mode === 'timeout' ||
    mode === 'bad_answer' ||
    FAILURE_MODES.includes(mode as VisionFailureCode)
  );
}

/**
 * Подменный «вызов модели»: CARD_VISION_MOCK = 1 (фото по умолчанию) | photo_1…photo_17 | empty |
 * messy — ответ; refusal — отказ модели; timeout — не отвечает (сработает предел функции);
 * bad_answer — не JSON; busy | upstream | network | bad_key | billing | bug — эта ошибка.
 */
export async function mockRecognize(
  mode: string,
  delayMs: number,
  signal: AbortSignal,
): Promise<RecognizeOutcome> {
  if (mode === 'timeout') {
    await wait(10 * 60_000, signal);
    return { kind: 'failure', failure: 'timeout', detail: 'подмена: не ответило' };
  }
  if (await wait(delayMs, signal))
    return { kind: 'failure', failure: 'timeout', detail: 'отменено' };
  if (mode === 'refusal') return { kind: 'refusal', category: null };
  if (mode === 'bad_answer') return { kind: 'answer', text: 'Карты: туз пик, король червей.' };
  if (FAILURE_MODES.includes(mode as VisionFailureCode))
    return { kind: 'failure', failure: mode as VisionFailureCode, detail: 'подмена' };
  const text = CARD_VISION_FIXTURES[mode] ?? CARD_VISION_FIXTURES[DEFAULT_FIXTURE] ?? '';
  return { kind: 'answer', text };
}
