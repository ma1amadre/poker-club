import { describe, expect, it } from 'vitest';
import { ClipLoader, FAILED_RETRY_MS, MISSING_RETRY_MS, type FetchClips } from './clipLoader';

/** Хранилище как у VoicePlayer: хеш → байты. */
function store() {
  const clips = new Map<string, Uint8Array>();
  return {
    clips,
    has: (h: string) => clips.has(h),
    add: (h: string, bytes: Uint8Array) => void clips.set(h, bytes),
  };
}

const decode = (b64: string): Uint8Array => {
  if (b64 === 'broken') throw new Error('bad base64');
  return new Uint8Array([b64.length]);
};

/** Сервер: отдаёт клипы из `voiced`, считает запросы; поведение можно подменить. */
function server(voiced: Iterable<string>) {
  const have = new Set(voiced);
  const calls: string[][] = [];
  let mode: 'ok' | 'offline' | 'gone' = 'ok';
  const fetchClips: FetchClips = (hashes) => {
    calls.push(hashes);
    if (mode === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === 'gone') return Promise.resolve(null);
    return Promise.resolve(
      hashes.filter((h) => have.has(h)).map((hash) => ({ hash, audio: 'mp3' })),
    );
  };
  return {
    calls,
    fetchClips,
    have,
    set mode(m: 'ok' | 'offline' | 'gone') {
      mode = m;
    },
  };
}

/**
 * Табло так, как его гоняет useBoardVoice: эффект перезапускается часто (каждый рендер), каждый
 * раз спрашивает due и, если есть что грузить и загрузка не идёт, грузит. Шаг — 100 мс.
 */
async function board(
  loader: ClipLoader,
  hashes: string[],
  fetchClips: FetchClips,
  fromMs: number,
  toMs: number,
): Promise<void> {
  for (let now = fromMs; now <= toMs; now += 100) {
    if (loader.loading) continue;
    const due = loader.due(hashes, now);
    if (due.length > 0) await loader.load(due, fetchClips, 2, () => now);
  }
}

const H = ['h1', 'h2', 'h3', 'h4', 'h5'];

describe('голос табло: подгрузка клипов', () => {
  it('пачками; пришедшее больше не просим, неозвученное — через 5 минут', async () => {
    const s = store();
    const srv = server(['h1', 'h2', 'h4']);
    const loader = new ClipLoader(s, decode);
    expect(await loader.load(loader.due(H, 0), srv.fetchClips, 2, () => 0)).toBe('ok');
    expect(srv.calls).toEqual([['h1', 'h2'], ['h3', 'h4'], ['h5']]);
    expect([...s.clips.keys()].sort()).toEqual(['h1', 'h2', 'h4']);
    expect(loader.missing(H)).toBe(2);
    expect(H.filter((h) => loader.isMissing(h))).toEqual(['h3', 'h5']);
    expect(loader.due(H, MISSING_RETRY_MS - 1)).toEqual([]);
    expect(loader.due(H, MISSING_RETRY_MS)).toEqual(['h3', 'h5']);

    // Генератор озвучил h3 — перепроверка его заберёт.
    srv.have.add('h3');
    await loader.load(loader.due(H, MISSING_RETRY_MS), srv.fetchClips, 2, () => MISSING_RETRY_MS);
    expect(s.has('h3')).toBe(true);
    expect(loader.missing(H)).toBe(1);
  });

  it('нет сети: один запрос, повтор не раньше чем через 30 с', async () => {
    const srv = server(H);
    srv.mode = 'offline';
    const loader = new ClipLoader(store(), decode);
    // Раньше табло повторяло упавший запрос сразу — тысячи запросов за секунды.
    await board(loader, H, srv.fetchClips, 0, 5_000);
    expect(srv.calls).toHaveLength(1);
    expect(loader.missing(H)).toBe(0); // сбой — не «не озвучено»
    expect(loader.isMissing('h1')).toBe(false);

    await board(loader, H, srv.fetchClips, 5_100, FAILED_RETRY_MS - 100);
    expect(srv.calls).toHaveLength(1);

    srv.mode = 'ok';
    await board(loader, H, srv.fetchClips, FAILED_RETRY_MS, FAILED_RETRY_MS + 10_000);
    expect(srv.calls).toHaveLength(1 + 3); // повтор — снова все пять хешей, пачками по два
    expect(loader.due(H, FAILED_RETRY_MS + 10_000)).toEqual([]);
  });

  it('ошибка сервера посреди загрузки: пришедшее остаётся, повтор — только остального', async () => {
    const s = store();
    const srv = server(H);
    let n = 0;
    const flaky: FetchClips = (hashes) => {
      n += 1;
      return n === 2 ? Promise.reject(new Error('503')) : srv.fetchClips(hashes);
    };
    const loader = new ClipLoader(s, decode);
    expect(await loader.load(H, flaky, 2, () => 0)).toBe('failed');
    expect([...s.clips.keys()]).toEqual(['h1', 'h2']);
    expect(loader.due(H, 1_000)).toEqual([]);
    expect(loader.due(H, FAILED_RETRY_MS)).toEqual(['h3', 'h4', 'h5']);
  });

  it('ссылка погасла (null): не крутим запросы', async () => {
    const srv = server(H);
    srv.mode = 'gone';
    const loader = new ClipLoader(store(), decode);
    await board(loader, H, srv.fetchClips, 0, 5_000);
    expect(srv.calls).toHaveLength(1);
  });

  it('битый base64 — как неозвученная фраза; чужие хеши в ответе — мимо', async () => {
    const s = store();
    const loader = new ClipLoader(s, decode);
    const fetchClips: FetchClips = () =>
      Promise.resolve([
        { hash: 'h1', audio: 'broken' },
        { hash: 'h2', audio: 'mp3' },
        { hash: 'zz', audio: 'mp3' },
      ]);
    await loader.load(['h1', 'h2'], fetchClips, 40, () => 0);
    expect([...s.clips.keys()]).toEqual(['h2']);
    expect(loader.missing(['h1', 'h2'])).toBe(1);
  });

  it('вторая загрузка, пока идёт первая, ничего не делает', async () => {
    const srv = server(H);
    let release: () => void = () => undefined;
    const slow: FetchClips = (hashes) =>
      new Promise((resolve) => {
        release = () => void srv.fetchClips(hashes).then(resolve);
      });
    const loader = new ClipLoader(store(), decode);
    const first = loader.load(['h1'], slow, 40, () => 0);
    expect(loader.loading).toBe(true);
    expect(await loader.load(['h2'], srv.fetchClips, 40, () => 0)).toBe('ok');
    expect(srv.calls).toEqual([]);
    release();
    await first;
    expect(loader.loading).toBe(false);
    expect(srv.calls).toEqual([['h1']]);
  });
});
