// Единственная точка импорта вендоренной «Материи» (src/vendor/materia, см. scripts/sync-materia.mjs).
// Компоненты, которые кит отдаёт как есть, — реэкспорт без обёрток: API и правила — в карточках
// D:/dev/materia/docs/components/<Имя>.md. Обёрнутые (Button, Card, Stat, Tabs, Segmented, Avatar,
// Icon) живут в соседних файлах.
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
} from '../../vendor/materia/materia.mjs';

// Обёрнутые китом — под префиксом Materia*, наружу из index.ts не уходят.
export {
  Card as MateriaCard,
  Icon as MateriaIcon,
  Segmented as MateriaSegmented,
  Stat as MateriaStat,
  Tabs as MateriaTabs,
} from '../../vendor/materia/materia.mjs';

export type {
  AccordionProps,
  BadgeProps,
  BarListProps,
  CheckboxProps,
  DataTableColumn,
  DataTableProps,
  DialogProps,
  EmptyStateProps,
  FieldProps,
  IconName as MateriaIconName,
  MenuProps,
  NoticeProps,
  ProgressProps,
  RadioGroupProps,
  Register,
  SelectProps,
  SkeletonProps,
  SpinnerProps,
  StatGroupProps,
  SwitchProps,
  ToastProps,
  ToastRegionProps,
  TooltipProps,
  CardProps as MateriaCardProps,
  SegmentedProps as MateriaSegmentedProps,
  StatProps as MateriaStatProps,
  TabsProps as MateriaTabsProps,
} from '../../vendor/materia/materia.mjs';

import type { BadgeProps } from '../../vendor/materia/materia.mjs';

/** Тон бейджа: neutral, accent (признак бренда, не статус), positive, caution, critical. */
export type Tone = NonNullable<BadgeProps['tone']>;
