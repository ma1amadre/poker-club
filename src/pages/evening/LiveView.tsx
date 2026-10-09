// Живой вечер: уровень и обратный отсчёт, блайнды, ребаи, фонд, игроки и лента. У банкира и
// админа поверх того же экрана — пульт: таймер, уровни, раздачи, вылеты, ребаи, отмена, финиш.
// Пульт в двух видах (переключатель «Стол / Подробно», выбор помнит устройство — pultView.ts):
// «Стол» (TableView) — всё под рукой без прокрутки: полоса часов, места сеткой, вылетевшие, олл-ин;
// «Подробно» — прежний экран: часы карточкой, пульт кнопками, статы, список игроков.
// Пока на табло олл-ин, его панель (руки, стол, шансы, ауты) — первой на экране у игроков и в
// «Подробно»; в «Столе» — под пультом. После ривера — «Записать вылет: X» (useRiverBusts).
// У того, кто ведёт пульт, экран не гаснет (Screen Wake Lock; нельзя — подсказка отключить
// автоблокировку), а закрытие Mini App Telegram переспрашивает: пульт — не место для случайного свайпа.
// У игрока, который пульт не ведёт, вверху — «Ты за столом» (статус, входы, нокауты, баланс с
// банкиром), в списке — «(ты)», строки ведут в карточки игроков.
// Перерыв на N минут (022): на часах — «Продолжаем через 07:12», по истечении — «Пора продолжать»
// (таймер сам не продолжает). Пауза — шторка «Пауза» (без срока или 5–30 мин), ±1 мин — у часов.
// Лента: нажатие на вход, ребай или вылет — «Изменить запись» (правка на месте, AmendSheet).
// Под статами у банкира и админа — строка «Проверка перед игрой» (связь, табло, голос; PregameCheck).
import { amendField } from '@domain/amend.ts';
import { computeMoney, paymentsFromEvents } from '@domain/money.ts';
import { visibleShowdown } from '@domain/showdown.ts';
import type { PlayerState } from '@domain/types.ts';
import { useState, type ReactNode } from 'react';
import { useRsvps, type EveningEventRecord } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import {
  formatBlinds,
  formatNumber,
  formatRub,
  formatTime,
  NBSP,
  paths,
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
  Icon,
  IconButton,
  Notice,
  Progress,
  Section,
  Segmented,
  ShowdownView,
  Stat,
  Stats,
  useToast,
} from '../../shared/ui';
import { AmendSheet } from './AmendSheet';
import { ClockSheet } from './ClockSheet';
import {
  averageStackBb,
  breakView,
  clockView,
  describeEvent,
  formatBbValue,
  levelLabel,
  mySeat,
  rebuyText,
  rebuyWindow,
  timeAdjustable,
  triggerProgress,
} from './lib';
import { EventFeed, MySeatCard, PlayersList } from './parts';
import { PauseSheet } from './PauseSheet';
import { PregameRow } from './PregameCheck';
import './pult.css';
import { PlayerSheet } from './PlayerSheet';
import type { PultView } from './pultView';
import { riverBustLabel } from './riverBusts';
import { SeatSheet } from './SeatSheet';
import { ShowdownSheet } from './ShowdownSheet';
import { TableView } from './TableView';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';
import { usePult, type Pult } from './usePult';
import { useRiverBusts } from './useRiverBusts';

export interface LiveViewProps {
  model: EveningModel;
  actions: EveningActions;
  /** Вид пульта (у банкира и админа): живёт в EveningScreen — от него зависит и шапка экрана. */
  view: PultView;
  onViewChange: (view: PultView) => void;
  /** Открыть «Вывести на ТВ» (из проверки перед игрой: табло не на связи). */
  onTv: () => void;
}

const VIEW_OPTIONS = [
  { value: 'table' as const, label: 'Стол' },
  { value: 'details' as const, label: 'Подробно' },
];

function chipsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, ['фишка', 'фишки', 'фишек'])}`;
}

export function LiveView({ model, actions, view, onViewChange, onTv }: LiveViewProps) {
  const { evening, state, nameOf, canControl, events, errorsById } = model;
  const format = evening.format;
  const toast = useToast();
  const { player: me } = useAuth();
  const rsvps = useRsvps(canControl ? evening.id : undefined).data ?? [];
  const [selected, setSelected] = useState<PlayerState | null>(null);
  const [seatOpen, setSeatOpen] = useState(false);
  const [showdownOpen, setShowdownOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [amending, setAmending] = useState<EveningEventRecord | null>(null);
  const showdown = visibleShowdown(state.showdown, model.nowMs);
  // Пульт: экран не гаснет, закрытие Mini App — с вопросом (как в админке с несохранёнными правками).
  const wake = useWakeLock(canControl);
  useClosingConfirmation(canControl);
  const wakeHint = canControl ? wakeLockHint(wake) : null;
  const pult = usePult(model, actions);
  const tableMode = canControl && view === 'table';

  // «Ребай» в тосте после вылета: шторка ребая по свежему журналу (тост живёт дольше рендера).
  const openRebuy = (playerId: string) => {
    const fresh = actions.freshState().players[playerId];
    if (fresh && !fresh.alive) setSelected(fresh);
    else if (fresh)
      toast.show(`${nameOf(playerId)} уже в игре`, {
        detail: 'Ребай уже записан или вылет отменён — проверь ленту.',
      });
  };
  const river = useRiverBusts(model, actions, openRebuy);

  // Лента: вход, ребай и вылет — «Изменить запись» (там же «Отменить запись»), остальное — отмена.
  const selectEvent = (ev: EveningEventRecord) => {
    if (amendField(ev) !== null && !ev.voided) setAmending(ev);
    else void actions.voidWithConfirm(ev);
  };
  const canEdit = (ev: EveningEventRecord) => amendField(ev) !== null;

  /** После ривера: один проигравший — вопрос здесь же; несколько — шторка олл-ина. */
  const riverButton = river.suggestion ? (
    <Button
      variant="primary"
      icon="user-x"
      disabled={actions.busy}
      onClick={() => {
        const s = river.suggestion;
        if (s && s.victims.length === 1) void river.record(s.victims, true);
        else setShowdownOpen(true);
      }}
    >
      {riverBustLabel(river.suggestion.victims.map(nameOf))}
    </Button>
  ) : null;

  const showdownPanel = showdown && (
    <ShowdownView
      showdown={showdown}
      nameOf={nameOf}
      footer={
        canControl ? (
          <div className="ev-sd-footer">
            {!tableMode && riverButton}
            <Button icon="pencil" onClick={() => setShowdownOpen(true)}>
              Отметить карты
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  const money = computeMoney(format, state);
  const owedRub = Object.values(money).reduce((s, m) => s + m.owesRub, 0);
  const payments = paymentsFromEvents(events);
  const paidRub = payments.reduce((s, p) => s + p.amountRub, 0);
  const avg = averageStackBb(state);

  const statsBlock = (
    <>
      <Stats className="ui-stats--cells">
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

      {canControl && <PregameRow model={model} rsvps={rsvps} onTv={onTv} holdScreen />}
    </>
  );

  const feed = (
    <EventFeed
      events={events}
      nameOf={nameOf}
      format={format}
      errorsById={errorsById}
      feed={model.feed}
      onSelect={canControl ? selectEvent : undefined}
      canEdit={canControl ? canEdit : undefined}
    />
  );

  return (
    <>
      {canControl && (
        <Segmented
          options={VIEW_OPTIONS}
          value={view}
          onChange={onViewChange}
          label="Вид пульта"
          block
        />
      )}

      {state.errors.length > 0 && canControl && (
        <Notice
          tone="caution"
          title={`Журнал не принял ${pluralWithNumber(state.errors.length, ['запись', 'записи', 'записей'])}`}
        >
          Они помечены в ленте «Не принято» и на игру не влияют. Если запись лишняя — отмени её.
        </Notice>
      )}

      {tableMode ? (
        <>
          <TableView
            model={model}
            actions={actions}
            pult={pult}
            river={river}
            showdownOpen={Boolean(showdown)}
            onPlayer={setSelected}
            onSeat={() => setSeatOpen(true)}
            onShowdown={() => setShowdownOpen(true)}
            onPause={() => setPauseOpen(true)}
            onClock={() => setClockOpen(true)}
          />
          {showdownPanel}
          {statsBlock}
          {feed}
          {wakeHint && <p className="m-small">{wakeHint}</p>}
        </>
      ) : (
        <DetailsView
          model={model}
          actions={actions}
          pult={pult}
          me={me?.id ?? null}
          payments={payments}
          showdownPanel={showdownPanel}
          statsBlock={statsBlock}
          feed={feed}
          wakeHint={wakeHint}
          onPlayer={setSelected}
          onSeat={() => setSeatOpen(true)}
          onShowdown={() => setShowdownOpen(true)}
          onPause={() => setPauseOpen(true)}
        />
      )}

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
            onRebuy={openRebuy}
          />
          <PauseSheet open={pauseOpen} onClose={() => setPauseOpen(false)} actions={actions} />
          <ClockSheet
            open={clockOpen}
            onClose={() => setClockOpen(false)}
            model={model}
            actions={actions}
            pult={pult}
          />
          <AmendSheet
            event={amending}
            onClose={() => setAmending(null)}
            model={model}
            actions={actions}
          />
        </>
      )}
    </>
  );
}

/** «Подробно» — прежний экран (и вид игрока): часы карточкой, пульт кнопками, статы, список. */
function DetailsView({
  model,
  actions,
  pult,
  me,
  payments,
  showdownPanel,
  statsBlock,
  feed,
  wakeHint,
  onPlayer,
  onSeat,
  onShowdown,
  onPause,
}: {
  model: EveningModel;
  actions: EveningActions;
  pult: Pult;
  me: string | null;
  payments: ReturnType<typeof paymentsFromEvents>;
  showdownPanel: ReactNode;
  statsBlock: ReactNode;
  feed: ReactNode;
  wakeHint: string | null;
  onPlayer: (p: PlayerState) => void;
  onSeat: () => void;
  onShowdown: () => void;
  onPause: () => void;
}) {
  const { evening, state, nameOf, playersById, canControl } = model;
  const format = evening.format;
  const timer = state.timer;
  const paused = timer.status === 'paused';
  const brk = breakView(state, model.nowMs);
  const progress = triggerProgress(state);
  const win = rebuyWindow(format, state);
  const clock = clockView(state);
  const { lastAlive, rebuysStillOpen, undoTarget } = pult;
  // «Ты за столом» — тому, кто играет и не ведёт пульт (у банкира и админа наверху пульт).
  const seat = !canControl && me ? mySeat(format, state, model.applied, payments, me) : null;

  return (
    <>
      {showdownPanel}

      {seat && <MySeatCard seat={seat} />}

      <Card>
        <div className="ev-clock" aria-live="off">
          <div className="ev-clock__head">
            <p className="m-eyebrow">{levelLabel(format, state)}</p>
            {paused ? (
              <Badge tone="caution">{brk ? 'Перерыв' : 'Пауза'}</Badge>
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
          {brk && (
            <p
              className={
                brk.due ? 'm-body ev-clock__break ev-clock__break--due' : 'm-body ev-clock__break'
              }
            >
              <Icon name="clock" size={16} />
              <span>
                {brk.due ? 'Пора продолжать' : `Продолжаем через ${brk.countdown}`}
                <span className="m-small">{`${NBSP}· перерыв ${brk.minutes}${NBSP}мин`}</span>
              </span>
            </p>
          )}
          {clock.note && <p className="m-small">{clock.note}</p>}
          {/* ±1 мин — у часов (миграция 022): «ушли за пиццей и забыли паузу». */}
          {canControl && timeAdjustable(state) && (
            <div className="ev-pult__levels">
              <IconButton
                variant="secondary"
                icon="minus"
                label="Убавить минуту уровня"
                disabled={actions.busy || Boolean(actions.check('time_adjust', { seconds: -60 }))}
                onClick={() =>
                  void actions.send(
                    'time_adjust',
                    { seconds: -60 },
                    { success: 'Минута убавлена', undo: true },
                  )
                }
              />
              <span className="m-small ev-pult__levels-label">{`Время уровня ±1${NBSP}мин`}</span>
              <IconButton
                variant="secondary"
                icon="plus"
                label="Прибавить минуту уровня"
                disabled={actions.busy || Boolean(actions.check('time_adjust', { seconds: 60 }))}
                onClick={() =>
                  void actions.send(
                    'time_adjust',
                    { seconds: 60 },
                    { success: 'Минута прибавлена', undo: true },
                  )
                }
              />
            </div>
          )}
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
                loading={pult.finishing}
                disabled={Boolean(actions.check('finish')) || actions.busy}
                onClick={() => void pult.finish()}
              >
                Завершить вечер
              </Button>
            )}
            <div className="ev-pult__row">
              {timer.status === 'running' && (
                <Button icon="pause" disabled={actions.busy} onClick={onPause}>
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
                onClick={() => void pult.levelNext()}
              />
            </div>
            <div className="ev-pult__row">
              <Button
                icon="eye"
                disabled={!showdownPanel && state.aliveCount < 2}
                onClick={onShowdown}
              >
                {showdownPanel ? 'Продолжить олл-ин' : 'Отметить олл-ин'}
              </Button>
              <Button icon="user-plus" disabled={win.kind === 'closed'} onClick={onSeat}>
                Посадить опоздавшего
              </Button>
              <Button
                variant="ghost"
                icon="rotate-ccw"
                disabled={!undoTarget || actions.busy}
                onClick={pult.undoLast}
              >
                Отменить последнее
              </Button>
            </div>
            {undoTarget && (
              <p className="m-small">
                Последняя запись — «
                {describeEvent(undoTarget, nameOf, formatRub, format, model.feed).title}»,{' '}
                {formatTime(undoTarget.at)}
              </p>
            )}
            {wakeHint && <p className="m-small">{wakeHint}</p>}
          </div>
        </Section>
      )}

      {statsBlock}

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
            onSelect={canControl ? onPlayer : undefined}
            linkPlayers={!canControl}
            meId={me}
          />
        ) : (
          <p className="m-small">За столом пока никого.</p>
        )}
      </Section>

      {feed}
    </>
  );
}
