// Пульт одного игрока у банкира: «Отметить вылет» для живого и «Записать ребай» для вылетевшего,
// пока ребаи открыты. Кто выбил — набор: отмеченные двое и больше и есть «выбили вместе» (нокаут
// каждому), переключателя дележа нет — второй тап добавляет, а не молча заменяет первого. «Никто /
// не знаю» — отдельная кнопка. В хедз-апе соперник отмечен заранее. Ребай — с выбором кратности
// (×1 по умолчанию). Нокаут — только статистика, денег за голову нет.
import { entryAmounts } from '@domain/money.ts';
import type { PlayerState } from '@domain/types.ts';
import { useState } from 'react';
import { formatNumber, formatRub, joinNames, NBSP, plural } from '../../shared/lib';
import { Button, FieldGroup, Notice, PlayerPicker, Sheet } from '../../shared/ui';
import {
  bustButtonLabel,
  entryPayload,
  initialKillers,
  killersHint,
  playerLine,
  possibleKillers,
  rebuyWindow,
} from './lib';
import { StacksPicker } from './StacksPicker';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

/** Меньше — предупреждаем, что ребай может не успеть до закрытия. */
const REBUY_EDGE_MS = 10_000;

export interface PlayerSheetProps {
  player: PlayerState | null;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
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
  const [stacks, setStacks] = useState(1);
  const [sending, setSending] = useState(false);
  // Своя попытка не получила ответа (ошибка, тайм-аут): если запись всё же появится в журнале, это,
  // скорее всего, она, а не второе устройство.
  const [unanswered, setUnanswered] = useState(false);
  const format = evening.format;
  const rebuyAmounts = entryAmounts(format, stacks);
  // Пока идёт своя отправка, статус меняет наша же запись — это не «чужая» правка.
  const overtaken = !sending && (mode === 'bust') !== current.alive;

  const alive = possibleKillers(state, current.playerId).map((id) => ({
    id,
    display_name: nameOf(id),
    photo_url: playersById.get(id)?.photo_url ?? null,
  }));

  // Отмеченный, который успел вылететь (Realtime, второй оператор), в запись не идёт.
  const by = unknown ? [] : killers.filter((id) => alive.some((p) => p.id === id));
  const bustPayload = { playerId: current.playerId, by };
  const bustProblem = current.alive ? actions.check('bust', bustPayload) : null;
  const rebuyPayload = entryPayload(current.playerId, stacks);
  const rebuyProblem = current.alive ? null : actions.check('rebuy', rebuyPayload);
  const ready = unknown || by.length > 0;
  // Ребаи вот-вот закроются: запись, отправленная сейчас, может прийти на сервер уже после.
  const win = rebuyWindow(format, state);
  const closingSoon = win.kind === 'open' && win.msLeft !== null && win.msLeft < REBUY_EDGE_MS;

  const bust = async () => {
    setSending(true);
    const record = await actions.send('bust', bustPayload, {
      success: `Вылет записан: ${name}`,
      detail:
        by.length === 0
          ? 'Кто выбил — не указано.'
          : `${by.length > 1 ? 'Выбивают' : 'Выбивает'} ${joinNames(by.map(nameOf))}.`,
      undo: true,
    });
    setSending(false);
    if (record) onClose();
    else setUnanswered(true);
  };

  const rebuy = async () => {
    setSending(true);
    const record = await actions.send('rebuy', rebuyPayload, {
      success: `Ребай записан: ${name}`,
      detail: stacks > 1 ? `Ребай на ${formatRub(rebuyAmounts.rub)}.` : undefined,
      undo: true,
    });
    setSending(false);
    if (record) onClose();
    else setUnanswered(true);
  };

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
        dismissible={!sending}
        title={`Вылет: ${name}`}
        description={description}
        actions={
          <Button
            variant="primary"
            block
            icon="user-x"
            loading={sending}
            disabled={!ready || Boolean(bustProblem)}
            onClick={() => void bust()}
          >
            {bustButtonLabel(by.length, unknown)}
          </Button>
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
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!sending}
      title={name}
      description={description}
      actions={
        rebuyProblem ? undefined : (
          <Button
            variant="primary"
            block
            icon="refresh-cw"
            loading={sending}
            onClick={() => void rebuy()}
          >
            Записать ребай
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
            <StacksPicker
              format={format}
              value={stacks}
              onChange={setStacks}
              label="Ребай"
              disabled={sending}
            />
            <p className="m-body">
              Ещё {formatRub(rebuyAmounts.rub)} банкиру и {formatNumber(rebuyAmounts.chips)}
              {NBSP}
              {plural(rebuyAmounts.chips, ['фишка', 'фишки', 'фишек'])} — игрок возвращается за
              стол.
              {current.rebuys > 0 ? ` Ребаев у игрока: ${current.rebuys}.` : ''}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
