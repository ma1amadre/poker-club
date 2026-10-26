// Шторка «Бомб-пот» (миграция 030, решение 11): два касания — кнопка «Бомб-пот» на пульте и «Бросить
// кубик». В шторке видно, на какую раздачу объявляешь («Баттон — Миша · первое слово — Вова»), вилка
// взноса и кто платит; «Следующая» — раздача и бомб-пот одним действием (add_events), пока
// «Следующая раздача» вообще есть (баттон задан или уровень по раздачам) и нет вопроса после ривера.
// Кубик бросает сервер: клиент шлёт {}, взнос первым покажет табло (без табло — экраны вечера).
// «Следующая» при открытом бомб-поте — отказ (bombPotNextRefusal; то же правило у RPC): раздача
// закрыла бы его без «Кто забрал». Ключ повтора — по раздаче, которая была последней при первом
// нажатии в этой шторке (bombIntentKey): «Следующая» сама пишет раздачу, и повтор после тайм-аута с
// ключом по новой раздаче был бы новым действием, а не повтором.
import { canApplySequence, type EventDraft } from '@domain/replay.ts';
import { BOMB_POT_DRAFT, bombPotNextRefusal, bombPotRefusal } from '@domain/bombPot.ts';
import { useRef, useState } from 'react';
import { serverNow } from '../../shared/lib';
import { Button, Notice, Segmented, Sheet } from '../../shared/ui';
import { bombIntentKey, bombSheetView, type BombTarget } from './bombPotView';
import { handButton, HAND_RIVER_HOLD, stateAfter } from './seating';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

const HAND: EventDraft = { type: 'hand', payload: {} };

const TARGETS = [
  { value: 'this' as const, label: 'Эта раздача' },
  { value: 'next' as const, label: 'Следующая' },
];

export interface BombPotSheetProps {
  open: boolean;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  /** На пульте вопрос после ривера: «Следующая» закрыта (вылет записывается до раздачи). */
  riverPending: boolean;
  /** Табло на связи: кто первым покажет взнос (null — не известно). */
  boardOnline: boolean | null;
  /**
   * Объявить: на эту раздачу или на следующую; intentKey — добавка к ключу повтора (bombIntentKey).
   * true — записано.
   */
  onAnnounce: (target: BombTarget, intentKey: string) => Promise<boolean>;
}

export function BombPotSheet(props: BombPotSheetProps) {
  // Монтируется заново при каждом открытии: выбор раздачи — с начала («Эта раздача»).
  if (!props.open) return null;
  return <BombPotSheetBody {...props} />;
}

function BombPotSheetBody({
  open,
  onClose,
  model,
  actions,
  riverPending,
  boardOnline,
  onAnnounce,
}: BombPotSheetProps) {
  const { state, evening, events, nameOf } = model;
  const format = evening.format;
  const [target, setTarget] = useState<BombTarget>('this');
  const [sending, setSending] = useState(false);
  // «Следующая раздача» есть на пульте (баттон или уровень по раздачам) — можно объявить и на неё.
  const hand = handButton(state, riverPending);
  const nextShown = hand.show;
  const now = model.nowMs;
  const nextState = nextShown ? stateAfter(format, events, [HAND], now) : null;
  const shownState = target === 'next' && nextState ? nextState : state;
  const view = bombSheetView(shownState, nameOf);
  const refusal =
    target === 'next'
      ? (hand.hold ??
        bombPotNextRefusal(state) ??
        canApplySequence(format, events, [HAND, BOMB_POT_DRAFT], serverNow())?.message ??
        null)
      : bombPotRefusal(state);
  // Ключ «Следующей» — по раздаче до первого нажатия: повтор после тайм-аута — тот же ключ, даже
  // если раздача этого нажатия уже пришла в журнал. «Эта раздача» раздачу не пишет — её ключ по
  // последней раздаче сейчас (раздачу могли записать с другого телефона, пока шторка открыта).
  const nextKey = useRef<string | null>(null);

  const announce = async () => {
    setSending(true);
    let key = bombIntentKey(model.applied);
    if (target === 'next') {
      nextKey.current ??= key;
      key = nextKey.current;
    }
    const ok = await onAnnounce(target, key);
    setSending(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Бомб-пот"
      description="Все в игре ставят одинаковый взнос — от 1 до 5 BB, выпадет случайно. Блайндов и анте в этой раздаче нет, префлопа нет — флоп сразу."
      dismissible={!sending}
      actions={
        <Button
          variant="primary"
          block
          size="lg"
          icon="bomb"
          loading={sending}
          disabled={actions.busy || refusal !== null}
          onClick={() => void announce()}
        >
          Бросить кубик
        </Button>
      }
    >
      <div className="ev-bomb-sheet">
        {nextShown && (
          <Segmented
            options={TARGETS}
            value={target}
            onChange={setTarget}
            label="На какую раздачу"
            block
          />
        )}
        <div className="ev-bomb-sheet__facts">
          <p className="m-body">{view.positions}</p>
          <p className="m-mono ev-bomb-sheet__range">{view.range}</p>
          <p className="m-small">{view.players}</p>
        </div>
        {refusal ? (
          <Notice tone="caution" title="Сейчас не объявить">
            {target === 'next' && refusal === HAND_RIVER_HOLD
              ? 'Сначала ответь, хватило ли фишек: вылет записывается до следующей раздачи.'
              : refusal}
          </Notice>
        ) : (
          <p className="m-small ev-bomb-sheet__note">
            {boardOnline === false
              ? 'Кубик бросает сервер. Табло не на связи — взнос разыграют экраны вечера.'
              : 'Кубик бросает сервер. Взнос первым покажет табло, телефоны — через несколько секунд.'}
          </p>
        )}
      </div>
    </Sheet>
  );
}
