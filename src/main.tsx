// Порядок стилей важен: токены → база → каркас; стили кита подключает src/shared/ui/index.ts.
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyColorScheme } from './app/useTheme';
import { cleanLaunchHash, ready } from './shared/telegram';

// До монтирования роутера: Telegram кладёт launch-параметры в hash, HashRouter принял бы их за путь.
cleanLaunchHash();
// Тема до первого кадра — без вспышки светлой темы у тех, у кого Telegram тёмный.
applyColorScheme();
// ready() как можно раньше: Telegram убирает свою заглушку загрузки и показывает приложение.
ready();

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root в index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
