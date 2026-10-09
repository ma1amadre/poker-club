// «Проверка устройства» (#/probe) — чистая часть: статусы проверок, текст отчёта для чата, яркость
// кадра, разбор mimeType, тексты ошибок камеры, микрофона и распознавания. Без React и DOM — тесты
// в node (lib.test.ts). Приложение ничего не отправляет на свой сервер: отчёт копирует и пересылает сам
// игрок (распознавание речи браузер или телефон может делать на своём сервере — см. useSpeechProbe).

import { NBSP, formatDateNumeric, formatTime } from '../../shared/lib/format';

export type ProbeId = 'camera' | 'photo' | 'mic' | 'speech' | 'compute' | 'env';

/** Порядок на экране и в отчёте; номер пункта — позиция + 1. */
export const PROBE_ORDER: readonly ProbeId[] = [
  'camera',
  'photo',
  'mic',
  'speech',
  'compute',
  'env',
];

export const PROBE_TITLES: Readonly<Record<ProbeId, string>> = {
  camera: 'Камера',
  photo: 'Фото',
  mic: 'Микрофон',
  speech: 'Распознавание речи',
  compute: 'Вычисления',
  env: 'Окружение',
};

/**
 * idle — не запускали; running — идёт (или ждёт ответа игрока); ok — работает; no — нет в этом окне
 * (API нет, ничего не открылось); error — API есть, но отказал (исключение, чёрный кадр).
 */
export type ProbeStatus = 'idle' | 'running' | 'ok' | 'no' | 'error';

export interface ProbeFact {
  label: string;
  value: string;
}

export interface ProbeResult {
  status: ProbeStatus;
  /** Причина «НЕТ» или текст ошибки. */
  note?: string;
  facts: readonly ProbeFact[];
}

export const IDLE: ProbeResult = { status: 'idle', facts: [] };

export const fact = (label: string, value: string): ProbeFact => ({ label, value });

/** Номер пункта двумя знаками, как номер места: «01». */
export const probeNumber = (id: ProbeId): string =>
  String(PROBE_ORDER.indexOf(id) + 1).padStart(2, '0');

/** Слово метки на экране (скобки рисует CSS у Badge): «OK», «Нет», «Ошибка». */
export const STATUS_WORD: Readonly<Record<ProbeStatus, string>> = {
  idle: 'Не проверено',
  running: 'Идёт',
  ok: 'OK',
  no: 'Нет',
  error: 'Ошибка',
};

/** Метка статуса в отчёте: «[ OK ]», «[ НЕТ ]», «[ ОШИБКА: текст ]». */
export function statusTag(result: ProbeResult): string {
  const word = STATUS_WORD[result.status].toUpperCase();
  const text = result.status === 'error' && result.note ? `${word}: ${result.note}` : word;
  return `[ ${text} ]`;
}

export interface ReportInput {
  nowMs: number;
  /** Имя игрока — чтобы отчёты разных телефонов в чате не путались. */
  who: string | null;
  results: Readonly<Record<ProbeId, ProbeResult>>;
}

/**
 * Текст отчёта для чата: шапка, затем пункт за пунктом — «01 Камера [ OK ]» и факты строками с отступом.
 * Причина «НЕТ» — первой строкой пункта (у ошибки текст уже в метке). Фото и звука в отчёте нет — только
 * их размеры и форматы.
 */
export function probeReport({ nowMs, who, results }: ReportInput): string {
  const head = [
    'Проверка устройства',
    `${formatDateNumeric(nowMs)}, ${formatTime(nowMs)} (Мск)`,
    ...(who ? [who] : []),
  ].join(' · ');
  const blocks = PROBE_ORDER.map((id) => {
    const result = results[id];
    const lines = [`${probeNumber(id)} ${PROBE_TITLES[id]} ${statusTag(result)}`];
    if (result.status === 'no' && result.note) lines.push(`   ${result.note}`);
    for (const f of result.facts) lines.push(`   ${f.label}: ${f.value}`);
    return lines.join('\n');
  });
  return [head, ...blocks].join('\n\n');
}

// ---------- Яркость кадра ----------

export interface FrameStats {
  /** Средняя яркость 0–255 (BT.601); прозрачный пиксель — чёрный. */
  mean: number;
  /** Стандартное отклонение яркости: около 0 — кадр одного цвета (пустой или замёрзший поток). */
  spread: number;
}

/** Кадр темнее этого — «чёрный»: так выглядит пустой поток камеры в WebView iOS. */
export const DARK_FRAME_MAX = 8;
/** Разброс меньше этого — кадр однотонный: живая камера даёт шум даже на ровной стене. */
export const FLAT_FRAME_MAX_SPREAD = 1.5;

/** Яркость и разброс по RGBA-пикселям (ImageData.data); пустой массив — null. */
export function frameStats(rgba: ArrayLike<number>): FrameStats | null {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return null;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const alpha = (rgba[i + 3] ?? 0) / 255;
    const luma =
      (0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0)) * alpha;
    sum += luma;
    sumSq += luma * luma;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean: Math.round(mean), spread: Math.round(Math.sqrt(variance) * 10) / 10 };
}

export type FrameVerdict = 'ok' | 'dark' | 'flat';

export function frameVerdict(stats: FrameStats): FrameVerdict {
  if (stats.mean <= DARK_FRAME_MAX) return 'dark';
  if (stats.spread < FLAT_FRAME_MAX_SPREAD) return 'flat';
  return 'ok';
}

/** «112 из 255, разброс 38,5». */
export function frameStatsText(stats: FrameStats): string {
  return `${stats.mean} из 255, разброс ${formatDecimal(stats.spread)}`;
}

// ---------- MediaRecorder: mimeType ----------

/** Что спрашиваем у MediaRecorder.isTypeSupported — по порядку предпочтения записи. */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/aac',
] as const;

export interface MimeInfo {
  /** «audio» */
  type: string;
  /** «webm» */
  subtype: string;
  /** «opus», «mp4a.40.2» — без кавычек; нет параметра — пусто. */
  codecs: string[];
}

/**
 * Разбор mimeType: «audio/webm;codecs=opus», «audio/mp4; codecs="mp4a.40.2"», «audio/webm;codecs="opus,vp8"».
 * Регистр типа не важен; не тип/подтип — null.
 */
export function parseMime(mime: string): MimeInfo | null {
  const [essence = '', ...params] = mime.split(';');
  const match = /^\s*([a-z0-9!#$&^_.+-]+)\/([a-z0-9!#$&^_.+-]+)\s*$/i.exec(essence);
  if (!match) return null;
  const codecs: string[] = [];
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq < 0 || param.slice(0, eq).trim().toLowerCase() !== 'codecs') continue;
    const value = param
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    for (const codec of value.split(',')) if (codec.trim()) codecs.push(codec.trim());
  }
  return { type: match[1]!.toLowerCase(), subtype: match[2]!.toLowerCase(), codecs };
}

/** Коротко для отчёта: «webm · opus», «mp4 · mp4a.40.2», «aac»; не разобрать — как есть. */
export function mimeLabel(mime: string): string {
  const info = parseMime(mime);
  if (!info) return mime || 'не сообщается';
  return [info.subtype, ...info.codecs].join(' · ');
}

export interface MimeSupport {
  mime: string;
  supported: boolean;
}

/** Опросить isTypeSupported по списку; исключение (старый WebView) — «нет». */
export function recorderSupport(
  candidates: readonly string[],
  isTypeSupported: (mime: string) => boolean,
): MimeSupport[] {
  return candidates.map((mime) => {
    try {
      return { mime, supported: isTypeSupported(mime) };
    } catch {
      return { mime, supported: false };
    }
  });
}

/**
 * Факты пункта «Микрофон» о записи: есть ли MediaRecorder, какие mimeType он понимает и какие нет —
 * списками: в две строки, а не строкой на каждый формат.
 */
export function recorderSupportFacts(support: readonly MimeSupport[] | null): ProbeFact[] {
  if (!support) return [fact('MediaRecorder', 'нет')];
  const yes = support.filter((s) => s.supported).map((s) => s.mime);
  const no = support.filter((s) => !s.supported).map((s) => s.mime);
  return [
    fact('MediaRecorder', 'есть'),
    fact('Пишет в', yes.length > 0 ? yes.join(', ') : 'ни в один из проверенных'),
    ...(no.length > 0 ? [fact('Не пишет в', no.join(', '))] : []),
  ];
}

/** Чем писать: первый поддержанный; null — пусть MediaRecorder выберет сам. */
export function pickRecorderMime(support: readonly MimeSupport[]): string | null {
  return support.find((s) => s.supported)?.mime ?? null;
}

// ---------- Уровень микрофона ----------

/** Нижняя граница шкалы уровня, дБ полной шкалы: тише — ноль на полосе. */
export const LEVEL_FLOOR_DB = -60;

/** RMS отсчётов (−1…1) → доля шкалы 0–1 по децибелам: −60 дБ и тише — 0, 0 дБ — 1. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB));
}

/**
 * Пик уровня, с которого микрофон «слышит»: 0,1 шкалы — около −54 дБ полной шкалы, тише обычной
 * речи у телефона. Немой трек (микрофон занят звонком или другим приложением) даёт ровно 0.
 * Порог выбран по шкале, на телефонах клуба не замерялся.
 */
export const MIC_SIGNAL_MIN = 0.1;
/** Сколько ждать звука после включения микрофона, прежде чем сказать «звука нет». */
export const MIC_SILENCE_MS = 5000;

export interface MicStatusInput {
  mic: 'idle' | 'pending' | 'live' | 'off' | 'no' | 'error';
  micNote?: string;
  /** Пик уровня 0–1 с включения; null — уровень не измерить (нет AudioContext или анализатора). */
  peak: number | null;
  /** С включения прошло MIC_SILENCE_MS. */
  waited: boolean;
  /** Есть MediaRecorder. */
  recorder: boolean;
  rec: 'idle' | 'recording' | 'done' | 'error';
  recNote?: string;
  playback: 'idle' | 'playing' | 'done' | 'error';
  playbackNote?: string;
}

/**
 * Метка пункта «Микрофон». OK — только когда звук есть: пик уровня не ниже MIC_SIGNAL_MIN (без
 * измерителя уровня — получилась запись) и есть чем записать. Поток без звука дольше
 * MIC_SILENCE_MS — ошибка; пока ждём звук — «идёт»; выключили до замера — «не проверено». Звук есть,
 * а MediaRecorder нет — «нет» с причиной.
 */
export function micStatus(i: MicStatusInput): Pick<ProbeResult, 'status' | 'note'> {
  if (i.mic === 'no' || i.mic === 'error') return { status: i.mic, note: i.micNote };
  if (i.mic === 'idle') return { status: 'idle' };
  if (i.mic === 'pending' || i.rec === 'recording' || i.playback === 'playing')
    return { status: 'running' };
  if (i.rec === 'error') return { status: 'error', note: `запись — ${i.recNote ?? 'ошибка'}` };
  if (i.playback === 'error')
    return { status: 'error', note: `воспроизведение — ${i.playbackNote ?? 'ошибка'}` };
  const heard = i.peak !== null ? i.peak >= MIC_SIGNAL_MIN : i.rec === 'done';
  if (!heard) {
    if (i.peak === null && !i.recorder)
      return { status: 'no', note: 'Звук проверить нечем: нет ни AudioContext, ни MediaRecorder' };
    if (i.peak !== null && i.waited) {
      const percent = Math.round(i.peak * 100);
      const pct = `${percent}${NBSP}%`;
      return {
        status: 'error',
        note:
          percent > 0
            ? `звук слишком тихий — пик ${pct}: скажи громче или поднеси телефон ближе`
            : `звука нет — пик ${pct}: микрофон занят другим приложением, выключен или поток пустой`,
      };
    }
    if (i.mic === 'off') return { status: 'idle' };
    return {
      status: 'running',
      note:
        i.peak !== null
          ? 'Ждём звук — скажи что-нибудь.'
          : 'Уровень здесь не измерить — запиши и прослушай.',
    };
  }
  if (!i.recorder)
    return { status: 'no', note: 'Микрофон работает, но записать нечем: MediaRecorder нет' };
  return { status: 'ok' };
}

/** RMS массива отсчётов (getFloatTimeDomainData). */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / samples.length);
}

/** RMS байтовых отсчётов (getByteTimeDomainData: 128 — тишина) в шкале −1…1. */
export function rmsOfBytes(bytes: ArrayLike<number>): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += (((bytes[i] ?? 128) - 128) / 128) ** 2;
  return Math.sqrt(sum / bytes.length);
}

// ---------- Ошибки ----------

const MEDIA_ERRORS: Readonly<Record<string, string>> = {
  NotAllowedError: 'доступ запрещён',
  PermissionDeniedError: 'доступ запрещён',
  SecurityError: 'запрещено настройками безопасности окна',
  NotFoundError: 'устройство не найдено',
  DevicesNotFoundError: 'устройство не найдено',
  NotReadableError: 'устройство занято или не отвечает',
  TrackStartError: 'устройство занято или не отвечает',
  OverconstrainedError: 'нет устройства с такими настройками',
  AbortError: 'запуск прерван',
  NotSupportedError: 'формат не поддерживается',
  InvalidStateError: 'неверное состояние',
  TypeError: 'вызов не поддерживается',
};

/**
 * Ошибка медиа для экрана и отчёта: имя исключения как есть (по нему ищут причину) и перевод —
 * «NotAllowedError — доступ запрещён». Неизвестное имя — с сообщением браузера.
 */
export function mediaErrorText(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name: unknown }).name);
    const message = 'message' in error ? String((error as { message: unknown }).message) : '';
    const known = MEDIA_ERRORS[name];
    if (known) return `${name} — ${known}`;
    return message ? `${name}: ${message}` : name;
  }
  return String(error);
}

const MEDIA_ELEMENT_ERRORS: Readonly<Record<number, string>> = {
  1: 'MEDIA_ERR_ABORTED — загрузка прервана',
  2: 'MEDIA_ERR_NETWORK — ошибка чтения',
  3: 'MEDIA_ERR_DECODE — не декодируется',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED — формат не поддерживается',
};

/** Ошибка <audio>/<video> по коду MediaError. */
export function mediaElementErrorText(code: number | undefined): string {
  return (code !== undefined && MEDIA_ELEMENT_ERRORS[code]) || 'MediaError без кода';
}

/** Длительность записи: «3,1 с»; Infinity и NaN (webm из MediaRecorder в Chrome) — «не сообщается». */
export function durationText(seconds: number): string {
  return Number.isFinite(seconds) && seconds > 0
    ? `${formatDecimal(Math.round(seconds * 10) / 10)}${NBSP}с`
    : 'не сообщается';
}

const SPEECH_ERRORS: Readonly<Record<string, string>> = {
  'not-allowed': 'нет доступа к микрофону или распознаванию',
  'service-not-allowed': 'распознавание запрещено в этом окне',
  network: 'нет связи с сервисом распознавания',
  'no-speech': 'речь не услышана',
  'audio-capture': 'микрофон не найден',
  'language-not-supported': 'русский язык не поддерживается',
  aborted: 'распознавание прервано',
  'bad-grammar': 'ошибка грамматики распознавания',
};

/** Код ошибки SpeechRecognition → «not-allowed — нет доступа к микрофону…». */
export function speechErrorText(code: string): string {
  const known = SPEECH_ERRORS[code];
  return known ? `${code} — ${known}` : code || 'неизвестная ошибка';
}

// ---------- Распознавание: насколько совпало ----------

/** Фраза для проверки распознавания. */
export const SPEECH_PHRASE = 'туз пик, король червей';

/** Слова без регистра, знаков и «ё»: «Туз пик, король червей!» → [туз, пик, король, червей]. */
export function phraseWords(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter(Boolean);
}

/** Сколько слов фразы нашлось в распознанном тексте (каждое слово — один раз). */
export function phraseMatch(expected: string, heard: string): { matched: number; total: number } {
  const want = phraseWords(expected);
  const got = phraseWords(heard);
  let matched = 0;
  for (const word of want) {
    const at = got.indexOf(word);
    if (at >= 0) {
      matched++;
      got.splice(at, 1);
    }
  }
  return { matched, total: want.length };
}

// ---------- Числа ----------

const decimalFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const formatDecimal = (value: number): string => decimalFormatter.format(value);

/** Размер файла: «850 Б», «48 КБ», «2,4 МБ» (1 КБ = 1024 Б). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))}${NBSP}Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}${NBSP}КБ`;
  return `${formatDecimal(bytes / (1024 * 1024))}${NBSP}МБ`;
}

/** Возраст файла: свежий снимок с камеры — секунды, фото из галереи — обычно часы и дни. */
export function fileAgeText(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 120) return `${seconds}${NBSP}с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}${NBSP}мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}${NBSP}ч`;
  return `${Math.round(hours / 24)}${NBSP}дн`;
}

/** «1280×720». */
export const sizeText = (width: number, height: number): string => `${width}×${height}`;

export const yesNo = (value: boolean): string => (value ? 'да' : 'нет');

// ---------- WebAssembly ----------

/** Пустой модуль: заголовок и версия — его принимает любой WebAssembly. */
export const WASM_BASE = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);

/**
 * Модуль с одной функцией () → v128: `i32.const 0; i32x4.splat; end`. Валиден, только если движок
 * знает SIMD (тип v128 и префикс 0xfd).
 */
export const WASM_SIMD = Uint8Array.of(
  ...WASM_BASE,
  // типы: 1 тип — func () → (v128)
  0x01,
  0x05,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7b,
  // функции: 1 функция типа 0
  0x03,
  0x02,
  0x01,
  0x00,
  // код: 1 тело в 6 байт — без локальных, i32.const 0, i32x4.splat, end
  0x0a,
  0x08,
  0x01,
  0x06,
  0x00,
  0x41,
  0x00,
  0xfd,
  0x11,
  0x0b,
);
