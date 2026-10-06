import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { env } from './env';

// Сессия живёт только в памяти вкладки: origin ma1amadre.github.io общий с mrgn-board, и всё,
// что лежит в localStorage, видно чужому приложению. Вход заново по initData при каждом открытии.
// auth-js при persistSession:false и сам берёт память (проверено в 2.117.2), своё хранилище —
// страховка на случай смены поведения библиотеки: localStorage не трогаем ни при каких условиях.
const memory = new Map<string, string>();
const memoryStorage: SupportedStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
};

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: memoryStorage,
    storageKey: 'poker-club-auth',
  },
});

export type SupabaseClient = typeof supabase;
