import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { createT, detectLocale, type Locale } from '../../i18n';

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('cli-server-locale');
    return (saved as Locale) || detectLocale();
  });

  const t = useCallback(createT(locale), [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem('cli-server-locale', newLocale);
    setLocaleState(newLocale);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
