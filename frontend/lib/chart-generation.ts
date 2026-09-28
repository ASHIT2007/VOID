/** Only fictional/fan comparisons may use a declared subjective scale. */
export function isSubjectiveChartRequest(request: string): boolean {
  if (/\b(?:fan[- ]made|subjective|illustrative|imaginary|random|hypothetical)\b/i.test(request)) return true;
  if (/\b(?:official|canonical|canon|base stats?|actual statistics|measured)\b/i.test(request)) return false;
  return /\b(?:power levels?|battle (?:power|strength)|strongest|strength ranking)\b/i.test(request)
    && /\b(?:pok[eé]mons?|anime|fictional|characters?|superheroes?|dragon ball|naruto)\b/i.test(request);
}

export const CHART_GENERATION_DIRECTIVE = `Native chart output contract:
- Return a concise interpretation and exactly one fenced chart JSON block, never chart implementation code, an image, or a screenshot. Do not call image generation for charts.
- Use numeric JSON values, preserve category order, units, zero, negative values and actual X/Y coordinates. Never substitute ordinal positions for numeric X values. Keep the container and plot transparent.
- Category comparison example schema: {"type":"bar","title":"Comparison","xLabel":"Category","yLabel":"Value (unit)","bars":[{"label":"Category A","value":12},{"label":"Category B","value":27}]}.
- Supported types: bar, horizontal-bar, stacked-bar, pie, donut, line, area, scatter, radar, funnel, gauge, timeline, treemap, waterfall, progress. Bar/horizontal-bar use bars:[{label,value}]; pie/donut use slices:[{label,value}]; line/area use points:[{label,value,x?}] and optional series:[{name,values}]; scatter uses scatterPoints:[{x,y,label?}]. Every plotted value must be a finite number. Numeric X coordinates must be present on every line point. Do not output Chart.js/Python/JavaScript configurations.
- Include title, subtitle, xLabel, yLabel, note and source when helpful. Optional yTicks:[{value,label}] describe actual scale values. Optional style may contain palette, showValues, roundedBars, lineWidth and pointSize.
- For real-world factual data or explicitly requested official statistics, use only supplied or verified numeric evidence, with dates/units and honest attribution. Never invent missing measurements or sources. When evidence is insufficient, explain what data is missing in ordinary text instead of returning an empty chart.
- A requested fictional power/strength comparison may use subjective fan ratings when no official numeric power scale exists. Clearly say that before the chart and in its subtitle/note, define the scale and rubric (such as depicted battle feats), and briefly explain the ranking. Never present those ratings as canon, measured statistics or a retrieved dataset. Do not silently replace explicitly requested official/base statistics with fan scores. Random/illustrative charts must likewise be labeled.`;

export function subjectiveChartInstruction(request: string): string {
  return isSubjectiveChartRequest(request)
    ? '\nThis request permits a clearly labeled subjective/illustrative comparison. Use a declared numeric scale and explain the assumptions; do not reject it merely because official power-level numbers do not exist.' : '';
}
