import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
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
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-white">{t('settings.title')}</h2>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.language')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">{t('settings.languageDescription')}</p>
          <div className="flex gap-2">
            {([['en', 'English'], ['zh-CN', '中文']] as const).map(([loc, label]) => (
              <button
                key={loc}
                onClick={() => setLocale(loc as Locale)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${locale === loc
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Port Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.serverConfig')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-xs text-slate-500">{t('settings.portNumber')}</label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-32"
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
        </CardContent>
      </Card>

      {/* Security Guardrails */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>{t('settings.securityGuardrails')}</CardTitle>
            <Badge variant="warning">{t('settings.comingSoon')}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 opacity-50">
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.authToken')}</label>
            <Input type="text" disabled placeholder={t('settings.authTokenPlaceholder')} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.corsOrigins')}</label>
            <Input type="text" disabled placeholder={t('settings.corsPlaceholder')} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.commandBlocklist')}</label>
            <textarea
              disabled
              placeholder="rm -rf /&#10;format c:&#10;..."
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed resize-none focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('settings.rateLimiting')}</label>
            <Input type="text" disabled placeholder={t('settings.rateLimitPlaceholder')} />
          </div>
          <p className="text-xs text-slate-600">{t('settings.securityNotice')}</p>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.about')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">{t('settings.aboutDescription')}</p>
          <div className="text-xs text-slate-600">{t('settings.version')}</div>
        </CardContent>
      </Card>
    </div>
  );
}
