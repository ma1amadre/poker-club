// ready(): на компьютере полноэкранный запуск снимается, на телефоне остаётся.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ready } from './webapp';

function versionAtLeast(current: string, wanted: string): boolean {
  const a = current.split('.').map(Number);
  const b = wanted.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

function stubTelegram(platform: string, isFullscreen: boolean, version = '9.6') {
  const app = {
    initData: 'query_id=1&hash=x',
    platform,
    version,
    isFullscreen,
    isVersionAtLeast: (wanted: string) => versionAtLeast(version, wanted),
    ready: vi.fn(),
    expand: vi.fn(),
    disableVerticalSwipes: vi.fn(),
    exitFullscreen: vi.fn(),
  };
  vi.stubGlobal('window', { Telegram: { WebApp: app } });
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ready', () => {
  it('выходит из полноэкранного режима в Telegram Desktop', () => {
    const app = stubTelegram('tdesktop', true);
    ready();
    expect(app.ready).toHaveBeenCalled();
    expect(app.exitFullscreen).toHaveBeenCalledOnce();
  });

  it('выходит из полноэкранного режима в Telegram для macOS', () => {
    const app = stubTelegram('macos', true);
    ready();
    expect(app.exitFullscreen).toHaveBeenCalledOnce();
  });

  it('оставляет полноэкранный режим на телефоне', () => {
    for (const platform of ['android', 'ios']) {
      const app = stubTelegram(platform, true);
      ready();
      expect(app.exitFullscreen).not.toHaveBeenCalled();
    }
  });

  it('не трогает обычное окно на компьютере', () => {
    const app = stubTelegram('tdesktop', false);
    ready();
    expect(app.exitFullscreen).not.toHaveBeenCalled();
  });

  it('не зовёт метод, которого нет в старом клиенте', () => {
    const app = stubTelegram('tdesktop', true, '7.10');
    ready();
    expect(app.exitFullscreen).not.toHaveBeenCalled();
  });
});
