"use client";
import React, { useState, useMemo } from "react";

export interface ChartData {
  type?: "bar" | "horizontal-bar" | "stacked-bar" | "pie" | "donut" | "line" | "area" | "scatter" | "radar" | "funnel" | "gauge" | "timeline" | "treemap" | "waterfall" | "progress";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel?: string;
  bars?: { label: string; value: number | string; color?: string }[];
  stackedBars?: { label: string; segments: { label: string; value: number; color?: string }[] }[];
  slices?: { label: string; value: number; color?: string }[];
  points?: { label: string; value: number }[];
  scatterPoints?: { x: number; y: number; label?: string; color?: string }[];
  axes?: { label: string; value?: number; max?: number }[];
  series?: { name: string; color?: string; values: number[] }[];
  radarSeries?: { name: string; color?: string; values: number[] }[];
  stages?: { label: string; value: number; color?: string }[];
  value?: number;
  max?: number;
  unit?: string;
  events?: { date: string; title: string; description?: string; color?: string }[];
  nodes?: { label: string; value: number; color?: string; children?: { label: string; value: number; color?: string }[] }[];
  steps?: { label: string; value: number; type?: "increase" | "decrease" | "total"; color?: string }[];
  items?: { label: string; value: number; max?: number; color?: string }[];
  yTicks?: { value: number; label: string }[];
  note?: string;
  source?: string;
  style?: {
    background?: string;
    surface?: string;
    text?: string;
    muted?: string;
    grid?: string;
    palette?: string[];
    fontFamily?: string;
    showValues?: boolean;
    roundedBars?: boolean;
    lineWidth?: number;
    pointSize?: number;
  };
}

const COLOR_CYCLE = ["blue", "emerald", "amber", "rose", "violet", "teal", "cyan", "orange", "pink", "indigo"];
const BAR_COLORS: Record<string, { bg: string; glow: string; text: string }> = {
  blue:    { bg: "#3b82f6", glow: "rgba(59,130,246,0.35)", text: "#93c5fd" },
  emerald: { bg: "#10b981", glow: "rgba(16,185,129,0.35)", text: "#6ee7b7" },
  amber:   { bg: "#f59e0b", glow: "rgba(245,158,11,0.35)", text: "#fcd34d" },
  rose:    { bg: "#f43f5e", glow: "rgba(244,63,94,0.35)",  text: "#fda4af" },
  violet:  { bg: "#8b5cf6", glow: "rgba(139,92,246,0.35)", text: "#c4b5fd" },
  teal:    { bg: "#14b8a6", glow: "rgba(20,184,166,0.35)", text: "#5eead4" },
  cyan:    { bg: "#06b6d4", glow: "rgba(6,182,212,0.35)",  text: "#67e8f9" },
  orange:  { bg: "#f97316", glow: "rgba(249,115,22,0.35)", text: "#fdba74" },
  pink:    { bg: "#ec4899", glow: "rgba(236,72,153,0.35)", text: "#f9a8d4" },
  indigo:  { bg: "#6366f1", glow: "rgba(99,102,241,0.35)", text: "#a5b4fc" },
};

function safeCssColor(value: string | undefined): string | undefined {
  return value && /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(value.trim())
    ? value.trim() : undefined;
}

function getBarColor(color: string | undefined, index: number, palette?: string[]) {
  const custom = safeCssColor(color) || safeCssColor(palette?.[index % Math.max(palette.length, 1)]);
  if (custom) return { bg: custom, glow: custom, text: custom };
  const key = color && BAR_COLORS[color] ? color : COLOR_CYCLE[index % COLOR_CYCLE.length];
  return BAR_COLORS[key];
}

function parseBarValue(val: any): { numericValue: number; displayValue: string } {
  if (typeof val === "number" && !isNaN(val)) return { numericValue: val, displayValue: val.toLocaleString() };
  if (typeof val === "string") {
    const s = val.trim();
    const lower = s.toLowerCase();
    if (lower.includes("1") && !lower.includes("n")) return { numericValue: 15, displayValue: s };
    if (lower.includes("log") && !lower.includes("n log") && !lower.includes("nlog")) return { numericValue: 30, displayValue: s };
    if (lower === "o(n)" || lower === "n") return { numericValue: 50, displayValue: s };
    if (lower.includes("n log") || lower.includes("nlog")) return { numericValue: 70, displayValue: s };
    if (lower.includes("n^2") || lower.includes("n2") || lower.includes("n*n")) return { numericValue: 90, displayValue: s };
    if (lower.includes("2^n") || lower.includes("n!")) return { numericValue: 100, displayValue: s };

    const parsed = parseFloat(s.replace(/[^0-9.-]/g, ""));
    if (!isNaN(parsed) && parsed > 0) return { numericValue: parsed, displayValue: s };
    return { numericValue: 50, displayValue: s };
  }
  return { numericValue: 50, displayValue: String(val ?? "50") };
}

export function parseChartData(raw: string): ChartData | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json|chart|barchart)?\s*/i, "").replace(/\s*```$/, "").trim();
    const data = JSON.parse(cleaned) as ChartData;
    if (!data || !data.title) return null;

    if (!data.type) {
      if (data.stackedBars) data.type = "stacked-bar";
      else if (data.slices) data.type = "pie";
      else if (data.points) data.type = "line";
      else if (data.scatterPoints) data.type = "scatter";
      else if (data.axes) data.type = "radar";
      else if (data.stages) data.type = "funnel";
      else if (data.value !== undefined && data.max !== undefined && !data.bars && !data.points) data.type = "gauge";
      else if (data.events) data.type = "timeline";
      else if (data.steps) data.type = "waterfall";
      else if (data.items) data.type = "progress";
      else if (data.nodes && data.nodes.length && data.nodes[0].children) data.type = "treemap";
      else if (data.bars) data.type = "bar";
    }

    return data;
  } catch {
    return null;
  }
}

// Chart Components

function BarChart({ data }: { data: ChartData }) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const bars = data.bars || [];
  const processedBars = useMemo(() => bars.map((b) => ({ ...b, ...parseBarValue(b.value) })), [bars]);
  const maxValue = useMemo(() => {
    const max = Math.max(...processedBars.map((b) => b.numericValue), 10);
    return isNaN(max) ? 100 : max;
  }, [processedBars]);
  const yTicks = useMemo(() => {
    if (data.yTicks?.length) return [...data.yTicks].sort((a, b) => b.value - a.value);
    const step = Math.max(Math.ceil(maxValue / 5), 1);
    const ticks: { value: number; label: string }[] = [];
    for (let i = 0; i <= 5; i++) ticks.push({ value: step * i, label: (step * i).toLocaleString() });
    return ticks.reverse();
  }, [data.yTicks, maxValue]);
  const gridMax = yTicks[0]?.value || 100;
  const muted = safeCssColor(data.style?.muted) || "#6b7280";
  const grid = safeCssColor(data.style?.grid) || "rgba(75,85,99,0.25)";

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "0px", marginTop: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", paddingBottom: "36px", paddingRight: "12px", minWidth: "48px", alignItems: "flex-end" }}>
        {yTicks.map((tick, i) => (
          <span key={i} style={{ color: muted, fontSize: "11px", fontWeight: 600, lineHeight: "1" }}>{tick.label}</span>
        ))}
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: "36px", display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
          {yTicks.map((_, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${grid}`, width: "100%", height: "0px" }} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: "280px", paddingBottom: "0px", position: "relative", zIndex: 1 }}>
          {processedBars.map((bar, idx) => {
            const color = getBarColor(bar.color, idx, data.style?.palette);
            const rawRatio = gridMax > 0 ? bar.numericValue / gridMax : 0.15;
            const scaledRatio = Math.pow(Math.max(rawRatio, 0), 0.55);
            const heightPx = Math.max(Math.round(scaledRatio * 200), 18);
            const isHovered = hoveredBar === idx;
            return (
              <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flex: 1, maxWidth: "80px", height: "100%", cursor: "pointer" }} onMouseEnter={() => setHoveredBar(idx)} onMouseLeave={() => setHoveredBar(null)}>
                {data.style?.showValues !== false && <div style={{ color: color.text, fontSize: "11px", fontWeight: 700, marginBottom: "6px", opacity: isHovered ? 1 : 0.88, transform: isHovered ? "translateY(0)" : "translateY(2px)", transition: "all 0.2s ease", whiteSpace: "nowrap" }}>{bar.displayValue}</div>}
                <div style={{ width: "36px", height: `${heightPx}px`, background: color.bg, borderRadius: data.style?.roundedBars === false ? "1px" : "8px 8px 2px 2px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", transform: isHovered ? "scaleX(1.15)" : "scaleX(1)", boxShadow: isHovered ? `0 0 20px ${color.glow}` : "0 4px 12px rgba(0,0,0,0.18)", position: "relative" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: "10px" }}>
          {processedBars.map((bar, idx) => {
            const color = getBarColor(bar.color, idx, data.style?.palette);
            const isHovered = hoveredBar === idx;
            return (
              <span key={idx} style={{ color: isHovered ? color.text : muted, fontSize: "10px", fontWeight: isHovered ? 700 : 600, textAlign: "center", flex: 1, maxWidth: "82px", transition: "all 0.2s ease", lineHeight: "1.3" }}>{bar.label}</span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HorizontalBarChart({ data }: { data: ChartData }) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const bars = data.bars || [];
  const processedBars = useMemo(() => bars.map((b) => ({ ...b, ...parseBarValue(b.value) })), [bars]);
  const maxValue = useMemo(() => {
    const max = Math.max(...processedBars.map((b) => b.numericValue), 10);
    return isNaN(max) ? 100 : max;
  }, [processedBars]);
  const gridMax = Math.max(maxValue, 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
      {processedBars.map((bar, idx) => {
        const color = getBarColor(bar.color, idx);
        const rawRatio = bar.numericValue / gridMax;
        const widthPct = Math.max(rawRatio * 100, 2);
        const isHovered = hoveredBar === idx;
        return (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }} onMouseEnter={() => setHoveredBar(idx)} onMouseLeave={() => setHoveredBar(null)}>
            <div style={{ width: "100px", textAlign: "right", color: isHovered ? color.text : "#9ca3af", fontSize: "12px", fontWeight: isHovered ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "all 0.2s ease" }}>{bar.label}</div>
            <div style={{ flex: 1, position: "relative", height: "24px", background: "rgba(75,85,99,0.1)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ width: `${widthPct}%`, height: "100%", background: `linear-gradient(90deg, ${color.bg}, ${color.bg}cc)`, borderRadius: "12px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: isHovered ? `0 0 12px ${color.glow}` : "none", opacity: isHovered ? 1 : 0.9 }} />
            </div>
            <div style={{ width: "60px", color: color.text, fontSize: "12px", fontWeight: 600, opacity: isHovered ? 1 : 0.85, transition: "all 0.2s ease" }}>{bar.displayValue}</div>
          </div>
        );
      })}
    </div>
  );
}

function StackedBarChart({ data }: { data: ChartData }) {
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);
  const stacks = data.stackedBars || [];
  
  const maxValue = useMemo(() => {
    return Math.max(...stacks.map(s => s.segments.reduce((acc, seg) => acc + seg.value, 0)), 10);
  }, [stacks]);

  const yTicks = useMemo(() => {
    const step = Math.max(Math.ceil(maxValue / 5), 1);
    const ticks: number[] = [];
    for (let i = 0; i <= 5; i++) ticks.push(step * i);
    return ticks.reverse();
  }, [maxValue]);
  const gridMax = yTicks[0] || 100;

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "0px", marginTop: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", paddingBottom: "36px", paddingRight: "12px", minWidth: "48px", alignItems: "flex-end" }}>
        {yTicks.map((tick, i) => (
          <span key={i} style={{ color: "#6b7280", fontSize: "11px", fontWeight: 500, lineHeight: "1" }}>{tick.toLocaleString()}</span>
        ))}
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: "36px", display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
          {yTicks.map((_, i) => (
            <div key={i} style={{ borderBottom: i < yTicks.length - 1 ? "1px solid rgba(75,85,99,0.25)" : "1px solid rgba(75,85,99,0.5)", width: "100%", height: "0px" }} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: "280px", paddingBottom: "0px", position: "relative", zIndex: 1 }}>
          {stacks.map((stack, idx) => {
            const isHovered = hoveredGroup === idx;
            const totalVal = stack.segments.reduce((acc, s) => acc + s.value, 0);
            return (
              <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flex: 1, maxWidth: "80px", height: "100%", cursor: "pointer", opacity: hoveredGroup !== null && !isHovered ? 0.6 : 1, transition: "all 0.2s" }} onMouseEnter={() => setHoveredGroup(idx)} onMouseLeave={() => setHoveredGroup(null)}>
                <div style={{ color: "#9ca3af", fontSize: "11px", fontWeight: 600, marginBottom: "6px", opacity: isHovered ? 1 : 0, transition: "opacity 0.2s" }}>{totalVal}</div>
                <div style={{ width: "36px", display: "flex", flexDirection: "column-reverse", height: `${(totalVal / gridMax) * 100}%`, transform: isHovered ? "scaleX(1.1)" : "scaleX(1)", transition: "transform 0.2s", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
                  {stack.segments.map((seg, sidx) => {
                    const color = getBarColor(seg.color, sidx);
                    const hPct = (seg.value / totalVal) * 100;
                    return (
                      <div key={sidx} style={{ height: `${hPct}%`, width: "100%", backgroundColor: color.bg, borderTop: sidx < stack.segments.length - 1 ? "1px solid rgba(0,0,0,0.2)" : "none" }} title={`${seg.label}: ${seg.value}`} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: "10px" }}>
          {stacks.map((stack, idx) => (
            <span key={idx} style={{ color: hoveredGroup === idx ? "#e5e7eb" : "#9ca3af", fontSize: "10px", fontWeight: hoveredGroup === idx ? 600 : 500, textAlign: "center", flex: 1, maxWidth: "70px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stack.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArcPath({ cx, cy, r, startAngle, endAngle }: { cx: number, cy: number, r: number, startAngle: number, endAngle: number }) {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
}

function DonutArcPath({ cx, cy, outerR, innerR, startAngle, endAngle }: { cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number }) {
  const x1o = cx + outerR * Math.cos(startAngle);
  const y1o = cy + outerR * Math.sin(startAngle);
  const x2o = cx + outerR * Math.cos(endAngle);
  const y2o = cy + outerR * Math.sin(endAngle);
  const x1i = cx + innerR * Math.cos(endAngle);
  const y1i = cy + innerR * Math.sin(endAngle);
  const x2i = cx + innerR * Math.cos(startAngle);
  const y2i = cy + innerR * Math.sin(startAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";
  return `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 ${largeArcFlag} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${innerR} ${innerR} 0 ${largeArcFlag} 0 ${x2i} ${y2i} Z`;
}

function PieChart({ data }: { data: ChartData }) {
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const slices = data.slices || [];
  const total = useMemo(() => slices.reduce((acc, s) => acc + s.value, 0), [slices]);

  let currentAngle = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;
    return { ...slice, startAngle, endAngle, midAngle: startAngle + angle / 2 };
  });

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "32px", marginTop: "16px" }}>
      <svg width="240" height="240" viewBox="0 0 240 240">
        {arcs.map((arc, idx) => {
          const color = getBarColor(arc.color, idx);
          const isHovered = hoveredSlice === idx;
          const shift = isHovered ? 8 : 0;
          const cx = 120 + shift * Math.cos(arc.midAngle);
          const cy = 120 + shift * Math.sin(arc.midAngle);
          const path = ArcPath({ cx, cy, r: 100, startAngle: arc.startAngle, endAngle: arc.endAngle });
          return (
            <path key={idx} d={path} fill={color.bg} style={{ transition: "all 0.2s ease", cursor: "pointer", filter: isHovered ? `drop-shadow(0 0 8px ${color.glow})` : "none" }} onMouseEnter={() => setHoveredSlice(idx)} onMouseLeave={() => setHoveredSlice(null)} />
          );
        })}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {arcs.map((arc, idx) => {
          const color = getBarColor(arc.color, idx);
          const pct = Math.round((arc.value / total) * 100);
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: hoveredSlice === null || hoveredSlice === idx ? 1 : 0.5, transition: "opacity 0.2s" }} onMouseEnter={() => setHoveredSlice(idx)} onMouseLeave={() => setHoveredSlice(null)}>
              <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: color.bg }} />
              <span style={{ color: "#d1d5db", fontSize: "13px" }}>{arc.label}</span>
              <span style={{ color: color.text, fontSize: "13px", fontWeight: 600, marginLeft: "auto" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: ChartData }) {
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const slices = data.slices || [];
  const total = useMemo(() => slices.reduce((acc, s) => acc + s.value, 0), [slices]);

  let currentAngle = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;
    return { ...slice, startAngle, endAngle, midAngle: startAngle + angle / 2 };
  });

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "32px", marginTop: "16px" }}>
      <div style={{ position: "relative" }}>
        <svg width="240" height="240" viewBox="0 0 240 240">
          {arcs.map((arc, idx) => {
            const color = getBarColor(arc.color, idx);
            const isHovered = hoveredSlice === idx;
            const shift = isHovered ? 4 : 0;
            const cx = 120 + shift * Math.cos(arc.midAngle);
            const cy = 120 + shift * Math.sin(arc.midAngle);
            const path = DonutArcPath({ cx, cy, outerR: 100, innerR: 65, startAngle: arc.startAngle, endAngle: arc.endAngle });
            return (
              <path key={idx} d={path} fill={color.bg} style={{ transition: "all 0.2s ease", cursor: "pointer", filter: isHovered ? `drop-shadow(0 0 8px ${color.glow})` : "none" }} onMouseEnter={() => setHoveredSlice(idx)} onMouseLeave={() => setHoveredSlice(null)} />
            );
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ color: "#9ca3af", fontSize: "12px" }}>Total</span>
          <span style={{ color: "#f3f4f6", fontSize: "24px", fontWeight: 700 }}>{total.toLocaleString()}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {arcs.map((arc, idx) => {
          const color = getBarColor(arc.color, idx);
          const pct = Math.round((arc.value / total) * 100);
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: hoveredSlice === null || hoveredSlice === idx ? 1 : 0.5, transition: "opacity 0.2s" }} onMouseEnter={() => setHoveredSlice(idx)} onMouseLeave={() => setHoveredSlice(null)}>
              <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: color.bg }} />
              <span style={{ color: "#d1d5db", fontSize: "13px" }}>{arc.label}</span>
              <span style={{ color: color.text, fontSize: "13px", fontWeight: 600, marginLeft: "auto" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineAreaChart({ data, isArea = false }: { data: ChartData; isArea?: boolean }) {
  const [hoveredPt, setHoveredPt] = useState<number | null>(null);
  const points = data.points || [];

  const { minY, maxY, yTicks } = useMemo(() => {
    if (points.length === 0) return { minY: 0, maxY: 10, yTicks: [10, 8, 6, 4, 2, 0].map((value) => ({ value, label: String(value) })) };
    const values = points.map((p) => p.value);
    const explicitTicks = data.yTicks?.map((tick) => tick.value) || [];
    const rawMin = explicitTicks.length ? Math.min(...explicitTicks) : Math.min(...values);
    const rawMax = explicitTicks.length ? Math.max(...explicitTicks) : Math.max(...values);

    let minY: number;
    let maxY: number;

    if (rawMin === rawMax) {
      const pad = Math.abs(rawMin) * 0.2 || 1;
      minY = rawMin - pad;
      maxY = rawMax + pad;
    } else {
      const range = rawMax - rawMin;
      const pad = range * 0.15;
      minY = rawMin - pad;
      maxY = rawMax + pad;
    }

    const step = (maxY - minY) / 5;
    const ticks = data.yTicks?.length
      ? [...data.yTicks].sort((a, b) => b.value - a.value)
      : Array.from({ length: 6 }, (_, i) => {
          const value = Number((maxY - i * step).toFixed(2));
          return { value, label: value.toLocaleString() };
        });
    return { minY, maxY, yTicks: ticks };
  }, [data.yTicks, points]);

  const w = 500,
    h = 240;
  const rangeY = maxY - minY || 1;

  const pts = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * w : w / 2;
    const y = h - ((p.value - minY) / rangeY) * h;
    return { ...p, x, y };
  });

  const pathD =
    pts.length > 0 ? `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") : "";
  const areaD = pts.length > 0 ? `${pathD} L ${w} ${h} L 0 ${h} Z` : "";

  const color = getBarColor(undefined, 0, data.style?.palette);
  const muted = safeCssColor(data.style?.muted) || "#6b7280";
  const grid = safeCssColor(data.style?.grid) || "rgba(75,85,99,0.25)";

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "0px", marginTop: "16px" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          paddingBottom: "36px",
          paddingRight: "12px",
          minWidth: "54px",
          alignItems: "flex-end",
        }}
      >
        {yTicks.map((tick, i) => (
          <span key={i} style={{ color: muted, fontSize: "11px", fontWeight: 600, lineHeight: "1" }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "visible" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: "36px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            pointerEvents: "none",
          }}
        >
          {yTicks.map((_, i) => (
            <div
              key={i}
              style={{
                borderBottom: `1px solid ${grid}`,
                width: "100%",
                height: "0px",
              }}
            />
          ))}
        </div>
        <div style={{ width: "100%", height: "240px", position: "relative" }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
            {isArea && areaD && (
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color.bg} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={color.bg} stopOpacity="0.0" />
                </linearGradient>
              </defs>
            )}
            {isArea && areaD && <path d={areaD} fill="url(#areaGradient)" stroke="none" />}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                stroke={color.bg}
                strokeWidth={Math.min(Math.max(data.style?.lineWidth || 3, 1), 8)}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>
          {pts.map((p, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${(p.x / w) * 100}%`,
                top: `${Math.min(Math.max((p.y / h) * 100, 0), 100)}%`,
                transform: "translate(-50%, -50%)",
                width: `${Math.min(Math.max(data.style?.pointSize || 12, 4), 22)}px`,
                height: `${Math.min(Math.max(data.style?.pointSize || 12, 4), 22)}px`,
                borderRadius: "50%",
                background: hoveredPt === i ? color.text : color.bg,
                border: "2px solid #111827",
                cursor: "pointer",
                transition: "all 0.2s",
                zIndex: 10,
              }}
              onMouseEnter={() => setHoveredPt(i)}
              onMouseLeave={() => setHoveredPt(null)}
            >
              {hoveredPt === i && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: "50%",
                    transform: "translate(-50%, -8px)",
                    background: "rgba(17,24,39,0.9)",
                    color: "#fff",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    whiteSpace: "nowrap",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {p.label}: {p.value}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px", padding: "0 6px" }}>
          {points.map((p, idx) => (
            <span
              key={idx}
              style={{
                color: hoveredPt === idx ? color.text : muted,
                fontSize: "10px",
                fontWeight: hoveredPt === idx ? 600 : 500,
                textAlign: "center",
                transition: "all 0.2s ease",
              }}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScatterPlot({ data }: { data: ChartData }) {
  const [hoveredPt, setHoveredPt] = useState<number | null>(null);
  const points = data.scatterPoints || [];
  const maxX = useMemo(() => Math.max(...points.map(p => p.x), 10), [points]);
  const maxY = useMemo(() => Math.max(...points.map(p => p.y), 10), [points]);

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "16px", height: "300px", position: "relative" }}>
      <div style={{ flex: 1, position: "relative", borderLeft: "1px solid rgba(75,85,99,0.5)", borderBottom: "1px solid rgba(75,85,99,0.5)", margin: "0 20px 20px 40px" }}>
        {points.map((p, i) => {
          const color = getBarColor(p.color, i);
          const left = (p.x / maxX) * 100;
          const bottom = (p.y / maxY) * 100;
          const isHovered = hoveredPt === i;
          return (
            <div key={i} style={{ position: "absolute", left: `${left}%`, bottom: `${bottom}%`, transform: "translate(-50%, 50%)", width: isHovered ? "14px" : "10px", height: isHovered ? "14px" : "10px", borderRadius: "50%", background: color.bg, boxShadow: isHovered ? `0 0 10px ${color.glow}` : "none", cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={() => setHoveredPt(i)} onMouseLeave={() => setHoveredPt(null)}>
              {isHovered && (
                <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translate(-50%, -8px)", background: "rgba(17,24,39,0.9)", color: "#fff", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap", border: "1px solid rgba(255,255,255,0.1)", zIndex: 10 }}>
                  {p.label ? `${p.label} ` : ""}({p.x}, {p.y})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RadarChart({ data }: { data: ChartData }) {
  const [hoveredSeries, setHoveredSeries] = useState<number | null>(null);
  const axes = data.axes || [];
  const rawSeries = data.series || data.radarSeries;

  const series = useMemo(() => {
    if (rawSeries && rawSeries.length > 0) return rawSeries;
    const values = axes.map((a) => a.value ?? 50);
    return [{ name: data.title || "Series 1", values }];
  }, [rawSeries, axes, data.title]);

  const cx = 150,
    cy = 150,
    r = 95;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "16px", gap: "16px" }}>
      <svg width="320" height="320" viewBox="0 0 300 300" style={{ overflow: "visible" }}>
        {[0.2, 0.4, 0.6, 0.8, 1].map((level) => (
          <polygon
            key={level}
            points={axes
              .map((_, i) => {
                const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
                return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgba(75,85,99,0.3)"
          />
        ))}
        {axes.map((a, i) => {
          const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
          const labelX = cx + (r + 25) * Math.cos(angle);
          const labelY = cy + (r + 25) * Math.sin(angle);
          return (
            <React.Fragment key={i}>
              <line
                x1={cx}
                y1={cy}
                x2={cx + r * Math.cos(angle)}
                y2={cy + r * Math.sin(angle)}
                stroke="rgba(75,85,99,0.3)"
              />
              <text
                x={labelX}
                y={labelY}
                fill="#9ca3af"
                fontSize="11px"
                fontWeight="500"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {a.label}
              </text>
            </React.Fragment>
          );
        })}

        {series.map((s, sIdx) => {
          const color = getBarColor(s.color, sIdx);
          const isHovered = hoveredSeries === sIdx;
          const isDimmed = hoveredSeries !== null && !isHovered;

          const pts = axes.map((a, i) => {
            const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            const val = s.values[i] ?? 50;
            const max = a.max || 100;
            const valR = (val / max) * r;
            return {
              x: cx + valR * Math.cos(angle),
              y: cy + valR * Math.sin(angle),
            };
          });

          const polygonD = pts.length > 0 ? `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} Z` : "";

          return (
            <g
              key={sIdx}
              onMouseEnter={() => setHoveredSeries(sIdx)}
              onMouseLeave={() => setHoveredSeries(null)}
              style={{ cursor: "pointer", opacity: isDimmed ? 0.25 : 1, transition: "opacity 0.2s ease" }}
            >
              {polygonD && (
                <path
                  d={polygonD}
                  fill={color.glow}
                  stroke={color.bg}
                  strokeWidth={isHovered ? "3" : "2"}
                  style={{ transition: "all 0.2s ease" }}
                />
              )}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={isHovered ? "5" : "4"} fill={color.bg} />
              ))}
            </g>
          );
        })}
      </svg>

      {series.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "16px" }}>
          {series.map((s, sIdx) => {
            const color = getBarColor(s.color, sIdx);
            const isHovered = hoveredSeries === sIdx;
            return (
              <div
                key={sIdx}
                onMouseEnter={() => setHoveredSeries(sIdx)}
                onMouseLeave={() => setHoveredSeries(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  opacity: hoveredSeries === null || isHovered ? 1 : 0.4,
                  transition: "opacity 0.2s",
                }}
              >
                <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: color.bg }} />
                <span style={{ color: color.text, fontSize: "12px", fontWeight: 600 }}>{s.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FunnelChart({ data }: { data: ChartData }) {
  const stages = data.stages || [];
  const maxVal = Math.max(...stages.map(s => s.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "16px" }}>
      {stages.map((stage, idx) => {
        const color = getBarColor(stage.color, idx);
        const wPct = (stage.value / maxVal) * 100;
        return (
          <div key={idx} style={{ width: `${Math.max(wPct, 10)}%`, height: "40px", background: color.bg, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px", borderRadius: "4px", color: "#fff", fontSize: "12px", fontWeight: 600, transition: "all 0.3s", cursor: "default" }}>
            <span>{stage.label}</span>
            <span>{stage.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function GaugeChart({ data }: { data: ChartData }) {
  const val = data.value || 0;
  const max = data.max || 100;
  const pct = Math.min(Math.max(val / max, 0), 1);
  const cx = 150, cy = 150, r = 100;
  const startAngle = Math.PI;
  const endAngle = Math.PI + Math.PI * pct;
  const path = ArcPath({ cx, cy, r, startAngle, endAngle });
  const bgPath = ArcPath({ cx, cy, r, startAngle: Math.PI, endAngle: Math.PI * 2 });
  const color = getBarColor(undefined, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "16px" }}>
      <svg width="300" height="160" viewBox="0 0 300 160">
        <path d={bgPath} fill="none" stroke="rgba(75,85,99,0.2)" strokeWidth="20" strokeLinecap="round" />
        <path d={path} fill="none" stroke={color.bg} strokeWidth="20" strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
        <text x={cx} y={cy - 20} fill="#f3f4f6" fontSize="36px" fontWeight="700" textAnchor="middle">{val}</text>
        {data.unit && <text x={cx} y={cy} fill="#9ca3af" fontSize="14px" textAnchor="middle">{data.unit}</text>}
      </svg>
    </div>
  );
}

function TimelineChart({ data }: { data: ChartData }) {
  const events = data.events || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px", paddingLeft: "16px" }}>
      {events.map((ev, i) => {
        const color = getBarColor(ev.color, i);
        return (
          <div key={i} style={{ display: "flex", gap: "16px", position: "relative" }}>
            <div style={{ position: "absolute", left: "-23px", top: "24px", bottom: i === events.length - 1 ? "auto" : "-16px", width: "2px", background: "rgba(75,85,99,0.3)" }} />
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: color.bg, position: "absolute", left: "-28px", top: "4px", border: "2px solid #111827" }} />
            <div style={{ flex: 1, background: "rgba(31,41,55,0.4)", padding: "12px 16px", borderRadius: "8px", border: "1px solid rgba(75,85,99,0.2)" }}>
              <div style={{ color: color.text, fontSize: "11px", fontWeight: 600, marginBottom: "4px" }}>{ev.date}</div>
              <div style={{ color: "#f3f4f6", fontSize: "14px", fontWeight: 600 }}>{ev.title}</div>
              {ev.description && <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "6px" }}>{ev.description}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TreemapChart({ data }: { data: ChartData }) {
  const nodes = data.nodes || [];
  const total = useMemo(() => nodes.reduce((a, n) => a + n.value, 0), [nodes]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", width: "100%", height: "280px", marginTop: "16px" }}>
      {nodes.map((node, i) => {
        const color = getBarColor(node.color, i);
        const wPct = (node.value / total) * 100;
        return (
          <div key={i} style={{ flexBasis: `${Math.max(wPct, 10)}%`, flexGrow: 1, background: color.bg, borderRadius: "6px", display: "flex", flexDirection: "column", padding: "8px", color: "#fff", overflow: "hidden", minWidth: "60px", minHeight: "40px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.label}</span>
            <span style={{ fontSize: "11px", opacity: 0.8 }}>{node.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function WaterfallChart({ data }: { data: ChartData }) {
  const steps = data.steps || [];
  let currentVal = 0;
  const processed = steps.map(s => {
    const start = currentVal;
    if (s.type === "decrease") currentVal -= s.value;
    else if (s.type !== "total") currentVal += s.value;
    const end = s.type === "total" ? s.value : currentVal;
    if (s.type === "total") currentVal = s.value;
    return { ...s, start, end, type: s.type || "increase" };
  });

  const minVal = Math.min(0, ...processed.map(p => Math.min(p.start, p.end)));
  const maxVal = Math.max(...processed.map(p => Math.max(p.start, p.end)));
  const range = maxVal - minVal;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: "280px", marginTop: "16px", paddingBottom: "20px", position: "relative" }}>
      {processed.map((step, i) => {
        const bottom = ((Math.min(step.start, step.end) - minVal) / range) * 100;
        const height = (Math.abs(step.end - step.start) / range) * 100;
        const color = step.type === "total" ? "#3b82f6" : step.type === "decrease" ? "#ef4444" : "#10b981";
        return (
          <div key={i} style={{ flex: 1, margin: "0 4px", display: "flex", flexDirection: "column", alignItems: "center", position: "relative", height: "100%" }}>
            <div style={{ position: "absolute", bottom: `${bottom}%`, height: `${Math.max(height, 2)}%`, width: "100%", maxWidth: "40px", background: color, borderRadius: "4px" }} />
            <div style={{ position: "absolute", bottom: "-20px", color: "#9ca3af", fontSize: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>{step.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressBars({ data }: { data: ChartData }) {
  const items = data.items || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
      {items.map((item, i) => {
        const color = getBarColor(item.color, i);
        const pct = Math.min((item.value / (item.max || 100)) * 100, 100);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "#d1d5db", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: color.text, fontWeight: 600 }}>{item.value} / {item.max || 100}</span>
            </div>
            <div style={{ width: "100%", height: "8px", background: "rgba(75,85,99,0.3)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: color.bg, borderRadius: "4px" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ChartViewer({ data }: { data: ChartData }) {
  const background = safeCssColor(data.style?.background) || "transparent";
  const text = safeCssColor(data.style?.text) || "inherit";
  const muted = safeCssColor(data.style?.muted) || "#6b7280";
  return (
    <div style={{ background, color: text, borderRadius: "16px", padding: "32px 28px 24px", fontFamily: data.style?.fontFamily || "'Inter', 'Segoe UI', system-ui, sans-serif", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <h3 style={{ color: text, fontSize: "19px", fontWeight: 750, textAlign: "center", marginBottom: "4px", letterSpacing: "0.1px" }}>{data.title}</h3>
      {data.subtitle && <p style={{ color: muted, fontSize: "13px", textAlign: "center", marginBottom: "24px" }}>{data.subtitle}</p>}
      
      {data.type === "horizontal-bar" ? <HorizontalBarChart data={data} /> :
       data.type === "stacked-bar" ? <StackedBarChart data={data} /> :
       data.type === "pie" ? <PieChart data={data} /> :
       data.type === "donut" ? <DonutChart data={data} /> :
       data.type === "line" ? <LineAreaChart data={data} /> :
       data.type === "area" ? <LineAreaChart data={data} isArea={true} /> :
       data.type === "scatter" ? <ScatterPlot data={data} /> :
       data.type === "radar" ? <RadarChart data={data} /> :
       data.type === "funnel" ? <FunnelChart data={data} /> :
       data.type === "gauge" ? <GaugeChart data={data} /> :
       data.type === "timeline" ? <TimelineChart data={data} /> :
       data.type === "treemap" ? <TreemapChart data={data} /> :
       data.type === "waterfall" ? <WaterfallChart data={data} /> :
       data.type === "progress" ? <ProgressBars data={data} /> :
       <BarChart data={data} />}
       
      <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginTop: "16px" }}>
        {data.yLabel && <span style={{ color: muted, fontSize: "11px", fontStyle: "italic" }}>Y: {data.yLabel}</span>}
        {data.xLabel && <span style={{ color: muted, fontSize: "11px", fontStyle: "italic" }}>X: {data.xLabel}</span>}
      </div>
      {(data.note || data.source) && <p style={{ color: muted, fontSize: "10px", lineHeight: 1.5, textAlign: "center", marginTop: "14px", marginBottom: 0 }}>{[data.note, data.source && `Source: ${data.source}`].filter(Boolean).join(" · ")}</p>}
    </div>
  );
}
