// Блок «Прогноз» до старта вечера: мой прогноз на победителя и первый вылет, кнопка шторки.
// Один и тот же блок на экране вечера (туда ведут кнопки анонса и поста в день игры — рядом с
// ответом «иду») и на главной (карточка анонса). Чужие прогнозы RLS отдаёт только после старта.
import { PREDICTION_POINTS } from '@domain/predictions.ts';
import { useState } from 'react';
import {
  errorMessage,
  usePredictions,
  type Evening,
  type Player,
  type Rsvp,
} from '../../shared/api';
import { plural } from '../../shared/lib';
import {
  Avatar,
  Button,
  Icon,
  List,
  ListItem,
  Notice,
  Section,
  Skeleton,
  type IconName,
} from '../../shared/ui';
import { PredictionSheet } from './PredictionSheet';
import './prediction.css';

type PlayersById = ReadonlyMap<string, Player>;

/** Слот 40 px слева в строке прогноза: аватар выбранного или иконка без подложки. */
function PickSlot({ player, icon }: { player: Player | null; icon: IconName }) {
  return (
    <span className="ev-pick-slot">
      {player ? (
        <Avatar name={player.display_name} photoUrl={player.photo_url} size="lg" />
      ) : (
        <Icon name={icon} size={20} />
      )}
    </span>
  );
}

function pointsLabel(points: number): string {
  return `${points} ${plural(points, ['очко', 'очка', 'очков'])}`;
}

export interface PredictionSectionProps {
  evening: Evening;
  me: Player;
  /** Все игроки клуба: кандидаты в прогноз (predictionCandidates). */
  players: readonly Player[];
  playersById: PlayersById;
  rsvps: readonly Rsvp[];
}

export function PredictionSection({
  evening,
  me,
  players,
  playersById,
  rsvps,
}: PredictionSectionProps) {
  const predictions = usePredictions(evening.id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mine = predictions.data?.find((p) => p.player_id === me.id) ?? null;
  const winner = mine?.winner_id ? (playersById.get(mine.winner_id) ?? null) : null;
  const firstOut = mine?.first_out_id ? (playersById.get(mine.first_out_id) ?? null) : null;
  const open = () => setSheetOpen(true);

  return (
    <Section
      title="Прогноз"
      footer="Чужие прогнозы откроются со стартом таймера — тогда же приём прогнозов закроется."
    >
      {predictions.isPending ? (
        <Skeleton height={112} />
      ) : predictions.isError ? (
        <Notice
          tone="critical"
          title="Прогноз не загрузился"
          action={
            <Button size="sm" onClick={() => void predictions.refetch()}>
              Повторить
            </Button>
          }
        >
          {errorMessage(predictions.error)}
        </Notice>
      ) : (
        <>
          <List aria-label="Мой прогноз">
            <ListItem
              before={<PickSlot player={winner} icon="trophy" />}
              title="Кто выиграет"
              subtitle={winner?.display_name ?? 'Не выбран'}
              after={<span className="m-mono">{pointsLabel(PREDICTION_POINTS.winner)}</span>}
              onClick={open}
              chevron
            />
            <ListItem
              before={<PickSlot player={firstOut} icon="flag" />}
              title="Кто вылетит первым"
              subtitle={firstOut?.display_name ?? 'Не выбран'}
              after={<span className="m-mono">{pointsLabel(PREDICTION_POINTS.firstOut)}</span>}
              onClick={open}
              chevron
            />
          </List>
          <Button variant={mine ? 'secondary' : 'primary'} block onClick={open}>
            {mine ? 'Изменить прогноз' : 'Сделать прогноз'}
          </Button>
        </>
      )}
      {sheetOpen && (
        <PredictionSheet
          evening={evening}
          players={players}
          rsvps={rsvps}
          current={mine}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </Section>
  );
}
