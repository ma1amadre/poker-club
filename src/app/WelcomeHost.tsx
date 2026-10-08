// Шторка «Добро пожаловать» (аудит 07.10.2026, «Игрок и новичок»): три короткие карточки — вечер и
// деньги через банкира, очки сезона, прогноз и голосование. Сама открывается один раз — при первом
// заходе на главную (не поверх пульта банкира или голосования по ссылке из поста), дальше — по
// «Как всё устроено» на своей карточке (requestWelcome). «Показывали» помнит localStorage на этом
// устройстве; хранилище недоступно — покажется снова при следующем запуске. Тексты — welcomeCards.
import { DEFAULT_SCORING } from '@domain/scoring.ts';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { scoringFromSettings, useFormats, useSettings } from '../shared/api';
import {
  markWelcomeSeen,
  onWelcomeRequest,
  paths,
  safeLocalStorage,
  welcomeCards,
  welcomeSeen,
  type WelcomeCardId,
} from '../shared/lib';
import { Button, Icon, Sheet, type IconName } from '../shared/ui';
import './welcome.css';

const ICONS: Record<WelcomeCardId, IconName> = {
  evening: 'coins',
  season: 'trophy',
  predict: 'eye',
};

/** Хозяин шторки в раскладке под входом: слушает просьбы и открывает её сам на главной один раз. */
export function WelcomeHost() {
  const location = useLocation();
  // Просьба «Как всё устроено» со своей карточки.
  const [requested, setRequested] = useState(false);
  useEffect(() => onWelcomeRequest(() => setRequested(true)), []);

  // Первый заход на главную на этом устройстве: видел ли — читаем один раз при запуске, «показали»
  // запоминаем при закрытии шторки (закрыли приложение посреди неё — покажется в следующий раз).
  const [seenAtStart] = useState(() => welcomeSeen(safeLocalStorage()));
  const [autoClosed, setAutoClosed] = useState(false);
  const auto = location.pathname === paths.home && !seenAtStart && !autoClosed;

  if (!requested && !auto) return null;
  return (
    <WelcomeSheet
      first={auto && !requested}
      onClose={() => {
        if (auto) {
          markWelcomeSeen(safeLocalStorage());
          setAutoClosed(true);
        }
        setRequested(false);
      }}
    />
  );
}

function WelcomeSheet({ first, onClose }: { first: boolean; onClose: () => void }) {
  const settings = useSettings();
  const formats = useFormats();
  const [step, setStep] = useState(0);

  const cards = useMemo(() => {
    const s = settings.data ?? null;
    const format =
      s?.default_format_id && formats.data
        ? (formats.data.find((f) => f.id === s.default_format_id)?.config ?? null)
        : null;
    return welcomeCards({
      format,
      scoring: s ? scoringFromSettings(s) : DEFAULT_SCORING,
      bestN: s?.season_best_n ?? 10,
    });
  }, [settings.data, formats.data]);

  const card = cards[step] ?? cards[0];
  const next = cards[step + 1];
  if (!card) return null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={first ? 'Добро пожаловать в клуб' : 'Как всё устроено'}
      description={`Карточка ${step + 1} из ${cards.length}`}
      className="wl-sheet"
      actions={
        <div className="wl-actions">
          {step > 0 && (
            <Button variant="ghost" icon="arrow-left" onClick={() => setStep(step - 1)}>
              Назад
            </Button>
          )}
          {next ? (
            <Button variant="primary" iconAfter="arrow-right" onClick={() => setStep(step + 1)}>
              {`Показать: ${next.title.toLowerCase()}`}
            </Button>
          ) : (
            <Button variant="primary" icon="check" onClick={onClose}>
              Закрыть правила
            </Button>
          )}
        </div>
      }
    >
      <article className="wl-card" aria-label={card.title}>
        <span className="wl-card__icon" aria-hidden="true">
          <Icon name={ICONS[card.id]} size={24} />
        </span>
        <h3 className="m-h3 wl-card__title">{card.title}</h3>
        <ul className="wl-card__lines">
          {card.lines.map((line) => (
            <li key={line} className="m-body">
              {line}
            </li>
          ))}
        </ul>
      </article>
      <ol className="wl-dots" aria-label="Карточки">
        {cards.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className="wl-dot"
              aria-current={i === step ? 'step' : undefined}
              aria-label={`${i + 1}. ${c.title}`}
              onClick={() => setStep(i)}
            />
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
