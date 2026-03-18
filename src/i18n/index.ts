import en from './en.json';
import zhCN from './zh-CN.json';

export type Locale = 'en' | 'zh-CN';

const messages: Record<Locale, typeof en> = {
  en,
  'zh-CN': zhCN as typeof en,
};

export type MessageKeys = typeof en;

/**
 * Get a nested value from an object by dot-separated key path.
 * e.g. get(obj, 'dashboard.title') => obj.dashboard.title
 */
function getByPath(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return path;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : path;
}

/**
 * Replace {key} placeholders with values from params.
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}

/**
 * Create a translation function for the given locale.
 */
export function createT(locale: Locale) {
  const msg = messages[locale] ?? messages.en;
  return function t(key: string, params?: Record<string, string | number>): string {
    const template = getByPath(msg as unknown as Record<string, unknown>, key);
    return interpolate(template, params);
  };
}

/**
 * Detect system locale and map to supported locale.
 */
export function detectLocale(): Locale {
  const lang = typeof navigator !== 'undefined'
    ? navigator.language
    : (process.env.LANG || process.env.LANGUAGE || 'en');
  if (lang.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export { en, zhCN };
