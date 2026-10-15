import { describe, expect, it } from 'vitest';
import { bytesToBase64, fitScale, nextCompressStep, scaledSize } from './image';

describe('сжатие фото: чистые части', () => {
  it('длинная сторона — не больше maxSide, маленькое фото не увеличиваем', () => {
    expect(fitScale(4032, 3024, 1600)).toBeCloseTo(1600 / 4032);
    expect(scaledSize(4032, 3024, fitScale(4032, 3024, 1600))).toEqual({
      width: 1600,
      height: 1200,
    });
    // Портрет (телефон держали вертикально): длинная — высота.
    expect(scaledSize(3024, 4032, fitScale(3024, 4032, 1600))).toEqual({
      width: 1200,
      height: 1600,
    });
    expect(fitScale(1280, 960, 1600)).toBe(1);
    expect(scaledSize(1280, 960, 1)).toEqual({ width: 1280, height: 960 });
  });

  it('размер — целые пиксели, не меньше одного', () => {
    expect(scaledSize(3, 1, 0.1)).toEqual({ width: 1, height: 1 });
    expect(fitScale(0, 0, 1600)).toBe(1);
  });

  it('больше предела — сначала качество вниз до 0.55, потом размер на 20 %', () => {
    const steps = [{ scale: 1, quality: 0.8 }];
    for (let i = 0; i < 5; i += 1) steps.push(nextCompressStep(steps[steps.length - 1]!));
    expect(steps).toEqual([
      { scale: 1, quality: 0.8 },
      { scale: 1, quality: 0.7 },
      { scale: 1, quality: 0.6 },
      { scale: 1, quality: 0.5 },
      { scale: 0.8, quality: 0.5 },
      { scale: 0.8 * 0.8, quality: 0.5 },
    ]);
  });
});

describe('bytesToBase64', () => {
  it('как btoa, и на больших массивах (кусками)', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('/9j/4A==');
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    expect(bytesToBase64(big)).toBe(btoa(Array.from(big, (b) => String.fromCharCode(b)).join('')));
  });
});
