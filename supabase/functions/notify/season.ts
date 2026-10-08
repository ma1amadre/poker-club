// Пост «Итоги сезона» (cron-tick): один раз на сезон — отметка public.season_posts (миграция 025).
// Защита от дублей — тот же приём, что у постов вечеров (claimPost/publishOnce): застолбить сезон
// строкой season_posts, отправить, при ошибке Telegram снять строку — следующий тик попробует снова.
// Одновременные тики не напишут дважды: строку вставит только один (on conflict do nothing).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'; // версия — как в _shared/admin.ts
import { seasonEndMs, seasonKey, seasonRecap, seasonStartMs } from '../_shared/domain/index.ts';
import { describeError } from '../_shared/admin.ts';
import { seasonResultsPost } from '../_shared/messages.ts';
import { sendMessage } from '../_shared/telegram.ts';
import {
  loadHistory,
  loadPlayerNames,
  loadPostedSeasons,
  scoredPredictions,
  scoringConfig,
  starAwards,
  type PostOutcome,
  type SettingsRow,
} from './results.ts';

type Db = SupabaseClient;

/**
 * Итог шага: posted / already_posted; wait_live — вечер этого сезона ещё идёт (итоги поменяются);
 * no_evenings — в сезоне не было завершённых вечеров, подводить нечего.
 */
export type SeasonPostOutcome = PostOutcome | 'wait_live' | 'no_evenings';

/** Настоящие вечера сезона в статусах statuses: есть ли хоть один. */
async function hasEvenings(db: Db, key: string, statuses: readonly string[]): Promise<boolean> {
  const { data, error } = await db
    .from('evenings')
    .select('id')
    .eq('is_training', false)
    .in('status', [...statuses])
    .gte('scheduled_at', new Date(seasonStartMs(key)).toISOString())
    .lt('scheduled_at', new Date(seasonEndMs(key)).toISOString())
    .limit(1);
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  return (data ?? []).length > 0;
}

/**
 * «Итоги сезона» key в группу settings.group_chat_id. Ждёт, пока идёт вечер этого сезона; сезон без
 * завершённых вечеров — без поста (и без отметки: проверка дешёвая). Итоги — seasonRecap домена по
 * истории клуба (без тренировок), «сейчас» — nowMs: сезон key к этому моменту уже закрыт.
 */
export async function postSeasonResults(
  db: Db,
  settings: SettingsRow & { group_chat_id: number | string },
  key: string,
  nowMs: number,
): Promise<SeasonPostOutcome> {
  if ((await loadPostedSeasons(db, [key])).has(key)) return 'already_posted';
  if (await hasEvenings(db, key, ['live'])) return 'wait_live';
  if (!(await hasEvenings(db, key, ['finished', 'settled']))) return 'no_evenings';

  const [history, { names, guests }] = await Promise.all([
    loadHistory(db, scoringConfig(settings)),
    loadPlayerNames(db),
  ]);
  const recap = seasonRecap(
    {
      summaries: history.summaries,
      excluded: guests,
      predictions: scoredPredictions(history, () => true),
      stars: starAwards(history, nowMs),
      bestN: settings.season_best_n,
      bestNBySeason: history.bestNBySeason,
      currentSeasonKey: seasonKey(new Date(nowMs).toISOString()),
    },
    key,
  );
  const post = seasonResultsPost({ recap, names, botUsername: settings.bot_username });
  if (!post) return 'no_evenings';

  const atIso = new Date(nowMs).toISOString();
  const { data: claimed, error: claimError } = await db
    .from('season_posts')
    .upsert(
      { season_key: key, posted_at: atIso },
      {
        onConflict: 'season_key',
        ignoreDuplicates: true,
      },
    )
    .select('season_key');
  if (claimError) throw new Error(`claim season_posts: ${describeError(claimError)}`);
  if ((claimed ?? []).length === 0) return 'already_posted';
  try {
    await sendMessage(settings.group_chat_id, post.text, { buttons: post.buttons });
    return 'posted';
  } catch (error) {
    const { error: undoError } = await db
      .from('season_posts')
      .delete()
      .eq('season_key', key)
      .eq('posted_at', atIso);
    if (undoError) console.error(`release season_posts ${key}: ${describeError(undoError)}`);
    throw error;
  }
}
