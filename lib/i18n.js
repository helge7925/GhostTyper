import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import deMessages from '../messages/de.json';
import enMessages from '../messages/en.json';

/**
 * Lightweight i18n for the Pages-Router app.
 *
 * Why custom (and not next-intl)?
 *   next-intl 3.x is app-router-only; the 2.x pages-router branch is on
 *   life-support. A 120-line provider that does namespace-scoped lookups,
 *   ICU-style {placeholders} and number/date formatting via Intl is enough
 *   for the surface this project actually has.
 *
 * Locale resolution order on first paint:
 *   1. `gt:locale` cookie  (set by user via the LocaleSwitcher)
 *   2. <html lang> attribute  (server-rendered from the same cookie)
 *   3. navigator.language     (only client-side)
 *   4. DEFAULT_LOCALE
 */
export const SUPPORTED_LOCALES = ['de', 'en'];
export const DEFAULT_LOCALE = 'de';
export const LOCALE_COOKIE = 'gt:locale';

const CATALOGS = {
  de: deMessages,
  en: enMessages,
};

const I18nContext = createContext(null);

function lookup(catalog, key) {
  if (!catalog || !key) return undefined;
  const parts = String(key).split('.');
  let cursor = catalog;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in cursor) {
      cursor = cursor[part];
    } else {
      return undefined;
    }
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function format(message, values) {
  if (!message || !values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const replaced = values[key];
      return replaced === null || replaced === undefined ? '' : String(replaced);
    }
    return match;
  });
}

export function getCatalog(locale) {
  return CATALOGS[locale] || CATALOGS[DEFAULT_LOCALE];
}

export function normalizeLocale(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  // Normalize variants like "de-DE", "en-GB" → "de" / "en".
  const base = lower.split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function readCookieClient(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function I18nProvider({ initialLocale, children }) {
  const [locale, setLocaleState] = useState(initialLocale || DEFAULT_LOCALE);

  // Hydrate from cookie / navigator on first client paint when no explicit
  // initialLocale was provided.
  useEffect(() => {
    if (initialLocale) return;
    const cookie = normalizeLocale(readCookieClient(LOCALE_COOKIE));
    if (cookie && cookie !== locale) {
      setLocaleState(cookie);
      return;
    }
    if (typeof navigator !== 'undefined') {
      const nav = normalizeLocale(navigator.language);
      if (nav && nav !== locale) setLocaleState(nav);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocale]);

  const setLocale = useCallback(async (next) => {
    const normalized = normalizeLocale(next);
    if (!normalized) return;
    setLocaleState(normalized);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', normalized);
    }
    try {
      await fetch('/api/i18n/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: normalized }),
      });
    } catch {
      // best-effort: cookie won't persist without server, but in-memory still works
    }
  }, []);

  const formatters = useMemo(() => {
    const safe = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
    return {
      number: new Intl.NumberFormat(safe),
      currency: new Intl.NumberFormat(safe, { style: 'currency', currency: 'EUR' }),
      date: new Intl.DateTimeFormat(safe, { dateStyle: 'medium' }),
      dateTime: new Intl.DateTimeFormat(safe, { dateStyle: 'medium', timeStyle: 'short' }),
      relative: new Intl.RelativeTimeFormat(safe, { numeric: 'auto' }),
    };
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      catalog: getCatalog(locale),
      formatters,
    }),
    [locale, setLocale, formatters],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nContext() {
  return useContext(I18nContext);
}

/**
 * Returns a `t(key, values?)` function scoped to a namespace.
 *
 *   const t = useTranslations('topbar');
 *   t('search.placeholder')                 // "Suche oder Befehl…"
 *   t('greeting', { name: 'Helge' })        // "Hallo, Helge"
 *
 * Falls back to the DEFAULT_LOCALE catalog when a key is missing in the
 * active locale, and ultimately to the key itself so missing strings are
 * visible during dev rather than silently empty.
 */
export function useTranslations(namespace) {
  const ctx = useI18nContext();
  return useCallback(
    (key, values) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const message = lookup(ctx?.catalog, fullKey)
        ?? lookup(getCatalog(DEFAULT_LOCALE), fullKey)
        ?? fullKey;
      return format(message, values);
    },
    [ctx?.catalog, namespace],
  );
}

export function useLocale() {
  const ctx = useI18nContext();
  return {
    locale: ctx?.locale || DEFAULT_LOCALE,
    setLocale: ctx?.setLocale || (() => {}),
  };
}

/**
 * Resolves a key path to a non-string value (typically an array of strings)
 * for namespaces like `loadingMessages.welcome`. Falls back to the default
 * locale catalog, then to an empty array.
 */
export function useMessageList(path) {
  const ctx = useI18nContext();
  return useMemo(() => {
    const fromActive = pathLookup(ctx?.catalog, path);
    if (Array.isArray(fromActive)) return fromActive;
    const fromDefault = pathLookup(getCatalog(DEFAULT_LOCALE), path);
    return Array.isArray(fromDefault) ? fromDefault : [];
  }, [ctx?.catalog, path]);
}

function pathLookup(catalog, path) {
  if (!catalog || !path) return undefined;
  const parts = String(path).split('.');
  let cursor = catalog;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in cursor) {
      cursor = cursor[part];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/**
 * Resolves a key path to a non-string value (typically a plain object) for
 * namespaces like `translatePage.outputLanguageLabel`. Falls back to the
 * default locale catalog, then to an empty object.
 */
export function useMessageObject(path) {
  const ctx = useI18nContext();
  return useMemo(() => {
    const fromActive = pathLookup(ctx?.catalog, path);
    if (fromActive && typeof fromActive === 'object' && !Array.isArray(fromActive)) {
      return fromActive;
    }
    const fromDefault = pathLookup(getCatalog(DEFAULT_LOCALE), path);
    if (fromDefault && typeof fromDefault === 'object' && !Array.isArray(fromDefault)) {
      return fromDefault;
    }
    return {};
  }, [ctx?.catalog, path]);
}

export function useFormatter() {
  const ctx = useI18nContext();
  return ctx?.formatters || {
    number: { format: (v) => String(v) },
    currency: { format: (v) => String(v) },
    date: { format: (v) => String(v) },
    dateTime: { format: (v) => String(v) },
    relative: { format: (v) => String(v) },
  };
}

/**
 * Helper for getServerSideProps / getInitialProps to read the locale cookie
 * and pass it to the provider so the first paint matches the user's choice.
 */
export function readLocaleFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = String(cookieHeader).match(/(?:^|;\s*)gt:locale=([^;]*)/);
  return match ? normalizeLocale(decodeURIComponent(match[1])) : null;
}
