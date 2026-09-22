import { NextResponse } from "next/server";
import { generatePosterLayout } from "@/lib/poster/llm_router";
import { renderPosterAsset, type PosterMediaAsset } from "@/lib/poster/canvas_renderer";
import { extractChartFromText } from "@/lib/analysis-visuals";
import { backendUrl } from "@/lib/backend";

// Embed attributable raster assets only from known CDNs. Validate redirects too.
function allowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && /^(?:upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.wikia\.nocookie\.net|images\.(?:wikia|fandom)\.com|imgs\.search\.brave\.com)$/i.test(url.hostname);
  } catch { return false; }
}

async function downloadImage(image: { url: string; sourceUrl?: string; title?: string; attribution?: string }): Promise<PosterMediaAsset | undefined> {
  if (!allowedImageUrl(image.url)) return;
  let url = image.url;
  for (let redirect = 0; redirect < 3; redirect++) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "VOID-Infographic/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return;
      const next = new URL(location, url).href;
      if (!allowedImageUrl(next)) return;
      url = next;
      continue;
    }
    const mime = (response.headers.get("content-type") || "").split(';')[0];
    if (!response.ok || !/^image\/(?:png|jpeg|webp)$/i.test(mime) || Number(response.headers.get('content-length')) > 6 * 1024 * 1024) return;
    const reader = response.body?.getReader();
    if (!reader) return;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 6 * 1024 * 1024) { await reader.cancel(); return; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (length < 500) return;
    return { dataUrl: `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`, sourceUrl: image.sourceUrl || image.url,
      caption: image.title, attribution: image.attribution };
  }
}

async function findSubjectImages(subjects: string[]): Promise<PosterMediaAsset[]> {
  if (!subjects.length) return [];
  try {
    const response = await fetch(backendUrl('/api/agent/media'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjects }), signal: AbortSignal.timeout(38_000) });
    if (!response.ok) return [];
    const result = await response.json();
    if (!Array.isArray(result.images)) return [];
    const downloaded = await Promise.allSettled(result.images.slice(0, 3).map(downloadImage));
    return downloaded.flatMap((item) => item.status === 'fulfilled' && item.value ? [item.value] : []);
  } catch { return []; }
}

export async function POST(req: Request) {
  try {
    const { topic, rawText } = await req.json();
    if (typeof topic !== 'string' || !topic.trim() || topic.length > 12000 || (rawText !== undefined && (typeof rawText !== 'string' || rawText.length > 24000))) {
      return NextResponse.json({ error: 'A topic and optional text brief are required (maximum 12,000 / 24,000 characters).' }, { status: 400 });
    }
    const brief = rawText || topic;
    const wantsInfographic = /\b(?:infographics?|information graphic|visual (?:analysis|explainer|summary|overview|breakdown)|at[- ]a[- ]glance)\b/i.test(topic)
      || /\b(?:analy[sz]e|explain|summari[sz]e)\b[^.!?]{0,80}\bvisually\b/i.test(topic);
    const subject = topic.split(/\n\nRequested changes:/i)[0].replace(/^.*?\b(?:infographics?|information graphic|visual (?:analysis|explainer|summary|overview|breakdown))\s*(?:on|about|for|of)?\s*/i, '').trim();
    const { layout, providerUsed } = await generatePosterLayout(subject, brief, wantsInfographic);
    // Cached layouts belong to the content generator; never mutate them.
    const renderLayout = { ...layout, sections: layout.sections.map((section) => ({ ...section })) };
    const suppliedChart = extractChartFromText(brief);
    if (wantsInfographic) {
      // A plausible-looking model number is not evidence. Preserve qualitative
      // timelines/comparisons; require explicit data pairs for numerical charts.
      renderLayout.sections = renderLayout.sections.map((section) => ({ ...section, chart: undefined }));
      if (suppliedChart) {
        const existing = renderLayout.sections.findIndex((section) => section.type === 'chart');
        const chartSection = { id: 'supplied-data-chart', title: suppliedChart.title, type: 'chart' as const, chart: suppliedChart };
        if (existing >= 0) renderLayout.sections[existing] = chartSection;
        else renderLayout.sections.splice(1, 0, chartSection);
      }
      renderLayout.sections = renderLayout.sections.filter((section) => section.chart || section.bodyText || section.bullets?.length || section.timeline?.length || section.metrics?.length);
    }
    const noImages = /\b(?:no|without|do not (?:use|add|include))\s+(?:any\s+)?(?:pics?|pictures?|photos?|images?)\b/i.test(brief);
    const subjects = layout.mediaSubjects?.length ? layout.mediaSubjects : [subject.slice(0, 120)];
    const media = wantsInfographic && !noImages ? await findSubjectImages(subjects) : [];
    renderLayout.sources = [...new Set([...(layout.sources || []), ...media.flatMap((image) => image.sourceUrl ? [image.sourceUrl] : [])])];
    const rendered = await renderPosterAsset(renderLayout, media);
    return NextResponse.json({ success: true, providerUsed, pngUrl: rendered.pngUrl, pdfUrl: rendered.pdfUrl, layout: renderLayout,
      media: media.map(({ sourceUrl, caption, attribution }) => ({ sourceUrl, caption, attribution })),
      warnings: !noImages && /\b(?:pics?|pictures?|photos?|images?)\b/i.test(brief) && !media.length ? ['No suitable source images could be loaded; this infographic contains native text and visuals only.'] : [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to render infographic.' }, { status: 500 });
  }
}
