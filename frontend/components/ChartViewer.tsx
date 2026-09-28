"use client";
import React, { useState, useMemo } from "react";
import CartesianChart from "./CartesianChart";
import { chartColor } from '../lib/chart-data';
export { parseChartData } from "../lib/chart-data";

export interface ChartData {
  type?: "bar" | "horizontal-bar" | "stacked-bar" | "pie" | "donut" | "line" | "area" | "scatter" | "radar" | "funnel" | "gauge" | "timeline" | "treemap" | "waterfall" | "progress";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel?: string;
  bars?: { label: string; value: number | string; color?: string }[];
  stackedBars?: { label: string; segments: { label: string; value: number; color?: string }[] }[];
  slices?: { label: string; value: number; color?: string }[];
  points?: { label: string; value: number; x?: number }[];
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

function getBarColor(color: string | undefined, index: number, palette?: string[]) {
  const resolved = chartColor(color, index, palette);
  return { bg: resolved, glow: resolved, text: resolved };
}

function ArcPath({ cx, cy, r, startAngle, endAngle }: { cx: number, cy: number, r: number, startAngle: number, endAngle: number }) {
  if (endAngle - startAngle >= Math.PI * 2 - 1e-8) return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
}

function DonutArcPath({ cx, cy, outerR, innerR, startAngle, endAngle }: { cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number }) {
  if (endAngle - startAngle >= Math.PI * 2 - 1e-8) return `M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 0 ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 0 ${cx - outerR} ${cy} Z M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 1 ${cx + innerR} ${cy} A ${innerR} ${innerR} 0 1 1 ${cx - innerR} ${cy} Z`;
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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: "24px", marginTop: "16px" }}>
      <svg width="240" height="240" viewBox="0 0 240 240">
        {arcs.map((arc, idx) => {
          const color = getBarColor(arc.color, idx, data.style?.palette);
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
          const color = getBarColor(arc.color, idx, data.style?.palette);
          const pct = Math.round((arc.value / total) * 100);
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: hoveredSlice === null || hoveredSlice === idx ? 1 : 0.5, transition: "opacity 0.2s" }} onMouseEnter={() => setHoveredSlice(idx)} onMouseLeave={() => setHoveredSlice(null)}>
              <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: color.bg }} />
              <span style={{ color: "var(--chart-text)", fontSize: "13px" }}>{arc.label}</span>
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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: "24px", marginTop: "16px" }}>
      <div style={{ position: "relative" }}>
        <svg width="240" height="240" viewBox="0 0 240 240">
          {arcs.map((arc, idx) => {
            const color = getBarColor(arc.color, idx, data.style?.palette);
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
          <span style={{ color: "var(--chart-muted)", fontSize: "12px" }}>Total</span>
          <span style={{ color: "var(--chart-text)", fontSize: "24px", fontWeight: 700 }}>{total.toLocaleString()}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {arcs.map((arc, idx) => {
          const color = getBarColor(arc.color, idx, data.style?.palette);
          const pct = Math.round((arc.value / total) * 100);
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: hoveredSlice === null || hoveredSlice === idx ? 1 : 0.5, transition: "opacity 0.2s" }} onMouseEnter={() => setHoveredSlice(idx)} onMouseLeave={() => setHoveredSlice(null)}>
              <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: color.bg }} />
              <span style={{ color: "var(--chart-text)", fontSize: "13px" }}>{arc.label}</span>
              <span style={{ color: color.text, fontSize: "13px", fontWeight: 600, marginLeft: "auto" }}>{pct}%</span>
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
        const color = getBarColor(stage.color, idx, data.style?.palette);
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
        const color = getBarColor(ev.color, i, data.style?.palette);
        return (
          <div key={i} style={{ display: "flex", gap: "16px", position: "relative" }}>
            <div style={{ position: "absolute", left: "-23px", top: "24px", bottom: i === events.length - 1 ? "auto" : "-16px", width: "2px", background: "rgba(75,85,99,0.3)" }} />
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: color.bg, position: "absolute", left: "-28px", top: "4px", border: "2px solid #111827" }} />
            <div style={{ flex: 1, background: "rgba(31,41,55,0.4)", padding: "12px 16px", borderRadius: "8px", border: "1px solid rgba(75,85,99,0.2)" }}>
              <div style={{ color: color.text, fontSize: "11px", fontWeight: 600, marginBottom: "4px" }}>{ev.date}</div>
              <div style={{ color: "var(--chart-text)", fontSize: "14px", fontWeight: 600 }}>{ev.title}</div>
              {ev.description && <div style={{ color: "var(--chart-muted)", fontSize: "12px", marginTop: "6px" }}>{ev.description}</div>}
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
        const color = getBarColor(node.color, i, data.style?.palette);
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
  const range = maxVal - minVal || 1;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: "280px", marginTop: "16px", paddingBottom: "20px", position: "relative" }}>
      {processed.map((step, i) => {
        const bottom = ((Math.min(step.start, step.end) - minVal) / range) * 100;
        const height = (Math.abs(step.end - step.start) / range) * 100;
        const color = step.type === "total" ? "#3b82f6" : step.type === "decrease" ? "#ef4444" : "#10b981";
        return (
          <div key={i} style={{ flex: 1, margin: "0 4px", display: "flex", flexDirection: "column", alignItems: "center", position: "relative", height: "100%" }}>
            <div style={{ position: "absolute", bottom: `${bottom}%`, height: `${Math.max(height, 2)}%`, width: "100%", maxWidth: "40px", background: color, borderRadius: "4px" }} />
            <div style={{ position: "absolute", bottom: "-20px", color: "var(--chart-muted)", fontSize: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>{step.label}</div>
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
        const color = getBarColor(item.color, i, data.style?.palette);
        const pct = Math.min((item.value / (item.max || 100)) * 100, 100);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--chart-text)", fontWeight: 500 }}>{item.label}</span>
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
  const cartesian = ["bar", "horizontal-bar", "stacked-bar", "line", "area", "scatter"].includes(data.type || "bar");
  const background = "transparent";
  const text = "var(--chart-text)";
  const muted = "var(--chart-muted)";
  return (
    <div className="chart-viewer" style={{ background, color: text, padding: "16px 0 8px", fontFamily: data.style?.fontFamily || "inherit", width: "100%", boxSizing: "border-box", overflowX: "auto" }}>
      <h3 style={{ color: text, fontSize: "19px", fontWeight: 750, textAlign: "center", marginBottom: "4px", letterSpacing: "0.1px" }}>{data.title}</h3>
      {data.subtitle && <p style={{ color: muted, fontSize: "13px", textAlign: "center", marginBottom: "24px" }}>{data.subtitle}</p>}
      
      {cartesian ? <CartesianChart data={data} /> :
       data.type === "pie" ? <PieChart data={data} /> :
       data.type === "donut" ? <DonutChart data={data} /> :
       data.type === "radar" ? <RadarChart data={data} /> :
       data.type === "funnel" ? <FunnelChart data={data} /> :
       data.type === "gauge" ? <GaugeChart data={data} /> :
       data.type === "timeline" ? <TimelineChart data={data} /> :
       data.type === "treemap" ? <TreemapChart data={data} /> :
       data.type === "waterfall" ? <WaterfallChart data={data} /> :
       data.type === "progress" ? <ProgressBars data={data} /> :
       <p>Chart type is not supported.</p>}
       
      {!cartesian && !["pie", "donut"].includes(data.type || "") && <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginTop: "16px" }}>
        {data.yLabel && <span style={{ color: muted, fontSize: "11px", fontStyle: "italic" }}>Y: {data.yLabel}</span>}
        {data.xLabel && <span style={{ color: muted, fontSize: "11px", fontStyle: "italic" }}>X: {data.xLabel}</span>}
      </div>}
      {(data.note || data.source) && <p style={{ color: muted, fontSize: "10px", lineHeight: 1.5, textAlign: "center", marginTop: "14px", marginBottom: 0 }}>{[data.note, data.source && `Source: ${data.source}`].filter(Boolean).join(" · ")}</p>}
    </div>
  );
}
