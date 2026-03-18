import { useI18n } from '../hooks/useI18n';

interface CommandCardProps {
  command: string;
  timestamp: string;
  exitCode: number | null;
  durationMs: number;
  clientIp: string;
  onClick?: () => void;
}

export default function CommandCard({ command, timestamp, exitCode, durationMs, clientIp, onClick }: CommandCardProps) {
  const { t } = useI18n();
  const isError = exitCode !== null && exitCode !== 0;
  const time = new Date(timestamp).toLocaleTimeString();
  const date = new Date(timestamp).toLocaleDateString();

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-surface-900 border border-surface-700 rounded-lg p-3 hover:border-surface-200/20 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <code className="text-sm text-slate-200 font-mono truncate flex-1">{command}</code>
        <span
          className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${isError
              ? 'bg-red-500/20 text-red-400'
              : exitCode === null
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-green-500/20 text-green-400'
            }`}
        >
          {exitCode === null ? t('dashboard.killed') : t('dashboard.exit', { code: exitCode })}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
        <span>{date} {time}</span>
        <span>{durationMs}ms</span>
        <span>{clientIp}</span>
      </div>
    </button>
  );
}
