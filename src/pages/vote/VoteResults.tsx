// Итоги голосования после закрытия: по каждой номинации победители (ничья — несколько) с числом
// голосов и пометкой «Звезда вечера» (или почему её нет — winnerBadge), подписи и фото их голосов;
// остальные номинанты — строкой. Админ может удалить любой
// голос (концепция: «админ может удалить») — ему под номинацией полный список «кто → за кого».
import { VOTE_CATEGORIES, VOTE_CATEGORY_META, type VoteCategory } from '@domain/votes.ts';
import { useMemo, useState, type ReactNode } from 'react';
import {
  errorMessage,
  removeVotePhoto,
  useDeleteVote,
  type Player,
  type VoteRow,
} from '../../shared/api';
import { capitalize, keepNumbersTogether, pluralWithNumber } from '../../shared/lib';
import {
  Avatar,
  Badge,
  Card,
  Empty,
  IconButton,
  List,
  ListItem,
  Section,
  useConfirm,
  useToast,
} from '../../shared/ui';
import {
  categoryResults,
  winnerBadge,
  type CategoryResult,
  type NomineeResult,
  type WinnerBadge,
} from './lib';
import { VotePhoto } from './VotePhoto';

const VOTES_FORMS = ['голос', 'голоса', 'голосов'] as const;

type PlayersById = ReadonlyMap<string, Player>;

/** Имя для текста (подпись, сообщение, перечень через запятую): своё — «Саша (ты)». */
function nameOf(playersById: PlayersById, id: string, meId: string): string {
  const name = playersById.get(id)?.display_name ?? 'Игрок без имени';
  return id === meId ? `${name} (ты)` : name;
}

/** Имя в заголовке и строке списка: своё — с меткой «[ ТЫ ]» (ui-me-tag), как в таблицах. */
function nameNode(playersById: PlayersById, id: string, meId: string): ReactNode {
  return (
    <>
      {playersById.get(id)?.display_name ?? 'Игрок без имени'}
      {id === meId && (
        <>
          {' '}
          <span className="ui-me-tag">ты</span>
        </>
      )}
    </>
  );
}

export interface VoteResultsProps {
  eveningId: string;
  votes: readonly VoteRow[];
  playersById: PlayersById;
  meId: string;
  isAdmin: boolean;
}

export function VoteResults({ eveningId, votes, playersById, meId, isAdmin }: VoteResultsProps) {
  const results = useMemo(() => categoryResults(votes), [votes]);

  if (votes.length === 0) {
    return (
      <Empty
        icon="inbox"
        title="Голосов не было"
        description="За сутки после игры никто не проголосовал — звёзд вечера нет."
      />
    );
  }

  return (
    <>
      {VOTE_CATEGORIES.map((category) => (
        <CategoryBlock
          key={category}
          eveningId={eveningId}
          result={results[category]}
          playersById={playersById}
          meId={meId}
          isAdmin={isAdmin}
        />
      ))}
    </>
  );
}

function CategoryBlock({
  eveningId,
  result,
  playersById,
  meId,
  isAdmin,
}: {
  eveningId: string;
  result: CategoryResult<VoteRow>;
  playersById: PlayersById;
  meId: string;
  isAdmin: boolean;
}) {
  const title = VOTE_CATEGORY_META[result.category].title;
  const others = result.others
    .map((o) => `${nameOf(playersById, o.nomineeId, meId)} — ${o.count}`)
    .join(', ');

  return (
    <Section
      title={title}
      aside={
        result.total > 0 ? (
          <span className="m-mono">{pluralWithNumber(result.total, VOTES_FORMS)}</span>
        ) : undefined
      }
      footer={others ? `Ещё голоса: ${others}.` : undefined}
    >
      {result.winners.length === 0 ? (
        <p className="m-small">В этой номинации голосов нет.</p>
      ) : (
        result.winners.map((winner) => (
          <WinnerCard
            key={winner.nomineeId}
            winner={winner}
            badge={winnerBadge(
              result,
              winner.nomineeId,
              playersById.get(winner.nomineeId)?.is_guest ?? false,
            )}
            playersById={playersById}
            meId={meId}
          />
        ))
      )}
      {isAdmin && result.total > 0 && (
        <AdminVotes
          eveningId={eveningId}
          category={result.category}
          votes={[...result.winners, ...result.others].flatMap((n) => n.votes)}
          playersById={playersById}
          meId={meId}
        />
      )}
    </Section>
  );
}

/** Удаление голоса админом: подтверждение, delete_vote, затем фото из бакета. */
function useModerateVote(eveningId: string, category: VoteCategory) {
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  const remove = useDeleteVote(eveningId);
  const [busy, setBusy] = useState(false);

  const moderate = async (vote: VoteRow, voterName: string) => {
    const ok = await confirm({
      title: `Удалить голос в номинации «${VOTE_CATEGORY_META[category].title}»?`,
      message: `Автор — ${voterName}. Голос${vote.caption || vote.photo_path ? ', подпись и фото' : ''} удалятся без возврата, итог номинации пересчитается.`,
      confirmText: 'Удалить голос',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await remove.mutateAsync({ voterId: vote.voter_id, category });
    } catch (error) {
      setBusy(false);
      toast.show('Голос не удалён', { tone: 'critical', detail: errorMessage(error) });
      return;
    }
    if (vote.photo_path) await removeVotePhoto(vote.photo_path).catch(() => undefined);
    setBusy(false);
    toast.success('Голос удалён');
  };

  return { moderate, busy, confirmElement };
}

/** Админу: все голоса номинации, включая голоса без подписи и за проигравших номинантов. */
function AdminVotes({
  eveningId,
  category,
  votes,
  playersById,
  meId,
}: {
  eveningId: string;
  category: VoteCategory;
  votes: readonly VoteRow[];
  playersById: PlayersById;
  meId: string;
}) {
  const { moderate, busy, confirmElement } = useModerateVote(eveningId, category);
  return (
    <>
      <List aria-label={`Все голоса: ${VOTE_CATEGORY_META[category].title}`}>
        {votes.map((vote) => {
          const voter = nameOf(playersById, vote.voter_id, meId);
          return (
            <ListItem
              key={vote.voter_id}
              title={
                <>
                  {nameNode(playersById, vote.voter_id, meId)} →{' '}
                  {nameNode(playersById, vote.nominee_id, meId)}
                </>
              }
              subtitle={
                [vote.caption ? 'с подписью' : null, vote.photo_path ? 'с фото' : null]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              after={
                <IconButton
                  label={`Удалить голос: ${voter}`}
                  icon="trash"
                  size="sm"
                  disabled={busy}
                  onClick={() => void moderate(vote, voter)}
                />
              }
            />
          );
        })}
      </List>
      {confirmElement}
    </>
  );
}

function WinnerCard({
  winner,
  badge,
  playersById,
  meId,
}: {
  winner: NomineeResult<VoteRow>;
  badge: WinnerBadge;
  playersById: PlayersById;
  meId: string;
}) {
  const player = playersById.get(winner.nomineeId);
  const name = nameOf(playersById, winner.nomineeId, meId);
  const notes = winner.votes.filter((v) => v.caption || v.photo_path);

  return (
    <Card>
      <div className="vote-winner">
        <Avatar name={player?.display_name ?? '?'} photoUrl={player?.photo_url} size="lg" />
        <div className="vote-winner__text">
          <p className="m-h3 ui-name">{nameNode(playersById, winner.nomineeId, meId)}</p>
          <p className="m-small m-mono">{pluralWithNumber(winner.count, VOTES_FORMS)}</p>
          {badge.note && (
            <p className="m-small vote-winner__note">
              {keepNumbersTogether(capitalize(badge.note))}
            </p>
          )}
        </div>
        <Badge tone={badge.star ? 'positive' : 'neutral'}>{badge.label}</Badge>
      </div>
      {notes.map((vote) => (
        <VoteNote
          key={vote.voter_id}
          vote={vote}
          nomineeName={player?.display_name ?? name}
          voterName={nameOf(playersById, vote.voter_id, meId)}
        />
      ))}
    </Card>
  );
}

function VoteNote({
  vote,
  nomineeName,
  voterName,
}: {
  vote: VoteRow;
  nomineeName: string;
  voterName: string;
}) {
  return (
    <figure className="vote-note">
      {vote.photo_path && (
        <VotePhoto path={vote.photo_path} alt={`Фото к голосу: ${nomineeName}`} />
      )}
      {vote.caption && <p className="m-body vote-note__caption">{vote.caption}</p>}
      <figcaption className="vote-note__meta">
        <span className="m-small">— {voterName}</span>
      </figcaption>
    </figure>
  );
}
