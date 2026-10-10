// Итог вечера: победитель, места, очки, призы, нетто, лучший охотник; «Сюжет вечера» — 2–4 строки о
// главном (доменный eveningStory); ссылки на расчёт и голосование; «Твой вечер» игравшему или
// сделавшему прогноз (EveningRecap); «Олл-ины вечера» — все записанные раздачи с долями по улицам;
// «Прогнозы вечера» — кто на кого ставил, кто угадал и сколько очков Оракула. Места ведут в карточки
// игроков. Админу —
// правка закрытого вечера (отмена записей, правка входа, ребая и вылета на месте — AmendSheet, возврат
// вечера в игру).
// Миграция 026: банкиру и админу 12 ч после финала — «Ещё игра сегодня» (create_next_game: вечер на сейчас,
// то же место, формат и банкир, открывается его экран); админу на завершённой тренировке — «Засчитать как
// настоящий вечер» (promote_training_evening) с вопросом о последствиях и постом итогов сразу (notify).
import { amendField } from '@domain/amend.ts';
import { computeMoney } from '@domain/money.ts';
import { eveningPoints, eveningScoring } from '@domain/scoring.ts';
import { isShowdownEvent } from '@domain/showdown.ts';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  notifyEveningFinished,
  errorMessage,
  isTrainingEvening,
  scoringFromSettings,
  useClubHistory,
  useCreateNextGame,
  usePredictions,
  useSettings,
  type EveningEventRecord,
} from '../../shared/api';
import { useAuth } from '../../shared/auth';
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatPointsWithUnit,
  formatRub,
  formatTime,
  joinNames,
  paths,
  pluralWithNumber,
} from '../../shared/lib';
import {
  AllInList,
  Amount,
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Icon,
  List,
  ListItem,
  Notice,
  Section,
  Skeleton,
  Stat,
  Stats,
  useToast,
} from '../../shared/ui';
import { AmendSheet } from './AmendSheet';
import { EveningRecapList } from './EveningRecap';
import { StoryFacts } from './EveningStory';
import { useEveningRecap } from './useEveningRecap';
import { useEveningStory } from './useEveningStory';
import { bestHunters, orderedPlayers, ordinalPlace, reopenedNotice, totalRebuys } from './lib';
import { nextGameAvailable, nextGameQuestion, nextGameToast } from './nextGame';
import { usePromoteTraining } from './usePromoteTraining';
import { EventFeed, PlayersList } from './parts';
import {
  ORACLE_NOTE,
  oraclePointsText,
  predictionPickLine,
  predictionResults,
  predictionSummary,
} from './predictions';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface FinishedViewProps {
  model: EveningModel;
  actions: EveningActions;
}

export function FinishedView({ model, actions }: FinishedViewProps) {
  const { evening, state, nameOf, playersById, events, errorsById, isAdmin, canControl, nowMs } =
    model;
  const format = evening.format;
  const { player } = useAuth();
  const settings = useSettings().data;
  const history = useClubHistory();
  // Итог из истории клуба (тот же журнал, сведённый summarize) — пока журнал сходится с итогом
  // и история сведена из того же журнала, что на экране (иначе она перезапрашивается).
  const recap = useEveningRecap(
    state.finished ? history.data : undefined,
    evening.id,
    player?.id,
    events,
  );
  // Ачивки из «Твоего вечера» сюжет не повторяет (только пока карточка «Твой вечер» на экране).
  const story = useEveningStory(model, history, settings, recap?.recap.newAchievements);
  const money = computeMoney(format, state);
  // Очки — по правилам, зафиксированным при завершении вечера (evenings.scoring), а не текущим.
  const points = eveningPoints(
    state,
    eveningScoring(evening.scoring, scoringFromSettings(settings)),
  );
  const rows = orderedPlayers(state);
  const winnerId = state.finished ? state.places[0] : undefined;
  const hunters = bestHunters(state);
  const hunterKos = hunters[0] ? (state.players[hunters[0]]?.kos ?? 0) : 0;
  const rebuys = totalRebuys(state);

  // У тренировки голосования нет (voting_closes_at всегда null, миграция 023) — и кнопки к нему.
  const training = isTrainingEvening(evening);
  const votingOpen =
    evening.voting_closes_at !== null && Date.parse(evening.voting_closes_at) > nowMs;
  const iPlayed = Boolean(player && state.players[player.id]);
  const voteIsMain = votingOpen && iPlayed;
  const settleIsMain = !voteIsMain && canControl && evening.status === 'finished';

  const finishEvent = [...events].reverse().find((e) => e.type === 'finish' && !e.voided);
  const reopened = reopenedNotice(evening, canControl, iPlayed);
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  // Журнал: вход, ребай и вылет — «Изменить запись» (там же отмена), остальное — подтверждение отмены.
  const [amending, setAmending] = useState<EveningEventRecord | null>(null);
  const selectEvent = (ev: EveningEventRecord) => {
    if (amendField(ev) !== null && !ev.voided) setAmending(ev);
    else void actions.voidWithConfirm(ev);
  };
  // Журнал правили после поста итогов (платежи и олл-ин на итог не влияют) — пост в группе устарел.
  const postedAt = evening.results_posted_at ? Date.parse(evening.results_posted_at) : null;
  const resultsOutdated =
    postedAt !== null &&
    events.some(
      (e) =>
        e.type !== 'payment' &&
        !isShowdownEvent(e.type) &&
        (Date.parse(e.at) > postedAt || (e.voidedAt !== null && Date.parse(e.voidedAt) > postedAt)),
    );

  const publishCorrection = async () => {
    setPublishing(true);
    try {
      const outcome = await notifyEveningFinished(evening.id, 'evening_corrected');
      if (outcome === 'posted')
        toast.show('Исправленный итог отправлен в группу', { tone: 'positive' });
      else if (outcome === 'no_changes') toast.show('С прошлого поста итог не менялся');
      else if (outcome === 'no_group')
        toast.show('Группа клуба не подключена', { tone: 'caution' });
      else toast.show('Итог уже обновили — новый пост не нужен');
    } catch (error) {
      toast.error(error);
    }
    setPublishing(false);
  };

  const reopen = async () => {
    if (finishEvent)
      await actions.voidWithConfirm(finishEvent, {
        title: 'Вернуть вечер в игру?',
        confirmText: 'Вернуть в игру',
      });
  };

  // «Ещё игра сегодня» (миграция 026): вечер на сейчас и сразу его экран.
  const navigate = useNavigate();
  const nextGame = useCreateNextGame(evening.id);
  const canNextGame = state.finished && nextGameAvailable(evening, canControl, nowMs);
  const createNextGame = async () => {
    if (!(await actions.confirm(nextGameQuestion()))) return;
    nextGame.mutate(undefined, {
      onSuccess: (result) => {
        const { success, detail } = nextGameToast(result);
        toast.show(success, { tone: 'positive', detail });
        navigate(paths.evening(result.eveningId));
      },
    });
  };

  // Зачёт тренировки (миграция 026): только админ, только завершённая, отменить нельзя.
  const promote = usePromoteTraining(actions.confirm);
  const canPromote = training && isAdmin && state.finished;
  const promoteTraining = () =>
    promote.run(
      evening.id,
      state.joinOrder.filter((id) => playersById.get(id)?.is_guest).map(nameOf),
    );

  return (
    <>
      {!state.finished && (
        <Notice tone="caution" title="Итог не сходится с журналом">
          {isAdmin
            ? `После правки в игре ${pluralWithNumber(state.aliveCount, ['игрок', 'игрока', 'игроков'])}. Верни вечер в игру, отметь недостающие вылеты и заверши его заново.`
            : 'Админ правит журнал вечера. Итог обновится сам.'}
        </Notice>
      )}

      {/* Без кнопки: «Открыть расчёт» ниже на этом же экране. */}
      {reopened && (
        <Notice tone="caution" title={reopened.title}>
          {reopened.text}
        </Notice>
      )}

      {winnerId && (
        <Card>
          <div className="ev-winner">
            <Avatar
              name={nameOf(winnerId)}
              photoUrl={playersById.get(winnerId)?.photo_url}
              size="xl"
            />
            <div className="ev-winner__text">
              <p className="m-eyebrow">Победитель вечера</p>
              <p className="m-h2 ui-name ev-winner__name">{nameOf(winnerId)}</p>
              <p className="m-small">Приз {formatRub(money[winnerId]?.prizeRub ?? 0)}</p>
            </div>
          </div>
        </Card>
      )}

      <Stats className="ui-stats--cells">
        <Stat label="Призовой фонд" value={formatNumber(state.prizePoolRub)} unit="₽" />
        <Stat
          label="Входов"
          value={String(state.totalEntries)}
          note={`${pluralWithNumber(state.joinOrder.length, ['игрок', 'игрока', 'игроков'])}, ${pluralWithNumber(rebuys, ['ребай', 'ребая', 'ребаев'])}`}
        />
        {state.timer.totalElapsedMs > 0 && (
          <Stat
            label="Игра шла"
            value={formatDuration(state.timer.totalElapsedMs)}
            note="без пауз"
          />
        )}
      </Stats>

      {hunters.length > 0 && (
        <p className="m-body">
          Лучший охотник — {joinNames(hunters.map(nameOf))}:{' '}
          {pluralWithNumber(hunterKos, ['нокаут', 'нокаута', 'нокаутов'])}
          {hunters.length > 1 ? ' у каждого' : ''}.
        </p>
      )}

      {/* Сюжет — когда шансы олл-инов и история посчитаны: строки не перестраиваются на глазах. */}
      {state.finished && !story.pending && story.items.length > 0 && (
        <Section title="Сюжет вечера">
          <StoryFacts items={story.items} nameOf={nameOf} meId={player?.id} />
        </Section>
      )}

      <div className="ev-actions">
        {!training && (
          <ButtonLink
            to={paths.vote(evening.id)}
            variant={voteIsMain ? 'primary' : 'secondary'}
            block
            icon="star"
          >
            Перейти к голосованию
          </ButtonLink>
        )}
        <ButtonLink
          to={paths.settle(evening.id)}
          variant={settleIsMain ? 'primary' : 'secondary'}
          block
          icon="wallet"
        >
          Открыть расчёт
        </ButtonLink>
        {votingOpen && evening.voting_closes_at && (
          <p className="m-small">
            Голосовать можно до {formatDate(evening.voting_closes_at, nowMs)},{' '}
            {formatTime(evening.voting_closes_at)}.
          </p>
        )}
        {canNextGame && (
          <Button
            block
            icon="plus"
            loading={nextGame.isPending}
            onClick={() => void createNextGame()}
          >
            Ещё игра сегодня
          </Button>
        )}
      </div>

      {canPromote && (
        <Section
          title="Зачёт тренировки"
          footer="Если тренировку сыграли всерьёз, её можно засчитать: места, очки, ачивки и деньги войдут в историю клуба, в группу уйдёт пост итогов, голосование откроется на 24 часа. В одну сторону — обратно в тренировку вечер не вернуть."
        >
          <Button
            variant="danger"
            block
            icon="check"
            loading={promote.pending}
            onClick={() => void promoteTraining()}
          >
            Засчитать как настоящий вечер
          </Button>
        </Section>
      )}

      {recap && player && (
        <Section title="Твой вечер">
          <Card>
            <EveningRecapList
              recap={recap.recap}
              pick={recap.pick}
              meId={player.id}
              nameOf={nameOf}
              withResult
            />
          </Card>
        </Section>
      )}

      {state.finished ? (
        <Section
          title="Места"
          aside={pluralWithNumber(rows.length, ['игрок', 'игрока', 'игроков'])}
          footer="Нетто — приз минус взносы."
        >
          <List aria-label="Места и деньги">
            {rows.map((p) => {
              const m = money[p.playerId];
              const pts = points[p.playerId];
              const parts = [
                pts !== undefined ? formatPointsWithUnit(pts) : null,
                m && m.prizeRub > 0 ? `приз ${formatRub(m.prizeRub)}` : null,
                p.kos > 0 ? pluralWithNumber(p.kos, ['нокаут', 'нокаута', 'нокаутов']) : null,
                p.rebuys > 0 ? pluralWithNumber(p.rebuys, ['ребай', 'ребая', 'ребаев']) : null,
              ].filter(Boolean);
              return (
                <ListItem
                  key={p.playerId}
                  before={
                    <span
                      className="m-mono ev-place"
                      aria-label={p.place ? `${ordinalPlace(p.place)} место` : undefined}
                    >
                      {/* «01» — место двумя знаками, как в таблицах «Терминала». */}
                      {p.place ? String(p.place).padStart(2, '0') : '—'}
                    </span>
                  }
                  title={
                    <>
                      <span className="ui-name">{nameOf(p.playerId)}</span>
                      {p.playerId === player?.id && (
                        <>
                          {' '}
                          <span className="ui-me-tag">ты</span>
                        </>
                      )}
                      {playersById.get(p.playerId)?.is_guest && (
                        <span className="m-small"> · гость</span>
                      )}
                    </>
                  }
                  subtitle={parts.join(' · ') || undefined}
                  after={m ? <Amount value={m.netRub} icon /> : undefined}
                  to={paths.player(p.playerId)}
                />
              );
            })}
          </List>
        </Section>
      ) : (
        <Section title="Игроки" aside={`${state.aliveCount} в игре`}>
          <PlayersList
            state={state}
            format={format}
            nameOf={nameOf}
            playersById={playersById}
            linkPlayers
            meId={player?.id}
          />
        </Section>
      )}

      {story.allIns.length > 0 && (
        <Section
          title="Олл-ины вечера"
          aside={pluralWithNumber(story.allIns.length, ['раздача', 'раздачи', 'раздач'])}
          footer="Доли банка — как на табло: на каждой улице, где раздачу показывали. «Победа с N %» — банк забрал тот, у кого шансов было меньше."
        >
          <AllInList allIns={story.allIns} nameOf={nameOf} meId={player?.id} />
        </Section>
      )}

      <EveningPredictions model={model} meId={player?.id ?? null} />

      {isAdmin && (
        <Section title="Правка закрытого вечера">
          <p className="m-small">
            Отмена записи пересчитает места, очки и деньги — нажми на неё в журнале ниже. У входа,
            ребая и вылета там же можно исправить сумму или кто выбил: запись останется на своём
            месте, места не изменятся. Чтобы добавить вылет или ребай, верни вечер в игру: пульт
            откроется снова на паузе, закрытый расчёт откроется, а завершить вечер нужно будет
            заново{training ? '' : ' — в группу уйдут исправленные итоги'}. Ребай после возврата
            можно записать, только если ребаи были открыты в момент завершения.
          </p>
          {resultsOutdated && (
            <Notice
              tone="caution"
              title="Итог в группе устарел"
              action={
                <Button
                  size="sm"
                  icon="send"
                  loading={publishing}
                  onClick={() => void publishCorrection()}
                >
                  Опубликовать исправление
                </Button>
              }
            >
              Журнал правили после поста итогов: места или деньги в группе могут не совпадать с
              приложением.
            </Notice>
          )}
          {finishEvent && (
            <Button variant="danger" block icon="rotate-ccw" onClick={() => void reopen()}>
              Вернуть вечер в игру
            </Button>
          )}
        </Section>
      )}

      <EventFeed
        title="Журнал вечера"
        events={events}
        nameOf={nameOf}
        format={format}
        errorsById={errorsById}
        feed={model.feed}
        onSelect={isAdmin ? selectEvent : undefined}
        canEdit={isAdmin ? (ev) => amendField(ev) !== null : undefined}
        limit={8}
      />
      {isAdmin && (
        <AmendSheet
          event={amending}
          onClose={() => setAmending(null)}
          model={model}
          actions={actions}
        />
      )}
    </>
  );
}

/**
 * «Прогнозы вечера» на экране итога: кто на кого ставил (победитель и первый вылет), кто угадал и
 * сколько очков Оракула получил. Очки — доменная scorePrediction по журналу вечера. Чужие прогнозы
 * RLS отдаёт после старта, поэтому здесь видны все. Прогнозов не было — блока нет.
 */
function EveningPredictions({ model, meId }: { model: EveningModel; meId: string | null }) {
  const { evening, state, nameOf, playersById } = model;
  const predictions = usePredictions(evening.id);

  if (predictions.isPending) {
    return (
      <Section title="Прогнозы вечера">
        <Skeleton height={64} />
      </Section>
    );
  }
  if (predictions.isError) {
    return (
      <Section title="Прогнозы вечера">
        <Notice
          tone="critical"
          title="Прогнозы не загрузились"
          action={
            <Button size="sm" onClick={() => void predictions.refetch()}>
              Повторить
            </Button>
          }
        >
          {errorMessage(predictions.error)}
        </Notice>
      </Section>
    );
  }

  const rows = predictionResults(predictions.data, state, nameOf, meId);
  if (rows.length === 0) return null;
  const summary = predictionSummary(rows, state, nameOf);

  return (
    <Section
      title="Прогнозы вечера"
      aside={pluralWithNumber(rows.length, ['прогноз', 'прогноза', 'прогнозов'])}
      footer={ORACLE_NOTE}
    >
      <ul className="ev-factlist">
        <li>
          <Icon name="trophy" size={16} />
          <span>{summary.winner}</span>
        </li>
        <li>
          <Icon name="flag" size={16} />
          <span>{summary.firstOut}</span>
        </li>
      </ul>
      <List aria-label="Прогнозы вечера">
        {rows.map((row) => {
          const who = playersById.get(row.playerId);
          return (
            <ListItem
              key={row.playerId}
              before={<Avatar name={nameOf(row.playerId)} photoUrl={who?.photo_url} size="md" />}
              title={
                <>
                  <span className="ui-name">{nameOf(row.playerId)}</span>
                  {row.playerId === meId && (
                    <>
                      {' '}
                      <span className="ui-me-tag">ты</span>
                    </>
                  )}
                </>
              }
              subtitle={predictionPickLine(row, nameOf)}
              after={
                <Badge tone={row.points > 0 ? 'positive' : 'neutral'}>
                  {oraclePointsText(row.points)}
                </Badge>
              }
              to={paths.player(row.playerId)}
            />
          );
        })}
      </List>
    </Section>
  );
}
