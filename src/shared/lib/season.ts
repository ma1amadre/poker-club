// Подписи сезона (квартала) по ключу домена seasonKey: '2026-Q4'.

const SEASON_RE = /^(\d{4})-Q([1-4])$/;

// Диапазон — короткое тире без пробелов (правило набора «Материи»).
const QUARTER_MONTHS = ['январь–март', 'апрель–июнь', 'июль–сентябрь', 'октябрь–декабрь'] as const;

function parseSeason(key: string): { year: number; quarter: number } | null {
  const m = SEASON_RE.exec(key);
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
}

/** '2026-Q4' → «4-й квартал 2026». Непонятный ключ показываем как есть. */
export function formatSeason(key: string): string {
  const s = parseSeason(key);
  return s ? `${s.quarter}-й квартал ${s.year}` : key;
}

/** '2026-Q4' → «4-го квартала 2026» — для «Чемпион 4-го квартала 2026». */
export function formatSeasonGenitive(key: string): string {
  const s = parseSeason(key);
  return s ? `${s.quarter}-го квартала ${s.year}` : key;
}

/** '2026-Q4' → «октябрь–декабрь». */
export function seasonMonths(key: string): string {
  const s = parseSeason(key);
  return s ? (QUARTER_MONTHS[s.quarter - 1] ?? '') : '';
}
