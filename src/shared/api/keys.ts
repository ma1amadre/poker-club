import type { EveningStatus } from './types';

// Ключи запросов в одном месте: мутации и Realtime инвалидируют ровно то, что читают хуки.
export const queryKeys = {
  players: ['players'] as const,
  settings: ['settings'] as const,
  formats: ['formats'] as const,
  /** Префикс всех списков вечеров — инвалидируется целиком при любой правке вечера. */
  eveningsAll: ['evenings'] as const,
  evenings: (status?: EveningStatus | readonly EveningStatus[]) =>
    // sort, а не toSorted: старые Android WebView (Chrome < 110) его не знают, а Vite API не полифилит.
    ['evenings', 'list', status === undefined ? 'all' : [status].flat().sort().join(',')] as const,
  evening: (id: string) => ['evening', id] as const,
  eveningEvents: (id: string) => ['evening', id, 'events'] as const,
  rsvps: (eveningId: string) => ['evening', eveningId, 'rsvps'] as const,
  predictions: (eveningId: string) => ['evening', eveningId, 'predictions'] as const,
  votes: (eveningId: string) => ['evening', eveningId, 'votes'] as const,
  clubHistory: ['club-history'] as const,
  board: (token: string) => ['board', token] as const,
  clubBoard: (code: string) => ['club-board', code] as const,
  boardPresence: (eveningId: string) => ['evening', eveningId, 'board-presence'] as const,
  voicePresent: (voice: string, hashes: string) => ['voice-present', voice, hashes] as const,
  votePhoto: (path: string) => ['vote-photo', path] as const,
  mergePreview: (guestId: string, targetId: string, kind: 'telegram' | 'guest' = 'telegram') =>
    ['merge-preview', kind, guestId, targetId] as const,
};
