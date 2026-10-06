import { afterEach, describe, expect, it } from 'vitest';
import {
  addClockSample,
  clockOffsetMs,
  clockSample,
  estimateOffset,
  resetServerClock,
  SAMPLE_TTL_MS,
} from './serverClock';

afterEach(() => resetServerClock());

describe('clockSample', () => {
  it('смещение — сервер минус середина запроса', () => {
    // устройство отстаёт на 30 с: отправили в 1000, получили в 1200, сервер ответил 31 100
    expect(clockSample(31_100, 1000, 1200)).toEqual({ offsetMs: 30_000, rttMs: 200, atMs: 1200 });
  });

  it('ISO с микросекундами (как отдаёт PostgREST)', () => {
    const t = Date.parse('2026-10-06T12:00:00.000Z');
    const s = clockSample('2026-10-06T12:00:00.000500+00:00', t - 100, t + 100);
    expect(s?.offsetMs).toBe(0);
  });

  it('мусор и слишком долгий запрос — не замер', () => {
    expect(clockSample('не время', 0, 10)).toBeNull();
    expect(clockSample(0, 100, 50)).toBeNull();
    expect(clockSample(0, 0, 60_000)).toBeNull();
  });
});

describe('estimateOffset', () => {
  it('берёт замер с наименьшим RTT', () => {
    const samples = [
      { offsetMs: 500, rttMs: 900, atMs: 1000 },
      { offsetMs: -90_000, rttMs: 80, atMs: 2000 },
      { offsetMs: 300, rttMs: 400, atMs: 3000 },
    ];
    expect(estimateOffset(samples, 3000)).toBe(-90_000);
  });

  it('старые замеры не учитывает', () => {
    const samples = [
      { offsetMs: 1000, rttMs: 10, atMs: 0 },
      { offsetMs: 2000, rttMs: 500, atMs: SAMPLE_TTL_MS + 10 },
    ];
    expect(estimateOffset(samples, SAMPLE_TTL_MS + 20)).toBe(2000);
    expect(estimateOffset([], 0)).toBeNull();
  });
});

describe('addClockSample', () => {
  it('копит замеры и держит лучший', () => {
    expect(clockOffsetMs()).toBe(0);
    addClockSample(61_000, 1000, 1400); // rtt 400 → 59 800
    expect(clockOffsetMs()).toBe(59_800);
    addClockSample(62_050, 2000, 2100); // rtt 100 → 60 000 (точнее)
    expect(clockOffsetMs()).toBe(60_000);
    addClockSample(70_000, 3000, 3900); // rtt 900 — хуже, смещение не меняется
    expect(clockOffsetMs()).toBe(60_000);
  });
});
