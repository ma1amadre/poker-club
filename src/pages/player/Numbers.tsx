import type { RecordKind } from '@domain/records.ts';
import type { ReactNode } from 'react';
import { eveningsCount, formatDate, formatPoints, NBSP, paths, plural } from '../../shared/lib';
import { Amount, Badge, List, ListItem, Section } from '../../shared/ui';
import type { PersonalBest, PlayerNumbers } from './stats';

/** После «из» — родительный: «из 1 вечера», «из 2 вечеров», «из 5 вечеров». */
const OF_EVENINGS = ['вечера', 'вечеров', 'вечеров'] as const;

export interface NumbersProps {
  numbers: PlayerNumbers;
  /** Виды рекордов клуба, которые держит игрок (recordsTable домена). */
  clubRecords: ReadonlySet<RecordKind>;
}

/** Название строки и, если личный рекорд — он же рекорд клуба, пометка рядом. */
function Title({ text, record }: { text: string; record: boolean }) {
  return (
    <span className="pl-num__title">
      <span>{text}</span>
      {record && <Badge tone="accent">Рекорд клуба</Badge>}
    </span>
  );
}

function Count({ value }: { value: number }) {
  return <span className="m-mono pl-num__value">{value}</span>;
}

function bestRow(
  key: string,
  best: PersonalBest | null,
  title: ReactNode,
  value: ReactNode,
  subtitle: (best: PersonalBest) => string,
  empty: string,
) {
  return (
    <ListItem
      key={key}
      to={best ? paths.evening(best.eveningId) : undefined}
      title={title}
      subtitle={best ? subtitle(best) : empty}
      after={value}
    />
  );
}

/**
 * «Цифры» игрока: личные рекорды (лучший вечер по нетто, нокауты за вечер, серия побед) —
 * строки со ссылкой на вечер, где поставлен; доля вечеров в призах и среднее место.
 */
export function Numbers({ numbers, clubRecords }: NumbersProps) {
  const { bestNet, mostKos, bestStreak, inTheMoney, averagePlace } = numbers;
  const itmPct = inTheMoney.of > 0 ? Math.round((inTheMoney.count / inTheMoney.of) * 100) : null;

  return (
    <Section title="Цифры">
      <List aria-label="Личные рекорды и показатели игрока">
        {bestRow(
          'net',
          bestNet,
          <Title text="Лучший вечер" record={clubRecords.has('biggest_win')} />,
          bestNet ? <Amount value={bestNet.value} /> : <Count value={0} />,
          (b) => formatDate(b.date),
          'Вечеров пока нет',
        )}
        {bestRow(
          'kos',
          mostKos,
          <Title text="Больше всего нокаутов" record={clubRecords.has('most_kos')} />,
          <Count value={mostKos?.value ?? 0} />,
          (b) => `За вечер ${formatDate(b.date)}`,
          'Нокаутов пока не было',
        )}
        {bestRow(
          'streak',
          bestStreak,
          <Title text="Лучшая серия побед" record={clubRecords.has('win_streak')} />,
          <Count value={bestStreak?.value ?? 0} />,
          (b) =>
            b.value === 1
              ? `Одна победа, ${formatDate(b.date)}`
              : `Подряд, последняя — ${formatDate(b.date)}`,
          'Побед пока не было',
        )}
        <ListItem
          title="В призах"
          subtitle={
            inTheMoney.of > 0
              ? `${inTheMoney.count} из${NBSP}${inTheMoney.of}${NBSP}${plural(inTheMoney.of, OF_EVENINGS)}`
              : 'Призовые места не определены'
          }
          after={
            <span className="m-mono pl-num__value">
              {itmPct === null ? '—' : `${itmPct}${NBSP}%`}
            </span>
          }
        />
        <ListItem
          title="Среднее место"
          subtitle={averagePlace === null ? 'Мест пока нет' : `За ${eveningsCount(numbers.placed)}`}
          after={
            <span className="m-mono pl-num__value">
              {averagePlace === null ? '—' : formatPoints(Math.round(averagePlace * 10) / 10)}
            </span>
          }
        />
      </List>
    </Section>
  );
}
