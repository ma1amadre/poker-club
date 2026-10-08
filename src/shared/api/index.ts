// Слой данных: TanStack Query поверх supabase-js. Страницы импортируют только отсюда.
export * from './types';
export { queryKeys } from './keys';
export { errorMessage, toError } from './errors';
export * from './queries';
export { fetchClubHistory, useClubHistory, type ClubHistory } from './history';
export { clubFeedInput, momentsNowMs } from './historyFeed';
export * from './rpc';
export * from './admin';
export * from './photos';
export * from './board';
export { pingServer, syncServerClock, useServerClockSync } from './serverClock';
export { useRealtimeStatus, type RealtimeStatus } from './realtime';
