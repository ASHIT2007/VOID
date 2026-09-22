"use client";
import React, { useState, useMemo } from "react";

interface MindMapCategory {
  id: string;
  name: string;
  color?: string;
  children: string[];
}

interface MindMapData {
  title: string;
  subtitle?: string;
  categories: MindMapCategory[];
}

const COLOR_SCHEMES: Record<
  string,
  { bg: string; tintBg: string; text: string; border: string; shadow: string }
> = {
  blue: {
    bg: "#2563eb",
    tintBg: "rgba(37,99,235,0.15)",
    text: "#93c5fd",
    border: "rgba(37,99,235,0.3)",
    shadow: "rgba(37,99,235,0.25)",
  },
  emerald: {
    bg: "#059669",
    tintBg: "rgba(5,150,105,0.15)",
    text: "#6ee7b7",
    border: "rgba(5,150,105,0.3)",
    shadow: "rgba(5,150,105,0.25)",
  },
  amber: {
    bg: "#d97706",
    tintBg: "rgba(217,119,6,0.15)",
    text: "#fcd34d",
    border: "rgba(217,119,6,0.3)",
    shadow: "rgba(217,119,6,0.25)",
  },
  rose: {
    bg: "#e11d48",
    tintBg: "rgba(225,29,72,0.15)",
    text: "#fda4af",
    border: "rgba(225,29,72,0.3)",
    shadow: "rgba(225,29,72,0.25)",
  },
  violet: {
    bg: "#7c3aed",
    tintBg: "rgba(124,58,237,0.15)",
    text: "#c4b5fd",
    border: "rgba(124,58,237,0.3)",
    shadow: "rgba(124,58,237,0.25)",
  },
  teal: {
    bg: "#0d9488",
    tintBg: "rgba(13,148,136,0.15)",
    text: "#5eead4",
    border: "rgba(13,148,136,0.3)",
    shadow: "rgba(13,148,136,0.25)",
  },
};

const COLOR_ORDER = ["blue", "emerald", "amber", "rose", "violet", "teal"];

function getColorScheme(color: string | undefined, index: number) {
  const key = color && COLOR_SCHEMES[color] ? color : COLOR_ORDER[index % COLOR_ORDER.length];
  return COLOR_SCHEMES[key];
}

export function parseMindMapData(raw: string): MindMapData | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json|mindmap)?\s*/i, "").replace(/\s*```$/, "").trim();
    const data = JSON.parse(cleaned);
    if (data && data.title && Array.isArray(data.categories)) {
      return data as MindMapData;
    }
    return null;
  } catch {
    return null;
  }
}

export default function MindMapViewer({ data }: { data: MindMapData }) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());

  const categories = useMemo(() => data.categories || [], [data.categories]);

  const toggleHighlight = (nodeKey: string) => {
    setHighlightedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  };

  if (!categories.length) return null;

  const activeData = categories[activeCategory];
  const activeColor = getColorScheme(activeData?.color, activeCategory);

  return (
    <div
      style={{
        background: "transparent",
        borderRadius: "16px",
        padding: "40px 24px",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "400px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Subtitle */}
      {data.subtitle && (
        <p
          style={{
            color: "#6b7280",
            fontSize: "13px",
            fontStyle: "italic",
            marginBottom: "28px",
            letterSpacing: "0.3px",
          }}
        >
          {data.subtitle}
        </p>
      )}

      {/* Root Node */}
      <div
        style={{
          background: "linear-gradient(135deg, #2563eb, #7c3aed)",
          color: "#ffffff",
          padding: "14px 32px",
          borderRadius: "9999px",
          fontSize: "18px",
          fontWeight: 700,
          boxShadow: "0 8px 32px rgba(37,99,235,0.3)",
          cursor: "default",
          marginBottom: "8px",
          textAlign: "center",
          letterSpacing: "0.2px",
        }}
      >
        {data.title}
      </div>

      {/* Connector Line */}
      <div
        style={{
          width: "2px",
          height: "32px",
          background: "#374151",
          margin: "0 auto 16px",
        }}
      />

      {/* Category Buttons */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
          marginBottom: "8px",
        }}
      >
        {categories.map((cat, idx) => {
          const scheme = getColorScheme(cat.color, idx);
          const isActive = idx === activeCategory;
          return (
            <button
              key={cat.id || idx}
              onClick={() => {
                setActiveCategory(idx);
                setHighlightedNodes(new Set());
              }}
              style={{
                background: scheme.bg,
                color: "#ffffff",
                padding: "10px 20px",
                borderRadius: "10px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                outline: "none",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                opacity: isActive ? 1 : 0.45,
                transform: isActive ? "scale(1.1)" : "scale(1)",
                boxShadow: isActive
                  ? `0 6px 20px ${scheme.shadow}`
                  : "0 2px 8px rgba(0,0,0,0.3)",
                letterSpacing: "0.2px",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.target as HTMLButtonElement).style.opacity = "0.75";
                  (e.target as HTMLButtonElement).style.transform = "scale(1.05)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.target as HTMLButtonElement).style.opacity = "0.45";
                  (e.target as HTMLButtonElement).style.transform = "scale(1)";
                }
              }}
            >
              {cat.name}
            </button>
          );
        })}
      </div>

      {/* Connector Line */}
      <div
        style={{
          width: "2px",
          height: "24px",
          background: "#374151",
          margin: "0 auto 20px",
        }}
      />

      {/* Active Category Label */}
      <div
        style={{
          color: activeColor.text,
          fontSize: "13px",
          fontWeight: 600,
          marginBottom: "16px",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        {activeData?.name}
      </div>

      {/* Child Nodes */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "10px",
          maxWidth: "52rem",
          padding: "0 16px",
          transition: "all 0.3s ease",
        }}
      >
        {activeData?.children.map((child, childIdx) => {
          const nodeKey = `${activeCategory}-${childIdx}`;
          const isHighlighted = highlightedNodes.has(nodeKey);
          return (
            <div
              key={nodeKey}
              onClick={() => toggleHighlight(nodeKey)}
              style={{
                background: activeColor.tintBg,
                color: activeColor.text,
                border: `1px solid ${activeColor.border}`,
                padding: "10px 18px",
                borderRadius: "10px",
                fontSize: "13.5px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                outline: isHighlighted
                  ? "2px solid rgba(255,255,255,0.45)"
                  : "none",
                outlineOffset: "3px",
                transform: isHighlighted ? "scale(1.08)" : "scale(1)",
                boxShadow: isHighlighted
                  ? `0 4px 16px ${activeColor.shadow}`
                  : "none",
                letterSpacing: "0.15px",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.transform = isHighlighted
                  ? "scale(1.1)"
                  : "scale(1.06)";
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  `0 4px 16px ${activeColor.shadow}`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.transform = isHighlighted
                  ? "scale(1.08)"
                  : "scale(1)";
                (e.currentTarget as HTMLDivElement).style.boxShadow = isHighlighted
                  ? `0 4px 16px ${activeColor.shadow}`
                  : "none";
              }}
            >
              {child}
            </div>
          );
        })}
      </div>

      {/* Node count indicator */}
      <p
        style={{
          color: "#4b5563",
          fontSize: "11px",
          marginTop: "28px",
          fontStyle: "italic",
        }}
      >
        {activeData?.children.length} topics · Click to highlight · {categories.length} branches total
      </p>
    </div>
  );
}
