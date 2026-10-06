// ТОЛЬКО ДЛЯ РАЗРАБОТКИ: пример табло-цифр в Янтаре — /#/dev/kit-yantar. Регистр включает
// ThemeScope в routes.tsx (как у настоящего табло /board/:token). Данные — пример.
import { formatBlinds, formatNumber } from '../../shared/lib';
import { Badge, ButtonLink, Icon, List, ListItem, Stat, Stats } from '../../shared/ui';
import './kit.css';

const ALIVE = ['Женя', 'Оля', 'Миша', 'Дима'];
const OUT = [
  { name: 'Саша', note: '6-е место · 4-й уровень' },
  { name: 'Костя', note: '5-е место · 4-й уровень' },
];

export default function KitYantarPage() {
  return (
    <main className="kit-board">
      <header className="kit-board__head">
        <p className="m-eyebrow">8.10 · 19:00 · у Жени</p>
        <Badge tone="caution" dot>
          Пример данных
        </Badge>
      </header>

      <section className="kit-board__main" aria-label="Уровень и таймер">
        <p className="m-eyebrow">Уровень 3 из 8</p>
        {/* Единственное свечение экрана — за главным числом (правило Янтаря). */}
        <div className="kit-board__clock">
          <p className="m-display kit-board__time" aria-label="Осталось 18 минут 42 секунды">
            18:42
          </p>
        </div>
        <p className="m-figure">{formatBlinds({ sb: 15, bb: 30 })}</p>
        <p className="m-body kit-board__next">
          Дальше {formatBlinds({ sb: 20, bb: 40 })} · ребаи открыты до конца 5-го уровня
        </p>
      </section>

      <Stats className="kit-board__stats">
        <Stat label="Фонд" value={formatNumber(2800)} unit="₽" />
        <Stat label="В игре" value="4" unit="из 6" />
        <Stat label="Входов" value="7" note="6 входов и 1 ребай" />
      </Stats>

      <div className="kit-board__players">
        <List aria-label="В игре">
          {ALIVE.map((name) => (
            <ListItem key={name} before={<Icon name="user" size={20} />} title={name} />
          ))}
        </List>
        <List aria-label="Вылетели">
          {OUT.map((player) => (
            <ListItem
              key={player.name}
              before={<Icon name="user-x" size={20} />}
              title={player.name}
              subtitle={player.note}
            />
          ))}
        </List>
      </div>

      <ButtonLink to="/dev/kit" icon="arrow-left">
        Вернуться к киту
      </ButtonLink>
    </main>
  );
}
