import { useEffect, useState } from 'react';
import CommandCard from '../components/CommandCard';

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
  const [status, setStatus] = useState<ServerStatus>({ running: false, port: 19876, activeConnections: 0 });
  const [recentEntries, setRecentEntries] = useState<AuditEntry[]>([]);
  const [totalToday, setTotalToday] = useState(0);
  const [errorsToday, setErrorsToday] = useState(0);

  const refresh = () => {
    window.electronAPI.getServerStatus().then(setStatus);
    window.electronAPI.getAuditEntries({ limit: 10 }).then(({ entries, total }) => {
      setRecentEntries(entries);
      // Count today's entries
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayEntries = entries.filter((e) => e.timestamp.startsWith(todayStr));
      setTotalToday(total); // approximation — shows total in log
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
      <h2 className="text-xl font-semibold text-white">Dashboard</h2>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface-900 border border-surface-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Server Status</div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${status.running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'
                }`}
            />
            <span className="text-lg font-bold text-white">
              {status.running ? 'Running' : 'Stopped'}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Port {status.port}</div>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Total Commands</div>
          <div className="mt-1 text-2xl font-bold text-white">{totalToday}</div>
          <div className="mt-1 text-xs text-slate-500">in audit log</div>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Active Connections</div>
          <div className="mt-1 text-2xl font-bold text-white">{status.activeConnections}</div>
          <div className="mt-1 text-xs text-slate-500">
            {errorsToday > 0 ? `${errorsToday} error(s) recently` : 'No recent errors'}
          </div>
        </div>
      </div>

      {/* Recent Commands */}
      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-3">Recent Commands</h3>
        {recentEntries.length === 0 ? (
          <div className="text-sm text-slate-600 bg-surface-900 border border-surface-700 rounded-lg p-8 text-center">
            No commands executed yet. Connect via WebSocket to <code className="text-slate-400">ws://localhost:{status.port}</code>
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
