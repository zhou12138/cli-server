import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
  const { t } = useI18n();
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

  const exitVariant = (code: number | null) => {
    if (code === null) return 'warning';
    if (code === 0) return 'success';
    return 'destructive';
  };

  const exitLabel = (code: number | null) => {
    if (code === null) return t('dashboard.killed');
    return String(code);
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">{t('audit.title')}</h2>
        <span className="text-xs text-slate-500">{t('audit.totalEntries', { total })}</span>
      </div>

      <Input
        type="text"
        placeholder={t('audit.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead className="w-[150px]">{t('audit.colTime')}</TableHead>
              <TableHead>{t('audit.colCommand')}</TableHead>
              <TableHead className="w-[70px]">{t('audit.colExit')}</TableHead>
              <TableHead className="w-[90px]">{t('audit.colDuration')}</TableHead>
              <TableHead className="w-[120px]">{t('audit.colClient')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-600">
                  {search ? t('audit.noMatching') : t('audit.noEntries')}
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <React.Fragment key={entry.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-slate-800/50"
                    onClick={() => toggleExpand(entry.id)}
                  >
                    <TableCell className="px-2">
                      {expandedId === entry.id
                        ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                        : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {new Date(entry.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs font-mono text-slate-200">{entry.command}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={exitVariant(entry.exitCode)}>
                        {exitLabel(entry.exitCode)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{entry.durationMs}ms</TableCell>
                    <TableCell className="text-xs text-slate-500">{entry.clientIp}</TableCell>
                  </TableRow>
                  {expandedId === entry.id && (
                    <TableRow key={`${entry.id}-detail`}>
                      <TableCell colSpan={6} className="bg-slate-900/40 px-6 py-3">
                        <div className="space-y-2">
                          <div>
                            <span className="text-xs text-slate-500">{t('audit.workingDirectory')}: </span>
                            <code className="text-xs text-slate-300">{entry.cwd}</code>
                          </div>
                          {entry.stdout && (
                            <div>
                              <div className="text-xs text-slate-500 mb-1">{t('audit.stdout')}</div>
                              <pre className="output-pre">{entry.stdout}</pre>
                            </div>
                          )}
                          {entry.stderr && (
                            <div>
                              <div className="text-xs text-red-400/70 mb-1">{t('audit.stderr')}</div>
                              <pre className="output-pre !text-red-400">{entry.stderr}</pre>
                            </div>
                          )}
                          {!entry.stdout && !entry.stderr && (
                            <div className="text-xs text-slate-600 py-1">{t('audit.noOutput')}</div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
