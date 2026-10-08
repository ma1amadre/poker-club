// «Победы с N %» раздач вечера на клиенте: доли улиц — тем же кешем и воркером, что у панели олл-ина
// и «Олл-инов вечера» (useShowdownEquities), правило — swingFromShares домена. Сервер (пост итогов)
// считает то же доменной allInSwing — ответ совпадает (allins.test.ts), а здесь Монте-Карло до флопа
// не держит главный поток: экран итога, табло и шторка голосования не замирают.
import { allInStreets, swingFromShares, type AllIn, type AllInSwing } from '@domain/allins.ts';
import { roundShares } from '@domain/poker/shares.ts';
import { useMemo } from 'react';
import { useShowdownEquities } from './useShowdownEquity';

export interface AllInSwingsState {
  /** showdownId → «победа с N %» (раздачи без неё — нет в карте). */
  swings: Map<string, AllInSwing>;
  /** Шансы ещё считаются — карта может пополниться. */
  pending: boolean;
}

export function useAllInSwings(allIns: readonly AllIn[]): AllInSwingsState {
  // Только раздачи с одним победителем: у остальных «победы с N %» не бывает — их не считаем.
  const plan = useMemo(
    () =>
      allIns
        .filter((a) => a.winners?.length === 1)
        .map((a) => ({ allIn: a, streets: allInStreets(a).filter((s) => s.boardSize < 5) })),
    [allIns],
  );
  const keys = useMemo(() => plan.flatMap((p) => p.streets.map((s) => s.key)), [plan]);
  const results = useShowdownEquities(keys);

  return useMemo(() => {
    const swings = new Map<string, AllInSwing>();
    let pending = false;
    let at = 0;
    for (const { allIn, streets } of plan) {
      const shares = new Map<number, number[]>();
      for (const s of streets) {
        const r = results[at];
        at += 1;
        if (r) shares.set(s.boardSize, roundShares(r.equity));
        else pending = true;
      }
      const swing = swingFromShares(allIn, shares);
      if (swing) swings.set(allIn.showdownId, swing);
    }
    return { swings, pending };
  }, [plan, results]);
}
