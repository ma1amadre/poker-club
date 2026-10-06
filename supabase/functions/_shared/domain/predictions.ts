// Прогнозы: угадал победителя — 3 очка, угадал первого вылетевшего — 2.
import type { PlayerId } from './types.ts';

export const PREDICTION_POINTS = { winner: 3, firstOut: 2 } as const;

export interface Prediction {
  winnerId: PlayerId | null;
  firstOutId: PlayerId | null;
}

export interface PredictionScore {
  winner: 0 | 3;
  firstOut: 0 | 2;
  total: number;
}

/** Оценённый прогноз конкретного игрока на конкретный вечер — вход для oracleStandings и ачивки oracle. */
export interface ScoredPrediction extends PredictionScore {
  eveningId: string;
  playerId: PlayerId;
}

/**
 * Итог вечера, нужный для оценки. Подходит и EveningState, и EveningSummary.
 * Победитель известен только после finish (places пуст до этого), первый вылет — сразу после
 * первого bust: это первый вылет вечера, даже если игрок потом сделал ребай.
 */
export interface PredictionOutcome {
  places: readonly PlayerId[];
  firstBustPlayerId: PlayerId | null;
}

export function scorePrediction(prediction: Prediction, outcome: PredictionOutcome): PredictionScore {
  const winnerId = outcome.places[0];
  const winner: 0 | 3 =
    winnerId !== undefined && prediction.winnerId === winnerId ? PREDICTION_POINTS.winner : 0;
  const firstOut: 0 | 2 =
    outcome.firstBustPlayerId !== null && prediction.firstOutId === outcome.firstBustPlayerId
      ? PREDICTION_POINTS.firstOut
      : 0;
  return { winner, firstOut, total: winner + firstOut };
}
