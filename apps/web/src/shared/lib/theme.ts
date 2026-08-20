export type Theme = 'system' | 'light' | 'dark';

const KEY = 'gatehouse-theme';

export function readTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * `system` removes the attribute so the prefers-color-scheme rules take over again; anything
 * else pins it. index.html applies the stored value before first paint so there is no flash.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
}
