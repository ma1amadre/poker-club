// Формат турнира: клубный пресет и проверка формата, который админ правит руками (jsonb в formats).
import type { BlindLevel, TournamentFormat } from './types.ts';

const level40 = (sb: number, bb: number): BlindLevel => ({
  sb,
  bb,
  trigger: { type: 'time', minutes: 40 },
});

/** Клубный формат: 500 ₽ = 500 фишек, весь взнос в фонд, ребаи до конца 5-го уровня (3:20) без лимита. */
export const DEFAULT_FORMAT: TournamentFormat = {
  name: 'Клубный',
  buyInRub: 500,
  startingChips: 500,
  rebuyUntilLevel: 5,
  rebuyLimit: null,
  payoutPct: [70, 30],
  levels: [
    level40(5, 10),
    level40(10, 20),
    level40(15, 30),
    level40(20, 40),
    level40(25, 50),
    level40(50, 100),
    level40(75, 150),
    level40(100, 200),
  ],
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Проверяет формат. Принимает unknown, потому что формат приходит из jsonb и формы админа.
 * Возвращает список ошибок по-русски; пустой список — формат годен.
 * Суммы в рублях — целые: деньги делим только в целых рублях, иначе инвариант
 * «выплаты = взносы» перестаёт быть точным.
 * Лишние ключи не мешают: bountyRub из форматов до отмены баунти (07.10.2026) молча игнорируется.
 */
export function validateFormat(format: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(format)) return ['Формат должен быть объектом'];
  const f = format;

  if (typeof f.name !== 'string' || f.name.trim() === '') errors.push('Не задано название формата');
  if (!isInt(f.buyInRub) || f.buyInRub <= 0)
    errors.push('Вход должен быть целым числом рублей больше 0');
  if (!isInt(f.startingChips) || f.startingChips <= 0)
    errors.push('Стартовый стек должен быть целым числом больше 0');
  if (!isInt(f.rebuyUntilLevel) || f.rebuyUntilLevel < 0)
    errors.push('Уровень закрытия ребаев должен быть целым числом не меньше 0');
  if (f.rebuyLimit !== null && (!isInt(f.rebuyLimit) || f.rebuyLimit < 0))
    errors.push('Лимит ребаев — целое число не меньше 0 или null (без лимита)');

  if (!Array.isArray(f.payoutPct) || f.payoutPct.length === 0) {
    errors.push('Нужно хотя бы одно призовое место');
  } else {
    const pcts: unknown[] = f.payoutPct;
    if (!pcts.every((p) => typeof p === 'number' && Number.isFinite(p) && p > 0))
      errors.push('Доли призовых должны быть положительными числами');
    else {
      const sum = (pcts as number[]).reduce((a, b) => a + b, 0);
      // Допуск на дробные доли вида 33.3/33.3/33.4.
      if (Math.abs(sum - 100) > 1e-9)
        errors.push(`Сумма долей призовых должна быть 100%, сейчас ${sum}%`);
    }
  }

  if (!Array.isArray(f.levels) || f.levels.length === 0) {
    errors.push('Нужен хотя бы один уровень блайндов');
  } else {
    (f.levels as unknown[]).forEach((lv, i) => {
      const n = i + 1;
      if (!isObj(lv)) {
        errors.push(`Уровень ${n}: неверная запись`);
        return;
      }
      if (!isInt(lv.sb) || lv.sb < 0)
        errors.push(`Уровень ${n}: малый блайнд — целое число не меньше 0`);
      if (!isInt(lv.bb) || lv.bb <= 0)
        errors.push(`Уровень ${n}: большой блайнд — целое число больше 0`);
      if (isInt(lv.sb) && isInt(lv.bb) && lv.sb > lv.bb)
        errors.push(`Уровень ${n}: малый блайнд больше большого`);
      if (lv.ante !== undefined && (!isInt(lv.ante) || lv.ante < 0))
        errors.push(`Уровень ${n}: анте — целое число не меньше 0`);
      const t = lv.trigger;
      if (!isObj(t)) {
        errors.push(`Уровень ${n}: не задан триггер смены уровня`);
      } else if (t.type === 'time') {
        if (!isInt(t.minutes) || t.minutes <= 0)
          errors.push(`Уровень ${n}: длительность — целое число минут больше 0`);
      } else if (t.type === 'eliminations' || t.type === 'hands') {
        if (!isInt(t.count) || t.count <= 0)
          errors.push(`Уровень ${n}: число для триггера должно быть больше 0`);
      } else {
        errors.push(`Уровень ${n}: неизвестный триггер`);
      }
    });
  }
  return errors;
}
