import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  Code,
  Eye,
  Copy,
  Check,
  FileText,
  Download,
  ExternalLink,
  RotateCcw,
  Laptop,
  Tablet,
  Smartphone,
  Globe,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { detectCodeLanguage } from "@/lib/code-language";
import { parseMindMapData } from "./MindMapViewer";
import ChartViewer, { parseChartData } from "./ChartViewer";
import { parseGraphData } from "./GraphViewer";
import { supabase } from "@/lib/supabase";
import WebPreview from './WebPreview';
import MermaidRenderer from './MermaidRenderer';
import { normalizeMermaid } from '@void/shared/diagram-contract.mjs';
import { mindMapToMermaid, graphToMermaid } from '@/lib/diagram-data';

export interface Artifact {
  identifier: string;
  type: string;
  title: string;
  content: string;
}

interface CodeBlockWithPreviewProps {
  language?: string;
  code: string;
  theme?: string;
  setActiveArtifact?: (artifact: Artifact) => void;
  rawProps?: Record<string, unknown>;
}

export default function CodeBlockWithPreview({
  language = "",
  code,
  theme = 'dark',
  setActiveArtifact,
  rawProps = {},
}: CodeBlockWithPreviewProps) {
  const codeString = (code || "").replace(/\n$/, "");
  const langLower = detectCodeLanguage(codeString, language);

  // 1. Specialized Visualizations Check
  let specializedView: React.ReactNode = null;
  if (langLower === 'mermaid' || (langLower === 'mindmap' && normalizeMermaid(codeString))) {
    specializedView = <MermaidRenderer chart={codeString} theme={theme === 'light' ? 'light' : 'dark'} />;
  }
  if (!specializedView && (langLower === "mindmap" || langLower === "json")) {
    const mapData = parseMindMapData(codeString);
    if (mapData) specializedView = <MermaidRenderer chart={mindMapToMermaid(mapData)} theme={theme === 'light' ? 'light' : 'dark'} />;
  }
  if (!specializedView && (langLower === "chart" || langLower === "barchart" || langLower === "json")) {
    const chartData = parseChartData(codeString);
    if (chartData) specializedView = <ChartViewer data={chartData} />;
  }
  if (!specializedView && (langLower === "graph" || langLower === "nodegraph" || langLower === "json")) {
    const graphData = parseGraphData(codeString);
    if (graphData) specializedView = <MermaidRenderer chart={graphToMermaid(graphData)} theme={theme === 'light' ? 'light' : 'dark'} />;
  }

  // 2. HTML / SVG / Web App Detection
  const isHtmlOrSvg = useMemo(() => {
    if (["html", "htm", "xhtml", "svg"].includes(langLower)) return true;
    const lower = codeString.toLowerCase();
    return (
      lower.includes("<!doctype html") ||
      lower.includes("<html") ||
      (lower.includes("<head") && lower.includes("<body")) ||
      (lower.includes("<style") && (lower.includes("<div") || lower.includes("<body") || lower.includes("<script"))) ||
      (lower.includes("<script") && (lower.includes("<div") || lower.includes("<canvas") || lower.includes("<button"))) ||
      (lower.startsWith("<svg") && lower.includes("</svg>"))
    );
  }, [langLower, codeString]);

  // Default to 'preview' tab if it is an HTML/SVG web app, otherwise 'code'
  const [activeTab, setActiveTab] = useState<"preview" | "code">(
    isHtmlOrSvg ? "preview" : "code"
  );
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "failed">("idle");

  // Extract a readable title if possible
  const documentTitle = useMemo(() => {
    const titleMatch = codeString.match(/<title>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]?.trim()) {
      return titleMatch[1].trim();
    }
    const h1Match = codeString.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match && h1Match[1]?.trim()) {
      const cleanH1 = h1Match[1].replace(/<[^>]+>/g, "").trim();
      if (cleanH1) return cleanH1;
    }
    return isHtmlOrSvg ? (langLower === "svg" ? "Vector SVG" : "Web Preview") : langLower || "Code Snippet";
  }, [codeString, isHtmlOrSvg, langLower]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code", err);
    }
  }, [codeString]);

  const handleSaveSnippet = useCallback(async () => {
    const title = prompt("Enter snippet title:", documentTitle);
    if (!title) return;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");
      const { error } = await supabase.from("snippets").insert({
        user_id: user.id,
        title,
        language: langLower || "html",
        code: codeString,
      });
      if (error) throw error;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.error("Save snippet error:", err);
      setSaveStatus("failed");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  }, [codeString, documentTitle, langLower]);

  const handleDownload = useCallback(() => {
    try {
      const ext = langLower === "svg" ? "svg" : isHtmlOrSvg ? "html" : langLower || "txt";
      const mime = ext === "svg" ? "image/svg+xml" : ext === "html" ? "text/html" : "text/plain";
      const blob = new Blob([codeString], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${documentTitle.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  }, [codeString, documentTitle, isHtmlOrSvg, langLower]);

  const handleOpenCanvas = useCallback(() => {
    if (setActiveArtifact) {
      setActiveArtifact({
        identifier: `artifact-${Date.now()}`,
        type: langLower === "svg" ? "svg" : "html",
        title: documentTitle,
        content: codeString,
      });
    }
  }, [setActiveArtifact, langLower, documentTitle, codeString]);

  if (specializedView) return specializedView;

  return (
    <div className="code-block relative group my-5 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-[#363636] bg-[#171717] transition-colors hover:border-[#484848]">
      {/* Code Block Header */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-[#3A3A3A] bg-[#262626] px-3.5 py-2.5">
        {/* Left Side: Language / Title & Tabs */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-md bg-[#333] px-2 py-0.5 font-mono text-xs font-semibold text-gray-200">
            {isHtmlOrSvg ? (
              <Globe size={13} className="text-gray-300" />
            ) : (
              <Code size={13} className="text-gray-300" />
            )}
            <span className="capitalize">{langLower || "code"}</span>
          </div>

          {/* Tab Switcher if Previewable */}
          {isHtmlOrSvg && (
            <div className="flex items-center bg-gray-200 dark:bg-[#2E2E33] p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  activeTab === "preview"
                    ? "bg-white text-gray-900 dark:bg-[#4A4A4A] dark:text-white font-semibold"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Eye size={13} />
                <span>Preview</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("code")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  activeTab === "code"
                    ? "bg-white text-gray-900 dark:bg-[#4A4A4A] dark:text-white font-semibold"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Code size={13} />
                <span>Code</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Side: Actions (Canvas, Download, Save, Copy) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Side-by-Side Canvas Button */}
          {isHtmlOrSvg && setActiveArtifact && (
            <button
              type="button"
              onClick={handleOpenCanvas}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[#4A4A4A] bg-[#303030] px-2.5 py-1 text-xs font-medium text-gray-200 transition-colors hover:bg-[#3A3A3A] hover:text-white"
              title="Open Preview"
            >
              <Eye size={13} />
              <span className="hidden sm:inline">Open in Sidebar</span>
            </button>
          )}

          {/* Download File */}
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-[#353535] hover:text-white"
            title={`Download as .${isHtmlOrSvg ? (langLower === "svg" ? "svg" : "html") : langLower || "txt"}`}
          >
            <Download size={14} />
          </button>

          {/* Save Snippet */}
          <button
            type="button"
            onClick={handleSaveSnippet}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-[#353535] hover:text-white"
            title="Save Snippet to Library"
          >
            <FileText size={13} />
            <span className="hidden md:inline">
              {saveStatus === "saved" ? (
                <span className="font-semibold text-white">Saved</span>
              ) : saveStatus === "failed" ? (
                <span className="font-semibold text-gray-300">Failed</span>
              ) : (
                "Save snippet"
              )}
            </span>
          </button>

          {/* Copy Code */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-[#353535] hover:text-white"
            title="Copy Code"
          >
            {isCopied ? (
              <span className="flex items-center gap-1 font-semibold text-white">
                <Check size={13} />
                <span>Copied!</span>
              </span>
            ) : (
              <>
                <Copy size={13} />
                <span className="hidden sm:inline">Copy code</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isHtmlOrSvg && activeTab === "preview" ? (
        <div className="h-[560px] max-h-[75vh] min-h-[320px]"><WebPreview content={codeString} title={documentTitle} /></div>
      ) : (
        /* Syntax Highlighted Code Area */
        <div className="relative bg-[#171717]">
          <SyntaxHighlighter
            {...rawProps}
            style={vscDarkPlus}
            language={langLower === "html" ? "xml" : langLower || "text"}
            PreTag="div"
            showLineNumbers={false}
            wrapLongLines={["markdown", "text"].includes(langLower)}
            codeTagProps={{
              style: {
                ...vscDarkPlus['code[class*="language-"]'],
                whiteSpace: ["markdown", "text"].includes(langLower) ? "pre-wrap" : "pre",
                overflowWrap: ["markdown", "text"].includes(langLower) ? "anywhere" : "normal",
              },
            }}
            customStyle={{
              margin: 0,
              padding: "1.1rem 1rem 1.25rem",
              background: "#171717",
              fontSize: "0.875rem",
              lineHeight: 1.65,
              overflowX: "auto",
              maxWidth: "100%",
              whiteSpace: ["markdown", "text"].includes(langLower) ? "pre-wrap" : "pre",
            }}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}
