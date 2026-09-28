"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, MessageSquare, Pin, X } from 'lucide-react';
import ConversationActions, { type ChatFolder } from './ConversationActions';

export type HistoryConversation = { id: string; title: string; created_at: string; folder_id: string | null };
export default function ChatHistoryOverlay({ open, onClose, conversations, folders, pinnedIds, loading, activeId, onSelect, onPin, onMove, onDelete, error }: {
  open: boolean; onClose: () => void; conversations: HistoryConversation[]; folders: ChatFolder[];
  pinnedIds: string[]; loading: boolean; activeId: string | null; onSelect: (id: string) => void;
  onPin: (id: string) => void; onMove: (id: string, folderId: string | null) => void; onDelete: (id: string) => void; error?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!mounted || !node) return;
    if (open && !node.open) { setQuery(''); node.showModal(); }
    if (!open && node.open) node.close();
  }, [open, mounted]);
  const filtered = conversations.filter(chat => (chat.title || 'New chat').toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [
    { name: 'Pinned', chats: filtered.filter(chat => pinnedIds.includes(chat.id)) },
    { name: 'Recent', chats: filtered.filter(chat => !pinnedIds.includes(chat.id)) },
  ];
  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} aria-labelledby="recent-chats-title" onCancel={onClose} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="void-chat-history fixed inset-0 m-auto w-[min(640px,calc(100vw-2rem))] max-h-[min(720px,85dvh)] overflow-visible rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm dark:border-white/10 dark:bg-[#202020] dark:text-gray-100">
    <div className="flex max-h-[min(720px,85dvh)] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between px-5 pb-4 pt-5 sm:px-6">
        <div><h2 id="recent-chats-title" className="text-lg font-semibold tracking-tight">Recent Chats</h2><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Pick up where you left off.</p></div>
        <button autoFocus type="button" aria-label="Close recent chats" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-500 dark:hover:bg-white/10"><X size={18} /></button>
      </div>
      <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 dark:border-white/10 dark:bg-[#272727] sm:mx-6">
        <Search size={16} className="shrink-0 text-gray-500" />
        <input aria-label="Search recent chats" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your chats" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-gray-500" />
      </div>
      {error && <p role="alert" className="px-6 pb-3 text-xs text-gray-600 dark:text-gray-300">{error}</p>}
      <div className="min-h-24 overflow-y-auto overscroll-contain px-3 pb-5 sm:px-4">
        {loading ? <p role="status" className="px-3 py-6 text-sm text-gray-500">Loading chats…</p> : !filtered.length ? <p className="px-3 py-8 text-center text-sm text-gray-500">{query ? 'No chats match your search.' : 'Your conversations will appear here.'}</p> : groups.map(group => group.chats.length > 0 && <section key={group.name} aria-label={group.name}>
          <h3 className="px-3 pb-2 pt-3 text-[11px] font-medium uppercase tracking-wider text-gray-500">{group.name}</h3>
          {group.chats.map(chat => <div key={chat.id} className={`mb-1 flex items-center gap-1 rounded-xl px-1 ${activeId === chat.id ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/[.035] dark:hover:bg-white/[.04]'}`}>
            <button type="button" onClick={() => { onSelect(chat.id); onClose(); }} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-500">
              {pinnedIds.includes(chat.id) ? <Pin size={16} className="shrink-0 text-gray-500" /> : <MessageSquare size={16} className="shrink-0 text-gray-500" />}
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{chat.title || 'New chat'}</span><span className="mt-0.5 block truncate text-xs text-gray-500">{folders.find(folder => folder.id === chat.folder_id)?.name || 'Conversation'}</span></span>
            </button>
            <ConversationActions title={chat.title} folderId={chat.folder_id} pinned={pinnedIds.includes(chat.id)} folders={folders} onPin={() => onPin(chat.id)} onMove={folder => onMove(chat.id, folder)} onDelete={() => onDelete(chat.id)} />
          </div>)}
        </section>)}
      </div>
      <p className="shrink-0 border-t border-gray-200 px-6 py-3 text-[11px] text-gray-500 dark:border-white/10">Pins are saved on this device.</p>
    </div>
  </dialog>, document.body);
}
