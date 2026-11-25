import { useEffect, useState } from 'preact/hooks';

/**
 * Hooks ultraligeros portados de Nodux Flow (frontend/src/hooks.js).
 */

export function useDebounce<T>(value: T, ms = 150): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return now;
}

export type AppTheme = 'light';

export function useTheme(): [AppTheme, () => void] {
  useEffect(() => {
    try {
      localStorage.setItem('wasi.theme', 'light');
    } catch {
      // Ignore storage errors
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  const noop = () => {};
  return ['light', noop];
}
