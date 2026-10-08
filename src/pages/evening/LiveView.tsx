// Живой вечер: уровень и обратный отсчёт, блайнды, ребаи, фонд, игроки и лента. У банкира и
// админа поверх того же экрана — пульт: таймер, уровни, раздачи, вылеты, ребаи, отмена, финиш.
// Пока на табло олл-ин, его панель (руки, стол, шансы, ауты) — первой на экране у всех.
// У того, кто ведёт пульт, экран не гаснет (Screen Wake Lock; нельзя — подсказка отключить
// автоблокировку), а закрытие Mini App Telegram переспрашивает: пульт — не место для случайного свайпа.
// У игрока, который пульт не ведёт, вверху — «Ты за столом» (статус, входы, нокауты, баланс с
// банкиром), в списке — «(ты)», строки ведут в карточки игроков.
import { computeMoney, paymentsFromEvents } from '@domain/money.ts';
import { visibleShowdown } from '@domain/showdown.ts';
import type { PlayerState } from '@domain/types.ts';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifyEveningFinished, useRsvps } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import {
  formatBlinds,
  formatNumber,
  formatRub,
  formatTime,
  paths,
  joinNames,
  plural,
  pluralWithNumber,
  useWakeLock,
  wakeLockHint,
} from '../../shared/lib';
import { useClosingConfirmation } from '../../shared/telegram';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  IconButton,
  Notice,
  Progress,
  Section,
  ShowdownView,
  Stat,
  Stats,
  useToast,
  Icon,
} from '../../shared/ui';
import {
  averageStackBb,
  clockView,
  describeEvent,
  formatBbValue,
  lastUndoable,
  levelEdgeLeftMs,
  levelLabel,
  levelMovedText,
  levelNextClosesRebuys,
  mySeat,
  rebuysClosingText,
  rebuyText,
  rebuyWindow,
  triggerProgress,
} from './lib';
import { EventFeed, MySeatCard, PlayersList } from './parts';
import { PlayerSheet } from './PlayerSheet';
import { SeatSheet } from './SeatSheet';
import { ShowdownSheet } from './ShowdownSheet';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface LiveViewProps {
  model: EveningModel;
  actions: EveningActions;
}

/** Ближе к авто-переходу «Уровень вперёд» переспрашивает (сеть + расхождение часов). */
const LEVEL_EDGE_MS = 5000;

function chipsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, ['фишка', 'фишки', 'фишек'])}`;
}

export function LiveView({ model, actions }: LiveViewProps) {
  const { evening, state, nameOf, playersById, canControl, events, errorsById } = model;
  const format = evening.format;
  const navigate = useNavigate();
  const toast = useToast();
  const { player: me } = useAuth();
  const rsvps = useRsvps(canControl ? evening.id : undefined).data ?? [];
  const [selected, setSelected] = useState<PlayerState | null>(null);
  const [seatOpen, setSeatOpen] = useState(false);
  const [showdownOpen, setShowdownOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const showdown = visibleShowdown(state.showdown, model.nowMs);
  // Пульт: экран не гаснет, закрытие Mini App — с вопросом (как в админке с несохранёнными правками).
  const wake = useWakeLock(canControl);
  useClosingConfirmation(canControl);
  const wakeHint = canControl ? wakeLockHint(wake) : null;

  const timer = state.timer;
  const paused = timer.status === 'paused';
  const progress = triggerProgress(state);
  const win = rebuyWindow(format, state);
  const avg = averageStackBb(state);
  const lastAlive =
    state.aliveCount === 1 ? state.joinOrder.find((id) => state.players[id]?.alive) : undefined;
  const money = computeMoney(format, state);
  const owedRub = Object.values(money).reduce((s, m) => s + m.owesRub, 0);
  const payments = paymentsFromEvents(events);
  const paidRub = payments.reduce((s, p) => s + p.amountRub, 0);
  // «Ты за столом» — тому, кто играет и не ведёт пульт (у банкира и админа наверху пульт).
  const seat = !canControl && me ? mySeat(format, state, model.applied, payments, me.id) : null;

  // «Ребай» в тосте после вылета: шторка ребая по свежему журналу (тост живёт дольше рендера).
  const openRebuy = (playerId: string) => {
    const fresh = actions.freshState().players[playerId];
    if (fresh && !fresh.alive) setSelected(fresh);
    else if (fresh)
      toast.show(`${nameOf(playerId)} уже в игре`, {
        detail: 'Ребай уже записан или вылет отменён — проверь ленту.',
      });
  };

  const undoTarget = lastUndoable(events);

  // Один живой при открытых ребаях — обычно ненадолго: вылетевшие сейчас докупятся. Финиш тогда
  // не главное действие, а подтверждение прямо говорит, что ребаи закроются.
  const rebuysStillOpen = win.kind !== 'closed';
  const bustedNames = state.joinOrder.filter((id) => !state.players[id]?.alive).map(nameOf);

  const finish = async () => {
    const winner = lastAlive ? nameOf(lastAlive) : 'последний игрок';
    const rebuyWarning = rebuysStillOpen
      ? ` ${rebuyText(win)}: после завершения ${bustedNames.length > 0 ? `${joinNames(bustedNames)} не ${bustedNames.length > 1 ? 'смогут' : 'сможет'} докупиться` : 'докупиться будет нельзя'}.`
      : '';
    const ok = await actions.confirm({
      title: 'Завершить вечер?',
      message: `Победитель — ${winner}.${rebuyWarning} Места, очки и деньги зафиксируются, откроется голосование на 24 часа, итог уйдёт в группу. Вернуть вечер в игру после этого сможет только админ.`,
      confirmText: 'Завершить вечер',
      cancelText: 'Продолжить игру',
    });
    if (!ok) return;
    setFinishing(true);
    const record = await actions.send('finish');
    if (!record) {
      setFinishing(false);
      return;
    }
    try {
      const outcome = await notifyEveningFinished(evening.id);
      if (outcome === 'already_posted') {
        toast.show('Итог уже был в группе', {
          detail: 'Новый пост не отправлен. Исправленный итог админ публикует с экрана вечера.',
        });
      }
    } catch {
      // Пост в группу не должен мешать расчёту: если не ушёл сейчас, его добьёт cron-tick.
      toast.show('Итог не ушёл в группу', {
        tone: 'caution',
        detail: 'Бот отправит его сам в течение 15 минут.',
      });
    }
    setFinishing(false);
    navigate(paths.settle(evening.id));
  };

  const undoLast = () => {
    if (undoTarget) void actions.voidWithConfirm(undoTarget);
  };

  // «Уровень вперёд» за секунды до авто-перехода: запрос придёт на сервер уже на следующем уровне,
  // и replay переключит ещё раз — уровень пропустится. Переход, который закроет ребаи, переспрашиваем
  // всегда: ошибочный тап меняет деньги вечера, а «Уровень назад» начнёт уровень с нуля.
  // Вопрос может висеть долго: уровень за это время сменится сам (время, вылет, раздача с другого
  // устройства). Поэтому после ответа — свежее состояние: уровень сменился — запись не уходит
  // (guard в send), до авто-перехода остались секунды — ещё вопрос о краю уровня.
  const confirmEdge = (leftMs: number) =>
    actions.confirm({
      title: 'Уровень и так сейчас сменится',
      message: `До конца уровня ${Math.max(1, Math.ceil(leftMs / 1000))} с — он сменится сам. Если перейти вручную, запись может прийти уже на следующем уровне, и он пропустится.`,
      confirmText: 'Всё равно перейти',
      cancelText: 'Подождать',
    });

  const levelNext = async () => {
    const before = actions.freshState();
    const from = before.timer.levelIndex;
    const left = levelEdgeLeftMs(before, LEVEL_EDGE_MS);
    const closes = levelNextClosesRebuys(format, before);
    if (left !== null) {
      if (!(await confirmEdge(left))) return;
    } else if (closes) {
      const ok = await actions.confirm({
        title: `Перейти на ${from + 2}-й уровень?`,
        message: `${rebuysClosingText(closes.busted.map(nameOf))} Ошибочный переход отменяется кнопкой «Отменить» в тосте.`,
        confirmText: 'Перейти и закрыть ребаи',
        cancelText: 'Остаться на уровне',
      });
      if (!ok) return;
      const after = actions.freshState();
      const leftNow = levelMovedText(from, after) ? null : levelEdgeLeftMs(after, LEVEL_EDGE_MS);
      if (leftNow !== null && !(await confirmEdge(leftNow))) return;
    }
    void actions.send(
      'level_next',
      {},
      { success: 'Уровень вперёд', undo: true, guard: (fresh) => levelMovedText(from, fresh) },
    );
  };

  const clock = clockView(state);

  return (
    <>
      {state.errors.length > 0 && canControl && (
        <Notice
          tone="caution"
          title={`Журнал не принял ${pluralWithNumber(state.errors.length, ['запись', 'записи', 'записей'])}`}
        >
          Они помечены в ленте «Не принято» и на игру не влияют. Если запись лишняя — отмени её.
        </Notice>
      )}

      {showdown && (
        <ShowdownView
          showdown={showdown}
          nameOf={nameOf}
          footer={
            canControl ? (
              <Button icon="pencil" onClick={() => setShowdownOpen(true)}>
                Отметить карты
              </Button>
            ) : undefined
          }
        />
      )}

      {seat && <MySeatCard seat={seat} />}

      <Card>
        <div className="ev-clock" aria-live="off">
          <div className="ev-clock__head">
            <p className="m-eyebrow">{levelLabel(format, state)}</p>
            {paused ? (
              <Badge tone="caution">Пауза</Badge>
            ) : timer.status === 'running' ? (
              <Badge tone="positive" dot>
                Идёт
              </Badge>
            ) : (
              <Badge tone="neutral">Таймер не запущен</Badge>
            )}
          </div>
          <p
            className={
              paused ? 'm-figure ev-clock__time ev-clock__time--paused' : 'm-figure ev-clock__time'
            }
            role="timer"
            aria-label={clock.aria}
          >
            {clock.text}
          </p>
          {clock.note && <p className="m-small">{clock.note}</p>}
          {progress && (
            <Progress
              label={progress.label}
              value={Math.min(progress.done, progress.total)}
              max={progress.total}
              showValue
              valueText={`${progress.done} из ${progress.total}`}
            />
          )}
          <div className="ev-clock__blinds">
            <div className="ev-clock__blind">
              <span className="m-eyebrow">Блайнды</span>
              <span className="m-mono ev-clock__blind-now">{formatBlinds(state.currentLevel)}</span>
            </div>
            <div className="ev-clock__blind">
              <span className="m-eyebrow">Дальше</span>
              <span className="m-mono ev-clock__blind-next">
                {state.nextLevel ? formatBlinds(state.nextLevel) : 'последний уровень'}
              </span>
            </div>
          </div>
          <p className="m-small ev-clock__rebuy">
            <Icon name={win.kind === 'closed' ? 'x' : 'refresh-cw'} size={16} />
            <span>{rebuyText(win)}</span>
          </p>
        </div>
      </Card>

      {canControl && (
        <Section title="Пульт">
          <div className="ev-pult">
            {lastAlive && (
              <Button
                variant={rebuysStillOpen ? 'secondary' : 'primary'}
                block
                size="lg"
                icon="flag"
                loading={finishing}
                disabled={Boolean(actions.check('finish')) || actions.busy}
                onClick={() => void finish()}
              >
                Завершить вечер
              </Button>
            )}
            <div className="ev-pult__row">
              {timer.status === 'running' && (
                <Button
                  icon="pause"
                  disabled={actions.busy}
                  onClick={() => void actions.send('timer_pause', {}, { success: 'Пауза' })}
                >
                  Поставить паузу
                </Button>
              )}
              {paused && (
                <Button
                  variant={lastAlive && !rebuysStillOpen ? 'secondary' : 'primary'}
                  icon="play"
                  disabled={actions.busy}
                  onClick={() =>
                    void actions.send('timer_resume', {}, { success: 'Игра продолжается' })
                  }
                >
                  Продолжить игру
                </Button>
              )}
              {timer.status === 'not_started' && (
                <Button
                  variant={lastAlive && !rebuysStillOpen ? 'secondary' : 'primary'}
                  icon="play"
                  disabled={actions.busy}
                  onClick={() =>
                    void actions.send('timer_start', {}, { success: 'Таймер запущен' })
                  }
                >
                  Запустить таймер
                </Button>
              )}
              {progress?.label === 'Раздач на уровне' && (
                <Button
                  icon="plus"
                  disabled={actions.busy || Boolean(actions.check('hand'))}
                  onClick={() =>
                    void actions.send('hand', {}, { success: 'Раздача записана', undo: true })
                  }
                >
                  Раздача сыграна
                </Button>
              )}
            </div>
            <div className="ev-pult__levels">
              <IconButton
                variant="secondary"
                icon="skip-back"
                label="Уровень назад"
                disabled={actions.busy || Boolean(actions.check('level_prev'))}
                onClick={() =>
                  void actions.send('level_prev', {}, { success: 'Уровень назад', undo: true })
                }
              />
              <span className="m-small ev-pult__levels-label">Уровень вручную</span>
              <IconButton
                variant="secondary"
                icon="skip-forward"
                label="Уровень вперёд"
                disabled={actions.busy || Boolean(actions.check('level_next'))}
                onClick={() => void levelNext()}
              />
            </div>
            <div className="ev-pult__row">
              <Button
                icon="eye"
                disabled={!showdown && state.aliveCount < 2}
                onClick={() => setShowdownOpen(true)}
              >
                {showdown ? 'Продолжить олл-ин' : 'Отметить олл-ин'}
              </Button>
              <Button
                icon="user-plus"
                disabled={win.kind === 'closed'}
                onClick={() => setSeatOpen(true)}
              >
                Посадить опоздавшего
              </Button>
              <Button
                variant="ghost"
                icon="rotate-ccw"
                disabled={!undoTarget || actions.busy}
                onClick={undoLast}
              >
                Отменить последнее
              </Button>
            </div>
            {undoTarget && (
              <p className="m-small">
                Последняя запись — «{describeEvent(undoTarget, nameOf, formatRub, format).title}»,{' '}
                {formatTime(undoTarget.at)}
              </p>
            )}
            {wakeHint && <p className="m-small">{wakeHint}</p>}
          </div>
        </Section>
      )}

      <Stats>
        <Stat
          label="Призовой фонд"
          value={formatNumber(state.prizePoolRub)}
          unit="₽"
          note={`выплаты ${format.payoutPct.join(' / ')} %`}
        />
        <Stat
          label="В игре"
          value={String(state.aliveCount)}
          unit={`из ${state.joinOrder.length}`}
          note={pluralWithNumber(state.totalEntries, ['вход', 'входа', 'входов'])}
        />
        {avg !== null && (
          <Stat
            label="Средний стек"
            value={formatBbValue(avg)}
            unit="BB"
            note={chipsText(Math.round(state.totalChips / state.aliveCount))}
          />
        )}
      </Stats>

      {canControl && owedRub > 0 && (
        <div className="ev-actions">
          <ButtonLink to={paths.settle(evening.id)} variant="ghost" block icon="wallet">
            Открыть расчёт
          </ButtonLink>
          <p className="m-small">
            Взносы за вечер — {formatRub(owedRub)}, у банкира — {formatRub(paidRub)}. Платежи
            записываются в расчёте или сразу при входе и ребае («Оплачено сразу»).
          </p>
        </div>
      )}

      <Section
        title="Игроки"
        aside={`${state.aliveCount} в игре`}
        footer={canControl ? 'Нажми на игрока, чтобы отметить вылет или ребай.' : undefined}
      >
        {state.joinOrder.length > 0 ? (
          <PlayersList
            state={state}
            format={format}
            nameOf={nameOf}
            playersById={playersById}
            onSelect={canControl ? setSelected : undefined}
            linkPlayers={!canControl}
            meId={me?.id}
          />
        ) : (
          <p className="m-small">За столом пока никого.</p>
        )}
      </Section>

      <EventFeed
        events={events}
        nameOf={nameOf}
        format={format}
        errorsById={errorsById}
        onVoid={canControl ? (ev) => void actions.voidWithConfirm(ev) : undefined}
      />

      {canControl && (
        <>
          <PlayerSheet
            player={selected}
            onClose={() => setSelected(null)}
            model={model}
            actions={actions}
            onRebuy={openRebuy}
          />
          <SeatSheet
            open={seatOpen}
            onClose={() => setSeatOpen(false)}
            model={model}
            actions={actions}
            rsvps={rsvps}
            mode="late"
          />
          <ShowdownSheet
            open={showdownOpen}
            onClose={() => setShowdownOpen(false)}
            model={model}
            actions={actions}
          />
        </>
      )}
    </>
  );
}
