// «Снять борд» в шторке олл-ина: кнопка с камерой (в ряд с «Сказать карты») и итог под ней — что
// легло на стол, руки с фото «A♠ K♥ → кому?» с кнопками игроков раздачи (одно касание на руку),
// замечания и «Отменить». Логика — boardPhoto.ts, запрос — useBoardPhoto.ts. На табло карты уходят
// только главной кнопкой шторки.
import type { PlayerId } from '@domain/types.ts';
import { useRef } from 'react';
import { cardName } from '../../shared/lib/poker';
import { Badge, Button } from '../../shared/ui';
import {
  PHOTO_NOTHING_TEXT,
  canAssignHand,
  photoHandsHint,
  photoPlacedAny,
  photoSeconds,
  syncBoardPhoto,
} from './boardPhoto';
import { CardList } from './ShowdownVoice';
import type { ShowdownDraft } from './showdownDraft';
import type { PhotoState } from './useBoardPhoto';
import { placedGroups } from './voiceCards';

/** Кнопка «Снять борд»: открывает камеру телефона (на iPhone в Telegram — сразу камеру). */
export function BoardPhotoButton({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        icon="camera"
        className="ev-voice__say"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Снять борд
      </Button>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Сброс — чтобы тот же файл можно было выбрать ещё раз.
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

export interface BoardPhotoPanelProps {
  state: PhotoState;
  draft: ShowdownDraft;
  nameOf: (id: PlayerId) => string;
  /** Идёт отправка или телефон слушает — назначать и отменять нельзя. */
  disabled: boolean;
  onCancel: () => void;
  onAssign: (index: number, playerId: PlayerId) => void;
  onUndo: () => void;
}

/** Итог «Снять борд» под кнопками: распознаю / ошибка / что легло и чьи руки. */
export function BoardPhotoPanel({
  state,
  draft,
  nameOf,
  disabled,
  onCancel,
  onAssign,
  onUndo,
}: BoardPhotoPanelProps) {
  if (state.kind === 'busy') {
    return (
      <>
        <p className="ev-voice__line">
          <Badge tone="accent">Распознаю</Badge>
        </p>
        <p className="m-mono ev-voice__heard ev-voice__heard--live">
          <span className="ev-voice__prompt" aria-hidden="true">
            &gt;
          </span>{' '}
          фото стола ушло на распознавание
          <span className="ev-voice__cursor" aria-hidden="true" />
        </p>
        <Button variant="ghost" icon="x" className="ev-voice__undo" onClick={onCancel}>
          Отменить
        </Button>
      </>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="m-small ev-voice__line">
        <Badge tone="critical">Ошибка</Badge> {state.message}
      </p>
    );
  }

  // Сверено с черновиком: банкир мог поправить карты касанием или сменить состав.
  const result = syncBoardPhoto(draft, state.result);
  const groups = placedGroups(result.placed, nameOf);
  const anyPlaced = photoPlacedAny(result);
  const handsHint = photoHandsHint(result);
  return (
    <>
      <p className="ev-voice__line ev-photo__head">
        {result.empty ? (
          <Badge tone="caution">Карт не видно</Badge>
        ) : (
          <Badge tone="positive">Распознано</Badge>
        )}
        <span className="m-mono ev-photo__time">{photoSeconds(result.ms)}</span>
      </p>
      {result.empty && <p className="m-small ev-voice__hint">{PHOTO_NOTHING_TEXT}</p>}

      {groups.length > 0 && (
        <p className="ev-voice__line ev-voice__placed">
          <Badge tone="positive">Легло</Badge>
          {groups.map((g, index) => (
            <span key={index} className="ev-voice__group">
              <span className="ev-voice__owner">{g.owner}</span>
              <CardList cards={g.cards} />
            </span>
          ))}
        </p>
      )}

      {result.hands.length > 0 && (
        <ul className="ev-photo__hands" aria-label="Руки с фото">
          {result.hands.map((hand, index) => {
            const label = `${cardName(hand.cards[0])}, ${cardName(hand.cards[1])}`;
            return (
              <li key={hand.cards.join()} className="ev-photo__hand">
                <p className="ev-photo__pair">
                  <CardList cards={hand.cards} />
                  <span className="ev-photo__to" aria-hidden="true">
                    →
                  </span>
                  {hand.owner ? (
                    <span className="ui-name ev-photo__owner">{nameOf(hand.owner)}</span>
                  ) : (
                    <span className="ev-photo__ask">кому?</span>
                  )}
                </p>
                <div className="ev-photo__who" role="group" aria-label={`Чья рука: ${label}`}>
                  {draft.players.map((id) => {
                    const mine = hand.owner === id;
                    return (
                      <Button
                        key={id}
                        variant={mine ? 'primary' : 'secondary'}
                        className="ev-photo__player"
                        aria-pressed={mine}
                        disabled={disabled || !canAssignHand(draft, result, index, id)}
                        onClick={() => onAssign(index, id)}
                      >
                        {nameOf(id)}
                      </Button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!result.empty && !anyPlaced && result.hands.length === 0 && result.info.length === 0 && (
        <p className="ev-voice__line">
          <Badge tone="caution">Не легло</Badge>
        </p>
      )}
      {result.notes.map((note) => (
        <p key={note} className="m-small ev-voice__note">
          {note}
        </p>
      ))}
      {result.info.map((line) => (
        <p key={line} className="m-small ev-voice__hint">
          {line}
        </p>
      ))}
      {handsHint && <p className="m-small ev-voice__hint">{handsHint}</p>}
      {anyPlaced && (
        <p className="m-small ev-voice__hint">
          Проверь карты выше — на табло они уйдут кнопкой внизу.
        </p>
      )}
      {anyPlaced && (
        <Button
          variant="ghost"
          icon="rotate-ccw"
          className="ev-voice__undo"
          aria-label="Отменить — снять карты, которые легли с фото"
          disabled={disabled}
          onClick={onUndo}
        >
          Отменить
        </Button>
      )}
    </>
  );
}
