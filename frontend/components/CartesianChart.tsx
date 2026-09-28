'use client';
import React, { useEffect, useRef, useState } from 'react';
import type { ChartData } from './ChartViewer';
import { chartNumber, chartColor, chartValueLabel, linearScale } from '../lib/chart-data';

function AxisLabel({ label, x, y }: { label: string; x: number; y: number }) {
  const words = label.split(/\s+/); const lines: string[] = []; let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > 16) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return <text x={x} y={y} textAnchor="middle" fill="var(--chart-muted)" fontSize={12}>
    <title>{label}</title>{lines.map((text, index) => <tspan key={index} x={x} dy={index ? 14 : 0}>{text}</tspan>)}
  </text>;
}

export default function CartesianChart({ data }: { data: ChartData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(640);
  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setCanvasWidth(Math.max(300, Math.round(measured)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const horizontal = data.type === 'horizontal-bar';
  const stacked = data.type === 'stacked-bar';
  const scatter = data.type === 'scatter';
  const line = data.type === 'line' || data.type === 'area';
  const bars = (data.bars || []).flatMap(bar => { const value = chartNumber(bar.value); return value === null ? [] : [{ ...bar, value }]; });
  const categories = stacked ? (data.stackedBars || []).map(bar => bar.label) : line ? (data.points || []).map(point => point.label) : bars.map(bar => bar.label);
  const series = line ? data.series?.length ? data.series : [{ name: data.title, values: (data.points || []).map(point => point.value) }] : [];
  const values = scatter ? (data.scatterPoints || []).map(point => point.y) : line ? series.flatMap(item => item.values)
    : stacked ? (data.stackedBars || []).flatMap(bar => [bar.segments.reduce((sum, item) => sum + Math.max(item.value, 0), 0), bar.segments.reduce((sum, item) => sum + Math.min(item.value, 0), 0)]) : bars.map(bar => bar.value);
  const scale = linearScale(values, { includeZero: !line && !scatter, ticks: data.yTicks });
  const numericX = scatter ? (data.scatterPoints || []).map(point => point.x) : line && data.points?.every(point => Number.isFinite(point.x)) ? data.points.map(point => point.x!) : null;
  const xScale = numericX ? linearScale(numericX) : null;
  const crowded = !horizontal && categories.length > 12;
  const width = crowded ? Math.max(canvasWidth, categories.length * 48 + 102) : canvasWidth;
  const height = horizontal ? Math.max(320, categories.length * 42 + 100) : 380;
  const left = horizontal ? 145 : 78, top = 28, right = 24, bottom = horizontal ? 70 : 95;
  const plotW = width - left - right, plotH = height - top - bottom;
  const y = (value: number) => top + plotH - scale.position(value, plotH);
  const x = (value: number) => left + scale.position(value, plotW);
  const categoryX = (index: number) => left + (index + 0.5) / Math.max(categories.length, 1) * plotW;
  const pointX = (index: number) => xScale && numericX ? left + xScale.position(numericX[index], plotW)
    : categories.length > 1 ? left + index / (categories.length - 1) * plotW : left + plotW / 2;
  const baseline = horizontal ? x(0) : y(0);
  const barW = Math.min(46, plotW / Math.max(categories.length, 1) * 0.55);
  const axisColor = 'var(--chart-muted)', grid = 'var(--chart-grid)';
  return (
    <>
    {line && series.length > 1 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12, marginTop: 12 }}>
      {series.map((item, index) => <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: chartColor(item.color, index, data.style?.palette) }} />{item.name}
      </span>)}
    </div>}
    <svg ref={svgRef} role="img" aria-label={`${data.title}. ${data.xLabel || 'X axis'}; ${data.yLabel || 'Y axis'}.`}
      viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', minWidth: crowded ? width : undefined, height: 'auto', overflow: 'visible' }}>
      <desc>{scatter ? data.scatterPoints?.map(point => `${point.label || 'Point'}: x ${point.x}, y ${point.y}`).join('; ')
        : categories.map((label, index) => `${label}: ${line ? series.map(item => `${item.name} ${item.values[index]}`).join(', ') : stacked ? data.stackedBars![index].segments.map(item => `${item.label} ${item.value}`).join(', ') : bars[index]?.value}`).join('; ')}</desc>
      {scale.ticks.map(tick => <g key={tick.value} data-axis-value={tick.value}>
        {horizontal ? <><line x1={x(tick.value)} x2={x(tick.value)} y1={top} y2={top + plotH} stroke={grid} />
          <text x={x(tick.value)} y={top + plotH + 22} textAnchor="middle" fontSize={12} fill={axisColor}>{tick.label}</text></>
          : <><line x1={left} x2={left + plotW} y1={y(tick.value)} y2={y(tick.value)} stroke={grid} />
            <text x={left - 12} y={y(tick.value)} dy="0.35em" textAnchor="end" fontSize={12} fill={axisColor}>{tick.label}</text></>}
      </g>)}
      {!line && !scatter && <line x1={horizontal ? baseline : left} x2={horizontal ? baseline : left + plotW}
        y1={horizontal ? top : baseline} y2={horizontal ? top + plotH : baseline} stroke={axisColor} />}
      {!line && !scatter && !stacked && bars.map((bar, index) => {
        const centerY = top + (index + 0.5) / bars.length * plotH;
        const valuePosition = horizontal ? x(bar.value) : y(bar.value);
        return <g key={index}>
          <rect data-chart-mark="bar" data-value={bar.value} x={horizontal ? Math.min(baseline, valuePosition) : categoryX(index) - barW / 2}
            y={horizontal ? centerY - 12 : Math.min(baseline, valuePosition)} width={horizontal ? Math.abs(valuePosition - baseline) : barW}
            height={horizontal ? 24 : Math.abs(valuePosition - baseline)} rx={data.style?.roundedBars === false ? 0 : 3} fill={chartColor(bar.color, index, data.style?.palette)}>
            <title>{`${bar.label}: ${bar.value}${data.unit ? ` ${data.unit}` : ''}`}</title>
          </rect>
          {horizontal ? <text x={left - 10} y={centerY} dy="0.35em" textAnchor="end" fontSize={12} fill={axisColor}><title>{bar.label}</title>{bar.label}</text>
            : <AxisLabel label={bar.label} x={categoryX(index)} y={top + plotH + 22} />}
          {data.style?.showValues !== false && <text x={horizontal ? valuePosition + (bar.value < 0 ? -7 : 7) : categoryX(index)}
            y={horizontal ? centerY : valuePosition + (bar.value < 0 ? 17 : -8)} dy={horizontal ? '0.35em' : undefined}
            textAnchor={horizontal ? bar.value < 0 ? 'end' : 'start' : 'middle'} fontSize={12} fill="currentColor">{chartValueLabel(bar.value)}</text>}
        </g>;
      })}
      {stacked && data.stackedBars?.map((bar, index) => {
        let positive = 0, negative = 0;
        return <g key={index}>{bar.segments.map((segment, segmentIndex) => {
          const start = segment.value >= 0 ? positive : negative, end = start + segment.value;
          if (segment.value >= 0) positive = end; else negative = end;
          return <rect key={segmentIndex} data-chart-mark="stack" data-value={segment.value} x={categoryX(index) - barW / 2}
            y={Math.min(y(start), y(end))} width={barW} height={Math.abs(y(end) - y(start))} fill={chartColor(segment.color, segmentIndex, data.style?.palette)}>
            <title>{`${bar.label}, ${segment.label}: ${segment.value}`}</title></rect>;
        })}<AxisLabel label={bar.label} x={categoryX(index)} y={top + plotH + 22} /></g>;
      })}
      {line && series.map((item, seriesIndex) => {
        const path = item.values.map((value, index) => `${index ? 'L' : 'M'} ${pointX(index)} ${y(value)}`).join(' ');
        const color = chartColor(item.color, seriesIndex, data.style?.palette);
        const areaBaseline = y(Math.max(scale.min, Math.min(0, scale.max)));
        return <g key={seriesIndex}>
          {data.type === 'area' && <path d={`${path} L ${pointX(item.values.length - 1)} ${areaBaseline} L ${pointX(0)} ${areaBaseline} Z`} fill={color} opacity={0.15} />}
          <path d={path} stroke={color} strokeWidth={Math.min(data.style?.lineWidth || 2.5, 8)} fill="none" strokeLinejoin="round" />
          {item.values.map((value, index) => <circle key={index} data-chart-mark="point" data-value={value} data-x={numericX?.[index] ?? index}
            cx={pointX(index)} cy={y(value)} r={Math.min(data.style?.pointSize || 4, 16)} fill={color}><title>{`${item.name}, ${categories[index]}: ${value}`}</title></circle>)}
        </g>;
      })}
      {line && categories.map((label, index) => <AxisLabel key={index} label={label} x={pointX(index)} y={top + plotH + 22} />)}
      {scatter && data.scatterPoints?.map((point, index) => <circle key={index} data-chart-mark="scatter" data-x={point.x} data-y={point.y}
        cx={left + xScale!.position(point.x, plotW)} cy={y(point.y)} r={Math.min(data.style?.pointSize || 5, 16)} fill={chartColor(point.color, 0, data.style?.palette)}>
        <title>{`${point.label || 'Point'}: (${point.x}, ${point.y})`}</title></circle>)}
      {scatter && xScale?.ticks.map(tick => <g key={tick.value}><line x1={left + xScale.position(tick.value, plotW)} x2={left + xScale.position(tick.value, plotW)} y1={top} y2={top + plotH} stroke={grid} opacity={0.45} />
        <text x={left + xScale.position(tick.value, plotW)} y={top + plotH + 22} textAnchor="middle" fontSize={12} fill={axisColor}>{tick.label}</text></g>)}
      {data.xLabel && <text x={left + plotW / 2} y={height - 12} textAnchor="middle" fontSize={13} fill="currentColor">{data.xLabel}</text>}
      {data.yLabel && <text transform={`translate(17 ${top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={13} fill="currentColor">{data.yLabel}</text>}
    </svg>
    </>
  );
}
