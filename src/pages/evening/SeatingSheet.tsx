// Шторка «Рассадка» (миграция 028): десять мест по номерам сукна, кто на них и позиции раздачи.
// Два вида — «Места» и «Баттон» (переключатель вверху):
// - «Места»: касание пустого места (или места вылетевшего) — кого посадить: сначала игроки в игре без
//   места, затем пересадка сидящих; касание места игрока в игре — куда его пересадить. «Рассадить
//   случайно» — всех в игре без места на случайные свободные места одной записью действия
//   (add_events), тост с «Отменить».
// - «Баттон»: касание места игрока в игре — баттон туда; «Разыграть» — случайно среди сидящих в игре.
// Случай — на клиенте (Math.random), в журнал ложатся обычные записи 'seat' и 'button'. Каждая
// запись — тост с «Отменить»; что примет журнал, решает домен (canApply). Открытая касанием игрока
// из ряда «Без места» — сразу выбор места для него, после записи шторка закрывается.
// Жребий, ушедший без ответа (тайм-аут, ошибка сети), повтор нажатия отправляет тот же (pendingDraws):
// ключ повтора строится из записей, и новый жребий задвоил бы дошедшую рассадку.
import type { EventDraft } from '@domain/replay.ts';
import { drawButtonSeat, randomSeating, tablePositions } from '@domain/seats.ts';
import type { PlayerId } from '@domain/types.ts';
import { useState } from 'react';
import { cn, NBSP, serverNow } from '../../shared/lib';
import { Button, List, ListItem, Notice, Segmented, Sheet, useToast } from '../../shared/ui';
import { roleTag, seatNo } from './lib';
import {
  buttonToast,
  positionsText,
  randomSeatingToast,
  repeatButtonDraw,
  repeatSeating,
  seatCells,
  seatChoices,
  seatTargets,
  seatToast,
  type SeatCell,
} from './seating';
import './seating.css';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface SeatingSheetProps {
  open: boolean;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  /** Открыта касанием игрока без места: сразу выбор места для него. */
  playerId?: PlayerId | null;
}

export function SeatingSheet(props: SeatingSheetProps) {
  // Внутренняя часть монтируется заново при каждом открытии: шаг и вид — с чистого листа.
  return props.open ? <SeatingSheetInner {...props} /> : null;
}

/**
 * Жребий, отправленный без ответа, по вечерам: «Рассадить случайно» и «Разыграть баттон». Повтор
 * нажатия берёт его же, пока он годится (repeatSeating, repeatButtonDraw), — тогда совпадёт ключ
 * повтора, и дошедшее без ответа сервер вернёт, а не запишет второй раз. Забывается, когда запись
 * прошла (или журнал её не принял); переживает закрытие шторки и смену вида пульта.
 */
const pendingDraws = new Map<string, { seating?: EventDraft[]; button?: number }>();

function forgetDraw(eveningId: string, kind: 'seating' | 'button') {
  const rest = { ...pendingDraws.get(eveningId) };
  delete rest[kind];
  if (rest.seating || rest.button !== undefined) pendingDraws.set(eveningId, rest);
  else pendingDraws.delete(eveningId);
}

function rememberDraw(eveningId: string, draw: { seating?: EventDraft[]; button?: number }) {
  pendingDraws.set(eveningId, { ...pendingDraws.get(eveningId), ...draw });
}

type Mode = 'seats' | 'button';
type Step =
  { kind: 'table' } | { kind: 'seat'; seat: number } | { kind: 'player'; playerId: string };

const MODE_OPTIONS = [
  { value: 'seats' as const, label: 'Места' },
  { value: 'button' as const, label: 'Баттон' },
];

function SeatingSheetInner({ onClose, model, actions, playerId }: SeatingSheetProps) {
  const { state, nameOf, evening } = model;
  const format = evening.format;
  const toast = useToast();
  const positions = tablePositions(state);
  const cells = seatCells(state);
  const aliveSeated = cells.filter((c) => c.playerId !== null && c.alive).length;
  const unseated = positions.unseatedAlive;
  // Все в игре на местах, а баттона нет — сразу к баттону.
  const [mode, setMode] = useState<Mode>(() =>
    unseated.length === 0 && aliveSeated >= 2 && state.buttonSeat === null ? 'button' : 'seats',
  );
  const [step, setStep] = useState<Step>(() =>
    playerId ? { kind: 'player', playerId } : { kind: 'table' },
  );
  const [sending, setSending] = useState(false);
  const busy = sending || actions.busy;
  const fromRow = Boolean(playerId);

  const seat = async (who: PlayerId, to: number) => {
    const text = seatToast(actions.freshState(), who, to, nameOf);
    setSending(true);
    const record = await actions.send(
      'seat',
      { playerId: who, seat: to },
      { success: text.title, detail: text.detail ?? undefined, undo: true },
    );
    setSending(false);
    if (!record) return;
    if (fromRow) onClose();
    else setStep({ kind: 'table' });
  };

  /** Баттон на место to; drawn — разыгран: до ответа сервера жребий помнится (pendingDraws). */
  const setButton = async (to: number, drawn = false) => {
    const text = buttonToast(actions.freshState(), to, nameOf);
    if (drawn) rememberDraw(evening.id, { button: to });
    const outcome = { rejected: false };
    setSending(true);
    const record = await actions.send(
      'button',
      { seat: to },
      {
        success: text.title,
        detail: text.detail ?? undefined,
        undo: true,
        onRejected: () => {
          outcome.rejected = true;
        },
      },
    );
    setSending(false);
    // Баттон записан (разыгранный или выбранный касанием) — прежний жребий больше не нужен.
    if (record || outcome.rejected) forgetDraw(evening.id, 'button');
    if (record) onClose();
  };

  const seatRandomly = async () => {
    const fresh = actions.freshState();
    // Прошлый жребий ушёл без ответа — тот же пакет (тот же ключ повтора), пока он годится.
    const drafts =
      repeatSeating(
        pendingDraws.get(evening.id)?.seating ?? null,
        format,
        model.events,
        serverNow(),
      ) ?? randomSeating(fresh, Math.random);
    if (drafts.length === 0) {
      toast.show('Свободных мест нет', {
        tone: 'caution',
        detail: 'Все места заняты игроками в игре.',
      });
      return;
    }
    const text = randomSeatingToast(fresh, drafts, nameOf);
    rememberDraw(evening.id, { seating: drafts });
    const outcome = { rejected: false };
    setSending(true);
    const records = await actions.sendAll(drafts, {
      success: text.title,
      detail: text.detail ?? undefined,
      undo: true,
      onRejected: () => {
        outcome.rejected = true;
      },
    });
    setSending(false);
    if (records || outcome.rejected) forgetDraw(evening.id, 'seating');
    // Рассадили, а баттона нет — дальше выбор баттона.
    if (records && actions.freshState().buttonSeat === null) setMode('button');
  };

  const drawButton = () => {
    const fresh = actions.freshState();
    const to =
      repeatButtonDraw(pendingDraws.get(evening.id)?.button ?? null, format, fresh) ??
      drawButtonSeat(fresh, Math.random);
    if (to !== null) void setButton(to, true);
  };

  if (step.kind === 'seat') {
    return (
      <SeatStep
        seat={step.seat}
        model={model}
        busy={busy}
        onBack={() => setStep({ kind: 'table' })}
        onClose={onClose}
        onPick={(who) => void seat(who, step.seat)}
      />
    );
  }

  if (step.kind === 'player') {
    const who = step.playerId;
    const targets = new Set(seatTargets(format, state, who));
    const current = state.players[who]?.seat ?? null;
    const name = nameOf(who);
    return (
      <Sheet
        open
        onClose={onClose}
        dismissible={!sending}
        title={`Куда садится ${name}`}
        description={
          current === null
            ? 'Свободные места и места тех, кто вне игры: вылетевший место теряет. Номера — как на сукне, по часовой.'
            : `Сейчас — место ${current}. Пересадка на свободное место или место того, кто вне игры.`
        }
        actions={
          fromRow ? undefined : (
            <Button
              variant="ghost"
              block
              icon="arrow-left"
              onClick={() => setStep({ kind: 'table' })}
            >
              Назад к столу
            </Button>
          )
        }
      >
        <SeatGrid
          cells={cells}
          nameOf={nameOf}
          level={state.currentLevel}
          buttonSeat={state.buttonSeat}
          current={current}
          enabled={(c) => !busy && targets.has(c.seat)}
          label={(c) => cellLabel(c, nameOf, `${name} — сесть сюда`)}
          onPick={(c) => void seat(who, c.seat)}
        />
        {targets.size === 0 && (
          <p className="m-small">Свободных мест нет: все места заняты игроками в игре.</p>
        )}
      </Sheet>
    );
  }

  const line = positionsText(positions, nameOf);
  const unseatedNames = unseated.map(nameOf);

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!sending}
      title="Рассадка"
      description={
        mode === 'seats'
          ? 'Номера — как на сукне, растут по часовой. Нажми на свободное место — кого посадить, на место игрока — куда пересадить.'
          : 'Нажми на место игрока, у которого баттон, или разыграй баттон случайно. Дальше баттон двигает «Следующая раздача».'
      }
      actions={
        mode === 'seats' ? (
          unseated.length > 0 ? (
            <Button
              variant="primary"
              block
              icon="users"
              loading={sending}
              disabled={busy}
              onClick={() => void seatRandomly()}
            >
              Рассадить случайно
            </Button>
          ) : (
            <Button block onClick={onClose}>
              Готово
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            block
            icon="zap"
            loading={sending}
            disabled={busy || aliveSeated < 2}
            onClick={drawButton}
          >
            Разыграть баттон
          </Button>
        )
      }
    >
      <div className="ev-seating">
        <Segmented
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          label="Что выбрать"
          block
        />
        <div className="ev-seating__status">
          <p className="m-small">
            {unseated.length > 0
              ? `Без места: ${unseatedNames.join(', ')}.`
              : aliveSeated > 0
                ? 'Все в игре — на местах.'
                : 'Пока никто не сидит на месте.'}
          </p>
          <p className="m-small">
            {line ??
              (state.buttonSeat !== null
                ? `Баттон — место${NBSP}${state.buttonSeat}.`
                : 'Баттон не задан.')}
          </p>
        </div>
        {mode === 'button' && aliveSeated < 2 && (
          <Notice tone="info" title="Сначала рассадка">
            Баттон ставят на место игрока в игре, а позиции считаются, когда на местах хотя бы двое.
          </Notice>
        )}
        <SeatGrid
          cells={cells}
          nameOf={nameOf}
          level={state.currentLevel}
          buttonSeat={state.buttonSeat}
          current={mode === 'button' ? state.buttonSeat : null}
          enabled={(c) =>
            !busy &&
            (mode === 'seats' ||
              // Баттон — на место игрока в игре; туда, где он уже стоит, второй записи не нужно.
              (c.playerId !== null && c.alive && c.seat !== state.buttonSeat))
          }
          label={(c) =>
            cellLabel(
              c,
              nameOf,
              mode === 'button'
                ? 'баттон сюда'
                : c.playerId !== null && c.alive
                  ? 'пересадить'
                  : 'кого посадить',
            )
          }
          onPick={(c) => {
            if (mode === 'button') void setButton(c.seat);
            else if (c.playerId !== null && c.alive)
              setStep({ kind: 'player', playerId: c.playerId });
            else setStep({ kind: 'seat', seat: c.seat });
          }}
        />
      </div>
    </Sheet>
  );
}

/** Подпись ячейки для скринридера: «Место 3, Саша, баттон: пересадить». */
function cellLabel(c: SeatCell, nameOf: (id: string) => string, action: string): string {
  const who =
    c.playerId === null ? 'свободно' : `${nameOf(c.playerId)}${c.alive ? '' : ', вне игры'}`;
  const roles = c.roles.map((r) => (r === 'D' ? 'баттон' : r)).join(' и ');
  return `Место ${c.seat}, ${who}${roles ? `, ${roles}` : ''}: ${action}`;
}

/**
 * Десять мест ячейками: номер двумя знаками и позиция (D, SB 25, BB 50), имя прописными, «свободно»
 * пунктиром, вылетевший — приглушённо с «вне игры». current — выбранное место (баттон в виде
 * «Баттон», нынешнее место при пересадке).
 */
function SeatGrid({
  cells,
  nameOf,
  level,
  buttonSeat,
  current,
  enabled,
  label,
  onPick,
}: {
  cells: SeatCell[];
  nameOf: (id: string) => string;
  level: { sb: number; bb: number };
  buttonSeat: number | null;
  current: number | null;
  enabled: (cell: SeatCell) => boolean;
  label: (cell: SeatCell) => string;
  onPick: (cell: SeatCell) => void;
}) {
  return (
    <ul className="ev-cells" aria-label="Места за столом">
      {cells.map((c) => {
        const tag = roleTag(c.roles, level);
        const empty = c.playerId === null;
        return (
          <li key={c.seat}>
            <button
              type="button"
              className={cn(
                'ev-cell',
                empty && 'ev-cell--empty',
                !empty && !c.alive && 'ev-cell--out',
                c.seat === current && 'ev-cell--current',
              )}
              disabled={!enabled(c)}
              aria-label={label(c)}
              aria-pressed={c.seat === current ? true : undefined}
              onClick={() => onPick(c)}
            >
              <span className="ev-cell__head">
                <span className="ev-cell__no">{seatNo(c.seat)}</span>
                {tag ? (
                  <span className="ev-cell__pos">{tag}</span>
                ) : (
                  c.seat === buttonSeat && (
                    <span className="ev-cell__pos ev-cell__pos--idle">D</span>
                  )
                )}
              </span>
              <span className="ev-cell__name">
                {c.playerId === null ? 'свободно' : nameOf(c.playerId)}
              </span>
              {!empty && !c.alive && <span className="ev-cell__note">вне игры</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Кого посадить на место: сначала игроки в игре без места, затем пересадка сидящих («сейчас место
 * 5»). Место вылетевшего — с пометкой: он место потеряет.
 */
function SeatStep({
  seat,
  model,
  busy,
  onBack,
  onClose,
  onPick,
}: {
  seat: number;
  model: EveningModel;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  onPick: (playerId: PlayerId) => void;
}) {
  const { state, nameOf } = model;
  const choices = seatChoices(state, seat);
  const holder = seatCells(state).find((c) => c.seat === seat);
  const outHolder = holder?.playerId && !holder.alive ? holder.playerId : null;
  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Место ${seat}: кто садится`}
      description={
        outHolder
          ? `Здесь сидит ${nameOf(outHolder)} — вне игры: место займёт новый игрок, а ${nameOf(outHolder)} останется без места.`
          : 'Сначала — игроки в игре без места, ниже — пересадка тех, кто уже сидит.'
      }
      actions={
        <Button variant="ghost" block icon="arrow-left" onClick={onBack}>
          Назад к столу
        </Button>
      }
    >
      {choices.length > 0 ? (
        <List aria-label={`Кого посадить на место ${seat}`}>
          {choices.map((c) => (
            <ListItem
              key={c.playerId}
              title={<span className="ui-name">{nameOf(c.playerId)}</span>}
              subtitle={c.from === null ? 'без места' : `сейчас место ${c.from}`}
              disabled={busy}
              onClick={() => onPick(c.playerId)}
            />
          ))}
        </List>
      ) : (
        <p className="m-small">
          {holder?.alive
            ? 'Место занято игроком в игре.'
            : 'Некого посадить: все в игре уже на местах.'}
        </p>
      )}
    </Sheet>
  );
}
