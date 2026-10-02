'use client';

const block = 'rounded-lg bg-white/[.07]';
const panel = 'rounded-2xl border border-white/[.08] bg-[#161616]';

function Node() {
  return <div className="orchestration-node !cursor-default">
    <div className="orchestration-provider-icon" />
    <div className="orchestration-node-label">
      <div className={`${block} h-2.5 w-16 max-w-full`} />
      <div className={`${block} mt-1 h-2 w-20 max-w-full`} />
    </div>
  </div>;
}

const network = [{ x: 50, y: 12 }, { x: 85, y: 46 }, { x: 50, y: 80 }, { x: 15, y: 46 }];

function OrchestrationSkeleton() {
  return <>
    <div className="orchestration-panel overflow-hidden rounded-2xl border border-white/10">
      <div className="border-b border-white/[.06] p-4 sm:p-5">
        <div className="flex h-8 items-center justify-between gap-3">
          <div className={`${block} h-2.5 w-12`} />
          <div className="flex gap-1">{[0, 1].map(id => <div key={id} className={`${block} size-8`} />)}</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[0, 1, 2].map(id => <div key={id} className={`${block} size-14 rounded-2xl`} />)}
        </div>
      </div>
      <div className="orchestration-canvas px-3 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
        <div className="orchestration-network" data-node-count={network.length}>
          <svg className="orchestration-connections" viewBox="0 0 600 600" preserveAspectRatio="none">
            {network.map(({ x, y }, id) => <path key={id} d={`M300 276 L${x * 6} ${y * 6}`} />)}
          </svg>
          <div className="orchestration-position orchestration-primary" style={{ left: '50%', top: '46%' }}><Node /></div>
          {network.map(({ x, y }, id) => <div key={id} className="orchestration-position" style={{ left: `${x}%`, top: `${y}%` }}><Node /></div>)}
        </div>
        <div className="flex justify-center pt-1"><div className={`${block} size-8`} /></div>
      </div>
      <div className="border-t border-white/[.08] p-4 sm:p-5">
        <div className="mb-3 flex h-4 items-center"><div className={`${block} h-3 w-14`} /></div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {[0, 1].map(id => <div key={id} className="space-y-2"><div className={`${block} h-3 w-12`} /><div className={`${block} h-11 w-full rounded-xl`} /></div>)}
        </div>
      </div>
    </div>
    <div className="flex justify-end border-t border-white/10 pt-4"><div className={`${block} size-10 rounded-xl`} /></div>
  </>;
}

function Row({ large = false }: { large?: boolean }) {
  return <div className="flex items-center gap-3 p-4">
    <div className={`${block} ${large ? 'size-11 rounded-xl' : 'size-8'} shrink-0`} />
    <div className="min-w-0 flex-1 space-y-2"><div className={`${block} h-3 w-24 max-w-full`} /><div className={`${block} h-2 w-16`} /></div>
    <div className={`${block} h-5 w-8 rounded-full`} />
  </div>;
}

export default function ProviderSettingsSkeleton({ view }: { view: 'providers' | 'orchestration' | 'routing' }) {
  return <div role="status" aria-label={`Loading ${view === 'providers' ? 'AI providers' : view} settings`} aria-busy="true" className="mx-auto max-w-2xl space-y-5 pb-8">
    <span className="sr-only">Loading settings</span>
    <div aria-hidden="true" className={`${view === 'orchestration' ? 'space-y-6' : 'space-y-5'} animate-pulse motion-reduce:animate-none`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view === 'providers' ? <div className="space-y-2"><div className={`${block} h-5 w-32`} /><div className={`${block} h-2.5 w-28`} /></div> : <div className="flex items-center gap-3"><div className={`${block} size-5`} /><div className={`${block} h-5 w-32`} /></div>}
        <div className={`${block} h-9 ${view === 'providers' ? 'w-40' : 'w-9'}`} />
      </div>
      {view === 'providers' ? <>
        <div className={`${panel} divide-y divide-white/[.06]`}><Row /><Row /><Row /><div className="flex h-11 items-center justify-center"><div className={`${block} size-4`} /></div></div>
        <div className={panel}><Row large /></div><div className={panel}><Row large /></div><div className={panel}><Row large /></div>
      </> : view === 'orchestration' ? <OrchestrationSkeleton /> : <>
        <div className={`${panel} space-y-4 p-5`}><div className={`${block} h-3 w-14`} /><div className={`${block} h-10 w-full`} /></div>
        <div className={`${panel} p-5`}><div className="flex gap-3 overflow-hidden py-5">{[0, 1, 2].map(id => <div key={id} className={`${panel} min-w-28 flex-1`}><Row /></div>)}</div></div>
        <div className={`${panel} divide-y divide-white/[.06]`}><Row /><Row /><div className="p-4"><div className={`${block} h-10 w-full`} /></div></div>
      </>}
    </div>
  </div>;
}
