interface StatusBadgeProps {
  running: boolean;
  port: number;
}

export default function StatusBadge({ running, port }: StatusBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2 h-2 rounded-full ${running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'
          }`}
      />
      <span className="text-xs text-slate-400">
        {running ? `Running on :${port}` : 'Stopped'}
      </span>
    </div>
  );
}
