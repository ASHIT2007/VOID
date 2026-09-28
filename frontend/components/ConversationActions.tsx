"use client";

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pin, PinOff, FolderPlus, Folder, Trash2, Check, ChevronLeft } from 'lucide-react';

export type ChatFolder = { id: string; name: string };
export default function ConversationActions({ title, folderId, pinned, folders, onPin, onMove, onDelete }: {
  title: string; folderId: string | null; pinned: boolean; folders: ChatFolder[];
  onPin: () => void; onMove: (folderId: string | null) => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    const resize = () => { setOpen(false); trigger.current?.focus(); };
    window.addEventListener('resize', resize);
    container.current?.addEventListener('keydown', escape);
    container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const node = container.current;
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', resize); node?.removeEventListener('keydown', escape); };
  }, [open, choosingFolder]);
  const action = (callback: () => void) => {
    setOpen(false); setChoosingFolder(false); callback();
    requestAnimationFrame(() => {
      // Pinning moves the row between groups, so its old trigger may unmount.
      const current = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')]
        .find(button => button.getAttribute('aria-label') === `Actions for ${title || 'New chat'}`);
      if (current) current.focus();
      else document.querySelector<HTMLInputElement>('.void-chat-history input')?.focus();
    });
  };
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10';
  return <div ref={container} className="relative shrink-0" onClick={event => event.stopPropagation()}>
    <button ref={trigger} type="button" aria-label={`Actions for ${title || 'New chat'}`} aria-haspopup="menu" aria-expanded={open}
      onClick={() => {
        const rect = trigger.current!.getBoundingClientRect();
        setPosition({ left: Math.max(16, Math.min(rect.right - 208, window.innerWidth - 224)), top: Math.max(16, Math.min(rect.bottom + 4, window.innerHeight - 280)) });
        setOpen(value => !value); setChoosingFolder(false);
      }}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-black/5 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-500 dark:hover:bg-white/10 dark:hover:text-white">
      <MoreHorizontal size={18} />
    </button>
    {open && <div role="menu" aria-label="Chat actions" style={position} className="fixed z-[120] w-52 max-w-[calc(100vw-3rem)] rounded-xl border border-gray-200 bg-white p-1.5 text-gray-700 shadow-xl dark:border-white/10 dark:bg-[#292929] dark:text-gray-200">
      {choosingFolder ? <>
        <button role="menuitem" className={item} onClick={() => setChoosingFolder(false)}><ChevronLeft size={15} /> Back</button>
        <div className="max-h-40 overflow-y-auto">
          {folders.map(folder => <button key={folder.id} role="menuitem" className={item} onClick={() => action(() => onMove(folder.id))}><Folder size={15} /><span className="min-w-0 flex-1 truncate">{folder.name}</span>{folderId === folder.id && <Check size={14} />}</button>)}
          {folderId && <button role="menuitem" className={item} onClick={() => action(() => onMove(null))}><Folder size={15} /> Remove from folder</button>}
          {!folders.length && <p className="px-3 py-2 text-xs leading-relaxed text-gray-500">Create a folder from the sidebar first.</p>}
        </div>
      </> : <>
        <button role="menuitem" className={item} onClick={() => action(onPin)}>{pinned ? <PinOff size={15} /> : <Pin size={15} />}{pinned ? 'Unpin chat' : 'Pin chat'}</button>
        <button role="menuitem" className={item} onClick={() => setChoosingFolder(true)}><FolderPlus size={15} /> Add to folder</button>
        <div className="my-1 border-t border-gray-200 dark:border-white/10" />
        <button role="menuitem" className={item} onClick={() => action(onDelete)}><Trash2 size={15} /> Delete chat</button>
      </>}
    </div>}
  </div>;
}
