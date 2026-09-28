"use client";

import React, { useEffect, useState, useRef } from "react";
import ChatInterface from "@/components/ChatInterface";
import AuthScreen from "@/components/AuthScreen";
import { rememberLoginProfile } from "@/lib/login-profile";
import Sidebar from "@/components/Sidebar";
import SettingsPage from "@/components/SettingsPage";
import { uploadAttachment } from "@/lib/attachment-upload";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

export function extractFirstName(rawNameOrEmail?: string | null): string {
  if (!rawNameOrEmail || typeof rawNameOrEmail !== "string") return "User";
  let name = rawNameOrEmail.trim();
  if (!name) return "User";
  if (name.includes("@")) {
    name = name.split("@")[0];
  }
  const firstWord = name.split(/[\s\._\-\d]/)[0];
  if (!firstWord) return "User";
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
}

async function persistEmbeddedGeneratedImages(content: string): Promise<string> {
  const matches = [...new Set(content.match(/data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+/gi) || [])];
  if (matches.length === 0) return content;
  let compacted = content;
  await Promise.all(matches.map(async (dataUrl) => {
    try {
      const response = await fetch("/api/generated-image/legacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!response.ok) return;
      const result = await response.json();
      if (typeof result.url === "string") compacted = compacted.split(dataUrl).join(result.url);
    } catch (error) {
      console.warn("Could not compact a legacy generated image", error);
    }
  }));
  return compacted;
}

async function persistLegacyAttachmentPayloads(content: string): Promise<string> {
  const marker = content.match(/\[ATTACHMENTS_JSON:\s*(\[[\s\S]*?\])\s*\]/);
  if (!marker || !/"base64"\s*:/.test(marker[1])) return content;

  try {
    const attachments = JSON.parse(marker[1]);
    if (!Array.isArray(attachments)) return content;
    const migrated = await Promise.all(attachments.map(async (attachment: any) => {
      if (!attachment?.base64 || attachment.url) {
        const { base64: _base64, ...compact } = attachment || {};
        return compact;
      }
      try {
        const binary = atob(String(attachment.base64).replace(/\s/g, ""));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const safeName = String(attachment.name || "attachment").replace(/[^\w.\-]+/g, "_");
        const storedUrl = await uploadAttachment(new Blob([bytes], { type: attachment.type || "application/octet-stream" }), safeName);
        return {
          name: attachment.name || safeName,
          type: attachment.type || "application/octet-stream",
          url: storedUrl,
        };
      } catch (error) {
        console.warn("Could not migrate a legacy attachment", error);
        return attachment;
      }
    }));
    return content.replace(marker[0], `[ATTACHMENTS_JSON: ${JSON.stringify(migrated)}]`);
  } catch (error) {
    console.warn("Could not parse legacy attachment metadata", error);
    return content;
  }
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userName, setUserName] = useState<string>("User");
  
  // Lifted Chat State
  const [messages, setMessages] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isIncognito, setIsIncognito] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "models" | "display" | "account">("models");

  const openSettings = (tab: "general" | "models" | "display" | "account" = "models") => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  
  // Trigger to refresh sidebar conversations
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionUsage, setSessionUsage] = useState<any>({
    llama_70b: { prompt: 0, completion: 0, total: 0 },
    llama_3_1_fast: { prompt: 0, completion: 0, total: 0 },
    gemini_1_5_flash: { prompt: 0, completion: 0, total: 0 },
    gpt_oss_120b: { prompt: 0, completion: 0, total: 0 },
    llama_4_scout: { prompt: 0, completion: 0, total: 0 },
    gpt_oss_20b: { prompt: 0, completion: 0, total: 0 },
    flux_v1: { generated: 0 },
    flux_realism: { generated: 0 },
    flux_anime: { generated: 0 },
    flux_3d: { generated: 0 },
    hf_super_realism: { generated: 0 },
    ideogram: { generated: 0 },
    gemini_image: { generated: 0 },
    voice_agent: { queries: 0 }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem("chat_session_usage");
      if (saved) {
        const parsed = JSON.parse(saved);
        setSessionUsage((prev: any) => ({ ...prev, ...parsed }));
      }
    } catch (e) {
      console.error("Failed to load session usage from localStorage", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("chat_session_usage", JSON.stringify(sessionUsage));
  }, [sessionUsage]);

  useEffect(() => {
    let isActive = true;
    let currentUserId: string | null = null;

    const fetchUsageData = async (user: Session['user']) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('tokens_llama3_3_pro, tokens_llama3_1_fast, images_flux_v1, queries_voice, avatar_url')
        .eq('id', user.id)
        .single();
      
      if (isActive && currentUserId === user.id && data && !error) {
        const photo = data.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
        setAvatarUrl(photo);
        if (user.email) rememberLoginProfile(user.email, photo);
        setSessionUsage((prev: any) => ({
          ...prev,
          llama_70b: { ...prev.llama_70b, total: data.tokens_llama3_3_pro || 0 },
          llama_3_1_fast: { ...prev.llama_3_1_fast, total: data.tokens_llama3_1_fast || 0 },
          flux_v1: { ...prev.flux_v1, generated: data.images_flux_v1 || 0 },
          voice_agent: { ...prev.voice_agent, queries: data.queries_voice || 0 }
        }));
      }
    };

    const applySession = (session: Session | null) => {
      if (!isActive) return;

      currentUserId = session?.user.id || null;
      setIsAuthenticated(!!session);
      if (!session) {
        setMessages([]);
        setConversationId(null);
        activeConvIdRef.current = null;
        conversationCacheRef.current.clear();
        migratedImageConversationsRef.current.clear();
        setAvatarUrl(null);
        setIsSettingsOpen(false);
      }
      if (session?.user) {
        const nameCandidate = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email;
        setUserName(extractFirstName(nameCandidate));
        const providerPhoto = session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null;
        setAvatarUrl(providerPhoto);
        if (session.user.email && providerPhoto) rememberLoginProfile(session.user.email, providerPhoto);
        setTimeout(() => { if (isActive) void fetchUsageData(session.user); }, 0);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  // Memory Cache for instant 0ms conversation switching
  const conversationCacheRef = useRef<Map<string, any[]>>(new Map());
  const activeConvIdRef = useRef<string | null>(null);
  const migratedImageConversationsRef = useRef<Set<string>>(new Set());

  // Keep cache synced when messages update for active conversation
  useEffect(() => {
    if (conversationId && messages.length > 0) {
      conversationCacheRef.current.set(conversationId, messages);
    }
  }, [conversationId, messages]);

  useEffect(() => {
    if (!conversationId || messages.length === 0 || migratedImageConversationsRef.current.has(conversationId)) return;
    migratedImageConversationsRef.current.add(conversationId);
    const legacyMessages = messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => typeof message.content === "string" && (
        /data:image\/(?:png|jpeg|webp);base64,/i.test(message.content)
        || /\[ATTACHMENTS_JSON:[\s\S]*?"base64"\s*:/i.test(message.content)
      ));
    if (legacyMessages.length === 0) return;

    void Promise.all(legacyMessages.map(async ({ message, index }) => ({
      index,
      id: message.id,
      original: message.content,
      content: await persistLegacyAttachmentPayloads(await persistEmbeddedGeneratedImages(message.content)),
    }))).then(async (migrations) => {
      setMessages((current) => current.map((message, index) => {
        const migration = migrations.find((candidate) => candidate.index === index && candidate.original === message.content);
        return migration && migration.content !== migration.original ? { ...message, content: migration.content } : message;
      }));
      await Promise.all(migrations
        .filter((migration) => migration.id && migration.content !== migration.original)
        .map((migration) => supabase.from("messages").update({ content: migration.content }).eq("id", migration.id)));
    });
  }, [conversationId, messages]);

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    activeConvIdRef.current = null;
  };

  const handleSelectConversation = async (id: string) => {
    setConversationId(id);
    activeConvIdRef.current = id;

    // 1. Instant Cache Hit (0ms UI Switch)
    if (conversationCacheRef.current.has(id)) {
      setMessages(conversationCacheRef.current.get(id)!);
    } else {
      // Clear old messages so user sees instant transition instead of previous chat
      setMessages([]);
    }

    // 2. Fetch fresh messages in background (Stale-While-Revalidate pattern)
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
        
      if (!error && data) {
        const formatted = data.map(d => ({ 
          id: d.id, 
          role: d.role, 
          content: d.content ?? "",
          attachments: (d as any).attachments || null
        }));
        conversationCacheRef.current.set(id, formatted);
        // Only update active message view if user is still on this conversation
        if (activeConvIdRef.current === id) {
          setMessages(formatted);
        }
      } else if (error) {
        console.error("Error loading conversation messages from Supabase:", error);
      }
    } catch (e) {
      console.error("Error loading conversation messages:", e);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    conversationCacheRef.current.delete(id);
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id);
      
    if (!error) {
      setRefreshKey(prev => prev + 1);
      if (conversationId === id) {
        handleNewChat();
      }
    }
  };

  const handleClearAllChats = async () => {
    conversationCacheRef.current.clear();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase.from('conversations').delete().eq('user_id', session.user.id);
      setRefreshKey(prev => prev + 1);
      handleNewChat();
    }
  };

  if (isAuthenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#252525] text-white">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 rounded-full border-4 border-gray-600 border-t-transparent animate-spin mb-4"></div>
          <p className="text-gray-400 font-medium">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return <AuthScreen />;
  }

  return (
    <main className="flex h-screen w-full bg-gray-50 dark:bg-[#1E1E1E] overflow-hidden text-gray-900 dark:text-gray-100 font-sans">
      <Sidebar 
        onNewChat={handleNewChat} 
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        activeConversationId={conversationId}
        isCollapsed={isSidebarCollapsed} 
        toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
        onOpenSettings={openSettings}
        refreshKey={refreshKey}
        userName={userName}
        avatarUrl={avatarUrl}
        sessionUsage={sessionUsage}
      />
      <div className="flex-1 h-full flex flex-col bg-gray-50 dark:bg-[#1E1E1E] relative overflow-hidden">
        <ChatInterface 
          messages={messages} 
          setMessages={setMessages} 
          conversationId={conversationId} 
          setConversationId={setConversationId}
          isIncognito={isIncognito}
          setIsIncognito={setIsIncognito}
          toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isSidebarCollapsed={isSidebarCollapsed}
          onConversationCreated={() => setRefreshKey(prev => prev + 1)}
          userName={userName}
          onOpenSettings={openSettings}
          sessionUsage={sessionUsage}
          setSessionUsage={setSessionUsage}
        />
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsPage 
          initialTab={settingsInitialTab} 
          onClose={() => setIsSettingsOpen(false)} 
          sessionUsage={sessionUsage}
          onClearChats={handleClearAllChats}
        />
      )}
    </main>
  );
}
