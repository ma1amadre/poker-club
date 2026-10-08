// Табло /board/:token для ТВ и ноутбука — регистр Янтарь (data-theme ставит ThemeScope в
// routes.tsx). Публичное и вне AuthProvider: данные только через useBoardState (RPC board_state
// для anon, опрос раз в 3 с), время — useNow + replay на клиенте, как у всех экранов вечера.
// Табло клуба /tv/:code (ClubBoardPage) показывает тот же Board для вечера, который сейчас важен.
// Табло раз в 20 с отмечается «на связи» (useBoardPing) — это видит проверка перед игрой у банкира.
// Тренировочный вечер (миграция 023) помечен в шапке: «Тренировка · 08.10 · 14:00».
// Денег из платежей здесь нет (board_state их не отдаёт) — только фонд и выплаты по местам.
// Голос (useBoardVoice) объявляет события вечера клипами Silero — включается кнопкой.
// На ТВ (от 1024 px в горизонтали) — своя шкала шрифтов от размера экрана (board.css, --bd-px):
// всё, что читают с дивана, крупно; что не влезло — уменьшает useFitToScreen (--bd-fit).
import { eveningAllIns } from '@domain/allins.ts';
import { computeMoney, payouts } from '@domain/money.ts';
import { replayLog } from '@domain/replay.ts';
import { DEFAULT_SCORING } from '@domain/scoring.ts';
import { visibleShowdown } from '@domain/showdown.ts';
import { eveningStory } from '@domain/story.ts';
import { summarize } from '@domain/summary.ts';
import { VOICE_CREDIT } from '@domain/voice.ts';
import type { ShowdownState } from '@domain/types.ts';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  errorMessage,
  isTrainingEvening,
  useBoardState,
  type BoardSource,
  type BoardState,
} from '../../shared/api';
import {
  clockOffsetMs,
  cn,
  formatBlinds,
  formatDate,
  formatDateNumeric,
  formatNumber,
  formatRub,
  formatTime,
  joinNames,
  kosCount,
  moscowDateKey,
  NBSP,
  pluralWithNumber,
  storyLine,
  useNow,
  useWakeLock,
} from '../../shared/lib';
import { useAllInSwings } from '../../shared/lib/poker';
import { Badge, Button, Icon, List, ListItem, PageSkeleton, Stat, Stats } from '../../shared/ui';
import {
  bestHunters,
  breakLine,
  breakView,
  clockView,
  describeTrigger,
  formatBbValue,
  levelLabel,
  orderedPlayers,
  ordinalPlace,
  type NameOf,
} from '../evening/lib';
import './board.css';
import {
  bigBlinds,
  blindsParts,
  boardClock,
  entriesText,
  formatGameTime,
  lastKnockout,
  levelPlan,
  pausedForMs,
  pauseText,
  payoutPlan,
  rebuyLine,
  startingStackBb,
  startsInText,
  tableLine,
  voiceGapNotes,
} from './boardView';
import { useFitToScreen } from './fitToScreen';
import { ShowdownBoard } from './ShowdownBoard';
import { revealedSize, revealStart, revealStep, type RevealTarget } from './streetReveal';
import { useBoardPing } from './useBoardPing';
import { useFullscreen } from './useScreenControls';
import { useBoardVoice, type BoardVoice } from './useBoardVoice';

/** Масштаб шкалы ТВ, который подбирает useFitToScreen (board.css: --bd-px). */
const BOARD_FIT_VAR = '--bd-fit';
/** Имена через точку; неразрывный пробел перед ней — строка не начнётся с «·». */
const NAMES_SEP = `${NBSP}· `;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BoardPage() {
  const { token } = useParams<{ token: string }>();
  // Обрезанная или испорченная ссылка — сразу «погасло», без запроса (RPC ждёт uuid).
  const valid = Boolean(token && UUID_RE.test(token));
  const query = useBoardState(valid ? token : undefined);
  const source = useMemo<BoardSource>(() => ({ kind: 'evening', token: token ?? '' }), [token]);

  useEffect(() => {
    document.title = 'Табло · Покерный клуб';
  }, []);

  if (valid && query.isPending) return <PageSkeleton label="Загрузка табло" />;
  if (!query.data) {
    if (valid && query.isError) {
      return (
        <BoardMessage
          title="Табло не загрузилось"
          text={`${errorMessage(query.error)} Табло подключится само, как только сервер ответит.`}
          action={
            <Button icon="refresh-cw" onClick={() => void query.refetch()}>
              Подключиться снова
            </Button>
          }
        />
      );
    }
    return (
      <BoardMessage
        title="Табло погасло"
        text="Вечер по этой ссылке не найден или закончился больше шести часов назад. Постоянная ссылка не гаснет — «Табло клуба»: экран вечера в приложении клуба → «Вывести на ТВ»."
      />
    );
  }
  return (
    <Board
      source={source}
      data={query.data}
      failing={query.isError || query.fetchStatus === 'paused'}
      updatedAt={query.dataUpdatedAt}
    />
  );
}

/** Блайнды с местом переноса после «/» (blindsParts): узкая колонка не режет число посреди разряда. */
function BlindsText({ text }: { text: string }) {
  const [head, tail] = blindsParts(text);
  return tail === undefined ? (
    <>{head}</>
  ) : (
    <>
      {head}
      <wbr />
      {tail}
    </>
  );
}

export function BoardMessage({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <main className="bd bd--message">
      <p className="m-eyebrow">Покерный клуб · табло</p>
      <h1 className="m-h1">{title}</h1>
      <p className="m-body bd-muted">{text}</p>
      {action}
    </main>
  );
}

/** Данные старше — «нет связи», даже если запрос просто завис (опрос раз в 3 с). */
const STALE_AFTER_MS = 10_000;

export function Board({
  source,
  data,
  failing,
  updatedAt,
}: {
  /** Чем открыто табло (стабильный объект: от него зависят загрузка клипов и отметка «на связи»). */
  source: BoardSource;
  data: BoardState;
  failing: boolean;
  updatedAt: number;
}) {
  const nowMs = useNow(1000);
  // Возраст данных — по часам устройства (dataUpdatedAt тоже по ним): nowMs серверный, снимаем смещение.
  const stale = failing || nowMs - clockOffsetMs() - updatedAt > STALE_AFTER_MS;
  const fullscreen = useFullscreen();
  const wake = useWakeLock();
  const { evening, format } = data;

  const names = useMemo(
    () => new Map(data.players.map((p) => [p.id, p.display_name])),
    [data.players],
  );
  const nameOf: NameOf = (id) => names.get(id) ?? 'Игрок';
  const { state, applied } = replayLog(format, data.events, nowMs);
  const voice = useBoardVoice({ source, data, state, applied, nowMs });
  useBoardPing(source, evening.id, voice.status === 'on');

  const training = isTrainingEvening(evening);
  const when = `${formatDateNumeric(evening.scheduled_at).slice(0, 5)} · ${formatTime(evening.scheduled_at)}`;
  const place = evening.location ? ` · ${evening.location}` : '';
  const finished = state.finished || evening.status === 'finished' || evening.status === 'settled';
  // Олл-ин закрывает таймер и стол, пока банкир его не закроет (или табло не спрячет его само).
  // Улицы, внесённые разом, табло раскрывает по очереди (streetReveal.ts).
  const showdown = useStreetReveal(visibleShowdown(state.showdown, nowMs), nowMs);

  return (
    <main className={showdown && !finished ? 'bd bd--showdown' : 'bd'}>
      <header className="bd-head">
        <p className="m-eyebrow">
          {training && `Тренировка${NBSP}· `}
          {when}
          {place}
        </p>
        <div className="bd-tools">
          {stale && (
            <Badge tone="caution">
              <Icon name="alert-triangle" size={14} /> Нет связи · данные на {formatTime(updatedAt)}
            </Badge>
          )}
          <VoiceButton voice={voice} />
          {fullscreen.supported && (
            <Button size="sm" variant="ghost" icon="tv" onClick={fullscreen.toggle}>
              {fullscreen.active ? 'Выйти из полноэкранного' : 'Во весь экран'}
            </Button>
          )}
        </div>
      </header>

      {finished ? (
        <FinishedBoard data={data} state={state} nameOf={nameOf} />
      ) : showdown ? (
        <ShowdownBoard showdown={showdown} state={state} format={format} nameOf={nameOf} />
      ) : state.timer.status === 'not_started' ? (
        <WaitingBoard data={data} state={state} nameOf={nameOf} nowMs={nowMs} />
      ) : (
        <LiveBoard data={data} state={state} applied={applied} nameOf={nameOf} nowMs={nowMs} />
      )}

      <footer className="bd-foot">
        {wake === 'unsupported' && (
          <p className="m-small bd-muted">
            Этот браузер не умеет держать экран включённым — отключи сон экрана в настройках
            устройства.
          </p>
        )}
        {/* Что голосу нечем сказать — без обещаний сверх того, что табло сделает (voiceGapNotes). */}
        {voice.status === 'on' &&
          voiceGapNotes(voice.gaps).map((note) => (
            <p key={note} className="m-small bd-muted">
              {note}
            </p>
          ))}
        {voice.status !== 'unsupported' && <p className="m-small bd-muted">{VOICE_CREDIT}</p>}
      </footer>
    </main>
  );
}

/**
 * Олл-ин с раскрытием улиц по очереди: банкир внёс флоп, тёрн и ривер одной отправкой — табло
 * показывает флоп, через 3–4 с тёрн, потом ривер (шансы и ауты — по показанному столу). Память
 * живёт в Board, а не в панели олл-ина: панель пропадает между раздачами, а новая раздача должна
 * раскрываться, а не считаться «первым кадром».
 */
function useStreetReveal(showdown: ShowdownState | null, nowMs: number): ShowdownState | null {
  const target: RevealTarget | null = showdown
    ? { showdownId: showdown.showdownId, size: showdown.board.length }
    : null;
  const [reveal, setReveal] = useState(() => revealStart(target, nowMs));
  const next = revealStep(reveal, target, nowMs);
  // Производное состояние прямо в рендере (шаблон React «состояние из прошлых рендеров»).
  if (next !== reveal) setReveal(next);
  if (!showdown || !target) return null;
  const size = revealedSize(next, target);
  return size === showdown.board.length
    ? showdown
    : { ...showdown, board: showdown.board.slice(0, size) };
}

/**
 * Включить или выключить голос. Звук браузер даёт только после нажатия — на ТВ хватает одного
 * нажатия пульта; «Включить голос» видно и когда голос был включён раньше, но звук ещё спит.
 * data-voice-toggle — общий обработчик «разбудить звук любым нажатием» эту кнопку пропускает
 * (VOICE_TOGGLE_SELECTOR в voicePlayer.ts), решает press.
 */
function VoiceButton({ voice }: { voice: BoardVoice }) {
  if (voice.status === 'unsupported') return null;
  const on = voice.status === 'on';
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={on ? 'volume-x' : 'volume-2'}
      onClick={voice.press}
      data-voice-toggle=""
    >
      {on ? 'Выключить голос' : 'Включить голос'}
    </Button>
  );
}

type Replayed = ReturnType<typeof replayLog>;

function LiveBoard({
  data,
  state,
  applied,
  nameOf,
  nowMs,
}: {
  data: BoardState;
  state: Replayed['state'];
  applied: Replayed['applied'];
  nameOf: NameOf;
  nowMs: number;
}) {
  const { format } = data;
  const timer = state.timer;
  const clock = clockView(state);
  const signal = boardClock(state);
  const pausedMs = pausedForMs(state, applied, nowMs);
  // Перерыв на N минут (022): отсчёт «продолжаем через», по истечении — «пора продолжать» и
  // подсветка блока часов. Таймер сам не продолжает — только банкир.
  const brk = breakView(state, nowMs);
  const trig = state.currentLevel.trigger;
  const trigNote =
    trig.type === 'hands'
      ? `раздач на уровне: ${timer.handsInLevel} из ${trig.count}`
      : trig.type === 'eliminations'
        ? `вылетов на уровне: ${timer.bustsInLevel} из ${trig.count}`
        : null;
  // Выплаты по местам — доменная раскладка фонда (та же, что попадёт в итог).
  const prizes = payouts(state.prizePoolRub, format.payoutPct, state.joinOrder.length);
  const ko = lastKnockout(applied, nameOf);
  const rebuy = rebuyLine(format, state);
  const alive = orderedPlayers(state).filter((p) => p.alive);
  const bottom = tableLine(state);
  const blinds = formatBlinds(state.currentLevel);
  const big = bigBlinds(state.currentLevel);

  const screenRef = useRef<HTMLDivElement>(null);
  useFitToScreen(
    screenRef,
    [alive.length, prizes.length, ko?.by, signal.paused, signal.lastLevel, brk?.due].join('|'),
    BOARD_FIT_VAR,
  );

  return (
    <div ref={screenRef} className="bd-main bd-screen">
      <section
        className={cn(
          'bd-clock',
          signal.paused && 'bd-clock--paused',
          brk?.due && 'bd-clock--due',
          signal.finalMinute && 'bd-clock--final',
          signal.fresh && 'bd-clock--fresh',
        )}
        aria-label="Уровень и таймер"
      >
        <p className="m-eyebrow">{levelLabel(format, state)}</p>
        {signal.paused ? (
          // Пауза — на весь блок часов: слово вместо цифр и сколько уже стоим; перерыв на N минут —
          // сколько осталось до конца или «пора продолжать».
          <>
            <div className="bd-glow">
              <p
                className="m-display bd-big"
                role="timer"
                aria-label={`${brk ? `Перерыв, ${breakLine(brk)}` : 'Пауза'}. ${clock.aria}`}
              >
                {brk ? 'Перерыв' : 'Пауза'}
              </p>
            </div>
            {brk ? (
              <p className={brk.due ? 'm-h2 bd-due' : 'm-h2 bd-hot'}>
                {brk.due && <Icon name="clock" size={20} />}
                <span>{breakLine(brk)}</span>
              </p>
            ) : (
              <p className="m-h2 bd-hot">
                {pausedMs === null ? 'часы стоят' : pauseText(pausedMs)}
              </p>
            )}
            <p className="m-body bd-muted">
              {signal.lastLevel ? `Последний уровень · ${blinds}` : `На часах ${clock.text}`}
            </p>
          </>
        ) : signal.lastLevel ? (
          // Последний уровень сам не кончается: главное число — блайнды, а не счёт вверх.
          <>
            <p className="m-h2 bd-hot">Последний уровень</p>
            {/* Одной строкой, вписанной в колонку (board.css, --bd-em); анте — строкой ниже. */}
            <div className="bd-glow">
              <p
                className="m-display bd-big bd-big--wide"
                style={{ '--bd-em': String(big.em) } as CSSProperties}
                aria-label={`Последний уровень, блайнды ${blinds}`}
              >
                <BlindsText text={big.text} />
              </p>
            </div>
            {big.ante && <p className="m-h3">Анте {big.ante}</p>}
            <p className="m-body bd-muted">Блайнды больше не растут</p>
          </>
        ) : (
          <>
            {/* Единственное свечение экрана — за главным числом (исключение правил Янтаря). */}
            <div className="bd-glow">
              <p className="m-display bd-big bd-time" role="timer" aria-label={clock.aria}>
                {clock.text}
              </p>
            </div>
            {signal.finalMinute && (
              <p className="m-h3 bd-final">
                <Icon name="clock" size={20} /> Последняя минута уровня
              </p>
            )}
          </>
        )}
        {!signal.lastLevel && (
          <div className="bd-blinds">
            <div className="bd-blinds__now">
              <p className="m-eyebrow">Блайнды</p>
              <p className="m-figure bd-blinds__value">
                <BlindsText text={blinds} />
              </p>
            </div>
            <div className="bd-blinds__next">
              <p className="m-eyebrow">Дальше</p>
              <p className="m-figure bd-muted">
                {state.nextLevel ? (
                  <BlindsText text={formatBlinds(state.nextLevel)} />
                ) : (
                  'блайнды не растут'
                )}
              </p>
            </div>
          </div>
        )}
        {trigNote && <p className="m-body bd-muted">{trigNote}</p>}
        <p className={rebuy.emphasis ? 'm-h3 bd-rebuy bd-rebuy--hot' : 'm-body bd-rebuy'}>
          <Icon name={state.rebuysOpen ? 'refresh-cw' : 'x'} size={20} />
          <span>{rebuy.text}</span>
        </p>
        {bottom && <p className="m-h3 bd-bottom">{bottom}</p>}
      </section>

      <section className="bd-side" aria-label="Стол и деньги">
        {/* Выплаты по местам — рядом с фондом, теми же плитками: на ТВ так всё в экране. */}
        <Stats className="bd-stats">
          <Stat
            label="В игре"
            value={String(state.aliveCount)}
            unit={`из ${state.joinOrder.length}`}
            note={entriesText(state)}
          />
          <Stat label="Фонд" value={formatNumber(state.prizePoolRub)} unit="₽" />
          {prizes.map((rub, index) => (
            <Stat
              key={index}
              label={`${ordinalPlace(index + 1)} место`}
              value={formatNumber(rub)}
              unit="₽"
            />
          ))}
        </Stats>

        {ko && (
          <div className="bd-block">
            <p className="m-eyebrow">Последний нокаут</p>
            <p className="m-body bd-names">
              <span className="bd-ko">{ko.victim}</span>
              <span className="bd-muted">
                {NBSP}· {ko.by}
              </span>
            </p>
          </div>
        )}

        {alive.length > 0 && (
          <div className="bd-block">
            <p className="m-eyebrow">За столом</p>
            <p className="m-body bd-names">
              {alive.map((p) => nameOf(p.playerId)).join(NAMES_SEP)}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function WaitingBoard({
  data,
  state,
  nameOf,
  nowMs,
}: {
  data: BoardState;
  state: Replayed['state'];
  nameOf: NameOf;
  nowMs: number;
}) {
  const { format, evening } = data;
  const seated = state.joinOrder.map(nameOf);
  const scheduledMs = Date.parse(evening.scheduled_at);
  const known = Number.isFinite(scheduledMs);
  const startsIn = known ? startsInText(scheduledMs, nowMs) : null;
  const sameDay = known && moscowDateKey(scheduledMs) === moscowDateKey(nowMs);
  // Время старта прошло, а таймер стоит: часы уровней — «если начнём сейчас» (со следующей минуты).
  const planStart = known
    ? Math.max(scheduledMs, Math.ceil(nowMs / 60_000) * 60_000)
    : Math.ceil(nowMs / 60_000) * 60_000;
  const plan = levelPlan(format, planStart);
  const payoutRows = payoutPlan(format, state);
  const stackBb = startingStackBb(format);

  const screenRef = useRef<HTMLDivElement>(null);
  useFitToScreen(screenRef, `${seated.length}|${plan.length}`, BOARD_FIT_VAR);

  return (
    <div ref={screenRef} className="bd-wait bd-screen" aria-label="Вечер ещё не начался">
      <section className="bd-wait__main">
        {known ? (
          <div className="bd-glow">
            <h1 className="m-display bd-headline">
              {sameDay
                ? `Начинаем в ${formatTime(scheduledMs)}`
                : `Начинаем ${formatDate(scheduledMs, nowMs)} в ${formatTime(scheduledMs)}`}
            </h1>
          </div>
        ) : (
          <div className="bd-glow">
            <h1 className="m-display bd-headline">Скоро начнём</h1>
          </div>
        )}
        <p className="m-h2 bd-hot">{startsIn ?? 'Таймер запустит банкир'}</p>
        <p className="m-h3 bd-muted">
          {seated.length > 0
            ? `За столом ${pluralWithNumber(seated.length, ['игрок', 'игрока', 'игроков'])}`
            : 'Банкир рассаживает игроков'}
        </p>
        {seated.length > 0 && <p className="m-body bd-names">{seated.join(NAMES_SEP)}</p>}
      </section>

      <section className="bd-wait__side" aria-label="Структура вечера">
        {plan.length > 0 && (
          <div className="bd-block">
            <p className="m-eyebrow">
              Уровни · время МСК{startsIn === null ? ', если начать сейчас' : ''}
            </p>
            <table className="bd-plan">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Уровень</th>
                  <th scope="col">Начало</th>
                  <th scope="col">Блайнды</th>
                  <th scope="col">Ребаи</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((row) => (
                  <tr key={row.n} className={row.lastRebuy ? 'bd-plan__last-rebuy' : undefined}>
                    <td className="m-mono bd-muted">{row.n}</td>
                    <td className="m-mono">
                      {row.at === null ? describeTrigger(row.level) : formatTime(row.at)}
                    </td>
                    <td className="bd-plan__blinds">
                      <BlindsText text={formatBlinds(row.level)} />
                    </td>
                    <td className="bd-plan__note">{row.lastRebuy ? 'последний с ребаями' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bd-wait__facts">
          {payoutRows.length > 0 && (
            <div className="bd-block">
              <p className="m-eyebrow">Выплаты</p>
              <List aria-label="Выплаты по местам">
                {payoutRows.map((row) => (
                  <ListItem
                    key={row.place}
                    title={`${ordinalPlace(row.place)} место · ${formatNumber(row.pct)}${NBSP}%`}
                    after={
                      row.rub !== null ? (
                        <span className="m-mono bd-amount">{formatRub(row.rub)}</span>
                      ) : undefined
                    }
                  />
                ))}
              </List>
            </div>
          )}
          {stackBb !== null && (
            <Stats>
              <Stat
                label="Стартовый стек"
                value={formatBbValue(stackBb)}
                unit="BB"
                note={`${formatNumber(format.startingChips)} фишек за ${formatRub(format.buyInRub)}`}
              />
            </Stats>
          )}
        </div>
      </section>
    </div>
  );
}

function FinishedBoard({
  data,
  state,
  nameOf,
}: {
  data: BoardState;
  state: Replayed['state'];
  nameOf: NameOf;
}) {
  const { format } = data;
  // Призы — доменная раскладка фонда по местам (computeMoney), как в итоге вечера в приложении.
  const money = computeMoney(format, state);
  const winner = state.places[0];
  const winnerKos = winner ? (state.players[winner]?.kos ?? 0) : 0;
  const rest = orderedPlayers(state).filter((p) => p.playerId !== winner);
  const hunters = bestHunters(state);
  const hunterKos = hunters[0] ? (state.players[hunters[0]]?.kos ?? 0) : 0;
  const played = state.timer.totalElapsedMs;
  const story = useBoardStory(data);

  const screenRef = useRef<HTMLDivElement>(null);
  useFitToScreen(screenRef, `${rest.length}|${winner ?? ''}|${story.length}`, BOARD_FIT_VAR);

  return (
    <div ref={screenRef} className="bd-wait bd-screen" aria-label="Итог вечера">
      <section className="bd-wait__main">
        <p className="m-eyebrow">Игра окончена · победитель</p>
        <div className="bd-glow">
          <h1 className="m-display bd-headline">{winner ? nameOf(winner) : 'Итог считается'}</h1>
        </div>
        {winner && (
          <p className="m-h2 bd-hot">
            Приз {formatRub(money[winner]?.prizeRub ?? 0)}
            {winnerKos > 0 ? `${NBSP}· ${kosCount(winnerKos)}` : ''}
          </p>
        )}
        {hunters.length > 0 && (
          <p className="m-h3">
            Лучший охотник{NBSP}— {joinNames(hunters.map(nameOf))}: {kosCount(hunterKos)}
            {hunters.length > 1 ? ' у каждого' : ''}
          </p>
        )}
        {played > 0 && <p className="m-h3 bd-muted">Игра шла {formatGameTime(played)}</p>}
        {story.length > 0 && (
          <ul className="bd-story" aria-label="Сюжет вечера">
            {story.map((item, i) => (
              <li key={`${item.kind}:${i}`} className="m-h3">
                {storyLine(item, nameOf)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {rest.length > 0 && (
        <section className="bd-wait__side" aria-label="Места">
          <div className="bd-block">
            <p className="m-eyebrow">Места</p>
            <List aria-label="Места">
              {rest.map((p) => {
                const prize = money[p.playerId]?.prizeRub ?? 0;
                const parts = [
                  prize > 0 ? `приз ${formatRub(prize)}` : null,
                  p.kos > 0 ? kosCount(p.kos) : null,
                ].filter(Boolean);
                return (
                  <ListItem
                    key={p.playerId}
                    before={<span className="m-mono bd-place">{p.place ?? '—'}</span>}
                    title={nameOf(p.playerId)}
                    after={
                      parts.length > 0 ? (
                        <span className="bd-place-after">{parts.join(NAMES_SEP)}</span>
                      ) : undefined
                    }
                  />
                );
              })}
            </List>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * «Сюжет вечера» на табло: только то, что видно из журнала самого вечера («победа с N %» в олл-ине,
 * «феникс», победа после ребаев) — табло без входа не видит истории клуба, поэтому месть Немезиде,
 * рекорды и лидер сезона есть только в приложении и в посте итогов. Шансы — воркер (useAllInSwings);
 * пока считаются, строк нет: сюжет не перестраивается на экране.
 */
function useBoardStory(data: BoardState) {
  const { evening, format, events } = data;
  const allIns = useMemo(() => eveningAllIns(format, events), [format, events]);
  const { swings, pending } = useAllInSwings(allIns);
  return useMemo(() => {
    if (pending) return [];
    try {
      // Очки сюжету не нужны: правила подсчёта — любые.
      const summary = summarize(evening.id, evening.scheduled_at, format, events, DEFAULT_SCORING);
      return eveningStory({ summary, allIns, swings, excluded: new Set() });
    } catch {
      return [];
    }
  }, [evening.id, evening.scheduled_at, format, events, allIns, swings, pending]);
}
