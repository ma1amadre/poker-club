// Подгрузка клипов голоса табло: что просить у board_voice_clips и когда повторять. Без React —
// повторы проверяет vitest (clipLoader.test.ts), хук useBoardVoice только зовёт due/load.
//
// Три исхода для хеша:
// - клип пришёл — лежит в хранилище (VoicePlayer), больше не просим;
// - сервер ответил, а клипа нет (фразу ещё не озвучили) — перепроверка через MISSING_RETRY_MS:
//   генератор могли запустить вручную;
// - запрос не прошёл (сеть, 4xx/5xx, ссылка погасла) — повтор не раньше FAILED_RETRY_MS. Без этой
//   паузы табло без сети или при сбое сервера крутило бы запросы без остановки.

/** Фраза ещё не озвучена — перепроверить через 5 минут. */
export const MISSING_RETRY_MS = 5 * 60_000;
/** Запрос не прошёл — повторить не раньше чем через 30 с. */
export const FAILED_RETRY_MS = 30_000;

/** Куда класть клипы (VoicePlayer). */
export interface ClipStore {
  has(hash: string): boolean;
  add(hash: string, bytes: Uint8Array): void;
}

/** Клипы по хешам (board_voice_clips): найденные; null — ссылка табло погасла. Ошибка — throw. */
export type FetchClips = (hashes: string[]) => Promise<{ hash: string; audio: string }[] | null>;

/** ok — все пачки прошли; failed — запрос упал; gone — ссылка погасла (сервер вернул null). */
export type LoadResult = 'ok' | 'failed' | 'gone';

export class ClipLoader {
  private readonly store: ClipStore;
  private readonly decode: (b64: string) => Uint8Array;
  private readonly missingAt = new Map<string, number>();
  private readonly failedAt = new Map<string, number>();
  private busy = false;

  constructor(store: ClipStore, decode: (b64: string) => Uint8Array) {
    this.store = store;
    this.decode = decode;
  }

  /** Идёт загрузка — новую не начинать. */
  get loading(): boolean {
    return this.busy;
  }

  /** Хеши, которые пора запросить: клипа нет, недавно не проверяли и запрос недавно не падал. */
  due(hashes: Iterable<string>, now: number): string[] {
    const out = new Set<string>();
    for (const h of hashes) {
      if (this.store.has(h)) continue;
      const checked = this.missingAt.get(h);
      if (checked !== undefined && now - checked < MISSING_RETRY_MS) continue;
      const failed = this.failedAt.get(h);
      if (failed !== undefined && now - failed < FAILED_RETRY_MS) continue;
      out.add(h);
    }
    return [...out];
  }

  /**
   * Загрузить хеши пачками по chunk. Не бросает: упавшая пачка и все следующие помечаются
   * упавшими (повтор через FAILED_RETRY_MS), уже пришедшее остаётся. Во время загрузки — no-op.
   */
  async load(
    hashes: readonly string[],
    fetchClips: FetchClips,
    chunk: number,
    clock: () => number,
  ): Promise<LoadResult> {
    if (this.busy || hashes.length === 0) return 'ok';
    this.busy = true;
    const size = Math.max(1, Math.floor(chunk));
    let i = 0;
    try {
      for (; i < hashes.length; i += size) {
        const part = hashes.slice(i, i + size);
        const clips = await fetchClips(part);
        if (clips === null) {
          this.fail(hashes.slice(i), clock());
          return 'gone';
        }
        const got = new Set<string>();
        for (const clip of clips) {
          if (!part.includes(clip.hash)) continue;
          try {
            this.store.add(clip.hash, this.decode(clip.audio));
            got.add(clip.hash);
          } catch {
            // Битый base64 — считаем, что клипа нет.
          }
        }
        const at = clock();
        for (const h of part) {
          this.failedAt.delete(h);
          if (got.has(h)) this.missingAt.delete(h);
          else this.missingAt.set(h, at);
        }
      }
      return 'ok';
    } catch {
      this.fail(hashes.slice(i), clock());
      return 'failed';
    } finally {
      this.busy = false;
    }
  }

  /** Сколько из hashes точно не озвучено: сервер ответил, а клипа нет. */
  missing(hashes: Iterable<string>): number {
    let count = 0;
    for (const h of new Set(hashes)) if (!this.store.has(h) && this.missingAt.has(h)) count += 1;
    return count;
  }

  private fail(hashes: readonly string[], at: number): void {
    for (const h of hashes) this.failedAt.set(h, at);
  }
}
