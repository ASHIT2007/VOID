'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Brain, Check, ChevronDown, FileImage, Gauge, Lock, Mic, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { PLAN_DETAILS, type AccountPlan } from '@/lib/plans';

const capabilities = [
  { icon: Brain, name: 'Reasoning', free: 'Penumbra · Umbra', pro: 'Includes Tenebrae' },
  { icon: FileImage, name: 'Images & files', free: 'Limited usage', pro: 'Full application access' },
  { icon: Mic, name: 'Voice', free: 'Not included', pro: 'Enabled' },
  { icon: Gauge, name: 'Routing', free: 'Standard priority', pro: 'Highest application priority' },
];

export default function AccountAccessPanel({ accountPlan, onClose }: { accountPlan: AccountPlan; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const admin = accountPlan === 'admin-pro';
  const transition = { duration: reduced ? 0 : .24, ease: 'easeInOut' as const };

  return <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={transition} className="mb-8 overflow-hidden" aria-label="Plans and account access">
    <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4 text-neutral-950 dark:border-white/10 dark:bg-[#151515] dark:text-white sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div><p className="mb-1 text-[10px] uppercase tracking-[.18em] text-neutral-500">Your workspace</p><h3 className="text-lg font-semibold tracking-tight">Plans & access</h3></div>
        <button type="button" aria-label="Close plans and access" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-current"><X size={16} /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <motion.div initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className={`flex min-w-0 flex-col rounded-2xl border bg-white p-5 dark:bg-[#202020] ${!admin ? 'border-neutral-400 dark:border-white/40' : 'border-neutral-200 dark:border-white/10'}`}>
          <div className="mb-5 flex items-center justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 dark:border-white/10"><Brain size={19} strokeWidth={1.5} /></span>{!admin && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium dark:bg-white/10">Current plan</span>}</div>
          <h4 className="text-xl font-semibold tracking-tight">{PLAN_DETAILS.free.name}</h4><p className="mt-1 text-xs text-neutral-500">The essentials, ready to go.</p>
          <ul className="mb-5 mt-5 space-y-3">{PLAN_DETAILS.free.features.map(feature => <li key={feature} className="flex gap-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400"><Check size={13} className="mt-0.5 shrink-0" />{feature}</li>)}</ul>
          <p className="mt-auto border-t border-neutral-200 pt-3 text-[10px] text-neutral-500 dark:border-white/10">Default access for every account</p>
        </motion.div>
        <motion.div initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transition, delay: reduced ? 0 : .05 }} className="flex min-w-0 flex-col rounded-2xl border border-white bg-[#f5f5f5] p-5 text-neutral-950 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-neutral-950 text-white"><ShieldCheck size={19} strokeWidth={1.5} /></span><span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-2.5 py-1 text-[10px] font-medium">{admin ? <Check size={10} /> : <Lock size={10} />}{admin ? 'Active' : 'Admin only'}</span></div>
          <h4 className="text-xl font-semibold tracking-tight">{PLAN_DETAILS.adminPro.name}</h4><p className="mt-1 text-xs text-neutral-500">Every layer of VOID.</p>
          <ul className="mb-5 mt-5 space-y-3">{PLAN_DETAILS.adminPro.features.map(feature => <li key={feature} className="flex gap-2 text-[11px] leading-relaxed text-neutral-700"><Check size={13} className="mt-0.5 shrink-0" />{feature}</li>)}</ul>
          <p className="mt-auto border-t border-black/10 pt-3 text-[10px] text-neutral-500">Reserved for the administrator account</p>
        </motion.div>
      </div>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="account-capabilities" className="mt-3 flex w-full items-center justify-between rounded-xl px-1 py-3 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"><span>Compare access</span><ChevronDown size={14} className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} /></button>
      <motion.div id="account-capabilities" inert={!expanded} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }} transition={transition} className="overflow-hidden">
        <div className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 px-4 dark:divide-white/[.06] dark:border-white/10">
          {capabilities.map(({ icon: Icon, name, free, pro }) => <div key={name} className="grid gap-2 py-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-center"><span className="flex items-center gap-2 text-xs font-medium"><Icon size={14} className="text-neutral-500" />{name}</span><span className="text-[11px] text-neutral-500"><span className="sm:hidden">Free · </span>{free}</span><span className="text-[11px] text-neutral-700 dark:text-neutral-300"><span className="sm:hidden">Pro · </span>{pro}</span></div>)}
        </div>
      </motion.div>
      <p className="mt-3 text-[10px] leading-relaxed text-neutral-500">Provider quotas apply to both plans.</p>
    </div>
  </motion.section>;
}
