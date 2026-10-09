import { MateriaIcon, type MateriaIconName } from './materia';

// Иконки: 50 штук из Icon «Материи» + недостающие клубу из Lucide (README «Материи», «Иконки»:
// «Остальные берите с lucide.dev в том же стиле»). Отрисовка — Icon.tsx.

export type Shape = readonly [
  tag: 'path' | 'circle' | 'rect' | 'line' | 'polygon' | 'polyline',
  attrs: Readonly<Record<string, string | number>>,
];

/** Контуры Lucide (лицензия ISC). Новые — только из Lucide и только контурные. */
export const EXTRA = {
  home: [
    ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
    [
      'path',
      {
        d: 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      },
    ],
  ],
  trophy: [
    ['path', { d: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6' }],
    ['path', { d: 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18' }],
    ['path', { d: 'M4 22h16' }],
    ['path', { d: 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22' }],
    ['path', { d: 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22' }],
    ['path', { d: 'M18 2H6v7a6 6 0 0 0 12 0V2Z' }],
  ],
  history: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
    ['path', { d: 'M12 7v5l4 2' }],
  ],
  users: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
    ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
  ],
  'user-plus': [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['line', { x1: 19, x2: 19, y1: 8, y2: 14 }],
    ['line', { x1: 22, x2: 16, y1: 11, y2: 11 }],
  ],
  'user-x': [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['line', { x1: 17, x2: 22, y1: 8, y2: 13 }],
    ['line', { x1: 22, x2: 17, y1: 8, y2: 13 }],
  ],
  crown: [
    [
      'path',
      {
        d: 'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z',
      },
    ],
    ['path', { d: 'M5 21h14' }],
  ],
  coins: [
    ['circle', { cx: 8, cy: 8, r: 6 }],
    ['path', { d: 'M18.09 10.37A6 6 0 1 1 10.34 18' }],
    ['path', { d: 'M7 6h1v4' }],
    ['path', { d: 'm16.71 13.88.7.71-2.82 2.82' }],
  ],
  wallet: [
    [
      'path',
      {
        d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
      },
    ],
    ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
  ],
  pause: [
    ['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }],
    ['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }],
  ],
  'skip-forward': [
    ['polygon', { points: '5 4 15 12 5 20 5 4' }],
    ['line', { x1: 19, x2: 19, y1: 5, y2: 19 }],
  ],
  'skip-back': [
    ['polygon', { points: '19 20 9 12 19 4 19 20' }],
    ['line', { x1: 5, x2: 5, y1: 19, y2: 5 }],
  ],
  flag: [
    ['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }],
    ['line', { x1: 4, x2: 4, y1: 22, y2: 15 }],
  ],
  tv: [
    ['rect', { x: 2, y: 7, width: 20, height: 15, rx: 2, ry: 2 }],
    ['polyline', { points: '17 2 12 7 7 2' }],
  ],
  camera: [
    [
      'path',
      {
        d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z',
      },
    ],
    ['circle', { cx: 12, cy: 13, r: 3 }],
  ],
  'volume-2': [
    [
      'path',
      {
        d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
      },
    ],
    ['path', { d: 'M16 9a5 5 0 0 1 0 6' }],
    ['path', { d: 'M19.364 18.364a9 9 0 0 0 0-12.728' }],
  ],
  'volume-x': [
    [
      'path',
      {
        d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
      },
    ],
    ['line', { x1: 22, x2: 16, y1: 9, y2: 15 }],
    ['line', { x1: 16, x2: 22, y1: 9, y2: 15 }],
  ],
  star: [
    [
      'polygon',
      {
        points:
          '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2',
      },
    ],
  ],
  // Ачивка «Охота на короля» (решение клуба 08.10.2026).
  crosshair: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 22, x2: 18, y1: 12, y2: 12 }],
    ['line', { x1: 6, x2: 2, y1: 12, y2: 12 }],
    ['line', { x1: 12, x2: 12, y1: 6, y2: 2 }],
    ['line', { x1: 12, x2: 12, y1: 22, y2: 18 }],
  ],
  // «Проверка устройства»: микрофон и распознавание речи.
  mic: [
    ['path', { d: 'M12 19v3' }],
    ['path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }],
    ['rect', { x: 9, y: 2, width: 6, height: 13, rx: 3 }],
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type ExtraIconName = keyof typeof EXTRA;
/** Имена иконок кита: все из «Материи» (MateriaIconName) + клубные из Lucide (ExtraIconName). */
export type IconName = MateriaIconName | ExtraIconName;

export function isExtra(name: string): name is ExtraIconName {
  return Object.hasOwn(EXTRA, name);
}

/** Все имена — для витрины кита. */
export const ICON_NAMES: readonly IconName[] = [
  ...((MateriaIcon as unknown as { names?: MateriaIconName[] }).names ?? []),
  ...(Object.keys(EXTRA) as ExtraIconName[]),
];
