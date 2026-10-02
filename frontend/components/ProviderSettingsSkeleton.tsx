'use client';

const block = 'rounded-lg bg-white/[.07]';
const panel = 'rounded-2xl border border-white/[.08] bg-[#161616]';

function Node() {
  return <div className="orchestration-node"><div className={`${block} h-full aspect-square rounded-full`} /><div className="orchestration-node-label"><div className={`${block} h-2.5 w-16 max-w-full`} /><div className={`${block} mt-1 h-2 w-20 max-w-full`} /></div></div>;
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
    <div aria-hidden="true" className="space-y-5 animate-pulse motion-reduce:animate-none">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="space-y-2"><div className={`${block} h-5 w-32`} /><div className={`${block} h-2.5 w-28`} /></div><div className={`${block} h-9 ${view === 'providers' ? 'w-40' : 'w-9'}`} /></div>
      {view === 'providers' ? <>
        <div className={`${panel} divide-y divide-white/[.06]`}><Row /><Row /><Row /><div className="flex h-11 items-center justify-center"><div className={`${block} size-4`} /></div></div>
        <div className={panel}><Row large /></div><div className={panel}><Row large /></div><div className={panel}><Row large /></div>
      </> : view === 'orchestration' ? <div className="orchestration-panel overflow-hidden rounded-2xl border border-white/[.08]">
        <div className="flex gap-2 border-b border-white/[.06] p-5">{[0, 1, 2].map(id => <div key={id} className={`${block} size-14 rounded-2xl`} />)}</div>
        <div className="orchestration-canvas px-3 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
          <div className="orchestration-network">
            <svg className="orchestration-connections" viewBox="0 0 600 600" preserveAspectRatio="none"><path d="M300 72 V480 M90 276 H510" /></svg>
            <div className="orchestration-position orchestration-primary" style={{ left: '50%', top: '46%' }}><Node /></div>
            {[{ x: 50, y: 12 }, { x: 85, y: 46 }, { x: 50, y: 80 }, { x: 15, y: 46 }].map(({ x, y }, id) => <div key={id} className="orchestration-position" style={{ left: `${x}%`, top: `${y}%` }}><Node /></div>)}
          </div>
        </div>
        <div className="border-t border-white/[.06] p-5"><div className={`${block} h-10 w-full`} /></div>
      </div> : <>
        <div className={`${panel} space-y-4 p-5`}><div className={`${block} h-3 w-14`} /><div className={`${block} h-10 w-full`} /></div>
        <div className={`${panel} p-5`}><div className="flex gap-3 overflow-hidden py-5">{[0, 1, 2].map(id => <div key={id} className={`${panel} min-w-28 flex-1`}><Row /></div>)}</div></div>
        <div className={`${panel} divide-y divide-white/[.06]`}><Row /><Row /><div className="p-4"><div className={`${block} h-10 w-full`} /></div></div>
      </>}
    </div>
  </div>;
}
