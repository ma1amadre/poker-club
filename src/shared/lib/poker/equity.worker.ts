// Web Worker шансов олл-ина: Монте-Карло до флопа (сотни тысяч оценок рук) считается вне главного
// потока — таймер табло на слабом ТВ-браузере не замирает. Протокол — EquityRequest/EquityResponse.
import { computeEquity, parseShowdownKey, type EquityResult } from './equity';

export interface EquityRequest {
  key: string;
}

export type EquityResponse = { key: string; result: EquityResult } | { key: string; error: string };

self.onmessage = (event: MessageEvent<EquityRequest>) => {
  const { key } = event.data;
  let response: EquityResponse;
  try {
    const { hands, board } = parseShowdownKey(key);
    response = { key, result: computeEquity(hands, board) };
  } catch (err) {
    response = { key, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
