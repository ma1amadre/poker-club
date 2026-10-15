// Сжатие фото перед загрузкой: на Free-плане Supabase нет Image Transformations, а бакет
// vote-photos принимает до 2 МБ. Фото с телефона (4000 px, 3–8 МБ) ужимаем на клиенте.

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export interface CompressOptions {
  /** Длинная сторона, px. */
  maxSide?: number;
  /** Начальное качество JPEG. */
  quality?: number;
  /** Предельный размер результата, байт. */
  maxBytes?: number;
}

interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Drawable> {
  // createImageBitmap с imageOrientation учитывает EXIF-поворот — иначе фото с телефона
  // часто ложится набок.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Старый WebView без поддержки опций или формата — пробуем через <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Не удалось открыть изображение. Попробуй другое фото (JPEG или PNG).');
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сжать изображение'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Масштаб, при котором длинная сторона не больше maxSide (увеличивать не будем — не больше 1). */
export function fitScale(width: number, height: number, maxSide: number): number {
  return Math.min(1, maxSide / Math.max(width, height, 1));
}

/** Размер холста при масштабе: целые пиксели, не меньше 1. */
export function scaledSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Следующая попытка, если JPEG вышел больше предела: сначала качество вниз шагами по 0.1 (до 0.55),
 * потом размер — на 20 % за шаг.
 */
export function nextCompressStep(step: { scale: number; quality: number }): {
  scale: number;
  quality: number;
} {
  return step.quality > 0.55
    ? { scale: step.scale, quality: Math.round((step.quality - 0.1) * 100) / 100 }
    : { scale: step.scale * 0.8, quality: step.quality };
}

/**
 * Масштабирует так, чтобы длинная сторона ≤ maxSide (по умолчанию 1600), и кодирует в JPEG
 * (качество 0.8). Если результат всё ещё больше maxBytes (2 МБ) — снижает качество, затем размер.
 * Поворот по EXIF учитывается при чтении (decode), поэтому JPEG на выходе уже «стоит» как на экране.
 */
export async function compressImage(file: Blob, options: CompressOptions = {}): Promise<Blob> {
  const { maxSide = 1600, quality = 0.8, maxBytes = MAX_UPLOAD_BYTES } = options;
  const image = await decode(file);
  const canvas = document.createElement('canvas');
  try {
    let step = { scale: fitScale(image.width, image.height, maxSide), quality };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const size = scaledSize(image.width, image.height, step.scale);
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Браузер не дал canvas для сжатия фото');
      // Белая подложка: прозрачные PNG в JPEG иначе становятся чёрными.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const blob = await toJpeg(canvas, step.quality);
      if (blob.size <= maxBytes) return blob;
      step = nextCompressStep(step);
    }
    throw new Error('Фото слишком большое даже после сжатия');
  } finally {
    image.release();
    // Освобождаем память canvas сразу: на iOS лимит суммарной площади canvas небольшой.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Байты → base64 (без префикса data:). Кусками по 32 КБ: `String.fromCharCode(...bytes)` целиком на
 * мегабайтном фото переполнил бы стек аргументов.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Сжатое фото (Blob) → base64 для тела запроса. */
export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
