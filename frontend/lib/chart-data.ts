import type { ChartData } from '../components/ChartViewer';

export function chartNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  // Accept numeric strings and thousands separators; never invent values for prose or complexity notation.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) return null;
  const numeric = Number(text.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

export function chartValueLabel(value: number): string {
  const absolute = Math.abs(value);
  return value !== 0 && (absolute < 0.0001 || absolute >= 1e9) ? value.toExponential(3).replace(/\.?0+e/, 'e')
    : value.toLocaleString('en-US', { maximumSignificantDigits: 12 });
}

export function linearScale(values: number[], { includeZero = false, ticks = [] }: {
  includeZero?: boolean; ticks?: { value: number; label: string }[];
} = {}) {
  const finite = [...values, ...ticks.map(tick => tick.value)].filter(Number.isFinite);
  if (includeZero || !finite.length) finite.push(0);
  let min = Math.min(...finite), max = Math.max(...finite);
  if (min === max) { const padding = Math.abs(min) * 0.2 || 1; min -= includeZero && min === 0 ? 0 : padding; max += padding; }
  const roughStep = (max - min) / 5;
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / power;
  const step = ([1, 2, 2.5, 5, 10].find(candidate => candidate >= fraction) || 10) * power;
  if (!ticks.length) { min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step; }
  const positions = ticks.length ? [...ticks].sort((a, b) => a.value - b.value)
    : Array.from({ length: Math.min(Math.round((max - min) / step) + 1, 12) }, (_, index) => {
      const value = Number((min + index * step).toPrecision(12));
      return { value, label: chartValueLabel(value) };
    });
  return { min, max, ticks: positions, position: (value: number, size: number) => (value - min) / (max - min) * size };
}

export function isNativeChartRequest(request: string): boolean {
  return /\b(?:chart|graph|plot|data visualization|visualise|visualize)\b/i.test(request)
    && /\b(?:make|create|generate|build|draw|plot|show|compare|visualise|visualize)\b/i.test(request)
    && !/\b(?:show|provide|write|give|include)\s+(?:(?:me|the|source)\s+)*code\b/i.test(request);
}

/** Locate complete JSON objects without a greedy match swallowing surrounding prose. */
function jsonObjects(content: string): Array<{ raw: string; start: number; end: number }> {
  const objects: Array<{ raw: string; start: number; end: number }> = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (start < 0) { if (character === '{') { start = index; depth = 1; } continue; }
    if (escaped) { escaped = false; continue; }
    if (quoted && character === '\\') { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === '{') depth++;
    if (character === '}' && --depth === 0) {
      objects.push({ raw: content.slice(start, index + 1), start, end: index + 1 }); start = -1;
    }
  }
  return objects;
}

export function chartFallback(content: string): string {
  let prose = content.replace(/```[\s\S]*?(?:```|$)/g, '').trim();
  for (const object of jsonObjects(prose).reverse()) prose = prose.slice(0, object.start) + prose.slice(object.end);
  // An unfinished data/configuration object or unfenced implementation is never an answer.
  if (/[{\[]\s*"|\b(?:import .* from|plt\.|new Chart\(|const \w+\s*=)/.test(prose)) return '';
  return prose.trim();
}

export function chartAnswer(content: string, { subjective = false }: { subjective?: boolean } = {}): string | null {
  const blocks = [...content.matchAll(/```(?:chart|json|barchart|visualization|plot)\s*([\s\S]*?)```/gi)];
  const block = blocks.find(match => parseChartData(match[1]));
  const object = !block ? jsonObjects(content).find(candidate => parseChartData(candidate.raw)) : undefined;
  const data = parseChartData(block?.[1] || object?.raw || content);
  if (!data) return null;
  const prose = chartFallback(content);
  if (subjective) {
    const disclosure = 'Subjective/illustrative ratings, not official statistics.';
    data.note = `${disclosure}${data.note ? ` ${data.note}` : ''}`;
  }
  return `${prose ? prose + '\n\n' : ''}\`\`\`chart\n${JSON.stringify(data)}\n\`\`\``;
}

function records(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every(item => item && typeof item === 'object' && !Array.isArray(item)) ? value : null;
}

export function parseChartData(raw: string): ChartData | null {
  try {
    const decoded = JSON.parse(raw.trim().replace(/^```(?:json|chart|barchart|visualization|plot)?\s*/i, '').replace(/\s*```$/, '').trim());
    const parsed = decoded?.chart && typeof decoded.chart === 'object' && !Array.isArray(decoded.chart) ? decoded.chart : decoded;
    if (!parsed || typeof parsed.title !== 'string' || !parsed.title.trim()) return null;
    const data = { ...parsed } as ChartData;
    if (typeof data.type === 'string') {
      const type = data.type.toLowerCase().replace(/[_\s]/g, '-').replace(/-?chart$/, '');
      data.type = (type === 'doughnut' ? 'donut' : type === 'horizontalbar' ? 'horizontal-bar' : type) as ChartData['type'];
    }
    const tabular = parsed.data && !Array.isArray(parsed.data) && typeof parsed.data === 'object' ? parsed.data : parsed;
    const labels = tabular.labels;
    const datasets = records(tabular.datasets);
    if (Array.isArray(labels) && (datasets || Array.isArray(tabular.values))) {
      if (!labels.length || labels.length > 200 || labels.some(label => typeof label !== 'string' && typeof label !== 'number')) return null;
      const values = datasets ? datasets.map(dataset => dataset.data) : [tabular.values];
      if (values.some(series => !Array.isArray(series) || series.length !== labels.length || series.some(value => chartNumber(value) === null))) return null;
      if (values.length > 1 && !['line', 'area'].includes(data.type || '')) return null;
      if (values.length > 1) data.series = datasets!.map((dataset, index) => ({ name: String(dataset.label || dataset.name || `Series ${index + 1}`), values: (values[index] as unknown[]).map(value => chartNumber(value)!) }));
      delete (data as ChartData & { data?: unknown }).data;
      const numericX = ['line', 'area'].includes(data.type || '') && labels.every(label => chartNumber(label) !== null);
      parsed.data = labels.map((label, index) => ({ label: String(label), value: chartNumber((values[0] as unknown[])[index])!, ...(numericX ? { x: chartNumber(label)! } : {}) }));
    }
    for (const field of ['subtitle', 'xLabel', 'yLabel', 'unit', 'note', 'source'] as const) {
      if (data[field] !== undefined && typeof data[field] !== 'string') delete data[field];
    }
    data.type ||= data.stackedBars ? 'stacked-bar' : data.slices ? 'pie' : data.scatterPoints ? 'scatter' : data.points || data.series ? 'line'
      : data.axes ? 'radar' : data.stages ? 'funnel' : data.events ? 'timeline' : data.steps ? 'waterfall' : data.items ? 'progress'
      : data.nodes ? 'treemap' : data.value !== undefined && data.max !== undefined ? 'gauge' : 'bar';
    const rows = records(parsed.data);
    const labeledValues = (input: unknown) => {
      const items = records(input);
      if (!items) return null;
      const result = items.map(item => ({ ...item, label: String(item.label ?? item.name ?? item.category ?? item.pokemon ?? item.x ?? ''), value: chartNumber(item.value ?? item.y ?? item.score ?? item.rating ?? item.powerLevel ?? item.power_level),
        ...(typeof item.color !== 'string' && item.color !== undefined ? { color: undefined } : {}) }));
      return result.every(item => item.label && item.value !== null) ? result as Array<Record<string, unknown> & { label: string; value: number; color?: string; x?: number }> : null;
    };
    if (['bar', 'horizontal-bar'].includes(data.type)) {
      const bars = labeledValues(data.bars || rows); if (!bars) return null; data.bars = bars;
    } else if (['pie', 'donut'].includes(data.type)) {
      const slices = labeledValues(data.slices || data.bars || rows);
      if (!slices || slices.some(slice => slice.value < 0) || !slices.some(slice => slice.value > 0)) return null;
      data.slices = slices;
    } else if (['line', 'area'].includes(data.type)) {
      if (!data.points && Array.isArray(parsed.labels) && records(data.series)) {
        data.points = parsed.labels.map((label: unknown, index: number) => ({ label: String(label), value: data.series![0].values[index] }));
      }
      const points = labeledValues(data.points || rows); if (!points) return null; data.points = points;
      if (points.some(point => point.x !== undefined)) {
        if (points.some(point => chartNumber(point.x) === null)) return null;
        data.points = points.map(point => ({ ...point, x: chartNumber(point.x)! }));
      }
      if (data.series && (!records(data.series) || data.series.some(series => typeof series.name !== 'string' || !Array.isArray(series.values)
        || series.values.length !== points.length || series.values.some(value => chartNumber(value) === null)))) return null;
      data.series = data.series?.map(series => ({ ...series, values: series.values.map(value => chartNumber(value)!) }));
    } else if (data.type === 'scatter') {
      const points = records(data.scatterPoints || rows);
      if (!points || points.some(point => chartNumber(point.x) === null || chartNumber(point.y) === null)) return null;
      data.scatterPoints = points.map(point => ({ x: chartNumber(point.x)!, y: chartNumber(point.y)!, label: String(point.label || ''), color: typeof point.color === 'string' ? point.color : undefined }));
    } else if (data.type === 'stacked-bar') {
      const stacks = records(data.stackedBars);
      if (!stacks || stacks.some(stack => typeof stack.label !== 'string' || !labeledValues(stack.segments))) return null;
      data.stackedBars = stacks.map(stack => ({ label: String(stack.label), segments: labeledValues(stack.segments)! }));
    } else if (data.type === 'radar') {
      const axes = records(data.axes);
      if (!axes || axes.some(axis => typeof axis.label !== 'string' || !axis.label.trim()
        || (axis.max !== undefined && (chartNumber(axis.max) === null || chartNumber(axis.max)! <= 0)))) return null;
      const series = records(data.series || data.radarSeries);
      if (series) {
        if (series.some(item => typeof item.name !== 'string' || !Array.isArray(item.values) || item.values.length !== axes.length
          || item.values.some((value, index) => chartNumber(value) === null || chartNumber(value)! < 0 || chartNumber(value)! > (chartNumber(axes[index].max) ?? 100)))) return null;
        data.series = series.map(item => ({ name: String(item.name), color: typeof item.color === 'string' ? item.color : undefined, values: (item.values as unknown[]).map(value => chartNumber(value)!) }));
      } else if (data.series || data.radarSeries || axes.some(axis => chartNumber(axis.value) === null || chartNumber(axis.value)! < 0 || chartNumber(axis.value)! > (chartNumber(axis.max) ?? 100))) return null;
      data.axes = axes.map(axis => ({ label: String(axis.label), ...(axis.value !== undefined ? { value: chartNumber(axis.value)! } : {}), max: chartNumber(axis.max) ?? 100 }));
    } else if (data.type === 'timeline') {
      const events = records(data.events);
      if (!events || events.some(event => typeof event.date !== 'string' || typeof event.title !== 'string' || !event.title.trim()
        || (event.description !== undefined && typeof event.description !== 'string'))) return null;
    } else if (data.type === 'gauge') {
      const value = chartNumber(data.value), max = chartNumber(data.max);
      if (value === null || max === null || max <= 0 || value < 0 || value > max) return null;
      data.value = value; data.max = max;
    } else if (data.type === 'funnel' || data.type === 'treemap') {
      const field = data.type === 'funnel' ? 'stages' : 'nodes';
      const values = labeledValues(data[field]);
      if (!values || values.some(item => item.value < 0) || !values.some(item => item.value > 0)) return null;
      data[field] = values;
    } else if (data.type === 'waterfall') {
      const steps = labeledValues(data.steps);
      if (!steps || steps.some(step => step.type !== undefined && !['increase', 'decrease', 'total'].includes(String(step.type)))) return null;
      data.steps = steps;
    } else if (data.type === 'progress') {
      const items = labeledValues(data.items);
      if (!items || items.some(item => item.value < 0 || (item.max !== undefined && chartNumber(item.max) === null)
        || (chartNumber(item.max) ?? 100) <= 0 || item.value > (chartNumber(item.max) ?? 100))) return null;
      data.items = items.map(item => ({ ...item, max: chartNumber(item.max) ?? 100 }));
    } else {
      return null;
    }
    if (data.yTicks && (!Array.isArray(data.yTicks) || data.yTicks.some(tick => !tick || !Number.isFinite(tick.value) || typeof tick.label !== 'string'))) return null;
    // Generated containers always inherit the chat background and text contrast.
    const style = data.style && typeof data.style === 'object' && !Array.isArray(data.style) ? { ...data.style } : {};
    if (style.fontFamily !== undefined && typeof style.fontFamily !== 'string') delete style.fontFamily;
    if (style.palette !== undefined) style.palette = Array.isArray(style.palette) ? style.palette.filter(color => typeof color === 'string') : undefined;
    for (const key of ['pointSize', 'lineWidth'] as const) {
      if (style[key] !== undefined && (!Number.isFinite(style[key]) || style[key]! <= 0)) delete style[key];
    }
    data.style = { ...style, background: 'transparent', surface: 'transparent' };
    return data;
  } catch { return null; }
}

const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6'];
const named: Record<string, string> = { blue: palette[0], emerald: palette[1], amber: palette[2], violet: palette[3], rose: palette[4], teal: palette[5],
  black: '#171717', white: '#ffffff', gray: '#737373', charcoal: '#404040', red: '#ef4444', green: '#22c55e', orange: '#f97316', cyan: '#06b6d4', pink: '#ec4899', indigo: '#6366f1' };
export function chartColor(color: string | undefined, index: number, custom?: string[]): string {
  const value = color || custom?.[index % Math.max(custom.length, 1)];
  return typeof value === 'string' && /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(value) ? value
    : value && Object.hasOwn(named, value) ? named[value] : palette[index % palette.length];
}
