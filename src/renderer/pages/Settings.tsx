import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { Locale } from '../../i18n';

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const [port, setPort] = useState(19876);
  const [savedPort, setSavedPort] = useState(19876);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    window.electronAPI.getServerStatus().then((s) => {
      setPort(s.port);
      setSavedPort(s.port);
    });
  }, []);

  const handleRestart = async () => {
    if (port < 1024 || port > 65535) {
      setMessage(t('settings.portValidation'));
      return;
    }
    setRestarting(true);
    setMessage('');
    try {
      const result = await window.electronAPI.restartServer(port);
      setSavedPort(result.port);
      setMessage(t('settings.restartSuccess', { port: result.port }));
    } catch (err) {
      setMessage(t('settings.restartFailed', { error: String(err) }));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-xl font-semibold text-white">{t('settings.title')}</h2>

      {/* Language */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-slate-300">{t('settings.language')}</h3>
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{t('settings.languageDescription')}</p>
          <div className="flex gap-2">
            {([['en', 'English'], ['zh-CN', '中文']] as const).map(([loc, label]) => (
              <button
                key={loc}
                onClick={() => setLocale(loc as Locale)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${locale === loc
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface-950 border border-surface-700 text-slate-400 hover:text-slate-200'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Port Configuration */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-slate-300">{t('settings.serverConfig')}</h3>

        <div className="space-y-2">
          <label className="block text-xs text-slate-500">{t('settings.portNumber')}</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-32 bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleRestart}
              disabled={restarting || port === savedPort}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {restarting ? t('settings.restarting') : t('settings.applyRestart')}
            </button>
          </div>
          {message && (
            <div className={`text-xs ${message.includes('Failed') || message.includes('失败') ? 'text-red-400' : 'text-green-400'}`}>
              {message}
            </div>
          )}
        </div>
      </section>

      {/* Security Guardrails (placeholder) */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-300">{t('settings.securityGuardrails')}</h3>
          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">{t('settings.comingSoon')}</span>
        </div>

        <div className="space-y-3 opacity-50">
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.authToken')}</label>
            <input
              type="text"
              disabled
              placeholder={t('settings.authTokenPlaceholder')}
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.corsOrigins')}</label>
            <input
              type="text"
              disabled
              placeholder={t('settings.corsPlaceholder')}
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.commandBlocklist')}</label>
            <textarea
              disabled
              placeholder="rm -rf /&#10;format c:&#10;..."
              rows={3}
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.rateLimiting')}</label>
            <input
              type="text"
              disabled
              placeholder={t('settings.rateLimitPlaceholder')}
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <p className="text-xs text-slate-600">
          {t('settings.securityNotice')}
        </p>
      </section>

      {/* About */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-2">
        <h3 className="text-sm font-medium text-slate-300">{t('settings.about')}</h3>
        <p className="text-xs text-slate-500">
          {t('settings.aboutDescription')}
        </p>
        <div className="text-xs text-slate-600">{t('settings.version')}</div>
      </section>
    </div>
  );
}
