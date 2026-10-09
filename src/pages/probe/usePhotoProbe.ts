// Пункт «Фото»: <input type="file" accept="image/*" capture="environment"> — что открыл телефон
// (камеру или галерею — отвечает игрок одной кнопкой), тип, размер и разрешение файла, превью.
// Файл никуда не уходит: только ссылка blob: для превью, её освобождаем при замене и уходе.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { imageSize } from './device';
import {
  IDLE,
  fact,
  fileAgeText,
  formatBytes,
  sizeText,
  type ProbeFact,
  type ProbeResult,
} from './lib';

export type PhotoAnswer = 'camera' | 'gallery' | 'nothing';

const ANSWER_TEXT: Readonly<Record<PhotoAnswer, string>> = {
  camera: 'камера',
  gallery: 'галерея',
  nothing: 'ничего',
};

interface FileInfo {
  facts: ProbeFact[];
  /** Файл не открылся как изображение (HEIC в Chrome и т. п.). */
  undecodable: boolean;
}

export interface PhotoProbe {
  result: ProbeResult;
  /** Нажали «Сделать фото» — спрашиваем, что открылось. */
  asked: boolean;
  answer: PhotoAnswer | null;
  previewUrl: string | null;
  open: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  setAnswer: (answer: PhotoAnswer) => void;
}

/** inputRef — скрытое поле выбора файла в разметке страницы. */
export function usePhotoProbe(inputRef: RefObject<HTMLInputElement | null>): PhotoProbe {
  const [asked, setAsked] = useState(false);
  const [answer, setAnswer] = useState<PhotoAnswer | null>(null);
  const [file, setFile] = useState<FileInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const run = useRef(0);

  // Ссылку превью освобождаем при замене и при уходе со страницы.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // «Отмена» выбора файла (Chrome 113+, Safari 16.4+) — событие cancel; React его у input не слушает.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onCancel = () => setCancelled(true);
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, [inputRef]);

  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const open = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    run.current += 1;
    setAsked(true);
    setAnswer(null);
    setFile(null);
    setCancelled(false);
    setPreviewUrl(null);
    // Тот же файл второй раз не даст change — сбрасываем значение.
    input.value = '';
    input.click();
  }, [inputRef]);

  const onChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    const id = ++run.current;
    setCancelled(false);
    setReading(true);
    const facts: ProbeFact[] = [
      fact('Файл', `${picked.type || 'тип не сообщается'}, ${formatBytes(picked.size)}`),
      // Свежий снимок с камеры — секунды; фото из галереи — обычно часы и дни.
      fact('Возраст файла', fileAgeText(Date.now() - picked.lastModified)),
    ];
    const size = await imageSize(picked);
    if (id !== run.current) return;
    setReading(false);
    if (size) {
      facts.push(fact('Разрешение', sizeText(size.width, size.height)));
      setPreviewUrl(URL.createObjectURL(picked));
    }
    setFile({ facts, undecodable: !size });
  }, []);

  const answerFacts = answer ? [fact('Что открылось', ANSWER_TEXT[answer])] : [];
  let result: ProbeResult;
  if (file) {
    const facts = [...answerFacts, ...file.facts];
    result = file.undecodable
      ? { status: 'error', note: 'файл не открывается как изображение', facts }
      : { status: 'ok', facts };
  } else if (answer === 'nothing') {
    result = { status: 'no', note: 'Ни камера, ни галерея не открылись', facts: answerFacts };
  } else if (cancelled) {
    result = { status: 'no', note: 'Окно закрыто без фото', facts: answerFacts };
  } else if (asked || reading) {
    result = { status: 'running', facts: answerFacts };
  } else {
    result = IDLE;
  }

  return {
    result,
    asked,
    answer,
    previewUrl,
    open,
    onChange: (event) => void onChange(event),
    setAnswer,
  };
}
