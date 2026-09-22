const unsupportedColor = /(?:oklab|oklch|lab|lch|color|color-mix)\(/i;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function channel(value: number) {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(clamp(encoded) * 255);
}

function alphaValue(value?: string) {
  if (!value) return 1;
  const parsed = Number.parseFloat(value);
  return clamp(value.includes("%") ? parsed / 100 : parsed);
}

function oklabToRgba(lightness: number, a: number, b: number, alpha = 1) {
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  const red = channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function parseOklab(body: string) {
  const [channels, alpha] = body.split("/").map((part) => part.trim());
  const values = channels.split(/[\s,]+/).filter(Boolean);
  if (values.length < 3) return null;
  const lightness = clamp(Number.parseFloat(values[0]) / (values[0].includes("%") ? 100 : 1));
  const a = Number.parseFloat(values[1]) * (values[1].includes("%") ? 0.004 : 1);
  const b = Number.parseFloat(values[2]) * (values[2].includes("%") ? 0.004 : 1);
  if (![lightness, a, b].every(Number.isFinite)) return null;
  return oklabToRgba(lightness, a, b, alphaValue(alpha));
}

function parseOklch(body: string) {
  const [channels, alpha] = body.split("/").map((part) => part.trim());
  const values = channels.split(/[\s,]+/).filter(Boolean);
  if (values.length < 3) return null;
  const lightness = clamp(Number.parseFloat(values[0]) / (values[0].includes("%") ? 100 : 1));
  const chroma = Number.parseFloat(values[1]) * (values[1].includes("%") ? 0.004 : 1);
  const hue = Number.parseFloat(values[2]) * Math.PI / 180;
  if (![lightness, chroma, hue].every(Number.isFinite)) return null;
  return oklabToRgba(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue), alphaValue(alpha));
}

export function html2CanvasSafeCss(value: string, property = "") {
  if (!unsupportedColor.test(value)) return value;
  let safe = value
    .replace(/oklab\(([^()]*)\)/gi, (match, body) => parseOklab(body) || match)
    .replace(/oklch\(([^()]*)\)/gi, (match, body) => parseOklch(body) || match);
  if (!unsupportedColor.test(safe)) return safe;
  if (/shadow/i.test(property)) return "none";
  if (/background-image|filter/i.test(property)) return "none";
  if (/color|fill|stroke/i.test(property)) return "rgba(0, 0, 0, 0)";
  return "initial";
}

/** Normalize CSS Color 4 values in html2canvas's cloned document. */
export function prepareHtml2CanvasClone(clonedDocument: Document) {
  clonedDocument.querySelectorAll("style").forEach((style) => {
    if (style.textContent && unsupportedColor.test(style.textContent)) {
      style.textContent = style.textContent
        .replace(/oklab\(([^()]*)\)/gi, (match, body) => parseOklab(body) || match)
        .replace(/oklch\(([^()]*)\)/gi, (match, body) => parseOklch(body) || match);
    }
  });

  const view = clonedDocument.defaultView;
  if (!view) return;
  clonedDocument.querySelectorAll<HTMLElement>(".visual-page, .visual-page *, [data-html2canvas-safe], [data-html2canvas-safe] *").forEach((element) => {
    const computed = view.getComputedStyle(element);
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      const value = computed.getPropertyValue(property);
      if (!unsupportedColor.test(value)) continue;
      element.style.setProperty(property, html2CanvasSafeCss(value, property), "important");
    }
  });
}
