import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startParamRoute } from '../shared/lib';
import { getStartParam } from '../shared/telegram';

// Telegram держит start_param в initData всю сессию Mini App, включая перезагрузки WebView.
// Переходим по нему один раз: отметка в sessionStorage переживает перезагрузку, а новый запуск
// Mini App — это новая сессия WebView, и по новой ссылке переход снова сработает.
const HANDLED_KEY = 'poker-club:start-param-handled';
let handledInMemory = false;

function alreadyHandled(param: string): boolean {
  if (handledInMemory) return true;
  handledInMemory = true;
  try {
    if (sessionStorage.getItem(HANDLED_KEY) === param) return true;
    sessionStorage.setItem(HANDLED_KEY, param);
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
