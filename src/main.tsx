// Порядок стилей важен: «Материя» (шрифты, токены всех регистров, компоненты — один лист, в нём
// уже есть tokens.css) → база приложения → каркас; стили кита подключает src/shared/ui/index.ts.
import './vendor/materia/materia.css';
// Главный регистр «Терминал» (DESIGN.md): токены, затем правила компонентов поверх «Материи».
import './styles/terminal-theme.css';
import './styles/terminal.css';
import './styles/base.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme } from './app/useTheme';
import { cleanLaunchHash, ready } from './shared/telegram';

// До монтирования роутера: Telegram кладёт launch-параметры в hash, HashRouter принял бы их за путь.
cleanLaunchHash();
// Регистр до первого кадра: «Терминал» и на экранах приложения, и на табло — без кадра в Кобальте.
applyTheme();
// ready() как можно раньше: Telegram убирает свою заглушку загрузки и показывает приложение.
ready();

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root в index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
