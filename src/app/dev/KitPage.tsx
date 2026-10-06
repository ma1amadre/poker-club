// ТОЛЬКО ДЛЯ РАЗРАБОТКИ: витрина UI-кита на «Материи» — /#/dev/kit. Маршрут и lazy-импорт есть
// только под import.meta.env.DEV (src/app/routes.tsx), в прод-сборку не попадает. Данные — пример.
import { useState } from 'react';
import { formatRub } from '../../shared/lib';
import {
  Accordion,
  Amount,
  Avatar,
  AvatarGroup,
  Badge,
  BarList,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Confirm,
  DataTable,
  Dialog,
  Empty,
  ErrorView,
  Field,
  FieldGroup,
  Icon,
  ICON_NAMES,
  IconButton,
  List,
  ListItem,
  Menu,
  Notice,
  Page,
  PlayerPicker,
  Progress,
  RadioGroup,
  Section,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  Stat,
  StatGroup,
  Stats,
  Switch,
  Tabs,
  useToast,
} from '../../shared/ui';
import { useThemeOverride, type AppTheme } from '../useTheme';
import './kit.css';

const PLAYERS = [
  { id: 'p1', display_name: 'Женя Смирнов' },
  { id: 'p2', display_name: 'Саша' },
  { id: 'p3', display_name: 'Миша Котов' },
  { id: 'p4', display_name: 'Оля' },
  { id: 'p5', display_name: 'Дима Белов' },
  { id: 'p6', display_name: 'Гость Костя' },
];

const STANDINGS = [
  { id: 1, place: 1, name: 'Женя Смирнов', points: '24,5', played: 6, net: 3500 },
  { id: 2, place: 2, name: 'Оля', points: '19', played: 5, net: 900 },
  { id: 3, place: 3, name: 'Саша', points: '15,5', played: 6, net: -1200 },
  { id: 4, place: 4, name: 'Миша Котов', points: '12', played: 4, net: 0 },
];

function TypeSample() {
  return (
    <Section
      title="Роли текста"
      footer="m-display — один на экран; цифры в метриках и таблицах — m-mono."
    >
      <Card>
        <p className="m-eyebrow">Вечер · четверг, 8 октября</p>
        <p className="m-display">Финальный стол</p>
        <p className="m-h1">Рейтинг сезона</p>
        <p className="m-h2">Итоги вечера</p>
        <p className="m-h3">Ближайший вечер</p>
        <p className="m-body">
          Вход и ребай — по 500 ₽, из каждого взноса 100 ₽ уходит «за голову». Ребаи открыты до
          конца 5-го уровня.
        </p>
        <p className="m-small">Обновлено в 21:40 · 6 игроков</p>
        <p className="m-figure">{formatRub(4000)}</p>
        <p className="m-mono">25/50 · 40:00 · 1 500 фишек</p>
      </Card>
    </Section>
  );
}

function Buttons() {
  const [loading, setLoading] = useState(false);
  return (
    <Section title="Кнопки" footer="Одна primary на экран; подпись — глагол и объект.">
      <div className="kit-row">
        <Button variant="primary" icon="play">
          Начать вечер
        </Button>
        <Button icon="user-plus">Записать ребай</Button>
        <Button variant="ghost">Отмена</Button>
        <Button variant="danger" icon="user-x">
          Отметить вылет
        </Button>
      </div>
      <div className="kit-row">
        <Button size="sm">Открыть</Button>
        <Button size="lg" iconAfter="arrow-right">
          Перейти к расчёту
        </Button>
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1500);
          }}
        >
          Сохранить формат
        </Button>
        <Button disabled>Закрыть ребаи</Button>
      </div>
      <div className="kit-row">
        <IconButton label="Назад" icon="arrow-left" />
        <IconButton label="Ещё" icon="more-horizontal" variant="secondary" />
        <IconButton label="Пауза" icon="pause" size="lg" variant="secondary" />
        <ButtonLink to="/dev/kit-yantar" iconAfter="arrow-right">
          Открыть табло в Янтаре
        </ButtonLink>
      </div>
      <Button block icon="flag">
        Завершить вечер
      </Button>
    </Section>
  );
}

function StatusSample() {
  return (
    <Section title="Статусы и деньги">
      <div className="kit-row">
        <Badge>Гость</Badge>
        <Badge tone="accent">Банкир</Badge>
        <Badge tone="positive" dot>
          Идёт игра
        </Badge>
        <Badge tone="caution" dot>
          Пауза
        </Badge>
        <Badge tone="critical" dot>
          Должен
        </Badge>
      </div>
      <div className="kit-row">
        <Amount value={1500} />
        <Amount value={-300} />
        <Amount value={0} />
        <Amount value={2400} icon />
        <Amount value={-1200} icon />
      </div>
      <Notice tone="info" title="Ребаи открыты до конца 5-го уровня">
        Сейчас 3-й уровень, до закрытия — 2 уровня.
      </Notice>
      <Notice tone="positive" title="Расчёт закрыт">
        Все 6 игроков рассчитались с банкиром.
      </Notice>
      <Notice
        tone="caution"
        title="Банкир не назначен"
        action={<Button size="sm">Назначить</Button>}
      >
        Без банкира пульт вечера недоступен.
      </Notice>
      <Notice tone="critical" title="Событие не записано">
        Нет связи с сервером. Проверь интернет и повтори действие.
      </Notice>
      <Progress label="Расчёт" value={4} max={6} valueText="4 из 6 игроков" showValue />
      <Progress label="Синхронизация журнала" />
      <div className="kit-row">
        <Spinner />
        <Spinner size={28} label="Загрузка вечера" />
      </div>
      <div className="kit-skeleton" aria-busy="true" aria-label="Пример заглушки">
        <Skeleton circle width={40} height={40} />
        <div className="kit-skeleton__text">
          <Skeleton width="60%" height={12} />
          <Skeleton width="35%" height={10} />
        </div>
      </div>
    </Section>
  );
}

function FormsSample() {
  const [picked, setPicked] = useState<string[]>(['p2']);
  const [killers, setKillers] = useState<string[]>([]);
  const [rsvp, setRsvp] = useState('yes');
  return (
    <Section title="Формы">
      <Card>
        <Field
          label="Имя в клубе"
          defaultValue="Женя"
          hint="1–40 символов. Видно всем участникам."
        />
        <Field label="Взнос" inputMode="numeric" defaultValue="500" suffix="₽" />
        <Field label="Подпись к голосу" multiline placeholder="Флеш на ривере против сета" />
        <Field label="Место" defaultValue="" error="Укажи адрес — его увидят в анонсе." />
        <Select
          label="Формат"
          defaultValue="club"
          options={[
            { value: 'club', label: 'Клубный: 500 ₽, уровни по 40 мин' },
            { value: 'turbo', label: 'Турбо: уровни по 20 мин' },
          ]}
        />
        <Switch
          label="Напоминать о вечере"
          description="Пост в группе за 48 ч до игры."
          defaultChecked
        />
        <Checkbox label="Сплит-нокаут" description="Голова делится между выбившими поровну." />
        <RadioGroup
          label="Придёшь в четверг?"
          value={rsvp}
          onChange={setRsvp}
          orientation="horizontal"
          options={[
            { value: 'yes', label: 'Приду' },
            { value: 'maybe', label: 'Не знаю' },
            { value: 'no', label: 'Не приду' },
          ]}
        />
      </Card>
      <FieldGroup label="Кто вылетел" hint="Один игрок; тап по другому меняет выбор.">
        <PlayerPicker
          players={PLAYERS}
          value={picked}
          onChange={setPicked}
          disabledIds={['p6']}
          hints={{ p6: 'вылетел' }}
        />
      </FieldGroup>
      <FieldGroup
        label="Кто выбил"
        error={
          killers.length === 0
            ? 'Выбери хотя бы одного игрока или оставь голову сиротской.'
            : undefined
        }
      >
        <PlayerPicker players={PLAYERS.slice(0, 5)} value={killers} onChange={setKillers} max={3} />
      </FieldGroup>
    </Section>
  );
}

function NavigationSample() {
  const [period, setPeriod] = useState<'season' | 'all'>('season');
  return (
    <Section title="Вкладки и переключатели">
      <Segmented
        label="Период"
        block
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'season', label: 'Сезон' },
          { value: 'all', label: 'Всё время' },
        ]}
      />
      <Tabs
        label="Рейтинг"
        tabs={[
          {
            id: 'season',
            label: 'Сезон',
            count: 4,
            content: (
              <DataTable
                caption="Сезон 2026-Q4 · лучшие 10 вечеров"
                columns={[
                  { key: 'place', label: '№', numeric: true },
                  { key: 'name', label: 'Игрок' },
                  { key: 'points', label: 'Очки', numeric: true },
                  { key: 'played', label: 'Вечеров', numeric: true },
                  {
                    key: 'net',
                    label: 'Деньги, ₽',
                    numeric: true,
                    render: (value: number) => <Amount value={value} />,
                  },
                ]}
                rows={STANDINGS}
              />
            ),
          },
          {
            id: 'money',
            label: 'Деньги',
            content: (
              <BarList
                title="Выигрыш за сезон, ₽"
                items={[
                  { label: 'Женя', value: 3500, display: formatRub(3500) },
                  { label: 'Оля', value: 900, display: formatRub(900) },
                ]}
              />
            ),
          },
          {
            id: 'oracle',
            label: 'Оракул',
            content: <p className="m-body">Прогнозы на победителя.</p>,
          },
          {
            id: 'fame',
            label: 'Зал славы',
            content: <p className="m-body">Чемпионы прошлых сезонов.</p>,
          },
        ]}
      />
      <Accordion
        items={[
          { id: 'ko', title: 'Как считается нокаут', content: 'Каждый выбивший получает +1 KO.' },
          {
            id: 'pts',
            title: 'Как считаются очки',
            content: '(N − место) + 0,5 за KO + 1 за победу.',
          },
        ]}
      />
      <Menu
        label="Ещё"
        items={[
          { label: 'Открыть табло', icon: 'external-link' },
          { label: 'Скопировать ссылку', icon: 'copy' },
          { separator: true },
          { label: 'Отменить вечер', icon: 'trash', danger: true },
        ]}
      />
    </Section>
  );
}

function ContentSample() {
  return (
    <>
      <Section title="Показатели" aside="вечер · 3-й уровень">
        <Card>
          <Stats>
            <Stat label="Фонд" value="2 400" unit="₽" />
            <Stat label="В игре" value="4" unit="из 6" />
            <Stat label="Ребаи" value="3" delta="+1" deltaNote="за уровень" />
            <Stat label="Средний стек" value="1 125" unit="фишек" hint="7 входов по 500 фишек" />
          </Stats>
        </Card>
      </Section>
      <StatGroup
        eyebrow="Сезон · 2026-Q4"
        title="Женя лидирует пятый вечер подряд"
        stats={[
          { label: 'Очки', value: '24,5', delta: '+4,5', deltaNote: 'за вечер' },
          { label: 'Нокауты', value: '11', delta: '+3', deltaNote: 'за вечер' },
          { label: 'Ребаи', value: '2', delta: '−1', good: 'down', deltaNote: 'за вечер' },
        ]}
      />
      <Section
        title="Карточка и список"
        aside={<AvatarGroup people={PLAYERS.map((p) => ({ name: p.display_name }))} />}
      >
        <Card to="/dev/kit" variant="raised">
          <p className="m-eyebrow">Четверг, 8 октября · 19:00</p>
          <p className="m-h3">Ближайший вечер</p>
          <p className="m-small">Идут 5 из 6 · банкир Женя</p>
        </Card>
        <List aria-label="Игроки вечера">
          <ListItem
            before={<Avatar name="Женя Смирнов" />}
            title="Женя Смирнов"
            subtitle="Банкир · 2 KO"
            after={<Amount value={1500} />}
            to="/dev/kit"
          />
          <ListItem
            before={<Avatar name="Саша" />}
            title="Саша"
            subtitle="2 ребая · вылетел на 4-м уровне"
            after={<Badge tone="critical">Должен</Badge>}
            onClick={() => {}}
          />
          <ListItem
            before={<Avatar name="Гость Костя" />}
            title="Гость Костя"
            after={<Badge>Гость</Badge>}
          />
        </List>
        <Card padded={false}>
          <List plain aria-label="Настройки">
            <ListItem
              before={<Icon name="clock" size={20} />}
              title="Время игры"
              after="чт, 19:00"
              chevron
              onClick={() => {}}
            />
            <ListItem
              before={<Icon name="map-pin" size={20} />}
              title="Место"
              after="у Жени"
              chevron
              onClick={() => {}}
            />
          </List>
        </Card>
      </Section>
      <Section title="Пустые состояния">
        <Empty
          icon="calendar"
          title="Назначь первый вечер"
          description="Анонс уйдёт в группу клуба, участники отметятся «Приду»."
          action={<Button icon="plus">Назначить вечер</Button>}
        />
        <Empty
          kind="no-results"
          title="Никто не подходит под фильтр"
          description="Сбрось фильтр «Только гости»."
        />
        <ErrorView error={new Error('Failed to fetch')} onRetry={() => {}} />
      </Section>
    </>
  );
}

function OverlaysSample() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busted, setBusted] = useState<string[]>([]);
  return (
    <Section
      title="Оверлеи и тосты"
      footer="Шторка, подтверждение и тосты закрываются и кнопкой «Назад» Telegram."
    >
      <div className="kit-row">
        <Button icon="user-x" onClick={() => setSheet(true)}>
          Открыть шторку
        </Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Отменить событие
        </Button>
        <Button onClick={() => setDialog(true)}>Открыть диалог</Button>
      </div>
      <div className="kit-row">
        <Button size="sm" onClick={() => toast.show('Уровень 4 начался')}>
          Тост info
        </Button>
        <Button size="sm" onClick={() => toast.success('Ребай записан')}>
          Тост positive
        </Button>
        <Button
          size="sm"
          onClick={() => toast.show('Ребаи закроются через 5 мин', { tone: 'caution' })}
        >
          Тост caution
        </Button>
        <Button size="sm" onClick={() => toast.error(new Error('Failed to fetch'))}>
          Тост critical
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toast.show('Вылет Саши записан', {
              action: { label: 'Отменить', onClick: () => toast.show('Вылет отменён') },
            })
          }
        >
          Тост с действием
        </Button>
      </div>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Вылет игрока"
        description="Уровень 3 · 15/30"
        actions={
          <Button
            variant="primary"
            block
            disabled={busted.length === 0}
            onClick={() => setSheet(false)}
          >
            Отметить вылет
          </Button>
        }
      >
        <PlayerPicker players={PLAYERS} value={busted} onChange={setBusted} label="Кто вылетел" />
      </Sheet>
      <Confirm
        open={confirm}
        danger
        title="Отменить вылет Саши?"
        message="Запись останется в ленте зачёркнутой, места пересчитаются."
        confirmText="Отменить вылет"
        cancelText="Не отменять"
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      />
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Переименовать игрока"
        description="Имя видно в рейтинге и постах бота."
        actions={[
          <Button key="cancel" variant="ghost" onClick={() => setDialog(false)}>
            Отмена
          </Button>,
          <Button key="save" variant="primary" onClick={() => setDialog(false)}>
            Сохранить имя
          </Button>,
        ]}
      >
        <Field label="Имя в клубе" defaultValue="Саша" />
      </Dialog>
    </Section>
  );
}

function IconsSample() {
  return (
    <Section
      title="Иконки"
      aside={`${ICON_NAMES.length} шт.`}
      footer="50 из «Материи» и клубные из Lucide в том же стиле."
    >
      <div className="kit-icons">
        {ICON_NAMES.map((name) => (
          <div key={name} className="kit-icon">
            <Icon name={name} size={20} />
            <span className="m-mono">{name}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function KitPage() {
  const [theme, setTheme] = useState<Extract<AppTheme, 'kobalt' | 'kobalt-dark'>>(() =>
    document.documentElement.dataset.theme === 'kobalt-dark' ? 'kobalt-dark' : 'kobalt',
  );
  useThemeOverride(theme);

  return (
    <Page
      eyebrow="Dev · витрина кита"
      title="Кит на «Материи»"
      subtitle="Регистр — Кобальт. Данные — пример."
    >
      <Segmented
        label="Тема Кобальта"
        block
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'kobalt', label: 'kobalt' },
          { value: 'kobalt-dark', label: 'kobalt-dark' },
        ]}
      />
      <TypeSample />
      <Buttons />
      <StatusSample />
      <FormsSample />
      <NavigationSample />
      <ContentSample />
      <OverlaysSample />
      <IconsSample />
    </Page>
  );
}
