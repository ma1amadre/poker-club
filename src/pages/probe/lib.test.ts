import { describe, expect, it } from 'vitest';
import {
  IDLE,
  PROBE_ORDER,
  RECORDER_MIME_CANDIDATES,
  WASM_BASE,
  WASM_SIMD,
  fact,
  fileAgeText,
  formatBytes,
  frameStats,
  frameStatsText,
  frameVerdict,
  durationText,
  levelFromRms,
  MIC_SIGNAL_MIN,
  mediaElementErrorText,
  mediaErrorText,
  micStatus,
  mimeLabel,
  parseMime,
  phraseMatch,
  phraseWords,
  pickRecorderMime,
  probeReport,
  recorderSupport,
  recorderSupportFacts,
  rmsOf,
  rmsOfBytes,
  speechErrorText,
  statusTag,
  type ProbeId,
  type ProbeResult,
} from './lib';

/** RGBA-кадр из n одинаковых пикселей. */
const solid = (n: number, [r, g, b, a = 255]: number[]) =>
  Uint8ClampedArray.from({ length: n * 4 }, (_, i) => [r, g, b, a][i % 4] ?? 0);

describe('frameStats', () => {
  it('чёрный кадр — яркость 0 и разброс 0', () => {
    expect(frameStats(solid(16, [0, 0, 0]))).toEqual({ mean: 0, spread: 0 });
  });

  it('белый — 255, серый — по формуле BT.601', () => {
    expect(frameStats(solid(4, [255, 255, 255]))?.mean).toBe(255);
    // 0.299·200 + 0.587·100 + 0.114·50 = 124,2
    expect(frameStats(solid(4, [200, 100, 50]))?.mean).toBe(124);
  });

  it('прозрачный пиксель — чёрный: кадр не нарисовался', () => {
    expect(frameStats(solid(4, [255, 255, 255, 0]))?.mean).toBe(0);
  });

  it('разброс — стандартное отклонение яркости', () => {
    // половина чёрных, половина белых: среднее 127,5, отклонение 127,5
    const half = Uint8ClampedArray.of(0, 0, 0, 255, 255, 255, 255, 255);
    expect(frameStats(half)).toEqual({ mean: 128, spread: 127.5 });
  });

  it('пустые данные — null', () => {
    expect(frameStats([])).toBeNull();
    expect(frameStats([1, 2, 3])).toBeNull();
  });
});

describe('frameVerdict', () => {
  it('тёмный, однотонный и живой кадр', () => {
    expect(frameVerdict({ mean: 3, spread: 0.4 })).toBe('dark');
    expect(frameVerdict({ mean: 8, spread: 20 })).toBe('dark');
    expect(frameVerdict({ mean: 120, spread: 0 })).toBe('flat');
    expect(frameVerdict({ mean: 120, spread: 1.5 })).toBe('ok');
    expect(frameVerdict({ mean: 9, spread: 3 })).toBe('ok');
  });

  it('текст — с десятичной запятой', () => {
    expect(frameStatsText({ mean: 112, spread: 38.5 })).toBe('112 из 255, разброс 38,5');
  });
});

describe('parseMime / mimeLabel', () => {
  it('тип, подтип и кодеки', () => {
    expect(parseMime('audio/webm;codecs=opus')).toEqual({
      type: 'audio',
      subtype: 'webm',
      codecs: ['opus'],
    });
    expect(parseMime('audio/mp4; codecs="mp4a.40.2"')).toEqual({
      type: 'audio',
      subtype: 'mp4',
      codecs: ['mp4a.40.2'],
    });
    expect(parseMime('video/webm;codecs="vp8, opus"')?.codecs).toEqual(['vp8', 'opus']);
    expect(parseMime('Audio/AAC')).toEqual({ type: 'audio', subtype: 'aac', codecs: [] });
  });

  it('другие параметры не кодеки', () => {
    expect(parseMime('audio/webm;rate=48000;codecs=opus')?.codecs).toEqual(['opus']);
    expect(parseMime('audio/webm;codecs=')?.codecs).toEqual([]);
  });

  it('не тип/подтип — null', () => {
    expect(parseMime('')).toBeNull();
    expect(parseMime('webm')).toBeNull();
    expect(parseMime('audio/')).toBeNull();
  });

  it('подпись для отчёта', () => {
    expect(mimeLabel('audio/webm;codecs=opus')).toBe('webm · opus');
    expect(mimeLabel('audio/mp4; codecs=mp4a.40.2')).toBe('mp4 · mp4a.40.2');
    expect(mimeLabel('audio/aac')).toBe('aac');
    expect(mimeLabel('')).toBe('не сообщается');
    expect(mimeLabel('что-то')).toBe('что-то');
  });
});

describe('recorderSupport / pickRecorderMime', () => {
  it('опрашивает все варианты по порядку, выбирает первый поддержанный', () => {
    const iosLike = (mime: string) => mime === 'audio/mp4' || mime === 'audio/aac';
    const support = recorderSupport(RECORDER_MIME_CANDIDATES, iosLike);
    expect(support.map((s) => s.supported)).toEqual([false, false, true, true]);
    expect(pickRecorderMime(support)).toBe('audio/mp4');
  });

  it('факты: поддержанные и нет — двумя строками', () => {
    const support = recorderSupport(
      RECORDER_MIME_CANDIDATES,
      (m) => m.includes('webm') || m === 'audio/mp4',
    );
    expect(recorderSupportFacts(support)).toEqual([
      fact('MediaRecorder', 'есть'),
      fact('Пишет в', 'audio/webm;codecs=opus, audio/mp4'),
      fact('Не пишет в', 'audio/ogg;codecs=opus, audio/aac'),
    ]);
    expect(recorderSupportFacts(recorderSupport(['audio/mp4'], () => true))).toEqual([
      fact('MediaRecorder', 'есть'),
      fact('Пишет в', 'audio/mp4'),
    ]);
    expect(recorderSupportFacts(recorderSupport(['audio/mp4'], () => false))[1]).toEqual(
      fact('Пишет в', 'ни в один из проверенных'),
    );
    expect(recorderSupportFacts(null)).toEqual([fact('MediaRecorder', 'нет')]);
  });

  it('исключение — «нет», ничего не поддержано — null', () => {
    const support = recorderSupport(['audio/webm', 'audio/mp4'], () => {
      throw new Error('нет');
    });
    expect(support).toEqual([
      { mime: 'audio/webm', supported: false },
      { mime: 'audio/mp4', supported: false },
    ]);
    expect(pickRecorderMime(support)).toBeNull();
  });
});

describe('уровень микрофона', () => {
  it('RMS отсчётов', () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });

  it('RMS байтовых отсчётов: 128 — тишина', () => {
    expect(rmsOfBytes([])).toBe(0);
    expect(rmsOfBytes([128, 128, 128])).toBe(0);
    expect(rmsOfBytes([192, 64, 192, 64])).toBeCloseTo(0.5);
  });

  it('шкала по децибелам: −60 дБ — 0, 0 дБ — 1', () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(Number.NaN)).toBe(0);
    expect(levelFromRms(0.001)).toBeCloseTo(0); // −60 дБ
    expect(levelFromRms(0.0001)).toBe(0); // тише шкалы
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(2)).toBe(1);
    expect(levelFromRms(10 ** (-30 / 20))).toBeCloseTo(0.5); // −30 дБ — середина шкалы
  });
});

describe('micStatus: метка пункта «Микрофон»', () => {
  const NB = ' ';
  const base = {
    mic: 'live' as const,
    peak: 0,
    waited: false,
    recorder: true,
    rec: 'idle' as const,
    playback: 'idle' as const,
  };

  it('ревьюер: поток есть, но звука нет — не OK; ждём, затем ошибка с пиком', () => {
    expect(micStatus(base)).toEqual({ status: 'running', note: 'Ждём звук — скажи что-нибудь.' });
    expect(micStatus({ ...base, waited: true })).toEqual({
      status: 'error',
      note: `звука нет — пик 0${NB}%: микрофон занят другим приложением, выключен или поток пустой`,
    });
    expect(micStatus({ ...base, waited: true, peak: 0.05 }).note).toBe(
      `звук слишком тихий — пик 5${NB}%: скажи громче или поднеси телефон ближе`,
    );
    // Записали тишину — всё равно не OK: звука не было.
    expect(micStatus({ ...base, waited: true, rec: 'done', playback: 'done' }).status).toBe(
      'error',
    );
  });

  it('звук есть — OK, даже без записи; запись и воспроизведение с ошибкой — ошибка', () => {
    expect(micStatus({ ...base, peak: MIC_SIGNAL_MIN })).toEqual({ status: 'ok' });
    expect(micStatus({ ...base, peak: 0.6, waited: true, rec: 'done' })).toEqual({ status: 'ok' });
    expect(micStatus({ ...base, peak: 0.6, rec: 'error', recNote: 'пустая запись' })).toEqual({
      status: 'error',
      note: 'запись — пустая запись',
    });
    expect(
      micStatus({ ...base, peak: 0.6, playback: 'error', playbackNote: 'формат не поддержан' }),
    ).toEqual({ status: 'error', note: 'воспроизведение — формат не поддержан' });
    expect(micStatus({ ...base, peak: 0.6, rec: 'recording' }).status).toBe('running');
  });

  it('ревьюер: MediaRecorder нет — [ НЕТ ] с причиной, а не OK', () => {
    expect(micStatus({ ...base, peak: 0.6, recorder: false })).toEqual({
      status: 'no',
      note: 'Микрофон работает, но записать нечем: MediaRecorder нет',
    });
    expect(micStatus({ ...base, peak: null, recorder: false })).toEqual({
      status: 'no',
      note: 'Звук проверить нечем: нет ни AudioContext, ни MediaRecorder',
    });
  });

  it('уровень не измерить (нет AudioContext) — OK по получившейся записи', () => {
    expect(micStatus({ ...base, peak: null, waited: true }).status).toBe('running');
    expect(micStatus({ ...base, peak: null, rec: 'done' })).toEqual({ status: 'ok' });
  });

  it('выключили до замера — не проверено; после тишины — ошибка остаётся; отказ — как был', () => {
    expect(micStatus({ ...base, mic: 'off' })).toEqual({ status: 'idle' });
    expect(micStatus({ ...base, mic: 'off', waited: true }).status).toBe('error');
    expect(micStatus({ ...base, mic: 'off', peak: 0.4 })).toEqual({ status: 'ok' });
    expect(micStatus({ ...base, mic: 'idle' })).toEqual({ status: 'idle' });
    expect(micStatus({ ...base, mic: 'pending' })).toEqual({ status: 'running' });
    expect(micStatus({ ...base, mic: 'error', micNote: 'доступ запрещён' })).toEqual({
      status: 'error',
      note: 'доступ запрещён',
    });
    expect(micStatus({ ...base, mic: 'no', micNote: 'getUserMedia недоступен' }).status).toBe('no');
  });
});

describe('тексты ошибок', () => {
  it('медиа: имя исключения и перевод', () => {
    expect(mediaErrorText(new DOMException('Permission denied', 'NotAllowedError'))).toBe(
      'NotAllowedError — доступ запрещён',
    );
    expect(mediaErrorText({ name: 'NotReadableError', message: 'Could not start' })).toBe(
      'NotReadableError — устройство занято или не отвечает',
    );
  });

  it('медиа: неизвестное имя — с сообщением браузера, не объект — строкой', () => {
    expect(mediaErrorText({ name: 'WeirdError', message: 'boom' })).toBe('WeirdError: boom');
    expect(mediaErrorText({ name: 'WeirdError' })).toBe('WeirdError');
    expect(mediaErrorText('сломалось')).toBe('сломалось');
  });

  it('элемент <audio>: по коду MediaError', () => {
    expect(mediaElementErrorText(4)).toBe('MEDIA_ERR_SRC_NOT_SUPPORTED — формат не поддерживается');
    expect(mediaElementErrorText(3)).toBe('MEDIA_ERR_DECODE — не декодируется');
    expect(mediaElementErrorText(undefined)).toBe('MediaError без кода');
    expect(mediaElementErrorText(9)).toBe('MediaError без кода');
  });

  it('распознавание: код и перевод', () => {
    expect(speechErrorText('not-allowed')).toBe(
      'not-allowed — нет доступа к микрофону или распознаванию',
    );
    expect(speechErrorText('network')).toBe('network — нет связи с сервисом распознавания');
    expect(speechErrorText('что-то-новое')).toBe('что-то-новое');
    expect(speechErrorText('')).toBe('неизвестная ошибка');
  });
});

describe('совпадение фразы', () => {
  it('слова без регистра, знаков и «ё»', () => {
    expect(phraseWords('Туз пик, король червей!')).toEqual(['туз', 'пик', 'король', 'червей']);
    expect(phraseWords('Ёлка — 2 раза')).toEqual(['елка', '2', 'раза']);
  });

  it('считает слова фразы в распознанном', () => {
    const phrase = 'туз пик, король червей';
    expect(phraseMatch(phrase, 'Туз пик король червей')).toEqual({ matched: 4, total: 4 });
    expect(phraseMatch(phrase, 'туз пик король черве')).toEqual({ matched: 3, total: 4 });
    expect(phraseMatch(phrase, '')).toEqual({ matched: 0, total: 4 });
    // повтор слова в распознанном не засчитывается дважды
    expect(phraseMatch('туз туз', 'туз')).toEqual({ matched: 1, total: 2 });
  });
});

describe('числа', () => {
  it('размер файла', () => {
    expect(formatBytes(850)).toBe('850 Б');
    expect(formatBytes(48 * 1024 + 100)).toBe('48 КБ');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2,4 МБ');
  });

  it('длительность записи: Infinity у webm из MediaRecorder — не сообщается', () => {
    expect(durationText(3.04)).toBe('3 с');
    expect(durationText(2.96)).toBe('3 с');
    expect(durationText(3.14)).toBe('3,1 с');
    expect(durationText(Number.POSITIVE_INFINITY)).toBe('не сообщается');
    expect(durationText(Number.NaN)).toBe('не сообщается');
    expect(durationText(0)).toBe('не сообщается');
  });

  it('возраст файла', () => {
    expect(fileAgeText(3_400)).toBe('3 с');
    expect(fileAgeText(-50)).toBe('0 с');
    expect(fileAgeText(5 * 60_000)).toBe('5 мин');
    expect(fileAgeText(5 * 3_600_000)).toBe('5 ч');
    expect(fileAgeText(3 * 86_400_000)).toBe('3 дн');
  });
});

describe('WebAssembly', () => {
  it('базовый модуль и модуль с SIMD валидны (в node SIMD есть)', () => {
    expect(WebAssembly.validate(WASM_BASE)).toBe(true);
    expect(WebAssembly.validate(WASM_SIMD)).toBe(true);
  });

  it('испорченная инструкция SIMD — модуль не валиден', () => {
    const broken = Uint8Array.from(WASM_SIMD);
    broken[broken.length - 3] = 0xff; // префикс 0xfd → неизвестный опкод
    expect(WebAssembly.validate(broken)).toBe(false);
  });
});

describe('отчёт', () => {
  const results = (patch: Partial<Record<ProbeId, ProbeResult>>) =>
    Object.fromEntries(PROBE_ORDER.map((id) => [id, patch[id] ?? IDLE])) as Record<
      ProbeId,
      ProbeResult
    >;

  it('метки статусов', () => {
    expect(statusTag({ status: 'ok', facts: [] })).toBe('[ OK ]');
    expect(statusTag({ status: 'no', note: 'нет API', facts: [] })).toBe('[ НЕТ ]');
    expect(
      statusTag({ status: 'error', note: 'NotAllowedError — доступ запрещён', facts: [] }),
    ).toBe('[ ОШИБКА: NotAllowedError — доступ запрещён ]');
    expect(statusTag({ status: 'error', facts: [] })).toBe('[ ОШИБКА ]');
    expect(statusTag(IDLE)).toBe('[ НЕ ПРОВЕРЕНО ]');
    expect(statusTag({ status: 'running', facts: [] })).toBe('[ ИДЁТ ]');
  });

  it('шапка с датой по Москве и именем, все пункты по порядку, факты с отступом', () => {
    const text = probeReport({
      // 9 октября 2026, 18:14 UTC = 21:14 по Москве
      nowMs: Date.UTC(2026, 9, 9, 18, 14),
      who: 'Дима',
      results: results({
        camera: {
          status: 'ok',
          facts: [fact('Поток', '1280×720'), fact('Яркость кадра', '112 из 255, разброс 38')],
        },
        photo: { status: 'no', note: 'Выбор фото не открылся', facts: [] },
        mic: {
          status: 'error',
          note: 'NotAllowedError — доступ запрещён',
          facts: [fact('audio/mp4', 'да')],
        },
      }),
    });
    expect(text).toBe(
      [
        'Проверка устройства · 09.10.2026, 21:14 (Мск) · Дима',
        '',
        '01 Камера [ OK ]',
        '   Поток: 1280×720',
        '   Яркость кадра: 112 из 255, разброс 38',
        '',
        '02 Фото [ НЕТ ]',
        '   Выбор фото не открылся',
        '',
        '03 Микрофон [ ОШИБКА: NotAllowedError — доступ запрещён ]',
        '   audio/mp4: да',
        '',
        '04 Распознавание речи [ НЕ ПРОВЕРЕНО ]',
        '',
        '05 Вычисления [ НЕ ПРОВЕРЕНО ]',
        '',
        '06 Окружение [ НЕ ПРОВЕРЕНО ]',
      ].join('\n'),
    );
  });

  it('без имени — шапка без него', () => {
    const text = probeReport({
      nowMs: Date.UTC(2026, 9, 9, 18, 14),
      who: null,
      results: results({}),
    });
    expect(text.split('\n')[0]).toBe('Проверка устройства · 09.10.2026, 21:14 (Мск)');
  });
});
