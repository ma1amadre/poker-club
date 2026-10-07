import { describe, expect, it } from 'vitest';
import { keepScreenAwake, wakeLockHint, type WakeLockEnv, type WakeLockStatus } from './wakeLock';

/** Поддельные document и navigator.wakeLock: запросы можно разрешать и отклонять по одному. */
function fakeEnv() {
  const listeners = new Map<string, Set<() => void>>();
  const requests: { resolve: () => void; reject: () => void }[] = [];
  const sentinels: { released: boolean; fire: () => void }[] = [];
  const env: WakeLockEnv & { doc: { visibilityState: string } } = {
    wakeLock: {
      request: () =>
        new Promise((resolve, reject) => {
          requests.push({
            resolve: () => {
              let onRelease: () => void = () => undefined;
              const s = {
                released: false,
                fire: () => {
                  s.released = true;
                  onRelease();
                },
              };
              sentinels.push(s);
              resolve({
                release: async () => {
                  s.fire();
                },
                addEventListener: (_type, listener) => {
                  onRelease = listener;
                },
              });
            },
            reject: () => reject(new Error('NotAllowedError')),
          });
        }),
    },
    doc: {
      visibilityState: 'visible',
      addEventListener: (type, listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(listener);
      },
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener);
      },
    },
  };
  const emit = (type: string) => {
    for (const l of listeners.get(type) ?? []) l();
  };
  return { env, requests, sentinels, emit, listeners };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('keepScreenAwake', () => {
  it('берёт удержание сразу; браузер снял — снова при возврате на экран', async () => {
    const { env, requests, sentinels, emit } = fakeEnv();
    const seen: WakeLockStatus[] = [];
    const stop = keepScreenAwake(env, (s) => seen.push(s));
    expect(requests).toHaveLength(1);
    requests[0]?.resolve();
    await tick();
    expect(seen).toEqual(['held']);

    // Mini App свернули: браузер снимает удержание.
    env.doc.visibilityState = 'hidden';
    sentinels[0]?.fire();
    expect(seen.at(-1)).toBe('released');
    emit('visibilitychange'); // скрыта — не просим
    expect(requests).toHaveLength(1);

    env.doc.visibilityState = 'visible';
    emit('visibilitychange');
    expect(requests).toHaveLength(2);
    requests[1]?.resolve();
    await tick();
    expect(seen.at(-1)).toBe('held');
    stop();
    expect(sentinels[1]?.released).toBe(true);
  });

  it('отказ браузера — denied и повтор на ближайшем касании', async () => {
    const { env, requests, emit } = fakeEnv();
    const seen: WakeLockStatus[] = [];
    const stop = keepScreenAwake(env, (s) => seen.push(s));
    requests[0]?.reject();
    await tick();
    expect(seen).toEqual(['denied']);
    expect(wakeLockHint('denied')).toContain('Отключи автоблокировку на время игры');

    emit('pointerdown');
    expect(requests).toHaveLength(2);
    requests[1]?.resolve();
    await tick();
    expect(seen.at(-1)).toBe('held');
    expect(wakeLockHint('held')).toBe(null);
    stop();
  });

  it('одновременно — один запрос; после отмены удержание снимается и статус не приходит', async () => {
    const { env, requests, sentinels, emit, listeners } = fakeEnv();
    const seen: WakeLockStatus[] = [];
    const stop = keepScreenAwake(env, (s) => seen.push(s));
    emit('pointerdown');
    emit('pointerdown');
    expect(requests).toHaveLength(1);
    stop();
    requests[0]?.resolve(); // ответ пришёл после ухода с экрана
    await tick();
    expect(sentinels[0]?.released).toBe(true);
    expect(seen).toEqual([]);
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it('подсказка — только когда удержать нельзя', () => {
    expect(wakeLockHint('unsupported')).toBe(
      'Отключи автоблокировку на время игры: телефон не даёт приложению держать экран включённым.',
    );
    expect(wakeLockHint('released')).toBe(null);
  });
});
