// Шансы раздачи олл-ина для экрана. Флоп, тёрн и ривер — меньше тысячи досок, их считаем сразу на
// месте. До флопа — Монте-Карло: его считает Web Worker, а если воркера нет (старый браузер, сбой),
// — главный поток кусками по SLICE_SAMPLES раздач между кадрами. Результат в обоих случаях один и
// тот же (seed из карт, нарезка на ответ не влияет), кеш — по ключу раздачи: одна и та же раздача
// не пересчитывается при каждом опросе табло и каждой секунде таймера.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ShowdownHand } from '@domain/types.ts';
import { analyzeShowdown, type ShowdownAnalysis } from './analysis';
import { parseCards } from './cards';
import {
  computeEquity,
  createMcJob,
  mcJobResult,
  parseShowdownKey,
  planEquity,
  runMcJob,
  showdownKey,
  type EquityResult,
} from './equity';
import EquityWorker from './equity.worker?worker';
import type { EquityResponse } from './equity.worker';

/** Сколько раздач хранить: правки и улицы одного вечера помещаются с запасом. */
const CACHE_LIMIT = 48;
/** Раздач Монте-Карло за один кусок на главном потоке: единицы миллисекунд на ноутбуке. */
const SLICE_SAMPLES = 2000;

const cache = new Map<string, EquityResult>();
const failed = new Set<string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function remember(key: string, result: EquityResult): void {
  pending.delete(key);
  cache.delete(key);
  cache.set(key, result);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  notify();
}

function fail(key: string, message: string): void {
  pending.delete(key);
  failed.add(key);
  console.error(`Шансы олл-ина не посчитались (${key}): ${message}`);
  notify();
}

/** Запасной путь: Монте-Карло на главном потоке кусками, между кусками — отдать кадр. */
function computeInSlices(key: string): void {
  try {
    const { hands, board } = parseShowdownKey(key);
    const plan = planEquity(hands.length, board.length, key);
    if (plan.kind === 'exact') {
      remember(key, computeEquity(hands, board));
      return;
    }
    const job = createMcJob(
      hands.map((h) => parseCards(h)),
      parseCards(board),
      plan.samples,
      plan.seed,
    );
    const step = () => {
      try {
        if (runMcJob(job, SLICE_SAMPLES)) remember(key, mcJobResult(job));
        else setTimeout(step, 0);
      } catch (err) {
        fail(key, String(err));
      }
    };
    setTimeout(step, 0);
  } catch (err) {
    fail(key, String(err));
  }
}

// undefined — ещё не пробовали; null — воркера нет, считаем на главном потоке.
let worker: Worker | null | undefined;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') throw new Error('нет Web Worker');
    const w = new EquityWorker();
    w.onmessage = (event: MessageEvent<EquityResponse>) => {
      const data = event.data;
      if ('result' in data) remember(data.key, data.result);
      else fail(data.key, data.error);
    };
    // Воркер не поднялся (политика браузера, ошибка загрузки) — всё, что он не досчитал,
    // считаем сами.
    w.onerror = () => {
      w.terminate();
      worker = null;
      for (const key of [...pending]) computeInSlices(key);
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function request(key: string): void {
  if (cache.has(key) || pending.has(key) || failed.has(key)) return;
  pending.add(key);
  const w = getWorker();
  if (w) w.postMessage({ key });
  else computeInSlices(key);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Точный расчёт сразу (флоп и дальше): дёшево, кешируем без оповещения подписчиков. */
function exactNow(key: string): EquityResult | null {
  const cached = cache.get(key);
  if (cached) return cached;
  const { hands, board } = parseShowdownKey(key);
  try {
    const result = computeEquity(hands, board);
    cache.set(key, result);
    return result;
  } catch (err) {
    failed.add(key);
    console.error(`Шансы олл-ина не посчитались (${key}): ${String(err)}`);
    return null;
  }
}

export interface ShowdownEquityState {
  /** Шансы или null, пока считаются (или не посчитались). */
  equity: EquityResult | null;
  /** Посчитать не вышло — показать раздачу без процентов. */
  failed: boolean;
}

/** Шансы раздачи по ключу (`showdownKey`); null — раздачи нет. */
export function useShowdownEquity(key: string | null): ShowdownEquityState {
  const exact = useMemo(() => {
    if (key === null) return false;
    const { hands, board } = parseShowdownKey(key);
    return planEquity(hands.length, board.length, key).kind === 'exact';
  }, [key]);
  const exactResult = useMemo(() => (key !== null && exact ? exactNow(key) : null), [key, exact]);
  const asyncResult = useSyncExternalStore(subscribe, () =>
    key !== null && !exact ? (cache.get(key) ?? null) : null,
  );
  const isFailed = useSyncExternalStore(subscribe, () => key !== null && failed.has(key));

  useEffect(() => {
    if (key !== null && !exact) request(key);
  }, [key, exact]);

  return { equity: exact ? exactResult : asyncResult, failed: isFailed };
}

export interface ShowdownAnalysisState {
  analysis: ShowdownAnalysis | null;
  failed: boolean;
}

/** Разбор раздачи для панели олл-ина: шансы (useShowdownEquity), руки словами, ауты. */
export function useShowdownAnalysis(
  showdown: { hands: readonly ShowdownHand[]; board: readonly string[] } | null,
): ShowdownAnalysisState {
  const key = showdown
    ? showdownKey(
        showdown.hands.map((h) => h.cards),
        showdown.board,
      )
    : null;
  const { equity, failed: isFailed } = useShowdownEquity(key);
  const analysis = useMemo(() => {
    if (key === null || !equity) return null;
    const { hands, board } = parseShowdownKey(key);
    return analyzeShowdown(hands, board, equity);
  }, [key, equity]);
  return { analysis, failed: isFailed };
}
