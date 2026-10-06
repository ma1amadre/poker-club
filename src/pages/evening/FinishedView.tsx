// Итог вечера: победитель, места, очки, призы, баунти, нетто, лучший охотник; ссылки на расчёт и
// голосование. Админу — правка закрытого вечера (отмена записей, возврат вечера в игру).
import { computeMoney } from '@domain/money.ts';
import { eveningPoints, eveningScoring } from '@domain/scoring.ts';
import { useState } from 'react';
import { notifyEveningFinished, scoringFromSettings, useSettings } from '../../shared/api';
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
  Amount,
  Avatar,
  Button,
  ButtonLink,
  Card,
  List,
  ListItem,
  Notice,
  Section,
  Stat,
  Stats,
  useToast,
} from '../../shared/ui';
import { bestHunters, orderedPlayers, ordinalPlace, reopenedNotice, totalRebuys } from './lib';
import { EventFeed, PlayersList } from './parts';
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

  const votingOpen =
    evening.voting_closes_at !== null && Date.parse(evening.voting_closes_at) > nowMs;
  const iPlayed = Boolean(player && state.players[player.id]);
  const voteIsMain = votingOpen && iPlayed;
  const settleIsMain = !voteIsMain && canControl && evening.status === 'finished';

  const finishEvent = [...events].reverse().find((e) => e.type === 'finish' && !e.voided);
  const reopened = reopenedNotice(evening, canControl, iPlayed);
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  // Журнал правили после поста итогов (платежи на итог не влияют) — пост в группе устарел.
  const postedAt = evening.results_posted_at ? Date.parse(evening.results_posted_at) : null;
  const resultsOutdated =
    postedAt !== null &&
    events.some(
      (e) =>
        e.type !== 'payment' &&
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
              <p className="m-h2 ev-winner__name">{nameOf(winnerId)}</p>
              <p className="m-small">
                Приз {formatRub(money[winnerId]?.prizeRub ?? 0)}, за головы{' '}
                {formatRub(money[winnerId]?.bountyRub ?? 0)}
              </p>
            </div>
          </div>
        </Card>
      )}

      <Stats>
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

      <div className="ev-actions">
        <ButtonLink
          to={paths.vote(evening.id)}
          variant={voteIsMain ? 'primary' : 'secondary'}
          block
          icon="star"
        >
          Перейти к голосованию
        </ButtonLink>
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
      </div>

      {state.finished ? (
        <Section
          title="Места"
          aside={pluralWithNumber(rows.length, ['игрок', 'игрока', 'игроков'])}
          footer="Нетто — призы и головы минус взносы."
        >
          <List aria-label="Места и деньги">
            {rows.map((p) => {
              const m = money[p.playerId];
              const pts = points[p.playerId];
              const parts = [
                pts !== undefined ? formatPointsWithUnit(pts) : null,
                m && m.prizeRub > 0 ? `приз ${formatRub(m.prizeRub)}` : null,
                m && m.bountyRub > 0 ? `головы ${formatRub(m.bountyRub)}` : null,
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
                      {p.place ?? '—'}
                    </span>
                  }
                  title={
                    <>
                      {nameOf(p.playerId)}
                      {playersById.get(p.playerId)?.is_guest && (
                        <span className="m-small"> · гость</span>
                      )}
                    </>
                  }
                  subtitle={parts.join(' · ') || undefined}
                  after={m ? <Amount value={m.netRub} icon /> : undefined}
                />
              );
            })}
          </List>
        </Section>
      ) : (
        <Section title="Игроки" aside={`${state.aliveCount} в игре`}>
          <PlayersList state={state} nameOf={nameOf} playersById={playersById} />
        </Section>
      )}

      {isAdmin && (
        <Section title="Правка закрытого вечера">
          <p className="m-small">
            Отмена записи пересчитает места, очки и деньги — нажми на неё в журнале ниже. Чтобы
            добавить вылет или ребай, верни вечер в игру: пульт откроется снова на паузе, закрытый
            расчёт откроется, а завершить вечер нужно будет заново — в группу уйдут исправленные
            итоги. Ребай после возврата можно записать, только если ребаи были открыты в момент
            завершения.
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
        errorsById={errorsById}
        onVoid={isAdmin ? (ev) => void actions.voidWithConfirm(ev) : undefined}
        limit={8}
      />
    </>
  );
}
