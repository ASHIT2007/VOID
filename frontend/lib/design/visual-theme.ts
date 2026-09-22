import type { DesignPalette, DesignPlan, DesignStyle, Slide } from "@/types/presentation";

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Trebuchet MS', Arial, sans-serif";
const MONO = "'Courier New', monospace";

export function styleTypography(style: DesignStyle) {
  const literary = ["editorial", "magazine", "historical", "museum", "luxury", "premium", "documentary"].includes(style);
  const bold = ["brutalist", "bold-typography", "creative", "youthful"].includes(style);
  const technical = ["technology", "futuristic", "data-focused"].includes(style);
  return {
    display: literary ? SERIF : bold ? "Impact, 'Arial Black', sans-serif" : SANS,
    body: ["academic", "research-poster", "conference-poster"].includes(style) ? "Arial, sans-serif" : SANS,
    label: technical ? MONO : SANS,
    weight: literary || style === "minimal" ? 500 : bold ? 900 : 700,
    tracking: literary ? "-0.035em" : technical ? "-0.045em" : "-0.025em",
    radius: ["playful", "youthful", "creative"].includes(style) ? "2cqw" : "0",
    motif: technical ? "grid" : ["playful", "youthful", "creative", "cinematic"].includes(style) ? "orbit" : "rule",
  };
}

function luminance(hex: string) {
  const full = /^#[a-f\d]{3}$/i.test(hex) ? `#${hex.slice(1).split("").map((part) => part + part).join("")}` : hex;
  const values = [1, 3, 5].map((offset) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

export function contrastRatio(a: string, b: string) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function readableInk(background: string, preferred = "#FFFFFF") {
  if (contrastRatio(background, preferred) >= 4.5) return preferred;
  return contrastRatio(background, "#171717") > contrastRatio(background, "#FFFFFF") ? "#171717" : "#FFFFFF";
}

/** Derived page colors never mutate the authored palette. Every text role keeps contrast. */
export function pagePalette(plan: DesignPlan, slide: Slide): DesignPalette {
  const palette = plan.palette;
  const emphasis = ["hero", "full-bleed", "section-header", "closing", "quote"].includes(slide.layout);
  const quiet = ["minimal", "academic", "research-poster", "conference-poster"].includes(plan.style);
  const background = emphasis ? (slide.slideNumber % 2 ? palette.primary : palette.secondary)
    : !quiet && slide.slideNumber % 3 === 0 ? palette.surface : palette.background;
  return {
    ...palette, background,
    text: readableInk(background, palette.text),
    muted: readableInk(background, palette.muted),
    primary: emphasis ? readableInk(background, palette.accent) : readableInk(background, palette.primary),
    secondary: readableInk(background, palette.secondary),
  };
}

export function headingSize(slide: Slide, hero: boolean, density: DesignPlan["density"]) {
  const length = slide.title.length;
  const size = hero ? (length > 90 ? 4.5 : length > 55 ? 5.4 : 6.5) : length > 85 ? 3.2 : length > 50 ? 3.8 : 4.6;
  return `${size * (density === "dense" ? 0.92 : 1)}cqw`;
}
