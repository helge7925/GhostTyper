import { Check, Languages } from 'lucide-react';
import { useTransition } from 'react';
import { useRouter } from 'next/router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { SUPPORTED_LOCALES, useLocale, useTranslations } from '../lib/i18n';
import { cn } from '../lib/utils';

/**
 * Locale picker for the TopBar.
 * Visible md+ as an icon button; mobile inherits the language via the
 * profile menu (added there for parity).
 */
export default function LocaleSwitcher({ className = '', compact = true }) {
  const { locale, setLocale } = useLocale();
  const t = useTranslations('locale');
  const router = useRouter();
  const [, startTransition] = useTransition();

  const handlePick = async (next) => {
    if (next === locale) return;
    await setLocale(next);
    // Soft-refresh so any SSR-rendered strings + <html lang> reflect the
    // new locale immediately, without a full page reload.
    startTransition(() => {
      router.replace(router.asPath, undefined, { scroll: false });
    });
  };

  const triggerLabel = `${t('label')}: ${t(locale)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            compact
              ? 'inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-subtle bg-hover-subtle text-secondary hover:text-primary hover:bg-hover transition-colors'
              : 'flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-secondary hover:text-primary hover:bg-hover transition-all',
            className,
          )}
        >
          <Languages className="w-4 h-4" aria-hidden="true" />
          {compact && (
            <span className="text-xs font-bold uppercase tracking-wider">{locale}</span>
          )}
          {!compact && <span>{t('label')}</span>}
          {!compact && (
            <span className="ml-auto text-xs uppercase text-secondary">{locale}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LOCALES.map((code) => {
          const active = code === locale;
          return (
            <DropdownMenuItem
              key={code}
              onSelect={(event) => {
                event.preventDefault();
                handlePick(code);
              }}
              className={cn('flex items-center justify-between gap-2', active && 'text-accent')}
            >
              <span className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-secondary w-6">
                  {code}
                </span>
                <span>{t(code)}</span>
              </span>
              {active && <Check className="w-4 h-4 text-accent" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
