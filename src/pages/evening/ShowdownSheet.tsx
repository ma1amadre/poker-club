// Шторка олл-ина: банкир отмечает, кто вскрылся, их карты и стол — флоп, тёрн, ривер по мере
// выкладки. Одно касание — одна карта: место для карты выбрано заранее (подсвечено) и после
// касания переходит к следующему пустому. Занятые карты в сетке недоступны. Каждая отправка пишет
// в журнал полное состояние раздачи ('showdown'); ошибку правят следующей отправкой или «Отменить»
// в тосте — вечер она не ломает (на игру и деньги раздача не влияет).
// После ривера (useRiverBusts.ts) — кто проиграл раздачу, без отметок заранее (решение клуба
// 10.10.2026: стек проигравшего может быть больше олл-ина соперника): банкир отмечает, кому не
// хватило фишек; кто выбил — по картам (при побочном банке — выбор), несколько вылетевших — с порядком
// по фишкам, «Сразу ребай» на выбранную сумму — тем же действием. Запись закрывает раздачу; хватило всем —
// «Все остаются за столом» (раздача закрывается без вылетов). Открыта с пульта по «Отметить вылет»
// или «Вылет и ребай» (river) — на раздаче после ривера, даже если табло её уже спрятало.
// В игре ровно двое (хедз-ап вечера) — новый олл-ин начинается с обоими отмеченными.
// Карты можно и сказать голосом («Сказать карты», ShowdownVoice.tsx): они ложатся в те же места по
// очереди, на табло уходят той же главной кнопкой; пока телефон слушает, кнопки внизу недоступны.
import { riverBustSuggestion } from '@domain/riverBusts.ts';
import { CARD_RANKS, CARD_SUITS, streetOf, visibleShowdown } from '@domain/showdown.ts';
import type { PlayerId } from '@domain/types.ts';
import { useState } from 'react';
import { newClientId } from '../../shared/api';
import { cardLabel, cardName, rankLabel, type SuitCode } from '../../shared/lib/poker';
import { STREET_LABEL } from '../../shared/lib/poker/display';
import { haptic } from '../../shared/telegram';
import { Button, PlayerPicker, PlayingCard, Sheet, SuitPip } from '../../shared/ui';
import { RiverBustsChoice } from './RiverBustsChoice';
import { useRiverChoice, type RiverBusts } from './useRiverBusts';
import { RIVER_ANSWER, riverBustLabel } from './riverBusts';
import {
  cardIn,
  checkDraft,
  clearSlot,
  draftFromShowdown,
  newShowdownDraft,
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
import { ShowdownVoice, type VoiceResult } from './ShowdownVoice';

export interface ShowdownSheetProps {
  open: boolean;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  /** Предложение вылета после ривера и его запись (useRiverBusts в LiveView). */
  river: RiverBusts;
  /** Открыта с пульта ради вылета после ривера: на этой раздаче, даже если табло её спрятало. */
  riverMode?: boolean;
  /** «Вылет и ребай» с пульта: у этих вылетевших «Сразу ребай» уже отмечен. */
  rebuyFor?: readonly PlayerId[];
}

export function ShowdownSheet(props: ShowdownSheetProps) {
  // Монтируется заново при каждом открытии: черновик — из раздачи, которая сейчас на табло.
  return props.open ? <ShowdownSheetInner {...props} /> : null;
}

/** Ранги сверху вниз: туз первым — как держат карты в руке. */
const GRID_RANKS = [...CARD_RANKS].reverse();
const GRID_SUITS = [...CARD_SUITS] as SuitCode[];
const BOARD_LABELS = ['Флоп', 'Флоп', 'Флоп', 'Тёрн', 'Ривер'];

function ShowdownSheetInner({
  onClose,
  model,
  actions,
  river,
  riverMode = false,
  rebuyFor,
}: ShowdownSheetProps) {
  const { state, nameOf, playersById, nowMs, applied } = model;
  const format = model.evening.format;
  const isAlive = (id: PlayerId) => Boolean(state.players[id]?.alive);
  const visible = visibleShowdown(state.showdown, nowMs);
  // С чего начать: раздача на табло; с пульта ради вылета после ривера — она же, даже спрятанная
  // табло; иначе новая — в хедз-апе вечера оба игрока уже отмечены, сразу их карты.
  const [start] = useState(() => {
    const hand = (riverMode ? river.showdown : null) ?? visible;
    const draft = hand
      ? draftFromShowdown(hand)
      : newShowdownDraft(newClientId(), state.joinOrder.filter(isAlive));
    return { draft, headsUp: !hand && draft.players.length === 2 };
  });
  const [draft, setDraft] = useState<ShowdownDraft>(start.draft);
  const [active, setActive] = useState<Slot | null>(() =>
    start.draft.players.length > 0 ? nextEmptySlot(start.draft, null) : null,
  );
  const [editPlayers, setEditPlayers] = useState(start.draft.players.length === 0);
  const [sending, setSending] = useState(false);
  // Итог последней фразы голосом: что легло — для «Отменить».
  const [voice, setVoice] = useState<VoiceResult | null>(null);
  // Телефон слушает фразу: её итог ляжет в черновик позже — пока не отправляем (иначе он лёг бы во
  // время отправки и остался неотправленным, а подсветка встала бы по отправленному черновику).
  const [listening, setListening] = useState(false);

  // Раздача этого черновика (после первой отправки — она же), пока она в состоянии вечера: на табло
  // или уже спрятанная им. Шторка, открытая на раздаче, её не теряет — ни когда табло вернулось к
  // таймеру, ни когда у предложения на пульте вышел срок; закрыли или начали новую — уже нет.
  const published = state.showdown?.showdownId === draft.showdownId ? state.showdown : null;
  const check = checkDraft(draft, nameOf);
  const payload = check.ok ? check.payload : null;
  const changed = payload !== null && !samePayload(payload, published);
  const domainProblem = payload && changed ? actions.check('showdown', payload) : null;
  const riverDone = published !== null && published.board.length === 5 && !changed;
  const used = usedCards(draft);
  const current = active ? cardIn(draft, active) : null;
  const busy = sending || actions.busy;
  // Кнопки внизу шторки: ещё и пока телефон слушает.
  const footerBusy = busy || listening;
  // После ривера: кто проиграл раздачу и ещё в игре — предложение записать вылет (здесь — и после
  // «Не записывать» на пульте: шторка открыта нарочно).
  const suggestion =
    riverDone && published ? riverBustSuggestion(published, isAlive, applied) : null;
  const choice = useRiverChoice(published, suggestion, isAlive, rebuyFor, format.buyInRub);
  const rebuyable = new Set(choice.byChips.filter((id) => river.canRebuyAfter(choice, id)));
  const rebuys = choice.rebuys.filter((id) => rebuyable.has(id));

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
    setVoice(null);
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
      // Карты на табло — снимать их голосовым «Отменить» поздно (отмена — в тосте).
      setVoice(null);
    }
  };

  const recordBusts = async () => {
    if (!published) return;
    setSending(true);
    const done = await river.record({
      showdownId: published.showdownId,
      byChips: choice.byChips,
      killers: choice.killers,
      rebuys,
      rebuyRub: choice.rebuyRub ?? format.buyInRub,
      paid: choice.paid,
    });
    setSending(false);
    // Записано — раздача закрыта (или скроется сама): шторке больше нечего показывать.
    if (done) onClose();
  };

  // Хватило всем: раздача закрывается без вылетов (тост — «… остаётся за столом»).
  const stayAll = async () => {
    if (!published || !suggestion) return;
    setSending(true);
    const done = await river.stay(published.showdownId, suggestion.victims);
    setSending(false);
    if (done) onClose();
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

  const hint = listening
    ? 'Телефон слушает — дождись конца фразы или нажми «Остановить».'
    : !check.ok
      ? draft.players.length === 0 && editPlayers
        ? 'Отметь, кто вскрылся, — потом их карты.'
        : check.reason
      : domainProblem
        ? domainProblem
        : riverDone && suggestion
          ? suggestion.victims.length === 1
            ? `Не хватило фишек — отметь игрока: запись закроет раздачу. Хватило — «${RIVER_ANSWER.stay}».`
            : `Отметь, кому не хватило фишек: запись закроет раздачу. Хватило всем — «${RIVER_ANSWER.stayAll}».`
          : riverDone
            ? published === visible
              ? 'Закрой раздачу — табло вернётся к таймеру (само — через 2 минуты после ривера). Поправить карту: нажми на неё выше.'
              : 'Закрой раздачу — она больше не нужна. Поправить карту: нажми на неё выше.'
            : null;

  const description = published
    ? published === visible
      ? `На табло — ${STREET_LABEL[streetOf(published.board.length)]}. Отмечай карты стола по мере выкладки.`
      : suggestion
        ? 'Табло уже вернулось к таймеру, а вылет по этой раздаче не записан.'
        : 'Табло уже вернулось к таймеру.'
    : start.headsUp && draft.players.length === 2 && !editPlayers
      ? 'В игре двое — оба отмечены. Отметь их карты — табло покажет руки, стол и шансы.'
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
                icon={rebuys.length > 0 ? 'refresh-cw' : 'user-x'}
                loading={sending}
                disabled={
                  footerBusy ||
                  choice.byChips.length === 0 ||
                  (rebuys.length > 0 && choice.rebuyRub === null)
                }
                onClick={() => void recordBusts()}
              >
                {riverBustLabel(
                  choice.byChips.map(nameOf),
                  rebuys.length,
                  choice.rebuyRub !== format.buyInRub ? choice.rebuyRub : null,
                )}
              </Button>
              <Button block icon="check" disabled={footerBusy} onClick={() => void stayAll()}>
                {suggestion.victims.length === 1 ? RIVER_ANSWER.stay : RIVER_ANSWER.stayAll}
              </Button>
            </>
          ) : riverDone ? (
            <Button
              variant="primary"
              block
              icon="check"
              loading={sending}
              disabled={footerBusy}
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
                disabled={footerBusy || !payload || !changed || Boolean(domainProblem)}
                onClick={() => void send()}
              >
                {sendLabel(payload, published)}
              </Button>
              {published && (
                <Button
                  variant="ghost"
                  block
                  disabled={footerBusy}
                  onClick={() => void closeShowdown()}
                >
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
          <RiverBustsChoice
            model={model}
            choice={choice}
            canRebuy={(id) => rebuyable.has(id)}
            disabled={busy}
          />
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

        {draft.players.length > 0 && (
          <ShowdownVoice
            draft={draft}
            active={active}
            nameOf={nameOf}
            disabled={busy}
            result={voice}
            onResult={setVoice}
            onDraft={(next, slot) => {
              setDraft(next);
              setActive(slot);
            }}
            onListening={setListening}
          />
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
