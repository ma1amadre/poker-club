import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTimeoutError, TimeoutError, withTimeout } from './timeout';

const timeout = () => new TimeoutError('Ответа нет', 100);

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ответ пришёл вовремя — его значение, таймер снят', async () => {
    const result = withTimeout(async () => 'ok', 100, timeout);
    await expect(result).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ошибка запроса проходит как есть', async () => {
    const result = withTimeout(() => Promise.reject(new Error('сеть')), 100, timeout);
    await expect(result).rejects.toThrow('сеть');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('зависший запрос: через ms — TimeoutError, сигнал запроса отменён', async () => {
    let seen: AbortSignal | null = null;
    const result = withTimeout(
      (signal) => {
        seen = signal;
        return new Promise<string>(() => undefined); // сервер молчит
      },
      100,
      timeout,
    );
    const caught = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(99);
    expect((seen as AbortSignal | null)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await caught;
    expect(isTimeoutError(error)).toBe(true);
    expect((error as TimeoutError).message).toBe('Ответа нет');
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });

  it('ответ после тайм-аута ничего не меняет', async () => {
    let answer: (v: string) => void = () => undefined;
    const result = withTimeout(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
      100,
      timeout,
    );
    const caught = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    answer('поздно');
    expect(isTimeoutError(await caught)).toBe(true);
  });

  it('внешняя отмена (повтор входа) — сразу, с её причиной', async () => {
    const outer = new AbortController();
    const result = withTimeout(
      () => new Promise<string>(() => undefined),
      100,
      timeout,
      outer.signal,
    );
    const caught = result.catch((e: unknown) => e);
    outer.abort(new Error('повтор'));
    expect(((await caught) as Error).message).toBe('повтор');
    expect(vi.getTimerCount()).toBe(0);

    const already = new AbortController();
    already.abort(new Error('уже'));
    await expect(withTimeout(async () => 1, 100, timeout, already.signal)).rejects.toThrow('уже');
  });

  it('run бросил синхронно — ошибка, а не зависание', async () => {
    const result = withTimeout(
      () => {
        throw new Error('сломалось');
      },
      100,
      timeout,
    );
    await expect(result).rejects.toThrow('сломалось');
    expect(vi.getTimerCount()).toBe(0);
  });
});
