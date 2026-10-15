// «Снять борд»: фото с камеры телефона → сжатие на клиенте (длинная сторона 1600 px, JPEG 0.8, поворот
// по EXIF — compressImage) → Edge Function card-vision → карты в черновик (boardPhoto.ts). Пока идёт
// распознавание — «Распознаю…» с отменой; отмена и закрытие шторки обрывают запрос, его ответ не
// ложится. Карты кладутся в черновик, каким он стал к ответу (банкир мог коснуться карты, пока ждал).
import type { PlayerId } from '@domain/types.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardPhotoError, recognizeBoardPhoto } from '../../shared/api';
import { blobToBase64, compressImage, safeLocalStorage } from '../../shared/lib';
import { haptic } from '../../shared/telegram';
import {
  applyBoardPhoto,
  photoHaptic,
  readBoardPhotoAnswer,
  readPhotoUsed,
  writePhotoUsed,
  type PhotoResult,
} from './boardPhoto';
import type { ShowdownDraft } from './showdownDraft';

/** Сжатое фото — не больше этого (сервер принимает до 4 МБ). */
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

export type PhotoState =
  { kind: 'busy' } | { kind: 'done'; result: PhotoResult } | { kind: 'error'; message: string };

export interface BoardPhotoInput {
  eveningId: string;
  /** Черновик и имена на момент ответа. */
  latest: () => { draft: ShowdownDraft; nameOf: (id: PlayerId) => string };
  /** Карты легли: новый черновик. */
  onDraft: (draft: ShowdownDraft) => void;
}

export interface BoardPhoto {
  state: PhotoState | null;
  busy: boolean;
  /** «Снять борд» на этом устройстве уже пробовали — подсказку о фото не показываем. */
  used: boolean;
  start: (file: File) => void;
  /** Отменить идущее распознавание. */
  cancel: () => void;
  /** Заменить итог (назначение руки) или убрать его (null). */
  set: (state: PhotoState | null) => void;
}

export function useBoardPhoto({ eveningId, latest, onDraft }: BoardPhotoInput): BoardPhoto {
  const [state, setState] = useState<PhotoState | null>(null);
  const [used, setUsed] = useState(() => readPhotoUsed(safeLocalStorage()));
  const run = useRef<AbortController | null>(null);
  const latestRef = useRef({ latest, onDraft });
  useEffect(() => {
    latestRef.current = { latest, onDraft };
  });

  // Шторка закрылась посреди распознавания — запрос обрываем, ответ не нужен.
  useEffect(() => () => run.current?.abort(), []);

  const start = useCallback(
    (file: File) => {
      run.current?.abort();
      const controller = new AbortController();
      run.current = controller;
      haptic.impact('light');
      setState({ kind: 'busy' });
      writePhotoUsed(safeLocalStorage());
      setUsed(true);
      void (async () => {
        try {
          const blob = await compressImage(file, {
            maxSide: 1600,
            quality: 0.8,
            maxBytes: PHOTO_MAX_BYTES,
          });
          if (controller.signal.aborted) return;
          const image = await blobToBase64(blob);
          if (controller.signal.aborted) return;
          const data = await recognizeBoardPhoto(
            { eveningId, image, mediaType: 'image/jpeg' },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const answer = readBoardPhotoAnswer(data);
          if (!answer) {
            haptic.notify('error');
            setState({
              kind: 'error',
              message:
                'Сервер распознавания ответил непонятно. Сними стол ещё раз или отметь карты касанием.',
            });
            return;
          }
          const now = latestRef.current.latest();
          const applied = applyBoardPhoto(now.draft, answer, now.nameOf);
          if (applied.draft !== now.draft) latestRef.current.onDraft(applied.draft);
          haptic.notify(photoHaptic(applied.result));
          setState({ kind: 'done', result: applied.result });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof BoardPhotoError && error.code === 'cancelled') return;
          haptic.notify('error');
          setState({
            kind: 'error',
            message:
              error instanceof Error && error.message
                ? error.message
                : 'Не удалось распознать фото. Сними стол ещё раз или отметь карты касанием.',
          });
        } finally {
          if (run.current === controller) run.current = null;
        }
      })();
    },
    [eveningId],
  );

  const cancel = useCallback(() => {
    run.current?.abort();
    run.current = null;
    haptic.selection();
    setState(null);
  }, []);

  return { state, busy: state?.kind === 'busy', used, start, cancel, set: setState };
}
