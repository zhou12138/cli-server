import { useEffect, useState } from 'react';

export default function Settings() {
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
      setMessage('Port must be between 1024 and 65535');
      return;
    }
    setRestarting(true);
    setMessage('');
    try {
      const result = await window.electronAPI.restartServer(port);
      setSavedPort(result.port);
      setMessage(`Server restarted on port ${result.port}`);
    } catch (err) {
      setMessage(`Failed to restart: ${err}`);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-xl font-semibold text-white">Settings</h2>

      {/* Port Configuration */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-slate-300">Server Configuration</h3>

        <div className="space-y-2">
          <label className="block text-xs text-slate-500">Port Number</label>
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
              {restarting ? 'Restarting...' : 'Apply & Restart'}
            </button>
          </div>
          {message && (
            <div className={`text-xs ${message.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
              {message}
            </div>
          )}
        </div>
      </section>

      {/* Security Guardrails (placeholder) */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-300">Security Guardrails</h3>
          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Coming Soon</span>
        </div>

        <div className="space-y-3 opacity-50">
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">Authentication Token</label>
            <input
              type="text"
              disabled
              placeholder="Bearer token for API access"
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-slate-500">Allowed CORS Origins</label>
            <input
              type="text"
              disabled
              placeholder="* (all origins)"
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-slate-500">Command Blocklist</label>
            <textarea
              disabled
              placeholder="rm -rf /&#10;format c:&#10;..."
              rows={3}
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-slate-500">Rate Limiting</label>
            <input
              type="text"
              disabled
              placeholder="Max 10 commands per minute"
              className="w-full bg-surface-950 border border-surface-700 rounded px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <p className="text-xs text-slate-600">
          Security guardrails will be available in a future release. For now, the server accepts all
          connections and commands without restriction. Use with caution.
        </p>
      </section>

      {/* About */}
      <section className="bg-surface-900 border border-surface-700 rounded-lg p-5 space-y-2">
        <h3 className="text-sm font-medium text-slate-300">About</h3>
        <p className="text-xs text-slate-500">
          CLI Server provides a local WebSocket + HTTP gateway for web-based AI agents to execute
          CLI commands on your machine. It runs a persistent background service on the configured
          port and logs all command executions for audit purposes.
        </p>
        <div className="text-xs text-slate-600">Version 0.1.0 (MVP)</div>
      </section>
    </div>
  );
}
