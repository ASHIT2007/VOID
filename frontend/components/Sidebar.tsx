"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, MessageSquare, LogOut, PanelLeft, Trash2, Search, Folder, Settings, Code, Briefcase, Download, Sun, Moon, ChevronRight, ChevronDown, Copy, Activity, RefreshCcw, CheckCircle2, FolderPlus, X, ChevronsRight, ChevronsLeft, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "./ThemeProvider";

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  folder_id: string | null;
};

type FolderType = {
  id: string;
  name: string;
};

type SnippetType = {
  id: string;
  title: string;
  language: string;
  code: string;
};

interface SidebarProps {
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  activeConversationId: string | null;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  onOpenSettings: (tab?: "general" | "models" | "display" | "account") => void;
  refreshKey: number;
  userName?: string;
  avatarUrl?: string | null;
  sessionUsage?: { 
    llama3_3_pro: { prompt: number, completion: number, total: number },
    llama3_1_fast: { prompt: number, completion: number, total: number },
    flux_v1: { generated: number }
  };
}

export default function Sidebar({ 
  onNewChat, 
  onSelectConversation, 
  onDeleteConversation,
  activeConversationId,
  isCollapsed, 
  toggleCollapse, 
  onOpenSettings,
  refreshKey,
  userName = "U",
  avatarUrl = null,
  sessionUsage = { 
    llama3_3_pro: { prompt: 0, completion: 0, total: 0 },
    llama3_1_fast: { prompt: 0, completion: 0, total: 0 },
    flux_v1: { generated: 0 }
  }
}: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [snippets, setSnippets] = useState<SnippetType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<string>("chat");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isRecentExpanded, setIsRecentExpanded] = useState(true);
  const [folderMenuOpenId, setFolderMenuOpenId] = useState<string | null>(null);
  const [previewSnippet, setPreviewSnippet] = useState<SnippetType | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    async function fetchData() {
      const { data: convs } = await supabase
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (convs) setConversations(convs);

      const { data: fData } = await supabase.from('folders').select('*').order('created_at', { ascending: false });
      if (fData) setFolders(fData);

      const { data: sData } = await supabase.from('snippets').select('*').order('created_at', { ascending: false });
      if (sData) setSnippets(sData);

      setIsLoading(false);
    }
    
    fetchData();
  }, [refreshKey]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const submitCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    
    const { data, error } = await supabase.from('folders').insert([{ name: newFolderName.trim(), user_id: session.user.id }]).select().single();
    if (data && !error) {
      setFolders([data, ...folders]);
      setIsCreatingFolder(false);
      setNewFolderName("");
    }
  };

  const deleteFolder = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this folder? Conversations inside will be kept outside.")) return;
    
    // Remove folder_id from all conversations inside this folder in DB
    await supabase.from('conversations').update({ folder_id: null }).eq('folder_id', id);
    
    // Delete folder
    await supabase.from('folders').delete().eq('id', id);
    
    // Update local state
    setFolders(folders.filter(f => f.id !== id));
    setConversations(conversations.map(c => c.folder_id === id ? { ...c, folder_id: null } : c));
  };

  const deleteSnippet = async (id: string) => {
    await supabase.from('snippets').delete().eq('id', id);
    setSnippets(snippets.filter(s => s.id !== id));
  };

  const toggleFolder = (id: string) => setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));

  const moveConversationToFolder = async (convId: string, folderId: string | null) => {
    const { error } = await supabase.from('conversations').update({ folder_id: folderId }).eq('id', convId);
    setFolderMenuOpenId(null);
  };

  const handleOpenSettings = (tab?: "general" | "models" | "display" | "account") => {
    onOpenSettings(tab);
    if (typeof window !== "undefined" && window.innerWidth < 640 && !isCollapsed) {
      toggleCollapse();
    }
  };

  // Filter logic
  const displayedConversations = conversations.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <>
      {/* Mobile Drawer Backdrop Overlay */}
      {!isCollapsed && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] sm:hidden"
          onClick={toggleCollapse}
        />
      )}

      <div 
        className={`void-sidebar h-full bg-gray-50 dark:bg-[#1A1A1A] border-r border-gray-200 dark:border-[#2A2A2A] flex flex-col shrink-0 transition-all duration-300 ease-in-out ${
          isCollapsed 
            ? 'hidden sm:flex w-16 min-w-[64px] z-30 relative' 
            : 'fixed inset-y-0 left-0 w-[270px] min-w-[270px] z-[90] sm:z-30 sm:relative shadow-2xl sm:shadow-none'
        }`}
      >
      <AnimatePresence mode="wait">
        {isCollapsed ? (
          <motion.div 
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.2 }}
            className="w-16 h-full flex flex-col items-center py-4"
          >
            <div className="relative group mb-6">
              <motion.button
                onClick={toggleCollapse} 
                className="p-2.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-xl hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors"
                title="Expand Sidebar"
              >
                <PanelLeft size={20} />
              </motion.button>
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                Expand Sidebar
              </div>
            </div>

            <div className="relative group mb-4">
              <motion.button
                onClick={onNewChat} 
                className="p-2 rounded-full bg-gray-200 dark:bg-[#3A3A3A] text-gray-700 dark:text-gray-300 hover:bg-gray-300 hover:text-gray-900 dark:hover:text-white dark:hover:bg-gray-600 transition-colors"
              >
                <Plus size={20} />
              </motion.button>
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                New Chat
              </div>
            </div>
            
            <div className="flex flex-col gap-4 mt-2">
              <div className="relative group">
                <motion.button
                  onClick={() => { setActiveTab("search"); toggleCollapse(); }} 
                  className={`p-2 rounded-lg transition-colors ${activeTab === "search" ? "bg-gray-200 dark:bg-[#2A2A2A]" : "hover:bg-gray-200 dark:hover:bg-[#2A2A2A]"}`}
                >
                  <Search size={20} className="text-gray-500" />
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Search
                </div>
              </div>

              <div className="relative group">
                <motion.button
                  onClick={() => { setActiveTab("chat"); toggleCollapse(); }} 
                  className={`p-2 rounded-lg transition-colors ${activeTab === "chat" ? "bg-gray-200 dark:bg-[#2A2A2A]" : "hover:bg-gray-200 dark:hover:bg-[#2A2A2A]"}`}
                >
                  <MessageSquare size={20} className="text-gray-500" />
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Recent Chats
                </div>
              </div>

              <div className="relative group">
                <motion.button
                  onClick={() => { setActiveTab("folders"); toggleCollapse(); }} 
                  className={`p-2 rounded-lg transition-colors ${activeTab === "folders" ? "bg-gray-200 dark:bg-[#2A2A2A]" : "hover:bg-gray-200 dark:hover:bg-[#2A2A2A]"}`}
                >
                  <Folder size={20} className="text-gray-500" />
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Folders
                </div>
              </div>

              <div className="relative group">
                <motion.button
                  onClick={() => { setActiveTab("code"); toggleCollapse(); }} 
                  className={`p-2 rounded-lg transition-colors ${activeTab === "code" ? "bg-gray-200 dark:bg-[#2A2A2A]" : "hover:bg-gray-200 dark:hover:bg-[#2A2A2A]"}`}
                >
                  <Code size={20} className="text-gray-500" />
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Code Snippets
                </div>
              </div>
            </div>

            <div className="flex-1" />

            <div className="flex flex-col items-center gap-3 shrink-0">
              <div className="relative group">
                <motion.button 
                  onClick={toggleTheme} 
                  className="p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] rounded-lg transition-colors"
                >
                  {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Toggle Theme
                </div>
              </div>

              <div className="relative group">
                <motion.button
                  onClick={() => handleOpenSettings()} 
                  className="p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] rounded-lg transition-colors"
                >
                  <Settings size={20} />
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Settings
                </div>
              </div>

              <div className="relative group mb-2">
                <motion.button
                  onClick={() => handleOpenSettings("account")} 
                  className="w-10 h-10 rounded-full bg-[#D4D0C5] flex items-center justify-center font-semibold text-xl text-gray-900 border-2 border-transparent hover:border-gray-500 transition-all shadow-md overflow-hidden"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    userName.charAt(0).toUpperCase()
                  )}
                </motion.button>
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-[#333] text-gray-100 text-[13px] font-medium px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-sm border border-[#444] transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0">
                  Profile
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.2 }}
            className="w-[260px] h-full flex flex-col shrink-0"
          >
            <div className="p-4 border-b border-gray-200 dark:border-[#2A2A2A] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3 text-gray-900 dark:text-gray-100">
                <h1 className="text-3xl font-tiny5 tracking-[0.15em] uppercase text-gray-900 dark:text-white select-none">VOID</h1>
              </div>
              <div className="flex items-center gap-1">
                <motion.button 
                  onClick={toggleTheme} 
                  className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#2A2A2A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                >
                  {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                </motion.button>
                <motion.button 
                  onClick={toggleCollapse} 
                  className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#2A2A2A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors" 
                  title="Collapse Sidebar"
                >
                  <PanelLeft size={18} />
                </motion.button>
              </div>
            </div>
            
            <div className="p-4 shrink-0">
              <motion.button onClick={onNewChat} className="w-full flex items-center gap-2 bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-white text-white dark:text-gray-900 px-4 py-3 rounded-lg transition-colors font-medium shadow-sm"><Plus size={18} /> New Chat</motion.button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <div className="flex flex-col gap-1 mb-6">
                <motion.button onClick={() => setActiveTab("chat")} className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg transition-colors text-sm font-medium ${activeTab === "chat" ? "bg-gray-200 dark:bg-[#2A2A2A] text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] hover:text-gray-900 dark:hover:text-gray-100"}`}><MessageSquare size={16} /> Recent Chats</motion.button>
                <motion.button onClick={() => setActiveTab("search")} className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg transition-colors text-sm font-medium ${activeTab === "search" ? "bg-gray-200 dark:bg-[#2A2A2A] text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] hover:text-gray-900 dark:hover:text-gray-100"}`}><Search size={16} /> Search</motion.button>
                <motion.button onClick={() => setActiveTab("folders")} className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg transition-colors text-sm font-medium ${activeTab === "folders" ? "bg-gray-200 dark:bg-[#2A2A2A] text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] hover:text-gray-900 dark:hover:text-gray-100"}`}><Folder size={16} /> Folders</motion.button>
                <motion.button onClick={() => setActiveTab("code")} className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg transition-colors text-sm font-medium ${activeTab === "code" ? "bg-gray-200 dark:bg-[#2A2A2A] text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] hover:text-gray-900 dark:hover:text-gray-100"}`}><Code size={16} /> Code Snippets</motion.button>
              </div>

              {(activeTab === "chat" || activeTab === "search") && (
                <div 
                  className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-2 flex justify-between items-center cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  onClick={() => setIsRecentExpanded(!isRecentExpanded)}
                >
                  <div className="flex items-center gap-1">
                    {isRecentExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>Recent</span>
                  </div>
                </div>
              )}
              
              {activeTab === "search" && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="px-2 mb-4">
                  <input 
                    type="text" 
                    placeholder="Filter chats..." 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white dark:bg-[#2A2A2A] border border-gray-200 dark:border-[#3A3A3A] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </motion.div>
              )}

              {activeTab === "folders" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-2 mb-4">
                  {!isCreatingFolder ? (
                    <motion.button onClick={() => setIsCreatingFolder(true)} className="w-full flex justify-center items-center gap-2 px-3 py-1.5 bg-gray-800 dark:bg-[#2A2A2A] text-white hover:bg-gray-700 dark:hover:bg-[#333] rounded-lg text-sm transition-colors mb-4"><Plus size={14} /> New Folder</motion.button>
                  ) : (
                    <div className="mb-4">
                      <form onSubmit={(e) => { e.preventDefault(); submitCreateFolder(); }} className="flex gap-1">
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          placeholder="Folder name..."
                          className="flex-1 min-w-0 w-full bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333] rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsCreatingFolder(false);
                              setNewFolderName('');
                            }
                          }}
                        />
                        <button type="submit" disabled={!newFolderName.trim()} className="shrink-0 p-1.5 bg-gray-800 dark:bg-[#2A2A2A] text-white rounded-lg hover:bg-gray-700 dark:hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center">
                          <Check size={14} />
                        </button>
                        <button type="button" onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }} className="shrink-0 p-1.5 bg-red-500/10 text-red-500 dark:bg-red-500/20 dark:text-red-400 rounded-lg hover:bg-red-500/20 dark:hover:bg-red-500/30 transition-colors flex items-center justify-center">
                          <X size={14} />
                        </button>
                      </form>
                    </div>
                  )}
                  {folders.map(folder => (
                    <div key={folder.id} className="mb-2">
                      <div className="group flex items-center justify-between w-full">
                        <button onClick={() => toggleFolder(folder.id)} className="flex-1 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 font-medium py-1 text-left">
                          {expandedFolders[folder.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <Folder size={14} className="text-yellow-500 fill-yellow-500" /> {folder.name}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }} className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-500/10 dark:hover:bg-red-500/20 text-gray-400 hover:text-red-500 transition-all shrink-0" title="Delete Folder">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <AnimatePresence>
                        {expandedFolders[folder.id] && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="pl-6 space-y-1 mt-1 border-l-2 border-gray-200 dark:border-[#3A3A3A] ml-2 overflow-hidden">
                            {conversations.filter(c => c.folder_id === folder.id).map(conv => (
                              <div key={conv.id} className="group flex items-center justify-between">
                                <button onClick={() => onSelectConversation(conv.id)} className="block flex-1 text-left truncate text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white py-1 pr-2">
                                  {conv.title}
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); moveConversationToFolder(conv.id, null); }} className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all shrink-0" title="Remove from folder">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                            {conversations.filter(c => c.folder_id === folder.id).length === 0 && <div className="text-xs text-gray-400 py-1 italic">Empty folder</div>}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </motion.div>
              )}

              {activeTab === "code" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-2 mb-4 space-y-2">
                  {snippets.length === 0 ? <div className="text-xs text-gray-400 italic">No snippets saved.</div> : snippets.map(snippet => (
                    <div 
                      key={snippet.id} 
                      className="w-full bg-white dark:bg-[#2A2A2A] border border-gray-200 dark:border-[#3A3A3A] rounded-lg p-2 flex flex-col hover:border-blue-500 dark:hover:border-blue-500 transition-colors text-left overflow-hidden relative group"
                    >
                      <div 
                        className="flex justify-between items-center w-full cursor-pointer"
                        onClick={() => setPreviewSnippet(snippet)}
                        title="Click to preview"
                      >
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate pr-2">{snippet.title}</span>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(snippet.code);
                              const el = e.currentTarget;
                              const original = el.innerHTML;
                              el.innerHTML = '<span class="text-[10px] text-blue-500 font-medium">Copied</span>';
                              setTimeout(() => { el.innerHTML = original; }, 1500);
                            }}
                            className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-[#3A3A3A] hover:text-blue-500 transition-colors shrink-0"
                            title="Copy code"
                          >
                            <Copy size={12} />
                          </button>
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              deleteSnippet(snippet.id); 
                            }} 
                            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all shrink-0"
                            title="Delete Snippet"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-500 uppercase mt-1">{snippet.language}</span>
                    </div>
                  ))}
                </motion.div>
              )}

              {(activeTab === "chat" || activeTab === "search") && (
                <AnimatePresence>
                  {isLoading ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-gray-500 px-2 animate-pulse">Loading...</motion.div> : displayedConversations.length === 0 ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-gray-500 px-2">No active conversations.</motion.div> : isRecentExpanded && displayedConversations.map((conv, i) => (
                    <motion.div 
                      key={conv.id} 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                      className="flex flex-col"
                    >
                      <div className={`group flex items-center justify-between rounded-lg transition-colors ${activeConversationId === conv.id ? "bg-gray-200 dark:bg-[#2A2A2A] text-gray-900 dark:text-gray-100" : "hover:bg-gray-200 dark:hover:bg-[#2A2A2A] text-gray-600 dark:text-gray-400"}`}>
                        <button onClick={() => onSelectConversation(conv.id)} className="flex-1 flex items-center gap-3 text-left px-3 py-3 overflow-hidden">
                          <MessageSquare size={16} className={activeConversationId === conv.id ? "text-gray-900 dark:text-gray-100" : "text-gray-500"} />
                          <span className="truncate text-sm font-medium">{conv.title || "New Conversation"}</span>
                        </button>
                        <div className="flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity pr-1">
                          <button onClick={(e) => { e.stopPropagation(); setFolderMenuOpenId(folderMenuOpenId === conv.id ? null : conv.id); }} className="p-1.5 rounded-md hover:bg-gray-300 dark:hover:bg-[#3A3A3A] text-gray-500 hover:text-blue-500 transition-colors" title="Move to Folder">
                            <FolderPlus size={14} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }} className="p-1.5 rounded-md hover:bg-gray-300 dark:hover:bg-[#3A3A3A] text-gray-500 hover:text-red-500 transition-colors" title="Delete Chat">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <AnimatePresence>
                        {folderMenuOpenId === conv.id && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }} 
                            animate={{ height: "auto", opacity: 1 }} 
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden bg-gray-100 dark:bg-[#1E1E1E] rounded-lg mt-1 border border-gray-200 dark:border-[#3A3A3A]"
                          >
                            <div className="p-1 space-y-0.5 max-h-40 overflow-y-auto">
                              {conv.folder_id && (
                                <button onClick={() => moveConversationToFolder(conv.id, null)} className="w-full text-left px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] rounded transition-colors italic flex items-center gap-2">
                                  <Folder size={12} className="opacity-50" />
                                  Remove from folder
                                </button>
                              )}
                              {folders.map(f => (
                                <button key={f.id} onClick={() => moveConversationToFolder(conv.id, f.id)} className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors flex items-center gap-2 ${conv.folder_id === f.id ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#2A2A2A]"}`}>
                                  <Folder size={12} />
                                  <span className="truncate flex-1">{f.name}</span>
                                  {conv.folder_id === f.id && <CheckCircle2 size={12} />}
                                </button>
                              ))}
                              {folders.length === 0 && <div className="px-2 py-1 text-xs text-gray-400 italic">No folders created</div>}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              </div>
              
              <div className="p-4 border-t border-gray-200 dark:border-[#2A2A2A] flex flex-col gap-1 shrink-0">
                <motion.button onClick={() => handleOpenSettings()} className="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 transition-colors text-sm font-medium"><Settings size={16} /> Settings</motion.button>
                <motion.button onClick={handleSignOut} className="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 transition-colors text-sm font-medium"><LogOut size={16} /> Sign Out</motion.button>
              </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Code Snippet Modal */}
      <AnimatePresence>
        {previewSnippet && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewSnippet(null)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#333] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#1A1A1A]">
                <div className="flex flex-col">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white tracking-tight">{previewSnippet.title}</h2>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{previewSnippet.language}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={(e) => {
                      navigator.clipboard.writeText(previewSnippet.code);
                      const el = e.currentTarget;
                      const original = el.innerHTML;
                      el.innerHTML = '<span class="text-xs text-blue-500 font-medium px-1">Copied</span>';
                      setTimeout(() => { el.innerHTML = original; }, 1500);
                    }}
                    className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#333] rounded-lg transition-colors flex items-center justify-center"
                    title="Copy code"
                  >
                    <Copy size={16} />
                  </button>
                  <button onClick={() => setPreviewSnippet(null)} className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#333] rounded-lg transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto bg-[#1e1e1e] p-4 text-[13px] md:text-sm custom-scrollbar">
                <SyntaxHighlighter
                  language={previewSnippet.language.toLowerCase() === 'html' ? 'xml' : previewSnippet.language.toLowerCase()}
                  style={vscDarkPlus}
                  showLineNumbers={false}
                  customStyle={{ margin: 0, background: 'transparent' }}
                  wrapLines={true}
                >
                  {previewSnippet.code}
                </SyntaxHighlighter>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
}
