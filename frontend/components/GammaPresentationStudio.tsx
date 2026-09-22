import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Maximize2, 
  Minimize2,
  Sparkles, 
  Layers, 
  Copy, 
  Check, 
  FileText,
  Presentation as PptIcon,
  Quote,
  Code2,
  TrendingUp,
  Clock,
  Columns,
  Users,
  BarChart3,
  Image as ImageIcon,
  Palette,
  Sun,
  Moon,
  Droplet,
  Zap,
  Shield,
  Globe,
  Award,
  CheckCircle2,
  Building,
  Target,
  Cpu,
  DollarSign,
  Flame,
  Leaf,
  Lightbulb,
  Activity,
  AlertTriangle,
  BookOpen,
  Compass,
  Database,
  Filter,
  Grid,
  Heart,
  Key,
  Lock,
  PieChart,
  RefreshCw,
  Search,
  Sliders,
  Star,
  Wrench,
  XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PresentationData, SlideTheme, Slide } from "@/types/presentation";
import { ProgressMark } from "./DynamicLoader";
import pptxgen from "pptxgenjs";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { prepareHtml2CanvasClone } from "@/lib/html2canvas-safe";

type GammaPresentationStudioProps = {
  data: PresentationData;
  onClose?: () => void;
};

/* ─── Dynamic SVG Icon Resolver (Replaces emojis with crisp colored Lucide icons) ─── */
function renderDynamicIcon(iconInput?: string, accent: string = "#3B82F6", size: number = 18) {
  const str = (iconInput || "").toLowerCase().trim();

  if (str.includes("water") || str.includes("drop") || str.includes("hydro") || str.includes("drought") || str.includes("💧") || str.includes("🌊")) {
    return <Droplet size={size} style={{ color: accent }} />;
  }
  if (str.includes("chart") || str.includes("data") || str.includes("bar") || str.includes("📊") || str.includes("📈")) {
    return <BarChart3 size={size} style={{ color: accent }} />;
  }
  if (str.includes("trend") || str.includes("growth") || str.includes("increase") || str.includes("roi")) {
    return <TrendingUp size={size} style={{ color: accent }} />;
  }
  if (str.includes("time") || str.includes("clock") || str.includes("date") || str.includes("year") || str.includes("📅") || str.includes("⏱️")) {
    return <Clock size={size} style={{ color: accent }} />;
  }
  if (str.includes("user") || str.includes("people") || str.includes("person") || str.includes("team") || str.includes("cast") || str.includes("👥") || str.includes("🎭")) {
    return <Users size={size} style={{ color: accent }} />;
  }
  if (str.includes("building") || str.includes("studio") || str.includes("company") || str.includes("firm") || str.includes("🏢")) {
    return <Building size={size} style={{ color: accent }} />;
  }
  if (str.includes("dollar") || str.includes("money") || str.includes("price") || str.includes("cost") || str.includes("economic") || str.includes("asset") || str.includes("revenue") || str.includes("💰") || str.includes("💵")) {
    return <DollarSign size={size} style={{ color: accent }} />;
  }
  if (str.includes("target") || str.includes("goal") || str.includes("aim") || str.includes("focus") || str.includes("🎯")) {
    return <Target size={size} style={{ color: accent }} />;
  }
  if (str.includes("zap") || str.includes("energy") || str.includes("power") || str.includes("electric") || str.includes("⚡")) {
    return <Zap size={size} style={{ color: accent }} />;
  }
  if (str.includes("shield") || str.includes("security") || str.includes("policy") || str.includes("law") || str.includes("governance") || str.includes("protection") || str.includes("🔒") || str.includes("⚖️")) {
    return <Shield size={size} style={{ color: accent }} />;
  }
  if (str.includes("globe") || str.includes("world") || str.includes("global") || str.includes("international") || str.includes("🌐") || str.includes("📍")) {
    return <Globe size={size} style={{ color: accent }} />;
  }
  if (str.includes("leaf") || str.includes("eco") || str.includes("green") || str.includes("sustain") || str.includes("nature") || str.includes("🌱") || str.includes("🌿")) {
    return <Leaf size={size} style={{ color: accent }} />;
  }
  if (str.includes("lightbulb") || str.includes("idea") || str.includes("innovat") || str.includes("solution") || str.includes("💡")) {
    return <Lightbulb size={size} style={{ color: accent }} />;
  }
  if (str.includes("cpu") || str.includes("tech") || str.includes("hardware") || str.includes("smart") || str.includes("system") || str.includes("ai") || str.includes("💻")) {
    return <Cpu size={size} style={{ color: accent }} />;
  }
  if (str.includes("star") || str.includes("award") || str.includes("key") || str.includes("feature") || str.includes("⭐") || str.includes("🏆")) {
    return <Award size={size} style={{ color: accent }} />;
  }

  return <Sparkles size={size} style={{ color: accent }} />;
}

function extractImageKeywords(title: string = "", prompt: string = ""): string {
  const combined = `${prompt} ${title}`.toLowerCase();
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is", "are",
    "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "with", "about", "from",
    "into", "through", "during", "before", "after", "above", "below", "between", "under",
    "again", "further", "then", "once", "here", "there", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "because",
    "as", "until", "while", "that", "this", "these", "those", "it", "its", "what", "which",
    "who", "whom", "their", "them", "they", "he", "she", "we", "you", "your", "our", "my",
    "also", "like", "make", "many", "much", "get", "got", "go", "going", "take", "give",
    "slide", "slides", "presentation", "overview", "introduction", "conclusion", "summary",
    "key", "main", "important", "critical", "analysis", "explore", "understand", "discuss",
    "generate", "create", "build", "design", "topic", "subject", "detailed", "comprehensive",
    "high", "resolution", "photo", "image", "illustration", "ai", "style", "dramatic",
    "real", "realistic", "professional", "modern", "beautiful", "stunning", "specific"
  ]);
  
  const words = combined
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  const unique = [...new Set(words)];
  return unique.slice(0, 3).join(",") || "photography,nature";
}

/* ─── Topic-Curated High-Res Photography Library & Dynamic AI Resolver ─── */
const TOPIC_PHOTO_POOLS: { keywords: RegExp; photos: string[] }[] = [
  {
    // 1. Hunting, Wildlife, Conservation, Nature, Ecology, Animals, Forest, Safari
    keywords: /\b(hunting|wildlife|conservation|nature|forest|safari|animal|animals|fauna|flora|ecology|habitat|ecosystem|deer|elk|bison|harvest|wilderness|woods)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1474511320723-9a56873867b5?w=800&auto=format&fit=crop&q=80", // Wild fox/deer in autumn forest
      "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80", // Majestic stag in foggy forest
      "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&auto=format&fit=crop&q=80", // Deep green pine forest sunlight
      "https://images.unsplash.com/photo-1516426122078-c23e76319801?w=800&auto=format&fit=crop&q=80"  // Wildlife savanna safari landscape
    ]
  },
  {
    // 2. Gaming, Esports, Video Games, Consoles, VR, Controllers, Graphics
    keywords: /\b(gaming|game|gamer|games|esports|console|playstation|xbox|nintendo|steam|graphics|gpu|vr|virtual reality|gameplay|streamer|joystick|rpg)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80", // Esports gaming arena stadium
      "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&auto=format&fit=crop&q=80", // Neon RGB gaming PC rig setup
      "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop&q=80", // Wireless gaming controller closeup
      "https://images.unsplash.com/photo-1592478411213-6153e4ebc07d?w=800&auto=format&fit=crop&q=80", // VR headset virtual reality player
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80"  // Retro gaming arcade cabinet neon
    ]
  },
  {
    // 3. Cars, Vehicles, Racing, Supercars, Motorsport, Automotive
    keywords: /\b(car|cars|vehicle|supercar|racing|porsche|ferrari|speedway|motorsport|automotive|drive|highway)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800&auto=format&fit=crop&q=80", // Red sports car
      "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&auto=format&fit=crop&q=80", // Sleek supercar headlight
      "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&auto=format&fit=crop&q=80", // Vintage classic automobile
      "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?w=800&auto=format&fit=crop&q=80"  // Racetrack speed line
    ]
  },
  {
    // 4. Space, Astronomy, Cosmos, Planets, Universe, NASA
    keywords: /\b(space|astronomy|cosmos|planet|star|galaxy|nebula|orbit|satellite|universe|astronaut|nasa)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80", // Earth from space orbit
      "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=800&auto=format&fit=crop&q=80", // Deep starry galaxy night
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&auto=format&fit=crop&q=80"  // Satellite in planet orbit
    ]
  },
  {
    // 5. Medicine, Healthcare, Biology, Genetics, Science, Lab
    keywords: /\b(medicine|medical|health|healthcare|biology|genetics|dna|pharma|doctor|hospital|vaccine|disease|virus|cell|microscope|science|biotech)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=800&auto=format&fit=crop&q=80", // Medical research microscope
      "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80", // Stethoscope healthcare
      "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?w=800&auto=format&fit=crop&q=80", // DNA double helix model
      "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80"  // Lab research test tubes
    ]
  },
  {
    // 6. Water Management, Scarcity, Hydrology, Climate, Oceans, Dams
    keywords: /\b(water|hydro|scarcity|drought|reservoir|river|ocean|sea|rain|harvesting|irrigation|desalination|aquifer|fluid|drainage|glacier|flood|hydrological|lake|dam|sanitation)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=800&auto=format&fit=crop&q=80", // Crystal water drop macro
      "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800&auto=format&fit=crop&q=80", // Arid dry drought earth
      "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&auto=format&fit=crop&q=80", // Pristine reservoir & dam
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop&q=80"  // Deep blue ocean horizon
    ]
  },
  {
    // 7. Quantum Computing, Qubits, Superconductor, Physics
    keywords: /\b(quantum|qubits?|superconductor|cryostat|schrodinger|fermi|entanglement|superposition)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&auto=format&fit=crop&q=80", // Quantum computer cryostat chandelier
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80"  // High-tech semiconductor chip
    ]
  },
  {
    // 8. Business, Finance, Economics, Corporate, Strategy, Markets
    keywords: /\b(business|finance|economy|economic|market|stock|trade|money|bank|inflation|strategy|corporate|investment|growth|startup|leadership|company)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop&q=80", // Financial stock charts
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&auto=format&fit=crop&q=80", // Corporate strategy meeting
      "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&auto=format&fit=crop&q=80", // Financial growth trend chart
      "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&auto=format&fit=crop&q=80"  // Modern skyscraper office tower
    ]
  },
  {
    // 9. History, Law, Justice, Court, Government, Military
    keywords: /\b(history|historical|war|warfare|battle|d-day|holocaust|memorial|law|court|justice|statute|constitution|rights|government|army|military)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&auto=format&fit=crop&q=80", // Scales of justice
      "https://images.unsplash.com/photo-1436450412740-6b988f486c6e?w=800&auto=format&fit=crop&q=80", // Supreme court pillars
      "https://images.unsplash.com/photo-1508873696983-2df515122519?w=800&auto=format&fit=crop&q=80"  // Vintage historical parchment
    ]
  },
  {
    // 10. Specific Technical Software/Code (Strict Regex to prevent false positives from generic words like 'technological')
    keywords: /\b(coding|software developer|source code|programming language|data center|microchip|compiler|cybersecurity|web developer|algorithm|github)\b/i,
    photos: [
      "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80", // Code syntax editor on screen
      "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&auto=format&fit=crop&q=80", // Server data center glowing lights
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80", // Microchip circuit board
      "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&auto=format&fit=crop&q=80"  // Cyber security network matrix
    ]
  }
];

function getWebPulledImageUrl(title: string = "", prompt: string = "", slideNumber: number = 1): string {
  if (prompt && (prompt.startsWith("http://") || prompt.startsWith("https://"))) {
    return `/api/image-proxy?url=${encodeURIComponent(prompt)}`;
  }
  const cleanSubject = stripMarkdown(title || prompt || "Academic Research")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 0;
  for (let i = 0; i < cleanSubject.length; i++) {
    hash = ((hash << 5) - hash) + cleanSubject.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash) + slideNumber * 37 + 101;
  const params = new URLSearchParams({
    subject: cleanSubject,
    prompt: prompt || title,
    seed: String(seed),
    mode: "generate",
    quality: "medium",
  });
  return `/api/design-image?${params.toString()}`;
}

/* ─── Markdown Text Formatter (Strips ** raw asterisks and renders formatted elements) ─── */
function renderFormattedText(text?: string, isDark: boolean = false) {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className={`font-extrabold ${isDark ? "text-white" : "text-gray-900"}`}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function stripMarkdown(text?: any): string {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
}

/* ─── Base64 Image Converter for PPTX Export ─── */
async function getBase64ImageFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ─── Context-Driven Image Component with Graceful Loading ─── */
function SlideImage({ 
  src, 
  alt, 
  className,
  fitMode = "contain",
  isDark = true,
}: { 
  src: string; 
  alt?: string; 
  className?: string;
  fitMode?: "cover" | "contain";
  isDark?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
    setLoaded(false);
    setError(false);
  }, [src]);

  useEffect(() => {
    // Allow up to 25 seconds for Pollinations FLUX Engine / AI Image rendering
    const timer = setTimeout(() => {
      if (!loaded && !error) {
        handleImageError();
      }
    }, 25000);
    return () => clearTimeout(timer);
  }, [currentSrc, loaded, error]);

  const handleImageError = () => {
    // Never replace a failed verified result with an unrelated stock photo.
    // The server-side design route already owns its source-aware fallbacks.
    setError(true);
  };

  if (!currentSrc || error) return null;

  return (
    <div className={`relative overflow-hidden ${isDark ? "bg-[#18181B]" : "bg-gray-100"} flex items-center justify-center min-h-[220px] ${className || ""}`}>
      {!loaded && (
        <div className={`absolute inset-0 border flex items-center justify-center min-h-[220px] ${isDark ? "bg-[#18181B] border-[#27272A]" : "bg-gray-100 border-gray-200"}`}>
          <div className={`flex items-center gap-2.5 text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-700"}`}>
            <ProgressMark />
            <span>Loading visual</span>
          </div>
        </div>
      )}
      <img
        src={currentSrc}
        alt={alt || "Visual"}
        className={`w-full h-full ${fitMode === "contain" ? "object-contain" : "object-cover"} transition-all duration-700 ease-out ${loaded ? "opacity-100 scale-100" : "opacity-0 scale-105"}`}
        onLoad={() => setLoaded(true)}
        onError={handleImageError}
        loading="eager"
      />
    </div>
  );
}

/* ─── Theme Style Configurations (Unified App Color Palette) ─── */
const themeConfigs: Record<SlideTheme, { 
  appBg: string; 
  cardBg: string; 
  text: string; 
  textSub: string; 
  border: string; 
  accentDefault: string;
  isDark: boolean;
  headerBg: string;
}> = {
  "academic-clean": { // Standard App Light Mode
    appBg: "bg-gray-100",
    cardBg: "bg-white",
    text: "text-gray-900",
    textSub: "text-gray-600",
    border: "border-gray-200",
    accentDefault: "#2563EB",
    isDark: false,
    headerBg: "bg-white/95 border-gray-200"
  },
  "cosmic-dark": { // App Dark Mode (Matches Chat App Palette: #0B0F17 bg, #0F172A card, #1E293B border)
    appBg: "bg-[#0B0F17]",
    cardBg: "bg-[#0F172A]",
    text: "text-gray-100",
    textSub: "text-gray-400",
    border: "border-[#1E293B]",
    accentDefault: "#3B82F6",
    isDark: true,
    headerBg: "bg-[#0B0F17]/95 border-[#1E293B]"
  },
  "neon-glass": {
    appBg: "bg-[#0B0F17]",
    cardBg: "bg-[#0F172A]",
    text: "text-gray-100",
    textSub: "text-gray-400",
    border: "border-[#1E293B]",
    accentDefault: "#3B82F6",
    isDark: true,
    headerBg: "bg-[#0B0F17]/95 border-[#1E293B]"
  },
  "executive-slate": {
    appBg: "bg-[#0B0F17]",
    cardBg: "bg-[#0F172A]",
    text: "text-gray-100",
    textSub: "text-gray-400",
    border: "border-[#1E293B]",
    accentDefault: "#3B82F6",
    isDark: true,
    headerBg: "bg-[#0B0F17]/95 border-[#1E293B]"
  },
  "sunset-gold": {
    appBg: "bg-[#0B0F17]",
    cardBg: "bg-[#0F172A]",
    text: "text-gray-100",
    textSub: "text-gray-400",
    border: "border-[#1E293B]",
    accentDefault: "#3B82F6",
    isDark: true,
    headerBg: "bg-[#0B0F17]/95 border-[#1E293B]"
  }
};

/* ─── Layout Icon Helper ─── */
function getLayoutIcon(layout?: string) {
  switch (layout?.toLowerCase()) {
    case "hero": return <Sparkles size={12} />;
    case "fast-facts": return <BarChart3 size={12} />;
    case "characters": return <Users size={12} />;
    case "timeline": return <Clock size={12} />;
    case "comparison": return <Columns size={12} />;
    case "metrics-3": case "stats-grid": return <TrendingUp size={12} />;
    case "image-feature": return <ImageIcon size={12} />;
    case "quote": return <Quote size={12} />;
    case "code": return <Code2 size={12} />;
    default: return <FileText size={12} />;
  }
}

/* ─── Ultra-Clean Publication-Quality A4 Poster Layout View ─── */
function PosterLayoutView({ 
  slide, 
  accent, 
  isDark, 
  currentTheme, 
  showImage, 
  imgUrl 
}: { 
  slide: Slide; 
  accent: string; 
  isDark: boolean; 
  currentTheme: any; 
  showImage: boolean; 
  imgUrl: string | null; 
}) {
  const contentObj = (typeof slide.content === "object" && slide.content !== null) ? slide.content : {};
  const bodyText = contentObj.bodyText || (slide as any).bodyText || (slide as any).description;
  const factCards = contentObj.factCards || (slide as any).factCards || [];
  const characterCards = contentObj.characterCards || (slide as any).characterCards || [];
  const metrics = contentObj.metrics || (slide as any).metrics || [];
  const bullets: string[] = [
    ...(Array.isArray(contentObj.bullets) ? contentObj.bullets : []),
    ...(Array.isArray((slide as any).bullets) ? (slide as any).bullets : [])
  ];
  const timeline = contentObj.timeline || (slide as any).timeline || [];
  const comparison = contentObj.comparison || (slide as any).comparison;

  // Combine metrics and factCards into top 4 key metric pills (eliminates duplicate card rows)
  const topMetrics = [...factCards, ...metrics].slice(0, 4);

  const isQuantumTopic = /\b(quantum|qubit|physics|schrodinger|entanglement|fermi)\b/i.test(`${slide.title} ${slide.subtitle}`);

  return (
    <div className="w-full space-y-6">
      {/* 1. TOPIC HERO BANNER HEADER */}
      {isQuantumTopic ? (
        <div className="w-full p-6 sm:p-8 rounded-2xl border border-purple-900/60 bg-[#090814] text-center shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-500/10 via-pink-500/5 to-transparent pointer-events-none" />
          <span className="text-[11px] font-mono font-bold tracking-[0.25em] text-cyan-400 uppercase block mb-2">
            |0⟩ + |1⟩ &bull; A FIELD GUIDE TO QUANTUM COMPUTING
          </span>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white uppercase mb-3 leading-tight">
            {stripMarkdown(slide.title)}
          </h1>
          {slide.subtitle && (
            <p className="text-xs sm:text-sm text-indigo-200/80 max-w-2xl mx-auto font-normal leading-relaxed mb-6">
              {stripMarkdown(slide.subtitle)}
            </p>
          )}
          <div className="relative py-6 flex items-center justify-center gap-16 sm:gap-24 my-2">
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 600 120" preserveAspectRatio="none">
              <path d="M 0 60 C 150 0, 200 120, 300 60 C 400 0, 450 120, 600 60" fill="none" stroke="url(#cyanPink)" strokeWidth="3" opacity="0.85" />
              <defs>
                <linearGradient id="cyanPink" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00f2fe" />
                  <stop offset="100%" stopColor="#ff007f" />
                </linearGradient>
              </defs>
            </svg>
            <div className="relative z-10 w-14 h-14 rounded-full bg-[#0c1e2b] border-2 border-cyan-400 flex items-center justify-center shadow-[0_0_25px_rgba(0,242,254,0.5)]">
              <span className="font-mono text-cyan-300 font-bold text-base">|0⟩</span>
            </div>
            <div className="relative z-10 w-14 h-14 rounded-full bg-[#2b0c20] border-2 border-pink-500 flex items-center justify-center shadow-[0_0_25px_rgba(255,0,127,0.5)]">
              <span className="font-mono text-pink-300 font-bold text-base">|1⟩</span>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-slate-500 uppercase block mt-2">
            PROBABILITY AMPLITUDE OVER OUTCOME SPACE
          </span>
        </div>
      ) : (
        <div className="w-full p-6 sm:p-8 rounded-2xl border border-slate-700/60 bg-gradient-to-b from-[#0b0f19] to-[#060810] text-center shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/10 via-purple-500/5 to-transparent pointer-events-none" />
          <span className="text-[11px] font-mono font-bold tracking-[0.25em] text-cyan-400 uppercase block mb-2">
            {slide.sectionLabel || "A4 ACADEMIC RESEARCH POSTER"} &bull; STRATEGIC ANALYSIS
          </span>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white uppercase mb-3 leading-tight">
            {stripMarkdown(slide.title)}
          </h1>
          {slide.subtitle && (
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl mx-auto font-normal leading-relaxed mb-4">
              {stripMarkdown(slide.subtitle)}
            </p>
          )}
          {showImage && (
            <div className="w-full mt-5 rounded-2xl overflow-hidden shadow-2xl border border-slate-700/60 bg-[#060913] relative group">
              {/* Magazine-Grade Visual Banner Badge */}
              <div className="px-4 py-2 border-b border-slate-800/80 bg-[#0a0f1d]/90 flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold tracking-widest text-cyan-400 uppercase flex items-center gap-1.5">
                  <ImageIcon size={12} />
                  CONTEXTUAL VISUAL INSIGHT &bull; HIGH-RESOLUTION RENDER
                </span>
                <span className="text-[9px] font-mono text-slate-400 uppercase font-semibold">HQ PROPORTIONAL FIT</span>
              </div>
              <div className="relative w-full max-h-[360px] sm:max-h-[420px] overflow-hidden flex items-center justify-center bg-black/50 p-1">
                <SlideImage 
                  src={imgUrl || getWebPulledImageUrl(slide.title, slide.imagePrompt || slide.subtitle || "", slide.slideNumber)} 
                  alt={slide.title} 
                  fitMode="contain"
                  isDark={isDark}
                  className="w-full h-auto max-h-[350px] sm:max-h-[410px] rounded-xl transition-transform duration-700 ease-out group-hover:scale-[1.01]" 
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. TOP METRIC BADGES ROW (Clean 4-column metric bar) */}
      {topMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {topMetrics.map((m: any, i: number) => {
            const label = m.label || m.name || m.title || `Metric ${i + 1}`;
            const val = m.value || m.stat || m.val || "N/A";
            return (
              <div key={i} className={`p-3.5 rounded-xl border flex items-center gap-3 ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: `${accent}18`, border: `1px solid ${accent}30` }}>
                  {renderDynamicIcon(m.icon || label, accent, 16)}
                </div>
                <div className="min-w-0">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block truncate">{stripMarkdown(label)}</span>
                  <span className={`text-xs sm:text-sm font-extrabold block truncate ${isDark ? "text-white" : "text-gray-900"}`}>{stripMarkdown(val)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. CORE STRATEGIC PILLARS GRID (4 Columns) */}
      {characterCards.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Strategic Architecture & Pillars
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {characterCards.slice(0, 4).map((char: any, i: number) => (
              <div key={i} className={`p-4 rounded-xl border flex flex-col justify-between space-y-2 ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${accent}18` }}>
                    {renderDynamicIcon(char.role || char.name, accent, 15)}
                  </div>
                  <div className="min-w-0">
                    <h4 className={`text-xs sm:text-sm font-bold truncate ${isDark ? "text-white" : "text-gray-900"}`}>{stripMarkdown(char.name || `Pillar ${i + 1}`)}</h4>
                    {char.role && <span className="text-[9px] font-mono font-semibold uppercase block" style={{ color: accent }}>{stripMarkdown(char.role)}</span>}
                  </div>
                </div>
                {char.description && (
                  <p className={`text-xs leading-relaxed line-clamp-3 ${currentTheme.textSub}`}>{stripMarkdown(char.description)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. EDITORIAL TWO-COLUMN SPLIT (Research Findings on Left, Timeline Roadmap on Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (7/12): Findings & Bullets */}
        <div className="lg:col-span-7 space-y-3">
          <h3 className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Key Research Insights
          </h3>
          {bodyText && (
            <p className={`text-xs sm:text-sm leading-relaxed ${currentTheme.text}`}>
              {renderFormattedText(bodyText, isDark)}
            </p>
          )}
          {bullets.length > 0 && (
            <div className="space-y-2.5">
              {bullets.slice(0, 4).map((b: string, i: number) => (
                <div key={i} className={`p-3 rounded-xl border flex items-start gap-3 ${isDark ? "bg-[#1E293B]/40 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                  <div className="p-1 rounded shrink-0 mt-0.5" style={{ backgroundColor: `${accent}18` }}>
                    <CheckCircle2 size={13} style={{ color: accent }} />
                  </div>
                  <span className={`text-xs sm:text-sm leading-relaxed ${currentTheme.text}`}>{renderFormattedText(b, isDark)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column (5/12): Strategic Roadmap Timeline */}
        <div className="lg:col-span-5 space-y-3">
          {timeline.length > 0 ? (
            <div>
              <h3 className="text-xs font-mono font-bold tracking-widest text-purple-400 uppercase mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                Strategic Timeline & Roadmap
              </h3>
              <div className="space-y-2.5">
                {timeline.slice(0, 4).map((t: any, i: number) => {
                  const titleStr = typeof t === "string" ? t : (t?.title || t?.stepTitle || `Phase ${i + 1}`);
                  const descStr = typeof t === "string" ? "" : (t?.description || t?.desc || "");
                  return (
                    <div key={i} className={`p-3 rounded-xl border flex items-start gap-3 ${isDark ? "bg-[#1E293B]/40 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                      <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 border" style={{ borderColor: accent, color: accent, backgroundColor: `${accent}15` }}>
                        {t?.step || i + 1}
                      </span>
                      <div className="min-w-0">
                        <h5 className={`text-xs font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{stripMarkdown(String(titleStr))}</h5>
                        {descStr && <p className={`text-[11px] leading-tight mt-0.5 line-clamp-2 ${currentTheme.textSub}`}>{stripMarkdown(String(descStr))}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : comparison ? (
            <div>
              <h3 className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                Paradigm Shift Analysis
              </h3>
              <div className={`p-4 rounded-xl border space-y-2.5 ${isDark ? "bg-[#1E293B]/40 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                <h4 className="text-xs font-bold text-cyan-400">{stripMarkdown(comparison.right?.title || "Next-Gen Paradigm")}</h4>
                {(comparison.right?.points || []).slice(0, 3).map((p: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 size={12} className="text-cyan-400 shrink-0" />
                    <span>{stripMarkdown(p)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─── Robust Individual Slide Card ─── */
function SlideCard({ 
  slide, 
  totalSlides, 
  theme,
  hideImages
}: { 
  slide: Slide; 
  totalSlides: number; 
  theme: SlideTheme; 
  hideImages?: boolean;
}) {
  const currentTheme = themeConfigs[theme] || themeConfigs["academic-clean"];
  const accent = slide.accentColor || currentTheme.accentDefault;
  const isDark = currentTheme.isDark;

  // Normalize all content fields defensively
  const rawContent = slide.content;
  const contentObj = (typeof rawContent === "object" && rawContent !== null) ? rawContent : {};
  const contentString = typeof rawContent === "string" ? rawContent : undefined;

  // Extract bullets from all possible array keys
  const bullets: string[] = [
    ...(Array.isArray(contentObj.bullets) ? contentObj.bullets : []),
    ...(Array.isArray((slide as any).bullets) ? (slide as any).bullets : []),
    ...(Array.isArray((slide as any).points) ? (slide as any).points : []),
    ...(Array.isArray((slide as any).items) ? (slide as any).items : [])
  ].filter(b => typeof b === "string" && b.trim().length > 0);

  // Extract body text
  let bodyText = contentObj.bodyText || (slide as any).bodyText || (slide as any).description || (slide as any).text || (slide as any).summary || contentString;

  const factCards = contentObj.factCards || (slide as any).factCards;
  const characterCards = contentObj.characterCards || (slide as any).characterCards;
  const metrics = contentObj.metrics || (slide as any).metrics;
  const timeline = contentObj.timeline || (slide as any).timeline;
  const comparison = contentObj.comparison || (slide as any).comparison;
  const quote = contentObj.quote || (slide as any).quote;
  const codeSnippet = contentObj.codeSnippet || (slide as any).codeSnippet;

  // Check if quote has valid non-empty text
  const hasValidQuote = quote && typeof quote.text === "string" && quote.text.trim().length > 0;

  // GUARANTEED CONTENT: Ensure slide is NEVER blank or empty
  if (bullets.length === 0 && !bodyText && (!factCards || factCards.length === 0) && (!characterCards || characterCards.length === 0) && (!metrics || metrics.length === 0) && (!timeline || timeline.length === 0) && (!comparison || !comparison.left) && !hasValidQuote) {
    bullets.push(
      `Key operational principles, strategic dynamics, and foundational frameworks governing ${stripMarkdown(slide.title)}.`,
      `Core challenges, resource allocations, and systemic impacts across major sectors and regional networks.`,
      `Modern technological integration, data-driven management tools, and sustainable optimization strategies.`,
      `Actionable policy guidelines, long-term governance targets, and strategic recommendations for implementation.`
    );
  }

  // Check if images are globally disabled for this presentation deck or slide
  const userRequestedNoImages = Boolean(hideImages) || 
    (slide.imagePrompt && /^(none|false|no|disabled|off|null|undefined)$/i.test(slide.imagePrompt.trim())) ||
    (slide.imagePrompt && /no\s+images?|without\s+images?/i.test(slide.imagePrompt));

  const isPosterLayout = (slide.layout as string) === "poster";
  const directImageUrl = slide.imageUrl || (slide as any).image_url;
  // Presentations use only verified URLs supplied by the web-image pipeline.
  // Posters and infographics may generate a purpose-built visual when web
  // research found no suitable image.
  const imgUrl = userRequestedNoImages
    ? null
    : directImageUrl
      ? `/api/image-proxy?url=${encodeURIComponent(directImageUrl)}`
      : isPosterLayout
        ? getWebPulledImageUrl(slide.title, slide.imagePrompt || slide.subtitle || "", slide.slideNumber)
        : null;
  const showImage = Boolean(imgUrl);

  return (
    <div className="w-full relative shadow-xl rounded-2xl overflow-hidden transition-all">
      {/* Accent top bar */}
      <div className="h-2.5 rounded-t-2xl" style={{ backgroundColor: accent }} />

      <div className={`${currentTheme.cardBg} border ${currentTheme.border} border-t-0 rounded-b-2xl p-6 sm:p-8 lg:p-10 relative overflow-hidden`}>
        {/* Subtle gradient accent overlay */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ background: `radial-gradient(ellipse at top right, ${accent}, transparent 70%)` }} />

        <div className="relative z-10 space-y-6">
          {/* Section label + page badge */}
          <div className="flex items-center justify-between">
            {slide.sectionLabel ? (
              <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.2em] uppercase font-mono flex items-center gap-1.5" style={{ color: accent }}>
                <span>{slide.sectionLabel}</span>
              </span>
            ) : <span />}
            <span className="text-[10px] sm:text-xs font-mono px-3 py-1 rounded-lg font-bold shrink-0 shadow-sm" style={{ backgroundColor: `${accent}15`, color: accent, border: `1px solid ${accent}30` }}>
              {slide.layout === "poster" || totalSlides === 1 ? "A4 Academic Poster" : `Page ${slide.slideNumber} / ${totalSlides}`}
            </span>
          </div>

          {slide.layout === "poster" ? (
            <PosterLayoutView 
              slide={slide} 
              accent={accent} 
              isDark={isDark} 
              currentTheme={currentTheme} 
              showImage={showImage} 
              imgUrl={imgUrl} 
            />
          ) : (
            <>
              {showImage && imgUrl && (
                <div className="w-full my-4 rounded-2xl overflow-hidden shadow-lg border border-gray-200/60 dark:border-slate-800">
                  <SlideImage 
                    src={imgUrl} 
                    alt={slide.title} 
                    isDark={isDark}
                    className="w-full h-48 sm:h-64 lg:h-72 object-cover" 
                  />
                </div>
              )}

          {/* ─── FAST FACTS GRID (Lucide Icons) ─── */}
          {factCards && factCards.length > 0 && (() => {
            const count = factCards.length;
            const factCols = count === 4 ? "grid-cols-2 sm:grid-cols-4" : count === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
            return (
              <div className={`grid ${factCols} gap-3 sm:gap-4 my-2`}>
                {factCards.map((fact: any, i: number) => {
                  const label = fact.label || fact.title || fact.name || fact.key || `Fact ${i + 1}`;
                  const val = fact.value || fact.stat || fact.number || fact.val || fact.description || bullets[i] || "N/A";
                  return (
                    <div key={i} className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: `${accent}18`, border: `1px solid ${accent}35` }}>
                        {renderDynamicIcon(fact.icon || label || val, accent, 18)}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">{stripMarkdown(label)}</span>
                        <span className={`text-sm font-bold mt-0.5 block truncate ${isDark ? "text-white" : "text-gray-900"}`}>{stripMarkdown(val)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ─── FEATURE / PILLAR CARDS GRID (Lucide Icons) ─── */}
          {characterCards && characterCards.length > 0 && (() => {
            const count = characterCards.length;
            const gridCols = count === 1 
              ? "grid-cols-1" 
              : count === 2 
                ? "grid-cols-1 sm:grid-cols-2" 
                : count === 3 
                  ? "grid-cols-1 sm:grid-cols-3" 
                  : count === 4 
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" 
                    : "grid-cols-2 sm:grid-cols-3";

            return (
              <div className={`grid ${gridCols} gap-4 sm:gap-6 my-3 w-full`}>
                {characterCards.map((char: any, i: number) => {
                  const name = char.name || char.title || char.pillar || char.topic || `Pillar ${i + 1}`;
                  const role = char.role || char.subtitle || char.section || char.category;
                  const description = char.description || char.details || char.desc || char.content || char.text || bullets[i];
                  return (
                    <div key={i} className={`p-5 rounded-xl border flex flex-col justify-between space-y-3 transition-colors shadow-sm ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl shrink-0" style={{ backgroundColor: `${accent}18`, border: `1px solid ${accent}30` }}>
                          {renderDynamicIcon(role || name, accent, 20)}
                        </div>
                        <div>
                          <h4 className={`text-base font-bold leading-tight ${isDark ? "text-white" : "text-gray-900"}`}>{stripMarkdown(name)}</h4>
                          {role && (
                            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider block mt-0.5" style={{ color: accent }}>{stripMarkdown(role)}</span>
                          )}
                        </div>
                      </div>
                      {description && (
                        <p className={`text-xs sm:text-sm leading-relaxed ${currentTheme.textSub}`}>{stripMarkdown(description)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ─── MAIN CONTENT BLOCK (100% Full Width Text + Lucide Icon Bullet Cards) ─── */}
          <div className="w-full space-y-4">
            {bodyText && (
              <p className={`text-sm sm:text-base leading-relaxed max-w-none ${currentTheme.text}`}>
                {renderFormattedText(bodyText, isDark)}
              </p>
            )}
            {bullets.length > 0 && (
              <div className={bullets.length >= 2 ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-3.5"}>
                {bullets.map((b: string, i: number) => {
                  const isLastOdd = bullets.length % 2 !== 0 && i === bullets.length - 1;
                  return (
                    <div 
                      key={i} 
                      className={`p-4 rounded-xl border flex items-start gap-3.5 transition-all ${isLastOdd ? "md:col-span-2" : ""} ${
                        isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200/90 shadow-sm hover:border-gray-300"
                      }`}
                    >
                      <div className="p-1 rounded-md shrink-0 mt-0.5" style={{ backgroundColor: `${accent}18` }}>
                        <CheckCircle2 size={15} style={{ color: accent }} />
                      </div>
                      <span className={`text-sm sm:text-base leading-relaxed ${currentTheme.text}`}>{renderFormattedText(b, isDark)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── TIMELINE PROCESS FLOW (Lucide Step Nodes) ─── */}
          {timeline && timeline.length > 0 && (
            <div className="relative pl-6 space-y-4 my-2">
              <div className="absolute left-[11px] top-3 bottom-3 w-0.5 rounded-full" style={{ backgroundColor: `${accent}40` }} />
              {timeline.map((t: any, i: number) => {
                const titleStr = typeof t === "string" 
                  ? t 
                  : (t?.title || t?.milestone || t?.event || t?.name || t?.heading || t?.label || t?.year || t?.stepTitle || `Phase ${i + 1}`);

                const descStr = typeof t === "string"
                  ? ""
                  : (t?.description || t?.details || t?.desc || t?.summary || t?.text || t?.content || (bullets[i] || ""));

                const rawTitle = stripMarkdown(String(titleStr || "")).trim();
                const rawDesc = stripMarkdown(String(descStr || "")).trim();

                const displayTitle = rawTitle || bullets[i] || `Milestone ${i + 1}`;
                const displayDesc = rawDesc || (bullets[i + 1] ? bullets[i + 1] : `Key strategic phase for ${slide.title}`);

                return (
                  <div key={i} className="relative flex items-start gap-4">
                    <div className="absolute -left-6 top-1 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm" style={{ borderColor: accent, backgroundColor: `${accent}25`, color: accent }}>
                      {t?.step || i + 1}
                    </div>
                    <div className={`p-4 rounded-xl border flex-1 space-y-1.5 ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                      <div className="flex items-center gap-2">
                        {renderDynamicIcon(displayTitle, accent, 16)}
                        <h4 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{displayTitle}</h4>
                      </div>
                      {displayDesc && (
                        <p className={`text-xs sm:text-sm leading-relaxed ${currentTheme.textSub}`}>{displayDesc}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── METRICS GRID (Lucide Stat Icons) ─── */}
          {metrics && metrics.length > 0 && (() => {
            const count = metrics.length;
            const metricCols = count === 3 ? "grid-cols-1 sm:grid-cols-3" : count === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-2";
            return (
              <div className={`grid ${metricCols} gap-4 my-2`}>
                {metrics.map((m: any, i: number) => {
                  const valStr = String(m.value || m.number || m.stat || m.amount || m.val || "");
                  const labelStr = String(m.label || m.description || m.title || m.name || m.desc || "");
                  const valLen = valStr.length;
                  
                  const fontClass = valLen <= 8 
                    ? "text-2xl sm:text-3xl font-black" 
                    : valLen <= 16 
                      ? "text-base sm:text-lg font-extrabold" 
                      : "text-xs sm:text-sm font-bold leading-snug";

                  return (
                    <div key={i} className={`p-5 rounded-xl border flex flex-col justify-center text-center transition-colors relative overflow-hidden ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                      <div className="w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center" style={{ backgroundColor: `${accent}18` }}>
                        {renderDynamicIcon(labelStr || valStr, accent, 18)}
                      </div>
                      <span className={`${fontClass} block tracking-tight break-words`} style={{ color: accent }}>
                        {stripMarkdown(valStr)}
                      </span>
                      {labelStr && (
                        <span className={`text-xs mt-1.5 block font-medium leading-relaxed ${currentTheme.textSub}`}>
                          {stripMarkdown(labelStr)}
                        </span>
                      )}
                      {m.change && <span className="text-[10px] text-green-500 font-bold mt-1.5 block">{m.change}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ─── COMPARISON MATRIX (Lucide Badges) ─── */}
          {comparison && (comparison.left || comparison.right) && (() => {
            const leftObj = comparison.left || {};
            const rightObj = comparison.right || {};

            const leftPoints: string[] = [
              ...(Array.isArray(leftObj.points) ? leftObj.points : []),
              ...(Array.isArray(leftObj.items) ? leftObj.items : []),
              ...(Array.isArray(leftObj.bullets) ? leftObj.bullets : []),
              ...(typeof leftObj.description === "string" ? [leftObj.description] : [])
            ].filter(p => typeof p === "string" && p.trim().length > 0);

            const rightPoints: string[] = [
              ...(Array.isArray(rightObj.points) ? rightObj.points : []),
              ...(Array.isArray(rightObj.items) ? rightObj.items : []),
              ...(Array.isArray(rightObj.bullets) ? rightObj.bullets : []),
              ...(typeof rightObj.description === "string" ? [rightObj.description] : [])
            ].filter(p => typeof p === "string" && p.trim().length > 0);

            if (leftPoints.length === 0) {
              leftPoints.push(
                "High operational complexity and manual resource management",
                "Higher long-term maintenance costs and resource inefficiency",
                "Reactive crisis response rather than proactive planning"
              );
            }
            if (rightPoints.length === 0) {
              rightPoints.push(
                "Automated, sustainable, and data-driven infrastructure",
                "Significant long-term savings and circular resource recovery",
                "Proactive real-time monitoring and scalable governance"
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
                <div className={`p-5 rounded-xl border space-y-3 ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                  <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: `${accent}40` }}>
                    <AlertTriangle size={16} style={{ color: accent }} />
                    <h4 className="text-sm font-bold tracking-wide" style={{ color: accent }}>
                      {stripMarkdown(leftObj.title || "Traditional Approach")}
                    </h4>
                  </div>
                  <ul className="space-y-2.5">
                    {leftPoints.map((p: string, i: number) => (
                      <li key={i} className={`flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed ${currentTheme.text}`}>
                        <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 shadow-sm" style={{ backgroundColor: accent }} />
                        <span>{renderFormattedText(p, isDark)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={`p-5 rounded-xl border space-y-3 ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`}>
                  <div className="flex items-center gap-2 border-b border-cyan-500/40 pb-2">
                    <CheckCircle2 size={16} className="text-cyan-400" />
                    <h4 className="text-sm font-bold text-cyan-400 tracking-wide">
                      {stripMarkdown(rightObj.title || "Smart Management")}
                    </h4>
                  </div>
                  <ul className="space-y-2.5">
                    {rightPoints.map((p: string, i: number) => (
                      <li key={i} className={`flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed ${currentTheme.text}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0 shadow-sm" />
                        <span>{renderFormattedText(p, isDark)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })()}

          {/* ─── QUOTE ─── */}
          {hasValidQuote && (
            <div className={`p-6 rounded-xl border-l-4 my-2 flex items-start gap-4 ${isDark ? "bg-[#1E293B]/60 border-[#334155]" : "bg-slate-50 border-gray-200"}`} style={{ borderLeftColor: accent }}>
              <Quote size={24} className="shrink-0 mt-1" style={{ color: accent }} />
              <div>
                <p className={`text-base sm:text-lg italic leading-relaxed ${currentTheme.text}`}>
                  &ldquo;{stripMarkdown(quote.text)}&rdquo;
                </p>
                {quote.author && (
                  <span className="text-sm font-bold mt-2 block" style={{ color: accent }}>
                    &mdash; {quote.author}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ─── EXECUTIVE TAKEAWAY CALLOUT BOX ─── */}
          <div className={`p-4 rounded-xl border flex items-start gap-3 mt-4 transition-all ${isDark ? "bg-[#0F172A] border-[#1E293B]" : "bg-slate-50 border-gray-200/90 shadow-sm"}`}>
            <div className="p-2 rounded-lg shrink-0 mt-0.5" style={{ backgroundColor: `${accent}18`, color: accent }}>
              <Lightbulb size={16} />
            </div>
            <div>
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest block" style={{ color: accent }}>
                Executive Takeaway
              </span>
              <p className={`text-xs sm:text-sm mt-0.5 leading-relaxed font-medium ${currentTheme.textSub}`}>
                {stripMarkdown(bullets[0] || (slide.subtitle && slide.subtitle !== slide.title ? slide.subtitle : null) || bodyText || `Strategic management of ${slide.title} is essential for operational resilience and sustainable growth.`)}
              </p>
            </div>
          </div>
          </>
          )}
        </div>

        {/* Slide footer */}
        <div className={`relative z-10 mt-8 pt-3 border-t flex items-center justify-between text-[10px] font-mono ${isDark ? "border-[#25252E] text-gray-500" : "border-gray-200 text-gray-400"}`}>
          <span className="truncate max-w-[250px]">{slide.title}</span>
          <span>{slide.layout === "poster" || totalSlides === 1 ? "A4 Academic Poster" : `Slide ${slide.slideNumber} of ${totalSlides}`}</span>
        </div>
      </div>
    </div>
  );
}

function ensurePosterSingleSlide(presData: PresentationData): PresentationData {
  if (!presData || !Array.isArray(presData.slides) || presData.slides.length === 0) {
    return presData;
  }

  // If already 1 slide, force layout = "poster"
  if (presData.slides.length === 1) {
    presData.slides[0].layout = "poster";
    return presData;
  }

  // Multi-slide deck returned when user requested a poster — consolidate all research facts & pillars into 1 poster slide!
  const firstSlide = presData.slides[0] || {};
  const allBullets: string[] = [];
  const allPillars: any[] = [];
  const allMetrics: any[] = [];
  const allTimeline: any[] = [];

  presData.slides.forEach((s: any, idx: number) => {
    const c = s.content || {};
    if (Array.isArray(c.bullets)) allBullets.push(...c.bullets);
    if (Array.isArray(c.characterCards)) allPillars.push(...c.characterCards);
    if (Array.isArray(c.factCards)) allMetrics.push(...c.factCards);
    if (Array.isArray(c.metrics)) allMetrics.push(...c.metrics);
    if (Array.isArray(c.timeline)) allTimeline.push(...c.timeline);

    if (s.title && idx > 0 && allPillars.length < 4) {
      allPillars.push({
        name: s.title,
        role: `PILLAR ${idx}`,
        description: s.subtitle || (c.bullets && c.bullets[0]) || `Key insights on ${s.title}`
      });
    }
  });

  const posterSlide: any = {
    id: "s1",
    slideNumber: 1,
    layout: "poster",
    sectionLabel: "A4 ACADEMIC RESEARCH POSTER",
    title: presData.title || firstSlide.title || "Academic Research Poster",
    subtitle: firstSlide.subtitle || "Comprehensive Strategic & Technical Breakdown",
    accentColor: firstSlide.accentColor || "#3B82F6",
    imagePrompt: firstSlide.imagePrompt,
    content: {
      bodyText: firstSlide.content?.bodyText || "Detailed analytical breakdown of strategic dynamics and foundational frameworks.",
      factCards: allMetrics.slice(0, 4),
      characterCards: allPillars.slice(0, 4),
      bullets: allBullets.slice(0, 4),
      timeline: allTimeline.slice(0, 4)
    }
  };

  return {
    ...presData,
    slides: [posterSlide]
  };
}

/* ═════════════════════════════════════════════════════════════════
   ██  MAIN GAMMA PRESENTATION STUDIO COMPONENT
   ═════════════════════════════════════════════════════════════════ */
export default function GammaPresentationStudio({ data: rawData, onClose }: GammaPresentationStudioProps) {
  const isPosterDeck = Boolean(
    (rawData?.slides && rawData.slides.some(s => s.layout === "poster")) ||
    (rawData?.title && /\b(poster|banner|infographic|flyer)\b/i.test(rawData.title))
  );

  const data = (isPosterDeck && rawData) ? ensurePosterSingleSlide(rawData) : rawData;
  const [currentThemeKey, setCurrentThemeKey] = useState<SlideTheme>(data?.theme || "academic-clean");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const currentTheme = themeConfigs[currentThemeKey] || themeConfigs["academic-clean"];

  const handleExportPPTX = async () => {
    setExporting("pptx");
    try {
      const pres = new pptxgen();
      pres.layout = "LAYOUT_16x9";
      const docTitle = data?.title || "Presentation";
      pres.title = docTitle;

      const isDarkTheme = currentTheme.isDark;
      const bgHex = isDarkTheme ? "0B0F17" : "F8FAFC";
      const cardBgHex = isDarkTheme ? "0F172A" : "FFFFFF";
      const cardBorderHex = isDarkTheme ? "1E293B" : "E2E8F0";
      const textTitleHex = isDarkTheme ? "FFFFFF" : "111827";
      const textSubHex = isDarkTheme ? "94A3B8" : "475569";
      const textBodyHex = isDarkTheme ? "E2E8F0" : "1F2937";

      for (const slide of (data?.slides || [])) {
        const pptSlide = pres.addSlide();
        const accent = (slide?.accentColor || currentTheme?.accentDefault || "3B82F6").replace("#", "");
        const content = slide.content || {} as any;
        
        // 1. Slide Background
        pptSlide.background = { color: bgHex };

        // 2. Top Color Accent Line
        pptSlide.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: 10.0, h: 0.08,
          fill: { color: accent }
        });

        // 3. Header Section Badge & Page Pill
        if (slide.sectionLabel) {
          pptSlide.addShape(pres.ShapeType.roundRect, {
            x: 0.5, y: 0.35, w: 2.0, h: 0.3,
            fill: { color: `${accent}15` },
            line: { color: `${accent}40`, width: 1 },
            rectRadius: 0.1
          });
          pptSlide.addText(slide.sectionLabel.toUpperCase(), {
            x: 0.5, y: 0.35, w: 2.0, h: 0.3,
            fontSize: 9, bold: true, color: accent, fontFace: "Arial", align: "center"
          });
        }

        // Page Number Badge
        pptSlide.addText(`Page ${slide.slideNumber} of ${data.slides.length}`, {
          x: 7.5, y: 0.35, w: 2.0, h: 0.3,
          fontSize: 9, bold: true, color: "94A3B8", fontFace: "Arial", align: "right"
        });

        // 4. Slide Title & Subtitle
        pptSlide.addText(stripMarkdown(slide.title), {
          x: 0.5, y: slide.sectionLabel ? 0.75 : 0.45, w: 9.0, h: 0.65,
          fontSize: 22, bold: true, color: textTitleHex, fontFace: "Arial"
        });

        if (slide.subtitle) {
          pptSlide.addText(stripMarkdown(slide.subtitle), {
            x: 0.5, y: slide.sectionLabel ? 1.35 : 1.1, w: 9.0, h: 0.35,
            fontSize: 12, italic: true, color: textSubHex, fontFace: "Arial"
          });
        }

        const bodyText = content.bodyText || (slide as any).bodyText || (slide as any).description;
        const bullets = [
          ...(Array.isArray(content.bullets) ? content.bullets : []),
          ...(Array.isArray((slide as any).bullets) ? (slide as any).bullets : []),
          ...(Array.isArray((slide as any).points) ? (slide as any).points : [])
        ];
        const factCards = content.factCards || (slide as any).factCards || [];
        const metrics = content.metrics || (slide as any).metrics || [];

        const startY = slide.subtitle ? 1.8 : 1.4;

        // 5. Render Structured Fact Cards or Metrics if present
        if (factCards && factCards.length > 0) {
          const cardW = 2.8;
          const gap = 0.2;
          factCards.slice(0, 3).forEach((fact: any, idx: number) => {
            const posX = 0.5 + idx * (cardW + gap);
            pptSlide.addShape(pres.ShapeType.roundRect, {
              x: posX, y: startY, w: cardW, h: 0.9,
              fill: { color: cardBgHex },
              line: { color: cardBorderHex, width: 1 },
              rectRadius: 0.1
            });
            pptSlide.addText((fact.label || "KEY METRIC").toUpperCase(), {
              x: posX + 0.15, y: startY + 0.1, w: cardW - 0.3, h: 0.25,
              fontSize: 9, bold: true, color: "94A3B8", fontFace: "Arial"
            });
            pptSlide.addText(stripMarkdown(fact.value || ""), {
              x: posX + 0.15, y: startY + 0.35, w: cardW - 0.3, h: 0.45,
              fontSize: 14, bold: true, color: accent, fontFace: "Arial"
            });
          });
        } else if (metrics && metrics.length > 0) {
          const cardW = 2.8;
          const gap = 0.2;
          metrics.slice(0, 3).forEach((m: any, idx: number) => {
            const posX = 0.5 + idx * (cardW + gap);
            const valStr = String(m.value || m.number || m.stat || "");
            const labelStr = String(m.label || m.description || m.title || "");
            pptSlide.addShape(pres.ShapeType.roundRect, {
              x: posX, y: startY, w: cardW, h: 1.0,
              fill: { color: cardBgHex },
              line: { color: cardBorderHex, width: 1 },
              rectRadius: 0.1
            });
            pptSlide.addText(stripMarkdown(valStr), {
              x: posX + 0.1, y: startY + 0.1, w: cardW - 0.2, h: 0.45,
              fontSize: 20, bold: true, color: accent, fontFace: "Arial", align: "center"
            });
            if (labelStr) {
              pptSlide.addText(stripMarkdown(labelStr), {
                x: posX + 0.1, y: startY + 0.55, w: cardW - 0.2, h: 0.35,
                fontSize: 9, color: textSubHex, fontFace: "Arial", align: "center"
              });
            }
          });
        }

        // 6. Render Body Text & Structured Bullet Cards
        const contentY = (factCards.length > 0 || metrics.length > 0) ? startY + 1.15 : startY;

        if (bodyText) {
          pptSlide.addText(stripMarkdown(bodyText), {
            x: 0.5, y: contentY, w: 9.0, h: 0.6,
            fontSize: 11, color: textBodyHex, fontFace: "Arial", lineSpacing: 16
          });
        }

        const bulletStartY = bodyText ? contentY + 0.65 : contentY;

        if (bullets && bullets.length > 0) {
          const bulletH = Math.min(0.65, (3.2 / bullets.length) - 0.1);
          bullets.forEach((b: string, idx: number) => {
            const bY = bulletStartY + idx * (bulletH + 0.1);
            if (bY < 4.9) {
              pptSlide.addShape(pres.ShapeType.roundRect, {
                x: 0.5, y: bY, w: 9.0, h: bulletH,
                fill: { color: cardBgHex },
                line: { color: cardBorderHex, width: 1 },
                rectRadius: 0.08
              });
              pptSlide.addText(`✓  ${stripMarkdown(b)}`, {
                x: 0.65, y: bY + 0.05, w: 8.7, h: bulletH - 0.1,
                fontSize: 11, color: textBodyHex, fontFace: "Arial", lineSpacing: 15
              });
            }
          });
        }

        // 7. Executive Takeaway Box (Bottom of Slide)
        const takeawayY = 5.0;
        const takeawayText = bullets[0] || bodyText || `Strategic management of ${slide.title} is essential for sustainable growth.`;
        pptSlide.addShape(pres.ShapeType.roundRect, {
          x: 0.5, y: takeawayY, w: 9.0, h: 0.55,
          fill: { color: cardBgHex },
          line: { color: accent, width: 1 },
          rectRadius: 0.08
        });
        pptSlide.addText(`💡 EXECUTIVE TAKEAWAY: ${stripMarkdown(takeawayText)}`, {
          x: 0.65, y: takeawayY + 0.05, w: 8.7, h: 0.45,
          fontSize: 10, bold: true, color: accent, fontFace: "Arial"
        });
      }

      const safeTitle = (data?.title || "Presentation").replace(/[^\w\s\-]/gi, "") || "Presentation";
      const fileName = `${safeTitle}_Presentation.pptx`;
      await pres.writeFile({ fileName });
    } catch (e) {
      console.error("PPTX export error:", e);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPDF = async () => {
    setExporting("pdf");
    try {
      const container = scrollContainerRef.current;
      if (!container) return;

      const canvas = await html2canvas(container, { 
        scale: 1.5, 
        useCORS: true, 
        allowTaint: true,
        backgroundColor: currentTheme.isDark ? "#0B0F17" : "#F8FAFC",
        onclone: prepareHtml2CanvasClone,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height]
      });

      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      const safeTitle = (data?.title || "Presentation").replace(/[^\w\s\-]/gi, "") || "Presentation";
      const fileName = `${safeTitle}_Deck.pdf`;
      pdf.save(fileName);
    } catch (e) {
      console.warn("html2canvas PDF render error, using vector jsPDF fallback:", e);

      // Fallback: Generate clean vector PDF directly using jsPDF
      try {
        const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();

        (data?.slides || []).forEach((s, idx) => {
          if (idx > 0) pdf.addPage();

          // Background
          pdf.setFillColor(currentTheme.isDark ? 11 : 248, currentTheme.isDark ? 15 : 250, currentTheme.isDark ? 23 : 252);
          pdf.rect(0, 0, pageW, pageH, "F");

          // Header
          pdf.setTextColor(currentTheme.isDark ? 255 : 15, currentTheme.isDark ? 255 : 23, currentTheme.isDark ? 255 : 42);
          pdf.setFontSize(20);
          pdf.setFont("helvetica", "bold");
          pdf.text(stripMarkdown(s.title), 30, 45);

          if (s.subtitle) {
            pdf.setTextColor(148, 163, 184);
            pdf.setFontSize(11);
            pdf.setFont("helvetica", "normal");
            pdf.text(stripMarkdown(s.subtitle), 30, 65);
          }

          // Content Bullets
          const c = s.content || {} as any;
          const bullets = c.bullets || [];
          let y = 100;
          pdf.setFontSize(11);
          pdf.setTextColor(currentTheme.isDark ? 226 : 30, currentTheme.isDark ? 232 : 41, currentTheme.isDark ? 240 : 59);

          for (const b of bullets) {
            const lines = pdf.splitTextToSize(`• ${stripMarkdown(b)}`, pageW - 60);
            pdf.text(lines, 30, y);
            y += lines.length * 16 + 8;
          }
        });

        const safeTitle = (data?.title || "Presentation").replace(/[^\w\s\-]/gi, "") || "Presentation";
        const fileName = `${safeTitle}_Deck.pdf`;
        pdf.save(fileName);
      } catch (fallbackErr) {
        console.error("Vector PDF fallback error:", fallbackErr);
      }
    } finally {
      setExporting(null);
    }
  };

  const handleCopyMarkdown = () => {
    let md = `# ${data?.title || "Presentation"}\n\n`;
    (data?.slides || []).forEach((s) => {
      const c = s.content || {} as any;
      md += `## Slide ${s.slideNumber}: ${stripMarkdown(s.title)}\n`;
      if (s.subtitle) md += `*${stripMarkdown(s.subtitle)}*\n\n`;
      if (c.bodyText) md += `${stripMarkdown(c.bodyText)}\n\n`;
      if (c.bullets) c.bullets.forEach((b: string) => (md += `- ${stripMarkdown(b)}\n`));
      md += `\n`;
    });
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const slides = data?.slides || [];

  return (
    <div className={`w-full h-full flex flex-col ${currentTheme.appBg} transition-colors duration-300 font-sans relative`}>
      {/* ─── HEADER BAR ─── */}
      {/* ─── MINIMAL ANIMATED HEADER BAR ─── */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${currentTheme.headerBg} backdrop-blur-md shrink-0 z-20 shadow-sm`}>
        {/* Left Title & Status */}
        <div className="flex items-center gap-2.5 overflow-hidden">
          <motion.div 
            whileHover={{ rotate: 15, scale: 1.1 }}
            className="p-2 rounded-xl bg-blue-500/10 dark:bg-blue-400/10 text-blue-500 border border-blue-500/20 shrink-0 shadow-inner"
          >
            <Sparkles size={16} className="animate-pulse" />
          </motion.div>
          <div className="min-w-0">
            <h3 className={`text-xs sm:text-sm font-bold truncate max-w-[180px] sm:max-w-md ${currentTheme.text}`}>
              {data?.title || "Presentation"}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-gray-500 font-mono font-medium truncate">{isPosterDeck ? "Poster Studio" : "Presentation Studio"}</span>
              <span className="text-gray-400 text-[10px]">&middot;</span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                {isPosterDeck || slides[0]?.layout === "poster" ? "1 A4 Research Poster" : `${slides.length} Slides`}
              </span>
            </div>
          </div>
        </div>

        {/* Right Icon-Only Action Bar */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Theme Toggle (Sun / Moon) */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setCurrentThemeKey(currentThemeKey === "academic-clean" ? "cosmic-dark" : "academic-clean")}
            className={`p-2 rounded-xl border transition-colors flex items-center justify-center ${
              currentThemeKey === "cosmic-dark" 
                ? "bg-blue-950/40 border-blue-500/40 text-blue-300 hover:bg-blue-900/60" 
                : "bg-amber-50 border-amber-300 text-amber-600 hover:bg-amber-100"
            }`}
            title={`Switch to ${currentThemeKey === "academic-clean" ? "Dark Mode" : "Light Mode"}`}
          >
            {currentThemeKey === "academic-clean" ? <Sun size={16} /> : <Moon size={16} />}
          </motion.button>

          {/* Copy Markdown */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleCopyMarkdown}
            className="p-2 rounded-xl bg-white dark:bg-[#18181D] hover:bg-gray-100 dark:hover:bg-[#252530] border border-gray-200 dark:border-[#2a2a35] text-gray-700 dark:text-gray-300 transition-colors flex items-center justify-center"
            title="Copy Presentation as Markdown"
          >
            {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
          </motion.button>

          {/* Export PPTX Button (Minimal Animated Icon) */}
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={handleExportPPTX}
            disabled={!!exporting}
            className="relative p-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center group"
            title="Export PowerPoint (PPTX)"
          >
            {exporting === "pptx" ? (
              <RefreshCw size={16} className="animate-spin text-white" />
            ) : (
              <PptIcon size={16} className="transition-transform group-hover:scale-110" />
            )}
          </motion.button>

          {/* Export PDF Button (Minimal Animated Icon) */}
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={handleExportPDF}
            disabled={!!exporting}
            className="p-2 rounded-xl bg-white dark:bg-[#18181D] hover:bg-gray-100 dark:hover:bg-[#252530] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-[#2a2a35] shadow-sm disabled:opacity-50 flex items-center justify-center group"
            title="Export PDF Document"
          >
            {exporting === "pdf" ? (
              <RefreshCw size={16} className="animate-spin text-blue-500" />
            ) : (
              <FileText size={16} className="transition-transform group-hover:scale-110 text-gray-600 dark:text-gray-400" />
            )}
          </motion.button>

          {/* Close Studio Button (if onClose provided) */}
          {onClose && (
            <motion.button
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="p-2 rounded-xl bg-gray-100 dark:bg-[#202028] hover:bg-rose-500 hover:text-white text-gray-500 dark:text-gray-400 transition-colors flex items-center justify-center ml-1"
              title="Close Presentation Studio"
            >
              <XCircle size={16} />
            </motion.button>
          )}
        </div>
      </div>

      {/* ─── BODY (100% Width Studio Workspace) ─── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Main Content — Smooth 60fps Hardware-Accelerated Scroll of All Slides */}
        <div
          ref={scrollContainerRef}
          className="flex-1 h-full overflow-y-auto overflow-x-hidden px-4 sm:px-6 lg:px-12 py-6 space-y-6 custom-scrollbar transform-gpu overscroll-contain"
        >
          {slides.map((slide, idx) => (
            <div
              key={slide.id || idx}
              className="w-full max-w-4xl mx-auto transform-gpu"
            >
              <SlideCard slide={slide} totalSlides={slides.length} theme={currentThemeKey} hideImages={data?.hideImages} />
            </div>
          ))}

          {/* Bottom spacer */}
          <div className="h-10" />
        </div>
      </div>
    </div>
  );
}
