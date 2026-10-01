'use client';

import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

export type VoidSelectOption = { value: string; label: ReactNode; description?: string; icon?: ReactNode; disabled?: boolean; group?: string };
type Props = SelectHTMLAttributes<HTMLSelectElement> & { options?: VoidSelectOption[]; leading?: ReactNode; placeholder?: string };

function readOptions(children: ReactNode, group?: string): VoidSelectOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean; label?: string }>(child)) return [];
    if (child.type === 'optgroup') return readOptions(child.props.children, child.props.label);
    if (child.type === 'option') return [{ value: String(child.props.value ?? ''), label: child.props.children, disabled: child.props.disabled, group }];
    return [];
  });
}

/** A styled listbox backed by a real select for existing change handlers and forms. */
export default function VoidSelect({ options, leading, placeholder = 'Choose an option', children, className = '', style, ...props }: Props) {
  const items = options ?? readOptions(children);
  const selected = items.find(item => item.value === String(props.value ?? props.defaultValue ?? ''));
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const reduced = useReducedMotion();

  const updatePosition = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const upwards = below < 240 && above > below;
    const maxHeight = Math.max(48, Math.min(300, upwards ? above : below));
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: upwards ? Math.max(12, rect.top - Math.min(maxHeight, (menu.current?.scrollHeight ?? maxHeight)) - 8) : rect.bottom + 8, width, maxHeight });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const option = menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)') ?? menu.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    option?.focus({ preventScroll: true });
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) updatePosition(); };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', scroll, true); };
  }, [open, updatePosition]);

  const choose = (value: string) => {
    if (!native.current || trigger.current?.matches(':disabled')) return;
    native.current.value = value;
    native.current.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false);
    trigger.current?.focus();
  };
  return <div className="relative min-w-0">
    <select {...props} ref={native} hidden tabIndex={-1} aria-hidden="true">
      {items.map(item => <option key={item.value} value={item.value} disabled={item.disabled}>{typeof item.label === 'string' ? item.label : item.value}</option>)}
    </select>
    <button ref={trigger} type="button" id={props.id ? `${props.id}-trigger` : undefined} disabled={props.disabled} aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      style={style} onClick={() => setOpen(!open)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setOpen(true); } }}
      className={`void-select-trigger flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left text-xs ${className}`}>
      <span className="flex min-w-0 items-center gap-2.5">{leading ?? selected?.icon}<span className="truncate">{selected?.label ?? placeholder}</span></span>
      <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence>{open && <motion.div ref={menu} id={id} role="listbox" aria-label={props['aria-label'] || 'Options'}
      initial={reduced ? false : { opacity: 0, y: -4, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .98 }} transition={{ duration: reduced ? 0 : .16 }}
      style={position} className={`void-menu fixed z-[10000] overflow-y-auto p-1.5 ${className.includes('text-white') ? 'void-menu-dark' : ''}`}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); trigger.current?.focus(); if (event.key === 'Escape') event.preventDefault(); return; }
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) buttons.find(button => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
      }}>
      {items.map((item, index) => <div key={item.value}>
        {item.group && item.group !== items[index - 1]?.group && <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider opacity-50">{item.group}</div>}
        <button type="button" role="option" aria-selected={item.value === selected?.value} disabled={item.disabled} onClick={() => choose(item.value)} className="void-menu-option flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs disabled:opacity-40">
          {item.icon}<span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{item.description && <span className="mt-1 block text-[11px] opacity-50">{item.description}</span>}</span>{item.value === selected?.value && <Check size={14} className="shrink-0 opacity-70" />}
        </button>
      </div>)}
      {!items.length && <p className="p-3 text-xs opacity-50">No options available</p>}
    </motion.div>}</AnimatePresence>, document.body)}
  </div>;
}
