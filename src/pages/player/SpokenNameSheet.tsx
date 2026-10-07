import { SPOKEN_NAME_MAX } from '@domain/voice.ts';
import { useState, type FormEvent } from 'react';
import { errorMessage, useSetMySpokenName, useUpsertPlayer, type Player } from '../../shared/api';
import {
  emptySpokenNameNote,
  SPOKEN_NAME_DELAY_NOTE,
  SPOKEN_NAME_HINT,
  spokenNameChanged,
  spokenNameFieldError,
  spokenNameValue,
} from '../../shared/lib';
import { Button, Field, Sheet, useToast } from '../../shared/ui';

interface SpokenNameSheetProps {
  player: Pick<Player, 'id' | 'display_name' | 'spoken_name'>;
  /** self — своё имя (RPC set_my_spoken_name), admin — чужое (форма админа, upsert под RLS). */
  mode: 'self' | 'admin';
  onClose: () => void;
}

/** Имя для озвучки на табло: шторка с полем и одной главной кнопкой. */
export function SpokenNameSheet({ player, mode, onClose }: SpokenNameSheetProps) {
  const saved = player.spoken_name ?? null;
  const [value, setValue] = useState(saved ?? '');
  const [error, setError] = useState<string | null>(null);
  const self = useSetMySpokenName();
  const admin = useUpsertPlayer();
  const pending = self.isPending || admin.isPending;
  const toast = useToast();
  const formId = 'pl-spoken-form';

  const close = () => {
    if (pending) return;
    onClose();
  };

  const done = (name: string | null) => {
    toast.success(name ? 'Имя для озвучки сохранено' : 'Имя для озвучки сброшено', {
      detail: SPOKEN_NAME_DELAY_NOTE,
    });
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = spokenNameFieldError(value);
    if (problem) {
      setError(problem);
      return;
    }
    if (!spokenNameChanged(value, saved)) {
      onClose();
      return;
    }
    const next = spokenNameValue(value);
    if (mode === 'self') {
      self.mutate(next ?? '', {
        onSuccess: done,
        onError: (e) => setError(errorMessage(e)),
      });
    } else {
      // display_name — всегда: без него строка вставки upsert нарушила бы not null.
      admin.mutate(
        { id: player.id, display_name: player.display_name, spoken_name: next },
        { onSuccess: (row) => done(row.spoken_name), onError: (e) => setError(errorMessage(e)) },
      );
    }
  };

  const note =
    value.trim() === '' ? emptySpokenNameNote(player.display_name, mode === 'self') : null;

  return (
    <Sheet
      open
      onClose={close}
      dismissible={!pending}
      title="Имя на табло"
      description={
        mode === 'self'
          ? 'Голос табло объявляет нокауты и победителя. Латиницу он не читает — напиши имя так, как оно звучит.'
          : `Как голос табло называет игрока «${player.display_name}». Латиницу он не читает.`
      }
      actions={
        <Button type="submit" form={formId} variant="primary" block loading={pending}>
          Сохранить имя для озвучки
        </Button>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Field
          label="Имя для озвучки"
          hint={error ? undefined : note ? `${SPOKEN_NAME_HINT}. ${note}` : SPOKEN_NAME_HINT}
          error={error ?? undefined}
          value={value}
          maxLength={SPOKEN_NAME_MAX + 10}
          autoComplete="off"
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
