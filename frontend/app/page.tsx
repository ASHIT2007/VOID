"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import ChatInterface from "@/components/ChatInterface";
import { Mail, Lock, ArrowRight, ShieldCheck, Cpu, Terminal, Sparkles } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import SettingsPage from "@/components/SettingsPage";
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
        const storagePath = `migrated/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        const { data, error } = await supabase.storage
          .from("chat-attachments")
          .upload(storagePath, new Blob([bytes], { type: attachment.type || "application/octet-stream" }), {
            contentType: attachment.type || "application/octet-stream",
            upsert: false,
          });
        if (error || !data) return attachment;
        const { data: publicData } = supabase.storage.from("chat-attachments").getPublicUrl(data.path);
        return {
          name: attachment.name || safeName,
          type: attachment.type || "application/octet-stream",
          url: publicData.publicUrl,
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

    const fetchUsageData = async (userId: string) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('tokens_llama3_3_pro, tokens_llama3_1_fast, images_flux_v1, queries_voice, avatar_url')
        .eq('id', userId)
        .single();
      
      if (data && !error) {
        if (data.avatar_url) setAvatarUrl(data.avatar_url);
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

      setIsAuthenticated(!!session);
      if (session?.user) {
        const nameCandidate = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email;
        setUserName(extractFirstName(nameCandidate));
        void fetchUsageData(session.user.id);
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
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-[#1E1E1E]">
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

const DynamicAsciiOverlay = ({ showLoginPane, onTogglePane }: { showLoginPane: boolean; onTogglePane: () => void }) => {
  const topRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLButtonElement>(null);
  
  // Track showLoginPane in a ref for the render loop
  const showLoginRef = useRef(showLoginPane);
  useEffect(() => {
    showLoginRef.current = showLoginPane;
  }, [showLoginPane]);
  
  useEffect(() => {
    let animationFrameId: number;
    
    const baseText = [
      " ██╗   ██╗ ██████╗ ██╗██████╗ ",
      " ██║   ██║██╔═══██╗██║██╔══██╗",
      " ██║   ██║██║   ██║██║██║  ██║",
      " ╚██╗ ██╔╝██║   ██║██║██║  ██║",
      "  ╚████╔╝ ╚██████╔╝██║██████╔╝",
      "   ╚═══╝   ╚═════╝ ╚═╝╚═════╝ "
    ];
    
    const renderAscii = () => {
      const time = performance.now() * 0.001;
      const isPaneOpen = showLoginRef.current;
      
      // Top VOID Logo Glitch
      if (topRef.current) {
          const scanY = Math.floor((Math.sin(time * 1.5) * 0.5 + 0.5) * baseText.length);
          let voidStr = "";
          for(let i=0; i<baseText.length; i++) {
              let line = baseText[i];
              if (i === scanY || (Math.random() > 0.95)) {
                  let glitched = "";
                  for(let c=0; c<line.length; c++) {
                      if (line[c] === '█') {
                          glitched += Math.random() > 0.5 ? '▓' : '▒';
                      } else if (line[c] === ' ' && Math.random() > 0.9) {
                          glitched += Math.random() > 0.5 ? '.' : '-';
                      } else {
                          glitched += line[c];
                      }
                  }
                  voidStr += glitched + "\n";
              } else {
                  voidStr += line + "\n";
              }
          }
          topRef.current.textContent = voidStr;
      }

      // Bottom Terrifying Text
      if (bottomRef.current) {
          let scary = isPaneOpen ? "R E T U R N" : "E N T E R   T H E   V O I D";
          if (Math.random() > 0.92) {
              const chars = "!<>-_\\\\/[]{}—=+*^?#_";
              const arr = scary.split('');
              const numGlitches = isPaneOpen ? 2 : 3;
              for(let i=0; i<numGlitches; i++) {
                 let idx = Math.floor(Math.random() * arr.length);
                 if (arr[idx] !== ' ') {
                     arr[idx] = chars[Math.floor(Math.random() * chars.length)];
                 }
              }
              scary = arr.join('');
          }
          bottomRef.current.textContent = scary;
          
          if (Math.random() > 0.95) {
             bottomRef.current.style.opacity = (Math.random() * 0.5 + 0.3).toString();
             bottomRef.current.style.color = '#ffffff';
             bottomRef.current.style.textShadow = '0 0 15px rgba(255,255,255,0.6)';
             bottomRef.current.style.transform = `translate(${Math.random()*2-1}px, ${Math.random()*2-1}px)`;
          } else {
             bottomRef.current.style.opacity = '0.7';
             bottomRef.current.style.color = '#ffffff';
             bottomRef.current.style.textShadow = '0 0 15px rgba(255,255,255,0.2)';
             bottomRef.current.style.transform = 'translate(0px, 0px)';
          }
      }
      
      animationFrameId = requestAnimationFrame(renderAscii);
    };
    
    animationFrameId = requestAnimationFrame(renderAscii);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div id="ascii-overlay-wrapper" className={`hidden lg:flex lg:flex-col lg:items-center lg:justify-center min-h-screen absolute top-0 bottom-0 left-0 transition-all duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] z-10 pointer-events-none ${showLoginPane ? 'w-1/2' : 'w-full'}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
        .pixel-font { font-family: 'VT323', monospace; image-rendering: pixelated; }
      `}</style>
      <pre 
        ref={topRef} 
        className="absolute top-[12%] xl:top-[15%] text-white/50 font-mono text-[9px] xl:text-[10px] leading-tight text-center tracking-widest whitespace-pre drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]"
      />
      <button 
        ref={bottomRef}
        onClick={onTogglePane}
        className="absolute bottom-[10%] xl:bottom-[12%] text-[15px] xl:text-[17px] tracking-[0.5em] text-center whitespace-pre uppercase transition-all duration-300 cursor-pointer pointer-events-auto border border-white/20 hover:border-white hover:text-white hover:scale-105 px-8 py-4 rounded bg-black/40 backdrop-blur-sm drop-shadow-[0_0_10px_rgba(255,255,255,0.2)] pixel-font"
        style={{ textShadow: '0 0 15px rgba(255,255,255,0.2)' }}
      />
    </div>
  );
};

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [showLoginPane, setShowLoginPane] = useState(false);

  // Dynamic Native Avatar fetching from Supabase
  useEffect(() => {
    setAvatarError(false);
    
    const fetchAvatar = async () => {
      const trimmedEmail = email.trim().toLowerCase();
      if (trimmedEmail.length > 2 && trimmedEmail.includes("@")) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('avatar_url')
            .eq('email', trimmedEmail)
            .single();
            
          if (data && data.avatar_url && !error) {
            setAvatarUrl(data.avatar_url);
          } else {
            setAvatarUrl(null);
          }
        } catch (e) {
          setAvatarUrl(null);
        }
      } else {
        setAvatarUrl(null);
      }
    };
    
    // Debounce the network request by 500ms so it doesn't fire on every keystroke
    const timeoutId = setTimeout(fetchAvatar, 500);
    return () => clearTimeout(timeoutId);
  }, [email]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    
    if (isForgotPassword) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/update-password',
      });
      if (error) setError(error.message);
      else {
        setSuccessMsg("Password reset link sent! Check your email.");
        setTimeout(() => setIsForgotPassword(false), 3000);
      }
    } else if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      // Enforce one account per email: check if email already exists in profiles
      const trimmedEmail = email.trim().toLowerCase();
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', trimmedEmail)
        .maybeSingle();

      if (existingProfile) {
        setError("An account with this email already exists. Please sign in instead.");
        setLoading(false);
        return;
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        // Catch Supabase's own duplicate detection as well
        if (signUpError.message?.toLowerCase().includes("already registered") || signUpError.message?.toLowerCase().includes("already been registered")) {
          setError("An account with this email already exists. Please sign in instead.");
        } else {
          setError(signUpError.message);
        }
      } else if (signUpData?.user?.identities?.length === 0) {
        // Supabase returns empty identities when email already exists (with email confirmation enabled)
        setError("An account with this email already exists. Please sign in instead.");
      } else {
        setSuccessMsg("Check your email to verify your account!");
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:block bg-black text-white font-sans relative overflow-x-hidden">
      {/* Minimal Void & AI Neural Background */}
      <VoidBackground showLoginPane={showLoginPane} />
      
      {/* Left Area (Dynamic ASCII Logo Overlay & Art Spacer) */}
      <DynamicAsciiOverlay showLoginPane={showLoginPane} onTogglePane={() => setShowLoginPane(!showLoginPane)} />

      {/* Right Area (Glassmorphic Pane) */}
      <div className={`w-full lg:w-1/2 min-h-screen flex items-center justify-center p-4 sm:p-6 relative lg:absolute lg:right-0 lg:top-0 z-20 lg:bg-[#0a0a0c]/50 lg:border-l lg:border-white/[0.05] lg:rounded-l-[40px] lg:shadow-[-30px_0_80px_rgba(0,0,0,0.8)] overflow-hidden transition-all duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] transform ${showLoginPane ? 'lg:translate-x-0 lg:opacity-100' : 'lg:translate-x-[110%] lg:opacity-0'}`}>
        
        {/* Subtle AI-themed Inner Grid & Gradient Accents */}
        <div className="hidden lg:block absolute inset-0 pointer-events-none opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.2) 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="hidden lg:block absolute -top-40 -right-40 w-96 h-96 bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />
        <div className="hidden lg:block absolute -bottom-40 -left-40 w-96 h-96 bg-white/[0.02] rounded-full blur-[100px] pointer-events-none" />

        {/* Minimal Sleek Glassmorphic Card */}
        <div className="w-full max-w-[340px] sm:max-w-[380px] p-6 sm:p-8 bg-[#0e0e11]/90 border border-white/[0.08] rounded-2xl sm:rounded-[24px] shadow-[0_0_60px_rgba(0,0,0,0.85)] flex flex-col items-center relative z-20 backdrop-blur-xl">
        
        {/* Avatar / App Logo */}
        <div className="mb-4 relative w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center bg-[#16161a] border border-white/15 shadow-[0_0_20px_rgba(255,255,255,0.06)] overflow-hidden p-0.5">
          <div className="w-full h-full rounded-full overflow-hidden bg-[#121216] flex items-center justify-center">
            {avatarUrl && !avatarError ? (
              <img 
                src={avatarUrl} 
                alt="User DP" 
                className="w-full h-full object-cover animate-fade-in" 
                onError={() => setAvatarError(true)}
              />
            ) : (
              <div className="w-full h-full p-2 flex items-center justify-center bg-transparent">
                <img src="/void logo white.png" alt="App Logo" className="w-full h-full object-contain" />
              </div>
            )}
          </div>
        </div>

        {/* Clean Header */}
        <h2 className="text-xl sm:text-2xl font-bold mb-1 text-center tracking-tight text-white">
          {isForgotPassword ? "Reset password" : isLogin ? "Welcome back" : "Create an account"}
        </h2>
        <p className="text-gray-400 text-xs mb-5 text-center font-normal leading-relaxed">
          {isForgotPassword 
            ? "Enter your email to receive a password reset link." 
            : isLogin 
              ? "Enter your credentials to access your workspace." 
              : "Sign up to start conversing with AI."}
        </p>
        
        {/* Error / Success Banners */}
        {error && (
          <div className="w-full bg-[#1c1414] border border-red-500/30 text-red-400 p-2.5 rounded-xl mb-4 text-xs text-center">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="w-full bg-[#141c16] border border-green-500/30 text-green-400 p-2.5 rounded-xl mb-4 text-xs text-center">
            {successMsg}
          </div>
        )}
        
        {/* Form Inputs */}
        <form onSubmit={handleAuth} className="w-full space-y-3">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <Mail className="h-4 w-4 text-gray-500 group-focus-within:text-white transition-colors" />
            </div>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full bg-[#141418] text-white rounded-xl pl-10 pr-3.5 py-2.5 sm:py-3 border border-white/[0.08] focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-all placeholder:text-gray-500 text-xs sm:text-sm"
              required
            />
          </div>

          {!isForgotPassword && (
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-gray-500 group-focus-within:text-white transition-colors" />
              </div>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-[#141418] text-white rounded-xl pl-10 pr-3.5 py-2.5 sm:py-3 border border-white/[0.08] focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/40 transition-all placeholder:text-gray-500 text-xs sm:text-sm"
                required
              />
            </div>
          )}
          
          {isLogin && !isForgotPassword && (
            <div className="flex justify-end mt-0.5 mb-1">
              <button 
                type="button" 
                onClick={() => { setIsForgotPassword(true); setError(null); setSuccessMsg(null); }}
                className="text-[11px] text-gray-400 hover:text-white transition-colors"
              >
                Forgot password?
              </button>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="group w-full flex items-center justify-center gap-2 bg-white text-black py-2.5 sm:py-3 rounded-xl font-medium transition-all shadow-[0_0_20px_rgba(255,255,255,0.08)] disabled:opacity-70 disabled:cursor-not-allowed mt-2 active:scale-[0.99] hover:bg-gray-100 text-xs sm:text-sm"
          >
            {loading ? (
              <span className="flex items-center gap-2 text-xs sm:text-sm">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                Please wait...
              </span>
            ) : (
              <>
                <span>
                  {isForgotPassword 
                    ? "Send Reset Link" 
                    : isLogin 
                      ? "Sign In" 
                      : "Sign Up"}
                </span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>
        
        {/* Clean Mode Switcher */}
        <p className="text-center text-gray-400 mt-5 text-xs font-normal">
          {isForgotPassword ? (
            <>
              Remember your password?{" "}
              <button 
                onClick={() => { setIsForgotPassword(false); setError(null); setSuccessMsg(null); }} 
                className="text-white font-medium hover:underline transition-all ml-0.5"
                type="button"
              >
                Log in
              </button>
            </>
          ) : (
            <>
              {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
              <button 
                onClick={() => { setIsLogin(!isLogin); setError(null); setSuccessMsg(null); }} 
                className="text-white font-medium hover:underline transition-all ml-0.5"
                type="button"
              >
                {isLogin ? "Sign up" : "Log in"}
              </button>
            </>
          )}
        </p>
      </div>
      </div>
    </div>
  );
}

/** 
 * 3D Dithered Celestial System Background
 * - Pure Flat Black Canvas (#000000)
 * - All celestial bodies rendered in high-end 3D Dithered Point-Cloud / Stipple Sphere aesthetic:
 *   1. SATURN: Big round 3D planet sphere with expansive dynamic revolving rings
 *   2. EARTH: 3D revolving continent globe with dynamic orbiting 3D Moon
 *   3. JUPITER: Giant gas sphere with counter-rotating differential atmospheric bands & Great Red Spot
 *   4. SUN / PULSAR: Radiant pulsating star with magnetic solar flare loops & particle discharge
 *   5. NEPTUNE: High-tilt ice giant with dynamic vertical polar ring system & auroral crowns
 * - Word-by-word & point-by-point decryption stream-in on 60-second cycle transition
 * - Fully centered, expansive, zero-lag 60 FPS autonomous animation
 */
function VoidBackground({ showLoginPane }: { showLoginPane: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const showLoginRef = useRef(showLoginPane);

  useEffect(() => {
    showLoginRef.current = showLoginPane;
  }, [showLoginPane]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // --- 3D GALAXY LOGO POINTS ---
    const galaxyPoints: { x: number; y: number; z: number; size: number; alpha: number }[] = [];
    
    // Core of the galaxy (dense bright sphere)
    for(let r = 0.02; r <= 0.15; r += 0.015) {
        let count = Math.floor(r * 500);
        for(let i = 0; i < count; i++) {
            let theta = (i / count) * Math.PI * 2;
            galaxyPoints.push({
                x: r * Math.cos(theta),
                y: (Math.random() - 0.5) * 0.04,
                z: r * Math.sin(theta),
                size: Math.random() * 1.5 + 1.0,
                alpha: Math.random() * 0.5 + 0.5
            });
        }
    }
    
    // Spiral Arms
    const ARMS = 2;
    for (let arm = 0; arm < ARMS; arm++) {
        const offset = (arm / ARMS) * Math.PI * 2;
        // Draw multiple parallel strands per arm to make it thick
        for (let strand = -4; strand <= 4; strand++) {
            const strandOffset = strand * 0.06;
            for (let t = 0; t < 250; t++) {
                const r = 0.22 + (t / 250) * 0.78; // Radius from gap 0.22 to 1.0
                const theta = offset + r * 7 + strandOffset; 
                
                const x = r * Math.cos(theta);
                const z = r * Math.sin(theta);
                
                // Add tiny vertical variance, getting thicker at the edges
                const y = (Math.random() - 0.5) * (0.02 + r * 0.05);
                
                galaxyPoints.push({
                    x, y, z,
                    size: Math.random() * 1.2 + 0.5,
                    alpha: (1.0 - r * 0.6) * (Math.random() * 0.5 + 0.5)
                });
            }
        }
    }
    
    // Ambient dust
    for(let i=0; i<800; i++) {
        const r = Math.pow(Math.random(), 0.5); // More towards center
        const theta = Math.random() * Math.PI * 2;
        galaxyPoints.push({
            x: r * Math.cos(theta),
            y: (Math.random() - 0.5) * 0.15,
            z: r * Math.sin(theta),
            size: Math.random() * 0.8 + 0.2,
            alpha: Math.random() * 0.4
        });
    }

    // Faint Background Stars (Deep space)
    const stars = Array.from({ length: 300 }).map(() => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.5 + 0.3,
      alpha: Math.random() * 0.35 + 0.1,
      speed: Math.random() * 0.02 + 0.005,
      phase: Math.random() * Math.PI * 2,
    }));

    const render = (now: number) => {
      const time = now * 0.001;

      // 1. PURE FLAT BLACK BASE (#000000)
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      // 2. Faint Twinkling Stars
      ctx.save();
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const a = s.alpha * (0.6 + 0.4 * Math.sin(time * s.speed * 60 + s.phase));
        ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 3. Render 3D Galaxy Logo
      const isDesktop = width >= 1024;
      
      let artCenterX = width * 0.5;
      
      if (isDesktop) {
          const overlay = document.getElementById("ascii-overlay-wrapper");
          if (overlay) {
              const rect = overlay.getBoundingClientRect();
              artCenterX = rect.left + (rect.width / 2);
          } else {
              artCenterX = showLoginRef.current ? width * 0.25 : width * 0.5;
          }
      }
      
      const artCenterY = height * 0.5;
      
      // We want the galaxy to fill a good portion of the space
      const scale = isDesktop ? Math.min(width * 0.20, height * 0.35) : Math.min(width, height) * 0.35;

      // Setup rotations
      const tiltX = 35 * (Math.PI / 180); // 35 degrees tilt
      const spinY = time * 0.15; // Slow spin
      
      // Helper to rotate in 3D (Y first, then X)
      const rotate3D = (x: number, y: number, z: number, rotX: number, rotY: number) => {
        // Rotate Y (Spin)
        let x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
        let z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
        // Rotate X (Tilt)
        let y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
        let z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);
        return [x1, y2, z2];
      };

      ctx.save();
      for (let i = 0; i < galaxyPoints.length; i++) {
         const pt = galaxyPoints[i];
         
         const [rx, ry, rz] = rotate3D(pt.x * scale, pt.y * scale, pt.z * scale, tiltX, spinY);
         
         // Add some depth fading
         const depth = (rz + scale) / (scale * 2); 
         // depth goes from 0 (back) to 1 (front) roughly
         const depthAlpha = Math.max(0.05, Math.min(1, pt.alpha * (0.5 + depth * 0.5)));
         
         // To make it look incredibly cool, the core and arms will glow
         ctx.fillStyle = `rgba(255, 255, 255, ${depthAlpha})`;
         ctx.beginPath();
         // Slightly scale dots based on depth
         const renderSize = pt.size * (0.6 + depth * 0.6);
         // Offset removed so it perfectly sits in the center
         ctx.arc(artCenterX + rx, artCenterY + ry, renderSize, 0, Math.PI*2);
         ctx.fill();
      }
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="absolute inset-0 bg-black overflow-hidden pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </div>
  );
}
