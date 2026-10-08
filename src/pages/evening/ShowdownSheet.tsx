// Шторка олл-ина: банкир отмечает, кто вскрылся, их карты и стол — флоп, тёрн, ривер по мере
// выкладки. Одно касание — одна карта: место для карты выбрано заранее (подсвечено) и после
// касания переходит к следующему пустому. Занятые карты в сетке недоступны. Каждая отправка пишет
// в журнал полное состояние раздачи ('showdown'); ошибку правят следующей отправкой или «Отменить»
// в тосте — вечер она не ломает (на игру и деньги раздача не влияет).
// После ривера — «Записать вылет: X, выбивает Y» (useRiverBusts.ts): проигравшие раздачу отмечены,
// банкир снимает отметку с того, кому фишек хватило; несколько вылетевших — с порядком по фишкам.
import { CARD_RANKS, CARD_SUITS, streetOf, visibleShowdown } from '@domain/showdown.ts';
import { useState } from 'react';
import { newClientId } from '../../shared/api';
import { cardLabel, cardName, rankLabel, type SuitCode } from '../../shared/lib/poker';
import { STREET_LABEL } from '../../shared/lib/poker/display';
import { haptic } from '../../shared/telegram';
import { Button, PlayerPicker, PlayingCard, Sheet, SuitPip } from '../../shared/ui';
import { RiverBustsChoice } from './RiverBustsChoice';
import { useRiverBusts, useRiverChoice } from './useRiverBusts';
import { riverBustLabel } from './riverBusts';
import {
  cardIn,
  checkDraft,
  clearSlot,
  draftFromShowdown,
  emptyDraft,
  nextEmptySlot,
  placeCard,
  sameSlot,
  samePayload,
  sendLabel,
  setPlayers,
  showdownCandidates,
  successText,
  usedCards,
  type ShowdownDraft,
  type Slot,
} from './showdownDraft';
import './showdown-sheet.css';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface ShowdownSheetProps {
  open: boolean;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  /** «Ребай» в тосте после вылета, записанного после ривера. */
  onRebuy?: (playerId: string) => void;
}

export function ShowdownSheet(props: ShowdownSheetProps) {
  // Монтируется заново при каждом открытии: черновик — из раздачи, которая сейчас на табло.
  return props.open ? <ShowdownSheetInner {...props} /> : null;
}

/** Ранги сверху вниз: туз первым — как держат карты в руке. */
const GRID_RANKS = [...CARD_RANKS].reverse();
const GRID_SUITS = [...CARD_SUITS] as SuitCode[];
const BOARD_LABELS = ['Флоп', 'Флоп', 'Флоп', 'Тёрн', 'Ривер'];

function ShowdownSheetInner({ onClose, model, actions, onRebuy }: ShowdownSheetProps) {
  const { state, nameOf, playersById, nowMs } = model;
  const onBoard = visibleShowdown(state.showdown, nowMs);
  const [draft, setDraft] = useState<ShowdownDraft>(() =>
    onBoard ? draftFromShowdown(onBoard) : emptyDraft(newClientId()),
  );
  const [active, setActive] = useState<Slot | null>(() =>
    onBoard ? nextEmptySlot(draftFromShowdown(onBoard), null) : null,
  );
  const [editPlayers, setEditPlayers] = useState(!onBoard);
  const [sending, setSending] = useState(false);

  // Раздача этого черновика на табло (после первой отправки — она же); чужая или скрытая — нет.
  const published = onBoard && onBoard.showdownId === draft.showdownId ? onBoard : null;
  const check = checkDraft(draft, nameOf);
  const payload = check.ok ? check.payload : null;
  const changed = payload !== null && !samePayload(payload, published);
  const domainProblem = payload && changed ? actions.check('showdown', payload) : null;
  const riverDone = published !== null && published.board.length === 5 && !changed;
  const used = usedCards(draft);
  const current = active ? cardIn(draft, active) : null;
  const busy = sending || actions.busy;
  // После ривера: кто проиграл раздачу и ещё в игре — предложение записать вылет.
  const river = useRiverBusts(model, actions, onRebuy);
  const suggestion = riverDone ? river.suggestion : null;
  const choice = useRiverChoice(suggestion);

  // Кого можно отметить: кто в игре, и те, кто уже в раздаче на табло или в черновике
  // (вылетевшего участника можно поправить и вернуть, если галочку с него сняли по ошибке).
  const candidates = showdownCandidates(
    state.joinOrder,
    (id) => Boolean(state.players[id]?.alive),
    draft,
    published,
  );

  const choosePlayers = (ids: string[]) => {
    const next = setPlayers(draft, ids, published);
    setDraft(next);
    // Состав сменился — к первому пустому месту: карты нового игрока раньше стола, а места
    // убранного больше нет.
    setActive(nextEmptySlot(next, null));
  };

  const pick = (code: string) => {
    if (!active) return;
    haptic.selection();
    if (current === code) {
      // Повторное касание той же карты снимает её с места.
      setDraft(clearSlot(draft, active));
      return;
    }
    const next = placeCard(draft, active, code);
    setDraft(next);
    setActive(nextEmptySlot(next, active));
  };

  const send = async () => {
    if (!payload) return;
    setSending(true);
    const record = await actions.send('showdown', payload, {
      success: successText(payload, published),
      undo: true,
    });
    setSending(false);
    if (record) {
      setEditPlayers(false);
      setActive(nextEmptySlot(draft, null));
    }
  };

  const recordBusts = async () => {
    setSending(true);
    await river.record(choice.byChips, false);
    setSending(false);
  };

  const closeShowdown = async () => {
    if (!published) {
      onClose();
      return;
    }
    setSending(true);
    const record = await actions.send(
      'showdown_close',
      { showdownId: published.showdownId },
      { success: 'Раздача закрыта', detail: 'Табло вернулось к таймеру.', undo: true },
    );
    setSending(false);
    if (record) onClose();
  };

  const hint = !check.ok
    ? draft.players.length === 0 && editPlayers
      ? 'Отметь, кто вскрылся, — потом их карты.'
      : check.reason
    : domainProblem
      ? domainProblem
      : riverDone && suggestion
        ? null
        : riverDone
          ? 'Закрой раздачу — табло вернётся к таймеру (само — через 2 минуты после ривера). Поправить карту: нажми на неё выше.'
          : null;

  const description = published
    ? `На табло — ${STREET_LABEL[streetOf(published.board.length)]}. Отмечай карты стола по мере выкладки.`
    : 'Отметь игроков и их карты — табло покажет руки, стол и шансы.';

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!sending}
      title="Олл-ин"
      description={description}
      actions={
        <>
          {hint && <p className="m-small ev-sd-hint">{hint}</p>}
          {riverDone && suggestion ? (
            <>
              <Button
                variant="primary"
                block
                icon="user-x"
                loading={sending}
                disabled={busy || choice.byChips.length === 0}
                onClick={() => void recordBusts()}
              >
                {riverBustLabel(choice.byChips.map(nameOf))}
              </Button>
              <Button variant="ghost" block disabled={busy} onClick={() => void closeShowdown()}>
                Закрыть раздачу
              </Button>
            </>
          ) : riverDone ? (
            <Button
              variant="primary"
              block
              icon="check"
              loading={sending}
              disabled={busy}
              onClick={() => void closeShowdown()}
            >
              Закрыть раздачу
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                block
                icon="eye"
                loading={sending}
                disabled={busy || !payload || !changed || Boolean(domainProblem)}
                onClick={() => void send()}
              >
                {sendLabel(payload, published)}
              </Button>
              {published && (
                <Button variant="ghost" block disabled={busy} onClick={() => void closeShowdown()}>
                  Закрыть раздачу
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="ev-sd">
        {suggestion && (
          <RiverBustsChoice model={model} suggestion={suggestion} choice={choice} disabled={busy} />
        )}
        {editPlayers ? (
          <PlayerPicker
            label="Кто вскрывается"
            players={candidates.map((id) => ({
              id,
              display_name: nameOf(id),
              photo_url: playersById.get(id)?.photo_url,
            }))}
            value={draft.players}
            onChange={choosePlayers}
            max={9}
            hints={Object.fromEntries(
              candidates.filter((id) => !state.players[id]?.alive).map((id) => [id, 'вне игры']),
            )}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon="pencil"
            className="ev-sd-edit"
            disabled={busy}
            onClick={() => setEditPlayers(true)}
          >
            Изменить состав
          </Button>
        )}

        {draft.players.length > 0 && (
          <div
            className={
              draft.players.length <= 3
                ? `ev-sd-slots ev-sd-slots--sticky${draft.players.length}`
                : 'ev-sd-slots'
            }
          >
            <div className="ev-sd-group" role="group" aria-label="Карты игроков">
              {draft.players.map((id) => (
                <div key={id} className="ev-sd-hand">
                  <span className="ev-sd-hand__name">{nameOf(id)}</span>
                  {([0, 1] as const).map((index) => (
                    <SlotButton
                      key={index}
                      slot={{ kind: 'hand', playerId: id, index }}
                      draft={draft}
                      active={active}
                      label={`${nameOf(id)}, карта ${index + 1}`}
                      onSelect={setActive}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="ev-sd-group" role="group" aria-label="Карты стола">
              <span className="ev-sd-hand__name">Стол</span>
              <div className="ev-sd-board">
                {BOARD_LABELS.map((label, index) => (
                  <SlotButton
                    key={index}
                    slot={{ kind: 'board', index }}
                    draft={draft}
                    active={active}
                    label={index < 3 ? `${label}, карта ${index + 1}` : label}
                    caption={index === 0 || index > 2 ? label.toLowerCase() : undefined}
                    onSelect={setActive}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div
          className="ev-sd-grid"
          role="group"
          aria-label="Колода: выбери карту для подсвеченного места"
        >
          {GRID_RANKS.map((rank) =>
            GRID_SUITS.map((suit) => {
              const code = rank + suit;
              const holder = used.get(code);
              const here = active !== null && holder !== undefined && sameSlot(holder, active);
              const taken = holder !== undefined && !here;
              return (
                <button
                  key={code}
                  type="button"
                  className={`ev-sd-cell ui-card-suit--${suit}`}
                  aria-pressed={here}
                  aria-label={cardName(code)}
                  title={cardLabel(code)}
                  disabled={!active || taken || busy}
                  onClick={() => pick(code)}
                >
                  <span className="ev-sd-cell__rank">{rankLabel(rank)}</span>
                  <SuitPip suit={suit} className="ev-sd-cell__suit" />
                </button>
              );
            }),
          )}
        </div>
      </div>
    </Sheet>
  );
}

function SlotButton({
  slot,
  draft,
  active,
  label,
  caption,
  onSelect,
}: {
  slot: Slot;
  draft: ShowdownDraft;
  active: Slot | null;
  label: string;
  caption?: string;
  onSelect: (slot: Slot) => void;
}) {
  const code = cardIn(draft, slot);
  const isActive = sameSlot(slot, active);
  return (
    <button
      type="button"
      className="ev-sd-slot"
      aria-pressed={isActive}
      aria-label={`${label}: ${code ? cardName(code) : 'пусто'}`}
      onClick={() => {
        haptic.selection();
        onSelect(slot);
      }}
    >
      <PlayingCard code={code} size="sm" />
      {caption && (
        <span className="ev-sd-slot__caption" aria-hidden="true">
          {caption}
        </span>
      )}
    </button>
  );
}
