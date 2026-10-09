// Голосовой ввод карт олл-ина: одна фраза через распознавание речи телефона (SpeechRecognition или
// webkitSpeechRecognition, `lang` ru-RU, промежуточный текст, до 5 вариантов). Распознаёт браузер или
// система телефона — на iPhone, вероятно, через Apple, на своём сервере; приложение звук не пишет,
// не хранит и никуда не отправляет — получает только текст. Разбор текста в карты — voiceCards.ts.
//
// Слушаем до паузы (continuous = false — так распознавание проверено на iPhone в «Проверке
// устройства»), но не дольше LISTEN_LIMIT_MS; «Остановить» дослушивает: stop() отдаёт услышанное.
// Шторка закрылась (размонтирование), страница ушла (pagehide) — распознавание прерывается без
// результата; свернули Telegram (visibilitychange) — прерывается с ошибкой «aborted».
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  safeLocalStorage,
  speechRecognitionCtor,
  type SpeechRecognitionLike,
} from '../../shared/lib';
import { readVoiceReady, speechTexts, writeVoiceReady } from './voiceCards';

/** Распознавание само заканчивается после паузы; если нет — останавливаем через столько. */
export const LISTEN_LIMIT_MS = 15_000;
/** После «Остановить» ждём конца распознавания не дольше этого, дальше — с тем, что услышано. */
const STOP_GRACE_MS = 3_000;

export type VoiceEnd =
  /** Услышан текст: варианты фразы (первый — самый уверенный); final — был итоговый результат. */
  | { kind: 'heard'; texts: string[]; final: boolean }
  /** Распознавание кончилось без текста и без ошибки. */
  | { kind: 'silence' }
  /** Код ошибки SpeechRecognition ('not-allowed', 'no-speech', 'network', 'aborted'…) или 'start-failed'. */
  | { kind: 'error'; code: string };

export interface VoiceCapture {
  /** Есть ли распознавание речи в этом окне (без разрешения, сразу). */
  supported: boolean;
  /** Слушает (с нажатия до конца распознавания). */
  listening: boolean;
  /** Что слышно прямо сейчас (промежуточный текст). */
  heard: string;
  /** Распознавание уже запускалось на этом устройстве — системный вопрос о доступе позади. */
  ready: boolean;
  start: (onEnd: (end: VoiceEnd) => void) => void;
  /** Дослушать: распознавание отдаст то, что услышано, и вызовет onEnd. */
  stop: () => void;
}

export function useVoiceCapture(): VoiceCapture {
  const [Ctor] = useState(speechRecognitionCtor);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [ready, setReady] = useState(() => readVoiceReady(safeLocalStorage()));
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const endRef = useRef<((end: VoiceEnd) => void) | null>(null);
  /** Завершить текущее распознавание с тем, что уже есть (после «Остановить» и по тайм-ауту). */
  const settleRef = useRef<(() => void) | null>(null);
  const timer = useRef(0);

  /** Забыть распознавание: обработчики сняты; abort — ещё и прервать (если оно не кончилось само). */
  const release = useCallback((abort = true) => {
    window.clearTimeout(timer.current);
    const rec = recRef.current;
    recRef.current = null;
    endRef.current = null;
    settleRef.current = null;
    if (!rec) return;
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    if (!abort) return;
    try {
      rec.abort();
    } catch {
      // уже остановлено
    }
  }, []);

  const finish = useCallback(
    (end: VoiceEnd, abort = true) => {
      const onEnd = endRef.current;
      release(abort);
      setListening(false);
      setHeard('');
      onEnd?.(end);
    },
    [release],
  );

  const start = useCallback(
    (onEnd: (end: VoiceEnd) => void) => {
      release();
      if (!Ctor) return;
      let rec: SpeechRecognitionLike;
      try {
        rec = new Ctor();
        rec.lang = 'ru-RU';
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 5;
      } catch {
        onEnd({ kind: 'error', code: 'start-failed' });
        return;
      }

      // Куски фразы (results) и варианты каждого — по номеру результата: промежуточные
      // перезаписываются итоговыми.
      const segments: string[][] = [];
      let final = false;
      let errorCode: string | null = null;
      // ended — распознавание кончилось само (onend); иначе не дождались конца — прерываем.
      const settle = (ended: boolean) => {
        const texts = speechTexts(segments);
        const abort = !ended;
        if (texts.length > 0) finish({ kind: 'heard', texts, final }, abort);
        else if (errorCode) finish({ kind: 'error', code: errorCode }, abort);
        else finish({ kind: 'silence' }, abort);
      };

      rec.onstart = () => {
        writeVoiceReady(safeLocalStorage());
        setReady(true);
      };
      rec.onresult = (event) => {
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          const alternatives: string[] = [];
          for (let k = 0; k < result.length; k += 1) {
            const text = result[k]?.transcript.trim();
            if (text) alternatives.push(text);
          }
          segments[i] = alternatives;
          if (result.isFinal) final = true;
        }
        setHeard(
          segments
            .map((s) => s[0] ?? '')
            .join(' ')
            .trim(),
        );
      };
      rec.onerror = (event) => {
        errorCode = event.error || 'unknown';
      };
      rec.onend = () => settle(true);

      recRef.current = rec;
      endRef.current = onEnd;
      settleRef.current = () => settle(false);
      setHeard('');
      setListening(true);
      try {
        rec.start();
      } catch {
        finish({ kind: 'error', code: 'start-failed' });
        return;
      }
      timer.current = window.setTimeout(() => {
        if (recRef.current !== rec) return;
        try {
          rec.stop();
        } catch {
          // уже остановлено
        }
        timer.current = window.setTimeout(() => {
          if (recRef.current === rec) settle(false);
        }, STOP_GRACE_MS);
      }, LISTEN_LIMIT_MS);
    },
    [Ctor, finish, release],
  );

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // уже остановлено
    }
    // Если распознавание не закончится само (бывает в WebView), — с тем, что услышано.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (recRef.current === rec) settleRef.current?.();
    }, STOP_GRACE_MS);
  }, []);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && recRef.current)
        finish({ kind: 'error', code: 'aborted' });
    };
    const onPageHide = () => release();
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHidden);
      release();
    };
  }, [finish, release]);

  return { supported: Ctor !== null, listening, heard, ready, start, stop };
}
