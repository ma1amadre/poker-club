import { eveningAllIns, type AllIn } from '@domain/allins.ts';
import { VOTE_CATEGORY_META } from '@domain/votes.ts';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVotePhotoUrl, type ClubHistory, type Evening, type Player } from '../../shared/api';
import {
  capitalize,
  formatDate,
  formatDateTime,
  formatWeekdayDate,
  paths,
  pluralWithNumber,
} from '../../shared/lib';
import {
  AllInList,
  Avatar,
  Button,
  ButtonLink,
  Empty,
  Icon,
  List,
  Notice,
  Section,
  Skeleton,
} from '../../shared/ui';
import { groupMoments, momentEvenings, type DatedMoment } from './moments';

const VOTES_FORMS = ['голос', 'голоса', 'голосов'] as const;

export interface MomentsTabProps {
  history: ClubHistory;
  /** Моменты домена (clubMoments), новые сверху. */
  moments: readonly DatedMoment[];
  /** Вечера, где голосование ещё идёт (openVotings). */
  open: readonly Evening[];
  playersById: ReadonlyMap<string, Player>;
}

/**
 * «Моменты»: победители номинаций всех вечеров с закрытым голосованием и «Олл-ины вечера» —
 * записанные раздачи с долями по улицам. Новые вечера сверху. Строка момента ведёт на голосование
 * вечера — там все голоса и фото целиком; олл-ины раскрываются по кнопке (шансы считаются только
 * у раскрытых — иначе вкладка пересчитывала бы раздачи всей истории клуба).
 */
export function MomentsTab({ history, moments, open, playersById }: MomentsTabProps) {
  const nameOf = (id: string) => playersById.get(id)?.display_name ?? 'Игрок не найден';
  const allInsByEvening = useMemo(() => {
    const out = new Map<string, AllIn[]>();
    for (const e of history.evenings) {
      const list = eveningAllIns(e.format, history.eventsByEvening.get(e.id) ?? []);
      if (list.length > 0) out.set(e.id, list);
    }
    return out;
  }, [history.evenings, history.eventsByEvening]);
  const groups = momentEvenings(
    groupMoments(moments, (id) => history.summaryById.get(id)?.date),
    history.evenings,
    allInsByEvening,
  );

  return (
    <div className="hs-panel">
      {open.map((evening) => (
        <Notice
          key={evening.id}
          title={`Идёт голосование за вечер ${formatDate(evening.scheduled_at)}`}
          action={
            <ButtonLink to={paths.vote(evening.id)} size="sm">
              Открыть голосование
            </ButtonLink>
          }
        >
          {evening.voting_closes_at
            ? `Итоги откроются ${formatDateTime(evening.voting_closes_at)} — тогда моменты вечера появятся здесь.`
            : 'Моменты вечера появятся здесь, когда голосование закроется.'}
        </Notice>
      ))}

      {groups.length === 0 ? (
        <Empty
          icon="inbox"
          title="Моментов пока нет"
          description="После каждого вечера сутки идёт голосование: рука, блеф и бэд-бит вечера. Победители номинаций с фото и подписями собираются здесь, рядом — олл-ины вечера, которые банкир отметил на пульте."
        />
      ) : (
        groups.map((group) => {
          const title = group.date ? capitalize(formatWeekdayDate(group.date)) : 'Вечер';
          return (
            <Section key={group.eveningId} title={title}>
              {group.moments.length > 0 && (
                <List aria-label={`Моменты вечера: ${title}`}>
                  {group.moments.map((m) => (
                    <MomentRow
                      key={`${m.category}:${m.nomineeId}`}
                      moment={m}
                      nominee={playersById.get(m.nomineeId)}
                      nameOf={nameOf}
                    />
                  ))}
                </List>
              )}
              {group.allIns.length > 0 && <EveningAllIns allIns={group.allIns} nameOf={nameOf} />}
            </Section>
          );
        })
      )}
    </div>
  );
}

/** Олл-ины вечера под кнопкой: раскрыть — посчитать шансы и показать раздачи. */
function EveningAllIns({
  allIns,
  nameOf,
}: {
  allIns: readonly AllIn[];
  nameOf: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hs-allins">
      <Button
        variant="ghost"
        size="sm"
        icon={open ? 'chevron-up' : 'chevron-down'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? 'Свернуть олл-ины'
          : `Олл-ины вечера: ${pluralWithNumber(allIns.length, ['раздача', 'раздачи', 'раздач'])}`}
      </Button>
      {open && <AllInList allIns={allIns} nameOf={nameOf} />}
    </div>
  );
}

function MomentRow({
  moment,
  nominee,
  nameOf,
}: {
  moment: DatedMoment;
  nominee: Player | undefined;
  nameOf: (id: string) => string;
}) {
  const category = VOTE_CATEGORY_META[moment.category].title;
  const name = nameOf(moment.nomineeId);
  const meta = [pluralWithNumber(moment.votes, VOTES_FORMS)];
  if (moment.tie) meta.push('ничья');
  if (moment.noteBy) {
    const what =
      moment.caption && moment.photoPath ? 'подпись и фото' : moment.caption ? 'подпись' : 'фото';
    meta.push(`${what} — ${nameOf(moment.noteBy)}`);
  }

  return (
    <li className="ui-list-row">
      <Link
        to={paths.vote(moment.eveningId)}
        className="ui-list-item ui-list-item--interactive hs-moment"
      >
        <span className="hs-moment__avatar">
          <Avatar name={nominee?.display_name ?? '?'} photoUrl={nominee?.photo_url} size="lg" />
        </span>
        <span className="hs-moment__body">
          <span className="hs-moment__category">{category}</span>
          <span className="hs-moment__name">{name}</span>
          {moment.caption && <span className="hs-moment__caption">«{moment.caption}»</span>}
          <span className="hs-moment__meta">{meta.join(' · ')}</span>
        </span>
        <Icon name="chevron-right" size={20} className="ui-list-item__chevron hs-moment__chevron" />
        {moment.photoPath && (
          <div className="hs-moment__photo">
            <MomentPhoto path={moment.photoPath} alt={`Фото к номинации «${category}»: ${name}`} />
          </div>
        )}
      </Link>
    </li>
  );
}

/** Фото лучшего голоса: временная ссылка из приватного бакета, кадр занят до загрузки. */
function MomentPhoto({ path, alt }: { path: string; alt: string }) {
  const url = useVotePhotoUrl(path);
  const [broken, setBroken] = useState<string | null>(null);

  // Заглушка — той же геометрии, что кадр (4:3, не выше 320 px): после загрузки строка не растёт.
  if (url.isPending) return <Skeleton className="hs-moment__frame" />;
  if (url.isError || !url.data || broken === url.data) {
    return (
      <span className="m-small hs-moment__missing">
        <Icon name="alert-circle" size={16} />
        Фото не загрузилось — возможно, его удалили.
      </span>
    );
  }
  return (
    <img
      className="hs-moment__img"
      src={url.data}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(url.data)}
    />
  );
}
