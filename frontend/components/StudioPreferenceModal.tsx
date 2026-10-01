import VoidSelect from './ui/VoidSelect';
import { useState } from "react";
import { X, Sparkles, Layout, Palette, MessageSquare, Layers, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SlideTheme } from "@/types/presentation";

type PreferenceOptions = {
  type: "presentation" | "report";
  topic: string;
  theme: SlideTheme;
  slideCount: number;
  tone: "academic" | "professional" | "executive" | "engaging";
};

type StudioPreferenceModalProps = {
  initialTopic: string;
  initialType?: "presentation" | "report";
  onClose: () => void;
  onConfirm: (options: PreferenceOptions) => void;
};


function CustomSelect({ value, onChange, options }: { value: string, onChange: (val: string) => void, options: {value: string, label: string}[] }) {
  return <VoidSelect value={value} aria-label="Studio preference" onChange={event => onChange(event.target.value)} options={options} className="text-white" />;
}

export default function StudioPreferenceModal({
  initialTopic,
  initialType = "presentation",
  onClose,
  onConfirm,
}: StudioPreferenceModalProps) {
  const [type, setType] = useState<"presentation" | "report">(initialType);
  const [topic, setTopic] = useState(initialTopic);
  const [theme, setTheme] = useState<SlideTheme>("cosmic-dark");
  const [slideCount, setSlideCount] = useState<number>(10);
  const [tone, setTone] = useState<"academic" | "professional" | "executive" | "engaging">("professional");

  const themes: { id: SlideTheme; label: string; bg: string; border: string }[] = [
    { id: "cosmic-dark", label: "Cosmic Dark", bg: "bg-[#16161A]", border: "border-purple-500/50" },
    { id: "neon-glass", label: "Neon Glass", bg: "bg-[#0F172A]", border: "border-cyan-500/50" },
    { id: "executive-slate", label: "Executive Slate", bg: "bg-[#1E293B]", border: "border-slate-500/50" },
    { id: "academic-clean", label: "Academic Clean", bg: "bg-[#F8FAFC]", border: "border-gray-300" },
    { id: "sunset-gold", label: "Sunset Gold", bg: "bg-[#1C1917]", border: "border-amber-500/50" },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    onConfirm({
      type,
      topic: topic.trim(),
      theme,
      slideCount,
      tone,
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-xl bg-[#141416] rounded-2xl shadow-2xl border border-[#27272A] p-6 text-white overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#27272A] mb-5">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">
                  AI Generation Preferences
                </h2>
                <p className="text-xs text-gray-400">Customize your generation preferences</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#27272A] text-gray-400 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Output Type */}
            <div>
              <label className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                <Layout size={14} className="text-gray-400" />
                Format
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setType("presentation")}
                  className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${type === 'presentation' ? 'bg-[#242428] border-purple-500/80 ring-1 ring-purple-500/50 text-white' : 'bg-[#1A1A1E] border-[#2A2A2E] text-gray-400 hover:text-white'}`}
                >
                  <div>
                    <p className="text-xs font-bold">Presentation</p>
                    <p className="text-[11px] text-gray-400">16:9 Visual Slide Deck</p>
                  </div>
                  {type === "presentation" && <Check size={16} className="text-purple-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => setType("report")}
                  className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${type === 'report' ? 'bg-[#242428] border-blue-500/80 ring-1 ring-blue-500/50 text-white' : 'bg-[#1A1A1E] border-[#2A2A2E] text-gray-400 hover:text-white'}`}
                >
                  <div>
                    <p className="text-xs font-bold">Executive Document</p>
                    <p className="text-[11px] text-gray-400">Structured Report & Summary</p>
                  </div>
                  {type === "report" && <Check size={16} className="text-blue-400" />}
                </button>
              </div>
            </div>

            {/* Topic Input */}
            <div>
              <label className="text-xs font-semibold text-gray-300 mb-1.5 block">
                Topic / Concept
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. World War 2 Overview, Quantum Computing Breakthroughs..."
                className="w-full bg-[#1A1A1E] border border-[#27272A] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 font-sans"
                required
              />
            </div>

            {/* Theme Selector */}
            <div>
              <label className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                <Palette size={14} className="text-gray-400" />
                Visual Theme
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={`p-2 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${theme === t.id ? 'border-purple-500 bg-[#242428] ring-1 ring-purple-500/50' : 'border-[#27272A] bg-[#1A1A1E] hover:border-gray-600'}`}
                  >
                    <div className={`w-full h-6 rounded-md ${t.bg} border ${t.border}`} />
                    <span className="text-[11px] font-medium text-gray-200 truncate w-full">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Slide / Section Count & Tone */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                  <Layers size={14} className="text-gray-400" />
                  {type === "presentation" ? "Slide Count" : "Section Count"}
                </label>
                <div className="flex bg-[#1A1A1E] rounded-xl p-1 border border-[#27272A]">
                  {[5, 10, 15].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setSlideCount(cnt)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${slideCount === cnt ? 'bg-[#2C2C32] text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                    >
                      {cnt} {type === "presentation" ? "Slides" : "Secs"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-gray-400" />
                  Tone & Perspective
                </label>
                <CustomSelect 
                  value={tone}
                  onChange={(val) => setTone(val as PreferenceOptions['tone'])}
                  options={[
                    { value: "academic", label: "Academic & Detailed" },
                    { value: "professional", label: "Professional & Executive" },
                    { value: "engaging", label: "Engaging & High Impact" }
                  ]}
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-3 border-t border-[#27272A] flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:bg-[#27272A] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-gray-200 transition-all flex items-center gap-2 shadow-lg active:scale-95"
              >
                <Sparkles size={14} className="text-purple-600" />
                <span>Generate {type === "presentation" ? `${slideCount}-Slide Presentation` : "Executive Report"}</span>
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
