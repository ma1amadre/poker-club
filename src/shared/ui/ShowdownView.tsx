import { streetOf } from '@domain/showdown.ts';
import type { ShowdownHand } from '@domain/types.ts';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { formatNumber, NBSP } from '../lib/format';
import { roundShares } from '../lib/poker/analysis';
import { cardName } from '../lib/poker/cards';
import { groupOuts, outsTarget, STREET_LABEL } from '../lib/poker/display';
import { useShowdownAnalysis } from '../lib/poker/useShowdownEquity';
import { PlayingCard, SuitPip, type PlayingCardSize } from './PlayingCard';
import './showdown.css';

export interface ShowdownViewProps {
  showdown: { hands: readonly ShowdownHand[]; board: readonly string[] };
  nameOf: (playerId: string) => string;
  /** board — табло (ТВ, крупно), compact — экран вечера в Mini App. */
  variant?: 'board' | 'compact';
  /** Справа в шапке: на табло — часы уровня. */
  aside?: ReactNode;
  /** Под раздачей: кнопка банкира. */
  footer?: ReactNode;
}

const BOARD_SLOTS = ['флоп', 'флоп', 'флоп', 'тёрн', 'ривер'];

/**
 * Панель олл-ина: стол, руки игроков, шансы на победу (%, полоса), делёж и ауты. Шансы считает
 * useShowdownAnalysis (точно с флопа, до флопа — Монте-Карло в Web Worker с seed из карт): на табло,
 * у банкира и у игроков цифры одни и те же. Проценты — целые, в сумме 100.
 */
export function ShowdownView({
  showdown,
  nameOf,
  variant = 'compact',
  aside,
  footer,
}: ShowdownViewProps) {
  const { analysis, failed } = useShowdownAnalysis(showdown);
  const street = streetOf(showdown.board.length);
  const cardSize: PlayingCardSize = variant === 'board' ? 'lg' : 'md';
  const handSize: PlayingCardSize = variant === 'board' ? 'lg' : 'sm';

  const players = analysis?.players ?? null;
  const shares = players ? roundShares(players.map((p) => p.equity)) : null;
  const top = shares ? Math.max(...shares) : null;
  // Лидер по шансам — у кого их больше всех и больше, чем у кого-то ещё (50 на 50 — без лидера).
  const hasLeader = shares !== null && shares.some((s) => s !== top);
  const winners = analysis?.winners ?? null;
  const target = outsTarget(street);
  const anyoneAhead = players?.some((p) => p.ahead) ?? false;
  const allAhead = players?.every((p) => p.ahead) ?? false;

  return (
    <section
      className={cn('ui-sd', `ui-sd--${variant}`, showdown.hands.length > 4 && 'ui-sd--rows2')}
      // Раскладка табло на ТВ — по числу рук (showdown.css): колонки, размер карт и цифр.
      data-hands={showdown.hands.length}
      aria-label="Олл-ин"
    >
      <header className="ui-sd__head">
        {variant === 'board' ? (
          <h2 className="m-h2 ui-sd__title">Олл-ин · {STREET_LABEL[street]}</h2>
        ) : (
          <p className="m-eyebrow">Олл-ин · {STREET_LABEL[street]}</p>
        )}
        {aside}
      </header>

      <div className="ui-sd__board" role="group" aria-label="Карты стола">
        {BOARD_SLOTS.map((label, i) => (
          <PlayingCard
            key={i}
            code={showdown.board[i] ?? null}
            size={cardSize}
            emptyLabel={`${label} не открыт`}
            className={i === 3 ? 'ui-sd__turn' : undefined}
          />
        ))}
      </div>

      <ol className="ui-sd__hands" aria-label="Руки игроков">
        {showdown.hands.map((hand, i) => {
          const p = players?.[i] ?? null;
          const share = shares?.[i] ?? null;
          const isWinner = winners?.includes(i) ?? false;
          const isLead = winners === null && hasLeader && share === top;
          const tie = p ? Math.round(p.tie) : 0;
          const outs = p?.outs ?? null;
          const outsCount = outs ? outs.outs.length + outs.splitOuts.length : 0;
          return (
            <li
              key={hand.playerId}
              className={cn(
                'ui-sd__hand',
                isLead && 'ui-sd__hand--lead',
                isWinner && 'ui-sd__hand--win',
                winners !== null && !isWinner && 'ui-sd__hand--lost',
              )}
            >
              <div className="ui-sd__who">
                <p className="ui-sd__name">{nameOf(hand.playerId)}</p>
                {p?.hand && <p className="ui-sd__made">{p.hand}</p>}
              </div>
              <div className="ui-sd__cards">
                <PlayingCard code={hand.cards[0]} size={handSize} />
                <PlayingCard code={hand.cards[1]} size={handSize} />
              </div>
              <p className="ui-sd__pct">
                <span aria-hidden="true">
                  {share === null ? '…' : share}
                  <span className="ui-sd__pct-unit">%</span>
                </span>
                <span className="sr-only">
                  {share === null ? 'шансы считаются' : `шансы ${share}${NBSP}%`}
                </span>
              </p>
              <div className="ui-sd__bar" aria-hidden="true">
                <span style={{ inlineSize: `${share ?? 0}%` }} />
              </div>
              <div className="ui-sd__notes">
                {winners !== null && isWinner && (
                  <p className="ui-sd__tag">{winners.length > 1 ? 'Делёж банка' : 'Лучшая рука'}</p>
                )}
                {winners === null && p?.ahead && anyoneAhead && !allAhead && (
                  <p className="ui-sd__tag">Впереди</p>
                )}
                {winners === null && tie > 0 && (
                  <p className="ui-sd__note">
                    делёж{NBSP}
                    {tie}
                    {NBSP}%
                  </p>
                )}
                {outs && target && (
                  <div className="ui-sd__outs">
                    <p className="ui-sd__note">
                      {outsCount === 0
                        ? `Аутов ${target} нет`
                        : `Ауты ${target}: ${outsCount} · ${Math.round(outs.hitPct)}${NBSP}%`}
                    </p>
                    {outs.outs.length > 0 && <OutsLine codes={outs.outs} />}
                    {outs.splitOuts.length > 0 && (
                      <OutsLine codes={outs.splitOuts} prefix="на делёж" />
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {street === 'preflop' && analysis && !analysis.exact && (
        <p className="ui-sd__foot">
          Шансы до флопа — оценка: разыграно {formatNumber(analysis.samples)} досок
        </p>
      )}
      {!analysis && (
        <p className="ui-sd__foot" role="status">
          {failed ? 'Шансы не посчитались — карты на месте' : 'Считаю шансы'}
        </p>
      )}
      {footer}
    </section>
  );
}

/** Ауты по рангам: «A ♠♥♦ · K ♠♥♦». */
function OutsLine({ codes, prefix }: { codes: readonly string[]; prefix?: string }) {
  return (
    <p className="ui-sd__outs-list">
      <span className="sr-only">
        {prefix ? `${prefix}: ` : ''}
        {codes.map(cardName).join(', ')}
      </span>
      {prefix && (
        <span className="ui-sd__outs-prefix" aria-hidden="true">
          {prefix}:
        </span>
      )}
      {groupOuts(codes).map((g) => (
        <span key={g.rank} className="ui-sd__outs-group" aria-hidden="true">
          <span className="ui-sd__outs-rank">{g.rank}</span>
          {g.suits.map((s) => (
            <SuitPip key={s} suit={s} className={`ui-card-suit--${s}`} />
          ))}
        </span>
      ))}
    </p>
  );
}
