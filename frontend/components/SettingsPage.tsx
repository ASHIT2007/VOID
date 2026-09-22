"use client";

import { useState, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import NextImage from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, Menu, Sliders, Activity, User, Monitor, CheckCircle2, RefreshCcw, Save, Trash2, Download, LogOut, Upload, Sun, Moon, Mic, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { supabase } from "@/lib/supabase";
import { getUsageKey, LLM_MODELS, IMG_MODELS, getCompanyLogo } from "./ChatInterface";

import { ADMIN_EMAIL, getAccountPlan, isAdminEmail, PLAN_DETAILS } from "@/lib/plans";

interface SessionUsage {
  [key: string]: {
    total?: number;
    generated?: number;
    queries?: number;
  } | undefined;
}

type SettingsTab = "general" | "models" | "display" | "account";

interface SelectOption {
  value: string;
  label: string;
  title?: string;
  desc?: string;
  isPremium?: boolean;
  icon?: ReactNode;
}

function storedSetting(key: string, fallback: string): string {
  return typeof window === "undefined" ? fallback : localStorage.getItem(key) || fallback;
}

const formatNumber = (num: number) => {
  if (!Number.isFinite(num)) return 'Unlimited';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toString();
};

const normalizeTextModel = (_val?: string | null): string => "Auto";

const normalizeImageModel = (val?: string | null): string => {
  if (!val) return "Auto Image";
  if (val === "flux_v1") return "FLUX V1";
  return val;
};

interface SettingsPageProps {
  onClose: () => void;
  sessionUsage?: SessionUsage;
  onClearChats?: () => void;
  initialTab?: "general" | "models" | "display" | "account";
}



function CustomSelect({ value, onChange, options, isPro = true }: { value: string, onChange: (val: string) => void, options: SelectOption[], isPro?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const [menuLayout, setMenuLayout] = useState({ above: false, maxHeight: 240 });
  useLayoutEffect(() => {
    if (!isOpen || !selectRef.current) return;
    const rect = selectRef.current.getBoundingClientRect();
    const panel = selectRef.current.closest("[data-settings-scroll]")?.getBoundingClientRect();
    const below = Math.min(window.innerHeight, panel?.bottom ?? window.innerHeight) - rect.bottom - 16;
    const above = rect.top - Math.max(0, panel?.top ?? 0) - 16;
    const openAbove = below < 200 && above > below;
    setMenuLayout({ above: openAbove, maxHeight: Math.max(100, Math.min(240, openAbove ? above : below)) });
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  return (
    <div className="relative" ref={selectRef} onKeyDown={(event) => {
      if (event.key === "Escape") { setIsOpen(false); selectRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus(); }
    }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            requestAnimationFrame(() => (selectRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]') || selectRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus());
          }
        }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#444] text-gray-900 dark:text-white rounded-xl px-4 py-3 flex items-center justify-between cursor-pointer shadow-sm transition-all text-sm font-medium"
      >
        <span className="flex min-w-0 items-center gap-3">{selectedOption?.icon}<span className="truncate">{selectedOption?.title || selectedOption?.label}</span></span>
        <ChevronDown size={16} className={`text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="listbox"
            aria-label="Model options"
            onKeyDown={(event) => {
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
              if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
            }}
            initial={{ opacity: 0, y: -5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            style={{ maxHeight: menuLayout.maxHeight }}
            className={`absolute z-[100] ${menuLayout.above ? "bottom-full mb-2" : "top-full mt-2"} w-full bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] rounded-xl shadow-xl overflow-hidden py-1 overflow-y-auto`}
          >
            {options.map((opt) => (
              <button
                type="button"
                role="option"
                aria-selected={value === opt.value}
                key={opt.value}
                onClick={() => { onChange(opt.value); setIsOpen(false); selectRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus(); }}
                className={`w-full text-left px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between transition-colors ${value === opt.value ? "bg-gray-50 dark:bg-[#2A2A2A] font-semibold" : "hover:bg-gray-50 dark:hover:bg-[#222]"}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {opt.icon}
                  <div className="flex min-w-0 flex-col">
                  <span className="text-gray-900 dark:text-white">{opt.title || opt.label}</span>
                  {opt.desc && <span className="text-xs text-gray-500">{opt.desc}</span>}
                </div>
                </div>
                {value === opt.value && <CheckCircle2 size={14} className="ml-2 shrink-0 text-gray-500" />}
                {!isPro && opt.isPremium && (
                  <Lock size={12} className="text-gray-400 shrink-0 ml-2" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SettingsPage({ onClose, sessionUsage, onClearChats, initialTab = "models" }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [activeTab]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  const { theme, toggleTheme } = useTheme();

  // Settings States
  const [systemPrompt, setSystemPrompt] = useState(() => storedSetting("systemPrompt", ""));
  const [defaultModel, setDefaultModel] = useState(() => normalizeTextModel(storedSetting("defaultModel", "Auto")));
  const [defaultImageModel, setDefaultImageModel] = useState(() => normalizeImageModel(storedSetting("defaultImageModel", "Auto Image")));
  const [fontSize, setFontSize] = useState(() => storedSetting("fontSize", "medium"));
  const [messageStyle, setMessageStyle] = useState(() => storedSetting("messageStyle", "classic"));
  const [profileDp, setProfileDp] = useState<string | null>(() => storedSetting("profileDp", "") || null);
  const [userEmail, setUserEmail] = useState("Loading...");
  const [showPlanBenefits, setShowPlanBenefits] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Fetch authoritative data from Supabase
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        if (data.user.email) setUserEmail(data.user.email);
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('default_model, system_prompt')
          .eq('id', data.user.id)
          .single();
          
        if (profile) {
          if (profile.default_model) {
            const normText = normalizeTextModel(profile.default_model);
            setDefaultModel(normText);
            localStorage.setItem("defaultModel", normText);
          }
          if (profile.system_prompt) {
            setSystemPrompt(profile.system_prompt);
            localStorage.setItem("systemPrompt", profile.system_prompt);
          }
        }
      }
    });
  }, []);

  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [generalSaved, setGeneralSaved] = useState(false);
  const [generalSaveNote, setGeneralSaveNote] = useState("");
  const [isSavingDisplay, setIsSavingDisplay] = useState(false);
  const [displaySaved, setDisplaySaved] = useState(false);

  const saveGeneral = async () => {
    setIsSavingGeneral(true);
    setGeneralSaved(false);
    setGeneralSaveNote("");
    try {
      localStorage.setItem("systemPrompt", systemPrompt);
      localStorage.setItem("defaultModel", defaultModel);
      localStorage.setItem("defaultImageModel", defaultImageModel);
      
      // Save to Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const payload: Record<string, unknown> = {
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
          default_model: defaultModel,
          system_prompt: systemPrompt
        };
        const { error } = await supabase.from('profiles').upsert(payload);
        if (error) {
          throw error;
        }
      }
      
      setGeneralSaved(true);
      setGeneralSaveNote("Settings saved and applied.");
      window.dispatchEvent(new CustomEvent("settingsUpdated", { detail: { systemPrompt, defaultModel, defaultImageModel } }));
      setTimeout(() => {
        setGeneralSaved(false);
        setGeneralSaveNote("");
      }, 2400);
    } catch (e) {
      console.error(e);
      setGeneralSaveNote("Saved on this device, but cloud sync failed.");
      window.dispatchEvent(new CustomEvent("settingsUpdated", { detail: { systemPrompt, defaultModel, defaultImageModel } }));
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const saveDisplay = () => {
    setIsSavingDisplay(true);
    localStorage.setItem("fontSize", fontSize);
    localStorage.setItem("messageStyle", messageStyle);
    window.dispatchEvent(new CustomEvent("settingsUpdated", { detail: { fontSize, messageStyle } }));
    setDisplaySaved(true);
    setIsSavingDisplay(false);
    setTimeout(() => setDisplaySaved(false), 2400);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleClearChats = () => {
    if (confirm("Are you sure you want to clear all chat history? This cannot be undone.")) {
      if (onClearChats) onClearChats();
    }
  };

  const handleExportData = () => {
    const data = {
      timestamp: new Date().toISOString(),
      usage: sessionUsage,
      settings: { systemPrompt, defaultModel, fontSize, messageStyle }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "void_export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const handleDpUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        setProfileDp(base64String);
        localStorage.setItem("profileDp", base64String);
        
        // Save to Supabase globally
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          await supabase.from('profiles').upsert({ 
            id: user.id, 
            email: user.email, 
            avatar_url: base64String 
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const tabs: Array<{ id: SettingsTab; label: string; icon: typeof Sliders }> = [
    { id: "general", label: "General", icon: Sliders },
    { id: "models", label: "Models & Usage", icon: Activity },
    { id: "display", label: "Display", icon: Monitor },
    { id: "account", label: "Account", icon: User },
  ];
  const isAdmin = isAdminEmail(userEmail);
  const accountPlan = getAccountPlan(userEmail);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex justify-center items-center p-2 sm:p-8"
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-white dark:bg-[#1E1E1E] w-full max-w-5xl h-[92vh] sm:h-[85vh] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#2A2A2A] flex flex-col sm:flex-row overflow-hidden relative"
      >
        {/* Desktop Close Button */}
        <button 
          onClick={onClose}
          className="hidden sm:block absolute top-6 right-6 p-2 text-gray-500 hover:text-gray-900 dark:hover:text-white bg-gray-100 hover:bg-gray-200 dark:bg-[#2A2A2A] dark:hover:bg-[#333] rounded-full transition-colors z-20"
          title="Close Settings"
        >
          <X size={18} />
        </button>

        {/* Mobile Header Bar */}
        <div className="sm:hidden flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-[#151515] border-b border-gray-200 dark:border-[#2A2A2A] shrink-0">
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="flex items-center gap-2.5 px-3 py-1.5 bg-gray-200/80 dark:bg-[#2A2A2A] hover:bg-gray-300 dark:hover:bg-[#333] rounded-xl text-xs font-semibold text-gray-900 dark:text-white transition-all active:scale-95"
          >
            <Menu size={16} />
            <span>{tabs.find(t => t.id === activeTab)?.label}</span>
            <ChevronRight size={14} className="opacity-60" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white bg-gray-200/60 dark:bg-[#2A2A2A] rounded-full transition-colors"
            title="Close Settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mobile Sidebar Drawer Overlay */}
        <AnimatePresence>
          {isMobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 sm:hidden"
                onClick={() => setIsMobileSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed inset-y-0 left-0 w-64 bg-gray-50 dark:bg-[#151515] border-r border-gray-200 dark:border-[#2A2A2A] z-50 p-6 flex flex-col sm:hidden shadow-2xl"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Settings</h2>
                  <button
                    onClick={() => setIsMobileSidebarOpen(false)}
                    className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white bg-gray-200 dark:bg-[#2A2A2A] rounded-full transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-2 flex-1">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setIsMobileSidebarOpen(false);
                        }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm text-left ${
                          isActive
                            ? "bg-gray-900 text-white dark:bg-white dark:text-black shadow-sm font-semibold"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#252525] hover:text-gray-900 dark:hover:text-white"
                        }`}
                      >
                        <Icon size={18} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Desktop Sidebar */}
        <div className="hidden sm:flex w-64 bg-gray-50 dark:bg-[#151515] border-r border-gray-200 dark:border-[#2A2A2A] p-6 flex-col shrink-0">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-8 tracking-tight">Settings</h2>
          <div className="flex flex-col gap-1.5 flex-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all font-medium text-sm ${
                    isActive 
                      ? "bg-gray-900 text-white dark:bg-white dark:text-black shadow-sm" 
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Settings Content */}
        <div ref={contentRef} data-settings-scroll className="flex-1 min-w-0 p-4 sm:p-8 md:p-12 overflow-y-auto bg-white dark:bg-[#1E1E1E] relative">
          <AnimatePresence mode="wait">
            
            {/* GENERAL TAB */}
            {activeTab === "general" && (
              <motion.div key="general" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-3xl mx-auto space-y-8">
                <div>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">General Settings</h3>
                  <p className="text-gray-500 text-sm">Customize how the AI behaves and manages your data.</p>
                </div>
                
                <div className="space-y-6 bg-gray-50 dark:bg-[#1A1A1A] p-6 rounded-xl border border-gray-200 dark:border-[#2A2A2A]">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center justify-between">
                      <span>Default Text Model</span>
                      <span className="text-xs font-normal text-gray-500">Text & Reasoning AI</span>
                    </label>
                    <div className="rounded-xl border border-gray-200 dark:border-[#333] px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Auto</div>
                    <p className="text-xs text-gray-500 mt-2">Routes each request using available providers and retries another when one fails. Each answer shows the model that responded.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center justify-between">
                      <span>Default Image Generation Model</span>
                      <span className="text-xs font-normal text-gray-500">Image & Vision AI</span>
                    </label>
                    <CustomSelect 
                        value={defaultImageModel} 
                        onChange={(val) => setDefaultImageModel(val)} 
                        options={IMG_MODELS.map(m => ({ 
                          value: m.name, 
                          label: m.name,
                          icon: getCompanyLogo(m.name),
                          title: m.name,
                          desc: m.desc,
                          isPremium: true
                        }))} 
                        isPro={true}
                      />
                    <p className="text-xs text-gray-500 mt-2">Your preferred image provider is tried first. Generation can switch providers if it fails; the image shows which model produced it.</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Custom Instructions (System Prompt)</label>
                    <textarea 
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="e.g. Always reply in Markdown. You are a helpful expert..."
                      rows={4}
                      className="w-full bg-white dark:bg-[#222] border border-gray-300 dark:border-[#333] text-gray-900 dark:text-white rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500 transition-colors resize-none"
                    />
                    <p className="text-xs text-gray-500 mt-2">These instructions are passed to the model on every new chat.</p>
                  </div>

                  <div className="flex flex-col items-end gap-2 pt-2">
                    <button onClick={saveGeneral} disabled={isSavingGeneral} className="flex items-center gap-2 bg-gray-900 hover:bg-black dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
                      {generalSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {isSavingGeneral ? "Saving..." : generalSaved ? "Saved!" : "Save Changes"}
                    </button>
                    {generalSaveNote && <p role="status" className="text-xs text-gray-500 dark:text-gray-400">{generalSaveNote}</p>}
                  </div>
                </div>

                <div className="bg-white dark:bg-[#1A1A1A] p-6 rounded-xl border border-red-200 dark:border-red-900/30">
                  <h4 className="text-lg font-bold text-red-600 dark:text-red-500 mb-2 flex items-center gap-2">
                    <Trash2 size={18} /> Danger Zone
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Permanently delete all your chat history and folders.</p>
                  <button onClick={handleClearChats} className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
                    Clear All Chats
                  </button>
                </div>
              </motion.div>
            )}

            {/* MODELS & USAGE TAB */}
            {activeTab === "models" && (
              <motion.div key="models" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-4xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Models & API Usage</h3>
                    <p className="text-gray-500 mt-2 text-sm">Monitor your real-time consumption across active models.</p>
                  </div>
                  <button onClick={handleRefresh} disabled={isRefreshing} className="flex items-center justify-center gap-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-[#2A2A2A] dark:hover:bg-[#333] text-gray-900 dark:text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-70 border border-transparent dark:border-[#3A3A3A]">
                    <RefreshCcw size={14} className={isRefreshing ? "animate-spin" : ""} /> 
                    {isRefreshing ? "Refreshing..." : "Refresh Data"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {LLM_MODELS.map((model) => {
                    const usageKey = getUsageKey(model.name);
                    const usageData = sessionUsage?.[usageKey];
                    return (
                      <div 
                        key={model.name}
                        className="bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-2xl p-6 flex flex-col justify-between hover:border-gray-300 dark:hover:border-[#3A3A3A] transition-colors"
                      >
                        <div className="mb-8">
                          <div className="flex justify-between items-start mb-4">
                            <div
                              className="flex h-9 w-9 items-center justify-center bg-white dark:bg-[#222] rounded-lg border border-gray-200 dark:border-[#333] [&_img]:!h-5 [&_img]:!w-5 [&_svg]:!h-5 [&_svg]:!w-5"
                              aria-label={`${model.name} provider`}
                            >
                              {getCompanyLogo(model.name)}
                            </div>
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-gray-200 dark:bg-[#333] text-gray-800 dark:text-gray-300 rounded">Text Model</span>
                          </div>
                          <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{model.name}</h4>
                          <p className="text-xs text-gray-500">{model.desc}</p>
                        </div>
                        
                        <div className="space-y-4">
                          <div className="bg-white dark:bg-[#222] border border-gray-100 dark:border-[#333] rounded-xl p-4 flex justify-between items-center gap-2 overflow-hidden">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Tokens</span>
                            <span className="text-lg font-mono font-bold text-gray-900 dark:text-white truncate" title={(usageData?.total || 0).toLocaleString()}>
                              {formatNumber(usageData?.total || 0)} <span className="text-gray-400 text-sm font-normal">/ {formatNumber(model.maxUsage)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {IMG_MODELS.map((model) => {
                    const usageKey = getUsageKey(model.name);
                    const usageData = sessionUsage?.[usageKey];
                    return (
                      <div 
                        key={model.name}
                        className="bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-2xl p-6 flex flex-col justify-between hover:border-gray-300 dark:hover:border-[#3A3A3A] transition-colors"
                      >
                        <div className="mb-8">
                          <div className="flex justify-between items-start mb-4">
                            <div
                              className="flex h-9 w-9 items-center justify-center bg-white dark:bg-[#222] rounded-lg border border-gray-200 dark:border-[#333] [&_img]:!h-5 [&_img]:!w-5 [&_svg]:!h-5 [&_svg]:!w-5"
                              aria-label={`${model.name} provider`}
                            >
                              {getCompanyLogo(model.name)}
                            </div>
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-gray-200 dark:bg-[#333] text-gray-800 dark:text-gray-300 rounded">Image Gen</span>
                          </div>
                          <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{model.name}</h4>
                          <p className="text-xs text-gray-500">{model.desc}</p>
                        </div>
                        
                        <div className="space-y-4">
                          <div className="bg-white dark:bg-[#222] border border-gray-100 dark:border-[#333] rounded-xl p-4 flex justify-between items-center gap-2 overflow-hidden">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Images</span>
                            <span className="text-lg font-mono font-bold text-gray-900 dark:text-white truncate" title={(usageData?.generated || 0).toLocaleString()}>
                              {formatNumber(usageData?.generated || 0)} <span className="text-gray-400 text-sm font-normal">/ {formatNumber(model.maxUsage)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Void Voice Agent Card */}
                  <div className="bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-2xl p-6 flex flex-col justify-between hover:border-gray-300 dark:hover:border-[#3A3A3A] transition-colors">
                    <div className="mb-8">
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-white dark:bg-[#222] rounded-lg border border-gray-200 dark:border-[#333]">
                          <Mic size={20} className="text-gray-900 dark:text-white" />
                        </div>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-gray-200 dark:bg-[#333] text-gray-800 dark:text-gray-300 rounded">Voice AI</span>
                      </div>
                      <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Void Voice Agent</h4>
                      <p className="text-xs text-gray-500">Real-time voice interactions</p>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="bg-white dark:bg-[#222] border border-gray-100 dark:border-[#333] rounded-xl p-4 flex justify-between items-center gap-2 overflow-hidden">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Queries</span>
                        <span className="text-lg font-mono font-bold text-gray-900 dark:text-white truncate" title={(sessionUsage?.voice_agent?.queries || 0).toLocaleString()}>
                          {formatNumber(sessionUsage?.voice_agent?.queries || 0)} <span className="text-gray-400 text-sm font-normal">/ {formatNumber(1000)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

              </motion.div>
            )}

            {/* DISPLAY TAB */}
            {activeTab === "display" && (
              <motion.div key="display" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-3xl mx-auto space-y-8">
                <div>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">Display & Appearance</h3>
                  <p className="text-gray-500 text-sm">Personalize the look and feel of the interface.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 dark:bg-[#1A1A1A] p-6 rounded-xl border border-gray-200 dark:border-[#2A2A2A]">
                    <h4 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Monitor size={18} /> Theme Settings</h4>
                    <div className="flex bg-gray-200 dark:bg-[#222] p-1 rounded-lg">
                      <button onClick={toggleTheme} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded font-medium transition-colors ${theme === "light" ? "bg-white text-gray-900 shadow-sm border border-gray-200" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"}`}>
                        <Sun size={14} /> Light
                      </button>
                      <button onClick={toggleTheme} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded font-medium transition-colors ${theme === "dark" ? "bg-[#333] text-white shadow-sm border border-[#444]" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"}`}>
                        <Moon size={14} /> Dark
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-[#1A1A1A] p-6 rounded-xl border border-gray-200 dark:border-[#2A2A2A]">
                    <h4 className="font-bold text-gray-900 dark:text-white mb-4">Typography</h4>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Chat Font Size</label>
                      <CustomSelect 
                          value={fontSize} 
                          onChange={(val) => setFontSize(val)} 
                          options={[
                            { value: "small", label: "Small (12px)", title: "Small", desc: "12px" },
                            { value: "medium", label: "Medium (14px) - Default", title: "Medium", desc: "14px (Default)" },
                            { value: "large", label: "Large (16px)", title: "Large", desc: "16px" }
                          ]} 
                          isPro={true}
                        />
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-[#1A1A1A] p-6 rounded-xl border border-gray-200 dark:border-[#2A2A2A] md:col-span-2">
                    <h4 className="font-bold text-gray-900 dark:text-white mb-4">Message Bubble Style</h4>
                    <div className="flex flex-col sm:flex-row gap-4">
                      <button 
                        onClick={() => setMessageStyle("classic")}
                        className={`flex-1 p-4 rounded-xl border-2 text-left transition-all ${messageStyle === "classic" ? "border-gray-900 dark:border-white bg-white dark:bg-[#222]" : "border-gray-200 dark:border-[#333] bg-white dark:bg-[#1A1A1A] hover:border-gray-400 dark:hover:border-[#555]"}`}
                      >
                        <span className="font-bold block mb-3 text-gray-900 dark:text-white">Classic Bubbles</span>
                        <div className="bg-gray-900 text-white dark:bg-white dark:text-black p-2 rounded-lg rounded-tr-none text-xs inline-block mb-2">Hi, how are you?</div>
                        <div className="bg-gray-200 dark:bg-[#333] text-gray-800 dark:text-gray-200 p-2 rounded-lg rounded-tl-none text-xs inline-block">I&apos;m good, thanks!</div>
                      </button>
                      
                      <button 
                        onClick={() => setMessageStyle("modern")}
                        className={`flex-1 p-4 rounded-xl border-2 text-left transition-all ${messageStyle === "modern" ? "border-gray-900 dark:border-white bg-white dark:bg-[#222]" : "border-gray-200 dark:border-[#333] bg-white dark:bg-[#1A1A1A] hover:border-gray-400 dark:hover:border-[#555]"}`}
                      >
                        <span className="font-bold block mb-3 text-gray-900 dark:text-white">Modern Full-Width</span>
                        <div className="flex gap-2 text-xs text-gray-900 dark:text-white mb-2">
                          <span className="font-bold text-gray-900 dark:text-white">You:</span> Hi, how are you?
                        </div>
                        <div className="flex gap-2 text-xs text-gray-900 dark:text-white">
                          <span className="font-bold text-gray-500">AI:</span> I&apos;m good, thanks!
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button onClick={saveDisplay} disabled={isSavingDisplay} className="flex items-center gap-2 bg-gray-900 hover:bg-black dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
                    {displaySaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                    {isSavingDisplay ? "Saving..." : displaySaved ? "Saved!" : "Save Changes"}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ACCOUNT TAB */}
            {activeTab === "account" && (
              <motion.div key="account" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-3xl mx-auto space-y-8">
                <div>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">Account Profile</h3>
                  <p className="text-gray-500 text-sm">Manage your profile, data, and security settings.</p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-[#323236] dark:bg-[#171719] sm:p-8 flex flex-col md:flex-row items-center gap-8">
                  <div className="relative group shrink-0">
                    <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-[#252528] border-4 border-white dark:border-[#171719] shadow-sm overflow-hidden flex items-center justify-center">
                      {profileDp ? (
                        <NextImage unoptimized width={96} height={96} src={profileDp} alt="Profile DP" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-4xl font-bold text-gray-400">{userEmail.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      ref={fileInputRef} 
                      onChange={handleDpUpload} 
                      className="hidden" 
                    />
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-0 right-0 bg-gray-900 hover:bg-black dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black p-2 rounded-full shadow-md border-2 border-white dark:border-[#1E1E1E] transition-colors"
                      title="Upload new avatar"
                    >
                      <Upload size={14} />
                    </button>
                  </div>
                  
                  <div className="min-w-0 flex-1 text-center md:text-left">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Signed-in account</p>
                    <h4 className="truncate text-2xl font-bold text-gray-900 dark:text-white">{userEmail}</h4>
                    <button
                      type="button"
                      onClick={() => setShowPlanBenefits(!showPlanBenefits)}
                      className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isAdmin
                          ? "border-black bg-black text-white hover:bg-[#252525] dark:border-white dark:bg-white dark:text-black dark:hover:bg-gray-200"
                          : "border-gray-300 bg-white text-gray-700 hover:border-gray-500 dark:border-[#414146] dark:bg-[#232326] dark:text-gray-200 dark:hover:border-gray-500"
                      }`}
                      aria-expanded={showPlanBenefits}
                    >
                      {isAdmin ? <CheckCircle2 size={13} /> : <Lock size={13} />}
                      <span>{isAdmin ? "Administrator · Pro active" : "Free plan"}</span>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${showPlanBenefits ? "rotate-180" : ""}`} />
                    </button>
                    <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {isAdmin
                        ? `This account matches the VOID administrator identity (${ADMIN_EMAIL}).`
                        : "Every non-administrator account is assigned to the Free plan."}
                    </p>
                  </div>
                </div>

                <AnimatePresence>
                  {showPlanBenefits && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, y: -10 }}
                      animate={{ opacity: 1, height: "auto", y: 0 }}
                      exit={{ opacity: 0, height: 0, y: -10 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden mb-8"
                    >
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-[#323236] dark:bg-[#131315] sm:p-6">
                        <div className="mb-5 flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Plans & account access</h3>
                            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                              Compare access and features. Provider quotas apply to both plans.
                            </p>
                          </div>
                          <button 
                            type="button" 
                            onClick={() => setShowPlanBenefits(false)}
                            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                          >
                            Hide
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className={`rounded-xl border bg-white p-5 dark:bg-[#1B1B1E] ${accountPlan === "free" ? "border-black dark:border-white" : "border-gray-200 dark:border-[#343438]"}`}>
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <h4 className="text-lg font-bold text-gray-900 dark:text-white">{PLAN_DETAILS.free.name}</h4>
                                <p className="text-xs text-gray-500">Default account access</p>
                              </div>
                              {accountPlan === "free" && <span className="rounded-full bg-black px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white dark:bg-white dark:text-black">Current</span>}
                            </div>
                            <p className="mb-4 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{PLAN_DETAILS.free.description}</p>
                            <ul className="space-y-2.5 text-sm text-gray-700 dark:text-gray-300">
                              {PLAN_DETAILS.free.features.slice(0, 2).map((feature) => <li key={feature} className="flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-gray-500" />{feature}</li>)}
                            </ul>
                          </div>

                          <div className={`rounded-xl border bg-[#18181A] p-5 text-white dark:bg-white dark:text-black ${accountPlan === "admin-pro" ? "border-black dark:border-white" : "border-[#343438] dark:border-gray-300"}`}>
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <h4 className="text-lg font-bold">{PLAN_DETAILS.adminPro.name}</h4>
                                <p className="text-xs text-gray-400 dark:text-gray-600">Reserved for {ADMIN_EMAIL}</p>
                              </div>
                              {accountPlan === "admin-pro" ? (
                                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-black dark:bg-black dark:text-white">Active</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-300 dark:border-black/20 dark:text-gray-700"><Lock size={10} /> Admin only</span>
                              )}
                            </div>
                            <p className="mb-4 text-sm leading-relaxed text-gray-300 dark:text-gray-700">{PLAN_DETAILS.adminPro.description}</p>
                            <ul className="space-y-2.5 text-sm text-gray-200 dark:text-gray-800">
                              {PLAN_DETAILS.adminPro.features.slice(0, 2).map((feature) => <li key={feature} className="flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-600" />{feature}</li>)}
                            </ul>
                          </div>
                        </div>

                        <details className="mt-4 group/compare">
                          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg py-2 text-sm font-medium text-gray-600 dark:text-gray-300">Compare all features<ChevronDown size={14} className="transition-transform group-open/compare:rotate-180" /></summary>
                        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-[#343438] dark:bg-[#1B1B1E]">
                          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                            <thead className="bg-gray-100 text-[11px] uppercase tracking-[0.12em] text-gray-500 dark:bg-[#242427] dark:text-gray-400">
                              <tr><th className="px-4 py-3 font-semibold">Capability</th><th className="px-4 py-3 font-semibold">Free</th><th className="px-4 py-3 font-semibold">Administrator Pro</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 text-gray-700 dark:divide-[#303034] dark:text-gray-300">
                              {[
                                ["Reasoning", "Penumbra and Umbra", "Penumbra, Umbra, and Tenebrae"],
                                ["Images and files", "Limited usage", "Full application access"],
                                ["Voice agent", "Not included", "Enabled"],
                                ["Routing", "Standard priority", "Highest application priority"],
                                ["Application caps", "Fair-use limits", "No message cap"],
                                ["Provider quotas", "Still apply", "Still apply"],
                              ].map(([capability, free, pro]) => <tr key={capability}><th className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{capability}</th><td className="px-4 py-3">{free}</td><td className="px-4 py-3">{pro}</td></tr>)}
                            </tbody>
                          </table>
                        </div>
                        </details>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-[#1A1A1A] p-6 rounded-xl border border-gray-200 dark:border-[#2A2A2A] flex flex-col justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2"><Download size={16} /> Export Data</h4>
                      <p className="text-sm text-gray-500 mb-6">Download a JSON backup of your current settings and token usage.</p>
                    </div>
                    <button onClick={handleExportData} className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-[#2A2A2A] dark:hover:bg-[#333] text-gray-900 dark:text-white py-2.5 rounded-lg font-medium transition-colors border border-transparent dark:border-[#3A3A3A]">
                      Download JSON
                    </button>
                  </div>

                  <div className="bg-white dark:bg-[#1A1A1A] p-6 rounded-xl border border-gray-200 dark:border-[#2A2A2A] flex flex-col justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2"><LogOut size={16} /> Sign Out</h4>
                      <p className="text-sm text-gray-500 mb-6">Log out of your current session on this device securely.</p>
                    </div>
                    <button onClick={handleSignOut} className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-[#2A2A2A] dark:hover:bg-[#333] text-gray-900 dark:text-white py-2.5 rounded-lg font-medium transition-colors border border-transparent dark:border-[#3A3A3A]">
                      Log Out
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>

      
    </motion.div>
  );
}
