// «Режим стола» — пульт банкира без прокрутки (аудит 07.10.2026, «Пульт банкира»). Сверху узкая
// закреплённая полоса часов: уровень, блайнды, время, пауза; касание полосы — шторка «Часы и
// уровень» (±1 мин, уровень вручную). Под ней — места за столом сеткой ячеек в порядке посадки:
// живой — тап = вылет, вылетевший остаётся на своём месте приглушённым (сетка не прыгает), «+» —
// посадить опоздавшего. Ряд вылетевших — тап = ребай, пока можно докупиться, иначе карточка
// игрока. Ниже — олл-ин, «Записать вылет» после ривера, «Отменить последнее». Статы, расчёт и
// лента — под этим, их видно прокруткой (LiveView).
import type { PlayerState } from '@domain/types.ts';
import { useNavigate } from 'react-router-dom';
import { cn, formatBlinds, formatRub, formatTime, NBSP, paths } from '../../shared/lib';
import { Button, Icon, IconButton } from '../../shared/ui';
import { clockView, describeEvent, levelLabel, rebuyWindow, triggerProgress } from './lib';
import { riverBustLabel } from './riverBusts';
import { bustedRow, rebuyShortText, seatTiles, stripStatus } from './table';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';
import type { Pult } from './usePult';
import type { RiverBusts } from './useRiverBusts';

export interface TableViewProps {
  model: EveningModel;
  actions: EveningActions;
  pult: Pult;
  river: RiverBusts;
  /** Олл-ин на табло (видимый): кнопка «Продолжить олл-ин». */
  showdownOpen: boolean;
  /** Шторка игрока: вылет живого или ребай вылетевшего. */
  onPlayer: (player: PlayerState) => void;
  onSeat: () => void;
  onShowdown: () => void;
  onPause: () => void;
  onClock: () => void;
}

export function TableView({
  model,
  actions,
  pult,
  river,
  showdownOpen,
  onPlayer,
  onSeat,
  onShowdown,
  onPause,
  onClock,
}: TableViewProps) {
  const { state, evening, nameOf, nowMs } = model;
  const format = evening.format;
  const navigate = useNavigate();
  const tiles = seatTiles(state);
  const busted = bustedRow(format, state, nowMs);
  const rebuyable = new Set(busted.filter((b) => b.rebuy).map((b) => b.playerId));
  const registrationOpen = rebuyWindow(format, state).kind !== 'closed';
  const progress = triggerProgress(state);
  const suggestion = river.suggestion;
  const finishMain = Boolean(pult.lastAlive) && !pult.rebuysStillOpen;

  /** Вылетевший: ребай, пока можно докупиться, иначе — карточка игрока. */
  const openOut = (playerId: string) => {
    const p = state.players[playerId];
    if (p && rebuyable.has(playerId)) onPlayer(p);
    else navigate(paths.player(playerId));
  };

  const recordRiver = () => {
    if (!suggestion) return;
    // Один проигравший — вопрос прямо здесь; несколько — шторка олл-ина: отметки и порядок по фишкам.
    if (suggestion.victims.length === 1) void river.record(suggestion.victims, true);
    else onShowdown();
  };

  return (
    <div className="ev-table">
      <TableStrip
        model={model}
        actions={actions}
        resumeMain={!finishMain && !suggestion}
        onPause={onPause}
        onClock={onClock}
      />

      <section className="ev-seats" aria-label="Места за столом">
        <div className="ev-seats__grid">
          {tiles.map((t) => {
            const name = nameOf(t.playerId);
            const p = state.players[t.playerId];
            return (
              <button
                key={t.playerId}
                type="button"
                className={cn('ev-seat', !t.alive && 'ev-seat--out')}
                aria-label={
                  t.alive
                    ? `Отметить вылет: ${name}`
                    : `${name}, ${t.note ?? 'вне игры'}: ${rebuyable.has(t.playerId) ? 'записать ребай' : 'открыть карточку'}`
                }
                onClick={() => (t.alive && p ? onPlayer(p) : openOut(t.playerId))}
              >
                {/* Ячейка, как на холсте «Терминала»: имя прописными, под ним — статус моно. */}
                <span className="ev-seat__name">{name}</span>
                <span className="ev-seat__note">
                  {t.alive
                    ? `${p && p.kos > 0 ? `KO${NBSP}${p.kos}` : 'в игре'}${p && p.rebuys > 0 ? `${NBSP}· +${p.rebuys}` : ''}`
                    : t.note}
                </span>
              </button>
            );
          })}
          {registrationOpen && (
            <button type="button" className="ev-seat ev-seat--add" onClick={onSeat}>
              <span className="ev-seat__plus" aria-hidden="true">
                <Icon name="user-plus" size={20} />
              </span>
              <span className="ev-seat__note">Посадить</span>
            </button>
          )}
        </div>
        {tiles.length === 0 && <p className="m-small">За столом пока никого — посади игроков.</p>}
      </section>

      {busted.length > 0 && (
        <section className="ev-out" aria-label="Вылетели">
          <p className="m-eyebrow">Вылетели</p>
          <ul className="ev-out__row">
            {busted.map((b) => {
              const name = nameOf(b.playerId);
              return (
                <li key={b.playerId}>
                  <button
                    type="button"
                    className={cn('ev-out__chip', b.rebuy && 'ev-out__chip--rebuy')}
                    aria-label={b.rebuy ? `Записать ребай: ${name}` : `Карточка игрока: ${name}`}
                    onClick={() => openOut(b.playerId)}
                  >
                    <span className="ev-out__name">{name}</span>
                    <span className="ev-out__note">
                      {b.rebuy && <Icon name="refresh-cw" size={12} />}
                      {b.note}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="ev-table__actions">
        {pult.lastAlive && (
          <Button
            variant={finishMain ? 'primary' : 'secondary'}
            block
            size="lg"
            icon="flag"
            loading={pult.finishing}
            disabled={Boolean(actions.check('finish')) || actions.busy}
            onClick={() => void pult.finish()}
          >
            Завершить вечер
          </Button>
        )}
        {suggestion && (
          <Button
            variant={finishMain ? 'secondary' : 'primary'}
            block
            icon="user-x"
            disabled={actions.busy}
            onClick={recordRiver}
          >
            {riverBustLabel(suggestion.victims.map(nameOf))}
          </Button>
        )}
        {progress?.label === 'Раздач на уровне' && (
          <Button
            block
            icon="plus"
            disabled={actions.busy || Boolean(actions.check('hand'))}
            onClick={() =>
              void actions.send('hand', {}, { success: 'Раздача записана', undo: true })
            }
          >
            {`Раздача сыграна · ${progress.done} из ${progress.total}`}
          </Button>
        )}
        <div className="ev-table__row">
          <Button
            block
            icon="eye"
            disabled={!showdownOpen && state.aliveCount < 2}
            onClick={onShowdown}
          >
            {showdownOpen ? 'Продолжить олл-ин' : 'Отметить олл-ин'}
          </Button>
          {/* Что отменится — в вопросе перед отменой (voidWithConfirm), здесь — в подписи кнопки. */}
          <IconButton
            variant="secondary"
            icon="rotate-ccw"
            label={
              pult.undoTarget
                ? `Отменить последнюю запись: «${describeEvent(pult.undoTarget, nameOf, formatRub, format, model.feed).title}», ${formatTime(pult.undoTarget.at)}`
                : 'Отменить последнюю запись'
            }
            disabled={!pult.undoTarget || actions.busy}
            onClick={pult.undoLast}
          />
        </div>
        <p className="m-small ev-table__hint">
          Нажми на игрока — вылет, на вылетевшего — ребай или карточка. Запись в ленте — исправить
          или отменить.
        </p>
      </div>
    </div>
  );
}

/** Блайнды с местом переноса только после «/» и перед анте: число не рвётся посреди разряда. */
function BlindsText({ text }: { text: string }) {
  const cut = text.indexOf('/');
  if (cut < 0) return <>{text}</>;
  const [bb, ante] = text.slice(cut + 1).split(' (');
  return (
    <>
      {text.slice(0, cut + 1)}
      <wbr />
      {bb}
      {ante !== undefined && <> ({ante}</>}
    </>
  );
}

/**
 * Полоса часов, прилипает к верху экрана. Касание — шторка «Часы и уровень». Справа — пауза (шторка
 * «Пауза»: без срока или перерыв на N минут), на паузе — «Продолжить», до старта — «Запустить».
 */
function TableStrip({
  model,
  actions,
  resumeMain,
  onPause,
  onClock,
}: {
  model: EveningModel;
  actions: EveningActions;
  /** «Продолжить» — главная кнопка экрана (если нет финиша и вылета после ривера). */
  resumeMain: boolean;
  onPause: () => void;
  onClock: () => void;
}) {
  const { state, evening, nowMs } = model;
  const format = evening.format;
  const status = stripStatus(state, nowMs);
  const clock = clockView(state);
  const progress = triggerProgress(state);
  const blinds = formatBlinds(state.currentLevel);
  const level = levelLabel(format, state);
  // На паузе цифры стоят — их место у кнопки «Продолжить», а в строке: перерыв и что на часах.
  const note = status.word
    ? [status.word, status.line, `на часах ${clock.text}`].filter(Boolean).join(`${NBSP}· `)
    : [
        status.mode === 'not_started' ? 'таймер не запущен' : null,
        state.nextLevel ? `дальше ${formatBlinds(state.nextLevel)}` : 'последний уровень',
        progress ? `${progress.label.toLowerCase()}: ${progress.done} из ${progress.total}` : null,
        rebuyShortText(rebuyWindow(format, state)),
      ]
        .filter(Boolean)
        .join(`${NBSP}· `);

  return (
    <section
      className={cn(
        'ev-strip',
        status.word && 'ev-strip--paused',
        status.mode === 'due' && 'ev-strip--due',
      )}
      aria-label="Часы"
    >
      <button
        type="button"
        className="ev-strip__main"
        aria-label={`Часы и уровень: ${level}, блайнды ${blinds}. ${clock.aria}`}
        onClick={onClock}
      >
        <span className="m-eyebrow ev-strip__level">
          {level}
          <Icon name="chevron-down" size={14} />
        </span>
        <span className="m-mono ev-strip__blinds">
          <BlindsText text={blinds} />
        </span>
        {!status.word && (
          <span className="m-mono ev-strip__time" role="timer">
            {clock.text}
          </span>
        )}
      </button>
      <div className="ev-strip__act">
        {status.mode === 'running' ? (
          <Button
            icon="pause"
            aria-label="Поставить паузу"
            disabled={actions.busy}
            onClick={onPause}
          >
            Пауза
          </Button>
        ) : (
          <Button
            variant={resumeMain ? 'primary' : 'secondary'}
            icon="play"
            aria-label={status.mode === 'not_started' ? 'Запустить таймер' : 'Продолжить игру'}
            disabled={actions.busy}
            onClick={() =>
              void (status.mode === 'not_started'
                ? actions.send('timer_start', {}, { success: 'Таймер запущен' })
                : actions.send('timer_resume', {}, { success: 'Игра продолжается' }))
            }
          >
            {status.mode === 'not_started' ? 'Запустить' : 'Продолжить'}
          </Button>
        )}
      </div>
      <p className={cn('m-small ev-strip__note', status.mode === 'due' && 'ev-strip__due')}>
        {note}
      </p>
    </section>
  );
}
