// Один экземпляр часов табло (Motion) на табло ТВ. Спокойный режим — по prefers-reduced-motion
// (меняется на лету). В dev часы доступны снаружи (window.__tvMotion: freeze, jump, play) — для
// снимков посреди движения; в прод-сборку это не попадает.
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Riffle } from './flapLogic';
import { Motion } from './motion';
import { MotionCtx, type MotionValue } from './motionContext';

const REDUCED = '(prefers-reduced-motion: reduce)';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCED).matches);
}

declare global {
  interface Window {
    __tvMotion?: Motion;
  }
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [value] = useState<MotionValue>(() => ({
    motion: new Motion({ calm: reducedMotion() }),
    riffle: new Riffle(),
  }));
  useLayoutEffect(() => {
    const m = value.motion;
    m.start();
    if (import.meta.env.DEV) window.__tvMotion = m;
    return () => {
      m.stop();
      if (import.meta.env.DEV && window.__tvMotion === m) delete window.__tvMotion;
    };
  }, [value]);
  useEffect(() => {
    const media = window.matchMedia?.(REDUCED);
    if (!media) return;
    const onChange = () => {
      value.motion.calm = media.matches;
    };
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [value]);
  return <MotionCtx.Provider value={value}>{children}</MotionCtx.Provider>;
}
