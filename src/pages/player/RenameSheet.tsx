import { useState, type FormEvent } from 'react';
import { errorMessage, useSetMyName } from '../../shared/api';
import { Button, Field, Sheet, useToast } from '../../shared/ui';
import { nameError } from './name';
import { NAME_MAX, normalizeName } from '../../shared/lib';

interface RenameSheetProps {
  open: boolean;
  currentName: string;
  onClose: () => void;
}

/** Смена своего имени (RPC set_my_name): шторка с полем и одной главной кнопкой. */
export function RenameSheet({ open, currentName, onClose }: RenameSheetProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetMyName();
  const toast = useToast();
  const formId = 'pl-rename-form';

  const close = () => {
    if (mutation.isPending) return;
    setError(null);
    setValue(currentName);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = nameError(value, currentName);
    if (problem) {
      setError(problem);
      return;
    }
    const name = normalizeName(value);
    mutation.mutate(name, {
      onSuccess: () => {
        toast.success('Имя изменено', { detail: `Теперь в клубе ты — ${name}` });
        setError(null);
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      dismissible={!mutation.isPending}
      title="Имя в клубе"
      description="Его видят все участники: в рейтинге, на вечерах и в постах бота."
      actions={
        <Button type="submit" form={formId} variant="primary" block loading={mutation.isPending}>
          Сохранить имя
        </Button>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Field
          label="Имя"
          hint={error ? undefined : `От 1 до ${NAME_MAX} символов`}
          error={error ?? undefined}
          value={value}
          maxLength={NAME_MAX + 10}
          autoComplete="nickname"
          enterKeyHint="done"
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
      </form>
    </Sheet>
  );
}
