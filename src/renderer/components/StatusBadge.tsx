import { useI18n } from '../hooks/useI18n';

interface StatusBadgeProps {
  mode: 'cli-server' | 'managed-client' | 'managed-client-mcp-ws';
  running: boolean;
  port: number;
  needsBaseUrl?: boolean;
}

export default function StatusBadge({ mode, running, port, needsBaseUrl = false }: StatusBadgeProps) {
  const { t } = useI18n();
  const isServerMode = mode === 'cli-server';
  const isManagedConnected = !isServerMode && running;
  const dotClassName = isServerMode
    ? (running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400')
    : (isManagedConnected
      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
      : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.45)]');
  const label = isServerMode
    ? (running ? t('status.runningOnPort', { port }) : t('status.stopped'))
    : (running
      ? t('status.managedConnected')
      : (needsBaseUrl ? t('status.managedAwaitingSignin') : t('status.managedDisconnected')));

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotClassName}`}
      />
      <span className="text-xs text-slate-400">
        {label}
      </span>
    </div>
  );
}
