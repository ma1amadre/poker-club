// Голосовой ввод карт в шторке олл-ина: «Сказать карты» → телефон слушает фразу («туз пик, король
// червей») → карты ложатся в следующие места тем же путём, что и касания (placeCards), подсвеченное
// место сдвигается. Видно, что услышано, что и куда легло, что не легло и почему; «Отменить» снимает
// именно эти карты. На табло карты уходят только главной кнопкой шторки — банкир их видит и
// подтверждает. Кнопки нет, если распознавания речи в окне нет (на Android в Telegram — скорее всего).
// Разбор — voiceCards.ts, распознавание — useVoiceCards.ts.
import type { CardCode, PlayerId } from '@domain/types.ts';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { cardName, rankLabel, suitOfCode } from '../../shared/lib/poker';
import { haptic } from '../../shared/telegram';
import { Badge, Button, SuitPip } from '../../shared/ui';
import {
  nextEmptySlot,
  placeCards,
  sameSlot,
  slotOrder,
  unplaceCards,
  type PlacedCard,
  type ShowdownDraft,
  type Slot,
} from './showdownDraft';
import { useVoiceCapture, type VoiceEnd } from './useVoiceCards';
import {
  VOICE_EXAMPLE,
  VOICE_NOTHING_TEXT,
  VOICE_PERMISSION_TEXT,
  bestVoiceParse,
  keptLines,
  parseVoiceCards,
  placedGroups,
  placementLines,
  voiceErrorText,
  voiceIssueLines,
  voiceQueue,
} from './voiceCards';

/** Итог последней фразы — живёт в шторке: отправка на табло и смена состава его сбрасывают. */
export type VoiceResult =
  /**
   * Разобраны карты: что легло (может быть пусто), замечания (notes — что проверить: вибро «warning»)
   * и справка (info — названные карты уже на своих местах).
   */
  | { kind: 'placed'; heard: string; placed: PlacedCard[]; notes: string[]; info: string[] }
  /** Текст есть, карт в нём нет. */
  | { kind: 'nothing'; heard: string; notes: string[] }
  | { kind: 'error'; message: string };

export interface ShowdownVoiceProps {
  draft: ShowdownDraft;
  active: Slot | null;
  nameOf: (id: PlayerId) => string;
  /** Идёт отправка — новую фразу не начинаем. */
  disabled: boolean;
  result: VoiceResult | null;
  onResult: (result: VoiceResult | null) => void;
  /** Новый черновик и подсвеченное место (карты легли или сняты). */
  onDraft: (draft: ShowdownDraft, active: Slot | null) => void;
  /**
   * Слушает ли телефон: пока да, шторка не даёт отправить черновик — итог фразы мог бы лечь в него во
   * время отправки и остаться неотправленным. Должна быть стабильной (сеттер состояния).
   */
  onListening: (listening: boolean) => void;
}

export function ShowdownVoice(props: ShowdownVoiceProps) {
  const { draft, active, nameOf, disabled, result, onResult, onListening } = props;
  const capture = useVoiceCapture();
  // Распознавание отвечает позже: кладём карты в черновик, каким он стал к этому моменту
  // (банкир мог коснуться карты, пока говорил).
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    if (!capture.listening) return;
    onListening(true);
    return () => onListening(false);
  }, [capture.listening, onListening]);

  if (!capture.supported) return null;
  const queue = voiceQueue(draft, active, nameOf);
  // Свободных мест нет и показывать нечего — блок не нужен (после ривера, до правки).
  if (!queue && !result && !capture.listening) return null;

  const onEnd = (end: VoiceEnd) => {
    const now = latest.current;
    if (end.kind !== 'heard') {
      haptic.notify('error');
      now.onResult({
        kind: 'error',
        message: voiceErrorText(end.kind === 'error' ? end.code : 'no-speech'),
      });
      return;
    }
    const parse = bestVoiceParse(end.texts);
    if (!parse) {
      haptic.notify('error');
      now.onResult({ kind: 'error', message: voiceErrorText('no-speech') });
      return;
    }
    const issues = voiceIssueLines(parse.issues);
    if (parse.cards.length === 0) {
      haptic.notify('error');
      now.onResult({ kind: 'nothing', heard: parse.text, notes: issues });
      return;
    }
    // Карты после сбоя в самой фразе (потерянное слово) не кладём — их место неясно (parse.sure).
    const placed = placeCards(now.draft, now.active, parse.cards.slice(0, parse.sure));
    const held = [...placed.held, ...parse.cards.slice(parse.sure)];
    const notes = [...issues, ...placementLines(placed.taken, held, placed.overflow, now.nameOf)];
    const info = keptLines(placed.kept, now.nameOf);
    if (placed.placed.length > 0 || placed.kept.length > 0)
      now.onDraft(placed.draft, placed.active);
    const none = placed.placed.length === 0 && placed.kept.length === 0;
    haptic.notify(none ? 'error' : notes.length > 0 ? 'warning' : 'success');
    now.onResult({ kind: 'placed', heard: parse.text, placed: placed.placed, notes, info });
  };

  const toggle = () => {
    if (capture.listening) {
      capture.stop();
      return;
    }
    haptic.impact('light');
    onResult(null);
    capture.start(onEnd);
  };

  const placedCards = result?.kind === 'placed' ? result.placed : [];
  const undo = () => {
    const next = unplaceCards(draft, placedCards);
    const first = placedCards[0]?.slot ?? null;
    const back = first && slotOrder(next).some((s) => sameSlot(s, first)) ? first : null;
    haptic.selection();
    props.onDraft(next, back ?? nextEmptySlot(next, null));
    onResult(null);
  };

  const live = capture.listening ? parseVoiceCards(capture.heard).cards : [];

  return (
    <section className="ev-voice" aria-label="Голосовой ввод карт">
      <div className="ev-voice__bar">
        <Button
          icon={capture.listening ? 'x' : 'mic'}
          className="ev-voice__say"
          data-listening={capture.listening}
          disabled={!capture.listening && (disabled || !queue)}
          onClick={toggle}
        >
          {capture.listening ? 'Остановить' : 'Сказать карты'}
        </Button>
      </div>

      <div className="ev-voice__out" aria-live="polite">
        {capture.listening ? (
          <>
            <p className="ev-voice__line">
              <Badge tone="accent">Слушаю</Badge>
            </p>
            <p className="m-mono ev-voice__heard ev-voice__heard--live">
              <span className="ev-voice__prompt" aria-hidden="true">
                &gt;
              </span>{' '}
              {capture.heard}
              <span className="ev-voice__cursor" aria-hidden="true" />
            </p>
            {live.length > 0 && (
              <p className="ev-voice__line">
                <CardList cards={live} />
              </p>
            )}
          </>
        ) : result ? (
          <VoiceResultView result={result} nameOf={nameOf} />
        ) : null}
      </div>

      {placedCards.length > 0 && !capture.listening && (
        <Button
          variant="ghost"
          icon="rotate-ccw"
          className="ev-voice__undo"
          aria-label="Отменить — снять карты, которые легли голосом"
          disabled={disabled}
          onClick={undo}
        >
          Отменить
        </Button>
      )}

      {!capture.listening && !result && (
        <p className="m-small ev-voice__hint">Скажи, например: «{VOICE_EXAMPLE}».</p>
      )}
      {queue && (
        <p className="m-small ev-voice__hint">
          {result?.kind === 'placed' && result.placed.length > 0 ? 'Дальше' : 'Куда лягут'}:{' '}
          <span className="ev-voice__queue">{queue}</span>
        </p>
      )}
      {!capture.ready && !capture.listening && (
        <p className="m-small ev-voice__hint">{VOICE_PERMISSION_TEXT}</p>
      )}
    </section>
  );
}

function VoiceResultView({
  result,
  nameOf,
}: {
  result: VoiceResult;
  nameOf: (id: PlayerId) => string;
}) {
  if (result.kind === 'error') {
    return (
      <p className="m-small ev-voice__line">
        <Badge tone="critical">Ошибка</Badge> {result.message}
      </p>
    );
  }
  const heard = (
    <p className="m-mono ev-voice__heard">
      <span className="ev-voice__prompt" aria-hidden="true">
        &gt;
      </span>{' '}
      {result.heard}
    </p>
  );
  if (result.kind === 'nothing') {
    return (
      <>
        {heard}
        <p className="m-small ev-voice__line">
          <Badge tone="caution">Не разобрано</Badge> {VOICE_NOTHING_TEXT}
        </p>
        {result.notes.map((note) => (
          <p key={note} className="m-small ev-voice__note">
            {note}
          </p>
        ))}
      </>
    );
  }
  const groups = placedGroups(result.placed, nameOf);
  return (
    <>
      {heard}
      {groups.length > 0 ? (
        <p className="ev-voice__line ev-voice__placed">
          <Badge tone="positive">Легло</Badge>
          {groups.map((g, index) => (
            <span key={index} className="ev-voice__group">
              <span className="ev-voice__owner">{g.owner}</span>
              <CardList cards={g.cards} />
            </span>
          ))}
        </p>
      ) : result.info.length === 0 ? (
        <p className="ev-voice__line">
          <Badge tone="caution">Не легло</Badge>
        </p>
      ) : null}
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
      {groups.length > 0 && (
        <p className="m-small ev-voice__hint">
          Проверь карты выше — на табло они уйдут кнопкой внизу.
        </p>
      )}
    </>
  );
}

/** Карты строкой: моно-ранг и значок масти в две краски (как значки мастей вне карты). */
function CardList({ cards }: { cards: readonly CardCode[] }) {
  return (
    <span className="ev-voice__cards">
      {cards.map((code) => {
        const suit = suitOfCode(code);
        return (
          <span
            key={code}
            className={`ev-voice__card ui-card-suit--${suit}`}
            role="img"
            aria-label={cardName(code)}
          >
            {rankLabel(code.charAt(0))}
            <SuitPip suit={suit} />
          </span>
        );
      })}
    </span>
  );
}
