import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme-context';
import { useTranslations } from '../lib/i18n';

export default function ThemeToggle({ className = '', compact = false }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations('theme');

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  const label = isDark ? t('toggleToLight') : t('toggleToDark');

  const baseClasses = compact
    ? 'inline-flex items-center justify-center w-9 h-9 rounded-lg text-secondary hover:text-primary hover:bg-hover transition-colors'
    : 'flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-secondary hover:text-primary hover:bg-hover transition-all';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`${baseClasses} ${className}`.trim()}
      aria-label={label}
      title={label}
    >
      {mounted ? (
        isDark ? <Sun className="w-5 h-5" aria-hidden="true" /> : <Moon className="w-5 h-5" aria-hidden="true" />
      ) : (
        <span className="w-5 h-5" aria-hidden="true" />
      )}
      {!compact && <span>{isDark ? t('lightLabel') : t('darkLabel')}</span>}
    </button>
  );
}
