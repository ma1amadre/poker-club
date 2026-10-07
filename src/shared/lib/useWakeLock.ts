import { useEffect, useState } from 'react';
import { keepScreenAwake, type WakeLockStatus } from './wakeLock';

function wakeLockSupported(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' && 'wakeLock' in navigator && Boolean(navigator.wakeLock)
    );
  } catch {
    return false;
  }
}

/**
 * Не даёт экрану погаснуть, пока `enabled` и страница видна (табло, пульт идущего вечера).
 * Статус — для подсказки, если удержать нельзя (wakeLockHint).
 */
export function useWakeLock(enabled = true): WakeLockStatus {
  const [supported] = useState(wakeLockSupported);
  const [status, setStatus] = useState<WakeLockStatus>(supported ? 'released' : 'unsupported');

  useEffect(() => {
    if (!supported || !enabled) return;
    return keepScreenAwake({ wakeLock: navigator.wakeLock, doc: document }, setStatus);
  }, [supported, enabled]);

  if (!supported) return 'unsupported';
  return enabled ? status : 'released';
}
