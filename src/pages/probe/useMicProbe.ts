// Пункт «Микрофон»: getUserMedia({ audio: true }) → полоса уровня (AnalyserNode), какие mimeType
// понимает MediaRecorder (без разрешения — сразу), запись 3 с и воспроизведение. Запись живёт только
// ссылкой blob: в памяти страницы; уход со страницы гасит микрофон и освобождает всё. Метка — micStatus:
// [ OK ] только когда звук есть (пик уровня) и есть чем записать, немой поток — ошибка.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { NBSP, formatNumber } from '../../shared/lib/format';
import { audioContextCtor, stopStream } from './device';
import {
  MIC_SILENCE_MS,
  RECORDER_MIME_CANDIDATES,
  durationText,
  fact,
  formatBytes,
  levelFromRms,
  mediaElementErrorText,
  mediaErrorText,
  micStatus,
  pickRecorderMime,
  recorderSupport,
  recorderSupportFacts,
  rmsOfBytes,
  yesNo,
  type ProbeFact,
  type ProbeResult,
} from './lib';

export const RECORD_SECONDS = 3;
/** Полосу уровня перерисовываем 10 раз в секунду — чаще экрану незачем. */
const LEVEL_UPDATE_MS = 100;

const hasGetUserMedia = (): boolean => typeof navigator.mediaDevices?.getUserMedia === 'function';

interface Step<S extends string> {
  state: S;
  note?: string;
  facts: ProbeFact[];
}

type MicState = 'idle' | 'pending' | 'live' | 'off' | 'no' | 'error';
type RecState = 'idle' | 'recording' | 'done' | 'error';
type PlayState = 'idle' | 'playing' | 'done' | 'error';

/** Настройка обработки звука: да/нет, строкой (echoCancellation: «remote-only») или «?» — не сообщается. */
const flag = (value: boolean | string | undefined): string =>
  value === undefined ? '?' : typeof value === 'string' ? value : yesNo(value);

function micFacts(track: MediaStreamTrack | undefined): ProbeFact[] {
  const s = track?.getSettings() ?? {};
  const facts: ProbeFact[] = [];
  const channels = s.channelCount ? `${s.channelCount} кан.` : 'каналы не сообщаются';
  const rate = s.sampleRate ? `${formatNumber(s.sampleRate)}${NBSP}Гц` : 'частота не сообщается';
  facts.push(fact('Поток', `${channels}, ${rate}`));
  facts.push(
    fact(
      'Обработка',
      `эхо — ${flag(s.echoCancellation)}, шум — ${flag(s.noiseSuppression)}, усиление — ${flag(s.autoGainControl)}`,
    ),
  );
  if (track?.label) facts.push(fact('Устройство', track.label));
  return facts;
}

export interface MicProbe {
  result: ProbeResult;
  live: boolean;
  /** Есть MediaRecorder — запись возможна. */
  canRecord: boolean;
  /** Уровень 0–1 для полосы. */
  level: number;
  recording: boolean;
  /** Сколько секунд записи осталось. */
  recordLeft: number;
  recordingUrl: string | null;
  playing: boolean;
  start: () => void;
  stop: () => void;
  record: () => void;
  play: () => void;
  onEnded: () => void;
  onError: () => void;
}

/** audioRef — элемент воспроизведения записи в разметке страницы. */
export function useMicProbe(audioRef: RefObject<HTMLAudioElement | null>): MicProbe {
  const support = useMemo(
    () =>
      typeof MediaRecorder === 'undefined'
        ? null
        : recorderSupport(RECORDER_MIME_CANDIDATES, (mime) => MediaRecorder.isTypeSupported(mime)),
    [],
  );
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef(0);
  const timers = useRef<number[]>([]);
  // Ожидание звука после включения — отдельно от таймеров записи (их гасит ошибка записи).
  const silenceTimer = useRef(0);
  const peakRef = useRef(0);
  // Номер включения микрофона и номер записи: ответы и таймеры прежних — мимо.
  const run = useRef(0);
  const recRun = useRef(0);

  const [mic, setMic] = useState<Step<MicState>>(() =>
    hasGetUserMedia()
      ? { state: 'idle', facts: [] }
      : { state: 'no', note: 'getUserMedia недоступен в этом окне', facts: [] },
  );
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState<number | null>(null);
  // Уровень меряется (AnalyserNode подключён) и прошло ли MIC_SILENCE_MS с включения.
  const [metered, setMetered] = useState(false);
  const [waited, setWaited] = useState(false);
  const [rec, setRec] = useState<Step<RecState>>({ state: 'idle', facts: [] });
  const [recordLeft, setRecordLeft] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Step<PlayState>>({ state: 'idle', facts: [] });

  useEffect(() => {
    if (!recordingUrl) return;
    return () => URL.revokeObjectURL(recordingUrl);
  }, [recordingUrl]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const release = useCallback(() => {
    run.current += 1;
    recRun.current += 1;
    window.cancelAnimationFrame(rafRef.current);
    clearTimers();
    window.clearTimeout(silenceTimer.current);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // уже остановлен
      }
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    audioRef.current?.pause();
  }, [audioRef]);

  const stop = useCallback(() => {
    release();
    setLevel(0);
    setMic((prev) =>
      prev.state === 'live' || prev.state === 'pending' ? { ...prev, state: 'off' } : prev,
    );
    setRec((prev) => (prev.state === 'recording' ? { state: 'idle', facts: [] } : prev));
    setPlayback((prev) => (prev.state === 'playing' ? { state: 'idle', facts: [] } : prev));
  }, [release]);

  const start = useCallback(async () => {
    release();
    const id = run.current;
    if (!hasGetUserMedia()) {
      setMic({ state: 'no', note: 'getUserMedia недоступен в этом окне', facts: [] });
      return;
    }
    // AudioContext — прямо в обработчике нажатия: iOS даёт звук только по жесту.
    const Ctor = audioContextCtor();
    let ctx: AudioContext | null = null;
    try {
      ctx = Ctor ? new Ctor() : null;
      void ctx?.resume().catch(() => undefined);
    } catch {
      ctx = null;
    }
    ctxRef.current = ctx;
    peakRef.current = 0;
    setPeak(null);
    setLevel(0);
    setMetered(false);
    setWaited(false);
    setMic({ state: 'pending', facts: [] });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (id !== run.current) return;
      release();
      setMic({ state: 'error', note: mediaErrorText(error), facts: [] });
      return;
    }
    if (id !== run.current) {
      stopStream(stream);
      return;
    }
    streamRef.current = stream;
    const facts = micFacts(stream.getAudioTracks()[0]);

    if (ctx) {
      try {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let shownAt = 0;
        const tick = (now: number) => {
          if (id !== run.current) return;
          analyser.getByteTimeDomainData(samples);
          const value = levelFromRms(rmsOfBytes(samples));
          peakRef.current = Math.max(peakRef.current, value);
          if (now - shownAt >= LEVEL_UPDATE_MS) {
            shownAt = now;
            setLevel(value);
            setPeak(peakRef.current);
          }
          rafRef.current = window.requestAnimationFrame(tick);
        };
        rafRef.current = window.requestAnimationFrame(tick);
        setMetered(true);
      } catch (error) {
        facts.push(fact('Уровень', `не измерить — ${mediaErrorText(error)}`));
      }
    } else {
      facts.push(fact('Уровень', 'AudioContext нет'));
    }
    setMic({ state: 'live', facts });
    silenceTimer.current = window.setTimeout(() => {
      if (id === run.current) setWaited(true);
    }, MIC_SILENCE_MS);
  }, [release]);

  const record = useCallback(() => {
    const stream = streamRef.current;
    // Без MediaRecorder кнопка записи недоступна, а метка — [ НЕТ ] с причиной (micStatus).
    if (!stream || recorderRef.current || !support) return;
    const id = ++recRun.current;
    const mime = pickRecorderMime(support);
    const fail = (error: unknown) => {
      recorderRef.current = null;
      clearTimers();
      const text = mediaErrorText(error);
      setRec({ state: 'error', note: text, facts: [fact('Запись', `ошибка — ${text}`)] });
    };
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (error) {
      fail(error);
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      if (id === recRun.current) fail((event as Event & { error?: unknown }).error ?? event);
    };
    recorder.onstop = () => {
      if (id !== recRun.current) return;
      recorderRef.current = null;
      const type = recorder.mimeType || mime || '';
      const blob = new Blob(chunks, type ? { type } : {});
      if (blob.size === 0) {
        setRec({ state: 'error', note: 'пустая запись', facts: [fact('Запись', 'пустая')] });
        return;
      }
      setRecordingUrl(URL.createObjectURL(blob));
      setPlayback({ state: 'idle', facts: [] });
      setRec({
        state: 'done',
        facts: [
          fact(
            `Запись ${RECORD_SECONDS} с`,
            `${type || 'тип не сообщается'}, ${formatBytes(blob.size)}`,
          ),
        ],
      });
    };
    try {
      recorder.start();
    } catch (error) {
      fail(error);
      return;
    }
    recorderRef.current = recorder;
    setRecordingUrl(null);
    setPlayback({ state: 'idle', facts: [] });
    setRec({ state: 'recording', facts: [] });
    setRecordLeft(RECORD_SECONDS);
    for (let s = 1; s < RECORD_SECONDS; s++)
      timers.current.push(window.setTimeout(() => setRecordLeft(RECORD_SECONDS - s), s * 1000));
    timers.current.push(
      window.setTimeout(() => {
        if (id !== recRun.current || recorder.state === 'inactive') return;
        try {
          recorder.stop();
        } catch (error) {
          fail(error);
        }
      }, RECORD_SECONDS * 1000),
    );
  }, [support]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !recordingUrl) return;
    setPlayback({ state: 'playing', facts: [] });
    try {
      audio.currentTime = 0;
      await audio.play();
    } catch (error) {
      const text = mediaErrorText(error);
      setPlayback({
        state: 'error',
        note: text,
        facts: [fact('Воспроизведение', `ошибка — ${text}`)],
      });
    }
  }, [audioRef, recordingUrl]);

  const onEnded = useCallback(() => {
    const audio = audioRef.current;
    setPlayback({
      state: 'done',
      facts: [
        fact('Воспроизведение', `до конца, длительность ${durationText(audio?.duration ?? NaN)}`),
      ],
    });
  }, [audioRef]);

  const onError = useCallback(() => {
    const audio = audioRef.current;
    // Пустой src после сброса записи — не ошибка воспроизведения.
    if (!audio?.getAttribute('src')) return;
    const text = mediaElementErrorText(audio.error?.code);
    setPlayback({
      state: 'error',
      note: text,
      facts: [fact('Воспроизведение', `ошибка — ${text}`)],
    });
  }, [audioRef]);

  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      release();
    };
  }, [release, stop]);

  // --- Статус пункта: микрофон, затем запись и воспроизведение (micStatus) ---
  const peakFacts = peak === null ? [] : [fact('Пик уровня', `${Math.round(peak * 100)}${NBSP}%`)];
  const facts = [
    ...recorderSupportFacts(support),
    ...mic.facts,
    ...peakFacts,
    ...rec.facts,
    ...playback.facts,
  ];
  const result: ProbeResult = {
    ...micStatus({
      mic: mic.state,
      micNote: mic.note,
      peak: metered ? (peak ?? 0) : null,
      waited,
      recorder: support !== null,
      rec: rec.state,
      recNote: rec.note,
      playback: playback.state,
      playbackNote: playback.note,
    }),
    facts,
  };

  return {
    result,
    live: mic.state === 'live',
    canRecord: support !== null,
    level,
    recording: rec.state === 'recording',
    recordLeft,
    recordingUrl,
    playing: playback.state === 'playing',
    start: () => void start(),
    stop,
    record,
    play: () => void play(),
    onEnded,
    onError,
  };
}
