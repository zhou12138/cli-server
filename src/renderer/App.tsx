import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from './hooks/useI18n';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import { Input } from './components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';

interface ManagedClientBootstrapState {
  mode: 'cli-server' | 'managed-client';
  headless: boolean;
  baseUrl: string | null;
  needsBaseUrl: boolean;
  running: boolean;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<ManagedClientBootstrapState | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electronAPI.getManagedClientBootstrapState().then((state) => {
      setBootstrap(state);
      setBaseUrl(state.baseUrl ?? '');
    });
  }, []);

  if (!bootstrap) {
    return null;
  }

  if (bootstrap.mode === 'managed-client' && !bootstrap.headless && bootstrap.needsBaseUrl) {
    return (
      <I18nProvider>
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle>Managed Client Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-400">
                Confirm MANAGED_CLIENT_BASE_URL before starting managed client runtime.
              </p>
              <div className="space-y-2">
                <label className="block text-xs text-slate-500">MANAGED_CLIENT_BASE_URL</label>
                <Input
                  type="text"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://localhost:8000/api"
                />
              </div>
              {error && <div className="text-sm text-red-400">{error}</div>}
              <button
                onClick={async () => {
                  if (!baseUrl.trim()) {
                    setError('MANAGED_CLIENT_BASE_URL is required');
                    return;
                  }

                  setSaving(true);
                  setError('');
                  try {
                    const next = await window.electronAPI.saveManagedClientBaseUrlAndStart(baseUrl.trim());
                    setBootstrap(next);
                  } catch (saveError) {
                    setError(String(saveError));
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Starting...' : 'Save and Start'}
              </button>
            </CardContent>
          </Card>
        </div>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </I18nProvider>
  );
}
