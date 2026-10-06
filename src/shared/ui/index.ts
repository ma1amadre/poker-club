// UI-кит клуба на дизайн-системе «Материя» (src/vendor/materia). Регистр — на <html data-theme>
// (src/app/useTheme.ts): kobalt / kobalt-dark, табло — yantar. Свои стили кита — ui.css, только на
// переменных «Материи». Карточки компонентов «Материи»: D:/dev/materia/docs/components/<Имя>.md.
//
// Текст вне компонентов — классы ролей «Материи»: m-display (один на экран), m-h1, m-h2, m-h3,
// m-body, m-small, m-eyebrow, m-figure, m-mono (табличные цифры), m-link.
import './ui.css';

// --- Из «Материи» как есть ---
export {
  Accordion,
  Badge,
  BarList,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Menu,
  Notice,
  Progress,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  StatGroup,
  Switch,
  Toast,
  ToastRegion,
  Tooltip,
  type AccordionProps,
  type BadgeProps,
  type BarListProps,
  type CheckboxProps,
  type DataTableColumn,
  type DataTableProps,
  type DialogProps,
  type EmptyStateProps,
  type FieldProps,
  type MateriaIconName,
  type MenuProps,
  type NoticeProps,
  type ProgressProps,
  type RadioGroupProps,
  type Register,
  type SelectProps,
  type SkeletonProps,
  type SpinnerProps,
  type StatGroupProps,
  type SwitchProps,
  type Tone,
  type ToastProps,
  type ToastRegionProps,
  type TooltipProps,
} from './materia';

// --- Обёртки над «Материей» (её анатомия и классы + то, что нужно клубу) ---
export { Amount, type AmountProps } from './Amount';
export {
  Avatar,
  AvatarGroup,
  type AvatarGroupProps,
  type AvatarProps,
  type AvatarSize,
} from './Avatar';
export {
  Button,
  ButtonLink,
  IconButton,
  type ButtonLinkProps,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonProps,
} from './Button';
export { Confirm, type ConfirmOptions, type ConfirmProps } from './Confirm';
export { Empty, ErrorView, type EmptyProps, type ErrorViewProps } from './Empty';
export { FieldGroup, type FieldGroupProps } from './Field';
export { Icon, type IconProps } from './Icon';
export { ICON_NAMES, type ExtraIconName, type IconName } from './icons';
export { Card, Section, type CardProps, type SectionProps } from './Section';
export { PageSkeleton, PageSpinner, type PageSkeletonProps } from './Spinner';
export { Stat, Stats, type StatProps } from './Stat';
export {
  Segmented,
  Tabs,
  type SegmentedOption,
  type SegmentedProps,
  type TabItem,
  type TabsProps,
} from './Tabs';
export { ToastProvider } from './Toast';
export { useToast, type ToastApi, type ToastOptions, type ToastTone } from './toastContext';
export { useConfirm } from './useConfirm';

// --- Своё, чего в «Материи» нет (из её токенов и ролей) ---
export { EveningStatusBadge, type EveningStatusBadgeProps } from './EveningStatusBadge';
export { BottomNav, type BottomNavItem, type BottomNavProps } from './BottomNav';
export { List, ListItem, type ListItemProps, type ListProps } from './List';
export { Page, type PageProps } from './Page';
export { PlayerPicker, type PickerPlayer, type PlayerPickerProps } from './PlayerPicker';
export { Sheet, type SheetProps } from './Sheet';
