import React, { useState, useEffect } from "react";
import { 
  X, 
  FileSpreadsheet, 
  FileText, 
  Presentation, 
  FileCode, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  Download,
  Globe,
  LayoutGrid,
  ImageIcon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import * as xlsx from "xlsx";
import { supabase } from "@/lib/supabase";
import { PresentationData } from "@/types/presentation";
import { ReportData } from "@/types/report";
import VisualDesignStudio from "./VisualDesignStudio";
import CanvaDocStudio from "./CanvaDocStudio";

type Attachment = {
  url?: string;
  name: string;
  type: string;
  base64?: string;
  presentationData?: PresentationData;
  reportData?: ReportData;
};

type FilePreviewModalProps = {
  attachment: Attachment;
  onClose: () => void;
};

type SlideData = {
  slideNumber: number;
  title: string;
  bullets: string[];
  images: string[];
};

async function safeLoadZip(buffer: ArrayBuffer) {
  // @ts-ignore
  const jszipModule = await import("jszip");
  const JSZip = (jszipModule as any).default || jszipModule;
  if (typeof JSZip.loadAsync === "function") {
    return await JSZip.loadAsync(buffer);
  } else if (typeof JSZip === "function") {
    const inst = new JSZip();
    if (typeof inst.loadAsync === "function") {
      return await inst.loadAsync(buffer);
    }
  }
  throw new Error("JSZip loading failed");
}

export default function FilePreviewModal({ attachment, onClose }: FilePreviewModalProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [wordParagraphs, setWordParagraphs] = useState<string[]>([]);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [publicFileUrl, setPublicFileUrl] = useState<string | null>(/^https?:\/\//i.test(attachment.url || '') ? attachment.url! : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerEngine, setViewerEngine] = useState<"officelive" | "google" | "canvas">(attachment.url?.startsWith('/api/attachments/') ? 'canvas' : 'officelive');
  const [showThumbnails, setShowThumbnails] = useState(true);

  const nameLower = (attachment.name || "").toLowerCase();
  const typeLower = (attachment.type || "").toLowerCase();

  const isExcel = typeLower.includes("spreadsheetml") || typeLower.includes("ms-excel") || /\.(xlsx|xls)$/i.test(nameLower);
  const isPpt = typeLower.includes("presentationml") || typeLower.includes("ms-powerpoint") || /\.(pptx|ppt)$/i.test(nameLower);
  const isWord = typeLower.includes("wordprocessingml") || typeLower.includes("msword") || /\.(docx|doc)$/i.test(nameLower);
  const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
  const isImage = typeLower.startsWith("image/");
  const isText = typeLower.startsWith("text/") || typeLower.includes("json") || /\.(txt|csv|json|md|py|js|ts|html|css)$/i.test(nameLower);

  // 1. Resolve or Generate Public HTTP URL for Office Live / Google Viewers
  useEffect(() => {
    async function resolvePublicUrl() {
      if (attachment.url && /^https?:\/\//i.test(attachment.url)) {
        setPublicFileUrl(attachment.url);
        return;
      }

      if (attachment.base64 && (isPpt || isWord || isExcel || isPdf)) {
        try {
          const fileName = `preview-${Date.now()}-${attachment.name.replace(/[^\w.\-]+/g, "_")}`;
          const binaryString = atob(attachment.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: attachment.type || "application/octet-stream" });

          const { data, error: uploadErr } = await supabase.storage
            .from("chat-attachments")
            .upload(fileName, blob, {
              contentType: attachment.type || "application/octet-stream",
              upsert: true,
            });

          if (!uploadErr && data) {
            const { data: urlData } = supabase.storage
              .from("chat-attachments")
              .getPublicUrl(data.path);

            if (urlData?.publicUrl) {
              setPublicFileUrl(urlData.publicUrl);
            }
          }
        } catch (err) {
          console.warn("Public URL generation error:", err);
        }
      }
    }

    resolvePublicUrl();
  }, [attachment, isPpt, isWord, isExcel, isPdf]);

  // 2. Load File Data & Slide Structures
  useEffect(() => {
    async function loadPreview() {
      setLoading(true);
      setError(null);
      
      try {
        let buffer: ArrayBuffer | null = null;
        
        if (attachment.base64) {
          const binaryString = atob(attachment.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else if (attachment.url) {
          const res = await fetch(attachment.url);
          if (res.ok) {
            buffer = await res.arrayBuffer();
          }
        }

        if (isExcel && buffer) {
          const workbook = xlsx.read(buffer, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];
          const html = xlsx.utils.sheet_to_html(sheet);
          setHtmlContent(html);
        } else if (isPpt && buffer) {
          const zip = await safeLoadZip(buffer);

          // Extract images in ppt/media/
          const mediaFiles = Object.keys(zip.files).filter(f => /^ppt\/media\//i.test(f));
          const mediaDataMap: Record<string, string> = {};
          
          for (const mediaPath of mediaFiles) {
            const fileExt = mediaPath.split('.').pop()?.toLowerCase() || 'png';
            const mimeType = fileExt === 'svg' ? 'image/svg+xml' : (fileExt === 'jpg' || fileExt === 'jpeg') ? 'image/jpeg' : fileExt === 'gif' ? 'image/gif' : 'image/png';
            const base64 = await zip.files[mediaPath].async("base64");
            const cleanKey = mediaPath.replace(/^ppt\//i, "");
            mediaDataMap[cleanKey] = `data:${mimeType};base64,${base64}`;
            mediaDataMap[mediaPath] = `data:${mimeType};base64,${base64}`;
          }

          // Extract slides sorted numerically
          const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f));
          slideFiles.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
            const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
            return numA - numB;
          });

          const extractedSlides: SlideData[] = [];
          for (let i = 0; i < slideFiles.length; i++) {
            const slidePath = slideFiles[i];
            const xmlContent = await zip.files[slidePath].async("string");

            // Check relationship file for slide images
            const relsPath = slidePath.replace(/ppt\/slides\/slide(\d+)\.xml$/i, "ppt/slides/_rels/slide$1.xml.rels");
            const slideImages: string[] = [];

            if (zip.files[relsPath]) {
              const relsXml = await zip.files[relsPath].async("string");
              const relMatches = relsXml.match(/Target=["']([^"']+)["']/gi) || [];
              for (const relMatch of relMatches) {
                const target = relMatch.replace(/^Target=["']/i, "").replace(/["']$/, "");
                if (target.includes("media/")) {
                  const cleanTarget = target.replace(/^\.\.\//, "");
                  const fullPath = `ppt/${cleanTarget}`;
                  if (mediaDataMap[fullPath]) {
                    slideImages.push(mediaDataMap[fullPath]);
                  } else if (mediaDataMap[cleanTarget]) {
                    slideImages.push(mediaDataMap[cleanTarget]);
                  }
                }
              }
            }

            // Extract text
            const pMatches = xmlContent.match(/<a:p[^>]*>([\s\S]*?)<\/a:p>/gi) || [];
            const textLines: string[] = [];
            for (const pXml of pMatches) {
              const tMatches = pXml.match(/<a:t[^>]*>(.*?)<\/a:t>/gi) || [];
              const lineText = tMatches.map((m: string) => m.replace(/<[^>]+>/g, "").trim()).filter(Boolean).join(" ");
              if (lineText) textLines.push(lineText);
            }

            // Filter page number junk & dates
            const cleanLines = textLines.filter(line => !/^\d{1,3}$/.test(line) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line));

            const title = cleanLines[0] || textLines[0] || `Slide ${i + 1}`;
            const bullets = cleanLines.slice(1);

            extractedSlides.push({
              slideNumber: i + 1,
              title: title,
              bullets: bullets,
              images: [...new Set(slideImages)]
            });
          }

          if (extractedSlides.length > 0) {
            setSlides(extractedSlides);
          }
        } else if (isWord && buffer) {
          const zip = await safeLoadZip(buffer);
          if (zip.files["word/document.xml"]) {
            const xmlContent = await zip.files["word/document.xml"].async("string");
            const pMatches = xmlContent.match(/<w:p[^>]*>([\s\S]*?)<\/w:p>/gi) || [];
            const paragraphs: string[] = [];
            for (const pXml of pMatches) {
              const tMatches = pXml.match(/<w:t[^>]*>(.*?)<\/w:t>/gi) || [];
              const pText = tMatches.map((m: string) => m.replace(/<[^>]+>/g, "")).join("");
              if (pText.trim()) paragraphs.push(pText.trim());
            }
            setWordParagraphs(paragraphs);
          }
        } else if (isText) {
          if (attachment.base64) {
            const binaryString = atob(attachment.base64);
            setTextContent(binaryString);
          } else if (buffer) {
            const decoder = new TextDecoder("utf-8");
            setTextContent(decoder.decode(buffer));
          }
        }
      } catch (err: any) {
        console.error("Preview error:", err);
      } finally {
        setLoading(false);
      }
    }

    loadPreview();
  }, [attachment, isExcel, isPpt, isWord, isText]);

  // Keyboard Navigation for Slides
  useEffect(() => {
    if (!isPpt || slides.length === 0 || viewerEngine !== "canvas") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPpt, slides.length, viewerEngine]);

  const fileUrl = publicFileUrl || (attachment.base64 ? `data:${attachment.type};base64,${attachment.base64}` : attachment.url);

  // Default to Office Live Viewer for PPTs if public URL is available or generated
  const officeLiveUrl = publicFileUrl ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicFileUrl)}` : null;
  const googleDocsUrl = publicFileUrl ? `https://docs.google.com/gview?url=${encodeURIComponent(publicFileUrl)}&embedded=true` : null;
  if (attachment.presentationData) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 15 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl h-[92vh] rounded-2xl shadow-2xl overflow-hidden border border-[#27272A]"
          >
            <VisualDesignStudio data={attachment.presentationData} onClose={onClose} />
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  if (attachment.reportData) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 15 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl h-[92vh] rounded-2xl shadow-2xl overflow-hidden border border-[#27272A]"
          >
            <CanvaDocStudio data={attachment.reportData} onClose={onClose} />
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 15 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-6xl h-[92vh] bg-[#121214] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#27272A] text-white"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272A] bg-[#18181B] shrink-0">
            <div className="flex items-center gap-3 overflow-hidden">
              {isPpt && <Presentation size={20} className="text-gray-300 shrink-0" />}
              {isWord && <FileText size={20} className="text-gray-300 shrink-0" />}
              {isExcel && <FileSpreadsheet size={20} className="text-gray-300 shrink-0" />}
              {isText && <FileCode size={20} className="text-gray-300 shrink-0" />}
              <div>
                <h3 className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                  {attachment.name}
                </h3>
                {isPpt && (
                  <p className="text-[11px] text-gray-400 font-mono">
                    Original PowerPoint Presentation {slides.length > 0 ? `(${slides.length} Slides)` : ""}
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Viewer Engine Selector for PPTs */}
              {isPpt && (
                <div className="flex items-center bg-[#1A1A1E] rounded-lg p-1 border border-[#27272A]">
                  {officeLiveUrl && (
                    <button
                      onClick={() => setViewerEngine("officelive")}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewerEngine === 'officelive' ? 'bg-[#2A2A30] text-white shadow-sm font-semibold border border-gray-700' : 'text-gray-400 hover:text-white'}`}
                      title="Original Microsoft PowerPoint Web Presentation View"
                    >
                      <Globe size={13} className="text-gray-300" />
                      <span>Office Live (Original)</span>
                    </button>
                  )}
                  {googleDocsUrl && (
                    <button
                      onClick={() => setViewerEngine("google")}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewerEngine === 'google' ? 'bg-[#2A2A30] text-white shadow-sm font-semibold border border-gray-700' : 'text-gray-400 hover:text-white'}`}
                      title="Google Presentation View"
                    >
                      <Globe size={13} className="text-gray-300" />
                      <span>Google Slides</span>
                    </button>
                  )}
                  {slides.length > 0 && (
                    <button
                      onClick={() => setViewerEngine("canvas")}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewerEngine === 'canvas' ? 'bg-[#2A2A30] text-white shadow-sm font-semibold border border-gray-700' : 'text-gray-400 hover:text-white'}`}
                      title="Extracted Slide Reader View"
                    >
                      <LayoutGrid size={13} className="text-gray-300" />
                      <span>Slide Deck</span>
                    </button>
                  )}
                </div>
              )}

              {fileUrl && (
                <a
                  href={fileUrl}
                  download={attachment.name}
                  className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors text-gray-400 hover:text-white"
                  title="Download Original PPT File"
                >
                  <Download size={18} />
                </a>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-hidden bg-[#0D0D0E] relative flex">
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-[#121214]/90 z-30">
                <Loader2 size={36} className="animate-spin mb-4 text-gray-300" />
                <p className="text-sm font-medium">Loading presentation preview...</p>
              </div>
            )}

            {/* 1. Official Microsoft Office Presentation Web Viewer (100% ORIGINAL LOOK) */}
            {isPpt && viewerEngine === "officelive" && officeLiveUrl && (
              <div className="w-full h-full relative">
                <iframe 
                  src={officeLiveUrl} 
                  className="w-full h-full border-none"
                  title={attachment.name}
                  allowFullScreen
                />
              </div>
            )}

            {/* 2. Google Slides Presentation Viewer */}
            {isPpt && viewerEngine === "google" && googleDocsUrl && (
              <div className="w-full h-full relative">
                <iframe 
                  src={googleDocsUrl} 
                  className="w-full h-full border-none"
                  title={attachment.name}
                  allowFullScreen
                />
              </div>
            )}

            {/* 3. Fallback Slide Deck Presentation Player */}
            {isPpt && (viewerEngine === "canvas" || !officeLiveUrl) && slides.length > 0 && (
              <div className="w-full h-full flex overflow-hidden">
                {/* Left Slide Thumbnails Sidebar */}
                {showThumbnails && (
                  <div className="w-56 h-full bg-[#161618] border-r border-[#242428] flex flex-col shrink-0 overflow-hidden">
                    <div className="p-3 border-b border-[#242428] text-xs font-semibold text-gray-400 flex items-center justify-between">
                      <span>ORIGINAL SLIDES ({slides.length})</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-2.5 custom-scrollbar">
                      {slides.map((slide, idx) => (
                        <button
                          key={idx}
                          onClick={() => setCurrentSlideIndex(idx)}
                          className={`w-full text-left p-2.5 rounded-xl border transition-all flex flex-col gap-1.5 relative group ${currentSlideIndex === idx ? 'bg-[#27272A] border-gray-500 shadow-md ring-1 ring-gray-500/50' : 'bg-[#1D1D20] border-[#2A2A2E] hover:border-gray-500/50 hover:bg-[#222226]'}`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-gray-300 font-bold border border-gray-700">
                              Slide {slide.slideNumber}
                            </span>
                            {slide.images.length > 0 && (
                              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                <ImageIcon size={10} />
                                {slide.images.length}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold text-gray-200 line-clamp-2 leading-snug">
                            {slide.title}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Main Slide Canvas */}
                <div className="flex-1 h-full flex flex-col justify-between p-4 sm:p-6 overflow-y-auto">
                  {/* Controls Header */}
                  <div className="flex items-center justify-between bg-[#18181B] px-4 py-2.5 rounded-xl border border-[#27272A] shadow-sm mb-4 shrink-0">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                      <span>Slide {currentSlideIndex + 1} of {slides.length}</span>
                      <span className="text-gray-500 hidden sm:inline">| Use ← → keys to flip slides</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={currentSlideIndex === 0}
                        onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
                        className="p-1.5 rounded-lg bg-[#27272A] disabled:opacity-30 hover:bg-[#333338] transition-colors text-white"
                        title="Previous Slide"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        disabled={currentSlideIndex === slides.length - 1}
                        onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
                        className="p-1.5 rounded-lg bg-[#27272A] disabled:opacity-30 hover:bg-[#333338] transition-colors text-white"
                        title="Next Slide"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Active Slide Card */}
                  <div className="flex-1 flex items-center justify-center overflow-auto min-h-0">
                    <motion.div
                      key={currentSlideIndex}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                      className="w-full max-w-4xl bg-[#18181B] border border-[#27272A] rounded-2xl shadow-2xl p-6 sm:p-10 flex flex-col justify-between min-h-[440px] max-h-full overflow-y-auto relative"
                    >
                      <div className="space-y-6">
                        {/* Slide Title */}
                        <div className="border-b border-[#2C2C30] pb-4 flex items-start justify-between gap-4">
                          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-snug">
                            {slides[currentSlideIndex].title}
                          </h1>
                          <span className="text-xs font-mono px-3 py-1 rounded-md bg-[#242428] text-gray-200 font-bold shrink-0 border border-gray-700">
                            Slide {slides[currentSlideIndex].slideNumber} / {slides.length}
                          </span>
                        </div>

                        {/* Slide Embedded Graphics & Images */}
                        {slides[currentSlideIndex].images.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
                            {slides[currentSlideIndex].images.map((imgSrc, imgIdx) => (
                              <div key={imgIdx} className="bg-[#0F0F10] border border-[#2A2A2E] rounded-xl p-2 flex items-center justify-center overflow-hidden max-h-[300px]">
                                <img
                                  src={imgSrc}
                                  alt={`Slide Diagram ${imgIdx + 1}`}
                                  className="max-w-full max-h-[280px] object-contain rounded-lg shadow-sm"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Slide Bullet Content */}
                        {slides[currentSlideIndex].bullets.length > 0 && (
                          <ul className="space-y-3 pt-2">
                            {slides[currentSlideIndex].bullets.map((bullet, idx) => (
                              <li key={idx} className="flex items-start gap-3 text-sm text-gray-200 leading-relaxed font-sans">
                                <span className="w-2 h-2 rounded-full bg-gray-400 mt-2 shrink-0 shadow-sm" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="mt-8 pt-4 border-t border-[#26262B] flex items-center justify-between text-xs text-gray-400 font-mono">
                        <span className="truncate max-w-[300px]">{attachment.name}</span>
                        <span>Slide {currentSlideIndex + 1} of {slides.length}</span>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </div>
            )}

            {/* Word Document Viewer */}
            {isWord && wordParagraphs.length > 0 && (
              <div className="w-full h-full p-6 overflow-auto">
                <div className="w-full max-w-3xl mx-auto bg-[#18181B] p-8 sm:p-12 rounded-2xl border border-[#27272A] shadow-xl space-y-4">
                  {wordParagraphs.map((p, idx) => (
                    <p key={idx} className="text-sm text-gray-200 leading-relaxed font-sans">
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Excel Table Viewer */}
            {isExcel && htmlContent && (
              <div className="w-full h-full p-4 overflow-auto">
                <div 
                  className="excel-preview w-full h-full overflow-auto text-sm text-gray-200 bg-[#18181B] p-4 rounded-xl border border-[#27272A]"
                  dangerouslySetInnerHTML={{ __html: htmlContent }} 
                />
              </div>
            )}

            {/* PDF Viewer */}
            {isPdf && fileUrl && (
              <iframe 
                src={fileUrl} 
                className="w-full h-full border-none"
                title={attachment.name}
              />
            )}

            {/* Image Viewer */}
            {isImage && fileUrl && (
              <div className="w-full h-full flex items-center justify-center p-4">
                <img 
                  src={fileUrl} 
                  alt={attachment.name} 
                  className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                />
              </div>
            )}

            {/* Text / Code File Viewer */}
            {isText && textContent !== null && (
              <div className="w-full h-full p-4 overflow-auto">
                <div className="w-full h-full bg-[#18181B] text-gray-200 p-4 rounded-xl font-mono text-xs leading-relaxed border border-[#27272A] overflow-auto">
                  <pre className="whitespace-pre-wrap">{textContent}</pre>
                </div>
              </div>
            )}
          </div>
          
          {/* Custom CSS for Excel Preview Tables */}
          {isExcel && (
             <style dangerouslySetInnerHTML={{__html: `
               .excel-preview table {
                 width: 100%;
                 border-collapse: collapse;
               }
               .excel-preview td, .excel-preview th {
                 border: 1px solid #27272A;
                 padding: 8px 12px;
               }
               .excel-preview tr:nth-child(even) {
                 background-color: #121214;
               }
             `}} />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
