// «Режим стола» — пульт банкира без прокрутки (аудит 07.10.2026, «Пульт банкира»). Сверху узкая
// закреплённая полоса часов: уровень, блайнды, время, пауза; касание полосы — шторка «Часы и
// уровень» (±1 мин, уровень вручную). Под ней — места за столом сеткой ячеек в порядке посадки:
// живой — тап = вылет, вылетевший остаётся на своём месте приглушённым (сетка не прыгает), «+» —
// посадить опоздавшего. Ряд вылетевших — тап = ребай, пока можно докупиться, иначе карточка
// игрока. Ниже — олл-ин, вопрос «Фишек хватило?» и «Вылет и ребай» после ривера (RiverActions),
// «Отменить последнее». Статы, расчёт и лента — под этим, их видно прокруткой (LiveView).
// Места и баттон (миграция 028): с рассадкой плитки — по номерам мест сукна, на плитке номер и
// позиция (D, SB 25, BB 50); в игре без места — ряд «Без места» (касание — выбор места); «Рассадка»
// у заголовка мест — шторка мест и баттона. «Следующая раздача» (запись 'hand') двигает баттон и
// считает раздачи уровня; видна при баттоне или уровне по раздачам, а пока висит вопрос после ривера —
// закрыта с подсказкой (вылет записывается до раздачи, тогда баттон его пропустит).
import type { PlayerId, PlayerState } from '@domain/types.ts';
import { useNavigate } from 'react-router-dom';
import { cn, formatBlinds, formatRub, formatTime, NBSP, paths } from '../../shared/lib';
import { Button, Icon, IconButton } from '../../shared/ui';
import {
  clockView,
  describeEvent,
  levelLabel,
  rebuyWindow,
  roleTag,
  seatNo,
  triggerProgress,
  undoActionText,
  type PositionRole,
} from './lib';
import { RiverActions } from './RiverActions';
import { handButton, seatingStarted, unseatedPlayers } from './seating';
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
  /** Шторка «Рассадка»: места и баттон; с игроком — сразу выбор места для него. */
  onSeating: (playerId?: PlayerId) => void;
  onShowdown: () => void;
  /** Шторка олл-ина на раздаче после ривера: несколько вылетов или «Вылет и ребай». */
  onRiverSheet: (rebuy: PlayerId[]) => void;
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
  onSeating,
  onShowdown,
  onRiverSheet,
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
  const suggestion = river.suggestion;
  const finishMain = Boolean(pult.lastAlive) && !pult.rebuysStillOpen;
  const seated = seatingStarted(state);
  const unseated = unseatedPlayers(state);
  // «Следующая раздача» — главное действие, пока часы идут и нет финиша и вопроса после ривера; пока
  // вопрос висит, она закрыта (hold): вылет записывается до раздачи, тогда баттон его пропустит.
  const hand = handButton(state, Boolean(suggestion));
  const handMain = state.timer.status === 'running' && !finishMain && !suggestion;

  /** Вылетевший: ребай, пока можно докупиться, иначе — карточка игрока. */
  const openOut = (playerId: string) => {
    const p = state.players[playerId];
    if (p && rebuyable.has(playerId)) onPlayer(p);
    else navigate(paths.player(playerId));
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
        <div className="ev-seats__head">
          <p className="m-eyebrow">{seated ? 'Места по часовой' : 'За столом'}</p>
          <Button variant="ghost" icon="map-pin" onClick={() => onSeating()}>
            Рассадка
          </Button>
        </div>
        <div className="ev-seats__grid">
          {tiles.map((t) => {
            const name = nameOf(t.playerId);
            const p = state.players[t.playerId];
            const tag = roleTag(t.roles, state.currentLevel);
            const where = t.seat === null ? '' : `Место ${t.seat}${rolesWords(t.roles)}. `;
            return (
              <button
                key={t.playerId}
                type="button"
                className={cn('ev-seat', !t.alive && 'ev-seat--out')}
                aria-label={
                  t.alive
                    ? `${where}Отметить вылет: ${name}`
                    : `${where}${name}, ${t.note ?? 'вне игры'}: ${rebuyable.has(t.playerId) ? 'записать ребай' : 'открыть карточку'}`
                }
                onClick={() => (t.alive && p ? onPlayer(p) : openOut(t.playerId))}
              >
                {/* Номер места и позиция (D, SB 25, BB 50) — моно над именем, когда есть рассадка. */}
                {t.seat !== null && (
                  <span className="ev-seat__head" aria-hidden="true">
                    <span className="ev-seat__no">{seatNo(t.seat)}</span>
                    {tag ? (
                      <span className="ev-seat__pos">{tag}</span>
                    ) : (
                      // Игрок на баттоне вылетел: метка на номере до следующей раздачи.
                      t.seat === state.buttonSeat && (
                        <span className="ev-seat__pos ev-seat__pos--idle">D</span>
                      )
                    )}
                  </span>
                )}
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
        {tiles.length === 0 && (
          <p className="m-small">
            {seated ? 'На местах пока никого.' : 'За столом пока никого — посади игроков.'}
          </p>
        )}
      </section>

      {unseated.length > 0 && (
        <section className="ev-out" aria-label="Без места">
          <p className="m-eyebrow">Без места</p>
          <ul className="ev-out__row">
            {unseated.map((id) => {
              const name = nameOf(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="ev-out__chip ev-out__chip--seat"
                    aria-label={`Выбрать место: ${name}`}
                    onClick={() => onSeating(id)}
                  >
                    <span className="ev-out__name">{name}</span>
                    <span className="ev-out__note">
                      <Icon name="map-pin" size={12} />
                      место?
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="m-small ev-table__hint">
            {unseated.length > 1
              ? 'В позициях раздачи не участвуют, пока не сядут на место. Нажми на имя — выбрать место.'
              : 'В позициях раздачи не участвует, пока не сядет на место. Нажми на имя — выбрать место.'}
          </p>
        </section>
      )}

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
        <RiverActions model={model} actions={actions} river={river} onSheet={onRiverSheet} />
        {hand.show && (
          <Button
            variant={handMain ? 'primary' : 'secondary'}
            block
            size="lg"
            icon="arrow-right"
            disabled={actions.busy || Boolean(hand.hold) || Boolean(actions.check('hand'))}
            onClick={pult.nextHand}
          >
            {hand.label}
          </Button>
        )}
        {hand.hold && <p className="m-small ev-table__hint">{hand.hold}</p>}
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
                ? `${pult.undoExtra.length > 0 ? 'Отменить последнее действие' : 'Отменить последнюю запись'}: ${undoActionText(describeEvent(pult.undoTarget, nameOf, formatRub, format, model.feed).title, pult.undoExtra.length)}, ${formatTime(pult.undoTarget.at)}`
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

/** Позиции на месте словами для скринридера: «, баттон и SB». */
function rolesWords(roles: readonly PositionRole[]): string {
  return roles.length === 0 ? '' : `, ${roles.map((r) => (r === 'D' ? 'баттон' : r)).join(' и ')}`;
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
