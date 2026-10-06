// Голосование вечера: рука / блеф / бэд-бит. Пока открыто — мои голоса по номинациям (шторка
// с формой), обратный отсчёт; после закрытия — итоги voteResults с подписями и фото.
import { VOTE_CATEGORIES, VOTE_CATEGORY_META, type VoteCategory } from '@domain/votes.ts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  queryKeys,
  useEvening,
  useEveningEvents,
  usePlayers,
  useVotes,
  type Evening,
  type Player,
  type VoteRow,
} from '../../shared/api';
import { useAuth, useCurrentPlayer } from '../../shared/auth';
import {
  formatDate,
  formatDateTime,
  participantIds,
  paths,
  useNow,
  votingPhase,
} from '../../shared/lib';
import {
  Avatar,
  ButtonLink,
  Empty,
  ErrorView,
  Icon,
  List,
  ListItem,
  Notice,
  Page,
  PageSkeleton,
  Section,
  type IconName,
} from '../../shared/ui';
import { formatCountdown } from './lib';
import { VoteResults } from './VoteResults';
import { VoteSheet } from './VoteSheet';
import './vote.css';

const CATEGORY_ICON: Record<VoteCategory, IconName> = {
  hand: 'star',
  bluff: 'eye',
  badbeat: 'zap',
};

export default function VotePage() {
  const { id } = useParams<{ id: string }>();
  const me = useCurrentPlayer();
  const { isAdmin } = useAuth();
  const evening = useEvening(id);
  const events = useEveningEvents(id);
  const votes = useVotes(id);
  const players = usePlayers();
  const queryClient = useQueryClient();
  const now = useNow(1000);

  const phase = evening.data ? votingPhase(evening.data, now) : null;

  // В момент закрытия RLS открывает чужие голоса — перечитываем их, не дожидаясь перезахода.
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (previousPhase.current === 'open' && phase === 'closed' && id) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.votes(id) });
    }
    previousPhase.current = phase;
  }, [phase, id, queryClient]);

  const playersById = useMemo(
    () => new Map<string, Player>((players.data ?? []).map((p) => [p.id, p])),
    [players.data],
  );
  const back = { fallback: id ? paths.evening(id) : paths.home };

  // Без id запросы выключены и навсегда остались бы pending — сразу «не найден».
  if (id && (evening.isPending || events.isPending || votes.isPending || players.isPending)) {
    return <PageSkeleton label="Загрузка голосования" />;
  }

  const failed = id ? [evening, events, votes, players].find((q) => q.isError) : undefined;
  if (failed) {
    return (
      <Page title="Голосование" back={back}>
        <ErrorView
          error={failed.error}
          title="Голосование не загрузилось"
          onRetry={() => {
            void evening.refetch();
            void events.refetch();
            void votes.refetch();
            void players.refetch();
          }}
        />
      </Page>
    );
  }

  if (!evening.data || !id) {
    return (
      <Page title="Голосование" back={back}>
        <Empty
          kind="no-results"
          title="Вечер не найден"
          description="Ссылка устарела или вечер удалён. Последние вечера — на главной."
          action={<ButtonLink to={paths.home}>Открыть главную</ButtonLink>}
        />
      </Page>
    );
  }

  const ev = evening.data;
  const participants = participantIds(events.data ?? [])
    .map((pid) => playersById.get(pid))
    .filter((p): p is Player => Boolean(p));
  const played = participants.some((p) => p.id === me.id);
  const closesAt = ev.voting_closes_at;

  return (
    <Page
      back={back}
      eyebrow={`Вечер · ${formatDate(ev.scheduled_at, now)}`}
      title="Голосование"
      subtitle={
        phase === 'closed' && closesAt ? `Закрыто ${formatDateTime(closesAt, now)}` : undefined
      }
    >
      {phase === 'pending' && <NotYet evening={ev} />}
      {phase === 'open' && closesAt && (
        <>
          <Countdown closesAt={closesAt} now={now} />
          {played ? (
            <MyVotes
              eveningId={ev.id}
              me={me}
              participants={participants}
              votes={votes.data ?? []}
              playersById={playersById}
            />
          ) : (
            <Notice tone="info" title="Голосуют только игравшие">
              {`Вы не играли в этот вечер. Итоги откроются всем ${formatDateTime(closesAt, now)}.`}
            </Notice>
          )}
        </>
      )}
      {phase === 'closed' && (
        <VoteResults
          eveningId={ev.id}
          votes={votes.data ?? []}
          playersById={playersById}
          meId={me.id}
          isAdmin={isAdmin}
        />
      )}
    </Page>
  );
}

function NotYet({ evening }: { evening: Evening }) {
  if (evening.status === 'cancelled') {
    return (
      <Empty
        icon="x"
        title="Вечер отменён"
        description="Игры не было, поэтому и голосования не будет."
        action={<ButtonLink to={paths.home}>Открыть главную</ButtonLink>}
      />
    );
  }
  return (
    <Empty
      icon="clock"
      title="Голосование откроется после финала"
      description="Рука, блеф и бэд-бит вечера. Голосуют игравшие — 24 часа после окончания игры."
      action={<ButtonLink to={paths.evening(evening.id)}>Открыть вечер</ButtonLink>}
    />
  );
}

function Countdown({ closesAt, now }: { closesAt: string; now: number }) {
  const left = Date.parse(closesAt) - now;
  return (
    <section className="vote-countdown" aria-label="До закрытия голосования">
      <p className="m-eyebrow">До закрытия</p>
      {/* Секунды тикают — для скринридера это шум, поэтому без aria-live. */}
      <p className="m-h2 m-mono vote-countdown__value">{formatCountdown(left)}</p>
      <p className="m-small">
        {`Голосование закроется ${formatDateTime(closesAt, now)}, после этого итоги откроются всем.`}
      </p>
    </section>
  );
}

function MyVotes({
  eveningId,
  me,
  participants,
  votes,
  playersById,
}: {
  eveningId: string;
  me: Player;
  participants: readonly Player[];
  votes: readonly VoteRow[];
  playersById: ReadonlyMap<string, Player>;
}) {
  const [editing, setEditing] = useState<VoteCategory | null>(null);
  // До закрытия RLS отдаёт только мои голоса, но фильтруем явно — на случай админа и кеша.
  const mine = useMemo(
    () => new Map(votes.filter((v) => v.voter_id === me.id).map((v) => [v.category, v])),
    [votes, me.id],
  );
  const done = mine.size;

  return (
    <Section
      title="Ваши голоса"
      aside={
        <span className="m-mono">
          {done} из {VOTE_CATEGORIES.length}
        </span>
      }
      footer="Голосовать за себя нельзя. Голос можно изменить или отозвать до закрытия."
    >
      <List className="vote-list" aria-label="Номинации">
        {VOTE_CATEGORIES.map((category) => {
          const vote = mine.get(category) ?? null;
          const nominee = vote ? playersById.get(vote.nominee_id) : undefined;
          const nomineeName = nominee?.display_name ?? 'Игрок без имени';
          return (
            <ListItem
              key={category}
              before={
                vote ? (
                  <Avatar name={nomineeName} photoUrl={nominee?.photo_url} size="lg" />
                ) : (
                  <span className="vote-slot">
                    <Icon name={CATEGORY_ICON[category]} size={20} />
                  </span>
                )
              }
              title={VOTE_CATEGORY_META[category].title}
              subtitle={
                vote
                  ? [nomineeName, vote.caption, vote.photo_path ? 'с фото' : null]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Голос не отдан'
              }
              after={
                vote ? (
                  <span className="vote-done">
                    <Icon name="check-circle" size={20} label="Голос отдан" />
                  </span>
                ) : undefined
              }
              onClick={() => setEditing(category)}
              chevron
            />
          );
        })}
      </List>
      {editing && (
        <VoteSheet
          key={editing}
          eveningId={eveningId}
          category={editing}
          me={me}
          participants={participants}
          current={mine.get(editing) ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}
