import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { ShieldAlert, Check, CheckCheck, X } from 'lucide-react';

interface PendingApproval {
  requestId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  source: string;
  sourceName: string;
  sessionId: string;
}

export default function ToolCallApprovalDialog() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<PendingApproval[]>([]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onServerEvent((event) => {
      if (event.type === 'tool-call:approval-required' && event.data) {
        const data = event.data as PendingApproval;
        setQueue((prev) => [...prev, data]);
      }
    });
    return unsubscribe;
  }, []);

  const respond = useCallback((requestId: string, decision: 'approve-once' | 'approve-all' | 'reject', sessionId?: string) => {
    window.electronAPI.respondToToolCallApproval(requestId, decision);
    setQueue((prev) => {
      if (decision === 'approve-all' && sessionId) {
        const sameSession = prev.filter((item) => item.requestId !== requestId && item.sessionId === sessionId);
        const otherSession = prev.filter((item) => item.requestId !== requestId && item.sessionId !== sessionId);
        for (const item of sameSession) {
          window.electronAPI.respondToToolCallApproval(item.requestId, 'approve-once');
        }
        return otherSession;
      }
      return prev.filter((item) => item.requestId !== requestId);
    });
  }, []);

  const current = queue[0];
  if (!current) return null;

  const argsPreview = (() => {
    try {
      const text = JSON.stringify(current.arguments, null, 2);
      return text.length > 500 ? `${text.slice(0, 500)}...` : text;
    } catch {
      return '{}';
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
          <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white">{t('approval.title')}</h3>
            {queue.length > 1 && (
              <p className="text-xs text-slate-500 mt-0.5">{t('approval.queueCount', { count: queue.length })}</p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('approval.toolName')}</div>
            <code className="mt-1 block text-sm font-mono text-blue-400">{current.toolName}</code>
          </div>
          {current.sourceName && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('approval.source')}</div>
              <span className="mt-1 block text-xs text-slate-400">{current.sourceName}</span>
            </div>
          )}
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('approval.arguments')}</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300 font-mono">
              {argsPreview}
            </pre>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-3">
          <button
            onClick={() => respond(current.requestId, 'approve-once')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Check className="h-3.5 w-3.5" />
            {t('approval.approveOnce')}
          </button>
          <button
            onClick={() => respond(current.requestId, 'approve-all', current.sessionId)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {t('approval.approveAll')}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => respond(current.requestId, 'reject')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
            {t('approval.reject')}
          </button>
        </div>
      </div>
    </div>
  );
}
