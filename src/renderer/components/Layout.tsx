import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import StatusBadge from './StatusBadge';
import { useI18n } from '../hooks/useI18n';
import { LayoutDashboard, ScrollText, Settings, PlugZap, Shield } from 'lucide-react';

export default function Layout() {
  const { t } = useI18n();

  const navItems = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/audit', label: t('nav.auditLog'), icon: ScrollText },
    { to: '/mcp-servers', label: t('nav.mcpServers'), icon: PlugZap },
    { to: '/built-in-tools', label: t('nav.builtInTools'), icon: Shield },
    { to: '/settings', label: t('nav.settings'), icon: Settings },
  ];

  const [status, setStatus] = useState<{ running: boolean; port: number; activeConnections: number }>({
    running: false,
    port: 19876,
    activeConnections: 0,
  });
  const [managedClient, setManagedClient] = useState<{
    mode: 'cli-server' | 'managed-client' | 'managed-client-mcp-ws';
    headless: boolean;
    baseUrl: string | null;
    workspaceRoot: string;
    workspaceCurrentDir: string;
    workspaceArchiveDir: string;
    needsBaseUrl: boolean;
    running: boolean;
    pullStatus: 'idle' | 'waiting' | 'task-assigned' | 'task-completed' | 'task-failed';
    pulledTaskCount: number;
    emptyPollCount: number;
    lastPollStatus: number | null;
    lastTaskCommand: string | null;
    lastPolledAt: string | null;
    receivedEventCount: number;
    pingCount: number;
    pongSentCount: number;
    lastEventAt: string | null;
    lastEventName: string | null;
    lastPingAt: string | null;
  }>({
    mode: 'cli-server',
    headless: false,
    baseUrl: null,
    workspaceRoot: '',
    workspaceCurrentDir: '',
    workspaceArchiveDir: '',
    needsBaseUrl: false,
    running: false,
    pullStatus: 'idle',
    pulledTaskCount: 0,
    emptyPollCount: 0,
    lastPollStatus: null,
    lastTaskCommand: null,
    lastPolledAt: null,
    receivedEventCount: 0,
    pingCount: 0,
    pongSentCount: 0,
    lastEventAt: null,
    lastEventName: null,
    lastPingAt: null,
  });

  useEffect(() => {
    window.electronAPI.getServerStatus().then(setStatus);
    const unsub = window.electronAPI.onServerEvent(() => {
      window.electronAPI.getServerStatus().then(setStatus);
    });
    return unsub;
  }, []);

  const isManagedClientMode = managedClient.mode !== 'cli-server';
  const isManagedMcpWsMode = managedClient.mode === 'managed-client-mcp-ws';
  const modeLabel = managedClient.mode === 'cli-server'
    ? t('mode.server')
    : isManagedMcpWsMode ? t('mode.managedClientMcpWs') : t('mode.managedClient');
  const modeSummary = isManagedClientMode
    ? (managedClient.running
      ? (isManagedMcpWsMode ? t('mode.managedClientMcpWsRunning') : t('mode.managedClientRunning'))
      : t('mode.managedClientWaiting'))
    : t('mode.serverSummary', { port: status.port });
  const closeHint = isManagedClientMode ? t('mode.closeHintManaged') : t('mode.closeHint');

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-lg font-bold text-white tracking-tight">{t('app.title')}</h1>
          <div className="mt-2">
            <StatusBadge running={status.running} port={status.port} />
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${isActive
                    ? 'bg-blue-600/20 text-blue-400 font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
          {t('status.activeConnections', { count: status.activeConnections })}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-950 p-6 flex justify-center">
        <div className="w-full max-w-4xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
