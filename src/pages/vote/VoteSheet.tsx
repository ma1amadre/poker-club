// Шторка голоса в одной номинации: номинант (участник вечера, не я), подпись до 200 символов,
// фото (сжатие и загрузка — uploadVotePhoto). Сохранение — cast_vote (upsert), отзыв — delete_vote.
import { VOTE_CATEGORY_META, type VoteCategory } from '@domain/votes.ts';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  errorMessage,
  removeVotePhoto,
  uploadVotePhoto,
  useCastVote,
  useVotePhotoUrl,
  type Player,
  type VoteRow,
} from '../../shared/api';
import { haptic } from '../../shared/telegram';
import {
  Button,
  Field,
  FieldGroup,
  PlayerPicker,
  Sheet,
  Skeleton,
  useToast,
} from '../../shared/ui';
import { CAPTION_MAX, photoPlan, voteDraftError } from './lib';

/** Чем поясняем номинацию в шторке. */
const CATEGORY_PROMPT: Record<VoteCategory, string> = {
  hand: 'Чья раздача запомнилась больше всего?',
  bluff: 'Кто красивее всех заставил сбросить?',
  badbeat: 'Кому обиднее всех не повезло на ривере?',
};

const CAPTION_PLACEHOLDER: Record<VoteCategory, string> = {
  hand: 'Собрал стрит на ривере и забрал банк у троих',
  bluff: 'Пошёл олл-ин с 7-2 и выбил сет',
  badbeat: 'Тузы против королей, король на ривере',
};

/**
 * Выбранный файл и временная ссылка на него для превью. Ссылка создаётся в обработчике выбора
 * и отзывается при замене, удалении и закрытии шторки — память под файл не течёт.
 */
function usePickedFile() {
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const urlRef = useRef<string | null>(null);

  const replace = (file: File | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const next = file ? { file, url: URL.createObjectURL(file) } : null;
    urlRef.current = next?.url ?? null;
    setPicked(next);
  };

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  return [picked, replace] as const;
}

export interface VoteSheetProps {
  eveningId: string;
  category: VoteCategory;
  me: Player;
  /** Участники вечера (по is_participant), включая меня — себя шторка исключает сама. */
  participants: readonly Player[];
  /** Мой голос в этой номинации; null — ещё не голосовал. */
  current: VoteRow | null;
  onClose: () => void;
  /**
   * Отозвать голос. Подтверждение — у родителя: шторка сначала закрывается («Материя» не
   * открывает окно поверх окна), и диалог не может закрыться вместе с ней по Esc.
   */
  onWithdraw: (vote: VoteRow) => void;
}

export function VoteSheet({
  eveningId,
  category,
  me,
  participants,
  current,
  onClose,
  onWithdraw,
}: VoteSheetProps) {
  const toast = useToast();
  const cast = useCastVote(eveningId);

  const [nomineeId, setNomineeId] = useState<string | null>(current?.nominee_id ?? null);
  const [caption, setCaption] = useState(current?.caption ?? '');
  const [picked, setPicked] = usePickedFile();
  const file = picked?.file ?? null;
  const [removeExisting, setRemoveExisting] = useState(false);
  const [nomineeError, setNomineeError] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = VOTE_CATEGORY_META[category].title;
  const candidates = participants.filter((p) => p.id !== me.id);
  const existingPath = current?.photo_path ?? null;
  const preview = picked?.url ?? null;
  const showExisting = !file && !removeExisting && Boolean(existingPath);
  const existingUrl = useVotePhotoUrl(showExisting ? existingPath : null);

  const changed =
    !current ||
    nomineeId !== current.nominee_id ||
    caption.trim() !== (current.caption ?? '') ||
    file !== null ||
    (removeExisting && Boolean(existingPath));

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    // Сброс значения: тот же файл можно выбрать снова после «Убрать фото».
    event.target.value = '';
    if (!chosen) return;
    if (chosen.type && !chosen.type.startsWith('image/')) {
      toast.show('Это не изображение', {
        tone: 'caution',
        detail: 'Выбери фото: JPEG, PNG или WebP.',
      });
      return;
    }
    setPicked(chosen);
    setRemoveExisting(false);
  };

  const dropPhoto = () => {
    setPicked(null);
    setRemoveExisting(true);
  };

  const submit = async () => {
    const problem = voteDraftError(
      { nomineeId, caption },
      me.id,
      participants.map((p) => p.id),
    );
    if (problem) {
      if (nomineeId && caption.trim().length > CAPTION_MAX) setCaptionError(problem);
      else setNomineeError(problem);
      haptic.notify('error');
      return;
    }
    const plan = photoPlan(existingPath, { file, removeExisting });
    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (plan.upload && file) {
        uploaded = await uploadVotePhoto(file, { eveningId, playerId: me.id, category });
      }
      await cast.mutateAsync({
        category,
        nomineeId: nomineeId as string,
        caption: caption.trim() || null,
        photoPath: uploaded ?? plan.keepPath,
      });
    } catch (error) {
      // Голос не сохранился — только что загруженное фото никому не нужно.
      if (uploaded) void removeVotePhoto(uploaded).catch(() => undefined);
      setBusy(false);
      // Хаптику (error) даёт сам тост; глобальный тост мутации глушит meta.silent у useCastVote.
      toast.show(current ? 'Голос не изменён' : 'Голос не сохранён', {
        tone: 'critical',
        detail: errorMessage(error),
      });
      return;
    }
    // Старое фото удаляем после успешного голоса. Если не вышло — файл останется в бакете,
    // но к голосу он уже не привязан и нигде не показывается.
    if (plan.removeAfter) await removeVotePhoto(plan.removeAfter).catch(() => undefined);
    toast.success(current ? 'Голос изменён' : 'Голос отдан');
    onClose();
  };

  const withdraw = () => {
    if (!current) return;
    onClose();
    onWithdraw(current);
  };

  const photoUrl = preview ?? (showExisting ? (existingUrl.data ?? null) : null);
  const photoLoading = !preview && showExisting && existingUrl.isPending;

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        dismissible={!busy}
        title={title}
        description={`${CATEGORY_PROMPT[category]} Голосовать за себя нельзя.`}
        actions={
          <>
            <Button
              variant="primary"
              block
              loading={busy}
              disabled={!changed || candidates.length === 0}
              onClick={() => void submit()}
            >
              {current ? 'Сохранить голос' : 'Отдать голос'}
            </Button>
            {current && (
              <Button variant="ghost" block disabled={busy} onClick={withdraw}>
                Отозвать голос
              </Button>
            )}
          </>
        }
      >
        {candidates.length === 0 ? (
          <p className="m-small">Голосовать не за кого: кроме тебя, в этот вечер никто не играл.</p>
        ) : (
          <>
            <FieldGroup label="Номинант" error={nomineeError}>
              <PlayerPicker
                players={candidates}
                value={nomineeId ? [nomineeId] : []}
                onChange={(ids) => {
                  setNomineeId(ids[0] ?? null);
                  setNomineeError(null);
                }}
              />
            </FieldGroup>

            <Field
              multiline
              label="Подпись"
              placeholder={CAPTION_PLACEHOLDER[category]}
              value={caption}
              maxLength={CAPTION_MAX}
              error={captionError ?? undefined}
              hint={
                <>
                  Необязательно ·{' '}
                  <span className="m-mono">
                    {caption.length} из {CAPTION_MAX}
                  </span>
                </>
              }
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setCaption(event.target.value);
                setCaptionError(null);
              }}
            />

            <FieldGroup label="Фото" hint="Необязательно. Перед загрузкой фото сжимается до 2 МБ.">
              <div className="vote-photo-edit">
                {photoLoading && <Skeleton height={200} />}
                {photoUrl && (
                  <img
                    className="vote-photo"
                    src={photoUrl}
                    alt={file ? 'Выбранное фото к голосу' : 'Фото к голосу'}
                  />
                )}
                <div className="vote-photo-edit__actions">
                  <Button
                    size="sm"
                    icon="camera"
                    disabled={busy}
                    onClick={() => inputRef.current?.click()}
                  >
                    {photoUrl || photoLoading ? 'Заменить фото' : 'Добавить фото'}
                  </Button>
                  {(photoUrl || photoLoading) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      disabled={busy}
                      onClick={dropPhoto}
                    >
                      Убрать фото
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept="image/*"
                tabIndex={-1}
                aria-hidden="true"
                onChange={pickFile}
              />
            </FieldGroup>
          </>
        )}
      </Sheet>
    </>
  );
}
