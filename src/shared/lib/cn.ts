/** Склейка CSS-классов с пропуском пустых значений: cn('a', on && 'b'). */
export function cn(...classes: Array<string | false | null | undefined | 0>): string {
  return classes.filter(Boolean).join(' ');
}
