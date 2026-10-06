// Итоги голосования после закрытия: по каждой номинации победители (ничья — несколько) с числом
// голосов, подписи и фото их голосов; остальные номинанты — строкой. Админ может удалить голос.
import { VOTE_CATEGORIES, VOTE_CATEGORY_META, type VoteCategory } from '@domain/votes.ts';
import { useMemo, useState } from 'react';
import {
  errorMessage,
  removeVotePhoto,
  useDeleteVote,
  type Player,
  type VoteRow,
} from '../../shared/api';
import { pluralWithNumber } from '../../shared/lib';
import {
  Avatar,
  Badge,
  Card,
  Empty,
  IconButton,
  Section,
  useConfirm,
  useToast,
} from '../../shared/ui';
import { categoryResults, type CategoryResult, type NomineeResult } from './lib';
import { VotePhoto } from './VotePhoto';

const VOTES_FORMS = ['голос', 'голоса', 'голосов'] as const;

type PlayersById = ReadonlyMap<string, Player>;

function nameOf(playersById: PlayersById, id: string, meId: string): string {
  const name = playersById.get(id)?.display_name ?? 'Игрок без имени';
  return id === meId ? `${name} (вы)` : name;
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
  const tie = result.winners.length > 1;
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
            eveningId={eveningId}
            category={result.category}
            winner={winner}
            tie={tie}
            playersById={playersById}
            meId={meId}
            isAdmin={isAdmin}
          />
        ))
      )}
    </Section>
  );
}

function WinnerCard({
  eveningId,
  category,
  winner,
  tie,
  playersById,
  meId,
  isAdmin,
}: {
  eveningId: string;
  category: VoteCategory;
  winner: NomineeResult<VoteRow>;
  tie: boolean;
  playersById: PlayersById;
  meId: string;
  isAdmin: boolean;
}) {
  const player = playersById.get(winner.nomineeId);
  const name = nameOf(playersById, winner.nomineeId, meId);
  const notes = winner.votes.filter((v) => v.caption || v.photo_path);

  return (
    <Card>
      <div className="vote-winner">
        <Avatar name={player?.display_name ?? '?'} photoUrl={player?.photo_url} size="lg" />
        <div className="vote-winner__text">
          <p className="m-h3">{name}</p>
          <p className="m-small m-mono">{pluralWithNumber(winner.count, VOTES_FORMS)}</p>
        </div>
        <Badge tone={tie ? 'neutral' : 'positive'}>{tie ? 'Ничья' : 'Победитель'}</Badge>
      </div>
      {notes.map((vote) => (
        <VoteNote
          key={vote.voter_id}
          eveningId={eveningId}
          category={category}
          vote={vote}
          nomineeName={player?.display_name ?? name}
          voterName={nameOf(playersById, vote.voter_id, meId)}
          isAdmin={isAdmin}
        />
      ))}
    </Card>
  );
}

function VoteNote({
  eveningId,
  category,
  vote,
  nomineeName,
  voterName,
  isAdmin,
}: {
  eveningId: string;
  category: VoteCategory;
  vote: VoteRow;
  nomineeName: string;
  voterName: string;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  const remove = useDeleteVote(eveningId);
  const [busy, setBusy] = useState(false);

  // Модерация: админ удаляет голос (подпись, фото) — итог номинации пересчитается.
  const moderate = async () => {
    const ok = await confirm({
      title: `Удалить голос в номинации «${VOTE_CATEGORY_META[category].title}»?`,
      message: `Автор — ${voterName}. Голос, подпись и фото удалятся без возврата, итог номинации пересчитается.`,
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
    toast.success('Голос удалён');
  };

  return (
    <figure className="vote-note">
      {vote.photo_path && (
        <VotePhoto path={vote.photo_path} alt={`Фото к голосу: ${nomineeName}`} />
      )}
      {vote.caption && <p className="m-body vote-note__caption">{vote.caption}</p>}
      <figcaption className="vote-note__meta">
        <span className="m-small">— {voterName}</span>
        {isAdmin && (
          <IconButton
            label="Удалить голос"
            icon="trash"
            size="sm"
            disabled={busy}
            onClick={() => void moderate()}
          />
        )}
      </figcaption>
      {confirmElement}
    </figure>
  );
}
