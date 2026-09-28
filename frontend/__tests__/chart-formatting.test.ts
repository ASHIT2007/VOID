import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartViewer from '../components/ChartViewer';
import { chartAnswer, chartFallback, chartNumber, chartValueLabel, isNativeChartRequest, linearScale, parseChartData } from '../lib/chart-data';
import { isSubjectiveChartRequest } from '../lib/chart-generation';

describe('accurate chart data', () => {
  it('accepts provider score aliases and chart wrappers without inventing values', () => {
    const chart = parseChartData(JSON.stringify({ chart: { type: 'bar_chart', title: 'Ash’s Pokémon', data: [{ pokemon: 'Pikachu', powerLevel: '95' }, { pokemon: 'Charizard', score: 0 }] } }));
    expect(chart?.type).toBe('bar');
    expect(chart?.bars?.map(bar => [bar.label, bar.value])).toEqual([['Pikachu', 95], ['Charizard', 0]]);
    expect(parseChartData(JSON.stringify({ title: 'Missing', data: [{ pokemon: 'Pikachu', powerLevel: 'very strong' }] }))).toBeNull();
  });
  it('normalizes label/value and Chart.js datasets, retaining all series and rejecting mismatched lengths', () => {
    const simple = { type: 'bar', title: 'Scores', labels: ['A', 'B'], values: [0, '-2.5'] };
    expect(parseChartData(JSON.stringify(simple))?.bars?.map(bar => bar.value)).toEqual([0, -2.5]);
    const chartjs = { type: 'line', title: 'Measures', data: { labels: ['A', 'B'], datasets: [{ label: 'First', data: [0, 8] }, { label: 'Second', data: [4, -2] }] } };
    expect(parseChartData(JSON.stringify(chartjs))?.series).toEqual([{ name: 'First', values: [0, 8] }, { name: 'Second', values: [4, -2] }]);
    expect(parseChartData(JSON.stringify({ ...simple, values: [2] }))).toBeNull();
    expect(parseChartData(JSON.stringify({ ...simple, values: [2, 3, 4] }))).toBeNull();
    expect(parseChartData(JSON.stringify({ ...chartjs, type: 'bar' }))).toBeNull(); // Never silently drop another dataset.
    const numericX = parseChartData(JSON.stringify({ type: 'line', title: 'Irregular intervals', labels: [0, 1, 10], values: [2, -3, 5] }));
    expect(numericX?.points?.map(point => point.x)).toEqual([0, 1, 10]);
  });
  it('finds an unfenced chart surrounded by prose and keeps code out of fallback answers', () => {
    const answer = chartAnswer('A comparison.\n{"type":"bar","title":"A title with } in it","bars":[{"label":"A","value":12}]}\nRatings are subjective.', { subjective: true });
    expect(answer).toMatch(/^A comparison\./);
    expect(answer).toContain('Ratings are subjective.');
    expect(answer).toContain('not official statistics');
    expect(answer?.match(/"title"/g)).toHaveLength(1);
    expect(chartFallback('No official scale exists.\n```python\nplt.bar([1], [2])\n```')).toBe('No official scale exists.');
    expect(chartFallback('{"title":"Broken","data":[')).toBe('');
    expect(chartFallback('const chart = new Chart(ctx, options);')).toBe('');
  });
  it('permits disclosed fictional power ratings while honoring explicit official stats', () => {
    expect(isSubjectiveChartRequest('make an chart comparing power level of ash pokemons')).toBe(true);
    expect(isSubjectiveChartRequest('Compare official Pokémon base stats in a chart')).toBe(false);
    expect(isSubjectiveChartRequest('Chart real stock prices')).toBe(false);
    expect(isSubjectiveChartRequest('Make a random chart')).toBe(true);
  });
  it('rejects missing/non-numeric values in every numeric chart format rather than drawing defaults', () => {
    for (const data of [
      { type: 'radar', axes: [{ label: 'Strength' }] },
      { type: 'funnel', stages: [{ label: 'A', value: 'unknown' }] },
      { type: 'treemap', nodes: [{ label: 'A', value: null }] },
      { type: 'waterfall', steps: [{ label: 'A', value: 'unknown' }] },
      { type: 'progress', items: [{ label: 'A', value: 'unknown' }] },
      { type: 'gauge', value: 'unknown', max: 100 },
    ]) expect(parseChartData(JSON.stringify({ title: 'Missing measurements', ...data }))).toBeNull();
    const radar = parseChartData(JSON.stringify({ title: 'Radar', type: 'radar', axes: [{ label: 'Strength' }], series: [{ name: 'A', values: ['90'] }] }));
    expect(radar?.series?.[0].values).toEqual([90]);
    expect(parseChartData(JSON.stringify({ title: 'Progress', type: 'progress', items: [{ label: 'A', value: '0', max: '10' }] }))?.items?.[0]).toMatchObject({ value: 0, max: 10 });
    const zeroWaterfall = parseChartData(JSON.stringify({ title: 'Zero', type: 'waterfall', steps: [{ label: 'A', value: 0 }] }))!;
    expect(renderToStaticMarkup(React.createElement(ChartViewer, { data: zeroWaterfall }))).not.toMatch(/NaN|Infinity/);
  });
  it('does not round small measurements to zero or hide decimal precision', () => {
    expect(chartValueLabel(0.00000012)).toBe('1.2e-7');
    expect(chartValueLabel(1.23456789)).toBe('1.23456789');
    expect(chartValueLabel(0)).toBe('0');
    expect(linearScale([0.00000012, 0.00000025]).ticks.some(tick => tick.value > 0 && tick.label === '0')).toBe(false);
  });
  it('preserves numeric strings, zero, negative values and decimals without invented scores', () => {
    expect(['12', '18', '0', '-12.5', '1,250'].map(chartNumber)).toEqual([12, 18, 0, -12.5, 1250]);
    expect(['O(1)', 'O(n)', 'unknown', '12 bananas', '', null, Infinity].map(chartNumber)).toEqual(Array(7).fill(null));
    expect(parseChartData(JSON.stringify({ title: 'Invalid data', bars: [{ label: 'A', value: 'O(n)' }] }))).toBeNull();
  });
  it('maps common data payloads without swapping axes or losing X coordinates', () => {
    const data = parseChartData(JSON.stringify({ type: 'line', title: 'Irregular X', data: [{ x: 0, y: 2 }, { x: 1, y: -3 }, { x: 10, y: 5 }] }));
    expect(data?.points).toEqual([{ x: 0, y: 2, label: '0', value: 2 }, { x: 1, y: -3, label: '1', value: -3 }, { x: 10, y: 5, label: '10', value: 5 }]);
    expect(parseChartData(JSON.stringify({ type: 'scatter', title: 'Scatter', scatterPoints: [{ x: '-2', y: '4' }, { x: '5', y: '-1' }] }))?.scatterPoints)
      .toEqual([{ x: -2, y: 4, label: '', color: undefined }, { x: 5, y: -1, label: '', color: undefined }]);
    expect(parseChartData(JSON.stringify({ title: 'Deck', slides: [{ title: 'Slide' }] }))).toBeNull();
  });
  it('places values and irregular ticks on a linear scale that includes all data', () => {
    const scale = linearScale([-5, 0, 15], { includeZero: true, ticks: [{ value: -10, label: 'Low' }, { value: 0, label: 'Zero' }, { value: 20, label: 'High' }] });
    expect(scale.position(0, 300)).toBe(100);
    expect(scale.position(15, 300)).toBe(250);
    expect(scale.position(-5, 300)).toBe(50);
    expect(linearScale([0], { includeZero: true }).position(0, 100)).toBe(0);
    expect(linearScale([2.5, 2.5]).max).toBeGreaterThan(2.5);
  });
  it('renders actual proportional bar heights and an invisible zero bar', () => {
    const html = renderToStaticMarkup(React.createElement(ChartViewer, { data: { type: 'bar', title: 'Bar chart', xLabel: 'Category', yLabel: 'Value',
      bars: [{ label: 'A', value: '12' }, { label: 'B', value: '27' }, { label: 'C', value: 0 }] } }));
    const heights = [...html.matchAll(/<rect data-chart-mark="bar"[^>]*height="([\d.]+)"/g)].map(match => Number(match[1]));
    expect(heights).toHaveLength(3);
    expect(heights[0] / heights[1]).toBeCloseTo(12 / 27, 10);
    expect(heights[2]).toBe(0);
    expect(html).toContain('rotate(-90)');
    expect(html).toContain('<title>A: 12</title>');
    expect(html).not.toContain('<title></title>');
    expect(html).toContain('>Category</text>');
    expect(html).toContain('background:transparent');
    expect(html).not.toContain('background:#');
  });
  it('plots unequal numeric X intervals and signed scatter coordinates correctly', () => {
    const line = parseChartData(JSON.stringify({ type: 'line', title: 'Line', points: [{ label: '0', x: 0, value: 2 }, { label: '1', x: 1, value: 3 }, { label: '10', x: 10, value: 1 }] }))!;
    const html = renderToStaticMarkup(React.createElement(ChartViewer, { data: line }));
    const x = [...html.matchAll(/<circle data-chart-mark="point"[^>]*cx="([\d.]+)"/g)].map(match => Number(match[1]));
    expect((x[1] - x[0]) / (x[2] - x[0])).toBeCloseTo(0.1, 10);
    const scatter = parseChartData(JSON.stringify({ type: 'scatter', title: 'Signed', scatterPoints: [{ x: -3, y: -2 }, { x: 0, y: 0 }, { x: 3, y: 2 }] }))!;
    const rendered = renderToStaticMarkup(React.createElement(ChartViewer, { data: scatter }));
    expect(rendered).toContain('data-x="-3" data-y="-2"');
    expect(rendered).not.toMatch(/NaN|Infinity/);
  });
  it('preserves pie proportions, rejects negative slices and overrides generated backgrounds', () => {
    const data = parseChartData(JSON.stringify({ type: 'pie', title: 'Pie', slices: [{ label: 'A', value: 30 }, { label: 'B', value: 45 }, { label: 'C', value: 25 }], style: { background: '#fff' } }))!;
    const html = renderToStaticMarkup(React.createElement(ChartViewer, { data }));
    expect(html).toContain('30%'); expect(html).toContain('45%'); expect(html).toContain('25%');
    expect(data.style?.background).toBe('transparent');
    expect(parseChartData(JSON.stringify({ type: 'pie', title: 'Bad', slices: [{ label: 'A', value: -1 }] }))).toBeNull();
    expect(isNativeChartRequest('Make a chart')).toBe(true);
    expect(isNativeChartRequest('Show the source code for a bar chart')).toBe(false);
  });
  it('normalizes unfenced JSON and removes implementation code around valid chart data', () => {
    const json = JSON.stringify({ type: 'bar', title: 'Chart', bars: [{ label: 'A', value: 0 }] });
    expect(chartAnswer(json)).toMatch(/^```chart\n/);
    const answer = chartAnswer(`Actual values.\n\n\`\`\`python\nsecret_code()\n\`\`\`\n\`\`\`chart ${json}\`\`\``);
    expect(answer).toMatch(/^Actual values\.\n\n```chart\n/);
    expect(answer).not.toContain('secret_code');
    expect(chartAnswer('No numeric chart data.')).toBeNull();
    const one = renderToStaticMarkup(React.createElement(ChartViewer, { data: { type: 'pie', title: 'Single category', slices: [{ label: 'A', value: 100 }] } }));
    expect(one).toContain('A 100 100 0 1 0');
  });
  it('keeps negative horizontal and stacked bars on the same zero baseline', () => {
    for (const data of [
      { type: 'horizontal-bar', title: 'Signed values', bars: [{ label: 'A', value: -5 }, { label: 'B', value: 10 }] },
      { type: 'stacked-bar', title: 'Signed stacks', stackedBars: [{ label: 'A', segments: [{ label: 'Loss', value: -5 }, { label: 'Gain', value: 10 }] }] },
    ]) {
      const chart = parseChartData(JSON.stringify(data))!;
      const html = renderToStaticMarkup(React.createElement(ChartViewer, { data: chart }));
      expect(html).toContain('data-value="-5"'); expect(html).toContain('data-value="10"');
      expect(html).not.toMatch(/NaN|Infinity|height="-/);
    }
  });
  it('honors a named charcoal palette and ignores malformed optional styling', () => {
    const data = parseChartData(JSON.stringify({ type: 'pie', title: 'Pie', xLabel: {}, subtitle: {},
      slices: [{ label: 'A', value: 30, color: {} }, { label: 'B', value: 70 }], style: { background: '#fff', palette: ['charcoal'], pointSize: 'huge', fontFamily: {} } }))!;
    const html = renderToStaticMarkup(React.createElement(ChartViewer, { data }));
    expect(html).toContain('fill="#404040"');
    expect(html).not.toContain('fill="#3b82f6"');
    expect(data.subtitle).toBeUndefined(); expect(data.xLabel).toBeUndefined();
    expect(data.style?.pointSize).toBeUndefined();
  });
});
