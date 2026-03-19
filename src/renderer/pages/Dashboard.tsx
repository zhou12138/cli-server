import { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Activity, Clock } from 'lucide-react';

interface SessionInfo {
  sessionId: string;
  command: string;
  state: string;
  exitCode: number | null;
  startedAt: string;
  durationMs: number;
  clientIp: string;
}

interface AuditEntry {
  id: string;
  command: string;
  exitCode: number | null;
  timestamp: string;
  durationMs: number;
  clientIp: string;
}

interface ServerStatus {
  running: boolean;
  port: number;
  activeConnections: number;
}

export default function Dashboard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<ServerStatus>({ running: false, port: 19876, activeConnections: 0 });
  const [liveSessions, setLiveSessions] = useState<SessionInfo[]>([]);
  const [recentEntries, setRecentEntries] = useState<AuditEntry[]>([]);
  const [totalAudit, setTotalAudit] = useState(0);

  const refresh = useCallback(() => {
    window.electronAPI.getServerStatus().then(setStatus);
    window.electronAPI.getSessions({ state: 'running', limit: 50 }).then(({ data }) => {
      setLiveSessions(data);
    });
    window.electronAPI.getAuditEntries({ limit: 10 }).then(({ entries, total }) => {
      setRecentEntries(entries);
      setTotalAudit(total);
    });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    const unsub = window.electronAPI.onServerEvent(() => refresh());
    return () => { clearInterval(interval); unsub(); };
  }, [refresh]);

  const statusVariant = (exitCode: number | null, state?: string) => {
    if (state === 'running') return 'info';
    if (exitCode === null) return 'warning';
    if (exitCode === 0) return 'success';
    return 'destructive';
  };

  const statusLabel = (exitCode: number | null, state?: string) => {
    if (state === 'running') return t('dashboard.running');
    if (exitCode === null) return t('dashboard.killed');
    return t('dashboard.exit', { code: exitCode });
  };

  return (
    <div className="space-y-6 max-w-4xl">
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

      {/* Running Sessions */}
      {liveSessions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-blue-400 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            {t('dashboard.runningSessions')}
          </h3>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('audit.colCommand')}</TableHead>
                  <TableHead className="w-[80px]">{t('audit.colExit')}</TableHead>
                  <TableHead className="w-[100px]">{t('audit.colDuration')}</TableHead>
                  <TableHead className="w-[120px]">{t('audit.colClient')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveSessions.map((s) => (
                  <TableRow key={s.sessionId}>
                    <TableCell>
                      <code className="text-xs font-mono text-slate-200">{s.command}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="info">{t('dashboard.running')}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{s.durationMs}ms</TableCell>
                    <TableCell className="text-xs text-slate-500">{s.clientIp}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Recent Sessions (from audit log — survives restart) */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {t('dashboard.recentSessions')}
        </h3>
        {recentEntries.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-600">
              {t('dashboard.noSessions')}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">{t('audit.colTime')}</TableHead>
                  <TableHead>{t('audit.colCommand')}</TableHead>
                  <TableHead className="w-[80px]">{t('audit.colExit')}</TableHead>
                  <TableHead className="w-[100px]">{t('audit.colDuration')}</TableHead>
                  <TableHead className="w-[120px]">{t('audit.colClient')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-slate-500">
                      {new Date(entry.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs font-mono text-slate-200">{entry.command}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(entry.exitCode)}>
                        {statusLabel(entry.exitCode)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{entry.durationMs}ms</TableCell>
                    <TableCell className="text-xs text-slate-500">{entry.clientIp}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
