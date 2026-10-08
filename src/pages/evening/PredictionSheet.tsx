// Шторка прогноза: «Кто выиграет» (3 очка) и «Кто вылетит первым» (2 очка). Кандидаты — все
// активные игроки, гости после постоянных, без болельщиков на этот вечер (predictionCandidates).
// Сохраняет set_prediction. Открывается из блока прогноза (PredictionSection) на экране вечера и на
// главной.
import { PREDICTION_POINTS } from '@domain/predictions.ts';
import { seatedIds } from '@domain/spectators.ts';
import { useMemo, useState } from 'react';
import {
  useEveningEvents,
  useSetPrediction,
  type Evening,
  type Player,
  type PredictionRow,
  type Rsvp,
} from '../../shared/api';
import { capitalize, formatWeekdayDate } from '../../shared/lib';
import { Button, PlayerPicker, Sheet, useToast } from '../../shared/ui';
import { candidateHint, ORACLE_NOTE, predictionCandidates } from './predictions';

export interface PredictionSheetProps {
  evening: Evening;
  players: readonly Player[];
  rsvps: readonly Rsvp[];
  /** Сохранённый прогноз; null — ещё не делал. */
  current: PredictionRow | null;
  onClose: () => void;
}

export function PredictionSheet({
  evening,
  players,
  rsvps,
  current,
  onClose,
}: PredictionSheetProps) {
  const toast = useToast();
  const save = useSetPrediction(evening.id);
  const [winner, setWinner] = useState<string | null>(current?.winner_id ?? null);
  const [firstOut, setFirstOut] = useState<string | null>(current?.first_out_id ?? null);

  // Посаженный до старта болельщик — кандидат (журнал — тот же запрос, что у экрана).
  const events = useEveningEvents(evening.id).data;
  const candidates = useMemo(
    () =>
      predictionCandidates(
        players,
        rsvps,
        [current?.winner_id, current?.first_out_id],
        seatedIds(events ?? []),
      ),
    [players, rsvps, current, events],
  );
  const pickerPlayers = candidates.map((c) => c.player);
  const hints = Object.fromEntries(candidates.map((c) => [c.player.id, candidateHint(c)]));

  const changed =
    winner !== (current?.winner_id ?? null) || firstOut !== (current?.first_out_id ?? null);

  // Один игрок не может и выиграть, и вылететь первым: выбор в одном поле снимает его в другом.
  const pickWinner = (id: string | null) => {
    setWinner(id);
    if (id && id === firstOut) setFirstOut(null);
  };
  const pickFirstOut = (id: string | null) => {
    setFirstOut(id);
    if (id && id === winner) setWinner(null);
  };

  const submit = (next: { winnerId: string | null; firstOutId: string | null }) => {
    save.mutate(next, {
      onSuccess: () => {
        toast.success(next.winnerId || next.firstOutId ? 'Прогноз сохранён' : 'Прогноз снят');
        onClose();
      },
      onError: (error) => toast.error(error),
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title="Прогноз на вечер"
      description={`${capitalize(formatWeekdayDate(evening.scheduled_at))}. Угаданный победитель — ${PREDICTION_POINTS.winner} очка, первый вылет — ${PREDICTION_POINTS.firstOut}. Менять можно до старта таймера.`}
      actions={
        <>
          <Button
            variant="primary"
            block
            loading={save.isPending}
            disabled={!changed}
            onClick={() => submit({ winnerId: winner, firstOutId: firstOut })}
          >
            Сохранить прогноз
          </Button>
          {current && (
            <Button
              variant="ghost"
              block
              disabled={save.isPending}
              onClick={() => submit({ winnerId: null, firstOutId: null })}
            >
              Снять прогноз
            </Button>
          )}
        </>
      }
    >
      <p className="m-small">{ORACLE_NOTE}</p>
      {pickerPlayers.length === 0 ? (
        <p className="m-small">Выбрать пока некого: в клубе нет активных игроков.</p>
      ) : (
        <>
          <PlayerPicker
            label={`Кто выиграет · ${PREDICTION_POINTS.winner} очка`}
            players={pickerPlayers}
            value={winner ? [winner] : []}
            onChange={(ids) => pickWinner(ids[0] ?? null)}
            hints={hints}
          />
          <PlayerPicker
            label={`Кто вылетит первым · ${PREDICTION_POINTS.firstOut} очка`}
            players={pickerPlayers}
            value={firstOut ? [firstOut] : []}
            onChange={(ids) => pickFirstOut(ids[0] ?? null)}
            hints={hints}
          />
        </>
      )}
    </Sheet>
  );
}
