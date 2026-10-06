// Материя 2.0.0 — вендорено scripts/sync-materia.mjs из D:/dev/materia. Руками не править.
import type * as React from 'react';

/** Регистр задаётся атрибутом data-theme на <html> или на контейнере: 'kobalt' | 'kobalt-dark' | 'farfor' | 'yantar'. Компоненты подстраиваются сами. */
export type Register = 'kobalt' | 'kobalt-dark' | 'farfor' | 'yantar';

export type IconName =
  | 'arrow-right' | 'arrow-up-right' | 'check' | 'x' | 'plus' | 'info' | 'check-circle' | 'alert-circle' | 'alert-triangle' | 'trending-up' | 'trending-down' | 'play' | 'download' | 'search' | 'clock' | 'layers' | 'shield' | 'zap' | 'arrow-left' | 'chevron-down' | 'chevron-up' | 'chevron-left' | 'chevron-right' | 'menu' | 'more-horizontal' | 'minus' | 'inbox' | 'search-x' | 'user' | 'mail' | 'map-pin' | 'calendar' | 'truck' | 'rotate-ccw' | 'shield-check' | 'credit-card' | 'bell' | 'external-link' | 'pencil' | 'copy' | 'trash' | 'log-out' | 'filter' | 'refresh-cw' | 'sliders' | 'upload' | 'eye' | 'globe' | 'file' | 'send';

/** Контурная иконка 24×24, цвет — currentColor. Без label скрыта от скринридеров. */
export interface IconProps { name: IconName; size?: number; strokeWidth?: number; label?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

/** Кнопка. primary — не больше одной на экран. С href рендерится ссылкой. */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconAfter?: IconName;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
}
export declare function Button(props: ButtonProps): React.ReactElement;

/** Статус в одно-два слова. Тон никогда не единственный носитель смысла — текст обязателен. */
export interface BadgeProps { tone?: 'neutral' | 'accent' | 'positive' | 'caution' | 'critical'; dot?: boolean; children?: React.ReactNode; className?: string }
export declare function Badge(props: BadgeProps): React.ReactElement;

/** Поле ввода с подписью, подсказкой и ошибкой. Остальные пропсы уходят в <input>/<textarea>. */
export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  multiline?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}
export declare function Field(props: FieldProps): React.ReactElement;

/** Переключатель 2–5 взаимоисключающих вариантов (вид, период, фильтр). Управляемый через value/onChange или неуправляемый. */
export interface SegmentedProps {
  options: { value: string; label: React.ReactNode }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label?: string;
  className?: string;
}
export declare function Segmented(props: SegmentedProps): React.ReactElement;

/** Сообщение в потоке страницы: иконка + заголовок + текст + необязательное действие. */
export interface NoticeProps { tone?: 'info' | 'positive' | 'caution' | 'critical'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }
export declare function Notice(props: NoticeProps): React.ReactElement;

/** Отдельный объект: тариф, проект, статья. С href — вся карточка кликабельна. */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  variant?: 'outline' | 'raised' | 'sunken';
  padding?: 'md' | 'lg';
  href?: string;
  as?: keyof React.JSX.IntrinsicElements;
  media?: React.ReactNode;
}
export declare function Card(props: CardProps): React.ReactElement;

/** Метрика: подпись, число, единица, изменение. good — какое направление хорошее (для задержки — 'down'). */
export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: string;
  deltaNote?: React.ReactNode;
  trend?: 'up' | 'down';
  good?: 'up' | 'down';
  note?: React.ReactNode;
  className?: string;
}
export declare function Stat(props: StatProps): React.ReactElement;

/** Таблица данных: числовые колонки выравниваются вправо моноширинным. */
export interface DataTableColumn<R = any> { key: string; label: React.ReactNode; numeric?: boolean; render?: (value: any, row: R) => React.ReactNode }
export interface DataTableProps<R = any> { columns: DataTableColumn<R>[]; rows: R[]; caption?: React.ReactNode; className?: string }
export declare function DataTable<R = any>(props: DataTableProps<R>): React.ReactElement;

/** Цитата или отзыв. Кавычки «ёлочки» пишутся в тексте. */
export interface QuoteProps { children: React.ReactNode; author?: React.ReactNode; role?: React.ReactNode; className?: string }
export declare function Quote(props: QuoteProps): React.ReactElement;

/** Первый экран: надзаголовок, заголовок-тезис, лид, действия, строка фактов, медиа справа. */
export interface HeroProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  media?: React.ReactNode;
  layout?: 'stack' | 'split';
  className?: string;
}
export declare function Hero(props: HeroProps): React.ReactElement;

/** Список преимуществ или шагов. ordered — только для настоящей последовательности. */
export interface FeatureListProps {
  items: { title: React.ReactNode; text?: React.ReactNode; icon?: IconName; meta?: React.ReactNode }[];
  columns?: 2 | 3;
  ordered?: boolean;
  className?: string;
}
export declare function FeatureList(props: FeatureListProps): React.ReactElement;

/** Тариф. featured — у одного тарифа из ряда. cta — обычно <Button>. */
export interface PriceCardProps {
  name: React.ReactNode;
  price: React.ReactNode;
  period?: React.ReactNode;
  note?: React.ReactNode;
  features?: React.ReactNode[];
  badge?: React.ReactNode;
  featured?: boolean;
  cta?: React.ReactNode;
  className?: string;
}
export declare function PriceCard(props: PriceCardProps): React.ReactElement;

/** Верхняя навигация сайта или приложения. */
export interface NavBarProps {
  brand: React.ReactNode;
  links?: { label: React.ReactNode; href?: string; current?: boolean }[];
  actions?: React.ReactNode;
  label?: string;
  /** Мобильная раскладка на любой ширине: ссылки прячутся под кнопку меню. На экранах ≤ 720 px включается сама. */
  compact?: boolean;
  defaultOpen?: boolean;
  className?: string;
}
export declare function NavBar(props: NavBarProps): React.ReactElement;

/** Слайд 16:9. Типографика масштабируется от ширины слайда (container queries). */
export interface SlideProps {
  layout?: 'title' | 'statement' | 'content';
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  number?: number;
  total?: number;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}
export declare function Slide(props: SlideProps): React.ReactElement;

/* ── 2.0 ─────────────────────────────────────────────────────── */

/** Раскрывающиеся секции: FAQ, условия, детали. multiple — несколько открытых сразу. */
export interface AccordionProps {
  items: { id?: string; title: React.ReactNode; content: React.ReactNode }[];
  defaultOpen?: string[];
  multiple?: boolean;
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
}
export declare function Accordion(props: AccordionProps): React.ReactElement;

/** Флажок: нативный input, своя отрисовка. indeterminate — «выбрано частично». */
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
  error?: boolean;
}
export declare function Checkbox(props: CheckboxProps): React.ReactElement;

/** Группа радиокнопок в fieldset с legend. */
export interface RadioGroupProps {
  label?: React.ReactNode;
  name?: string;
  options: { value: string; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}
export declare function RadioGroup(props: RadioGroupProps): React.ReactElement;

/** Переключатель с мгновенным эффектом (role="switch"). Если нужно подтверждение — Checkbox. */
export interface SwitchProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}
export declare function Switch(props: SwitchProps): React.ReactElement;

/** Выбор из списка — нативный <select> в коробке Field. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  placeholder?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}
export declare function Select(props: SelectProps): React.ReactElement;

/** Вкладки: переключение видов одного объекта. Стрелки, Home, End. */
export interface TabsProps {
  tabs: { id: string; label: React.ReactNode; count?: React.ReactNode; content: React.ReactNode }[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  label?: string;
  className?: string;
}
export declare function Tabs(props: TabsProps): React.ReactElement;

/** Подсказка к элементу: по наведению (задержка 400 мс) и по фокусу. Только текст, без ссылок и кнопок. */
export interface TooltipProps { content: React.ReactNode; children: React.ReactElement; side?: 'top' | 'bottom'; delay?: number; open?: boolean; className?: string }
export declare function Tooltip(props: TooltipProps): React.ReactElement;

/** Модальное окно: ловушка фокуса, Esc, возврат фокуса. alert — для подтверждения опасного действия. */
export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  alert?: boolean;
  dismissible?: boolean;
  autoFocus?: boolean;
  inline?: boolean;
  className?: string;
}
export declare function Dialog(props: DialogProps): React.ReactElement | null;

/** Меню действий по кнопке. Для выбора значения в форме — Select. */
export interface MenuProps {
  label?: string;
  items: ({ label: React.ReactNode; icon?: IconName; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect?: () => void } | { separator: true })[];
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  icon?: IconName;
  align?: 'start' | 'end';
  open?: boolean;
  className?: string;
}
export declare function Menu(props: MenuProps): React.ReactElement;

/** Всплывающее уведомление. Живёт в ToastRegion; закрытие и таймер — у потребителя. */
export interface ToastProps { tone?: 'info' | 'positive' | 'caution' | 'critical'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; onClose?: () => void; className?: string }
export declare function Toast(props: ToastProps): React.ReactElement;
export interface ToastRegionProps { position?: 'bottom-end' | 'top-end' | 'bottom-start'; label?: string; inline?: boolean; children?: React.ReactNode; className?: string }
export declare function ToastRegion(props: ToastRegionProps): React.ReactElement;

/** Постраничная навигация. total — число страниц. */
export interface PaginationProps { total: number; page?: number; defaultPage?: number; onChange?: (page: number) => void; siblings?: number; label?: string; className?: string }
export declare function Pagination(props: PaginationProps): React.ReactElement;

/** Навигационная цепочка. Последний пункт — текущая страница, не ссылка. */
export interface BreadcrumbsProps { items: { label: React.ReactNode; href?: string }[]; label?: string; className?: string }
export declare function Breadcrumbs(props: BreadcrumbsProps): React.ReactElement;

/** Аватар: фото или инициалы. Группа — с «+N». */
export interface AvatarProps { name?: string; src?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }
export declare function Avatar(props: AvatarProps): React.ReactElement;
export interface AvatarGroupProps { people: { name: string; src?: string }[]; max?: number; size?: 'sm' | 'md' | 'lg' | 'xl'; label?: string; className?: string }
export declare function AvatarGroup(props: AvatarGroupProps): React.ReactElement;

/** Заглушка загрузки. Контейнеру поставьте aria-busy="true". */
export interface SkeletonProps { width?: string | number; height?: string | number; lines?: number; circle?: boolean; className?: string }
export declare function Skeleton(props: SkeletonProps): React.ReactElement;

/** Прогресс: без value — неопределённый. */
export interface ProgressProps { value?: number; max?: number; label?: React.ReactNode; showValue?: boolean; valueText?: string; tone?: 'positive' | 'caution' | 'critical'; className?: string }
export declare function Progress(props: ProgressProps): React.ReactElement;
export interface SpinnerProps { size?: number; label?: string; className?: string }
export declare function Spinner(props: SpinnerProps): React.ReactElement;

/** Пустое состояние: zero — ещё ничего нет, no-results — фильтр ничего не нашёл, error — не удалось загрузить. */
export interface EmptyStateProps { kind?: 'zero' | 'no-results' | 'error'; icon?: IconName; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; secondaryAction?: React.ReactNode; className?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

/** Полоса объявления над навигацией. */
export interface AnnouncementProps { children: React.ReactNode; href?: string; linkLabel?: string; onClose?: () => void; label?: string; className?: string }
export declare function Announcement(props: AnnouncementProps): React.ReactElement;

/** Строка логотипов клиентов. Без src — название текстом; логотипы не рисуем. */
export interface LogoStripProps { title?: React.ReactNode; logos: { name: string; src?: string }[]; marquee?: boolean; label?: string; className?: string }
export declare function LogoStrip(props: LogoStripProps): React.ReactElement;

/** Бегущая строка крупным шрифтом заголовков. Останавливается при наведении и при reduced motion. */
export interface MarqueeProps { items: string[]; separator?: string; size?: 'sm' | 'md' | 'lg'; label?: string; className?: string }
export declare function Marquee(props: MarqueeProps): React.ReactElement;

/** Полоса коротких гарантий: доставка, возврат, поддержка. */
export interface TrustBarProps { items: { title: React.ReactNode; text?: React.ReactNode; icon?: IconName }[]; className?: string }
export declare function TrustBar(props: TrustBarProps): React.ReactElement;

/** Раздел с группой метрик и общим заголовком-выводом. */
export interface StatGroupProps { eyebrow?: React.ReactNode; title?: React.ReactNode; lede?: React.ReactNode; stats: StatProps[]; className?: string }
export declare function StatGroup(props: StatGroupProps): React.ReactElement;

/** Подписка на рассылку: проверка адреса, состояние «готово». */
export interface SubscribeProps { title?: React.ReactNode; text?: React.ReactNode; label?: string; placeholder?: string; button?: React.ReactNode; legal?: React.ReactNode; doneText?: React.ReactNode; onSubmit?: (email: string) => void; className?: string }
export declare function Subscribe(props: SubscribeProps): React.ReactElement;

/** Подвал: full — марка и колонки ссылок; minimal — одна строка. */
export interface FooterProps {
  variant?: 'full' | 'minimal';
  brand: React.ReactNode;
  tagline?: React.ReactNode;
  extra?: React.ReactNode;
  columns?: { title: React.ReactNode; links: { label: React.ReactNode; href?: string }[] }[];
  legal?: React.ReactNode;
  bottom?: React.ReactNode;
  className?: string;
}
export declare function Footer(props: FooterProps): React.ReactElement;

/** Горизонтальные полосы одного ряда с прямыми подписями значений. Цвет — chart-1. */
export interface BarListProps { title?: React.ReactNode; items: { label: React.ReactNode; value: number; display?: React.ReactNode }[]; max?: number; className?: string }
export declare function BarList(props: BarListProps): React.ReactElement;
