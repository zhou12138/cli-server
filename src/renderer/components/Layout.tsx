import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ManagedClientBootstrapState } from '../../preload';
import StatusBadge from './StatusBadge';
import { Input } from './ui/input';
import { useI18n } from '../hooks/useI18n';
import { LayoutDashboard, ScrollText, Settings, PlugZap, Shield, Wrench, LogOut, LogIn, Activity } from 'lucide-react';

function resolveManagedBaseUrl(localBaseUrl: string | null, signinBaseUrl?: string | null): string {
  const resolvedBaseUrl = signinBaseUrl?.trim() || localBaseUrl?.trim() || '';
  if (!resolvedBaseUrl) {
    throw new Error('Managed MCP WebSocket base URL is required after browser sign-in. Provide it in the sign-in page or local settings.');
  }

  return resolvedBaseUrl;
}

/** Matches protocol://domain or protocol://domain:port, with optional trailing path */
function isValidEndpointUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !!url.protocol && !!url.hostname;
  } catch {
    return false;
  }
}

function extractHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname;
  } catch {
    return '';
  }
}

export default function Layout() {
  const { t } = useI18n();

  const [status, setStatus] = useState<{ running: boolean; port: number; activeConnections: number }>({
    running: false,
    port: 19876,
    activeConnections: 0,
  });
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [signinBaseUrl, setSigninBaseUrl] = useState('');
  const [signinPageUrl, setSigninPageUrl] = useState('');
  const [signinTlsServername, setSigninTlsServername] = useState('');
  const [managedClient, setManagedClient] = useState<ManagedClientBootstrapState>({
    mode: 'cli-server',
    headless: false,
    baseUrl: null,
    signinPageUrl: null,
    tlsServername: null,
    workspaceRoot: '',
    workspaceDirectory: '',
    needsModeSelection: false,
    needsBaseUrl: false,
    running: false,
    sessionAuthenticated: false,
    clientId: null,
    connectionId: null,
    sessionIdentityLabel: null,
    sessionIdentityDetail: null,
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
    Promise.all([
      window.electronAPI.getServerStatus(),
      window.electronAPI.getManagedClientBootstrapState(),
    ]).then(([serverStatus, bootstrapState]) => {
      setStatus(serverStatus);
      setManagedClient((current) => ({
        ...current,
        ...bootstrapState,
      }));
    });

    const unsub = window.electronAPI.onServerEvent(() => {
      window.electronAPI.getServerStatus().then(setStatus);
      window.electronAPI.getManagedClientBootstrapState().then((bootstrapState) => {
        setManagedClient((current) => ({
          ...current,
          ...bootstrapState,
        }));
      });
    });
    return unsub;
  }, []);

  const isManagedClientMode = managedClient.mode !== 'cli-server';
  const isManagedMcpWsMode = managedClient.mode === 'managed-client-mcp-ws';
  const navItems = isManagedMcpWsMode
    ? [
      { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
      { to: '/activities', label: t('nav.activities'), icon: Activity },
      { to: '/audit', label: t('nav.auditLog'), icon: ScrollText },
      { to: '/mcp-servers', label: t('nav.mcpServers'), icon: PlugZap },
      { to: '/built-in-tools', label: t('nav.builtInTools'), icon: Wrench },
      { to: '/permissions', label: t('nav.permissions'), icon: Shield },
      { to: '/settings', label: t('nav.settings'), icon: Settings },
    ]
    : [
      { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
      { to: '/activities', label: t('nav.activities'), icon: Activity },
      { to: '/audit', label: t('nav.auditLog'), icon: ScrollText },
      { to: '/built-in-tools', label: t('nav.builtInTools'), icon: Wrench },
      { to: '/settings', label: t('nav.settings'), icon: Settings },
    ];
  const showManagedSignIn = isManagedMcpWsMode && !managedClient.running;
  const showManagedSignOut = isManagedMcpWsMode && managedClient.running;
  const appTitle = isManagedClientMode ? t('app.managedTitle') : t('app.title');
  const sessionLabel = managedClient.sessionIdentityLabel;
  const sessionDetail = managedClient.sessionIdentityDetail;

  const openManagedSignInForm = () => {
    setSigninBaseUrl(managedClient.baseUrl ?? '');
    setSigninPageUrl(managedClient.signinPageUrl ?? managedClient.baseUrl ?? '');
    setSigninTlsServername('');
    setAuthError('');
    setShowSignInForm(true);
  };

  const handleManagedSignIn = async () => {
    const trimmedBase = signinBaseUrl.trim();
    const trimmedSignin = signinPageUrl.trim();

    if (!trimmedBase) {
      setAuthError('MCP Hub Endpoint is required');
      return;
    }
    if (!isValidEndpointUrl(trimmedBase)) {
      setAuthError('MCP Hub Endpoint must be a valid URL (protocol://domain or protocol://domain:port)');
      return;
    }
    if (trimmedSignin && !isValidEndpointUrl(trimmedSignin)) {
      setAuthError('Sign-in Page URL must be a valid URL (protocol://domain or protocol://domain:port)');
      return;
    }

    setSigningIn(true);
    setAuthError('');

    const effectiveTlsServername = signinTlsServername.trim() || extractHostname(trimmedBase) || null;

    try {
      const signin = await window.electronAPI.startManagedClientSignin({
        baseUrl: trimmedBase || null,
        signinPageUrl: trimmedSignin || null,
      });
      const effectiveBaseUrl = resolveManagedBaseUrl(signinBaseUrl, signin.baseUrl);

      const next = await window.electronAPI.saveManagedClientBaseUrlAndStart({
        baseUrl: effectiveBaseUrl,
        signinPageUrl: trimmedSignin || null,
        tlsServername: effectiveTlsServername,
        token: signin.token,
      });

      setManagedClient(next);
      setShowSignInForm(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-lg font-bold text-white tracking-tight">{appTitle}</h1>
          <div className="mt-2">
            <StatusBadge
              mode={managedClient.mode}
              running={isManagedClientMode ? managedClient.running : status.running}
              port={status.port}
              needsBaseUrl={managedClient.needsBaseUrl}
            />
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

        <div className="border-t border-slate-800 p-4 space-y-3">
          {isManagedMcpWsMode && sessionLabel && (
            <div className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {t('status.currentUser')}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-slate-100" title={sessionLabel}>
                {sessionLabel}
              </div>
              {sessionDetail && (
                <div className="mt-0.5 truncate text-xs text-slate-400" title={sessionDetail}>
                  {sessionDetail}
                </div>
              )}
            </div>
          )}
          {showManagedSignIn && (
            <button
              onClick={openManagedSignInForm}
              disabled={signingIn}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {signingIn ? t('settings.signingIn') : t('settings.signIn')}
            </button>
          )}
          {showManagedSignOut && (
            <button
              onClick={async () => {
                setSigningOut(true);
                setAuthError('');
                try {
                  const next = await window.electronAPI.signOutManagedClient();
                  setManagedClient(next);
                } finally {
                  setSigningOut(false);
                }
              }}
              disabled={signingOut}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut className="h-4 w-4" />
              {signingOut ? t('settings.signingOut') : t('settings.signOut')}
            </button>
          )}
          {authError && (
            <div className="text-xs text-red-400">{authError}</div>
          )}
          <div className="text-xs text-slate-500 space-y-1">
            {isManagedMcpWsMode && managedClient.connectionId && (
              <div className="truncate" title={managedClient.connectionId}>
                {t('status.connectionId', { id: managedClient.connectionId })}
              </div>
            )}
            {!isManagedClientMode && t('status.activeConnections', { count: status.activeConnections })}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-950 p-6 flex justify-center">
        <div className="w-full max-w-4xl">
          <Outlet />
        </div>
      </main>

      {showSignInForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/60">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-white">Sign in with browser</div>
                <p className="mt-1 text-sm text-slate-400">
                  Fill in the client sign-in form first, then continue to the browser login page.
                </p>
              </div>
              <button
                onClick={() => {
                  if (!signingIn) {
                    setShowSignInForm(false);
                    setAuthError('');
                  } else {
                    window.electronAPI.cancelManagedClientSignin();
                    setSigningIn(false);
                    setAuthError('Sign-in was cancelled. You can edit the form and try again.');
                  }
                }}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">MCP Hub Endpoint <span className="ml-1 text-red-400">*</span></label>
                  <Input
                    type="text"
                    value={signinBaseUrl}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setSigninBaseUrl(event.target.value)}
                    placeholder="wss://dev3.societas-test.microsoft.com"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">Sign-in Page URL <span className="ml-1 text-red-400">*</span></label>
                  <Input
                    type="text"
                    value={signinPageUrl}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setSigninPageUrl(event.target.value)}
                    placeholder="https://dev3.societas-test.microsoft.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-500">TLS Server Name <span className="ml-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">optional</span></label>
                <Input
                  type="text"
                  value={signinTlsServername}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSigninTlsServername(event.target.value)}
                  placeholder={extractHostname(signinBaseUrl) || 'Auto-derived from base URL'}
                />
                <p className="text-xs text-slate-500">
                  Auto-derived from MCP Hub Endpoint if left empty. Override only when the TLS certificate uses a different hostname.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs leading-5 text-slate-300">
                The browser will open only after you confirm this form. If the sign-in page returns a base URL, the client will use it. Otherwise it falls back to the value entered here.
              </div>

              {authError && (
                <div className="rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                  {authError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    if (signingIn) {
                      window.electronAPI.cancelManagedClientSignin();
                      setSigningIn(false);
                      setAuthError('Sign-in was cancelled. You can edit the form and try again.');
                    } else {
                      setShowSignInForm(false);
                      setAuthError('');
                    }
                  }}
                  className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleManagedSignIn}
                  disabled={signingIn}
                  className="inline-flex items-center justify-center rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
                >
                  {signingIn ? 'Waiting for browser sign-in...' : 'Continue In Browser'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
