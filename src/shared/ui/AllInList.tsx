// «Олл-ины вечера»: каждая записанная раздача — стол, руки и доли банка по улицам, итог на ривере,
// пометки «победа с 13 %» и «фаворит, 87 %». Раздачи собирает домен (eveningAllIns), доли — тот же
// движок и кеш, что у панели олл-ина на табло (useShowdownEquities: до флопа — Web Worker), правило
// пометок — swingFromShares домена: цифры здесь, на табло, в сюжете вечера и в посте одни и те же.
import { allInStreets, swingFromShares, type AllIn } from '@domain/allins.ts';
import { roundShares } from '@domain/poker/shares.ts';
import { cn } from '../lib/cn';
import { formatTime, NBSP } from '../lib/format';
import { parseCards } from '../lib/poker/cards';
import { STREET_LABEL } from '../lib/poker/display';
import { describeHand, evaluate } from '../lib/poker/evaluator';
import { useShowdownEquities } from '../lib/poker/useShowdownEquity';
import { favoritePill, swingPill } from '../lib/stories';
import { joinNames } from '../lib/text';
import { PlayingCard } from './PlayingCard';
import { Card } from './Section';
import './allins.css';

export interface AllInListProps {
  allIns: readonly AllIn[];
  nameOf: (playerId: string) => string;
  /** Своя строка — с пометкой «(ты)». */
  meId?: string | null;
  className?: string;
}

const BOARD_SLOTS = ['флоп', 'флоп', 'флоп', 'тёрн', 'ривер'];

/** Список раздач вечера по порядку; пустой — ничего не рисует. */
export function AllInList({ allIns, nameOf, meId, className }: AllInListProps) {
  if (allIns.length === 0) return null;
  return (
    <ol className={cn('ui-allins', className)} aria-label="Олл-ины вечера">
      {allIns.map((a) => (
        <li key={a.showdownId}>
          <AllInCard allIn={a} nameOf={nameOf} meId={meId ?? null} />
        </li>
      ))}
    </ol>
  );
}

/** Рука победителя словами: «Две пары»; карты сломаны — null. */
function madeHand(cards: readonly string[], board: readonly string[]): string | null {
  try {
    return describeHand(evaluate(parseCards([...cards, ...board])));
  } catch {
    return null;
  }
}

function AllInCard({
  allIn,
  nameOf,
  meId,
}: {
  allIn: AllIn;
  nameOf: (playerId: string) => string;
  meId: string | null;
}) {
  // Колонки — улицы до ривера, на которых раздачу показывали; ривер — итог в строке игрока.
  const streets = allInStreets(allIn).filter((s) => s.boardSize < 5);
  const results = useShowdownEquities(streets.map((s) => s.key));
  const shares = results.map((r) => (r ? roundShares(r.equity) : null));
  const counted = shares.every((s) => s !== null);
  const swing = counted
    ? swingFromShares(
        allIn,
        new Map(streets.map((s, i) => [s.boardSize, shares[i] ?? []] as const)),
      )
    : null;
  const winners = allIn.winners;
  const split = (winners?.length ?? 0) > 1;
  const result =
    winners === null
      ? 'Раздача без ривера'
      : split
        ? `Делёж банка — ${joinNames(winners.map(nameOf))}`
        : `Банк — ${nameOf(winners[0] ?? '')}`;

  return (
    <Card className="ui-allin">
      <div className="ui-allin__head">
        <p className="m-eyebrow">Олл-ин · {formatTime(allIn.openedAt)}</p>
        <p className="m-small ui-allin__result">{result}</p>
      </div>

      <div className="ui-allin__board" role="group" aria-label="Карты стола">
        {BOARD_SLOTS.map((label, i) => (
          <PlayingCard
            key={i}
            code={allIn.board[i] ?? null}
            size="sm"
            emptyLabel={`${label} не внесён`}
          />
        ))}
      </div>

      <table className="ui-allin__table">
        <caption className="sr-only">Доли банка по улицам, %</caption>
        <thead>
          <tr>
            <th scope="col">Игрок</th>
            {streets.map((s) => (
              <th key={s.boardSize} scope="col" className="ui-allin__num">
                {STREET_LABEL[s.street]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allIn.hands.map((h, row) => {
            const won = winners?.includes(h.playerId) ?? false;
            const lost = winners !== null && !won;
            const made = won && allIn.board.length === 5 ? madeHand(h.cards, allIn.board) : null;
            const isSwing = swing?.winnerId === h.playerId;
            const isFavorite = swing !== null && lost && swing.favoriteIds.includes(h.playerId);
            return (
              <tr key={h.playerId} className={cn(won && 'is-won', lost && 'is-lost')}>
                <th scope="row">
                  <span className="ui-allin__who">
                    <span className="ui-allin__name">
                      {nameOf(h.playerId)}
                      {h.playerId === meId && ' (ты)'}
                    </span>
                    <span className="ui-allin__cards">
                      <PlayingCard code={h.cards[0]} size="sm" />
                      <PlayingCard code={h.cards[1]} size="sm" />
                    </span>
                  </span>
                  {(made || isSwing || isFavorite) && (
                    <span className="ui-allin__notes">
                      {made && <span>{made}</span>}
                      {isSwing && swing && (
                        <span className="ui-allin__pill ui-allin__pill--swing">
                          {swingPill(swing)}
                        </span>
                      )}
                      {isFavorite && swing && (
                        <span className="ui-allin__pill">{favoritePill(swing)}</span>
                      )}
                    </span>
                  )}
                </th>
                {streets.map((s, i) => {
                  const pct = shares[i]?.[row];
                  return (
                    <td key={s.boardSize} className="ui-allin__num m-mono">
                      {pct === undefined ? (
                        <span aria-label="шансы считаются">…</span>
                      ) : (
                        // Как на табло: целые проценты, ноль — «0 %».
                        `${pct}${NBSP}%`
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
