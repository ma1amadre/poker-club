// Проигрыватель голоса табло на WebAudio: клипы (MP3 из voice_clips) лежат в памяти байтами,
// декодируются при первом проигрывании (небольшой кеш декодированных — несжатый звук на ТВ
// занимает в десятки раз больше), объявления играются строго по очереди, без наложений.
//
// Браузеры не дают звук без жеста: AudioContext создаётся и будится в обработчике нажатия
// (unlock). Если контекст «уснул» (вкладка в фоне, ТВ-браузер), объявления не копятся — лучше
// промолчать, чем через пять минут сказать «Пауза».

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Голос возможен: есть WebAudio и WebCrypto (хеш клипа; в браузере — только https/localhost). */
export function voiceSupported(): boolean {
  return (
    audioContextCtor() !== null &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle?.digest === 'function'
  );
}

/** Кнопка голоса на табло (`data-voice-toggle` у VoiceButton в BoardPage). */
export const VOICE_TOGGLE_SELECTOR = '[data-voice-toggle]';

/**
 * Жест пришёл в кнопку голоса (или в её подпись/иконку). Общий обработчик «разбудить звук
 * первым нажатием» такие жесты пропускает: кнопка решает сама, включить или выключить, по
 * состоянию до нажатия — если звук разбудить раньше её click, нажатие «Включить голос» его
 * выключит.
 */
export function isVoiceToggleGesture(target: EventTarget | null): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  if (typeof closest !== 'function') return false;
  return (closest as (selector: string) => unknown).call(target, VOICE_TOGGLE_SELECTOR) != null;
}

/** Пауза между клипами одной фразы и между объявлениями, мс. */
const SEGMENT_GAP_MS = 60;
const ANNOUNCEMENT_GAP_MS = 400;
/** Сколько объявлений может ждать очереди; старые лишние выбрасываются. */
const MAX_QUEUE = 6;
/** Сколько декодированных клипов держать (≈ 0,5 МБ на клип в 3 с при 48 кГц). */
const DECODED_CACHE = 24;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** base64 из board_voice_clips → байты. */
export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private readonly clips = new Map<string, Uint8Array>();
  private readonly decoded = new Map<string, AudioBuffer>();
  private queue: string[][] = [];
  private pumping = false;
  private generation = 0;
  private source: AudioBufferSourceNode | null = null;
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  /** Контекст есть и играет (жест получен). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Создать и разбудить AudioContext. Из обработчика нажатия — звук разрешится; без жеста
   * (табло помнит, что голос включён) — браузер может оставить контекст спящим до первого нажатия.
   */
  unlock(): void {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.ctx.addEventListener('statechange', this.onChange);
    }
    const ctx = this.ctx;
    void ctx
      .resume()
      .catch(() => undefined)
      .finally(this.onChange);
    // Safari и часть ТВ-браузеров открывают звук только после проигрывания в том же жесте.
    try {
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
      const node = ctx.createBufferSource();
      node.buffer = silent;
      node.connect(ctx.destination);
      node.start(0);
    } catch {
      // Не вышло — разбудит следующее нажатие.
    }
  }

  has(hash: string): boolean {
    return this.clips.has(hash);
  }

  add(hash: string, bytes: Uint8Array): void {
    this.clips.set(hash, bytes);
  }

  /** Поставить объявление (клипы подряд) в очередь. */
  enqueue(hashes: readonly string[]): void {
    if (hashes.length === 0 || !this.running) return;
    this.queue.push([...hashes]);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    void this.pump();
  }

  /** Замолчать сразу: текущий клип и очередь. */
  stop(): void {
    this.generation += 1;
    this.queue = [];
    this.pumping = false;
    try {
      this.source?.stop();
    } catch {
      // уже доиграл
    }
    this.source = null;
  }

  dispose(): void {
    this.stop();
    this.ctx?.removeEventListener('statechange', this.onChange);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.decoded.clear();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const gen = this.generation;
    try {
      while (gen === this.generation) {
        const item = this.queue.shift();
        if (!item) break;
        for (const hash of item) {
          const buffer = await this.buffer(hash);
          if (gen !== this.generation) return;
          if (buffer && this.running) await this.play(buffer);
          if (gen !== this.generation) return;
          await sleep(SEGMENT_GAP_MS);
        }
        await sleep(ANNOUNCEMENT_GAP_MS);
      }
    } finally {
      if (gen === this.generation) this.pumping = false;
    }
  }

  private async buffer(hash: string): Promise<AudioBuffer | null> {
    const cached = this.decoded.get(hash);
    if (cached) {
      // LRU: свежий — в конец.
      this.decoded.delete(hash);
      this.decoded.set(hash, cached);
      return cached;
    }
    const bytes = this.clips.get(hash);
    const ctx = this.ctx;
    if (!bytes || !ctx) return null;
    try {
      // decodeAudioData забирает буфер себе — отдаём копию. Форма с колбэками — для старых
      // ТВ-браузеров; промис (если он есть) гасим, чтобы ошибка не всплыла второй раз.
      const copy = bytes.slice().buffer;
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const maybe = ctx.decodeAudioData(copy, resolve, reject) as
          Promise<AudioBuffer> | undefined;
        maybe?.catch(() => undefined);
      });
      this.decoded.set(hash, buffer);
      while (this.decoded.size > DECODED_CACHE) {
        const oldest = this.decoded.keys().next().value;
        if (oldest === undefined) break;
        this.decoded.delete(oldest);
      }
      return buffer;
    } catch {
      return null;
    }
  }

  private play(buffer: AudioBuffer): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        if (this.source === node) this.source = null;
        resolve();
      };
      // onended не придёт, если контекст уснул посреди клипа, — страхуемся длительностью.
      const guard = setTimeout(finish, buffer.duration * 1000 + 1500);
      node.onended = finish;
      this.source = node;
      try {
        node.start();
      } catch {
        finish();
      }
    });
  }
}
