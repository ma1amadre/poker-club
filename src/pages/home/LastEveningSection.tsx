// Последний сыгранный вечер: победитель, мои место, очки и нетто (из итога домена summarize),
// «Твой вечер» игравшему или сделавшему прогноз (eveningRecap домена) и ссылка на итоги
// голосования. Открытое голосование — отдельным сообщением OpenVoting выше ленты: у него срок,
// это действие, а не новость.
import { VOTE_CATEGORIES } from '@domain/votes.ts';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  EVENING_STATUS_META,
  errorMessage,
  useVotes,
  type ClubHistory,
  type Player,
} from '../../shared/api';
import {
  capitalize,
  formatDate,
  formatDateTime,
  formatPoints,
  formatWeekdayDate,
  gameSuffix,
  paths,
  signedNumber,
  votingPhase,
} from '../../shared/lib';
import {
  Avatar,
  ButtonLink,
  Card,
  ErrorView,
  Icon,
  Notice,
  Section,
  Stat,
  Stats,
} from '../../shared/ui';
import { EveningRecapList } from '../evening/EveningRecap';
import { useEveningRecap } from '../evening/useEveningRecap';
import { myResult, playerName, UNKNOWN_PLAYER } from './lib';

export interface LastEveningSectionProps {
  history: UseQueryResult<ClubHistory>;
  me: Player;
  playersById: ReadonlyMap<string, Player>;
  nowMs: number;
}

export function LastEveningSection({ history, me, playersById, nowMs }: LastEveningSectionProps) {
  const recap = useEveningRecap(history.data, history.data?.evenings[0]?.id ?? '', me.id);
  if (history.isError) {
    return (
      <Section title="Последний вечер">
        <ErrorView
          error={history.error}
          title="Итоги вечеров не загрузились"
          onRetry={() => void history.refetch()}
        />
      </Section>
    );
  }
  const data = history.data;
  if (!data) return null;

  const evening = data.evenings[0];
  if (!evening) {
    return (
      <Section title="Последний вечер">
        <p className="m-small">Сыгранных вечеров ещё нет — итоги появятся после первой игры.</p>
      </Section>
    );
  }

  const summary = data.summaryById.get(evening.id);
  const failure = data.failed.find((f) => f.eveningId === evening.id);

  return (
    <Section
      title="Последний вечер"
      aside={`${formatDate(evening.scheduled_at, nowMs)}${gameSuffix(evening.game_no)}`}
    >
      {summary ? (
        <Card>
          <p className="m-eyebrow">
            {capitalize(formatWeekdayDate(evening.scheduled_at))} ·{' '}
            {EVENING_STATUS_META[evening.status].title}
          </p>
          <Winner winnerId={summary.places[0] ?? null} me={me} playersById={playersById} />
          <Mine result={myResult(summary, me.id)} />
          {recap && (
            <>
              <hr className="home-rule" />
              <p className="m-eyebrow">Твой вечер</p>
              <EveningRecapList
                recap={recap.recap}
                pick={recap.pick}
                meId={me.id}
                nameOf={(id) => playerName(playersById, id) ?? UNKNOWN_PLAYER}
              />
            </>
          )}
          <div className="home-actions">
            <ButtonLink size="sm" iconAfter="arrow-right" to={paths.evening(evening.id)}>
              Итоги вечера
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <Notice
          tone="caution"
          title="Итог вечера не сводится"
          action={
            <ButtonLink size="sm" to={paths.evening(evening.id)}>
              Открыть
            </ButtonLink>
          }
        >
          {failure
            ? `${withPeriod(failure.message)} Журнал вечера должен поправить админ.`
            : 'Журнал вечера должен поправить админ.'}
        </Notice>
      )}
      {votingPhase(evening, nowMs) === 'closed' && evening.voting_closes_at && (
        <div className="home-actions">
          <ButtonLink size="sm" variant="ghost" icon="star" to={paths.vote(evening.id)}>
            Итоги голосования
          </ButtonLink>
        </div>
      )}
    </Section>
  );
}

function withPeriod(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function Winner({
  winnerId,
  me,
  playersById,
}: {
  winnerId: string | null;
  me: Player;
  playersById: ReadonlyMap<string, Player>;
}) {
  if (!winnerId) return null;
  const winner = playersById.get(winnerId);
  return (
    <div className="home-winner">
      <Avatar name={winner?.display_name ?? '?'} photoUrl={winner?.photo_url} size="lg" />
      <div className="home-winner__text">
        <p className="m-small">Победитель</p>
        <p className="m-h3 ui-name">
          {playerName(playersById, winnerId) ?? UNKNOWN_PLAYER}
          {winnerId === me.id && (
            <>
              {' '}
              <span className="ui-me-tag">ты</span>
            </>
          )}
        </p>
      </div>
      <Icon name="crown" size={20} className="home-winner__icon" />
    </div>
  );
}

function Mine({ result }: { result: ReturnType<typeof myResult> }) {
  if (!result) return <p className="m-small">В этот вечер тебя не было за столом.</p>;
  return (
    <Stats className="home-stats">
      <Stat
        label="Место"
        value={result.place === null ? '—' : String(result.place)}
        unit={`из ${result.of}`}
      />
      <Stat label="Очки" value={formatPoints(result.points)} />
      <Stat
        label="Нетто"
        value={signedNumber(result.netRub)}
        unit="₽"
        note={result.netRub > 0 ? 'в плюсе' : result.netRub < 0 ? 'в минусе' : 'при своих'}
      />
    </Stats>
  );
}

export interface OpenVotingProps {
  history: ClubHistory;
  me: Player;
  nowMs: number;
}

/** Голосование по последнему вечеру, пока оно открыто: срок и мои голоса «N из 3». */
export function OpenVoting({ history, me, nowMs }: OpenVotingProps) {
  const evening = history.evenings[0];
  const played = evening
    ? (history.summaryById.get(evening.id)?.entrants.includes(me.id) ?? false)
    : false;
  const phase = evening ? votingPhase(evening, nowMs) : 'pending';
  // До закрытия RLS отдаёт только мои голоса — ровно то, что нужно для «N из 3».
  const votes = useVotes(evening && phase === 'open' && played ? evening.id : undefined);
  if (!evening || phase !== 'open' || !evening.voting_closes_at) return null;

  const until = formatDateTime(evening.voting_closes_at, nowMs);
  if (!played) {
    return (
      <Notice tone="info" title={`Голосование открыто до ${until}`}>
        Голосуют только игравшие в этот вечер. Итоги откроются всем после закрытия.
      </Notice>
    );
  }

  const mine = votes.data ? new Set(votes.data.map((v) => v.category)).size : null;
  const text = votes.isError
    ? `Твои голоса не загрузились: ${errorMessage(votes.error)}`
    : mine === null
      ? 'Рука, блеф и бэд-бит вечера.'
      : mine >= VOTE_CATEGORIES.length
        ? 'Твои голоса отданы во всех номинациях — изменить их можно до закрытия.'
        : `Рука, блеф и бэд-бит вечера. Твоих голосов: ${mine} из ${VOTE_CATEGORIES.length}.`;

  return (
    <Notice
      tone="info"
      title={`Голосование открыто до ${until}`}
      action={
        <ButtonLink size="sm" to={paths.vote(evening.id)}>
          Голосовать
        </ButtonLink>
      }
    >
      {text}
    </Notice>
  );
}
