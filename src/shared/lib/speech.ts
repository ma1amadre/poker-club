// Распознавание речи браузера (SpeechRecognition / webkitSpeechRecognition): в lib.dom его нет —
// здесь узкие типы того, чем пользуемся, и поиск конструктора. Распознаёт браузер или система
// телефона (Chrome — Google, Safari и WKWebView на iPhone — Apple), по умолчанию — возможно, на своём
// сервере; приложение звук не пишет и никуда не отправляет. Пользователи: «Проверка устройства»
// (pages/probe) и голосовой ввод карт в шторке олл-ина (pages/evening/useVoiceCards.ts).

export interface SpeechAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike;
}

export interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  /** Chrome 139+: доступно ли распознавание на самом устройстве (без сервера). */
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
}

export interface SpeechApis {
  standard: SpeechRecognitionCtor | null;
  webkit: SpeechRecognitionCtor | null;
}

export function speechApis(): SpeechApis {
  if (typeof window === 'undefined') return { standard: null, webkit: null };
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return { standard: w.SpeechRecognition ?? null, webkit: w.webkitSpeechRecognition ?? null };
}

/** Конструктор распознавания: стандартный, иначе webkit; нет ни того ни другого — null. */
export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const apis = speechApis();
  return apis.standard ?? apis.webkit;
}
