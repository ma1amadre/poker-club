import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startParamRoute } from '../shared/lib';
import { getInitDataUnsafe, getStartParam } from '../shared/telegram';

// Telegram держит start_param в initData всю сессию Mini App, включая перезагрузки WebView.
// Переходим по нему один раз на запуск: отметка в sessionStorage переживает перезагрузку.
// Отметка привязана к запуску (подпись initData), а не только к значению параметра: в Telegram Web
// новый запуск — это новый iframe в той же вкладке, sessionStorage у них общий, и повторное
// открытие той же кнопки («Голосовать», потом «Смотреть голоса» — обе v_<id>) вело бы на главную.
// Перезагрузка iframe/WebView отдаёт тот же initData (SDK хранит его в sessionStorage) — повторного
// перехода нет; новый запуск приходит с новыми hash и auth_date.
const HANDLED_KEY = 'poker-club:start-param-handled';
let handledInMemory = false;

function launchMark(param: string): string {
  const unsafe = getInitDataUnsafe();
  const launch = unsafe.hash ?? (unsafe.auth_date !== undefined ? String(unsafe.auth_date) : '');
  return `${launch}|${param}`;
}

function alreadyHandled(param: string): boolean {
  if (handledInMemory) return true;
  handledInMemory = true;
  const mark = launchMark(param);
  try {
    if (sessionStorage.getItem(HANDLED_KEY) === mark) return true;
    sessionStorage.setItem(HANDLED_KEY, mark);
  } catch {
    // sessionStorage недоступен (приватный режим) — хватит отметки в памяти.
  }
  return false;
}

/**
 * Переход по параметру прямой ссылки (`e_<id>` → вечер, `v_<id>` → голосование, `r` → рейтинг)
 * один раз при старте. Вызывать внутри AuthGate: экраны вечера требуют входа.
 */
export function useStartParamRedirect(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const param = getStartParam();
    if (!param || alreadyHandled(param)) return;
    const target = startParamRoute(param);
    // push, а не replace: «Назад» с экрана вечера ведёт на главную, а не закрывает приложение.
    if (target) navigate(target);
  }, [navigate]);
}
