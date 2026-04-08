import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, Trash2 } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

interface ActivityEntry {
  id: string;
  timestamp: string;
  area: string;
  action: string;
  summary: string;
  status: 'success' | 'info' | 'error';
  details?: Record<string, unknown>;
}

const PAGE_SIZE = 20;

export default function Activities() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchEntries = useCallback(() => {
    const offset = (page - 1) * PAGE_SIZE;
    window.electronAPI.getActivityEntries({ offset, limit: PAGE_SIZE, search: appliedSearch || undefined }).then((result) => {
      setEntries(result.entries);
      setTotal(result.total);
    });
  }, [page, appliedSearch]);

  useEffect(() => {
    fetchEntries();
    const unsub = window.electronAPI.onServerEvent((event) => {
      if (event.type === 'activity:appended') {
        fetchEntries();
      }
    });
    return unsub;
  }, [fetchEntries]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch]);

  const toggleExpand = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const statusVariant = (status: ActivityEntry['status']) => {
    if (status === 'error') {
      return 'destructive';
    }

    if (status === 'success') {
      return 'success';
    }

    return 'info';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">{t('activities.title')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{t('activities.totalEntries', { total })}</span>
          {total > 0 && (
            <button
              onClick={async () => {
                if (!window.confirm(t('activities.clearConfirm'))) return;
                await window.electronAPI.clearActivityLog();
                fetchEntries();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 transition-colors hover:text-red-400 hover:bg-red-500/10"
              title={t('activities.clearHistory')}
            >
              <Trash2 className="w-3 h-3" />
              {t('activities.clearHistory')}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder={t('activities.searchPlaceholder')}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setAppliedSearch(searchInput.trim());
            }
          }}
          className="flex-1"
        />
        <button
          onClick={() => setAppliedSearch(searchInput.trim())}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 transition-colors"
        >
          <Search className="w-4 h-4" />
          {t('activities.searchButton')}
        </button>
        <button
          onClick={() => {
            setSearchInput('');
            setAppliedSearch('');
          }}
          className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 transition-colors"
        >
          {t('activities.resetSearch')}
        </button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead className="w-[170px]">{t('activities.colTime')}</TableHead>
              <TableHead className="w-[120px]">{t('activities.colArea')}</TableHead>
              <TableHead className="w-[140px]">{t('activities.colAction')}</TableHead>
              <TableHead>{t('activities.colSummary')}</TableHead>
              <TableHead className="w-[90px]">{t('activities.colStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-600">
                  {appliedSearch ? t('activities.noMatching') : t('activities.noEntries')}
                </TableCell>
              </TableRow>
            ) : entries.map((entry) => (
              <React.Fragment key={entry.id}>
                <TableRow className="cursor-pointer hover:bg-slate-800/50" onClick={() => toggleExpand(entry.id)}>
                  <TableCell className="px-2">
                    {expandedId === entry.id
                      ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                      : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-slate-300">{entry.area}</TableCell>
                  <TableCell className="text-xs text-slate-300">{entry.action}</TableCell>
                  <TableCell className="text-xs text-slate-200">{entry.summary}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(entry.status)}>{t(`activities.status.${entry.status}`)}</Badge>
                  </TableCell>
                </TableRow>
                {expandedId === entry.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-slate-900/40 px-6 py-3">
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500">{t('activities.details')}:</div>
                        <pre className="output-pre">{entry.details ? JSON.stringify(entry.details, null, 2) : t('activities.noDetails')}</pre>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {t('activities.totalEntries', { total })}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(1)}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs text-slate-300">
              {t('activities.pageInfo', { current: page, total: totalPages })}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}