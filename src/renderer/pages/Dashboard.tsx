import { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Activity, Clock, XCircle, Trash2 } from 'lucide-react';

interface IOEvent {
  stream: 'stdin' | 'stdout' | 'stderr';
  time: number;
  data: string;
}

interface SessionInfo {
  sessionId: string;
  command: string;
  cwd: string;
  state: string;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  stdoutLength: number;
  stderrLength: number;
  clientIp: string;
}

interface AuditEntry {
  id: string;
  command: string;
  exitCode: number | null;
  timestamp: string;
  durationMs: number;
  clientIp: string;
  stdout: string;
  stderr: string;
  ioEvents?: IOEvent[];
}

interface ServerStatus {
  running: boolean;
  port: number;
  activeConnections: number;
}

interface UnifiedSession {
  id: string;
  command: string;
  state: 'running' | 'exited';
  exitCode: number | null;
  startedAt: string;
  durationMs: number;
  clientIp: string;
  isLive: boolean;
  // For audit entries that have stored IO events
  ioEvents?: IOEvent[];
  // Fallback for old audit entries without ioEvents
  stdout?: string;
  stderr?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// Color classes per stream type
const STREAM_COLORS: Record<string, string> = {
  stdin: 'text-sky-400',
  stdout: 'text-slate-300',
  stderr: 'text-red-400',
};

// Build preview (last 2 non-empty lines from all events merged)
function ioPreview(events: IOEvent[]): { text: string; stream: string }[] {
  const lines: { text: string; stream: string }[] = [];
  for (const ev of events) {
    const parts = ev.data.replace(/\r\n/g, '\n').split('\n');
    for (const p of parts) {
      if (p) lines.push({ text: p, stream: ev.stream });
    }
  }
  return lines.slice(-2);
}

// Fallback: synthesize IO events from plain stdout/stderr strings
function fallbackEvents(stdout?: string, stderr?: string): IOEvent[] {
  const events: IOEvent[] = [];
  if (stdout) events.push({ stream: 'stdout', time: 0, data: stdout });
  if (stderr) events.push({ stream: 'stderr', time: 0, data: stderr });
  return events;
}

// ── Session Card ──
function SessionCard({ session, expanded, onToggle, onKill }: {
  session: UnifiedSession; expanded: boolean; onToggle: () => void; onKill: () => void;
}) {
  const { t } = useI18n();
  const isActive = session.state === 'running';
  const [ioEvents, setIoEvents] = useState<IOEvent[]>(
    session.ioEvents ?? fallbackEvents(session.stdout, session.stderr),
  );

  // Poll IO log for active sessions
  useEffect(() => {
    if (!session.isLive) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const events = await window.electronAPI.readSessionIOLog(session.id);
        if (!cancelled && Array.isArray(events)) setIoEvents(events);
      } catch { /* session may have ended */ }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session.isLive, session.id]);

  const hasOutput = ioEvents.length > 0;
  const preview = ioPreview(ioEvents);

  const statusVariant = isActive ? 'info' : session.exitCode === 0 ? 'success' : session.exitCode === null ? 'warning' : 'destructive';
  const statusLabel = isActive ? t('dashboard.running') : session.exitCode === null ? t('dashboard.killed') : t('dashboard.exit', { code: session.exitCode });

  return (
    <div className={`rounded-lg border transition-colors ${isActive
      ? 'border-blue-500/40 bg-blue-500/5'
      : 'border-surface-700 bg-surface-900'
      }`}>
      {/* Header — entire command area is clickable */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          className="flex-1 min-w-0 cursor-pointer select-none"
          onClick={() => onToggle()}
        >
          <code className={`text-sm font-mono break-all transition-colors ${expanded ? 'text-white' : 'text-slate-200 hover:text-white'
            }`}>{session.command}</code>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
            <span>{new Date(session.startedAt).toLocaleTimeString()}</span>
            <span>{formatDuration(session.durationMs)}</span>
            <span>{session.clientIp}</span>
          </div>
          {/* Collapsed preview — last 2 lines, color-coded */}
          {!expanded && preview.length > 0 && (
            <pre className="mt-2 text-xs font-mono whitespace-pre-wrap line-clamp-2 max-h-10 overflow-hidden">
              {preview.map((l, i) => (
                <span key={i} className={STREAM_COLORS[l.stream] ?? 'text-slate-400'}>
                  {l.text}{i < preview.length - 1 ? '\n' : ''}
                </span>
              ))}
            </pre>
          )}
        </div>

        {/* Status + kill */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          {isActive && (
            <button
              onClick={(e) => { e.stopPropagation(); onKill(); }}
              className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
              title={t('dashboard.kill')}
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded IO timeline — merged by timestamp, color-coded */}
      {expanded && (
        <div className="border-t border-surface-700 px-4 py-3">
          {hasOutput ? (
            <pre className="text-xs font-mono bg-surface-950 rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap">
              {ioEvents.map((ev, i) => (
                <span key={i} className={STREAM_COLORS[ev.stream] ?? 'text-slate-400'}>
                  {ev.data}
                </span>
              ))}
            </pre>
          ) : (
            <p className="text-xs text-slate-600 italic">{isActive ? t('dashboard.waitingForOutput') : t('dashboard.noOutput')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ──
export default function Dashboard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<ServerStatus>({ running: false, port: 19876, activeConnections: 0 });
  const [liveSessions, setLiveSessions] = useState<SessionInfo[]>([]);
  const [recentEntries, setRecentEntries] = useState<AuditEntry[]>([]);
  const [totalAudit, setTotalAudit] = useState(0);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    window.electronAPI.getServerStatus().then(setStatus);
    // Batch both fetches so the unified list updates atomically
    Promise.all([
      window.electronAPI.getSessions({ state: 'running', limit: 50 }),
      window.electronAPI.getAuditEntries({ limit: 20 }),
    ]).then(([sessionsResult, auditResult]) => {
      setLiveSessions(sessionsResult.data as SessionInfo[]);
      setRecentEntries(auditResult.entries as AuditEntry[]);
      setTotalAudit(auditResult.total);
    });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    const unsub = window.electronAPI.onServerEvent(() => refresh());
    return () => { clearInterval(interval); unsub(); };
  }, [refresh]);

  const handleClearHistory = async () => {
    await window.electronAPI.clearAuditLog();
    refresh();
  };

  // Merge live sessions + audit entries, deduplicate, active first
  const liveIds = new Set(liveSessions.map((s) => s.sessionId));
  const unified: UnifiedSession[] = [
    ...liveSessions.map((s): UnifiedSession => ({
      id: s.sessionId,
      command: s.command,
      state: 'running',
      exitCode: null,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
      clientIp: s.clientIp,
      isLive: true,
    })),
    ...recentEntries
      .filter((e) => !liveIds.has(e.id))
      .map((e): UnifiedSession => ({
        id: e.id,
        command: e.command,
        state: 'exited',
        exitCode: e.exitCode,
        startedAt: e.timestamp,
        durationMs: e.durationMs,
        clientIp: e.clientIp,
        isLive: false,
        ioEvents: e.ioEvents,
        stdout: e.stdout,
        stderr: e.stderr,
      })),
  ].slice(0, 20);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">{t('dashboard.title')}</h2>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.serverStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${status.running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
              <span className="text-lg font-bold text-white">
                {status.running ? t('status.running') : t('status.stopped')}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{t('dashboard.port', { port: status.port })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.totalSessions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalAudit}</div>
            <p className="text-xs text-slate-500 mt-1">{t('dashboard.inAuditLog')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.activeSessions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{liveSessions.length}</div>
            <p className="text-xs text-slate-500 mt-1">
              {t('status.activeConnections', { count: status.activeConnections })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Unified Session List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {t('dashboard.recentSessions')}
            {liveSessions.length > 0 && (
              <Badge variant="info" className="ml-2">
                <Activity className="w-3 h-3 mr-1" />
                {liveSessions.length} {t('dashboard.running')}
              </Badge>
            )}
          </h3>
          {totalAudit > 0 && (
            <button
              onClick={handleClearHistory}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={t('dashboard.clearHistory')}
            >
              <Trash2 className="w-3 h-3" />
              {t('dashboard.clearHistory')}
            </button>
          )}
        </div>
        {unified.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-600">
              {t('dashboard.noSessions')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {unified.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                expanded={expandedIds.has(s.id)}
                onToggle={() => toggleExpanded(s.id)}
                onKill={() => window.electronAPI.killSession(s.id).then(refresh)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
