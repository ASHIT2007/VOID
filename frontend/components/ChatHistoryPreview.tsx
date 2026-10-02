"use client";
import { useState } from 'react';
import ChatHistoryOverlay, { type HistoryConversation } from './ChatHistoryOverlay';
import VoidWordmark from './VoidWordmark';
export default function ChatHistoryPreview() {
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chats, setChats] = useState<HistoryConversation[]>([
    { id: 'one', title: 'World War II presentation', created_at: '2026-09-26', folder_id: null },
    { id: 'two', title: 'Hindi and English conversation', created_at: '2026-09-26', folder_id: null },
    { id: 'three', title: 'Comparing monthly sales', created_at: '2026-09-25', folder_id: 'work' },
  ]);
  return <main className="min-h-screen bg-gray-50 p-6 text-gray-900 dark:bg-[#1e1e1e] dark:text-gray-100">
    <h1 className="mb-4 flex items-center" aria-label="VOID"><VoidWordmark width={106} decorative /></h1>
    <button onClick={() => setOpen(true)} className="rounded-xl border border-gray-300 px-4 py-3 text-sm dark:border-white/15">Recent Chats</button>
    {selected && <p role="status" className="mt-4 text-sm">Selected {chats.find(chat => chat.id === selected)?.title}</p>}
    <ChatHistoryOverlay open={open} onClose={() => setOpen(false)} conversations={chats} folders={[{ id: 'work', name: 'Work' }, { id: 'research', name: 'Research' }]} pinnedIds={pins} loading={false} activeId={selected} onSelect={setSelected}
      onPin={id => setPins(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id])}
      onMove={(id, folder) => setChats(values => values.map(chat => chat.id === id ? { ...chat, folder_id: folder } : chat))}
      onDelete={id => setChats(values => values.filter(chat => chat.id !== id))} />
  </main>;
}
