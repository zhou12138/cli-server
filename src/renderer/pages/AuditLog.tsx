import { useEffect, useState, useCallback } from 'react';

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

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    window.electronAPI
      .getAuditEntries({ limit: 100, search: search || undefined })
      .then(({ entries: data, total: t }) => {
        setEntries(data);
        setTotal(t);
      });
  }, [search]);

  useEffect(() => {
    fetchEntries();
    const unsub = window.electronAPI.onServerEvent(() => fetchEntries());
    return unsub;
  }, [fetchEntries]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Audit Log</h2>
        <span className="text-xs text-slate-500">{total} total entries</span>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search commands, output..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
      />

      {/* Table */}
      <div className="border border-surface-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-900 text-slate-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Time</th>
              <th className="text-left px-3 py-2 font-medium">Command</th>
              <th className="text-left px-3 py-2 font-medium">Exit</th>
              <th className="text-left px-3 py-2 font-medium">Duration</th>
              <th className="text-left px-3 py-2 font-medium">Client</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-600">
                  {search ? 'No matching entries' : 'No audit entries yet'}
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="group">
                  <td colSpan={5} className="p-0">
                    {/* Row summary */}
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-surface-900/50 transition-colors cursor-pointer flex"
                      onClick={() => toggleExpand(entry.id)}
                    >
                      <span className="w-[140px] shrink-0 text-slate-500 text-xs">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <span className="flex-1 font-mono text-slate-200 truncate text-xs">
                        {entry.command}
                      </span>
                      <span
                        className={`w-[60px] shrink-0 text-xs text-right ${entry.exitCode === 0
                            ? 'text-green-400'
                            : entry.exitCode === null
                              ? 'text-yellow-400'
                              : 'text-red-400'
                          }`}
                      >
                        {entry.exitCode === null ? 'killed' : entry.exitCode}
                      </span>
                      <span className="w-[80px] shrink-0 text-xs text-slate-500 text-right">
                        {entry.durationMs}ms
                      </span>
                      <span className="w-[120px] shrink-0 text-xs text-slate-600 text-right">
                        {entry.clientIp}
                      </span>
                    </button>

                    {/* Expanded detail */}
                    {expandedId === entry.id && (
                      <div className="px-3 pb-3 space-y-2 border-t border-surface-700 bg-surface-900/30">
                        <div className="pt-2">
                          <div className="text-xs text-slate-500 mb-1">Working Directory</div>
                          <code className="text-xs text-slate-300">{entry.cwd}</code>
                        </div>
                        {entry.stdout && (
                          <div>
                            <div className="text-xs text-slate-500 mb-1">stdout</div>
                            <pre className="output-pre">{entry.stdout}</pre>
                          </div>
                        )}
                        {entry.stderr && (
                          <div>
                            <div className="text-xs text-red-400/70 mb-1">stderr</div>
                            <pre className="output-pre !text-red-400">{entry.stderr}</pre>
                          </div>
                        )}
                        {!entry.stdout && !entry.stderr && (
                          <div className="text-xs text-slate-600 py-2">No output captured</div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
