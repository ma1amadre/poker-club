// Пункт «Камера»: задняя камера (facingMode environment) → превью, через 1,5 с — яркость кадра через
// canvas. Чёрный или однотонный кадр — замер ещё раз через 3 с: так WebView iOS отдаёт пустой поток.
// Разрешение спрашивается только по нажатию; уход со страницы гасит камеру.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { sampleFrame, stopStream, type FrameSample } from './device';
import {
  IDLE,
  fact,
  frameStatsText,
  frameVerdict,
  mediaErrorText,
  sizeText,
  type ProbeFact,
  type ProbeResult,
} from './lib';

const FIRST_SAMPLE_MS = 1_500;
const SECOND_SAMPLE_MS = 3_000;

const hasGetUserMedia = (): boolean => typeof navigator.mediaDevices?.getUserMedia === 'function';

const NO_GET_USER_MEDIA: ProbeResult = {
  status: 'no',
  note: 'getUserMedia недоступен в этом окне',
  facts: [],
};

function facingText(mode: string | undefined): string {
  if (mode === 'environment') return 'задняя (environment)';
  if (mode === 'user') return 'фронтальная (user)';
  return mode ? mode : 'не сообщается';
}

/** Почему кадр не годится — в метку «ОШИБКА». */
function badFrameNote(sample: FrameSample): string {
  if (sample.kind === 'none') return `кадра нет — ${sample.reason}`;
  return frameVerdict(sample.stats) === 'dark'
    ? 'кадр чёрный — поток пустой или камера закрыта'
    : 'кадр однотонный — поток не обновляется';
}

const sampleText = (sample: FrameSample): string =>
  sample.kind === 'stats' ? frameStatsText(sample.stats) : sample.reason;

const sampleOk = (sample: FrameSample): boolean =>
  sample.kind === 'stats' && frameVerdict(sample.stats) === 'ok';

export interface CameraProbe {
  result: ProbeResult;
  /** Камера включена — превью видно. */
  live: boolean;
  start: () => void;
  stop: () => void;
}

/** videoRef — элемент превью: страница держит его в разметке всегда (скрытым, пока камера выключена). */
export function useCameraProbe(videoRef: RefObject<HTMLVideoElement | null>): CameraProbe {
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  // Номер запуска: ответ разрешения или таймер замера от прежнего запуска (или после ухода) — мимо.
  const run = useRef(0);
  // Что известно о потоке до замера кадра — остаётся, если камеру выключили раньше замера.
  const streamFacts = useRef<ProbeFact[]>([]);
  const [result, setResult] = useState<ProbeResult>(() =>
    hasGetUserMedia() ? IDLE : NO_GET_USER_MEDIA,
  );
  const [live, setLive] = useState(false);

  const release = useCallback(() => {
    run.current += 1;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, [videoRef]);

  const stop = useCallback(() => {
    release();
    setLive(false);
    // Выключили до замера — пункт снова «не проверено», то, что успели узнать о потоке, остаётся.
    setResult((prev) =>
      prev.status === 'running'
        ? {
            status: 'idle',
            facts: [
              ...streamFacts.current,
              ...(streamFacts.current.length > 0
                ? [fact('Яркость кадра', 'не замерена — камеру выключили раньше')]
                : []),
            ],
          }
        : prev,
    );
  }, [release]);

  const start = useCallback(async () => {
    release();
    setLive(false);
    streamFacts.current = [];
    const id = run.current;
    if (!hasGetUserMedia()) {
      setResult(NO_GET_USER_MEDIA);
      return;
    }
    setResult({ status: 'running', facts: [fact('Камера', 'ждёт разрешения')] });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch (error) {
      if (id === run.current)
        setResult({ status: 'error', note: mediaErrorText(error), facts: [] });
      return;
    }
    const video = videoRef.current;
    if (id !== run.current || !video) {
      stopStream(stream);
      return;
    }
    streamRef.current = stream;
    setLive(true);

    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    const facts: ProbeFact[] = [];
    streamFacts.current = facts;
    if (settings.width && settings.height) {
      const fps = settings.frameRate ? `, ${Math.round(settings.frameRate)} кадр/с` : '';
      facts.push(fact('Поток', `${sizeText(settings.width, settings.height)}${fps}`));
    }
    facts.push(fact('Камера', facingText(settings.facingMode)));
    if (track?.label) facts.push(fact('Устройство', track.label));

    // iOS играет видео в странице только без звука и с playsinline — и атрибутом, и свойством.
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    try {
      await video.play();
    } catch (error) {
      facts.push(fact('Превью', `не запустилось — ${mediaErrorText(error)}`));
    }
    if (id !== run.current) return;
    setResult({ status: 'running', facts: [...facts, fact('Яркость кадра', 'замер через 1,5 с')] });

    const finish = (samples: ProbeFact[], last: FrameSample) => {
      const frame = video.videoWidth
        ? [fact('Кадр', sizeText(video.videoWidth, video.videoHeight))]
        : [];
      const all = [...facts, ...frame, ...samples];
      setResult(
        sampleOk(last)
          ? { status: 'ok', facts: all }
          : { status: 'error', note: badFrameNote(last), facts: all },
      );
    };

    timers.current.push(
      window.setTimeout(() => {
        if (id !== run.current) return;
        const first = sampleFrame(video);
        const firstFact = fact('Яркость кадра через 1,5 с', sampleText(first));
        if (sampleOk(first)) {
          finish([firstFact], first);
          return;
        }
        // Первые кадры бывают пустыми, пока камера просыпается, — второй замер решает.
        setResult({
          status: 'running',
          facts: [...facts, firstFact, fact('Яркость кадра через 3 с', 'замер')],
        });
        timers.current.push(
          window.setTimeout(() => {
            if (id !== run.current) return;
            const second = sampleFrame(video);
            finish([firstFact, fact('Яркость кадра через 3 с', sampleText(second))], second);
          }, SECOND_SAMPLE_MS - FIRST_SAMPLE_MS),
        );
      }, FIRST_SAMPLE_MS),
    );
  }, [release, videoRef]);

  // Уход со страницы (смена экрана, закрытие Mini App) — камеру гасим.
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      release();
    };
  }, [release, stop]);

  return { result, live, start: () => void start(), stop };
}
