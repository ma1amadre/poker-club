// «Проверка устройства» — обращения к браузеру без React: окружение, вычисления, кадр видео, размер
// фото, конструкторы распознавания речи и AudioContext. Всё локально: ни запросов, ни моделей.

import { getWebApp, isInTelegram } from '../../shared/telegram';
import {
  WASM_BASE,
  WASM_SIMD,
  fact,
  frameStats,
  sizeText,
  yesNo,
  type FrameStats,
  type ProbeFact,
  type ProbeResult,
} from './lib';

/** Ошибка → текст для отчёта; ловим всё, что бросает браузер (не только Error). */
export const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

// ---------- Окружение ----------

export function envProbe(): ProbeResult {
  const app = getWebApp();
  const facts: ProbeFact[] = [];
  if (app && isInTelegram()) {
    facts.push(fact('Telegram', `${app.platform || 'неизвестно'}, версия ${app.version}`));
    facts.push(
      fact(
        'Окно Telegram',
        `высота ${Math.round(app.viewportStableHeight)} px, полный экран — ${yesNo(Boolean(app.isFullscreen))}`,
      ),
    );
  } else {
    facts.push(fact('Telegram', app ? `вне Telegram (SDK ${app.version})` : 'SDK не загрузился'));
  }
  facts.push(fact('userAgent', navigator.userAgent));
  const dpr = Math.round(window.devicePixelRatio * 100) / 100;
  facts.push(fact('Экран', `${sizeText(screen.width, screen.height)}, DPR ${dpr}`));
  facts.push(fact('Окно', sizeText(window.innerWidth, window.innerHeight)));
  facts.push(fact('Язык', navigator.language || 'не сообщается'));
  facts.push(fact('Защищённый контекст', yesNo(window.isSecureContext)));
  facts.push(
    fact('getUserMedia', yesNo(typeof navigator.mediaDevices?.getUserMedia === 'function')),
  );
  return { status: 'ok', facts };
}

// ---------- Вычисления ----------

/** Адаптер WebGPU может не ответить вовсе (выключенный GPU-процесс) — ждём не дольше этого. */
const GPU_TIMEOUT_MS = 5_000;

async function webgpuFact(): Promise<ProbeFact> {
  // В lib.dom navigator.gpu обязателен, а в старых браузерах его нет.
  const gpu = (navigator as { gpu?: GPU }).gpu;
  if (!gpu) return fact('WebGPU', 'нет (navigator.gpu нет)');
  try {
    let timer = 0;
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<'timeout'>((resolve) => {
        timer = window.setTimeout(() => resolve('timeout'), GPU_TIMEOUT_MS);
      }),
    ]);
    window.clearTimeout(timer);
    if (adapter === 'timeout') return fact('WebGPU', 'адаптер не ответил за 5 с');
    if (!adapter) return fact('WebGPU', 'navigator.gpu есть, адаптера нет');
    // info есть не во всех версиях WebGPU — без него адаптер «без описания».
    const info = (adapter as { info?: Partial<GPUAdapterInfo> }).info ?? {};
    const name = [info.vendor, info.architecture, info.device, info.description]
      .filter((part) => part)
      .join(' / ');
    const fallback = info.isFallbackAdapter ? ', программный' : '';
    return fact('WebGPU', `есть${fallback} — ${name || 'адаптер без описания'}`);
  } catch (error) {
    return fact('WebGPU', `ошибка — ${errorText(error)}`);
  }
}

function wasmFacts(): ProbeFact[] {
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function')
    return [fact('WebAssembly', 'нет')];
  try {
    return [
      fact('WebAssembly', yesNo(WebAssembly.validate(WASM_BASE))),
      fact('WebAssembly SIMD', yesNo(WebAssembly.validate(WASM_SIMD))),
    ];
  } catch (error) {
    return [fact('WebAssembly', `ошибка — ${errorText(error)}`)];
  }
}

export async function computeProbe(): Promise<ProbeResult> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const facts: ProbeFact[] = [await webgpuFact(), ...wasmFacts()];
  facts.push(fact('crossOriginIsolated', yesNo(window.crossOriginIsolated === true)));
  facts.push(fact('SharedArrayBuffer', yesNo(typeof SharedArrayBuffer === 'function')));
  facts.push(
    fact(
      'Потоков процессора',
      nav.hardwareConcurrency ? String(nav.hardwareConcurrency) : 'не сообщается',
    ),
  );
  facts.push(
    fact(
      'Память (deviceMemory)',
      typeof nav.deviceMemory === 'number' ? `${nav.deviceMemory} ГБ` : 'не сообщается',
    ),
  );
  return { status: 'ok', facts };
}

// ---------- Кадр видео ----------

/** Ширина уменьшенного кадра для замера: яркости хватает, а getImageData остаётся дешёвым. */
const SAMPLE_WIDTH = 64;

export type FrameSample = { kind: 'stats'; stats: FrameStats } | { kind: 'none'; reason: string };

/** Нарисовать текущий кадр в маленький canvas и посчитать яркость. */
export function sampleFrame(video: HTMLVideoElement): FrameSample {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0)
    return { kind: 'none', reason: `видео не идёт (readyState ${video.readyState})` };
  try {
    const width = SAMPLE_WIDTH;
    const height = Math.max(1, Math.round((SAMPLE_WIDTH * video.videoHeight) / video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { kind: 'none', reason: 'canvas 2d недоступен' };
    ctx.drawImage(video, 0, 0, width, height);
    const stats = frameStats(ctx.getImageData(0, 0, width, height).data);
    return stats ? { kind: 'stats', stats } : { kind: 'none', reason: 'пустой кадр' };
  } catch (error) {
    return { kind: 'none', reason: errorText(error) };
  }
}

// ---------- Фото ----------

/** Размер изображения с учётом поворота из EXIF; не открывается — null. */
export async function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      // старый WebView без опций или без формата — пробуем через <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Распознавание речи ----------

// Типы и поиск конструктора — общие с голосовым вводом карт олл-ина (shared/lib/speech.ts).
export {
  speechApis,
  type SpeechAlternativeLike,
  type SpeechApis,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
  type SpeechResultLike,
} from '../../shared/lib/speech';

// ---------- AudioContext ----------

export function audioContextCtor(): typeof AudioContext | null {
  const w = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Остановить все дорожки потока (камера, микрофон) — индикатор записи у системы гаснет. */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
