// Пульт одного игрока у банкира: «Отметить вылет» для живого и «Записать ребай» для вылетевшего,
// пока ребаи открыты. Кто выбил — набор: отмеченные двое и больше и есть «выбили вместе» (нокаут
// каждому), переключателя дележа нет — второй тап добавляет, а не молча заменяет первого. «Никто /
// не знаю» — отдельная кнопка. В хедз-апе соперник отмечен заранее. Ребай — любой суммой (миграция
// 027): быстрые кнопки «500 / 1 000 / 1 500» и «Другая сумма…», по умолчанию — вход формата. Нокаут —
// только статистика, денег за голову нет.
// Пока игрок может докупиться, в шторке вылета — «Вылет и ребай» одной кнопкой (одно действие,
// одна транзакция add_events), а в тосте после простого вылета — «Ребай» (открывает эту же шторку
// ребая). «Оплачено сразу» у ребая — платёж на сумму ребая тем же действием (по умолчанию выключено).
// Вылет оставил в игре одного при закрытых ребаях — в тосте «Завершить вечер» (с прежним вопросом).
import { entryAmounts, entryPayload } from '@domain/money.ts';
import { canApplySequence } from '@domain/replay.ts';
import type { PlayerState } from '@domain/types.ts';
import { useState } from 'react';
import { formatNumber, formatRub, joinNames, NBSP, plural } from '../../shared/lib';
import { Button, FieldGroup, Notice, PlayerPicker, Sheet } from '../../shared/ui';
import { AmountPicker, PaidNowCheckbox } from './AmountPicker';
import {
  bustButtonLabel,
  bustRebuyDrafts,
  bustRebuyLabel,
  finishDueAfter,
  LAST_ONE_NOTE,
  initialKillers,
  killersHint,
  playerLine,
  possibleKillers,
  rebuyDrafts,
  rebuyWindow,
} from './lib';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

/** Меньше — предупреждаем, что ребай может не успеть до закрытия. */
const REBUY_EDGE_MS = 10_000;

export interface PlayerSheetProps {
  player: PlayerState | null;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  /** «Ребай» в тосте после вылета: открыть шторку ребая этого игрока. */
  onRebuy?: (playerId: string) => void;
  /** «Завершить вечер» в тосте после последнего вылета (ребаи закрыты). */
  onFinish?: () => void;
}

export function PlayerSheet({ player, ...rest }: PlayerSheetProps) {
  // key: при выборе другого игрока форма начинается с чистого листа.
  return player ? <PlayerSheetInner key={player.playerId} player={player} {...rest} /> : null;
}

function PlayerSheetInner({
  player,
  onClose,
  model,
  actions,
  onRebuy,
  onFinish,
}: Omit<PlayerSheetProps, 'player'> & { player: PlayerState }) {
  const { state, nameOf, playersById, evening } = model;
  const name = nameOf(player.playerId);
  // Свежая версия игрока: пока шторка открыта, журнал мог измениться (Realtime).
  const current = state.players[player.playerId] ?? player;
  // Режим шторки фиксируется при открытии. Если второй оператор успел записать вылет этого же
  // игрока, «Отметить вылет» не должна под пальцем превратиться в «Записать ребай».
  const [mode] = useState<'bust' | 'rebuy'>(player.alive ? 'bust' : 'rebuy');

  const [killers, setKillers] = useState<string[]>(() => initialKillers(state, player.playerId));
  const [unknown, setUnknown] = useState(false);
  // Сумма ребая: по умолчанию — вход формата; null — в поле «Другая сумма» неверное значение.
  const [rub, setRub] = useState<number | null>(evening.format.buyInRub);
  const [paid, setPaid] = useState(false);
  // Какое действие уходит: спиннер — на нажатой кнопке, остальные кнопки гаснут.
  const [sending, setSending] = useState<'bust' | 'bust_rebuy' | 'rebuy' | null>(null);
  // Своя попытка не получила ответа (ошибка, тайм-аут): если запись всё же появится в журнале, это,
  // скорее всего, она, а не второе устройство.
  const [unanswered, setUnanswered] = useState(false);
  const format = evening.format;
  const rebuyAmounts = rub === null ? null : entryAmounts(format, rub);
  // Пока идёт своя отправка, статус меняет наша же запись — это не «чужая» правка.
  const overtaken = sending === null && (mode === 'bust') !== current.alive;

  const alive = possibleKillers(state, current.playerId).map((id) => ({
    id,
    display_name: nameOf(id),
    photo_url: playersById.get(id)?.photo_url ?? null,
  }));

  // Отмеченный, который успел вылететь (Realtime, второй оператор), в запись не идёт.
  const by = unknown ? [] : killers.filter((id) => alive.some((p) => p.id === id));
  const bustPayload = { playerId: current.playerId, by };
  const bustProblem = current.alive ? actions.check('bust', bustPayload) : null;
  // Неверная сумма в поле — ребай не записать; правила ребая проверяем на сумме входа формата.
  const rebuyPayload = entryPayload(format, current.playerId, rub ?? format.buyInRub);
  const rebuyProblem = current.alive ? null : actions.check('rebuy', rebuyPayload);
  const ready = unknown || by.length > 0;
  // Ребаи вот-вот закроются: запись, отправленная сейчас, может прийти на сервер уже после.
  const win = rebuyWindow(format, state);
  const closingSoon = win.kind === 'open' && win.msLeft !== null && win.msLeft < REBUY_EDGE_MS;
  // Докупится ли игрок сразу после этого вылета: цепочка «вылет → ребай» по правилам replay (вылет
  // может сам сменить уровень и закрыть ребаи, лимит ребаев мог кончиться).
  const rebuyAfterBust =
    mode === 'bust' &&
    canApplySequence(
      format,
      model.events,
      bustRebuyDrafts(format, { playerId: current.playerId, by: [] }, format.buyInRub, false),
      model.nowMs,
    ) === null;

  const killersDetail =
    by.length === 0
      ? 'Кто выбил — не указано.'
      : `${by.length > 1 ? 'Выбивают' : 'Выбивает'} ${joinNames(by.map(nameOf))}.`;
  // «Ребай на 700 ₽ оплачен сразу.» / «Ребай оплачен сразу: 500 ₽.» / «Ребай на 700 ₽.»
  const custom = rub !== null && rub !== format.buyInRub;
  const rebuySum = formatRub(rub ?? format.buyInRub);
  const rebuyDetail = paid
    ? custom
      ? `Ребай на ${rebuySum} оплачен сразу.`
      : `Ребай оплачен сразу: ${rebuySum}.`
    : custom
      ? `Ребай на ${rebuySum}.`
      : '';

  /**
   * Отправка из шторки. Записано — шторка закрывается. Записано, но журнал принял не всё (ребай
   * пришёл после закрытия) — тоже: тост уже объяснил, что принято, а что нет, повторять нечего, и
   * «Вылет уже записан… первая попытка дошла» здесь было бы неправдой. Иначе (отказ до отправки,
   * ошибка, тайм-аут) шторка остаётся, а запись, которая появится в журнале, — скорее всего, своя.
   */
  const run = async (
    kind: NonNullable<typeof sending>,
    act: (onRejected: () => void) => Promise<unknown>,
  ) => {
    setSending(kind);
    const outcome = { rejected: false };
    const done = await act(() => {
      outcome.rejected = true;
    });
    setSending(null);
    if (done || outcome.rejected) onClose();
    else setUnanswered(true);
  };

  const bust = () => {
    const playerId = current.playerId;
    // Остался один, ребаи закрыты — вечер пора завершать (ребай тогда невозможен).
    const finishAfter =
      onFinish !== undefined &&
      !rebuyAfterBust &&
      finishDueAfter(format, model.events, [{ type: 'bust', payload: bustPayload }], model.nowMs);
    return run('bust', (onRejected) =>
      actions.send('bust', bustPayload, {
        success: `Вылет записан: ${name}`,
        detail: finishAfter ? `${killersDetail} ${LAST_ONE_NOTE}` : killersDetail,
        undo: true,
        // У тоста одна кнопка (одним глаголом): пока игрок может докупиться — «Ребай», остался
        // один при закрытых ребаях — «Завершить» (вопрос «Завершить вечер?» — прежний). Ошибочный
        // вылет отменяется «Отменить последнее» в пульте или из ленты.
        action:
          onRebuy && rebuyAfterBust
            ? { label: 'Ребай', onClick: () => onRebuy(playerId) }
            : onFinish && finishAfter
              ? { label: 'Завершить', onClick: () => onFinish() }
              : undefined,
        onRejected,
      }),
    );
  };

  const bustAndRebuy = () =>
    run('bust_rebuy', (onRejected) =>
      actions.sendAll(bustRebuyDrafts(format, bustPayload, rub ?? format.buyInRub, paid), {
        success: `Вылет и ребай: ${name}`,
        detail: [killersDetail, rebuyDetail].filter(Boolean).join(' '),
        undo: true,
        onRejected,
      }),
    );

  const rebuy = () =>
    run('rebuy', (onRejected) => {
      const options = {
        success: `Ребай записан: ${name}`,
        detail: rebuyDetail || undefined,
        undo: true,
        onRejected,
      };
      return paid
        ? actions.sendAll(
            rebuyDrafts(format, current.playerId, rub ?? format.buyInRub, true),
            options,
          )
        : actions.send('rebuy', rebuyPayload, options);
    });

  const line = playerLine(current, format);
  const description = [current.alive ? 'В игре' : 'Вне игры', line].filter(Boolean).join(' · ');

  if (overtaken) {
    return (
      <Sheet open onClose={onClose} title={name} description={description}>
        <div className="ev-sheet-body">
          <Notice tone="info" title={mode === 'bust' ? 'Вылет уже записан' : 'Ребай уже записан'}>
            {unanswered
              ? `${mode === 'bust' ? 'Вылет' : 'Ребай'} игрока ${name} уже в журнале: похоже, первая попытка дошла до сервера, хотя ответа не было. Повторять не нужно — проверь запись в ленте.`
              : mode === 'bust'
                ? `Пока шторка была открыта, вылет игрока ${name} записали с другого устройства. Проверь запись в ленте.`
                : `Пока шторка была открыта, ребай игрока ${name} записали с другого устройства. Проверь запись в ленте.`}
          </Notice>
        </div>
      </Sheet>
    );
  }

  if (mode === 'bust') {
    return (
      <Sheet
        open
        onClose={onClose}
        dismissible={sending === null}
        title={`Вылет: ${name}`}
        description={description}
        actions={
          <>
            <Button
              variant="primary"
              block
              icon="user-x"
              loading={sending === 'bust'}
              disabled={sending !== null || !ready || Boolean(bustProblem)}
              onClick={() => void bust()}
            >
              {bustButtonLabel(by.length, unknown)}
            </Button>
            {rebuyAfterBust && (
              <Button
                block
                icon="refresh-cw"
                loading={sending === 'bust_rebuy'}
                disabled={sending !== null || !ready || Boolean(bustProblem) || rub === null}
                onClick={() => void bustAndRebuy()}
              >
                {bustRebuyLabel(format, rub)}
              </Button>
            )}
          </>
        }
      >
        <div className="ev-sheet-body">
          {bustProblem && ready ? (
            <Notice tone="caution" title="Вылет сейчас не записать">
              {bustProblem}.
            </Notice>
          ) : null}
          <FieldGroup label="Кто выбил" hint={killersHint(by.map(nameOf), unknown)}>
            {alive.length > 0 ? (
              <PlayerPicker
                players={alive}
                value={by}
                onChange={(ids) => {
                  setUnknown(false);
                  setKillers(ids);
                }}
                max={alive.length}
                showCount={false}
              />
            ) : (
              <p className="m-small">Других игроков в игре нет.</p>
            )}
          </FieldGroup>
          <Button
            block
            className="ev-nobody"
            icon={unknown ? 'check' : 'minus'}
            aria-pressed={unknown}
            onClick={() => {
              setUnknown((on) => !on);
              setKillers([]);
            }}
          >
            Никто / не знаю, кто выбил
          </Button>
          {rebuyAfterBust && (
            <div className="ev-rebuy-now">
              {/* Та же гонка, что у шторки ребая: вылет придёт вовремя, а ребай — уже после. */}
              {closingSoon && (
                <Notice tone="caution" title="Ребаи закрываются">
                  Осталось меньше {Math.ceil(REBUY_EDGE_MS / 1000)} секунд. «Вылет и ребай» может
                  прийти на сервер уже после закрытия — тогда вылет запишется, а ребай журнал не
                  примет, и об этом появится сообщение.
                </Notice>
              )}
              <AmountPicker
                format={format}
                value={rub}
                onChange={setRub}
                label="Ребай"
                note="Для «Вылет и ребай»: игрок сразу докупается и остаётся за столом."
                disabled={sending !== null}
              />
              <PaidNowCheckbox
                checked={paid}
                onChange={setPaid}
                kind="rebuy"
                rub={rub}
                disabled={sending !== null}
              />
            </div>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={sending === null}
      title={name}
      description={description}
      actions={
        rebuyProblem ? undefined : (
          <Button
            variant="primary"
            block
            icon="refresh-cw"
            loading={sending === 'rebuy'}
            disabled={rub === null}
            onClick={() => void rebuy()}
          >
            {rub !== null && rub !== format.buyInRub
              ? `Записать ребай · ${formatRub(rub)}`
              : 'Записать ребай'}
          </Button>
        )
      }
    >
      <div className="ev-sheet-body">
        {!rebuyProblem && closingSoon && (
          <Notice tone="caution" title="Ребаи закрываются">
            Осталось меньше {Math.ceil(REBUY_EDGE_MS / 1000)} секунд. Запись может прийти на сервер
            уже после закрытия — тогда журнал её не примет, и об этом появится сообщение.
          </Notice>
        )}
        {rebuyProblem ? (
          <Notice tone="info" title="Ребай не записать">
            {rebuyProblem}.
          </Notice>
        ) : (
          <>
            <AmountPicker
              format={format}
              value={rub}
              onChange={setRub}
              label="Ребай"
              disabled={sending !== null}
            />
            <p className="m-body">
              {rebuyAmounts ? (
                <>
                  Ещё {formatRub(rebuyAmounts.rub)} банкиру и {formatNumber(rebuyAmounts.chips)}
                  {NBSP}
                  {plural(rebuyAmounts.chips, ['фишка', 'фишки', 'фишек'])} — игрок возвращается за
                  стол.
                </>
              ) : (
                'Впиши сумму ребая — игрок возвращается за стол.'
              )}
              {current.rebuys > 0 ? ` Ребаев у игрока: ${current.rebuys}.` : ''}
            </p>
            <PaidNowCheckbox
              checked={paid}
              onChange={setPaid}
              kind="rebuy"
              rub={rub}
              disabled={sending !== null}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}
