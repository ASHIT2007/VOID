export type EffortInfo = {
  requested: 'auto' | 'low' | 'medium' | 'high';
  effective: 'low' | 'medium' | 'high';
  reason: string;
  agentCount: number;
  searchMode: string;
  simple?: boolean;
};

export default function EffortNotice({ info, recovery }: { info?: EffortInfo; recovery?: string }) {
  if (!info && !recovery) return null;
  const escalated = info?.requested === 'auto' && info.effective === 'high';
  const effortLabel = info ? ({ low: 'Penumbra', medium: 'Umbra', high: 'Tenebrae' } as const)[info.effective] : '';
  return <div className="mb-3 max-w-full text-[11px] leading-relaxed text-gray-500 dark:text-gray-400" role="status">
    {info && <span title={info.reason}>
      {info.requested === 'auto' ? 'Auto · ' : ''}<span>{effortLabel}</span>
      {' · '}{info.agentCount} agent{info.agentCount === 1 ? '' : 's'}
      {escalated && <> · {info.reason}. More time and tokens.</>}
    </span>}
    {recovery && <p className="mt-1">{recovery}</p>}
  </div>;
}
