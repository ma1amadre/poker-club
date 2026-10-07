// «Твой вечер»: что завершённый вечер значил лично для игрока — кого выбил, кто выбил его, прогноз
// и очки Оракула, новые ачивки, место в сезоне до → после, рекорды и звания. Считает домен
// (eveningRecap по истории клуба), здесь только раскладка строк. Не игравшему — только прогноз и
// новые ачивки, если прогноз был; без прогноза — не показывается.
// Используют экран завершённого вечера и главная (блок «Последний вечер»); данные — useEveningRecap.
import type { EveningRecap } from '@domain/recap.ts';
import { Icon, List, ListItem } from '../../shared/ui';
import { recapLines, recapResultLine, type NameOf, type PredictionPick } from './recap';
import './recap.css';

export interface EveningRecapListProps {
  recap: EveningRecap;
  pick: PredictionPick | null;
  meId: string;
  nameOf: NameOf;
  /** Строка «2-е место из 5 · 4,5 очка · +300 ₽» сверху — там, где результата нет рядом. */
  withResult?: boolean;
}

/** Строки «Твоего вечера» списком без рамки (кладётся в Card). */
export function EveningRecapList({ recap, pick, meId, nameOf, withResult }: EveningRecapListProps) {
  const lines = recapLines(recap, meId, nameOf, pick);
  const result = withResult ? recapResultLine(recap) : null;
  return (
    <div className="ev-recap">
      {result && <p className="m-h3 ev-recap__result">{result}</p>}
      <List plain aria-label="Твой вечер">
        {lines.map((line) => (
          <ListItem
            key={line.key}
            before={<Icon name={line.icon} size={20} className="ev-recap__icon" />}
            title={line.title}
            subtitle={line.detail ?? undefined}
            to={line.to}
          />
        ))}
      </List>
    </div>
  );
}
