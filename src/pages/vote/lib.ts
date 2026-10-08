// Чистые помощники голосования: итоги по номинациям, план работы с фото и обратный отсчёт.
// Подсчёт голосов и победителей — только доменной voteResults. Фаза голосования и участники
// вечера — в shared/lib/voting (их использует и главная).
import type { AllIn, AllInSwing } from '@domain/allins.ts';
import type { PlayerId } from '@domain/types.ts';
import { VOTE_CATEGORIES, voteResults, type VoteCategory } from '@domain/votes.ts';
import { formatClock, formatDuration } from '../../shared/lib/format';

/** Предел подписи к голосу: check (char_length(caption) <= 200) в таблице votes. */
export const CAPTION_MAX = 200;

// --- Итоги -----------------------------------------------------------------------------------

export interface VoteLike {
  voter_id: string;
  category: VoteCategory;
  nominee_id: string;
}

export interface NomineeResult<V> {
  nomineeId: PlayerId;
  count: number;
  /** Голоса за номинанта в этой номинации, в порядке строк (created_at). */
  votes: V[];
}

export interface CategoryResult<V> {
  category: VoteCategory;
  /** Сколько голосов засчитано (голос за себя домен не считает). */
  total: number;
  /** Победители; ничья — несколько, голосов нет — пусто. */
  winners: NomineeResult<V>[];
  /** Остальные номинанты по убыванию голосов. */
  others: NomineeResult<V>[];
}

/** Итоги по каждой номинации: победители и счёт — из voteResults, к ним — сами голоса. */
export function categoryResults<V extends VoteLike>(
  votes: readonly V[],
): Record<VoteCategory, CategoryResult<V>> {
  const results = voteResults(
    votes.map((v) => ({ voterId: v.voter_id, category: v.category, nomineeId: v.nominee_id })),
  );
  const out = {} as Record<VoteCategory, CategoryResult<V>>;
  for (const category of VOTE_CATEGORIES) {
    const { winners, counts } = results[category];
    const nominee = (nomineeId: PlayerId): NomineeResult<V> => ({
      nomineeId,
      count: counts[nomineeId] ?? 0,
      votes: votes.filter(
        (v) => v.category === category && v.nominee_id === nomineeId && v.voter_id !== nomineeId,
      ),
    });
    const winnerSet = new Set(winners);
    const others = Object.keys(counts)
      .filter((id) => !winnerSet.has(id))
      .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || (a < b ? -1 : 1))
      .map(nominee);
    out[category] = {
      category,
      total: Object.values(counts).reduce((sum, n) => sum + n, 0),
      winners: winners.map(nominee),
      others,
    };
  }
  return out;
}

// --- Фото к голосу ---------------------------------------------------------------------------

export interface PhotoDraft {
  /** Новый файл, выбранный в форме. */
  file: Blob | null;
  /** Убрать уже прикреплённое фото. */
  removeExisting: boolean;
}

export interface PhotoPlan {
  /** Загрузить draft.file перед голосом. */
  upload: boolean;
  /** Путь, который уйдёт в cast_vote, если загрузки нет (null — голос без фото). */
  keepPath: string | null;
  /** Файл в Storage, который больше не нужен после сохранения голоса. */
  removeAfter: string | null;
}

/**
 * Что делать с фото при сохранении голоса. cast_vote перезаписывает photo_path целиком,
 * поэтому прежний путь надо передать снова, иначе фото отвяжется от голоса и останется
 * сиротой в бакете. Старый файл удаляем только после успешного голоса.
 */
export function photoPlan(existingPath: string | null, draft: PhotoDraft): PhotoPlan {
  if (draft.file) return { upload: true, keepPath: null, removeAfter: existingPath };
  if (draft.removeExisting && existingPath) {
    return { upload: false, keepPath: null, removeAfter: existingPath };
  }
  return { upload: false, keepPath: existingPath, removeAfter: null };
}

// --- Проверка формы --------------------------------------------------------------------------

/** Текст ошибки формы голоса или null. Сервер проверяет то же самое (cast_vote). */
export function voteDraftError(
  draft: { nomineeId: string | null; caption: string },
  meId: PlayerId,
  participants: readonly PlayerId[],
): string | null {
  if (!draft.nomineeId) return 'Выбери номинанта — без него голос не сохранится.';
  if (draft.nomineeId === meId) return 'Голосовать за себя нельзя. Выбери другого игрока.';
  if (!participants.includes(draft.nomineeId)) {
    return 'Этот игрок не играл в этот вечер. Выбери участника.';
  }
  if (draft.caption.trim().length > CAPTION_MAX) {
    return `Подпись длиннее ${CAPTION_MAX} символов. Сократи её.`;
  }
  return null;
}

// --- Обратный отсчёт -------------------------------------------------------------------------

/** До закрытия: «23 ч 15 мин»; в последний час — «14:32» с секундами; после — «00:00». */
export function formatCountdown(ms: number): string {
  if (ms >= 60 * 60_000) return formatDuration(ms);
  return formatClock(ms, 'countdown');
}

// --- Подсказки из олл-инов -------------------------------------------------------------------

/** Подсказка в шторке голоса: раздача вечера и кого она предлагает номинировать. */
export interface AllInSuggestion {
  allIn: AllIn;
  nomineeId: PlayerId;
  /** «Победа с N %» раздачи, если она есть. */
  swing: AllInSwing | null;
}

/**
 * Записанные олл-ины вечера как готовые кандидаты: «Рука вечера» — победитель раздачи (делёж банка
 * не в счёт), «Бэд-бит вечера» — фаворит, проигравший «победе с N %» (домен: swingFromShares).
 * Голосовать можно только за участника вечера и не за себя — остальные подсказки отброшены.
 * Сначала самые невероятные раздачи (меньшая доля победителя), дальше — по порядку вечера.
 */
export function allInSuggestions(
  category: VoteCategory,
  allIns: readonly AllIn[],
  swings: ReadonlyMap<string, AllInSwing>,
  candidateIds: readonly PlayerId[],
): AllInSuggestion[] {
  if (category === 'bluff') return [];
  const allowed = new Set(candidateIds);
  const out: (AllInSuggestion & { order: number })[] = [];
  allIns.forEach((allIn, order) => {
    const swing = swings.get(allIn.showdownId) ?? null;
    if (category === 'hand') {
      const winner = allIn.winners?.length === 1 ? allIn.winners[0] : undefined;
      if (winner !== undefined && allowed.has(winner))
        out.push({ allIn, nomineeId: winner, swing, order });
    } else if (swing) {
      for (const id of swing.favoriteIds)
        if (allowed.has(id)) out.push({ allIn, nomineeId: id, swing, order });
    }
  });
  return out
    .sort((a, b) => (a.swing?.pct ?? 101) - (b.swing?.pct ?? 101) || a.order - b.order)
    .map(({ order: _order, ...s }) => s);
}
