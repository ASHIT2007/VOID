"use client";
import React, { useState, useMemo } from "react";

interface GraphNode {
  id: string;
  label?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

interface GraphData {
  title: string;
  subtitle?: string;
  directed?: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS = [
  { fill: "#3b82f6", glow: "rgba(59,130,246,0.4)", ring: "#93c5fd" },
  { fill: "#10b981", glow: "rgba(16,185,129,0.4)", ring: "#6ee7b7" },
  { fill: "#f59e0b", glow: "rgba(245,158,11,0.4)", ring: "#fcd34d" },
  { fill: "#f43f5e", glow: "rgba(244,63,94,0.4)",  ring: "#fda4af" },
  { fill: "#8b5cf6", glow: "rgba(139,92,246,0.4)", ring: "#c4b5fd" },
  { fill: "#14b8a6", glow: "rgba(20,184,166,0.4)", ring: "#5eead4" },
  { fill: "#06b6d4", glow: "rgba(6,182,212,0.4)",  ring: "#67e8f9" },
  { fill: "#ec4899", glow: "rgba(236,72,153,0.4)", ring: "#f9a8d4" },
];

export function parseGraphData(raw: string): GraphData | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json|graph|nodegraph)?\s*/i, "").replace(/\s*```$/, "").trim();
    const data = JSON.parse(cleaned);
    if (data && data.title && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
      return data as GraphData;
    }
    return null;
  } catch {
    return null;
  }
}

function autoLayout(nodes: GraphNode[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const n = nodes.length;
  
  if (n === 0) return {};
  if (n === 1) return { [nodes[0].id]: { x: cx, y: cy } };
  
  const radius = Math.min(width, height) * 0.35;
  const positions: Record<string, { x: number; y: number }> = {};
  
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions[node.id] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
  
  return positions;
}

export default function GraphViewer({ data }: { data: GraphData }) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

  const svgWidth = 560;
  const svgHeight = 400;
  const nodeRadius = 26;

  const positions = useMemo(() => autoLayout(data.nodes, svgWidth, svgHeight), [data.nodes]);

  const toggleSelect = (id: string) => {
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getNodeColor = (index: number) => NODE_COLORS[index % NODE_COLORS.length];

  // Build adjacency for highlight
  const adjacency = useMemo(() => {
    const adj: Record<string, Set<string>> = {};
    data.edges.forEach((e) => {
      if (!adj[e.from]) adj[e.from] = new Set();
      if (!adj[e.to]) adj[e.to] = new Set();
      adj[e.from].add(e.to);
      if (!data.directed) adj[e.to].add(e.from);
    });
    return adj;
  }, [data.edges, data.directed]);

  const isConnected = (nodeId: string) => {
    if (!hoveredNode) return false;
    if (nodeId === hoveredNode) return true;
    return adjacency[hoveredNode]?.has(nodeId) || false;
  };

  const isEdgeHighlighted = (from: string, to: string) => {
    if (!hoveredNode) return false;
    if (hoveredNode === from || hoveredNode === to) return true;
    return false;
  };

  return (
    <div
      style={{
        background: "transparent",
        borderRadius: "16px",
        padding: "28px 20px 20px",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Title */}
      <h3 style={{ color: "inherit", fontSize: "18px", fontWeight: 700, marginBottom: "4px", textAlign: "center" }}>
        {data.title}
      </h3>
      {data.subtitle && (
        <p style={{ color: "#6b7280", fontSize: "13px", fontStyle: "italic", marginBottom: "16px", textAlign: "center" }}>
          {data.subtitle}
        </p>
      )}

      {/* SVG Graph */}
      <svg
        width="100%"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ maxWidth: `${svgWidth}px`, overflow: "visible" }}
      >
        {/* Defs for glow filters */}
        <defs>
          {data.nodes.map((_, i) => {
            const color = getNodeColor(i);
            return (
              <filter key={i} id={`glow-${i}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feFlood floodColor={color.glow} result="color" />
                <feComposite in="color" in2="blur" operator="in" result="shadow" />
                <feMerge>
                  <feMergeNode in="shadow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            );
          })}
        </defs>

        {/* Edges */}
        {data.edges.map((edge, idx) => {
          const fromPos = positions[edge.from];
          const toPos = positions[edge.to];
          if (!fromPos || !toPos) return null;
          
          const highlighted = isEdgeHighlighted(edge.from, edge.to);
          
          // Calculate midpoint for label
          const mx = (fromPos.x + toPos.x) / 2;
          const my = (fromPos.y + toPos.y) / 2;

          return (
            <g key={`edge-${idx}`}>
              <line
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke={highlighted ? "#9ca3af" : "#374151"}
                strokeWidth={highlighted ? 2.5 : 1.5}
                style={{ transition: "all 0.25s ease" }}
              />
              {/* Arrow for directed graphs */}
              {data.directed && (() => {
                const dx = toPos.x - fromPos.x;
                const dy = toPos.y - fromPos.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len === 0) return null;
                const ux = dx / len;
                const uy = dy / len;
                const arrowX = toPos.x - ux * (nodeRadius + 4);
                const arrowY = toPos.y - uy * (nodeRadius + 4);
                const perpX = -uy;
                const perpY = ux;
                const arrowSize = 8;
                return (
                  <polygon
                    points={`${arrowX},${arrowY} ${arrowX - ux * arrowSize + perpX * arrowSize * 0.5},${arrowY - uy * arrowSize + perpY * arrowSize * 0.5} ${arrowX - ux * arrowSize - perpX * arrowSize * 0.5},${arrowY - uy * arrowSize - perpY * arrowSize * 0.5}`}
                    fill={highlighted ? "#9ca3af" : "#374151"}
                    style={{ transition: "all 0.25s ease" }}
                  />
                );
              })()}
              {/* Edge label */}
              {edge.label && (
                <>
                  <rect
                    x={mx - 12}
                    y={my - 10}
                    width={24}
                    height={20}
                    rx={4}
                    fill="#111827"
                    stroke="#374151"
                    strokeWidth={1}
                  />
                  <text
                    x={mx}
                    y={my + 4}
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize="11"
                    fontWeight={500}
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {edge.label}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {data.nodes.map((node, idx) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const color = getNodeColor(idx);
          const isHovered = hoveredNode === node.id;
          const isSelected = selectedNodes.has(node.id);
          const connected = isConnected(node.id);
          const shouldGlow = isHovered || isSelected;

          return (
            <g
              key={node.id}
              style={{ cursor: "pointer", transition: "all 0.25s ease" }}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => toggleSelect(node.id)}
            >
              {/* Glow ring for selected */}
              {isSelected && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={nodeRadius + 6}
                  fill="none"
                  stroke={color.ring}
                  strokeWidth={2}
                  opacity={0.6}
                />
              )}
              {/* Node circle */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius}
                fill={color.fill}
                filter={shouldGlow ? `url(#glow-${idx})` : undefined}
                opacity={hoveredNode && !connected ? 0.35 : 1}
                style={{ transition: "all 0.25s ease", transformOrigin: `${pos.x}px ${pos.y}px` }}
                transform={shouldGlow ? `scale(1.12)` : "scale(1)"}
              />
              {/* Node label */}
              <text
                x={pos.x}
                y={pos.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffffff"
                fontSize="13"
                fontWeight={700}
                fontFamily="Inter, system-ui, sans-serif"
                opacity={hoveredNode && !connected ? 0.35 : 1}
                style={{ transition: "opacity 0.25s ease", pointerEvents: "none" }}
              >
                {node.label || node.id}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend / Info */}
      <p style={{ color: "#4b5563", fontSize: "11px", marginTop: "16px", fontStyle: "italic", textAlign: "center" }}>
        {data.nodes.length} nodes · {data.edges.length} edges · Hover to trace connections · Click to select
      </p>
    </div>
  );
}
