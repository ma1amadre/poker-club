// Бомб-пот на экране вечера (миграция 030): полоса бомб-пота у всех (пульт «Стол» и «Подробно»,
// экран игрока) и ряд «Кто забрал бомб-пот?» на пульте вместо «Следующей раздачи». Тексты и время
// показа — bombPotView.ts, что показать на месте числа — useBombPot.
// - Полоса: «БОМБ-ПОТ» (переброс — пометкой), до at + 9 с — «Кубик брошен — смотри на табло» (табло
//   показывает число первым), без табло — розыгрыш на телефоне (окно с перебором 1…5 и шкала), потом
//   «3 BB — по 300», банк и первое слово; у игрока — своя строка («У тебя первое слово»).
// - «Кто забрал»: одно касание — две записи одним действием (bomb_pot_result и hand): касаний столько
//   же, сколько у «Следующей раздачи». Победитель олл-ина в бомб-поте — главной кнопкой. «Делёж» —
//   выбор нескольких, «Не отмечать» — только раздача. Пока висит вопрос «Фишек хватило?», ряд закрыт
//   той же подсказкой, что «Следующая раздача» (вылет записывается до раздачи). Отметка уже есть
//   (раздачу после неё отменили отдельно) — вместо имён «Отмечено: …» и «Следующая раздача» (только hand).
import { BOMB_POT_MAX_BBS, type PlayerId } from '@domain/types.ts';
import { useState } from 'react';
import { cn, NBSP } from '../../shared/lib';
import { Button } from '../../shared/ui';
import './bomb.css';
import {
  bombMarkedText,
  bombPotBar,
  bombSplitSuggestion,
  bombWinnerChoices,
  myBombText,
  splitButtonLabel,
} from './bombPotView';
import type { EveningModel } from './useEveningModel';
import type { BombPotScreen } from './useBombPot';

/** Окно розыгрыша на телефоне (табло не на связи): цифра и шкала 1…5, текущая — светлее. */
function BombRoll({ face }: { face: number | null }) {
  return (
    <div className="ev-bomb__roll" aria-hidden="true">
      <span className="ev-bomb__face">{face ?? NBSP}</span>
      <span className="ev-bomb__bb">BB</span>
      <span className="ev-bomb__scale">
        {Array.from({ length: BOMB_POT_MAX_BBS }, (_, i) => (
          <span key={i} className={cn('ev-bomb__cell', face === i + 1 && 'ev-bomb__cell--on')}>
            {i + 1}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Полоса бомб-пота: у всех на экране вечера, пока бомб-пот открыт. */
export function BombPotBar({
  model,
  screen,
  meId = null,
  className,
}: {
  model: Pick<EveningModel, 'state' | 'nameOf'>;
  screen: BombPotScreen;
  /** Смотрит игрок (не пульт): своя строка — первое слово и взнос. */
  meId?: PlayerId | null;
  className?: string;
}) {
  const { bombPot, view } = screen;
  const bar = bombPotBar(bombPot, model.state, view, model.nameOf);
  const mine = myBombText(bombPot, model.state, meId, view.phase === 'shown');
  return (
    <div className={cn('ev-bomb__bar', className)} role="status" aria-live="polite">
      <p className="m-eyebrow ev-bomb__eb">{bar.eyebrow}</p>
      {view.phase === 'rolling' ? (
        <>
          <BombRoll face={view.face} />
          <p className="sr-only">{bar.main}</p>
        </>
      ) : (
        <p className={cn('ev-bomb__main', view.phase === 'shown' && 'ev-bomb__main--stake')}>
          {bar.main}
        </p>
      )}
      {bar.detail && <p className="m-small ev-bomb__detail">{bar.detail}</p>}
      {bar.reroll && <p className="m-small ev-bomb__reroll">{bar.reroll}</p>}
      {mine && <p className="m-body ev-bomb__mine">{mine}</p>}
    </div>
  );
}

/**
 * «Кто забрал бомб-пот?» — вместо «Следующей раздачи». onPick — записать: забравшие (пусто — «Не
 * отмечать», только раздача). hold — почему ряд закрыт (вопрос после ривера).
 */
export function BombWinners({
  model,
  busy,
  hold,
  onPick,
}: {
  model: Pick<EveningModel, 'state' | 'nameOf'>;
  busy: boolean;
  hold: string | null;
  onPick: (winners: PlayerId[]) => void;
}) {
  const { state, nameOf } = model;
  const choices = bombWinnerChoices(state);
  const suggestion = bombSplitSuggestion(state);
  // Делёж: выбор нескольких; олл-ин с равными руками на ривере — сразу с ними.
  const [split, setSplit] = useState<PlayerId[] | null>(null);
  const closed = busy || Boolean(hold);
  const toggle = (id: PlayerId) =>
    setSplit((s) => (s ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  // Кто забрал, уже отмечено, а раздача, которая закрыла бомб-пот, отменена отдельно: вторую отметку
  // журнал не примет — остаётся только раздача (bombPotCloseDrafts пишет её одну).
  const marked = state.bombPot?.result?.winners ?? null;

  if (marked) {
    return (
      <div className="ev-bomb__who" role="group" aria-label="Кто забрал бомб-пот">
        <p className="m-eyebrow">Кто забрал бомб-пот</p>
        <p className="m-body">{bombMarkedText(marked.map(nameOf))}</p>
        <Button variant="primary" block disabled={closed} onClick={() => onPick([])}>
          Следующая раздача
        </Button>
        <p className="m-small ev-bomb__hint">
          {hold ??
            'Отметка уже в ленте. Другой забравший — сначала отмени её в ленте. Баттон после бомб-пота остаётся на месте.'}
        </p>
      </div>
    );
  }

  return (
    <div className="ev-bomb__who" role="group" aria-label="Кто забрал бомб-пот">
      <p className="m-eyebrow">{split ? 'Делёж — кто забирает' : 'Кто забрал бомб-пот'}</p>
      <div className="ev-bomb__names">
        {choices.map(({ playerId, main }) => {
          const name = nameOf(playerId);
          const on = split?.includes(playerId) ?? false;
          return split ? (
            <Button
              key={playerId}
              variant={on ? 'primary' : 'secondary'}
              aria-pressed={on}
              disabled={closed}
              onClick={() => toggle(playerId)}
            >
              {name}
            </Button>
          ) : (
            <Button
              key={playerId}
              variant={main ? 'primary' : 'secondary'}
              aria-label={`Бомб-пот забирает ${name}`}
              disabled={closed}
              onClick={() => onPick([playerId])}
            >
              {name}
            </Button>
          );
        })}
      </div>
      {split ? (
        <div className="ev-bomb__row">
          <Button
            variant="primary"
            disabled={closed || split.length < 2}
            onClick={() =>
              onPick(choices.map((c) => c.playerId).filter((id) => split.includes(id)))
            }
          >
            {splitButtonLabel(split.length)}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setSplit(null)}>
            Назад
          </Button>
        </div>
      ) : (
        <div className="ev-bomb__row">
          <Button
            variant="secondary"
            disabled={closed || choices.length < 2}
            onClick={() => setSplit(suggestion.length > 1 ? suggestion : [])}
          >
            Делёж
          </Button>
          <Button variant="ghost" disabled={closed} onClick={() => onPick([])}>
            Не отмечать
          </Button>
        </div>
      )}
      <p className="m-small ev-bomb__hint">
        {hold ??
          (split
            ? 'Отметь всех, кто делит банк, — потом «Записать делёж».'
            : 'Касание — кто забрал банк и следующая раздача одним действием. Баттон после бомб-пота остаётся на месте.')}
      </p>
    </div>
  );
}
