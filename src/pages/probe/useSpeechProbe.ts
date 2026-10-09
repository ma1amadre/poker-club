// Пункт «Распознавание речи»: есть ли SpeechRecognition / webkitSpeechRecognition (видно сразу, без
// разрешения) и попытка распознать фразу на ru-RU. Распознаёт браузер или система телефона, по
// умолчанию (без processLocally) — возможно, на своём сервере (Chrome — Google, Safari и WKWebView —
// Apple): тогда звук уходит туда, экран об этом предупреждает. Приложение звук не пишет и никуда не
// отправляет. Уход со страницы прерывает распознавание.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speechApis, type SpeechRecognitionCtor, type SpeechRecognitionLike } from './device';
import {
  SPEECH_PHRASE,
  fact,
  mediaErrorText,
  phraseMatch,
  speechErrorText,
  type ProbeFact,
  type ProbeResult,
} from './lib';

/** Распознавание само заканчивается после паузы; если нет — останавливаем через столько. */
const LISTEN_LIMIT_MS = 12_000;

const AVAILABILITY_TEXT: Readonly<Record<string, string>> = {
  available: 'есть',
  downloadable: 'можно скачать',
  downloading: 'скачивается',
  unavailable: 'нет',
};

/** Распознавание на самом устройстве (Chrome 139+, SpeechRecognition.available) — без сервера. */
async function localAvailability(Ctor: SpeechRecognitionCtor): Promise<ProbeFact | null> {
  if (typeof Ctor.available !== 'function') return null;
  try {
    const status = await Ctor.available({ langs: ['ru-RU'], processLocally: true });
    return fact('На устройстве (ru-RU)', AVAILABILITY_TEXT[status] ?? status);
  } catch (error) {
    return fact('На устройстве (ru-RU)', `ошибка — ${mediaErrorText(error)}`);
  }
}

const quote = (text: string): string => `«${text.trim()}»`;

export interface SpeechProbe {
  result: ProbeResult;
  supported: boolean;
  listening: boolean;
  /** Что слышно прямо сейчас (промежуточный текст). */
  heard: string;
  start: () => void;
  stop: () => void;
}

export function useSpeechProbe(): SpeechProbe {
  const apis = useMemo(() => speechApis(), []);
  const Ctor = apis.standard ?? apis.webkit;
  const apiFacts = useMemo(() => {
    const names = [apis.standard && 'SpeechRecognition', apis.webkit && 'webkitSpeechRecognition'];
    const found = names.filter((name): name is string => Boolean(name));
    return [fact('Интерфейс', found.length > 0 ? found.join(', ') : 'нет')];
  }, [apis]);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const timer = useRef(0);
  const run = useRef(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [result, setResult] = useState<ProbeResult>(() =>
    Ctor
      ? { status: 'idle', facts: apiFacts }
      : { status: 'no', note: 'Распознавания речи в этом окне нет', facts: apiFacts },
  );

  const release = useCallback(() => {
    run.current += 1;
    window.clearTimeout(timer.current);
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        // уже остановлено
      }
    }
  }, []);

  const start = useCallback(async () => {
    release();
    setListening(false);
    setHeard('');
    if (!Ctor) return;
    const id = run.current;
    const extra: ProbeFact[] = [];
    const local = await localAvailability(Ctor);
    if (id !== run.current) return;
    if (local) extra.push(local);

    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 3;
    } catch (error) {
      setResult({ status: 'error', note: mediaErrorText(error), facts: [...apiFacts, ...extra] });
      return;
    }

    let finalText = '';
    let interim = '';
    let confidence = 0;
    let alternatives: string[] = [];
    let errorCode: string | null = null;

    rec.onstart = () => {
      if (id === run.current) setListening(true);
    };
    rec.onresult = (event) => {
      if (id !== run.current) return;
      interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const best = r?.[0];
        if (!r || !best) continue;
        if (r.isFinal) {
          finalText = `${finalText} ${best.transcript}`.trim();
          confidence = best.confidence;
          alternatives = [];
          for (let k = 1; k < r.length; k++) {
            const alt = r[k]?.transcript.trim();
            if (alt) alternatives.push(alt);
          }
        } else {
          interim = `${interim} ${best.transcript}`.trim();
        }
      }
      setHeard(finalText || interim);
    };
    rec.onerror = (event) => {
      if (id === run.current) errorCode = event.error || 'unknown';
    };
    rec.onend = () => {
      if (id !== run.current) return;
      window.clearTimeout(timer.current);
      recRef.current = null;
      setListening(false);
      const facts = [...apiFacts, ...extra];
      const text = finalText || interim;
      if (!text) {
        setResult({
          status: 'error',
          note: errorCode ? speechErrorText(errorCode) : 'ничего не распознано',
          facts,
        });
        return;
      }
      const match = phraseMatch(SPEECH_PHRASE, text);
      facts.push(fact('Распознано', quote(text)));
      if (!finalText) facts.push(fact('Итог', 'только промежуточный текст'));
      facts.push(fact('Слова фразы', `${match.matched} из ${match.total}`));
      if (confidence > 0) facts.push(fact('Уверенность', confidence.toFixed(2).replace('.', ',')));
      if (alternatives.length > 0) facts.push(fact('Варианты', alternatives.map(quote).join(', ')));
      if (errorCode) facts.push(fact('Ошибка после распознавания', speechErrorText(errorCode)));
      setResult({ status: 'ok', facts });
    };

    recRef.current = rec;
    setResult({ status: 'running', facts: [...apiFacts, ...extra] });
    try {
      rec.start();
    } catch (error) {
      recRef.current = null;
      setResult({ status: 'error', note: mediaErrorText(error), facts: [...apiFacts, ...extra] });
      return;
    }
    timer.current = window.setTimeout(() => {
      if (id !== run.current) return;
      try {
        rec.stop();
      } catch {
        // уже остановлено
      }
    }, LISTEN_LIMIT_MS);
  }, [Ctor, apiFacts, release]);

  /** «Остановить» — дослушать: stop() отдаёт то, что уже услышано, и вызывает onend. */
  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      // уже остановлено
    }
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [release]);

  return {
    result,
    supported: Boolean(Ctor),
    listening,
    heard,
    start: () => void start(),
    stop,
  };
}
