import { useEffect, useState } from 'react';
import CommandCard from '../components/CommandCard';
import { useI18n } from '../hooks/useI18n';

interface AuditEntry {
  id: string;
  timestamp: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  clientIp: string;
}

interface ServerStatus {
  running: boolean;
  port: number;
  activeConnections: number;
}

export default function Dashboard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<ServerStatus>({ running: false, port: 19876, activeConnections: 0 });
  const [recentEntries, setRecentEntries] = useState<AuditEntry[]>([]);
  const [totalToday, setTotalToday] = useState(0);
  const [errorsToday, setErrorsToday] = useState(0);

  const refresh = () => {
    window.electronAPI.getServerStatus().then(setStatus);
    window.electronAPI.getAuditEntries({ limit: 10 }).then(({ entries, total }) => {
      setRecentEntries(entries);
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayEntries = entries.filter((e) => e.timestamp.startsWith(todayStr));
      setTotalToday(total);
      setErrorsToday(todayEntries.filter((e) => e.exitCode !== null && e.exitCode !== 0).length);
    });
  };

  useEffect(() => {
    refresh();
    const unsub = window.electronAPI.onServerEvent(() => refresh());
    return unsub;
  }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-white">{t('dashboard.title')}</h2>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface-900 border border-surface-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">{t('dashboard.serverStatus')}</div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${status.running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'
                }`}
            />
            <span className="text-lg font-bold text-white">
              {status.running ? t('status.running') : t('status.stopped')}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{t('dashboard.port', { port: status.port })}</div>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">{t('dashboard.totalCommands')}</div>
          <div className="mt-1 text-2xl font-bold text-white">{totalToday}</div>
          <div className="mt-1 text-xs text-slate-500">{t('dashboard.inAuditLog')}</div>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">{t('dashboard.activeConnections')}</div>
          <div className="mt-1 text-2xl font-bold text-white">{status.activeConnections}</div>
          <div className="mt-1 text-xs text-slate-500">
            {errorsToday > 0 ? t('dashboard.errorsRecently', { count: errorsToday }) : t('dashboard.noRecentErrors')}
          </div>
        </div>
      </div>

      {/* Recent Commands */}
      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-3">{t('dashboard.recentCommands')}</h3>
        {recentEntries.length === 0 ? (
          <div className="text-sm text-slate-600 bg-surface-900 border border-surface-700 rounded-lg p-8 text-center">
            {t('dashboard.noCommands')} <code className="text-slate-400">ws://localhost:{status.port}</code>
          </div>
        ) : (
          <div className="space-y-2">
            {recentEntries.map((entry) => (
              <CommandCard
                key={entry.id}
                command={entry.command}
                timestamp={entry.timestamp}
                exitCode={entry.exitCode}
                durationMs={entry.durationMs}
                clientIp={entry.clientIp}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
