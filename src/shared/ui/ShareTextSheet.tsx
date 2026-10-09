// Запасной путь «Скопировать расчёт» и «Скопировать отчёт»: окно не дало записать в буфер (WebView без
// доступа к clipboard) — шторка с текстом в поле только для чтения, текст уже выделен: остаётся
// скопировать его жестом системы и вставить в чат. Повтор кнопкой — тот же copyText, а не вышло —
// копирование выделенного текста (execCommand).
import { useEffect, useId } from 'react';
import { copyText } from '../lib/clipboard';
import { Button } from './Button';
import { Field } from './materia';
import { Sheet } from './Sheet';
import { useToast } from './toastContext';

export interface ShareTextSheetProps {
  /** Текст для чата; null — шторка закрыта. */
  text: string | null;
  onClose: () => void;
  title: string;
  /** Тост после копирования: «Расчёт скопирован — вставь его в чат». */
  copiedMessage: string;
}

/** Выделить весь текст поля: select() и диапазон — iOS выделяет только по setSelectionRange. */
function selectAll(id: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTextAreaElement)) return;
  el.focus({ preventScroll: true });
  el.select();
  el.setSelectionRange(0, el.value.length);
}

/**
 * Скопировать выделенный текст старым путём (execCommand): WebView без navigator.clipboard его часто
 * ещё понимает. Нажатие кнопки — жест пользователя, без него браузер откажет. false — не вышло.
 */
function copySelection(id: string): boolean {
  selectAll(id);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

const lineCount = (text: string | null): number => (text ?? '').split('\n').length;

export function ShareTextSheet({ text, onClose, title, copiedMessage }: ShareTextSheetProps) {
  const id = useId();
  const toast = useToast();
  const open = text !== null;

  // Шторка при открытии ставит фокус на себя (эффект родителя идёт после нашего) — выделяем следом.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => selectAll(id), 0);
    return () => window.clearTimeout(timer);
  }, [open, id]);

  const retry = async () => {
    if (text !== null && ((await copyText(text)) || copySelection(id))) {
      toast.show(copiedMessage, { tone: 'positive' });
      onClose();
    } else {
      selectAll(id);
      toast.show('Буфер обмена недоступен в этом окне', {
        tone: 'caution',
        detail: 'Текст выделен — скопируй его жестом телефона.',
      });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description="Скопировать не получилось — текст выделен: скопируй его и вставь в чат."
      actions={
        <Button variant="secondary" icon="copy" block onClick={() => void retry()}>
          Скопировать ещё раз
        </Button>
      }
    >
      <Field
        id={id}
        label="Текст для чата"
        multiline
        readOnly
        value={text ?? ''}
        // Высота — по строкам текста (line-height поля 1,5) с запасом на перенос: от 4 до 14 строк.
        style={{ minHeight: `${Math.min(14, Math.max(4, lineCount(text) + 2)) * 1.5 + 1.5}em` }}
        onFocus={(event) => event.currentTarget.select()}
      />
    </Sheet>
  );
}
