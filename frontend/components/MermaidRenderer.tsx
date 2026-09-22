"use client";

import React, { useEffect, useRef, useState } from "react";
import { Copy, Check, Download, ZoomIn, ZoomOut, RotateCcw, AlertCircle, FileText } from "lucide-react";

interface MermaidRendererProps {
  chart?: string;
  theme?: "dark" | "light";
}

let mermaidIdCounter = 0;

export default function MermaidRenderer({ chart, theme = "dark" }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [uniqueId] = useState(() => `mermaid-svg-${++mermaidIdCounter}-${Math.random().toString(36).substring(2, 7)}`);

  // Guard against undefined, null, or empty string
  const cleanChartRaw = typeof chart === "string" ? chart.trim() : "";
  const isValidChartInput = Boolean(cleanChartRaw && cleanChartRaw !== "undefined");

  useEffect(() => {
    let isMounted = true;

    if (!isValidChartInput) {
      setSvgContent("");
      setError(null);
      return;
    }

    async function renderDiagram() {
      try {
        setError(null);
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "loose",
          fontFamily: "Plus Jakarta Sans, system-ui, sans-serif",
          themeVariables: {
            darkMode: theme === "dark",
            background: theme === "dark" ? "#090d16" : "#ffffff",
            primaryColor: "#3b82f6",
            primaryTextColor: "#ffffff",
            primaryBorderColor: "#2563eb",
            lineColor: "#64748b",
            secondaryColor: "#10b981",
            tertiaryColor: "#f59e0b",
          },
          mindmap: {
            padding: 20,
            useMaxWidth: true,
          },
          flowchart: {
            curve: "basis",
            useMaxWidth: true,
            htmlLabels: true,
          },
          xyChart: {
            width: 700,
            height: 400,
          }
        });

        // Clean up markdown ticks if present
        let cleanChart = cleanChartRaw;
        if (cleanChart.startsWith("```mermaid")) {
          cleanChart = cleanChart.replace(/^```mermaid\n?/, "").replace(/```$/, "");
        } else if (cleanChart.startsWith("```")) {
          cleanChart = cleanChart.replace(/^```\n?/, "").replace(/```$/, "");
        }
        cleanChart = cleanChart.trim();

        if (!cleanChart || cleanChart === "undefined") {
          return;
        }

        const { svg } = await mermaid.render(uniqueId, cleanChart);
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        console.error("Mermaid rendering error:", err);
        if (isMounted) {
          setError(err?.message || "Failed to render diagram syntax.");
        }
      }
    }

    renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [cleanChartRaw, isValidChartInput, theme, uniqueId]);

  if (!isValidChartInput) {
    return null;
  }

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(cleanChartRaw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full my-5 rounded-2xl border border-gray-200 dark:border-[#2f384a] bg-gray-50 dark:bg-[#0f172a] overflow-hidden shadow-lg transition-all">
      {/* Paper/Report Style Header Bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-100/80 dark:bg-[#1e293b]/80 backdrop-blur-sm border-b border-gray-200 dark:border-[#2f384a] text-xs font-semibold text-gray-700 dark:text-gray-200">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="tracking-wide uppercase text-[11px] font-bold text-blue-600 dark:text-blue-400">Visual Mind Map / Analysis Diagram</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-[#334155] rounded-md transition-colors text-gray-600 dark:text-gray-300"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-[#334155] rounded-md transition-colors text-gray-600 dark:text-gray-300"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-[#334155] rounded-md transition-colors text-gray-600 dark:text-gray-300"
            title="Reset Zoom"
          >
            <RotateCcw size={14} />
          </button>
          <div className="w-px h-3.5 bg-gray-300 dark:bg-gray-700 mx-1" />
          <button
            onClick={handleDownloadSvg}
            className="flex items-center gap-1 px-2.5 py-1 hover:bg-gray-200 dark:hover:bg-[#334155] rounded-md transition-colors text-gray-600 dark:text-gray-300"
            title="Export SVG"
          >
            <Download size={13} />
            <span>SVG</span>
          </button>
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1 px-2.5 py-1 hover:bg-gray-200 dark:hover:bg-[#334155] rounded-md transition-colors text-gray-600 dark:text-gray-300"
            title="Copy Code"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Code"}</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas Body */}
      <div className="p-6 md:p-8 overflow-auto flex items-center justify-center min-h-[250px] max-h-[650px] bg-white dark:bg-[#0b0f19] relative">
        {error ? (
          <div className="flex flex-col items-center text-center p-6 text-amber-600 dark:text-amber-400 gap-2 text-sm">
            <AlertCircle size={22} />
            <span className="font-semibold">Diagram Rendering Warning</span>
            <span className="text-xs text-gray-500">{error}</span>
            <pre className="mt-3 text-xs font-mono text-gray-400 max-w-full overflow-x-auto p-3 bg-black/20 rounded-lg text-left">
              {cleanChartRaw}
            </pre>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="transition-transform duration-200 ease-out origin-center max-w-full"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
      </div>
    </div>
  );
}
