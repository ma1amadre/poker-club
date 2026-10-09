// «Проверка устройства» (#/probe) — дешёвая разведка перед решением о камере и голосе: что из камеры,
// фото, микрофона, распознавания речи и вычислений работает на этом телефоне внутри Telegram. Любой
// вошедший игрок; ссылка — со своей карточки и из админки. Разрешения — только по нажатию; приложение
// на свой сервер ничего не отправляет (отчёт текстом копирует сам игрок), но распознавание речи
// браузер или система телефона может делать на своём сервере — экран так и говорит. Уход со страницы
// гасит камеру и микрофон.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../shared/auth';
import { NBSP, copyText, paths } from '../../shared/lib';
import {
  Badge,
  Button,
  Page,
  Progress,
  Section,
  Segmented,
  ShareTextSheet,
  useToast,
  type Tone,
} from '../../shared/ui';
import { computeProbe, envProbe } from './device';
import {
  PROBE_TITLES,
  SPEECH_PHRASE,
  STATUS_WORD,
  probeNumber,
  probeReport,
  type ProbeId,
  type ProbeResult,
  type ProbeStatus,
} from './lib';
import './probe.css';
import { useCameraProbe } from './useCameraProbe';
import { RECORD_SECONDS, useMicProbe } from './useMicProbe';
import { usePhotoProbe, type PhotoAnswer } from './usePhotoProbe';
import { useSpeechProbe } from './useSpeechProbe';

const BACK = { fallback: paths.home } as const;

const STATUS_TONE: Readonly<Record<ProbeStatus, Tone>> = {
  idle: 'neutral',
  running: 'accent',
  ok: 'positive',
  no: 'critical',
  error: 'critical',
};

const PHOTO_ANSWERS: readonly { value: PhotoAnswer; label: string }[] = [
  { value: 'camera', label: 'Камера' },
  { value: 'gallery', label: 'Галерея' },
  { value: 'nothing', label: 'Ничего' },
];

const COPIED = 'Отчёт скопирован — вставь его в чат';

interface ProbeItemProps {
  id: ProbeId;
  result: ProbeResult;
  description: ReactNode;
  /** Превью, полоса уровня, распознанный текст — между описанием и кнопками. */
  media?: ReactNode;
  /** Кнопки запуска. */
  actions: ReactNode;
}

/** Пункт проверки: «01 КАМЕРА [ OK ]», что проверяем, кнопки, причина или ошибка и факты строками. */
function ProbeItem({ id, result, description, media, actions }: ProbeItemProps) {
  const titleId = `probe-${id}`;
  return (
    <section className="pr-item" aria-labelledby={titleId}>
      <div className="pr-item__head">
        <span className="m-mono pr-item__num" aria-hidden="true">
          {probeNumber(id)}
        </span>
        <h2 id={titleId} className="m-h3 pr-item__title">
          {PROBE_TITLES[id]}
        </h2>
        <span className="pr-item__status" aria-live="polite">
          <Badge tone={STATUS_TONE[result.status]}>{STATUS_WORD[result.status]}</Badge>
        </span>
      </div>
      <p className="m-small pr-item__desc">{description}</p>
      {media}
      <div className="pr-item__actions">{actions}</div>
      {result.note && (
        <p className={result.status === 'error' ? 'pr-item__note is-error' : 'pr-item__note'}>
          {result.note}
        </p>
      )}
      {result.facts.length > 0 && (
        <dl className="pr-facts">
          {result.facts.map((f, i) => (
            <div key={`${f.label}-${i}`} className="pr-facts__row">
              <dt className="pr-facts__label">{f.label}</dt>
              <dd className="m-mono pr-facts__value">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export default function ProbePage() {
  const { player } = useAuth();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const camera = useCameraProbe(videoRef);
  const photo = usePhotoProbe(fileRef);
  const mic = useMicProbe(audioRef);
  const speech = useSpeechProbe();
  const [compute, setCompute] = useState<ProbeResult>({ status: 'idle', facts: [] });
  const [env, setEnv] = useState<ProbeResult>(envProbe);
  const [shareText, setShareText] = useState<string | null>(null);

  const runCompute = useCallback(async () => {
    setCompute({ status: 'running', facts: [] });
    try {
      setCompute(await computeProbe());
    } catch (error) {
      setCompute({ status: 'error', note: String(error), facts: [] });
    }
  }, []);

  const copyReport = async () => {
    const text = probeReport({
      nowMs: Date.now(),
      who: player?.display_name ?? null,
      results: {
        camera: camera.result,
        photo: photo.result,
        mic: mic.result,
        speech: speech.result,
        compute,
        env,
      },
    });
    if (await copyText(text)) toast.show(COPIED, { tone: 'positive' });
    else setShareText(text);
  };

  return (
    <Page
      back={BACK}
      title="Проверка устройства"
      subtitle="Что из камеры, микрофона и распознавания работает на этом телефоне. Разрешения спрашиваются только по нажатию. Приложение ничего не отправляет, а распознавание речи браузер или телефон может делать на своём сервере."
    >
      <div className="pr-list">
        <ProbeItem
          id="camera"
          result={camera.result}
          description="Задняя камера: превью, разрешение и яркость кадра через 1,5 с. Чёрный кадр — пустой поток, так бывает на iPhone."
          media={
            <video
              ref={videoRef}
              className="pr-preview"
              hidden={!camera.live}
              muted
              playsInline
              aria-label="Превью камеры"
            />
          }
          actions={
            camera.live ? (
              <Button icon="x" onClick={camera.stop}>
                Выключить камеру
              </Button>
            ) : (
              <Button icon="camera" onClick={camera.start}>
                Включить камеру
              </Button>
            )
          }
        />

        <ProbeItem
          id="photo"
          result={photo.result}
          description="Кнопка просит у телефона камеру для снимка. Отметь, что открылось, — размер и разрешение файла появятся ниже."
          media={
            <>
              <input
                ref={fileRef}
                className="pr-file"
                type="file"
                accept="image/*"
                capture="environment"
                tabIndex={-1}
                aria-hidden="true"
                onChange={photo.onChange}
              />
              {photo.previewUrl && (
                <img className="pr-preview" src={photo.previewUrl} alt="Снимок для проверки" />
              )}
            </>
          }
          actions={
            <>
              <Button icon="camera" onClick={photo.open}>
                {photo.asked ? 'Сделать фото ещё раз' : 'Сделать фото'}
              </Button>
              {photo.asked && (
                <div className="pr-question">
                  <p className="m-small">Что открылось?</p>
                  <Segmented<PhotoAnswer | ''>
                    label="Что открылось после нажатия"
                    block
                    className="ui-seg--buttons"
                    value={photo.answer ?? ''}
                    options={PHOTO_ANSWERS}
                    onChange={(answer) => answer && photo.setAnswer(answer)}
                  />
                </div>
              )}
            </>
          }
        />

        <ProbeItem
          id="mic"
          result={mic.result}
          description={`Скажи что-нибудь — полоса уровня должна двигаться. Затем запиши ${RECORD_SECONDS} секунды и прослушай.`}
          media={
            <>
              {mic.live && (
                <Progress
                  className="pr-level"
                  label="Уровень"
                  value={Math.round(mic.level * 100)}
                  max={100}
                  showValue
                  valueText={`${Math.round(mic.level * 100)}${NBSP}%`}
                />
              )}
              <audio
                ref={audioRef}
                src={mic.recordingUrl ?? undefined}
                preload="auto"
                onEnded={mic.onEnded}
                onError={mic.onError}
              />
            </>
          }
          actions={
            <>
              {mic.live ? (
                <Button icon="x" onClick={mic.stop}>
                  Выключить микрофон
                </Button>
              ) : (
                <Button icon="mic" onClick={mic.start}>
                  Включить микрофон
                </Button>
              )}
              {mic.live && (
                <Button disabled={mic.recording || !mic.canRecord} onClick={mic.record}>
                  {mic.recording
                    ? `Идёт запись: ${mic.recordLeft} с`
                    : `Записать ${RECORD_SECONDS} секунды`}
                </Button>
              )}
              {mic.recordingUrl && (
                <Button icon="volume-2" disabled={mic.playing} onClick={mic.play}>
                  {mic.playing ? 'Играет запись' : 'Прослушать запись'}
                </Button>
              )}
            </>
          }
        />

        <ProbeItem
          id="speech"
          result={speech.result}
          description={`Скажи: «${SPEECH_PHRASE}». Распознаёт браузер или система телефона и может делать это на своём сервере (у Chrome — Google, у iPhone — Apple) — тогда звук уходит туда. Приложение звук не сохраняет и никуда не отправляет.`}
          media={
            speech.listening || speech.heard ? (
              <p className="m-mono pr-heard" aria-live="polite">
                {speech.heard ? `> ${speech.heard}` : '> слушаю'}
              </p>
            ) : null
          }
          actions={
            speech.listening ? (
              <Button icon="x" onClick={speech.stop}>
                Остановить распознавание
              </Button>
            ) : (
              <Button icon="mic" disabled={!speech.supported} onClick={speech.start}>
                Распознать фразу
              </Button>
            )
          }
        />

        <ProbeItem
          id="compute"
          result={compute}
          description="Хватит ли телефона на модель прямо в приложении: WebGPU, WebAssembly SIMD, потоки и память."
          actions={
            <Button
              icon="zap"
              loading={compute.status === 'running'}
              onClick={() => void runCompute()}
            >
              Проверить вычисления
            </Button>
          }
        />

        <ProbeItem
          id="env"
          result={env}
          description="Платформа и версия Telegram, браузер, размер экрана."
          actions={
            <Button icon="refresh-cw" onClick={() => setEnv(envProbe())}>
              Обновить данные
            </Button>
          }
        />
      </div>

      <Section footer="Фото и звук в отчёт не попадают — только результаты проверок. Отправь его в чат клуба.">
        <Button variant="primary" block icon="copy" onClick={() => void copyReport()}>
          Скопировать отчёт
        </Button>
      </Section>

      <ShareTextSheet
        text={shareText}
        onClose={() => setShareText(null)}
        title="Отчёт для чата"
        copiedMessage={COPIED}
      />
    </Page>
  );
}
