import fs from "fs";
import path from "path";
import { PosterLayoutJSON, LayoutSection } from "./llm_router";

export interface RenderResult {
  pngPath: string;
  pdfPath: string;
  pngUrl: string;
  pdfUrl: string;
}

export interface PosterMediaAsset {
  dataUrl: string;
  sourceUrl?: string;
  caption?: string;
  attribution?: string;
}

function escapeXml(value: unknown): string {
  return typeof value === "string" ? value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : "";
}

function wrapText(value: string, maxChars: number, maxLines = 8): string[] {
  const words = (value || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length <= maxChars) line = `${line} ${word}`.trim();
    else { if (line) lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function textBlock(lines: string[], x: number, y: number, options: { size: number; color: string; weight?: number; lineHeight?: number; family?: string; anchor?: string }) {
  const lineHeight = options.lineHeight || options.size * 1.35;
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${options.color}" font-family="${options.family || "Arial, sans-serif"}" font-size="${options.size}" font-weight="${options.weight || 400}" text-anchor="${options.anchor || "start"}">${escapeXml(line)}</text>`).join("\n");
}

function imageUrl(layout: PosterLayoutJSON) {
  if (!layout.imagePrompt || layout.visualRole === "none" || layout.visualRole === "typography" || layout.visualRole === "timeline") return null;
  let hash = 0;
  for (let index = 0; index < layout.imagePrompt.length; index += 1) hash = ((hash << 5) - hash + layout.imagePrompt.charCodeAt(index)) | 0;
  const prompt = `${layout.imagePrompt}, exact subject, editorial art direction, no text, no watermark, no generic stock image`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1000&height=1200&nologo=true&model=flux&seed=${Math.abs(hash)}`;
}

function renderMetrics(section: LayoutSection, x: number, y: number, width: number, layout: PosterLayoutJSON) {
  const metrics = section.metrics?.slice(0, 4) || [];
  const columnWidth = width / Math.max(1, metrics.length);
  return metrics.map((metric, index) => {
    const metricX = x + index * columnWidth;
    return `<g transform="translate(${metricX}, ${y})">
      <line x1="0" y1="0" x2="${columnWidth - 24}" y2="0" stroke="${index === metrics.length - 1 ? layout.palette.accent : layout.palette.primary}" stroke-width="5"/>
      ${textBlock(wrapText(metric.value, 14, 2), 0, 48, { size: 34, color: layout.palette.text, weight: 800, lineHeight: 38 })}
      ${textBlock(wrapText(metric.label, 24, 2), 0, 88, { size: 14, color: layout.palette.muted, lineHeight: 19 })}
    </g>`;
  }).join("\n");
}

function renderSection(section: LayoutSection, x: number, y: number, width: number, layout: PosterLayoutJSON) {
  const bodyLines = wrapText(section.bodyText || "", Math.max(28, Math.floor(width / 14)), 6);
  let contentY = y + 58;
  let content = `<text x="${x}" y="${y}" fill="${layout.palette.primary}" font-family="Arial, sans-serif" font-size="22" font-weight="800">${escapeXml(section.title)}</text>
  <line x1="${x}" y1="${y + 16}" x2="${x + width}" y2="${y + 16}" stroke="${layout.palette.text}" stroke-opacity="0.18"/>`;
  if (section.metrics?.length) return `${content}${renderMetrics(section, x, contentY, width, layout)}`;
  if (section.timeline?.length) {
    content += `<line x1="${x + 13}" y1="${contentY}" x2="${x + 13}" y2="${contentY + section.timeline.length * 105}" stroke="${layout.palette.primary}" stroke-width="3"/>`;
    section.timeline.slice(0, 6).forEach((item, index) => {
      const itemY = contentY + index * 105;
      content += `<circle cx="${x + 13}" cy="${itemY + 10}" r="10" fill="${layout.palette.background}" stroke="${layout.palette.accent}" stroke-width="5"/>
      ${textBlock(wrapText(item.title, Math.floor(width / 15), 2), x + 42, itemY + 8, { size: 18, color: layout.palette.text, weight: 700, lineHeight: 22 })}
      ${textBlock(wrapText(item.description || "", Math.floor(width / 13), 2), x + 42, itemY + 54, { size: 13, color: layout.palette.muted, lineHeight: 18 })}`;
    });
    return content;
  }
  if (bodyLines.length) {
    content += textBlock(bodyLines, x, contentY, { size: 19, color: layout.palette.muted, lineHeight: 29 });
    contentY += bodyLines.length * 29 + 25;
  }
  (section.bullets || []).slice(0, 5).forEach((bullet) => {
    const lines = wrapText(bullet, Math.max(26, Math.floor(width / 13)), 3);
    content += `<rect x="${x}" y="${contentY - 9}" width="10" height="10" fill="${layout.palette.accent}"/>${textBlock(lines, x + 30, contentY, { size: 18, color: layout.palette.text, lineHeight: 26 })}`;
    contentY += lines.length * 26 + 22;
  });
  return content;
}

function editorialSvg(layout: PosterLayoutJSON, width: number, height: number) {
  const sections = layout.sections.slice(0, 4);
  const titleLines = wrapText(layout.title.toUpperCase(), 25, 4);
  const longestTitleLine = Math.max(1, ...titleLines.map((line) => line.length));
  const titleSize = Math.max(48, Math.min(76, 1_250 / longestTitleLine));
  const titleLineHeight = titleSize + 5;
  const sectionStartY = 720;
  const sectionPositions = [
    { x: 78, y: sectionStartY },
    { x: 646, y: sectionStartY },
    { x: 78, y: 1_115 },
    { x: 646, y: 1_115 },
  ];
  const sectionWidth = 476;
  return `
  <rect width="${width}" height="${height}" fill="${layout.palette.background}"/>
  <rect x="0" y="0" width="${width}" height="620" fill="${layout.palette.primary}"/>
  <rect x="0" y="0" width="${width}" height="18" fill="${layout.palette.accent}"/>
  <circle cx="1035" cy="130" r="250" fill="${layout.palette.secondary}" opacity="0.30"/>
  <circle cx="1035" cy="130" r="172" fill="none" stroke="${layout.palette.accent}" stroke-width="28" opacity="0.72"/>
  <circle cx="1035" cy="130" r="92" fill="${layout.palette.surface}" opacity="0.12"/>
  <path d="M 760 620 L 1200 285 L 1200 620 Z" fill="${layout.palette.surface}" opacity="0.09"/>
  <path d="M 865 620 L 1200 422 L 1200 620 Z" fill="${layout.palette.accent}" opacity="0.16"/>
  <text x="78" y="92" fill="${layout.palette.accent}" font-family="Arial, sans-serif" font-size="17" font-weight="800" letter-spacing="4">${escapeXml(layout.format.replace(/-/g, " ").toUpperCase())}</text>
  ${textBlock(titleLines, 78, 190, { size: titleSize, color: layout.palette.surface, weight: 900, lineHeight: titleLineHeight, family: "Georgia, serif" })}
  ${textBlock(wrapText(layout.subtitle || layout.keyMessage || "", 67, 4), 78, Math.min(500, 218 + titleLines.length * titleLineHeight), { size: 22, color: layout.palette.surface, lineHeight: 31 })}
  <line x1="78" y1="665" x2="1122" y2="665" stroke="${layout.palette.text}" stroke-opacity="0.20" stroke-width="2"/>
  ${sections.map((section, index) => {
    const position = sectionPositions[index];
    return `<g>
      <text x="${position.x}" y="${position.y - 42}" fill="${layout.palette.accent}" font-family="Arial, sans-serif" font-size="13" font-weight="800" letter-spacing="3">0${index + 1}</text>
      ${renderSection(section, position.x, position.y, sectionWidth, layout)}
    </g>`;
  }).join("\n")}
  <rect x="78" y="${height - 238}" width="1044" height="142" rx="4" fill="${layout.palette.primary}"/>
  <rect x="78" y="${height - 238}" width="13" height="142" fill="${layout.palette.accent}"/>
  ${textBlock(wrapText(layout.keyMessage || layout.subtitle || layout.title, 73, 3), 126, height - 178, { size: 25, color: layout.palette.surface, weight: 800, lineHeight: 32, family: "Georgia, serif" })}
  <text x="78" y="${height - 49}" fill="${layout.palette.muted}" font-family="Arial, sans-serif" font-size="13">${escapeXml([layout.authors, layout.institution].filter(Boolean).join(" · "))}</text>
  <text x="1122" y="${height - 49}" text-anchor="end" fill="${layout.palette.muted}" font-family="Arial, sans-serif" font-size="13">EDITABLE POSTER · VOID</text>`;
}

function researchSvg(layout: PosterLayoutJSON, width: number, height: number) {
  const sections = layout.sections.slice(0, 5);
  const metricSection = sections.find((section) => section.metrics?.length);
  const timelineSection = sections.find((section) => section.timeline?.length || section.type === "timeline");
  const bodySections = sections.filter((section) => section !== metricSection && section !== timelineSection);
  const titleLines = wrapText(layout.title, 38, 3);
  return `
  <rect width="${width}" height="${height}" fill="${layout.palette.background}"/>
  <rect x="0" y="0" width="${width}" height="390" fill="${layout.palette.primary}"/>
  <rect x="0" y="0" width="${width}" height="18" fill="${layout.palette.accent}"/>
  <text x="75" y="82" fill="${layout.palette.accent}" font-family="Arial, sans-serif" font-size="16" font-weight="800" letter-spacing="3">${escapeXml(layout.format.replace(/-/g, " ").toUpperCase())}</text>
  ${textBlock(titleLines, 75, 165, { size: 54, color: layout.palette.surface, weight: 900, lineHeight: 58, family: "Georgia, serif" })}
  ${textBlock(wrapText(layout.subtitle || "", 72, 3), 75, 190 + titleLines.length * 58, { size: 18, color: layout.palette.surface, lineHeight: 26 })}
  ${metricSection ? renderMetrics(metricSection, 75, 440, width - 150, layout) : ""}
  ${bodySections.slice(0, 2).map((section, index) => renderSection(section, 75 + index * 545, metricSection ? 650 : 470, 480, layout)).join("\n")}
  ${timelineSection ? renderSection(timelineSection, 75, 1190, width - 150, layout) : bodySections.slice(2, 4).map((section, index) => renderSection(section, 75 + index * 545, 1190, 480, layout)).join("\n")}
  <line x1="75" y1="${height - 85}" x2="${width - 75}" y2="${height - 85}" stroke="${layout.palette.text}" stroke-opacity="0.18"/>
  <text x="75" y="${height - 48}" fill="${layout.palette.muted}" font-family="Arial, sans-serif" font-size="13">${escapeXml([layout.authors, layout.institution].filter(Boolean).join(" · "))}</text>
  <text x="${width - 75}" y="${height - 48}" text-anchor="end" fill="${layout.palette.muted}" font-family="Arial, sans-serif" font-size="13">${escapeXml((layout.sources || []).slice(0, 2).join(" · "))}</text>`;
}

function timelineSvg(layout: PosterLayoutJSON, width: number, height: number) {
  const items = layout.sections.flatMap((section) => section.timeline || (section.bullets || []).map((bullet, index) => ({ step: String(index + 1), title: bullet, description: "" }))).slice(0, 8);
  const titleLines = wrapText(layout.title, 28, 3);
  return `
  <rect width="${width}" height="${height}" fill="${layout.palette.background}"/>
  <rect x="70" y="0" width="10" height="${height}" fill="${layout.palette.accent}"/>
  <text x="130" y="100" fill="${layout.palette.primary}" font-family="Arial, sans-serif" font-size="16" font-weight="800" letter-spacing="3">VISUAL CHRONOLOGY</text>
  ${textBlock(titleLines, 130, 185, { size: 58, color: layout.palette.text, weight: 900, lineHeight: 61, family: "Georgia, serif" })}
  ${textBlock(wrapText(layout.subtitle || layout.keyMessage || "", 62, 3), 130, 220 + titleLines.length * 61, { size: 18, color: layout.palette.muted, lineHeight: 26 })}
  <line x1="190" y1="520" x2="190" y2="${height - 150}" stroke="${layout.palette.primary}" stroke-width="4"/>
  ${items.map((item, index) => {
    const y = 540 + index * Math.min(145, (height - 760) / Math.max(1, items.length - 1));
    return `<circle cx="190" cy="${y}" r="16" fill="${layout.palette.background}" stroke="${index === items.length - 1 ? layout.palette.accent : layout.palette.primary}" stroke-width="7"/>
      <text x="240" y="${y - 4}" fill="${layout.palette.primary}" font-family="Arial, sans-serif" font-size="14" font-weight="800">${escapeXml(item.step || String(index + 1))}</text>
      ${textBlock(wrapText(item.title, 56, 2), 330, y - 4, { size: 20, color: layout.palette.text, weight: 700, lineHeight: 24 })}
      ${textBlock(wrapText(item.description || "", 64, 2), 330, y + 46, { size: 14, color: layout.palette.muted, lineHeight: 19 })}`;
  }).join("\n")}`;
}

function renderNativeChart(section: LayoutSection, x: number, y: number, width: number, height: number, layout: PosterLayoutJSON) {
  const chart = section.chart;
  const data = chart?.data.filter((point) => Number.isFinite(point.value)) || [];
  if (data.length < 2) return "";
  const min = Math.min(0, ...data.map((point) => point.value));
  const max = Math.max(0, ...data.map((point) => point.value));
  const range = max - min || 1;
  const left = x + 70;
  const plotTop = y + 30;
  const labelLines = data.map((point) => wrapText(point.label, Math.max(8, Math.floor((width - 70) / data.length / 11)), 20));
  const plotBottom = y + height - Math.max(...labelLines.map((lines) => lines.length)) * 22 - 25;
  const plotHeight = Math.max(100, plotBottom - plotTop);
  const slot = (width - 80) / data.length;
  const yFor = (value: number) => plotBottom - ((value - min) / range) * plotHeight;
  const zeroY = yFor(0);
  const valueLabel = (value: number) => String(Number(value.toPrecision(6))) + (chart?.unit ? " " + chart.unit : "");
  const ticks = [0, .25, .5, .75, 1].map((ratio) => {
    const value = min + range * ratio;
    const tickY = yFor(value);
    return '<line x1="' + left + '" y1="' + tickY + '" x2="' + (x + width) + '" y2="' + tickY + '" stroke="' + layout.palette.text + '" stroke-opacity=".12"/>'
      + textBlock([valueLabel(value)], left - 12, tickY + 5, { size: 15, color: layout.palette.muted, anchor: "end" });
  }).join("");
  const points = data.map((point, index) => ({ ...point, x: left + slot * (index + .5), y: yFor(point.value) }));
  const marks = chart?.type === "line"
    ? '<polyline points="' + points.map((point) => point.x + "," + point.y).join(" ") + '" fill="none" stroke="' + layout.palette.primary + '" stroke-width="4"/>'
      + points.map((point) => '<circle cx="' + point.x + '" cy="' + point.y + '" r="6" fill="' + layout.palette.primary + '"/>').join("")
    : points.map((point, index) => {
      const barWidth = Math.min(65, slot * .65);
      return '<rect data-value="' + point.value + '" x="' + (point.x - barWidth / 2) + '" y="' + Math.min(point.y, zeroY) + '" width="' + barWidth + '" height="' + Math.abs(point.y - zeroY) + '" rx="3" fill="' + (index % 2 ? layout.palette.secondary : layout.palette.primary) + '"/>';
    }).join("");
  return ticks + '<line x1="' + left + '" y1="' + zeroY + '" x2="' + (x + width) + '" y2="' + zeroY + '" stroke="' + layout.palette.text + '" stroke-opacity=".5"/>'
    + marks + points.map((point, index) => textBlock([valueLabel(point.value)], point.x, point.y + (point.value < 0 ? 22 : -12), { size: 18, color: layout.palette.text, weight: 700, anchor: "middle" })
      + textBlock(labelLines[index], point.x, plotBottom + 30, { size: 18, color: layout.palette.muted, anchor: "middle", lineHeight: 22 })).join("");
}

function sectionHeight(section: LayoutSection, width: number): number {
  const chars = Math.max(20, Math.floor((width - 65) / 12));
  const headingHeight = wrapText(section.title, Math.floor((width - 100) / 15), 20).length * 31 + 45;
  if (section.chart?.data?.length) return headingHeight + 350 + Math.max(...section.chart.data.map((point) => wrapText(point.label, 12, 20).length)) * 22;
  if (section.timeline?.length) return headingHeight + section.timeline.reduce((height, item) =>
    height + wrapText([item.step, item.title].filter(Boolean).join(" · "), chars, 30).length * 29
      + wrapText(item.description || "", chars, 30).length * 27 + 24, 0) + 24;
  return Math.max(240, headingHeight + wrapText(section.bodyText || "", chars, 100).length * 30
    + (section.bullets || []).reduce((height, bullet) => height + wrapText(bullet, chars - 2, 100).length * 30 + 16, 0)
    + (section.metrics?.length ? 140 : 0) + 45);
}

function infographicPanel(section: LayoutSection, index: number, x: number, y: number, width: number, height: number, layout: PosterLayoutJSON) {
  const chars = Math.max(20, Math.floor((width - 65) / 12));
  const titles = wrapText(section.title, Math.floor((width - 100) / 15), 20);
  let cursor = y + titles.length * 31 + 60;
  let details = textBlock(titles, x + 64, y + 38, { size: 25, color: layout.palette.text, weight: 800, lineHeight: 31 });
  if (section.chart?.data?.length) {
    details += renderNativeChart(section, x + 25, cursor, width - 50, height - (cursor - y) - 30, layout);
  } else if (section.timeline?.length) {
    section.timeline.forEach((item, itemIndex) => {
      const title = [item.step && !item.title.toLowerCase().startsWith(item.step.toLowerCase()) ? item.step : "", item.title].filter(Boolean).join(" · ");
      const lines = wrapText(title, chars, 30);
      const description = wrapText(item.description || "", chars, 30);
      details += '<circle cx="' + (x + 32) + '" cy="' + (cursor - 7) + '" r="7" fill="' + layout.palette.primary + '"/>'
        + textBlock(lines, x + 55, cursor, { size: 23, color: layout.palette.text, weight: 700, lineHeight: 29 });
      cursor += lines.length * 29;
      details += textBlock(description, x + 55, cursor, { size: 21, color: layout.palette.muted, lineHeight: 27 });
      cursor += description.length * 27 + 24;
      if (itemIndex < section.timeline!.length - 1) details += '<line x1="' + (x + 32) + '" y1="' + (cursor - 35) + '" x2="' + (x + 32) + '" y2="' + (cursor - 18) + '" stroke="' + layout.palette.primary + '"/>';
    });
  } else {
    const body = wrapText(section.bodyText || "", chars, 100);
    details += textBlock(body, x + 30, cursor, { size: 23, color: layout.palette.muted, lineHeight: 30 });
    cursor += body.length * 30 + (body.length ? 16 : 0);
    for (const bullet of section.bullets || []) {
      const lines = wrapText(bullet, chars - 2, 100);
      details += '<circle cx="' + (x + 32) + '" cy="' + (cursor - 7) + '" r="4" fill="' + layout.palette.primary + '"/>'
        + textBlock(lines, x + 48, cursor, { size: 23, color: layout.palette.text, lineHeight: 30 });
      cursor += lines.length * 30 + 16;
    }
    if (section.metrics?.length) details += renderMetrics(section, x + 30, cursor, width - 60, layout);
  }
  return '<g><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="18" fill="' + layout.palette.surface + '"/>'
    + textBlock([String(index + 1).padStart(2, "0")], x + 25, y + 38, { size: 20, color: layout.palette.primary, weight: 800 })
    + details + '</g>';
}

function infographicGeometry(layout: PosterLayoutJSON, width: number, media: PosterMediaAsset[]) {
  const margin = 48, gap = 22, full = width - margin * 2, half = (full - gap) / 2;
  const titleLines = wrapText(layout.title, Math.floor(full / 31), 20);
  const subtitleLines = wrapText(layout.subtitle || layout.keyMessage || "", Math.floor(full / 13), 20);
  const headerHeight = 95 + titleLines.length * 62 + subtitleLines.length * 29 + 35;
  const placements: Array<{ section: LayoutSection; x: number; y: number; width: number; height: number }> = [];
  let y = headerHeight + 28 + (media.length ? 260 : 0);
  for (let i = 0; i < layout.sections.length;) {
    const section = layout.sections[i];
    const wide = i === 0 || !!section.chart || !!section.timeline?.length;
    const next = layout.sections[i + 1];
    if (wide || !next || next.chart || next.timeline?.length) {
      const height = sectionHeight(section, full);
      placements.push({ section, x: margin, y, width: full, height });
      y += height + gap; i++;
    } else {
      const height = Math.max(sectionHeight(section, half), sectionHeight(next, half));
      placements.push({ section, x: margin, y, width: half, height }, { section: next, x: margin + half + gap, y, width: half, height });
      y += height + gap; i += 2;
    }
  }
  return { titleLines, subtitleLines, headerHeight, placements, height: y + 85, margin, full };
}

function infographicSvg(layout: PosterLayoutJSON, width: number, height: number, media: PosterMediaAsset[] = []) {
  const geometry = infographicGeometry(layout, width, media);
  const { margin, full, headerHeight, titleLines, subtitleLines, placements } = geometry;
  const imageWidth = (full - 20 * (media.length - 1)) / Math.max(1, media.length);
  return '<rect width="' + width + '" height="' + height + '" fill="' + layout.palette.background + '"/>'
    + '<rect width="' + width + '" height="' + headerHeight + '" fill="' + layout.palette.primary + '"/>'
    + textBlock(["VISUAL ANALYSIS"], margin, 55, { size: 17, color: layout.palette.surface, weight: 800 })
    + textBlock(titleLines, margin, 120, { size: 54, color: layout.palette.surface, weight: 900, lineHeight: 62 })
    + textBlock(subtitleLines, margin, 138 + titleLines.length * 62, { size: 23, color: layout.palette.surface, lineHeight: 29 })
    + media.map((image, index) => '<a href="' + escapeXml(image.sourceUrl || "") + '"><image href="' + escapeXml(image.dataUrl) + '" x="' + (margin + index * (imageWidth + 20)) + '" y="' + (headerHeight + 24) + '" width="' + imageWidth + '" height="230" preserveAspectRatio="xMidYMid meet"><title>' + escapeXml(image.caption || "Sourced subject image") + '</title></image></a>').join("")
    + placements.map((item, index) => infographicPanel(item.section, index, item.x, item.y, item.width, item.height, layout)).join("")
    + textBlock(["Sources: " + (media.map((item) => item.attribution || item.sourceUrl).filter(Boolean).join(" · ") || (layout.sources || []).join(" · ") || "User brief and general background; no measured data implied.")], margin, height - 38, { size: 14, color: layout.palette.muted });
}

export function renderPosterSvg(layout: PosterLayoutJSON, width = 1200, height = 1697, media?: PosterMediaAsset | PosterMediaAsset[]): string {
  const images = (Array.isArray(media) ? media : media ? [media] : []).slice(0, 3);
  if (layout.format === 'infographic') height = infographicGeometry(layout, width, images).height;
  const content = layout.format === "infographic"
    ? infographicSvg(layout, width, height, images)
    : layout.composition === "research-figure"
      ? researchSvg(layout, width, height)
      : layout.composition === "timeline-story"
        ? timelineSvg(layout, width, height)
        : editorialSvg(layout, width, height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><clipPath id="visualClip"><rect width="${width * 0.38}" height="${height}"/></clipPath></defs>${content}</svg>`;
}

export async function renderPosterAsset(layout: PosterLayoutJSON, media?: PosterMediaAsset | PosterMediaAsset[]): Promise<RenderResult> {
  const width = 1200;
  const height = 1697;
  const svg = renderPosterSvg(layout, width, height, media);

  const outputDir = path.join(process.cwd(), "public", "generated_posters");
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = Date.now();
  const svgPath = path.join(outputDir, `poster_${timestamp}.svg`);
  const pdfPath = path.join(outputDir, `poster_${timestamp}.pdf`);
  fs.writeFileSync(svgPath, svg, "utf8");

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const palette = layout.palette;
  const background = (() => { const value = palette.background.replace("#", ""); return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)] as [number, number, number]; })();
  const primary = (() => { const value = palette.primary.replace("#", ""); return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)] as [number, number, number]; })();
  doc.setFillColor(...background); doc.rect(0, 0, 595, 842, "F");
  doc.setFillColor(...primary); doc.rect(0, 0, 595, 145, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.text(doc.splitTextToSize(layout.title, 500), 40, 55);
  if (layout.subtitle) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(doc.splitTextToSize(layout.subtitle, 500), 40, 110); }
  let y = 180;
  layout.sections.slice(0, 5).forEach((section) => {
    if (y > 760) return;
    doc.setTextColor(...primary); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(section.title, 40, y); y += 18;
    doc.setTextColor(45, 45, 45); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const lines = [section.bodyText, ...(section.bullets || [])].filter(Boolean).flatMap((item) => doc.splitTextToSize(String(item), 500)).slice(0, 12);
    doc.text(lines, 40, y); y += lines.length * 12 + 26;
  });
  fs.writeFileSync(pdfPath, Buffer.from(doc.output("arraybuffer")));

  return { pngPath: svgPath, pdfPath, pngUrl: `/generated_posters/poster_${timestamp}.svg`, pdfUrl: `/generated_posters/poster_${timestamp}.pdf` };
}
