import { TITLE_META } from '@domain/achievements.ts';
import type { PlayerId } from '@domain/types.ts';
import { Link } from 'react-router-dom';
import type { Player } from '../../shared/api';
import { NBSP, paths, plural } from '../../shared/lib';
import { Avatar, DataTable, Icon, List, ListItem, Section } from '../../shared/ui';
import type { HeadToHeadRow } from './stats';

function times(n: number): string {
  return `${n}${NBSP}${plural(n, ['раз', 'раза', 'раз'])}`;
}

interface RivalsProps {
  playersById: ReadonlyMap<PlayerId, Player>;
  rows: readonly HeadToHeadRow[];
  /** Кто чаще всех выбивает этого игрока (titles().nemesis домена), null — звания нет. */
  nemesis: PlayerId | null;
  /** Для кого этот игрок — немезида. */
  victims: readonly PlayerId[];
  isMe: boolean;
}

/** Немезида (переходящее звание) и личные встречи: сколько выбил и сколько раз был выбит. */
export function Rivals({ playersById, rows, nemesis, victims, isMe }: RivalsProps) {
  const name = (id: PlayerId) => playersById.get(id)?.display_name ?? 'Игрок не найден';
  const nemesisRow = nemesis ? rows.find((r) => r.opponentId === nemesis) : undefined;

  return (
    <Section
      title="Соперники"
      footer="Выбил — сколько раз игрок выбивал соперника, выбит — сколько раз соперник выбивал игрока. При дележе нокаут засчитывается каждому."
    >
      {(nemesis || victims.length > 0) && (
        <List aria-label="Немезида">
          {nemesis && (
            <ListItem
              to={paths.player(nemesis)}
              before={
                <Avatar
                  name={name(nemesis)}
                  photoUrl={playersById.get(nemesis)?.photo_url}
                  size="md"
                />
              }
              title={`Немезида — ${name(nemesis)}`}
              subtitle={
                nemesisRow
                  ? `Чаще всех выбивает ${isMe ? 'вас' : 'этого игрока'}: ${times(nemesisRow.knockedOutBy)}`
                  : `Чаще всех выбивает ${isMe ? 'вас' : 'этого игрока'}`
              }
            />
          )}
          {victims.length > 0 && (
            <ListItem
              before={<Icon name="crown" size={20} className="pl-rivals__icon" />}
              title={`${isMe ? 'Вы — немезида' : 'Немезида'} для: ${victims.map(name).join(', ')}`}
              subtitle={`Звание «${TITLE_META.nemesis.title}» — ${TITLE_META.nemesis.description.toLowerCase()}`}
            />
          )}
        </List>
      )}

      <DataTable<HeadToHeadRow>
        className="pl-h2h"
        caption="Личные встречи"
        columns={[
          {
            key: 'opponentId',
            label: 'Соперник',
            render: (id: PlayerId) => (
              <Link to={paths.player(id)} className="pl-h2h__who">
                <Avatar name={name(id)} photoUrl={playersById.get(id)?.photo_url} size="sm" />
                <span className="pl-h2h__name">{name(id)}</span>
              </Link>
            ),
          },
          { key: 'knockedOut', label: 'Выбил', numeric: true },
          { key: 'knockedOutBy', label: 'Выбит', numeric: true },
          { key: 'together', label: 'Вечеров', numeric: true },
        ]}
        rows={rows.map((row) => ({ ...row, id: row.opponentId }))}
      />
    </Section>
  );
}
