// Движок олл-ина на клиенте: карты, оценка руки, эквити (точно или Монте-Карло с seed из карт),
// ауты и разбор раздачи. Перенесён из курса D:\personal\poker-course (cards.js, evaluator.js,
// equity.js, pokermath.js). Чистые модули — тесты берут их напрямую; React-хук шансов с Web Worker —
// useShowdownEquity.ts.
export {
  cardCode,
  cardLabel,
  cardName,
  deckWithout,
  parseCard,
  parseCards,
  rankLabel,
  RANKS,
  SUIT_SYMBOL,
  SUITS,
  suitOfCode,
  type Card,
  type SuitCode,
} from './cards';
export { CATEGORY, categoryOf, describeHand, evaluate } from './evaluator';
export {
  computeEquity,
  parseShowdownKey,
  planEquity,
  seedFor,
  showdownKey,
  type EquityPlan,
  type EquityResult,
} from './equity';
export {
  analyzeShowdown,
  computeOuts,
  roundShares,
  type PlayerOuts,
  type PlayerShowdown,
  type ShowdownAnalysis,
} from './analysis';
export { nCk, outsEquity } from './pokermath';
export {
  useShowdownAnalysis,
  useShowdownEquities,
  useShowdownEquity,
  type ShowdownAnalysisState,
  type ShowdownEquityState,
} from './useShowdownEquity';
export { useAllInSwings, type AllInSwingsState } from './useAllInSwings';
