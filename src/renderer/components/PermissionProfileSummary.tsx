import { Link } from 'react-router-dom';
import { Badge } from './ui/badge';
import type { BuiltInToolsPermissionProfile } from '../../main/builtin-tools/types';

interface PermissionProfileSummaryProps {
  title: string;
  description: string;
  currentLabel: string;
  currentProfileLabel: string;
  currentProfile: BuiltInToolsPermissionProfile;
  linkLabel: string;
  extraLines?: string[];
}

export default function PermissionProfileSummary({
  title,
  description,
  currentLabel,
  currentProfileLabel,
  currentProfile,
  linkLabel,
  extraLines = [],
}: PermissionProfileSummaryProps) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-300">
      <div className="space-y-2">
        <div>
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="mt-1 text-slate-500">{description}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">{currentLabel}</span>
          <Badge variant="info">{currentProfileLabel}</Badge>
        </div>
        {extraLines.map((line) => (
          <div key={line} className="text-slate-500">
            {line}
          </div>
        ))}
        <Link
          to="/permissions"
          className="inline-flex items-center rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-900"
        >
          {linkLabel}
        </Link>
      </div>
    </div>
  );
}