export function analysisMayBenefitFromChart(request: string): boolean {
  return !/\b(?:no|without|do not (?:add|include|use))\s+(?:any\s+)?(?:charts?|graphs?|visuals?)\b/i.test(request)
    && /\b(?:analy[sz]e|analysis|compare|comparison|trend|distribution|correlation|breakdown)\b/i.test(request);
}

export const ANALYSIS_VISUAL_DIRECTIVE = `When a comparison, trend, distribution, or relationship would be materially clearer visually, accompany the analysis with a suitable native visualization. Choose bar for category comparisons, line for ordered time-series, scatter for paired numerical observations, and a native diagram or qualitative table for non-numeric relationships. Do not force charts into every analysis. Use only supplied or retrieved numeric values, preserve units and dates, and cite the dataset. Never invent numbers to fill a chart or quantify subjective fictional power levels as facts. If a user explicitly requests illustrative or fan-made scoring, label the assumptions and scale clearly. If reliable values are unavailable, explain the limitation and use a qualitative comparison. Honor requested colors, ordering, axes, and labels. Keep the chart background transparent. Include numeric x coordinates on every line point when the X axis is numeric and intervals are unequal; use numeric x/y scatterPoints for paired measurements. Output charts as a fenced chart JSON block with type,title,xLabel,yLabel,bars/points/series,style,note,source; never use image generation for chart labels or data. Respect requests for text-only output.`;

/** Conservative extraction of explicit label: number pairs; never infer units. */
export function extractChartFromText(value: string) {
  const points: Array<{ label: string; value: number; unit: string }> = [];
  for (const match of value.matchAll(/(?:^|[;\n]|\.\s+|,\s+)\s*([A-Za-z][A-Za-z &/\-]{0,48}):\s*(-?\d+(?:\.\d+)?)\s*(%|[A-Za-z]+)?(?=\s*(?:[;\n,]|\.\s|\.$|$))/g)) {
    points.push({ label: match[1].trim(), value: Number(match[2]), unit: match[3] || "" });
  }
  if (points.length < 2 || points.length > 12 || new Set(points.map((point) => point.label.toLowerCase())).size !== points.length
    || new Set(points.map((point) => point.unit.toLowerCase())).size !== 1) return undefined;
  return { type: /\bline (?:chart|graph)\b/i.test(value) ? "line" as const : "bar" as const,
    title: "Supplied data comparison", unit: points[0].unit || undefined,
    data: points.map(({ label, value }) => ({ label, value })) };
}
