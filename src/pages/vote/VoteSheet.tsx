// Шторка голоса в одной номинации: номинант (участник вечера, не я), подпись до 200 символов,
// фото (сжатие и загрузка — uploadVotePhoto). Сохранение — cast_vote (upsert), отзыв — delete_vote.
// В «Руке» и «Бэд-бите» сверху — подсказки из «Олл-инов вечера» (allInSuggestions): нажатие
// выбирает номинанта и, если подпись пустая, подставляет карты раздачи.
import type { AllIn } from '@domain/allins.ts';
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
import { allInCaption, formatTime, swingPill, favoritePill } from '../../shared/lib';
import { useAllInSwings } from '../../shared/lib/poker';
import { haptic } from '../../shared/telegram';
import {
  Button,
  Field,
  FieldGroup,
  PlayerPicker,
  PlayingCard,
  Sheet,
  Skeleton,
  useToast,
} from '../../shared/ui';
import {
  allInSuggestions,
  CAPTION_MAX,
  photoPlan,
  voteDraftError,
  type AllInSuggestion,
} from './lib';

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
  /** Олл-ины вечера (eveningAllIns) — подсказки в «Руке» и «Бэд-бите». */
  allIns?: readonly AllIn[];
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
  allIns = NO_ALL_INS,
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
  const nameOf = (id: string) =>
    participants.find((p) => p.id === id)?.display_name ?? 'Игрок без имени';
  const { swings } = useAllInSwings(allIns);
  const suggestions = allInSuggestions(
    category,
    allIns,
    swings,
    candidates.map((p) => p.id),
  );
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const suggestionKey = (s: AllInSuggestion) => `${s.allIn.showdownId}:${s.nomineeId}`;
  const pickSuggestion = (s: AllInSuggestion) => {
    setPickedKey(suggestionKey(s));
    setNomineeId(s.nomineeId);
    setNomineeError(null);
    // Своя подпись остаётся; пустая — карты раздачи.
    if (caption.trim() === '') {
      setCaption(allInCaption(s.allIn).slice(0, CAPTION_MAX));
      setCaptionError(null);
    }
  };
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
            {suggestions.length > 0 && (
              <FieldGroup
                label="Олл-ины вечера"
                hint="Нажми на раздачу — номинант выберется, а пустая подпись заполнится картами."
              >
                <ul className="vote-allins">
                  {suggestions.map((s) => (
                    <li key={suggestionKey(s)}>
                      <SuggestionButton
                        suggestion={s}
                        category={category}
                        nameOf={nameOf}
                        selected={pickedKey === suggestionKey(s) && nomineeId === s.nomineeId}
                        onPick={() => pickSuggestion(s)}
                      />
                    </li>
                  ))}
                </ul>
              </FieldGroup>
            )}

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

const NO_ALL_INS: readonly AllIn[] = [];

/** Подсказка-раздача: карты номинанта, кто и с чем, пометка «победа с N %» или «фаворит, N %». */
function SuggestionButton({
  suggestion,
  category,
  nameOf,
  selected,
  onPick,
}: {
  suggestion: AllInSuggestion;
  category: VoteCategory;
  nameOf: (id: string) => string;
  selected: boolean;
  onPick: () => void;
}) {
  const { allIn, nomineeId, swing } = suggestion;
  const hand = allIn.hands.find((h) => h.playerId === nomineeId);
  const pill =
    swing && category === 'hand' && swing.winnerId === nomineeId
      ? swingPill(swing)
      : swing && category === 'badbeat'
        ? favoritePill(swing)
        : null;
  return (
    <button type="button" className="vote-allin" aria-pressed={selected} onClick={onPick}>
      {hand && (
        <span className="vote-allin__cards" aria-hidden="true">
          <PlayingCard code={hand.cards[0]} size="sm" />
          <PlayingCard code={hand.cards[1]} size="sm" />
        </span>
      )}
      <span className="vote-allin__text">
        <span className="vote-allin__name">{nameOf(nomineeId)}</span>
        <span className="m-small">
          {formatTime(allIn.openedAt)} · {allInCaption(allIn)}
        </span>
        {pill && <span className="vote-allin__pill">{pill}</span>}
      </span>
    </button>
  );
}
