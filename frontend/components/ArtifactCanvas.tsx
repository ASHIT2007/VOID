import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Code,
  Eye,
  Copy,
  Check,
  RotateCcw,
  Download,
  FileDown,
  ExternalLink,
  Laptop,
  Tablet,
  Smartphone,
  Maximize2,
  Minimize2,
  ChevronDown,
  Sparkles,
  FileText,
  Presentation as PptIcon,
  Globe,
  Share2,
  Layers,
  Play
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MindMapViewer, { parseMindMapData } from './MindMapViewer';
import ChartViewer, { parseChartData } from './ChartViewer';
import GraphViewer, { parseGraphData } from './GraphViewer';
import VisualDesignStudio from './VisualDesignStudio';
import CanvaDocStudio from './CanvaDocStudio';
import WebPreview from './WebPreview';
import { PresentationData } from '@/types/presentation';
import { ReportData } from '@/types/report';
import { hasRenderablePosterContent } from './ChatInterface.helpers';

export interface Artifact {
  identifier: string;
  type: string; // 'html' | 'svg' | 'presentation' | 'poster' | 'report' | 'canva-doc' | 'mindmap' | 'chart' | 'graph' | 'python' | 'markdown' | string;
  title: string;
  content: string;
  presentationData?: PresentationData;
  reportData?: ReportData;
  language?: string;
}

interface ArtifactCanvasProps {
  artifact: Artifact | null;
  onClose: () => void;
  onArtifactChange?: (artifact: Artifact) => void;
  theme?: string;
}

export default function ArtifactCanvas({ artifact, onClose, onArtifactChange, theme = 'dark' }: ArtifactCanvasProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [localContent, setLocalContent] = useState(() => artifact?.content || '');
  const [isCopied, setIsCopied] = useState(false);
  const [isCopyDropdownOpen, setIsCopyDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const copyDropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (artifact) {
      setLocalContent(artifact.content || '');
      setActiveTab('preview');
    }
  }, [artifact]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (copyDropdownRef.current && !copyDropdownRef.current.contains(event.target as Node)) {
        setIsCopyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedType = useMemo(() => {
    const t = (artifact?.type || '').toLowerCase();
    if (['gamma-presentation', 'gamma', 'presentation', 'ppt', 'slides'].includes(t)) return 'presentation';
    if (['poster', 'infographic', 'banner', 'flyer'].includes(t)) return 'poster';
    if (['canva-doc', 'canvadoc', 'canva', 'report', 'document'].includes(t)) return 'report';
    if (['mindmap', 'mind-map'].includes(t)) return 'mindmap';
    if (['chart', 'barchart', 'linechart'].includes(t)) return 'chart';
    if (['graph', 'nodegraph'].includes(t)) return 'graph';
    if (['python', 'py'].includes(t)) return 'python';
    if (['svg', 'vector'].includes(t)) return 'svg';
    if (['markdown', 'md'].includes(t)) return 'markdown';
    return 'html';
  }, [artifact?.type]);

  const typeDisplayLabel = useMemo(() => {
    switch (normalizedType) {
      case 'presentation': return 'Presentation';
      case 'poster': return 'Poster';
      case 'report': return 'Document';
      case 'mindmap': return 'Mindmap';
      case 'chart': return 'Chart';
      case 'graph': return 'Graph';
      case 'python': return 'Python';
      case 'svg': return 'SVG';
      case 'markdown': return 'Markdown';
      default: return 'HTML';
    }
  }, [normalizedType]);

  if (!artifact) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(localContent);
      setIsCopied(true);
      setIsCopyDropdownOpen(false);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleReset = () => {
    setLocalContent(artifact.content || '');
  };

  const handleDownload = () => {
    try {
      let ext = 'html';
      let mime = 'text/html';

      if (normalizedType === 'svg') {
        ext = 'svg';
        mime = 'image/svg+xml';
      } else if (normalizedType === 'python') {
        ext = 'py';
        mime = 'text/x-python';
      } else if (normalizedType === 'markdown') {
        ext = 'md';
        mime = 'text/markdown';
      } else if (normalizedType === 'mindmap' || normalizedType === 'chart' || normalizedType === 'graph') {
        ext = 'json';
        mime = 'application/json';
      }

      const blob = new Blob([localContent], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(artifact.title || 'artifact').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download', err);
    }
  };

  const handleOpenInNewTab = () => {
    try {
      const blob = new Blob([localContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to open in new tab', err);
    }
  };

  const renderPreview = () => {
    // 1. Presentation & Poster Preview
    if (normalizedType === 'presentation' || normalizedType === 'poster') {
      let presData = artifact.presentationData;
      if (!presData) {
        try {
          const parsed = JSON.parse(localContent);
          if (parsed && parsed.slides) presData = parsed as PresentationData;
        } catch (e) {}
      }

      if (presData) {
        return (
          <div className="w-full h-full overflow-hidden bg-[#0F0F12]">
            <VisualDesignStudio
              key={presData.id || artifact.identifier}
              data={presData}
              onClose={onClose}
              onChange={(presentationData) => onArtifactChange?.({
                ...artifact,
                presentationData,
                content: JSON.stringify(presentationData),
              })}
            />
          </div>
        );
      }
    }

    // 2. Document Preview
    if (normalizedType === 'report') {
      let docData = artifact.reportData;
      if (!docData) {
        try {
          const parsed = JSON.parse(localContent);
          if (parsed && parsed.sections) docData = parsed as ReportData;
        } catch (e) {}
      }

      if (docData) {
        return (
          <div className="w-full h-full overflow-hidden bg-[#0F0F12]">
            <CanvaDocStudio
              data={docData}
              onClose={onClose}
              onChange={(reportData) => onArtifactChange?.({
                ...artifact,
                reportData,
                content: JSON.stringify(reportData),
              })}
            />
          </div>
        );
      }
    }

    // 3. Mindmap Viewer
    if (normalizedType === 'mindmap') {
      const mapData = parseMindMapData(localContent);
      if (mapData) {
        return (
          <div className="w-full h-full overflow-y-auto bg-gray-50 dark:bg-[#18181B] p-4">
            <MindMapViewer data={mapData} />
          </div>
        );
      }
    }

    // 4. Chart Viewer
    if (normalizedType === 'chart') {
      const chartData = parseChartData(localContent);
      if (chartData) {
        return (
          <div className="w-full h-full overflow-y-auto bg-gray-50 dark:bg-[#18181B] p-4">
            <ChartViewer data={chartData} />
          </div>
        );
      }
    }

    // 5. Graph Viewer
    if (normalizedType === 'graph') {
      const graphData = parseGraphData(localContent);
      if (graphData) {
        return (
          <div className="w-full h-full overflow-y-auto bg-gray-50 dark:bg-[#18181B] p-4">
            <GraphViewer data={graphData} />
          </div>
        );
      }
    }

    // Python artifacts display source only; execution UI is intentionally absent.
    if (normalizedType === 'python') {
      return <div className="h-full min-w-0 overflow-auto bg-[#18181B] p-4"><SyntaxHighlighter language="python" style={vscDarkPlus} showLineNumbers={false}>{localContent}</SyntaxHighlighter></div>;
    }

    // 7. Markdown Preview
    if (normalizedType === 'markdown') {
      return (
        <div className="w-full h-full overflow-y-auto p-6 bg-white dark:bg-[#18181B] text-gray-900 dark:text-gray-100 prose dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match;
                if (isInline) {
                  return (
                    <code className="bg-gray-100 dark:bg-[#2A2A2E] px-1 py-0.5 rounded text-sm font-mono text-amber-600 dark:text-amber-300" {...props}>
                      {children}
                    </code>
                  );
                }
                const language = match[1];
                const codeString = String(children).replace(/\n$/, '');
                return (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={language}
                    PreTag="div"
                    customStyle={{ margin: 0, padding: '1rem', background: '#121214', borderRadius: '0.5rem' }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                );
              }
            }}
          >
            {localContent}
          </ReactMarkdown>
        </div>
      );
    }

    return <WebPreview content={localContent} title={artifact.title || 'Website Preview'} />;
  };
  const containerClasses = isFullscreen
    ? 'fixed inset-0 z-[9999] w-screen h-screen flex flex-col bg-white dark:bg-[#18181B] shadow-2xl overflow-hidden'
    : 'h-full flex flex-col bg-white dark:bg-[#18181B] border-l border-gray-200 dark:border-[#27272A] shadow-2xl relative z-40 overflow-hidden';

  // Presentation and poster studios already own their title, edit, export,
  // navigation, fullscreen, and close controls. Rendering the generic artifact
  // toolbar above them created duplicate titles, downloads, and close buttons.
  if (normalizedType === 'presentation' || normalizedType === 'poster') {
    let presentationData = artifact.presentationData;
    if (!presentationData) {
      try {
        const parsed = JSON.parse(localContent);
        if (parsed && parsed.slides) presentationData = parsed as PresentationData;
      } catch {}
    }
    if (presentationData) {
      if (normalizedType === 'poster' && !hasRenderablePosterContent(presentationData)) {
        return (
          <div className={`${containerClasses} items-center justify-center p-8 text-center`}>
            <div className="max-w-sm rounded-xl border border-white/10 bg-[#111214] p-6 text-white">
              <h2 className="text-sm font-semibold">Incomplete infographic</h2>
              <p className="mt-2 text-xs leading-relaxed text-white/55">The model returned a title without a usable information layer, so the empty canvas was not opened. Regenerate the response to build the complete figure.</p>
              <button type="button" onClick={onClose} className="mt-5 rounded-md bg-white px-4 py-2 text-xs font-semibold text-black">Close preview</button>
            </div>
          </div>
        );
      }
      return (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className={containerClasses}
        >
          <VisualDesignStudio
            key={presentationData.id || artifact.identifier}
            data={presentationData}
            onClose={onClose}
            onChange={(nextPresentation) => onArtifactChange?.({
              ...artifact,
              presentationData: nextPresentation,
              content: JSON.stringify(nextPresentation),
            })}
          />
        </motion.div>
      );
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      className={containerClasses}
    >
      {/* Claude-Style Artifact Sidebar Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-gray-200 dark:border-[#27272A] bg-white dark:bg-[#18181B] shrink-0 select-none">
        {/* Left Side: [ 👁️ | </> ] Pill and Title */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Segmented Toggle Pill (Claude style) */}
          <div className="flex items-center bg-gray-100 dark:bg-[#27272A] p-0.5 rounded-lg border border-gray-200 dark:border-[#3F3F46] shrink-0">
            <button
              onClick={() => setActiveTab('preview')}
              className={`p-1.5 rounded-md transition-all ${
                activeTab === 'preview'
                  ? 'bg-white dark:bg-[#3F3F46] text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="Preview Mode"
            >
              <Eye size={14} />
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`p-1.5 rounded-md transition-all ${
                activeTab === 'code'
                  ? 'bg-white dark:bg-[#3F3F46] text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="Code / Source Mode"
            >
              <Code size={14} />
            </button>
          </div>

          {/* Title & Format Label */}
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-gray-100 truncate">
              {artifact.title || 'Index'}
            </span>
            <span className="text-[11px] font-mono text-gray-400 dark:text-gray-400 shrink-0">
              · {typeDisplayLabel}
            </span>
          </div>
        </div>

        {/* Right Side: Copy ⌄, Download, Fullscreen, Close */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Reset button when editing in code tab */}
          {activeTab === 'code' && localContent !== artifact.content && (
            <button
              onClick={handleReset}
              className="p-1.5 text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors"
              title="Reset to Original"
            >
              <RotateCcw size={15} />
            </button>
          )}

          {/* Copy ⌄ Button with Dropdown Menu (Claude Style) */}
          <div className="relative" ref={copyDropdownRef}>
            <button
              onClick={() => setIsCopyDropdownOpen(!isCopyDropdownOpen)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#27272A] rounded-lg border border-gray-200 dark:border-[#3F3F46] transition-all cursor-pointer shadow-xs"
            >
              {isCopied ? (
                <>
                  <Check size={13} className="text-green-500" />
                  <span className="text-green-500 font-bold">Copied!</span>
                </>
              ) : (
                <>
                  <span>Copy</span>
                  <ChevronDown size={12} className="text-gray-400" />
                </>
              )}
            </button>

            <AnimatePresence>
              {isCopyDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-[#1F1F23] rounded-xl shadow-xl border border-gray-200 dark:border-[#333338] py-1 z-50 overflow-hidden"
                >
                  <button
                    onClick={handleCopyCode}
                    className="w-full px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#2A2A30] flex items-center gap-2 transition-colors"
                  >
                    <Copy size={13} className="text-gray-400" />
                    <span>Copy code</span>
                  </button>
                  <button
                    onClick={() => {
                      const plain = localContent.replace(/<[^>]+>/g, '').trim();
                      navigator.clipboard.writeText(plain);
                      setIsCopied(true);
                      setIsCopyDropdownOpen(false);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#2A2A30] flex items-center gap-2 transition-colors"
                  >
                    <FileText size={13} className="text-gray-400" />
                    <span>Copy plain text</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Download File */}
          <button
            onClick={handleDownload}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#27272A] rounded-lg transition-colors cursor-pointer"
            title={`Download ${typeDisplayLabel}`}
          >
            <Download size={15} />
          </button>

          {/* Fullscreen Expand Button (Claude Style) */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#27272A] rounded-lg transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Expand to Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          {/* Close Sidebar Button */}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#27272A] rounded-lg transition-colors cursor-pointer ml-0.5"
            title="Close Artifact Sidebar"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-gray-50 dark:bg-[#18181B]">
        <div className={activeTab === 'preview' ? 'h-full min-h-0' : 'hidden'}>{renderPreview()}</div>
        {activeTab === 'code' && (
          <div className="w-full h-full relative bg-[#141416] flex flex-col">
            <div className="flex items-center justify-between px-4 py-1.5 bg-[#1C1C20] border-b border-[#2A2A30] text-xs text-gray-400 font-mono">
              <span>{typeDisplayLabel.toLowerCase()}-source</span>
              <span className="text-[11px] text-gray-500">{localContent.length} characters</span>
            </div>
            <textarea
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              spellCheck={false}
              className="w-full flex-1 p-4 bg-transparent text-gray-200 font-mono text-[13px] leading-relaxed resize-none outline-none focus:ring-0 focus:outline-none border-0"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
              }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
