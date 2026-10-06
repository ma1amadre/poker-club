// Статус вечера бейджем: смысл несёт слово (EVENING_STATUS_META), тон и точка только подкрепляют —
// цвет никогда не единственный носитель смысла. Один вид статуса на всех экранах.
import { EVENING_STATUS_META, type EveningStatus } from '../api/types';
import { Badge, type Tone } from './materia';

const STATUS_TONE: Record<EveningStatus, { tone: Tone; dot?: boolean }> = {
  announced: { tone: 'neutral' },
  // Точка — признак «живого» состояния.
  live: { tone: 'positive', dot: true },
  // Игра окончена, но расчёт не закрыт — есть что доделать.
  finished: { tone: 'caution' },
  settled: { tone: 'neutral' },
  cancelled: { tone: 'neutral' },
};

export interface EveningStatusBadgeProps {
  status: EveningStatus;
}

export function EveningStatusBadge({ status }: EveningStatusBadgeProps) {
  const meta = STATUS_TONE[status];
  return (
    <Badge tone={meta.tone} dot={meta.dot}>
      {EVENING_STATUS_META[status].title}
    </Badge>
  );
}
