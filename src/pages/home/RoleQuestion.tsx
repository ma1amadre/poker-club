// Вопрос «Играешь или следишь?» (миграция 024) — пока человек не выбрал (players.is_spectator = null).
// Ненавязчивый: карточка в потоке главной, а не шторка. Закрыть — остаться игроком (так считается и
// без ответа); второй раз вопрос не появится ни на этом устройстве, ни на другом: ответ хранит сервер.
// Поменять решение — в своей карточке.
import { useId, useState } from 'react';
import { useSetMySpectator } from '../../shared/api';
import { SPECTATOR_NOTE } from '../../shared/lib';
import { Button, Card, IconButton, useToast } from '../../shared/ui';

type Choice = 'play' | 'watch' | 'close';

export function RoleQuestion() {
  const titleId = useId();
  const save = useSetMySpectator();
  const toast = useToast();
  const [choice, setChoice] = useState<Choice | null>(null);

  const choose = (next: Choice) => {
    setChoice(next);
    const spectator = next === 'watch';
    save.mutate(spectator, {
      onSuccess: () => {
        if (next === 'close') return;
        toast.success(spectator ? 'Ты болельщик клуба' : 'Ты в составе игроков', {
          detail: spectator
            ? 'Бот не будет звать тебя на каждую игру. Соберёшься сыграть — отметь «Иду» в анонсе.'
            : 'Если не ответишь на анонс, бот позовёт тебя в день игры.',
        });
      },
    });
  };
  const busy = save.isPending;

  return (
    <Card variant="sunken" className="home-role" aria-labelledby={titleId}>
      <div className="home-role__head">
        <h2 className="m-h3" id={titleId}>
          Играешь или следишь?
        </h2>
        <IconButton
          icon="x"
          size="sm"
          label="Закрыть вопрос и остаться игроком"
          disabled={busy}
          onClick={() => choose('close')}
        />
      </div>
      <p className="m-small">{SPECTATOR_NOTE} Поменять можно в своей карточке.</p>
      <div className="home-actions">
        <Button
          icon="user"
          loading={busy && choice === 'play'}
          disabled={busy}
          onClick={() => choose('play')}
        >
          Играю
        </Button>
        <Button
          icon="eye"
          loading={busy && choice === 'watch'}
          disabled={busy}
          onClick={() => choose('watch')}
        >
          Слежу за игрой
        </Button>
      </div>
    </Card>
  );
}
