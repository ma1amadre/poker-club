// Пульт одного игрока у банкира: «Отметить вылет» (кто выбил — один, несколько при дележе
// или «не знаю») для живого и «Записать ребай» для вылетевшего, пока ребаи открыты.
import type { PlayerState } from '@domain/types.ts';
import { useState } from 'react';
import { formatNumber, formatRub, joinNames, plural } from '../../shared/lib';
import { Button, FieldGroup, Notice, PlayerPicker, Sheet, Switch } from '../../shared/ui';
import { playerLine, rebuyWindow } from './lib';
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

  const [killers, setKillers] = useState<string[]>([]);
  const [split, setSplit] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [sending, setSending] = useState(false);
  // Пока идёт своя отправка, статус меняет наша же запись — это не «чужая» правка.
  const overtaken = !sending && (mode === 'bust') !== current.alive;

  const alive = state.joinOrder
    .filter((id) => id !== current.playerId && state.players[id]?.alive)
    .map((id) => ({
      id,
      display_name: nameOf(id),
      photo_url: playersById.get(id)?.photo_url ?? null,
    }));

  const by = unknown ? [] : killers;
  const bustPayload = { playerId: current.playerId, by };
  const bustProblem = current.alive ? actions.check('bust', bustPayload) : null;
  const rebuyProblem = current.alive
    ? null
    : actions.check('rebuy', { playerId: current.playerId });
  const ready = unknown || killers.length > 0;
  // Ребаи вот-вот закроются: запись, отправленная сейчас, может прийти на сервер уже после.
  const win = rebuyWindow(evening.format, state);
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
  };

  const rebuy = async () => {
    setSending(true);
    const record = await actions.send(
      'rebuy',
      { playerId: current.playerId },
      { success: `Ребай записан: ${name}`, undo: true },
    );
    setSending(false);
    if (record) onClose();
  };

  const line = playerLine(current);
  const description = [current.alive ? 'В игре' : 'Вне игры', line].filter(Boolean).join(' · ');

  if (overtaken) {
    return (
      <Sheet open onClose={onClose} title={name} description={description}>
        <div className="ev-sheet-body">
          <Notice tone="info" title={mode === 'bust' ? 'Вылет уже записан' : 'Ребай уже записан'}>
            {mode === 'bust'
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
            Отметить вылет
          </Button>
        }
      >
        <div className="ev-sheet-body">
          {bustProblem && ready ? (
            <Notice tone="caution" title="Вылет сейчас не записать">
              {bustProblem}.
            </Notice>
          ) : null}
          <FieldGroup
            label="Кто выбил"
            hint={
              unknown
                ? `Голова уйдёт победителю вечера (${formatRub(evening.format.bountyRub)}).`
                : split
                  ? 'Голова делится поровну, нокаут засчитывается каждому.'
                  : 'Выбери одного игрока или включи делёж.'
            }
          >
            {alive.length > 0 ? (
              <PlayerPicker
                players={alive}
                value={unknown ? [] : killers}
                onChange={(ids) => {
                  setUnknown(false);
                  setKillers(ids);
                }}
                max={split ? alive.length : 1}
                disabledIds={unknown ? alive.map((p) => p.id) : []}
                label={split ? 'Выбили вместе' : undefined}
              />
            ) : (
              <p className="m-small">Других игроков в игре нет.</p>
            )}
          </FieldGroup>
          {alive.length > 1 && (
            <Switch
              label="Выбили вдвоём или больше"
              description="Голова делится поровну, нокаут — каждому"
              checked={split}
              onChange={(next) => {
                setSplit(next);
                if (!next) setKillers((ids) => ids.slice(0, 1));
              }}
              disabled={unknown}
            />
          )}
          <Switch
            label="Не знаю, кто выбил"
            checked={unknown}
            onChange={(next) => {
              setUnknown(next);
              if (next) setKillers([]);
            }}
          />
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
          <p className="m-body">
            Ещё {formatRub(evening.format.buyInRub)} банкиру и{' '}
            {formatNumber(evening.format.startingChips)}
            {' '}
            {plural(evening.format.startingChips, ['фишка', 'фишки', 'фишек'])} — игрок возвращается
            за стол.
            {current.rebuys > 0 ? ` Ребаев у игрока: ${current.rebuys}.` : ''}
          </p>
        )}
      </div>
    </Sheet>
  );
}
