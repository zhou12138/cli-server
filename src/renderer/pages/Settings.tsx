import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import type { Locale } from '../../i18n';
import type { ToolCallApprovalMode } from '../../main/managed-client/config';

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const [port, setPort] = useState(19876);
  const [savedPort, setSavedPort] = useState(19876);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [managedClientMode, setManagedClientMode] = useState<'cli-server' | 'managed-client' | 'managed-client-mcp-ws'>('cli-server');
  const [workspaceDirectory, setWorkspaceDirectory] = useState('');
  const [approvalMode, setApprovalMode] = useState<ToolCallApprovalMode>('manual');

  const mcpUrl = `http://localhost:${savedPort}/mcp`;
  const isServerMode = managedClientMode === 'cli-server';

  useEffect(() => {
    Promise.all([
      window.electronAPI.getServerStatus(),
      window.electronAPI.getNotificationEnabled(),
      window.electronAPI.getManagedClientBootstrapState(),
      window.electronAPI.getToolCallApprovalMode(),
    ]).then(([serverStatus, notificationEnabled, bootstrapState, toolCallApproval]) => {
      setPort(serverStatus.port);
      setSavedPort(serverStatus.port);
      setNotifyEnabled(notificationEnabled);
      setManagedClientMode(bootstrapState.mode);
      setWorkspaceDirectory(bootstrapState.workspaceDirectory);
      setApprovalMode(toolCallApproval);
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
    <div className="space-y-6">
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

      {isServerMode && (
        <>
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

          {/* MCP Endpoint */}
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.mcpEndpoint')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-slate-500">{t('settings.mcpDescription')}</p>
              <div
                className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 cursor-pointer hover:border-slate-600 transition-colors group"
                onClick={() => {
                  navigator.clipboard.writeText(mcpUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                title={t('settings.clickToCopy')}
              >
                <code className="flex-1 text-sm text-blue-400 font-mono select-all">{mcpUrl}</code>
                {copied
                  ? <Check className="w-4 h-4 text-green-400 shrink-0" />
                  : <Copy className="w-4 h-4 text-slate-500 group-hover:text-slate-300 shrink-0 transition-colors" />}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {managedClientMode === 'managed-client-mcp-ws' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.toolCallApprovalTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">{t('settings.toolCallApprovalDescription')}</p>
            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer rounded-md border border-slate-800 bg-slate-950/80 p-3 transition-colors hover:border-slate-600"
                onClick={async () => {
                  setApprovalMode('manual');
                  await window.electronAPI.setToolCallApprovalMode('manual');
                }}
              >
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${approvalMode === 'manual' ? 'border-blue-500' : 'border-slate-600'}`}>
                  {approvalMode === 'manual' && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-200">{t('settings.toolCallApprovalManual')}</div>
                  <p className="text-xs text-slate-500 mt-1">{t('settings.toolCallApprovalManualDescription')}</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer rounded-md border border-slate-800 bg-slate-950/80 p-3 transition-colors hover:border-slate-600"
                onClick={async () => {
                  setApprovalMode('auto');
                  await window.electronAPI.setToolCallApprovalMode('auto');
                }}
              >
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${approvalMode === 'auto' ? 'border-blue-500' : 'border-slate-600'}`}>
                  {approvalMode === 'auto' && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-200">{t('settings.toolCallApprovalAuto')}</div>
                  <p className="text-xs text-slate-500 mt-1">{t('settings.toolCallApprovalAutoDescription')}</p>
                  {approvalMode === 'auto' && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('settings.toolCallApprovalAutoWarning')}</span>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notification */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.notifications')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">{t('settings.notificationsDescription')}</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={async () => {
                const next = !notifyEnabled;
                setNotifyEnabled(next);
                await window.electronAPI.setNotificationEnabled(next);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifyEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm text-slate-300">{t('settings.notifyOnNewSession')}</span>
          </label>
        </CardContent>
      </Card>

      {managedClientMode === 'managed-client-mcp-ws' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.workspaceTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">{t('settings.workspaceDescription')}</p>
            <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950/80 p-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('settings.workspaceDirectoryLabel')}</div>
                <code className="mt-1 block break-all text-xs text-emerald-400">{workspaceDirectory}</code>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isServerMode && (
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
      )}

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.about')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">
            {managedClientMode === 'managed-client-mcp-ws'
              ? t('settings.aboutDescriptionMcpWs')
              : t('settings.aboutDescription')}
          </p>
          <div className="text-xs text-slate-600">{t('settings.version')}</div>
        </CardContent>
      </Card>
    </div>
  );
}
