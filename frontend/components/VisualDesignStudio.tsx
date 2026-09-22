"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Image as ImageIcon,
  LayoutTemplate,
  Lock,
  Maximize2,
  Move,
  Palette,
  Pencil,
  Redo2,
  Send,
  Sparkles,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import pptxgen from "pptxgenjs";
import type { DesignPalette, DesignStyle, PresentationData, Slide, SlideElementKind, SlideElementStyle } from "@/types/presentation";
import { EditableElement, elementId, type CanvasEditor } from "@/components/visual-editor/EditableElement";
import { NativeDesignFigure } from "@/components/visual-editor/NativeDesignFigure";
import { headingSize, pagePalette, readableInk, styleTypography } from "@/lib/design/visual-theme";
import { attachGeneratedImage, plannedImageRequests, requestDesignImage } from "@/lib/design/design-image-client";
import { prepareHtml2CanvasClone } from "@/lib/html2canvas-safe";
import {
  DESIGN_STYLES,
  imageUrlFor,
  normalizePresentation,
  regenerateSlideImage,
  regenerateSlideLayout,
  scoreDesign,
  withDesignStyle,
} from "@/lib/design/visual-design-engine";

type Props = { data: PresentationData; onClose?: () => void; onChange?: (data: PresentationData) => void; initialSlide?: number };

function hexToRgb(color: unknown) {
  const fallback = { r: 23, g: 23, b: 23 };
  if (typeof color !== "string") return fallback;
  const value = color.trim();
  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    return {
      r: Math.min(255, Number(rgb[1])),
      g: Math.min(255, Number(rgb[2])),
      b: Math.min(255, Number(rgb[3])),
    };
  }
  const hex = value.match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i)?.[1];
  if (!hex) return fallback;
  const expanded = hex.length === 3 ? hex.split("").map((character) => character + character).join("") : hex;
  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed)) return fallback;
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 };
}

function rgba(color: unknown, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  const safeAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function plain(value?: string) {
  return (value || "").replace(/\*\*(.*?)\*\*/g, "$1");
}

function elementParts(id: string): { kind: SlideElementKind; index?: number } | null {
  const match = id.match(/::(title|subtitle|body|bullet|image|shape|label)(?:::(\d+))?$/);
  if (!match) return null;
  return { kind: match[1] as SlideElementKind, index: match[2] === undefined ? undefined : Number(match[2]) };
}

function updateElementText(data: PresentationData, id: string, value: string): PresentationData {
  const parts = elementParts(id);
  if (!parts) return data;
  return {
    ...data,
    slides: data.slides.map((item) => {
      if (!id.startsWith(`${item.id}::`)) return item;
      if (parts.kind === "title") {
        if (item.layout === "quote" && item.content.quote) return { ...item, content: { ...item.content, quote: { ...item.content.quote, text: value } } };
        return { ...item, title: value };
      }
      if (parts.kind === "subtitle") {
        if (item.layout === "quote" && item.content.quote) return { ...item, content: { ...item.content, quote: { ...item.content.quote, author: value } } };
        return { ...item, subtitle: value };
      }
      if (parts.kind === "body") return { ...item, content: { ...item.content, bodyText: value } };
      if (parts.kind === "bullet" && parts.index !== undefined) {
        if (item.layout === "comparison" && item.content.comparison) {
          const leftCount = item.content.comparison.left.points.length;
          const onLeft = parts.index < leftCount;
          const side = onLeft ? item.content.comparison.left : item.content.comparison.right;
          const pointIndex = onLeft ? parts.index : parts.index - leftCount;
          const points = [...side.points];
          points[pointIndex] = value;
          return { ...item, content: { ...item.content, comparison: { ...item.content.comparison, [onLeft ? "left" : "right"]: { ...side, points } } } };
        }
        const bullets = [...(item.content.bullets || [])];
        bullets[parts.index] = value;
        return { ...item, content: { ...item.content, bullets } };
      }
      if (parts.kind === "label" && parts.index !== undefined) {
        const labelIndex = parts.index;
        if (item.layout === "comparison" && labelIndex < 2) {
          const existing = item.content.comparison || {
            left: { title: "Before", points: item.content.bullets?.slice(0, 3) || [] },
            right: { title: "After", points: item.content.bullets?.slice(3, 6) || [] },
          };
          const sideName = labelIndex === 0 ? "left" : "right";
          return { ...item, content: { ...item.content, comparison: { ...existing, [sideName]: { ...existing[sideName], title: value } } } };
        }
        const timeline = item.content.timeline;
        if (timeline?.length) {
          const entryIndex = Math.floor(labelIndex / 2);
          const entries = timeline.map((entry, index) => index !== entryIndex ? entry : labelIndex % 2 === 0 ? { ...entry, title: value } : { ...entry, description: value });
          return { ...item, content: { ...item.content, timeline: entries } };
        }
        const process = item.content.process;
        if (process?.length) {
          const entryIndex = Math.floor(labelIndex / 2);
          const entries = process.map((entry, index) => index !== entryIndex ? entry : labelIndex % 2 === 0 ? { ...entry, title: value } : { ...entry, description: value });
          return { ...item, content: { ...item.content, process: entries } };
        }
      }
      if (parts.kind === "image") return { ...item, imagePrompt: value, imageUrl: undefined };
      return item;
    }),
  };
}

function patchElementStyles(data: PresentationData, ids: string[], patch: Partial<SlideElementStyle>): PresentationData {
  if (!ids.length) return data;
  return {
    ...data,
    slides: data.slides.map((item) => {
      const localIds = ids.filter((id) => id.startsWith(`${item.id}::`));
      if (!localIds.length) return item;
      const elementStyles = { ...(item.elementStyles || {}) };
      localIds.forEach((id) => {
        const parts = elementParts(id);
        if (!parts) return;
        if (elementStyles[id]?.locked && patch.locked === undefined) return;
        elementStyles[id] = { ...(elementStyles[id] || {}), ...patch, kind: parts.kind };
      });
      return { ...item, elementStyles };
    }),
  };
}

function elementValue(data: PresentationData, id: string): string {
  const item = data.slides.find((candidate) => id.startsWith(`${candidate.id}::`));
  const parts = elementParts(id);
  if (!item || !parts) return "";
  if (parts.kind === "title") return item.layout === "quote" ? item.content.quote?.text || item.title : item.title;
  if (parts.kind === "subtitle") return item.layout === "quote" ? item.content.quote?.author || item.subtitle || "" : item.subtitle || "";
  if (parts.kind === "body") return item.content.bodyText || "";
  if (parts.kind === "bullet") return item.content.bullets?.[parts.index || 0] || "";
  if (parts.kind === "label" && parts.index !== undefined) {
    if (item.layout === "comparison" && parts.index < 2) return parts.index === 0 ? item.content.comparison?.left.title || "Before" : item.content.comparison?.right.title || "After";
    const entries = item.content.timeline?.length ? item.content.timeline : item.content.process || [];
    const entry = entries[Math.floor(parts.index / 2)];
    return parts.index % 2 === 0 ? entry?.title || "" : entry?.description || "";
  }
  if (parts.kind === "image") return item.imagePrompt || "";
  return "";
}

function SlideImage({ src, alt, objectPosition }: { src: string; alt: string; objectPosition?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const preserveWholeImage = /\b(?:map|diagram|chart|graph|document|newspaper|book cover|poster|infographic|screenshot|page|flag|table)\b/i.test(alt);

  if (failed) {
    return (
      <div className="flex h-full w-full items-end border border-current/20 p-[8%] text-left">
        <span className="text-[1.2cqw] leading-snug">Image unavailable · {alt}</span>
      </div>
    );
  }
  // Completed local assets and proxied remote media share a stable image URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img
    src={src}
    alt={alt}
    crossOrigin="anonymous"
    onError={() => setFailedSrc(src)}
    className={`block h-full w-full ${preserveWholeImage ? "object-contain" : "object-cover"}`}
    style={{ objectPosition: objectPosition || "center" }}
  />;
}

function PageNumber({ slide, total, palette }: { slide: Slide; total: number; palette: DesignPalette }) {
  return (
    <div className="absolute bottom-[4%] right-[4.5%] z-20 flex items-center gap-2 text-[clamp(5px,0.8cqw,12px)] font-semibold" style={{ color: palette.muted }}>
      <span className="h-px w-8" style={{ backgroundColor: palette.primary }} />
      {String(slide.slideNumber).padStart(2, "0")} / {String(total).padStart(2, "0")}
    </div>
  );
}

function BarChart({ slide, palette }: { slide: Slide; palette: DesignPalette }) {
  return <NativeDesignFigure slide={slide} palette={palette} />;
}

function Timeline({ slide, palette, horizontal = true, editor }: { slide: Slide; palette: DesignPalette; horizontal?: boolean; editor?: CanvasEditor }) {
  const items = slide.content.timeline?.length
    ? slide.content.timeline
    : (slide.content.process || []).map((item, index) => ({ step: String(index + 1), title: item.title, description: item.description || "" }));
  if (horizontal) {
    const dense = items.length > 5;
    return (
      <div className="relative grid h-full" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
        <div className="absolute left-[4%] right-[4%] top-[39%] h-[2px]" style={{ backgroundColor: palette.primary }} />
        {items.map((item, index) => (
          <div key={`${item.step}-${index}`} className="relative z-10 grid h-full min-w-0 grid-rows-[32%_14%_54%] text-center">
            <div className="flex min-w-0 items-end justify-center px-2 pb-[0.9cqw]">
              <span className={`${dense ? "text-[clamp(7px,1.05cqw,16px)]" : "text-[clamp(8px,1.25cqw,19px)]"} max-w-full whitespace-nowrap font-bold leading-none`} style={{ color: palette.primary }}>{plain(item.step || String(index + 1))}</span>
            </div>
            <div className="flex items-center justify-center">
              <span className="block aspect-square w-[clamp(10px,1.35cqw,21px)] rounded-full border-[3px]" style={{ borderColor: palette.primary, backgroundColor: palette.background }} />
            </div>
            <div className="min-w-0 px-[5%] pt-[1.1cqw]">
              <EditableElement id={elementId(slide.id, "label", index * 2)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index * 2)]} editor={editor} value={item.title} multiline={false}><h3 className={`${dense ? "text-[clamp(6px,1cqw,15px)]" : "text-[clamp(7px,1.15cqw,17px)]"} font-bold leading-tight`} style={{ color: palette.text }}>{plain(item.title)}</h3></EditableElement>
              <EditableElement id={elementId(slide.id, "label", index * 2 + 1)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index * 2 + 1)]} editor={editor} value={item.description || ""}><p className="mx-auto mt-[0.65cqw] max-w-[95%] text-[clamp(5px,0.82cqw,12px)] leading-snug" style={{ color: palette.muted }}>{plain(item.description)}</p></EditableElement>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="relative flex h-full flex-col justify-between gap-[2cqw] border-l-2 pl-[3cqw]" style={{ borderColor: palette.primary }}>
      {items.map((item, index) => (
        <div key={`${item.step}-${index}`} className="relative">
          <span className="absolute -left-[3.65cqw] top-[0.2cqw] h-[1cqw] w-[1cqw] rounded-full" style={{ backgroundColor: palette.accent }} />
          {item.step && <span className="block text-[1.35cqw] font-bold" style={{ color: palette.primary }}>{plain(item.step)}</span>}
          <EditableElement id={elementId(slide.id, "label", index * 2)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index * 2)]} editor={editor} value={item.title} multiline={false}><h3 className="text-[1.6cqw] font-bold" style={{ color: palette.text }}>{plain(item.title)}</h3></EditableElement>
          <EditableElement id={elementId(slide.id, "label", index * 2 + 1)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index * 2 + 1)]} editor={editor} value={item.description || ""}><p className="mt-[0.7cqw] text-[1.4cqw] leading-snug" style={{ color: palette.muted }}>{plain(item.description)}</p></EditableElement>
        </div>
      ))}
    </div>
  );
}

function BulletList({ slide, palette, limit = 5, editor }: { slide: Slide; palette: DesignPalette; limit?: number; editor?: CanvasEditor }) {
  const bullets = slide.content.bullets || [];
  const words = bullets.join(" ").split(/\s+/).length;
  const sparse = bullets.length > 0 && bullets.length <= 3 && words <= 45;
  return (
    <div className={sparse ? "space-y-[clamp(8px,2cqw,26px)]" : "space-y-[clamp(4px,1.4cqw,18px)]"}>
      {bullets.slice(0, limit).map((bullet, index) => (
        <div key={`${bullet}-${index}`} className="grid grid-cols-[auto_1fr] gap-4">
          <span className={sparse ? "mt-[0.45em] h-[0.75cqw] w-[0.75cqw]" : "mt-[0.45em] h-2 w-2"} style={{ backgroundColor: palette.primary }} />
          <EditableElement id={elementId(slide.id, "bullet", index)} kind="bullet" state={slide.elementStyles?.[elementId(slide.id, "bullet", index)]} editor={editor} value={bullet}>
            <p className="overflow-hidden leading-[1.35] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]" style={{ color: palette.text, fontSize: sparse ? "1.65cqw" : words > 85 || bullets.length > limit ? "1.2cqw" : "1.48cqw" }}>{plain(bullet)}</p>
          </EditableElement>
        </div>
      ))}
    </div>
  );
}

export function VisualPage({ data, slide, editor }: { data: PresentationData; slide: Slide; compact?: boolean; editor?: CanvasEditor }) {
  const plan = data.designPlan!;
  const palette = pagePalette(plan, slide);
  const fonts = styleTypography(plan.style);
  const imageUrl = imageUrlFor(data, slide);
  const total = data.slides.length;
  const isPoster = data.format !== "presentation";
  const formatLabel = typeof data.format === "string" ? data.format.replace(/-/g, " ") : "presentation";
  const titleStyle = { color: palette.text, fontFamily: fonts.display, fontSize: headingSize(slide, false, plan.density), fontWeight: fonts.weight, letterSpacing: fonts.tracking, overflowWrap: "anywhere" as const };
  const bodyStyle = { color: palette.text, fontFamily: fonts.body };
  const eyebrow = slide.sectionLabel || slide.content.kicker || (isPoster ? formatLabel : `Chapter ${String(slide.slideNumber).padStart(2, "0")}`);
  const layout = isPoster && slide.layout !== "raster-poster" ? "poster" : slide.layout;
  const authoredAspectRatio = data.canvasAspectRatio?.replace(":", " / ");

  const backgroundId = elementId(slide.id, "shape");
  const pageStyle = {
    backgroundColor: slide.elementStyles?.[backgroundId]?.color || palette.background,
    color: palette.text,
    fontFamily: fonts.body,
    aspectRatio: authoredAspectRatio || (isPoster ? (data.format === "academic-poster" ? "1 / 1.414" : "4 / 5") : "16 / 9"),
    containerType: "inline-size" as const,
    // Explicit dimensions make percentage-height image panels work in stage/export.
    width: "100%",
    lineHeight: 1.35,
  };

  if (layout === "raster-poster" && imageUrl) {
    return (
      <div className="visual-page relative isolate w-full overflow-hidden bg-black" style={pageStyle} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        <EditableElement id={elementId(slide.id, "image")} kind="image" state={slide.elementStyles?.[elementId(slide.id, "image")]} editor={editor}>
          <div className="absolute inset-0"><SlideImage src={imageUrl} alt={slide.imagePrompt || `${slide.title} generated poster`} objectPosition={slide.elementStyles?.[elementId(slide.id, "image")]?.objectPosition} /></div>
        </EditableElement>
      </div>
    );
  }

  if (["full-bleed", "hero", "section-header", "closing"].includes(layout)) {
    return (
      <div className="visual-page relative isolate w-full overflow-hidden" style={pageStyle} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        {imageUrl && <EditableElement id={elementId(slide.id, "image")} kind="image" state={slide.elementStyles?.[elementId(slide.id, "image")]} editor={editor}><div className="absolute inset-0"><SlideImage src={imageUrl} alt={slide.imagePrompt || slide.title} objectPosition={slide.elementStyles?.[elementId(slide.id, "image")]?.objectPosition} /></div></EditableElement>}
        {imageUrl ? <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.85), rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.12))" }} /> : <>
          <div className="pointer-events-none absolute right-[-10%] top-[-20%] h-[130%] w-[44%] -rotate-12" style={{ background: plan.palette.secondary, opacity: 0.32, borderRadius: fonts.motif === "orbit" ? "50%" : 0 }} />
          {fonts.motif === "grid" && <div className="pointer-events-none absolute inset-0 opacity-15" style={{ backgroundImage: `linear-gradient(${palette.text} 1px, transparent 1px), linear-gradient(90deg, ${palette.text} 1px, transparent 1px)`, backgroundSize: "6cqw 6cqw" }} />}
        </>}
        <div className="absolute inset-y-0 left-0 w-[8px]" style={{ backgroundColor: palette.accent }} />
        <div className="absolute inset-0 z-10 flex max-w-[84%] flex-col justify-center overflow-hidden p-[7%] pb-[9%]" style={{ color: imageUrl ? "#FFFFFF" : palette.text, textAlign: plan.style === "minimal" ? "center" : "left" }}>
          <span className="mb-[3%] text-[clamp(5px,0.9cqw,13px)] font-bold uppercase tracking-[0.18em]" style={{ color: palette.accent }}>{eyebrow}</span>
          <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={slide.title} multiline={false}><h1 className="leading-[1.02]" style={{ ...titleStyle, color: "inherit", fontSize: headingSize(slide, true, plan.density) }}>{plain(slide.title)}</h1></EditableElement>
          {slide.subtitle && <EditableElement id={elementId(slide.id, "subtitle")} kind="subtitle" state={slide.elementStyles?.[elementId(slide.id, "subtitle")]} editor={editor} value={slide.subtitle}><p className="mt-[4%] max-w-[90%] text-[1.8cqw] leading-snug opacity-85">{plain(slide.subtitle)}</p></EditableElement>}
          {slide.content.bodyText && <EditableElement id={elementId(slide.id, "body")} kind="body" state={slide.elementStyles?.[elementId(slide.id, "body")]} editor={editor} value={slide.content.bodyText}><p className="mt-[3%] text-[1.5cqw] leading-snug">{plain(slide.content.bodyText)}</p></EditableElement>}
          {Boolean(slide.content.bullets?.length) && <div className="mt-[4%]"><BulletList slide={slide} palette={imageUrl ? { ...palette, text: "#FFFFFF" } : palette} editor={editor} /></div>}
        </div>
        <PageNumber slide={slide} total={total} palette={imageUrl ? { ...palette, muted: "#FFFFFF" } : palette} />
        {imageUrl && slide.visualCaption && <span className="absolute bottom-[3%] left-[7%] max-w-[60%] text-[0.85cqw] text-white/80">{slide.visualCaption}</span>}
      </div>
    );
  }

  if (layout === "big-stat") {
    const metric = slide.content.metrics?.[0] || slide.content.factCards?.[0];
    return (
      <div className="visual-page relative grid w-full grid-cols-[43%_57%] overflow-hidden" style={pageStyle} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        <div className="flex flex-col justify-between p-[10%]" style={{ backgroundColor: palette.primary, color: palette.surface }}>
          <span className="text-[clamp(5px,0.9cqw,13px)] font-bold uppercase tracking-[0.18em]">{eyebrow}</span>
          <div>
            <div className="text-[clamp(24px,9cqw,138px)] font-black leading-none" style={{ fontFamily: fonts.display }}>{plain(metric?.value || "01")}</div>
            <p className="mt-4 max-w-[80%] text-[clamp(6px,1.3cqw,19px)] font-semibold leading-tight">{plain(metric?.label || slide.subtitle || "Key finding")}</p>
          </div>
          <span className="text-[clamp(5px,0.8cqw,12px)] opacity-70">{data.title}</span>
        </div>
        <div className="flex flex-col justify-center p-[10%]">
          <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={slide.title} multiline={false}><h1 className="text-[clamp(12px,3.7cqw,56px)] font-bold leading-[1.02]" style={titleStyle}>{plain(slide.title)}</h1></EditableElement>
          {slide.content.bodyText && <EditableElement id={elementId(slide.id, "body")} kind="body" state={slide.elementStyles?.[elementId(slide.id, "body")]} editor={editor} value={slide.content.bodyText}><p className="mt-[5%] text-[clamp(6px,1.25cqw,18px)] leading-relaxed" style={{ color: palette.muted }}>{plain(slide.content.bodyText)}</p></EditableElement>}
          <div className="mt-[7%]"><BulletList slide={slide} palette={palette} limit={3} editor={editor} /></div>
        </div>
        <PageNumber slide={slide} total={total} palette={palette} />
      </div>
    );
  }

  if (layout === "timeline" || layout === "process") {
    const hasIntro = Boolean(slide.content.bodyText);
    return (
      <div className="visual-page relative w-full overflow-hidden p-[5.5%]" style={pageStyle} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        <div className="flex items-end justify-between border-b pb-[2.5%]" style={{ borderColor: rgba(palette.text, 0.18) }}>
          <div className="max-w-[70%]">
            <span className="text-[clamp(5px,0.8cqw,12px)] font-bold uppercase tracking-[0.16em]" style={{ color: palette.primary }}>{eyebrow}</span>
            <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={slide.title} multiline={false}><h1 className="mt-2 text-[clamp(12px,3.5cqw,54px)] font-bold leading-none" style={titleStyle}>{plain(slide.title)}</h1></EditableElement>
          </div>
          {slide.subtitle && <EditableElement id={elementId(slide.id, "subtitle")} kind="subtitle" state={slide.elementStyles?.[elementId(slide.id, "subtitle")]} editor={editor} value={slide.subtitle}><p className="max-w-[25%] text-right text-[clamp(5px,0.85cqw,13px)] leading-snug" style={{ color: palette.muted }}>{plain(slide.subtitle)}</p></EditableElement>}
        </div>
        {slide.content.bodyText && <EditableElement id={elementId(slide.id, "body")} kind="body" state={slide.elementStyles?.[elementId(slide.id, "body")]} editor={editor} value={slide.content.bodyText}><p className="mt-[2.5%] max-w-[82%] text-[clamp(6px,1.05cqw,16px)] leading-relaxed" style={{ color: palette.muted }}>{plain(slide.content.bodyText)}</p></EditableElement>}
        <div className={`${hasIntro ? "h-[48%]" : "h-[62%]"} pt-[3%]`}><Timeline slide={slide} palette={palette} horizontal={!isPoster} editor={editor} /></div>
        <PageNumber slide={slide} total={total} palette={palette} />
      </div>
    );
  }

  if (layout === "comparison") {
    const comparison = slide.content.comparison;
    const fallbackColumns = [
      { title: "Before", points: slide.content.bullets?.slice(0, 3) || [] },
      { title: "After", points: slide.content.bullets?.slice(3, 6) || [] },
    ];
    const columns = [comparison?.left, comparison?.right].map((column, index) => ({
      title: plain(column?.title) || fallbackColumns[index].title,
      points: Array.isArray(column?.points) ? column.points.filter((point): point is string => typeof point === "string") : fallbackColumns[index].points,
    }));
    return (
      <div className="visual-page relative w-full overflow-hidden p-[5.5%]" style={pageStyle} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        <span className="text-[clamp(5px,0.8cqw,12px)] font-bold uppercase tracking-[0.16em]" style={{ color: palette.primary }}>{eyebrow}</span>
        <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={slide.title} multiline={false}><h1 className="mt-2 max-w-[80%] text-[clamp(12px,3.6cqw,55px)] font-bold leading-none" style={titleStyle}>{plain(slide.title)}</h1></EditableElement>
        <div className="mt-[5%] grid h-[55%] grid-cols-2 gap-[7%]">
          {columns.map((column, index) => (
            <div key={`${column.title}-${index}`} className="border-t-[5px] pt-[6%]" style={{ borderColor: index ? palette.accent : palette.primary }}>
              <EditableElement id={elementId(slide.id, "label", index)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index)]} editor={editor} value={column.title} multiline={false}><div className="text-[clamp(6px,1.5cqw,22px)] font-bold" style={{ color: index ? palette.accent : palette.primary }}>{plain(column.title)}</div></EditableElement>
              <div className="mt-[7%] space-y-[6%]">
                {column.points.slice(0, 4).map((point, pointIndex) => {
                  const stableIndex = pointIndex + (index === 0 ? 0 : columns[0].points.length);
                  return <EditableElement key={stableIndex} id={elementId(slide.id, "bullet", stableIndex)} kind="bullet" state={slide.elementStyles?.[elementId(slide.id, "bullet", stableIndex)]} editor={editor} value={point}><p className="text-[clamp(5px,1.15cqw,17px)] leading-snug" style={bodyStyle}>{plain(point)}</p></EditableElement>;
                })}
              </div>
            </div>
          ))}
        </div>
        <PageNumber slide={slide} total={total} palette={palette} />
      </div>
    );
  }

  if (layout === "quote") {
    const quote = slide.content.quote;
    return (
      <div className="visual-page relative flex w-full items-center overflow-hidden p-[8%]" style={{ ...pageStyle, backgroundColor: slide.elementStyles?.[backgroundId]?.color || palette.primary }} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        <div className="absolute right-[6%] top-[2%] text-[clamp(50px,22cqw,330px)] font-black leading-none opacity-10" style={{ color: palette.surface, fontFamily: fonts.display }}>“</div>
        <div className="relative max-w-[82%]" style={{ color: palette.surface }}>
          <span className="text-[clamp(5px,0.9cqw,13px)] font-bold uppercase tracking-[0.18em]" style={{ color: palette.accent }}>{eyebrow}</span>
          <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={quote?.text || slide.title}><blockquote className="mt-[5%] text-[clamp(12px,4.8cqw,74px)] font-bold leading-[1.05]" style={{ fontFamily: fonts.display }}>{plain(quote?.text || slide.title)}</blockquote></EditableElement>
          <EditableElement id={elementId(slide.id, "subtitle")} kind="subtitle" state={slide.elementStyles?.[elementId(slide.id, "subtitle")]} editor={editor} value={quote?.author || slide.subtitle || ""}><p className="mt-[5%] text-[clamp(5px,1.1cqw,16px)] font-semibold opacity-75">{plain(quote?.author || slide.subtitle)}</p></EditableElement>
        </div>
      </div>
    );
  }

  if (layout === "poster") {
    const metrics = [...(slide.content.metrics || []), ...(slide.content.factCards || [])].slice(0, 3);
    const academic = data.format === "academic-poster" || ["research-poster", "conference-poster", "academic", "scientific"].includes(plan.style);
    const hasTimeline = Boolean(slide.content.timeline?.length);
    const hasNativeFigure = Boolean(slide.content.chart?.data?.length || slide.content.process?.length || slide.content.matrix?.items?.length);
    const hasInformationFigure = hasTimeline || hasNativeFigure;
    const posterInk = readableInk(palette.primary, palette.surface);
    return (
      <div className="visual-page relative w-full overflow-hidden" style={pageStyle} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
        <div className="absolute left-0 top-0 h-[1.2%] w-full" style={{ backgroundColor: palette.accent }} />
        <div className="grid h-full" style={{ gridTemplateRows: academic ? "24% 1fr 7%" : "30% 1fr 7%" }}>
          <header className="relative grid overflow-hidden" style={{ backgroundColor: palette.primary, color: posterInk, gridTemplateColumns: imageUrl ? "62% 38%" : "1fr" }}>
            <div className="relative z-10 px-[11%] pb-[8%] pt-[12%]">
              <span className="text-[1.1cqw] font-bold uppercase tracking-[0.18em]" style={{ color: readableInk(palette.primary, palette.accent) }}>{eyebrow}</span>
              <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={slide.title} multiline={false}><h1 className={`mt-[3%] ${imageUrl ? "text-[clamp(14px,4.35cqw,68px)]" : "text-[clamp(14px,5.2cqw,80px)]"} font-black leading-[0.96]`} style={{ fontFamily: fonts.display }}>{plain(slide.title)}</h1></EditableElement>
              {slide.subtitle && <EditableElement id={elementId(slide.id, "subtitle")} kind="subtitle" state={slide.elementStyles?.[elementId(slide.id, "subtitle")]} editor={editor} value={slide.subtitle}><p className="mt-[3%] max-w-[90%] text-[1.65cqw] leading-snug">{plain(slide.subtitle)}</p></EditableElement>}
            </div>
            {imageUrl && <figure className="relative min-h-0 overflow-hidden">
              <EditableElement id={elementId(slide.id, "image")} kind="image" state={slide.elementStyles?.[elementId(slide.id, "image")]} editor={editor}><div className="h-full min-h-0"><SlideImage src={imageUrl} alt={slide.imagePrompt || slide.title} objectPosition={slide.elementStyles?.[elementId(slide.id, "image")]?.objectPosition} /></div></EditableElement>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-[18%]" style={{ background: `linear-gradient(90deg, ${palette.primary}, transparent)` }} />
              {slide.visualCaption && <figcaption className="absolute bottom-[5%] right-[6%] max-w-[84%] bg-black/55 px-2 py-1 text-right text-[clamp(4px,0.62cqw,9px)] text-white">{slide.visualCaption}</figcaption>}
            </figure>}
          </header>
          <main className="grid min-h-0 gap-[6%] px-[7%] py-[6%]" style={{ gridTemplateColumns: hasInformationFigure ? "1fr 1fr" : "1fr", gridTemplateRows: "minmax(0, 1fr)" }}>
            <div className="min-w-0">
              {metrics.length > 0 && <div className="mb-[9%] grid grid-cols-3 gap-[5%]">{metrics.map((metric, index) => <div key={index} className="border-t-2 pt-3" style={{ borderColor: index === 1 ? palette.accent : palette.primary }}><strong className="block text-[clamp(8px,2.5cqw,38px)] leading-none" style={{ color: palette.text }}>{plain(metric.value)}</strong><span className="mt-2 block text-[clamp(4px,0.7cqw,10px)] leading-tight" style={{ color: palette.muted }}>{plain(metric.label)}</span></div>)}</div>}
              {slide.content.bodyText && <EditableElement id={elementId(slide.id, "body")} kind="body" state={slide.elementStyles?.[elementId(slide.id, "body")]} editor={editor} value={slide.content.bodyText}><p className="mb-[8%] text-[1.55cqw] leading-relaxed" style={{ color: palette.muted }}>{plain(slide.content.bodyText)}</p></EditableElement>}
              <BulletList slide={slide} palette={palette} limit={academic ? 6 : 4} editor={editor} />
            </div>
            {hasInformationFigure && <div className="min-h-0">
              {hasTimeline ? (
                <Timeline slide={slide} palette={palette} horizontal={false} editor={editor} />
              ) : hasNativeFigure ? <NativeDesignFigure slide={slide} palette={palette} editor={editor} /> : null}
            </div>}
          </main>
          <footer className="flex items-center justify-between gap-[3%] border-t px-[7%] text-[1cqw]" style={{ borderColor: rgba(palette.text, 0.16), color: palette.muted }}><span>{data.author || data.title}</span>{data.date && <span>{data.date}</span>}</footer>
        </div>
      </div>
    );
  }

  const reverse = layout === "image-feature" || layout === "split";
  const noImageVariant = (slide.slideNumber + (slide.layoutVariant || 0)) % 4;
  const contentClassName = imageUrl
    ? "relative flex min-w-0 flex-col justify-center overflow-hidden p-[9%]"
    : noImageVariant === 0
      ? "relative z-10 flex min-w-0 flex-col justify-center overflow-hidden p-[9%] pr-[28%]"
      : noImageVariant === 1
        ? "relative z-10 ml-[24%] flex min-w-0 flex-col justify-center overflow-hidden border-l p-[9%]"
        : noImageVariant === 2
          ? "relative z-10 flex min-w-0 flex-col justify-end overflow-hidden p-[9%] pb-[12%]"
          : "relative z-10 flex min-w-0 flex-col justify-center overflow-hidden p-[9%] pl-[15%]";
  return (
    <div className="visual-page relative grid w-full overflow-hidden" style={{ ...pageStyle, gridTemplateColumns: imageUrl ? (reverse ? "53% 47%" : "47% 53%") : "1fr" }} data-slide-id={slide.id} onClick={(event) => editor?.enabled && editor.onSelect(backgroundId, "shape", event.currentTarget.getBoundingClientRect(), event.shiftKey)}>
      {!imageUrl && noImageVariant === 0 && <div className="pointer-events-none absolute -right-[5%] top-[8%] text-[clamp(80px,20cqw,300px)] font-black leading-none opacity-[0.07]" style={{ color: palette.primary, fontFamily: fonts.display }}>{String(slide.slideNumber).padStart(2, "0")}</div>}
      {!imageUrl && noImageVariant === 1 && <div className="pointer-events-none absolute inset-y-0 left-0 w-[24%]" style={{ backgroundColor: palette.primary }}><div className="absolute bottom-[10%] left-[18%] h-px w-[48%]" style={{ backgroundColor: palette.surface }} /></div>}
      {!imageUrl && noImageVariant === 2 && <><div className="pointer-events-none absolute -right-[8%] -top-[22%] aspect-square w-[42%] rounded-full border-[clamp(12px,3cqw,46px)] opacity-15" style={{ borderColor: palette.accent }} /><div className="pointer-events-none absolute left-[9%] top-[10%] h-[5px] w-[18%]" style={{ backgroundColor: palette.primary }} /></>}
      {!imageUrl && noImageVariant === 3 && <><div className="pointer-events-none absolute bottom-0 left-0 h-[9%] w-full" style={{ backgroundColor: palette.primary }} /><div className="pointer-events-none absolute left-[8%] top-[12%] h-[54%] w-[6px]" style={{ backgroundColor: palette.accent }} /></>}
      {imageUrl && reverse && <EditableElement id={elementId(slide.id, "image")} kind="image" state={slide.elementStyles?.[elementId(slide.id, "image")]} editor={editor}><div className="h-full min-h-0"><SlideImage src={imageUrl} alt={slide.imagePrompt || slide.title} objectPosition={slide.elementStyles?.[elementId(slide.id, "image")]?.objectPosition} /></div></EditableElement>}
      <div className={contentClassName} style={!imageUrl && noImageVariant === 1 ? { borderColor: rgba(palette.text, 0.18) } : undefined}>
        <span className="text-[clamp(5px,0.8cqw,12px)] font-bold uppercase tracking-[0.16em]" style={{ color: palette.primary }}>{eyebrow}</span>
        <EditableElement id={elementId(slide.id, "title")} kind="title" state={slide.elementStyles?.[elementId(slide.id, "title")]} editor={editor} value={slide.title} multiline={false}><h1 className="mt-[3%] text-[clamp(12px,4.2cqw,64px)] font-bold leading-[1.01]" style={titleStyle}>{plain(slide.title)}</h1></EditableElement>
        {slide.subtitle && <EditableElement id={elementId(slide.id, "subtitle")} kind="subtitle" state={slide.elementStyles?.[elementId(slide.id, "subtitle")]} editor={editor} value={slide.subtitle}><p className="mt-[4%] max-w-[90%] text-[clamp(6px,1.15cqw,17px)] leading-snug" style={{ color: palette.muted }}>{plain(slide.subtitle)}</p></EditableElement>}
        {slide.content.bodyText && <EditableElement id={elementId(slide.id, "body")} kind="body" state={slide.elementStyles?.[elementId(slide.id, "body")]} editor={editor} value={slide.content.bodyText}><p className="mt-[5%] max-w-[92%] text-[clamp(6px,1.15cqw,17px)] leading-relaxed" style={{ color: palette.muted }}>{plain(slide.content.bodyText)}</p></EditableElement>}
        {slide.content.chart?.data?.length ? <div className="mt-[7%] h-[42%]"><BarChart slide={slide} palette={palette} /></div> : <div className="mt-[7%]"><BulletList slide={slide} palette={palette} limit={4} editor={editor} /></div>}
      </div>
      {imageUrl && !reverse && <EditableElement id={elementId(slide.id, "image")} kind="image" state={slide.elementStyles?.[elementId(slide.id, "image")]} editor={editor}><div className="h-full min-h-0"><SlideImage src={imageUrl} alt={slide.imagePrompt || slide.title} objectPosition={slide.elementStyles?.[elementId(slide.id, "image")]?.objectPosition} /></div></EditableElement>}
      <PageNumber slide={slide} total={total} palette={palette} />
    </div>
  );
}

export default function VisualDesignStudio({ data: rawData, onClose, onChange, initialSlide = 0 }: Props) {
  const [data, setData] = useState(() => normalizePresentation(rawData));
  const [selectedIndex, setSelectedIndex] = useState(() => Math.min(Math.max(0, initialSlide), Math.max(0, rawData.slides.length - 1)));
  // Open as a clean preview like Gemini's deck viewer. Editing remains one
  // click away, but the inspector no longer consumes the canvas by default.
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedKind, setSelectedKind] = useState<SlideElementKind | null>(null);
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null);
  const [editProposal, setEditProposal] = useState<{ before: string; after: string } | null>(null);
  const [editStatus, setEditStatus] = useState<"idle" | "working" | "error">("idle");
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [exporting, setExporting] = useState<string | null>(null);
  const [visualPending, setVisualPending] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [compactStudio, setCompactStudio] = useState(true);
  const studioRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const undoStack = useRef<PresentationData[]>([]);
  const redoStack = useRef<PresentationData[]>([]);

  // The studio stays mounted while a new artifact replaces the previous one.
  // Without syncing the prop, React retained the old canvas state whenever the
  // model omitted a root id and every artifact shared the "presentation" key.
  useEffect(() => {
    if (rawData === dataRef.current) return;
    const next = normalizePresentation(rawData);
    dataRef.current = next;
    setData(next);
    setSelectedIndex((index) => Math.min(index, Math.max(0, next.slides.length - 1)));
    setSelectedIds([]);
    setSelectedKind(null);
    setToolbarRect(null);
    undoStack.current = [];
    redoStack.current = [];
    setHistoryState({ undo: 0, redo: 0 });
  }, [rawData]);
  const slide = data.slides[selectedIndex] || data.slides[0];
  const quality = useMemo(() => scoreDesign(data), [data]);

  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    const element = studioRef.current;
    if (!element) return;
    const update = () => setCompactStudio(element.getBoundingClientRect().width < 760);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const commitData = useCallback((producer: PresentationData | ((current: PresentationData) => PresentationData)) => {
    const current = dataRef.current;
    const next = typeof producer === "function" ? producer(current) : producer;
    if (next === current) return;
    undoStack.current = [...undoStack.current.slice(-49), current];
    redoStack.current = [];
    dataRef.current = next;
    setData(next);
    setHistoryState({ undo: undoStack.current.length, redo: 0 });
    onChange?.(next);
  }, [onChange]);

  const requestedVisuals = plannedImageRequests(data);
  const visualRequestSignature = JSON.stringify(requestedVisuals.map(({ key }) => key));
  useEffect(() => {
    let active = true;
    if (!requestedVisuals.length) { setVisualPending(false); setVisualError(null); return; }
    setVisualPending(true);
    setVisualError(null);
    // One bounded request per planned slot. The client caches in-flight and
    // failed requests across Strict Mode, thumbnails, and canvas remounts.
    void Promise.allSettled(requestedVisuals.map(async ({ slideId, request, key }) => {
      try {
        const result = await requestDesignImage(request);
        if (active) commitData((current) => attachGeneratedImage(current, slideId, key, result));
      } catch (error) {
        if (active) setVisualError(error instanceof Error ? error.message : 'The illustration could not be generated.');
      }
    })).then(() => { if (active) setVisualPending(false); });
    return () => { active = false; };
    // The signature includes the complete brief and revision, not incidental edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualRequestSignature, commitData]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(dataRef.current);
    dataRef.current = previous;
    setData(previous);
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length });
    onChange?.(previous);
  }, [onChange]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(dataRef.current);
    dataRef.current = next;
    setData(next);
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length });
    onChange?.(next);
  }, [onChange]);

  const selectSlide = (index: number) => {
    setSelectedIndex(index);
    setSelectedIds([]);
    setSelectedKind(null);
    setToolbarRect(null);
    setEditProposal(null);
  };

  const handleSelect = useCallback((id: string, kind: SlideElementKind, rect: DOMRect, additive: boolean) => {
    setSelectedIds((current) => additive
      ? current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      : [id]);
    setSelectedKind(kind);
    setToolbarRect(rect);
    setEditProposal(null);
  }, []);

  const editor = useMemo<CanvasEditor>(() => ({
    enabled: editing,
    selectedIds,
    onSelect: handleSelect,
    onCommitText: (id, value) => commitData((current) => elementValue(current, id) === value ? current : updateElementText(current, id, value)),
  }), [commitData, editing, handleSelect, selectedIds]);

  const patchSelection = useCallback((patch: Partial<SlideElementStyle>) => {
    commitData((current) => patchElementStyles(current, selectedIds, patch));
  }, [commitData, selectedIds]);

  const moveSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const canvasWidth = stageRef.current?.querySelector<HTMLElement>(".visual-page")?.getBoundingClientRect().width || 1000;
    const snapshot = dataRef.current;
    const initial = new Map(selectedIds.map((id) => {
      const currentSlide = snapshot.slides.find((candidate) => id.startsWith(`${candidate.id}::`));
      return [id, currentSlide?.elementStyles?.[id]] as const;
    }));
    const onMove = (pointerEvent: PointerEvent) => {
      let next = snapshot;
      selectedIds.forEach((id) => {
        const value = initial.get(id);
        next = patchElementStyles(next, [id], {
          offsetX: (value?.offsetX || 0) + ((pointerEvent.clientX - startX) / canvasWidth) * 100,
          offsetY: (value?.offsetY || 0) + ((pointerEvent.clientY - startY) / canvasWidth) * 100,
        });
      });
      dataRef.current = next;
      setData(next);
    };
    const onUp = (pointerEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (pointerEvent.clientX === startX && pointerEvent.clientY === startY) return;
      undoStack.current = [...undoStack.current.slice(-49), snapshot];
      redoStack.current = [];
      setHistoryState({ undo: undoStack.current.length, redo: 0 });
      onChange?.(dataRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const exportPages = async () => {
    const pages = Array.from(document.querySelectorAll<HTMLElement>(".visual-export-page .visual-page"));
    return Promise.all(pages.map((page) => html2canvas(page, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: data.designPlan!.palette.background,
      onclone: prepareHtml2CanvasClone,
    })));
  };

  const exportPdf = async () => {
    setExporting("pdf");
    try {
      const canvases = await exportPages();
      const poster = data.format !== "presentation";
      const pdf = new jsPDF({ orientation: poster ? "portrait" : "landscape", unit: "pt", format: poster ? "a4" : [1280, 720] });
      canvases.forEach((canvas, index) => {
        if (index) pdf.addPage(poster ? "a4" : [1280, 720], poster ? "portrait" : "landscape");
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
      });
      pdf.save(`${data.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "visual-design"}.pdf`);
    } finally { setExporting(null); }
  };

  const exportPptx = async () => {
    setExporting("pptx");
    try {
      const canvases = await exportPages();
      const pres = new pptxgen();
      const poster = data.format !== "presentation";
      if (poster) {
        pres.defineLayout({ name: "VOID_POSTER", width: 7.5, height: data.format === "academic-poster" ? 10.605 : 9.375 });
        pres.layout = "VOID_POSTER";
      } else {
        pres.layout = "LAYOUT_WIDE";
      }
      pres.author = data.author || "VOID Visual Design Engine";
      pres.subject = data.designPlan?.subject || data.title;
      pres.title = data.title;
      canvases.forEach((canvas) => {
        const page = pres.addSlide();
        page.addImage({ data: canvas.toDataURL("image/png"), x: 0, y: 0, w: poster ? 7.5 : 13.333, h: poster ? (data.format === "academic-poster" ? 10.605 : 9.375) : 7.5 });
      });
      await pres.writeFile({ fileName: `${data.title.replace(/[^a-z0-9]+/gi, "-") || "visual-design"}.pptx` });
    } finally { setExporting(null); }
  };

  const activeId = selectedIds[selectedIds.length - 1];
  const activeStyle = activeId ? slide.elementStyles?.[activeId] : undefined;
  const isTextSelection = selectedKind === "title" || selectedKind === "subtitle" || selectedKind === "body" || selectedKind === "bullet" || selectedKind === "label";
  const allSelectedLocked = selectedIds.length > 0 && selectedIds.every((id) => Boolean(slide.elementStyles?.[id]?.locked));
  const defaultFontSize = selectedKind === "title" ? 4.2 : selectedKind === "subtitle" ? 1.15 : selectedKind === "body" ? 1.15 : 1.3;
  const currentFontSize = activeStyle?.fontSize || defaultFontSize;
  const activeValue = activeId
    ? elementValue(data, activeId) || (selectedKind === "image" ? slide.imagePrompt || `${slide.title}, subject-specific editorial visual` : "")
    : "";

  const runInstruction = async (override?: string) => {
    const requestedInstruction = (override || instruction).trim();
    if (!requestedInstruction || !activeId || (!isTextSelection && selectedKind !== "image") || activeStyle?.locked) return;
    const before = elementValue(dataRef.current, activeId) || activeValue;
    if (!before) return;
    setEditStatus("working");
    setEditProposal(null);
    try {
      const response = await fetch("/api/artifact/edit-element", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: requestedInstruction,
          value: before,
          kind: selectedKind,
          context: { documentTitle: data.title, slideTitle: slide.title, slideSubtitle: slide.subtitle },
        }),
      });
      if (!response.ok) throw new Error("Edit request failed");
      const result = await response.json() as { value?: string };
      if (!result.value?.trim()) throw new Error("No scoped edit returned");
      setEditProposal({ before, after: result.value.trim() });
      setInstruction("");
      setEditStatus("idle");
    } catch {
      setEditStatus("error");
    }
  };

  const acceptProposal = () => {
    if (!activeId || !editProposal) return;
    commitData((current) => updateElementText(current, activeId, editProposal.after));
    setEditProposal(null);
  };

  const applyToAllHeadings = () => {
    if (selectedKind !== "title" || !activeId) return;
    const style = slide.elementStyles?.[activeId];
    if (!style) return;
    const headingIds = data.slides.map((item) => elementId(item.id, "title"));
    commitData((current) => patchElementStyles(current, headingIds, {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
      textAlign: style.textAlign,
    }));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (!editing || selectedIds.length === 0 || allSelectedLocked) return;
      const nudge = event.shiftKey ? 1 : 0.25;
      const patch = event.key === "ArrowLeft" ? { offsetX: (activeStyle?.offsetX || 0) - nudge }
        : event.key === "ArrowRight" ? { offsetX: (activeStyle?.offsetX || 0) + nudge }
          : event.key === "ArrowUp" ? { offsetY: (activeStyle?.offsetY || 0) - nudge }
            : event.key === "ArrowDown" ? { offsetY: (activeStyle?.offsetY || 0) + nudge }
              : null;
      if (patch) {
        event.preventDefault();
        patchSelection(patch);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeStyle?.offsetX, activeStyle?.offsetY, allSelectedLocked, editing, patchSelection, redo, selectedIds.length, undo]);

  return (
    <div ref={studioRef} className="flex h-full min-h-0 w-full flex-col bg-[#0c0d0e] text-white">
      <header className="flex h-[52px] min-h-[52px] shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#111214] px-3 sm:px-4">
        <div className="min-w-0 flex-1"><h2 className="truncate text-[13px] font-semibold tracking-[-0.01em]">{data.title}</h2><p className="truncate text-[10px] capitalize text-white/40">{typeof data.format === "string" ? data.format.replace(/-/g, " ") : "presentation"} · Page {selectedIndex + 1} of {data.slides.length} · Quality {quality.score}</p></div>
        {!compactStudio && <div className="flex items-center gap-2">
          <Palette size={16} className="text-white/50" />
          <select value={data.designPlan?.style} onChange={(event) => commitData((current) => withDesignStyle(current, event.target.value as DesignStyle))} className="h-8 rounded-md border border-white/10 bg-[#191a1c] px-2 text-xs outline-none transition-colors hover:border-white/20 focus:border-white/30">
            {DESIGN_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
          </select>
        </div>}
        {!compactStudio && <div className="mx-1 h-5 w-px bg-white/10" />}
        {!compactStudio && <button onClick={() => commitData((current) => regenerateSlideLayout(current, slide.id))} className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white" title="Regenerate this layout"><LayoutTemplate size={16} /></button>}
        {!compactStudio && <button onClick={() => commitData((current) => regenerateSlideImage(current, slide.id))} className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white" title="Regenerate this image"><ImageIcon size={16} /></button>}
        {!compactStudio && <button onClick={undo} disabled={historyState.undo === 0} className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-20" title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>}
        {!compactStudio && <button onClick={redo} disabled={historyState.redo === 0} className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-20" title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>}
        <button onClick={() => { setEditing((value) => !value); setSelectedIds([]); setSelectedKind(null); }} aria-pressed={editing} className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${editing ? "bg-white text-black" : "text-white/60 hover:bg-white/[0.07] hover:text-white"}`} title={editing ? "Turn element editing off" : "Edit elements"}><Pencil size={16} /></button>
        {!compactStudio && <button onClick={exportPdf} disabled={Boolean(exporting)} className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-30" title="Export PDF"><FileDown size={16} /></button>}
        <button onClick={exportPptx} disabled={Boolean(exporting)} className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-30" title="Export PowerPoint"><Download size={16} /></button>
        {onClose && <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white" title="Close preview"><X size={17} /></button>}
      </header>

      {(visualPending || visualError) && <div role="status" className="shrink-0 border-b border-white/10 px-4 py-2 text-xs leading-relaxed text-white/65">
        {visualError || 'Creating the illustration with OpenAI…'}
      </div>}

      {editing && activeId && toolbarRect && (
        <div
          className="fixed z-[70] flex h-10 items-center gap-0.5 rounded-lg border border-white/15 bg-[#111214]/95 px-1.5 text-white shadow-2xl backdrop-blur"
          style={{
            left: typeof window === "undefined" ? toolbarRect.left : Math.min(window.innerWidth - 170, Math.max(170, toolbarRect.left + toolbarRect.width / 2)),
            top: Math.max(62, toolbarRect.top - 48),
            transform: "translateX(-50%)",
          }}
          role="toolbar"
          aria-label={`Edit ${selectedIds.length > 1 ? `${selectedIds.length} elements` : selectedKind || "element"}`}
        >
          {selectedKind !== "shape" && <button onPointerDown={moveSelection} disabled={allSelectedLocked} className="grid h-8 w-8 cursor-grab place-items-center hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30" title="Drag to move"><Move size={15} /></button>}
          {isTextSelection && (
            <>
              <button onClick={() => patchSelection({ fontSize: Math.max(0.6, currentFontSize - 0.25) })} disabled={allSelectedLocked} className="h-8 min-w-8 px-1 text-xs hover:bg-white/10 disabled:opacity-30" title="Decrease text size">A−</button>
              <button onClick={() => patchSelection({ fontSize: Math.min(9, currentFontSize + 0.25) })} disabled={allSelectedLocked} className="h-8 min-w-8 px-1 text-sm hover:bg-white/10 disabled:opacity-30" title="Increase text size">A+</button>
              <button onClick={() => patchSelection({ fontWeight: activeStyle?.fontWeight && activeStyle.fontWeight >= 700 ? 400 : 700 })} disabled={allSelectedLocked} className="grid h-8 w-8 place-items-center hover:bg-white/10 disabled:opacity-30" title="Toggle bold"><Bold size={15} /></button>
              <button onClick={() => patchSelection({ textAlign: "left" })} disabled={allSelectedLocked} className="grid h-8 w-8 place-items-center hover:bg-white/10 disabled:opacity-30" title="Align left"><AlignLeft size={15} /></button>
              <button onClick={() => patchSelection({ textAlign: "center" })} disabled={allSelectedLocked} className="grid h-8 w-8 place-items-center hover:bg-white/10 disabled:opacity-30" title="Align center"><AlignCenter size={15} /></button>
              <button onClick={() => patchSelection({ textAlign: "right" })} disabled={allSelectedLocked} className="grid h-8 w-8 place-items-center hover:bg-white/10 disabled:opacity-30" title="Align right"><AlignRight size={15} /></button>
            </>
          )}
          {(isTextSelection || selectedKind === "shape") && <label className="grid h-8 w-8 cursor-pointer place-items-center hover:bg-white/10" title="Change color"><span className="h-4 w-4 rounded-full border border-white/50" style={{ backgroundColor: activeStyle?.color || "#ffffff" }} /><input type="color" value={activeStyle?.color || "#ffffff"} onChange={(event) => patchSelection({ color: event.target.value })} className="sr-only" disabled={allSelectedLocked} /></label>}
          {selectedKind === "image" && (
            <>
              <button onClick={() => patchSelection({ scale: Math.max(0.5, (activeStyle?.scale || 1) - 0.05) })} disabled={allSelectedLocked} className="h-8 min-w-8 text-xs hover:bg-white/10 disabled:opacity-30" title="Scale down">−</button>
              <button onClick={() => patchSelection({ scale: Math.min(2, (activeStyle?.scale || 1) + 0.05) })} disabled={allSelectedLocked} className="h-8 min-w-8 text-sm hover:bg-white/10 disabled:opacity-30" title="Scale up">+</button>
            </>
          )}
          <span className="mx-1 h-5 w-px bg-white/10" />
          <button onClick={() => patchSelection({ locked: !allSelectedLocked })} className="grid h-8 w-8 place-items-center hover:bg-white/10" title={allSelectedLocked ? "Unlock element" : "Lock element"}>{allSelectedLocked ? <Unlock size={15} /> : <Lock size={15} />}</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!compactStudio && <aside className="w-44 shrink-0 overflow-y-auto border-r border-white/[0.08] bg-[#111214] px-3 py-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Pages</span><span className="text-[10px] tabular-nums text-white/30">{data.slides.length}</span></div>
          <div className="space-y-3.5">
            {data.slides.map((item, index) => (
              <button key={item.id} onClick={() => selectSlide(index)} className={`group w-full rounded-md p-1.5 text-left transition-colors ${selectedIndex === index ? "bg-white/[0.08] opacity-100" : "opacity-55 hover:bg-white/[0.04] hover:opacity-90"}`}>
                <div className={`overflow-hidden rounded-sm border ${selectedIndex === index ? "border-white/80" : "border-white/10 group-hover:border-white/25"}`}><VisualPage data={data} slide={item} compact /></div>
                <span className="mt-1.5 block truncate px-0.5 text-[10px] text-white/70"><span className="mr-1.5 tabular-nums text-white/35">{String(index + 1).padStart(2, "0")}</span>{item.title}</span>
              </button>
            ))}
          </div>
        </aside>}

        <main ref={stageRef} className="relative flex min-w-0 flex-1 flex-col overflow-auto bg-[#191a1c] p-3 sm:p-5" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          {editing && !activeId && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-md border border-white/10 bg-[#111214]/95 px-3 py-1.5 text-[11px] text-white/55 shadow-lg backdrop-blur" role="status">
              Select text, an image, or the page to edit it
            </div>
          )}
          <div className="mx-auto flex min-h-[420px] w-full max-w-6xl flex-1 items-center justify-center py-4" style={{ containerType: "size" }}>
            <div
              className="border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.5)] transition-transform duration-150"
              style={{
                width: data.format === "presentation"
                  ? "min(100cqw, calc(100cqh * 16 / 9), 1120px)"
                  : data.canvasAspectRatio === "3:2"
                    ? "min(100cqw, calc(100cqh * 3 / 2), 1120px)"
                  : data.canvasAspectRatio === "1:1"
                    ? "min(100cqw, 100cqh, 820px)"
                  : data.canvasAspectRatio === "2:3"
                    ? "min(100cqw, calc(100cqh * 2 / 3), 720px)"
                  : data.format === "academic-poster"
                    ? "min(100cqw, calc(100cqh / 1.414), 720px)"
                    : "min(100cqw, calc(100cqh * 4 / 5), 720px)",
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
              }}
            ><VisualPage data={data} slide={slide} editor={editor} /></div>
          </div>
          <div className="sticky bottom-0 z-20 mx-auto mt-3 flex items-center gap-1 rounded-xl border border-white/10 bg-[#111214]/95 p-1 shadow-xl backdrop-blur">
            <button onClick={() => selectSlide(Math.max(0, selectedIndex - 1))} disabled={selectedIndex === 0} className="grid h-8 w-8 place-items-center rounded-lg text-white/65 hover:bg-white/[0.07] hover:text-white disabled:opacity-20" title="Previous page"><ChevronLeft size={17} /></button>
            <span className="w-14 text-center text-[11px] tabular-nums text-white/55">{selectedIndex + 1} / {data.slides.length}</span>
            <button onClick={() => selectSlide(Math.min(data.slides.length - 1, selectedIndex + 1))} disabled={selectedIndex === data.slides.length - 1} className="grid h-8 w-8 place-items-center rounded-lg text-white/65 hover:bg-white/[0.07] hover:text-white disabled:opacity-20" title="Next page"><ChevronRight size={17} /></button>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button onClick={() => setZoom((value) => Math.max(0.65, Number((value - 0.1).toFixed(2))))} className="grid h-8 w-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white" title="Zoom out"><ZoomOut size={15} /></button>
            <button onClick={() => setZoom(1)} className="min-w-12 rounded-lg px-1.5 text-[10px] tabular-nums text-white/55 hover:bg-white/[0.07] hover:text-white" title="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom((value) => Math.min(1.35, Number((value + 0.1).toFixed(2))))} className="grid h-8 w-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white" title="Zoom in"><ZoomIn size={15} /></button>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button onClick={() => stageRef.current?.requestFullscreen?.()} className="grid h-8 w-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white" title="Present full screen"><Maximize2 size={16} /></button>
          </div>
        </main>

        {editing && (
          <aside className="absolute inset-y-[52px] right-0 z-40 w-[min(340px,92vw)] overflow-y-auto border-l border-white/[0.08] bg-[#111214] p-5 shadow-2xl xl:relative xl:inset-auto xl:z-auto xl:w-[320px] xl:shadow-none">
            <div className="mb-5 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Element editor</h3><p className="mt-0.5 text-[10px] text-white/45">Page {selectedIndex + 1} · Shift-click for multi-select</p></div><button onClick={() => { setEditing(false); setSelectedIds([]); }} className="grid h-8 w-8 place-items-center hover:bg-white/10" title="Close editor"><X size={16} /></button></div>
            {!activeId ? (
              <div className="border border-dashed border-white/15 p-4 text-sm leading-relaxed text-white/55">Click text, an image, or the page background. The selected element will be the only thing changed.</div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Selected</p><p className="mt-1 text-sm capitalize">{selectedIds.length > 1 ? `${selectedIds.length} elements` : selectedKind}</p></div>
                  <span className="flex items-center gap-1 text-[10px] text-white/45">{allSelectedLocked ? <><Lock size={12} /> Locked</> : <><Check size={12} /> Editable</>}</span>
                </div>

                {isTextSelection && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Typography</p>
                    <div className="mt-2 grid grid-cols-6 gap-1 rounded-md border border-white/10 bg-[#191a1c] p-1">
                      <button onClick={() => patchSelection({ fontSize: Math.max(0.6, currentFontSize - 0.25) })} disabled={allSelectedLocked} className="h-8 rounded text-xs hover:bg-white/[0.07] disabled:opacity-30" title="Decrease text size">A−</button>
                      <button onClick={() => patchSelection({ fontSize: Math.min(9, currentFontSize + 0.25) })} disabled={allSelectedLocked} className="h-8 rounded text-sm hover:bg-white/[0.07] disabled:opacity-30" title="Increase text size">A+</button>
                      <button onClick={() => patchSelection({ fontWeight: activeStyle?.fontWeight && activeStyle.fontWeight >= 700 ? 400 : 700 })} disabled={allSelectedLocked} className="grid h-8 place-items-center rounded hover:bg-white/[0.07] disabled:opacity-30" title="Toggle bold"><Bold size={14} /></button>
                      <button onClick={() => patchSelection({ textAlign: "left" })} disabled={allSelectedLocked} className="grid h-8 place-items-center rounded hover:bg-white/[0.07] disabled:opacity-30" title="Align left"><AlignLeft size={14} /></button>
                      <button onClick={() => patchSelection({ textAlign: "center" })} disabled={allSelectedLocked} className="grid h-8 place-items-center rounded hover:bg-white/[0.07] disabled:opacity-30" title="Align center"><AlignCenter size={14} /></button>
                      <button onClick={() => patchSelection({ textAlign: "right" })} disabled={allSelectedLocked} className="grid h-8 place-items-center rounded hover:bg-white/[0.07] disabled:opacity-30" title="Align right"><AlignRight size={14} /></button>
                    </div>
                  </div>
                )}

                {(isTextSelection || selectedKind === "shape") && (
                  <label className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-white/45">
                    Element color
                    <span className="flex items-center gap-2 text-[10px] normal-case tracking-normal text-white/55">
                      {activeStyle?.color || (selectedKind === "shape" ? data.designPlan?.palette.background : "Default")}
                      <span className="h-7 w-7 overflow-hidden rounded-md border border-white/15" style={{ backgroundColor: activeStyle?.color || (selectedKind === "shape" ? data.designPlan?.palette.background : "#ffffff") }}>
                        <input type="color" value={activeStyle?.color || (selectedKind === "shape" ? data.designPlan?.palette.background : "#ffffff")} onChange={(event) => patchSelection({ color: event.target.value })} disabled={allSelectedLocked} className="h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0" />
                      </span>
                    </span>
                  </label>
                )}

                {(isTextSelection || selectedKind === "image") && (
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/45">
                    {selectedKind === "image" ? "Image direction" : "Content"}
                    <textarea
                      key={`${activeId}-${activeValue}`}
                      defaultValue={activeValue}
                      onBlur={(event) => commitData((current) => activeValue === event.target.value.trim() ? current : updateElementText(current, activeId, event.target.value.trim()))}
                      disabled={Boolean(activeStyle?.locked)}
                      rows={selectedKind === "title" ? 2 : 4}
                      className="mt-1.5 w-full resize-none border border-white/10 bg-[#202326] p-2.5 text-sm leading-relaxed text-white outline-none focus:border-white/35 disabled:opacity-40"
                    />
                  </label>
                )}

                {selectedKind === "image" && (
                  <div><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Crop focus</p><div className="flex items-center gap-1"><button onClick={() => patchSelection({ scale: Math.max(0.5, (activeStyle?.scale || 1) - 0.05) })} disabled={allSelectedLocked} className="h-7 w-7 rounded border border-white/10 hover:bg-white/[0.07] disabled:opacity-30" title="Scale image down">−</button><span className="w-10 text-center text-[10px] tabular-nums text-white/45">{Math.round((activeStyle?.scale || 1) * 100)}%</span><button onClick={() => patchSelection({ scale: Math.min(2, (activeStyle?.scale || 1) + 0.05) })} disabled={allSelectedLocked} className="h-7 w-7 rounded border border-white/10 hover:bg-white/[0.07] disabled:opacity-30" title="Scale image up">+</button></div></div><div className="mt-2 grid grid-cols-3 gap-2">{[
                    { label: "Top left", value: "left top" }, { label: "Top", value: "center top" }, { label: "Top right", value: "right top" },
                    { label: "Left", value: "left center" }, { label: "Center", value: "center" }, { label: "Right", value: "right center" },
                    { label: "Bottom left", value: "left bottom" }, { label: "Bottom", value: "center bottom" }, { label: "Bottom right", value: "right bottom" },
                  ].map((item) => <button key={item.value} onClick={() => patchSelection({ objectPosition: item.value })} disabled={allSelectedLocked} className={`min-h-9 border px-1 text-[10px] leading-tight ${activeStyle?.objectPosition === item.value ? "border-white bg-white text-black" : "border-white/10 hover:bg-white/5"} disabled:opacity-30`}>{item.label}</button>)}</div></div>
                )}

                {selectedKind !== "shape" && (
                  <div>
                    <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Position</p><span className="text-[10px] text-white/35">Arrow keys · Shift for 1%</span></div>
                    <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                      <span />
                      <button onClick={() => patchSelection({ offsetY: (activeStyle?.offsetY || 0) - 0.5 })} disabled={allSelectedLocked} className="grid h-8 w-10 place-items-center rounded border border-white/10 hover:bg-white/[0.07] disabled:opacity-30" title="Move up"><ChevronLeft className="rotate-90" size={15} /></button>
                      <span />
                      <button onClick={() => patchSelection({ offsetX: (activeStyle?.offsetX || 0) - 0.5 })} disabled={allSelectedLocked} className="grid h-8 w-10 place-items-center rounded border border-white/10 hover:bg-white/[0.07] disabled:opacity-30" title="Move left"><ChevronLeft size={15} /></button>
                      <button onClick={() => patchSelection({ offsetX: 0, offsetY: 0 })} disabled={allSelectedLocked} className="h-8 rounded border border-white/10 px-2 text-[10px] text-white/55 hover:bg-white/[0.07] disabled:opacity-30">Center</button>
                      <button onClick={() => patchSelection({ offsetX: (activeStyle?.offsetX || 0) + 0.5 })} disabled={allSelectedLocked} className="grid h-8 w-10 place-items-center rounded border border-white/10 hover:bg-white/[0.07] disabled:opacity-30" title="Move right"><ChevronRight size={15} /></button>
                      <span />
                      <button onClick={() => patchSelection({ offsetY: (activeStyle?.offsetY || 0) + 0.5 })} disabled={allSelectedLocked} className="grid h-8 w-10 place-items-center rounded border border-white/10 hover:bg-white/[0.07] disabled:opacity-30" title="Move down"><ChevronRight className="rotate-90" size={15} /></button>
                      <span />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => patchSelection({ offsetX: 0, offsetY: 0, scale: 1 })} disabled={allSelectedLocked || selectedKind === "shape"} className="h-9 border border-white/10 text-xs hover:bg-white/5 disabled:opacity-30">Reset position</button>
                  {selectedKind === "title" ? <button onClick={applyToAllHeadings} disabled={!activeStyle || allSelectedLocked} className="h-9 border border-white/10 text-xs hover:bg-white/5 disabled:opacity-30">Apply to headings</button> : <button onClick={() => patchSelection({ locked: !allSelectedLocked })} className="h-9 border border-white/10 text-xs hover:bg-white/5">{allSelectedLocked ? "Unlock" : "Lock element"}</button>}
                </div>

                {(isTextSelection || selectedKind === "image") && (
                  <div className="border-t border-white/10 pt-4">
                    <div className="mb-2 flex items-center gap-2"><Sparkles size={14} /><p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Edit only this element</p></div>
                    <div className="mb-2 flex flex-wrap gap-1.5">{["Make it shorter", "Make it punchier", "Make it clearer"].map((suggestion) => <button key={suggestion} onClick={() => void runInstruction(suggestion)} disabled={editStatus === "working" || Boolean(activeStyle?.locked)} className="border border-white/10 px-2 py-1 text-[10px] text-white/65 hover:bg-white/5 disabled:opacity-30">{suggestion.replace("Make it ", "")}</button>)}</div>
                    <div className="flex gap-2"><input value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runInstruction(); }} placeholder={selectedKind === "image" ? "Show a tighter portrait" : "Rewrite just this element"} disabled={editStatus === "working" || Boolean(activeStyle?.locked)} className="min-w-0 flex-1 border border-white/10 bg-[#202326] px-3 text-sm outline-none focus:border-white/35 disabled:opacity-40" /><button onClick={() => void runInstruction()} disabled={editStatus === "working" || !instruction.trim() || Boolean(activeStyle?.locked)} className="grid h-10 w-10 place-items-center bg-white text-black disabled:opacity-30" title="Preview scoped edit"><Send size={16} /></button></div>
                    {editStatus === "working" && <p className="mt-2 text-xs text-white/50">Preparing a scoped preview…</p>}
                    {editStatus === "error" && <p className="mt-2 text-xs text-white/50">The edit service did not respond. Your original element is unchanged.</p>}
                  </div>
                )}

                {editProposal && (
                  <div className="border border-white/15 bg-[#202326] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Before</p><p className="mt-1 max-h-20 overflow-auto text-xs leading-relaxed text-white/45">{editProposal.before}</p>
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/45">After</p><p className="mt-1 max-h-24 overflow-auto text-xs leading-relaxed">{editProposal.after}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => setEditProposal(null)} className="h-9 border border-white/10 text-xs hover:bg-white/5">Keep original</button><button onClick={acceptProposal} className="h-9 bg-white text-xs font-semibold text-black">Apply edit</button></div>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      <div className="visual-export-page pointer-events-none fixed -left-[99999px] top-0 w-[1280px]" aria-hidden="true">
        {data.slides.map((item) => <div key={`export-${item.id}`} className="mb-4"><VisualPage data={data} slide={item} /></div>)}
      </div>
    </div>
  );
}
