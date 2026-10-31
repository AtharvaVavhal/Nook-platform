import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nook_theme_preference';

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // localStorage may be disabled or restricted
    }
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="Appearance color theme">
      <span className="theme-toggle-label">Theme</span>
      <div className="theme-toggle-options">
        <button
          type="button"
          className={`theme-btn ${theme === 'light' ? 'is-active' : ''}`}
          onClick={() => setTheme('light')}
          aria-pressed={theme === 'light'}
          title="Light theme"
        >
          Light
        </button>
        <button
          type="button"
          className={`theme-btn ${theme === 'dark' ? 'is-active' : ''}`}
          onClick={() => setTheme('dark')}
          aria-pressed={theme === 'dark'}
          title="Dark theme"
        >
          Dark
        </button>
        <button
          type="button"
          className={`theme-btn ${theme === 'system' ? 'is-active' : ''}`}
          onClick={() => setTheme('system')}
          aria-pressed={theme === 'system'}
          title="Match system preferences"
        >
          Auto
        </button>
      </div>
    </div>
  );
}
