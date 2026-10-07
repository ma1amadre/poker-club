// Табло /board/:token для ТВ и ноутбука — регистр Янтарь (data-theme ставит ThemeScope в
// routes.tsx). Публичное и вне AuthProvider: данные только через useBoardState (RPC board_state
// для anon, опрос раз в 3 с), время — useNow + replay на клиенте, как у всех экранов вечера.
// Денег из платежей здесь нет (board_state их не отдаёт) — только фонд и выплаты по местам.
// Голос (useBoardVoice) объявляет события вечера клипами Silero — включается кнопкой.
import { payouts } from '@domain/money.ts';
import { replayLog } from '@domain/replay.ts';
import { visibleShowdown } from '@domain/showdown.ts';
import { VOICE_CREDIT } from '@domain/voice.ts';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { errorMessage, useBoardState, type BoardState } from '../../shared/api';
import {
  clockOffsetMs,
  formatBlinds,
  formatDateNumeric,
  formatNumber,
  formatRub,
  formatTime,
  pluralWithNumber,
  useNow,
} from '../../shared/lib';
import { Badge, Button, Icon, List, ListItem, PageSkeleton, Stat, Stats } from '../../shared/ui';
import {
  clockView,
  describeEvent,
  levelLabel,
  orderedPlayers,
  ordinalPlace,
  rebuyText,
  rebuyWindow,
  totalRebuys,
  type NameOf,
} from '../evening/lib';
import './board.css';
import { ShowdownBoard } from './ShowdownBoard';
import { useFullscreen, useWakeLock } from './useScreenControls';
import { useBoardVoice, type BoardVoice } from './useBoardVoice';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BoardPage() {
  const { token } = useParams<{ token: string }>();
  // Обрезанная или испорченная ссылка — сразу «погасло», без запроса (RPC ждёт uuid).
  const valid = Boolean(token && UUID_RE.test(token));
  const query = useBoardState(valid ? token : undefined);

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
        text="Вечер по этой ссылке не найден или закончился больше шести часов назад. Открой свежую ссылку: экран вечера в приложении клуба → «Вывести на ТВ»."
      />
    );
  }
  return (
    <Board
      token={token ?? ''}
      data={query.data}
      failing={query.isError || query.fetchStatus === 'paused'}
      updatedAt={query.dataUpdatedAt}
    />
  );
}

function BoardMessage({
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

function Board({
  token,
  data,
  failing,
  updatedAt,
}: {
  token: string;
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
  const voice = useBoardVoice({ token, data, state, applied, nowMs });

  const when = `${formatDateNumeric(evening.scheduled_at).slice(0, 5)} · ${formatTime(evening.scheduled_at)}`;
  const place = evening.location ? ` · ${evening.location}` : '';
  const finished = state.finished || evening.status === 'finished' || evening.status === 'settled';
  // Олл-ин закрывает таймер и стол, пока банкир его не закроет (или табло не спрячет его само).
  const showdown = visibleShowdown(state.showdown, nowMs);

  return (
    <main className={showdown && !finished ? 'bd bd--showdown' : 'bd'}>
      <header className="bd-head">
        <p className="m-eyebrow">
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
        <FinishedBoard state={state} nameOf={nameOf} />
      ) : showdown ? (
        <ShowdownBoard showdown={showdown} state={state} format={format} nameOf={nameOf} />
      ) : state.timer.status === 'not_started' ? (
        <WaitingBoard state={state} nameOf={nameOf} />
      ) : (
        <LiveBoard data={data} state={state} applied={applied} nameOf={nameOf} />
      )}

      <footer className="bd-foot">
        {wake === 'unsupported' && (
          <p className="m-small bd-muted">
            Этот браузер не умеет держать экран включённым — отключи сон экрана в настройках
            устройства.
          </p>
        )}
        {voice.status === 'on' && voice.missing > 0 && (
          <p className="m-small bd-muted">
            Часть фраз этого вечера ещё не озвучена — табло скажет их короче, без имён. Новые имена
            озвучиваются раз в сутки.
          </p>
        )}
        {voice.status !== 'unsupported' && <p className="m-small bd-muted">{VOICE_CREDIT}</p>}
      </footer>
    </main>
  );
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
}: {
  data: BoardState;
  state: Replayed['state'];
  applied: Replayed['applied'];
  nameOf: NameOf;
}) {
  const { format } = data;
  const timer = state.timer;
  const paused = timer.status === 'paused';
  const clock = clockView(state);
  const trig = state.currentLevel.trigger;
  const trigNote =
    trig.type === 'hands'
      ? `раздач на уровне: ${timer.handsInLevel} из ${trig.count}`
      : trig.type === 'eliminations'
        ? `вылетов на уровне: ${timer.bustsInLevel} из ${trig.count}`
        : null;
  // Выплаты по местам — доменная раскладка фонда (та же, что попадёт в итог).
  const prizes = payouts(state.prizePoolRub, format.payoutPct, state.joinOrder.length);
  const koEvent = [...applied].reverse().find((e) => e.type === 'bust');
  const koLine = koEvent ? describeEvent(koEvent, nameOf, formatRub, format) : null;
  const rebuys = totalRebuys(state);
  const alive = orderedPlayers(state).filter((p) => p.alive);

  return (
    <div className="bd-main">
      <section className="bd-clock" aria-label="Уровень и таймер">
        <div className="bd-clock__head">
          <p className="m-eyebrow">{levelLabel(format, state)}</p>
          {paused && (
            <Badge tone="neutral">
              <Icon name="pause" size={14} /> Пауза
            </Badge>
          )}
        </div>
        {/* Единственное свечение экрана — за главным числом (исключение правил Янтаря). */}
        <div className="bd-glow">
          <p
            className={paused ? 'm-display bd-time bd-time--paused' : 'm-display bd-time'}
            role="timer"
            aria-label={clock.aria}
          >
            {clock.text}
          </p>
        </div>
        {clock.note && <p className="m-body bd-muted">{clock.note}</p>}
        <div className="bd-blinds">
          <div className="bd-blinds__now">
            <p className="m-eyebrow">Блайнды</p>
            <p className="m-figure bd-blinds__value">{formatBlinds(state.currentLevel)}</p>
          </div>
          <div className="bd-blinds__next">
            <p className="m-eyebrow">Дальше</p>
            <p className="m-figure bd-muted">
              {state.nextLevel ? formatBlinds(state.nextLevel) : 'блайнды не растут'}
            </p>
          </div>
        </div>
        {trigNote && <p className="m-body bd-muted">{trigNote}</p>}
        <p className="m-body bd-rebuy">
          <Icon name={state.rebuysOpen ? 'refresh-cw' : 'x'} size={20} />
          <span>{rebuyText(rebuyWindow(format, state))}</span>
        </p>
      </section>

      <section className="bd-side" aria-label="Стол и деньги">
        <Stats>
          <Stat
            label="В игре"
            value={String(state.aliveCount)}
            unit={`из ${state.joinOrder.length}`}
            note={`${pluralWithNumber(state.totalEntries, ['вход', 'входа', 'входов'])}, ${pluralWithNumber(rebuys, ['ребай', 'ребая', 'ребаев'])}`}
          />
          <Stat label="Фонд" value={formatNumber(state.prizePoolRub)} unit="₽" />
        </Stats>

        {prizes.length > 0 && (
          <div className="bd-block">
            <p className="m-eyebrow">Выплаты</p>
            <List aria-label="Выплаты по местам">
              {prizes.map((rub, index) => (
                <ListItem
                  key={index}
                  title={`${ordinalPlace(index + 1)} место`}
                  after={<span className="m-mono bd-amount">{formatRub(rub)}</span>}
                />
              ))}
            </List>
          </div>
        )}

        {koLine && (
          <div className="bd-block">
            <p className="m-eyebrow">Последний нокаут</p>
            <p className="m-h3">{koLine.title}</p>
            {koLine.detail && <p className="m-body bd-muted">{koLine.detail}</p>}
          </div>
        )}

        {alive.length > 0 && (
          <div className="bd-block">
            <p className="m-eyebrow">За столом</p>
            <p className="m-body bd-names">{alive.map((p) => nameOf(p.playerId)).join(' · ')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function WaitingBoard({ state, nameOf }: { state: Replayed['state']; nameOf: NameOf }) {
  const seated = state.joinOrder.map(nameOf);
  return (
    <section className="bd-wait" aria-label="Вечер ещё не начался">
      <div className="bd-glow">
        <h1 className="m-display">Скоро начнём</h1>
      </div>
      <p className="m-h3 bd-muted">
        {seated.length > 0
          ? `За столом ${pluralWithNumber(seated.length, ['игрок', 'игрока', 'игроков'])}`
          : 'Банкир рассаживает игроков'}
      </p>
      {seated.length > 0 && <p className="m-body bd-names">{seated.join(' · ')}</p>}
    </section>
  );
}

function FinishedBoard({ state, nameOf }: { state: Replayed['state']; nameOf: NameOf }) {
  const winner = state.places[0];
  const rest = orderedPlayers(state).filter((p) => p.playerId !== winner);
  return (
    <section className="bd-wait" aria-label="Итог вечера">
      <p className="m-eyebrow">Игра окончена · победитель</p>
      <div className="bd-glow">
        <h1 className="m-display">{winner ? nameOf(winner) : 'Итог считается'}</h1>
      </div>
      {rest.length > 0 && (
        <List aria-label="Места">
          {rest.map((p) => (
            <ListItem
              key={p.playerId}
              before={<span className="m-mono bd-place">{p.place ?? '—'}</span>}
              title={nameOf(p.playerId)}
              after={
                p.kos > 0 ? (
                  <span className="m-small">
                    {pluralWithNumber(p.kos, ['нокаут', 'нокаута', 'нокаутов'])}
                  </span>
                ) : undefined
              }
            />
          ))}
        </List>
      )}
    </section>
  );
}
