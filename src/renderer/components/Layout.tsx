import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import StatusBadge from './StatusBadge';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '⊞' },
  { to: '/audit', label: 'Audit Log', icon: '⊟' },
  { to: '/settings', label: 'Settings', icon: '⊠' },
];

export default function Layout() {
  const [status, setStatus] = useState<{ running: boolean; port: number; activeConnections: number }>({
    running: false,
    port: 19876,
    activeConnections: 0,
  });

  useEffect(() => {
    // Initial fetch
    window.electronAPI.getServerStatus().then(setStatus);

    // Listen for server events
    const unsub = window.electronAPI.onServerEvent(() => {
      window.electronAPI.getServerStatus().then(setStatus);
    });

    return unsub;
  }, []);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-surface-900 border-r border-surface-700 flex flex-col">
        <div className="p-4 border-b border-surface-700">
          <h1 className="text-lg font-bold text-white tracking-tight">CLI Server</h1>
          <div className="mt-2">
            <StatusBadge running={status.running} port={status.port} />
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${isActive
                  ? 'bg-blue-600/20 text-blue-400 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-800'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-surface-700 text-xs text-slate-500">
          {status.activeConnections} active connection{status.activeConnections !== 1 ? 's' : ''}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-surface-950 p-6">
        <Outlet />
      </main>
    </div>
  );
}
