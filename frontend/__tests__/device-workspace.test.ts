import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
const imageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/design/design-image-client', () => ({ requestDesignImage: imageMock }));
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { generateDeviceFile } from '../lib/workspace/generate-file';
import { usageSummary, type UsageRecord } from '../lib/workspace/device-store';
import { normalizeMermaid } from '@void/shared/diagram-contract.mjs';
import { readDeviceFile } from '../lib/workspace/read-file';
const sections = [{ heading: 'Results', text: 'A useful report.', bullets: ['First item'], table: [['Category', 'Value'], ['A', '12']] }];
describe('real device-generated files', () => {
  it('embeds completed model images in actual PPTX image parts with provenance', async () => {
    imageMock.mockResolvedValue({ url: '/api/generated-image/fixture.png', modelUsed: 'User model', generated: true });
    const png = await readFile(new URL('../public/void%20logo%20white.png', import.meta.url));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png, { headers: { 'Content-Type': 'image/png' } })));
    vi.stubGlobal('FileReader', class {
      result = ''; onload?: () => void;
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(buffer => { this.result = `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.(); }); }
    });
    try {
      const file = await generateDeviceFile('generate_presentation', { title: 'Snow leopard', slides: [{ title: 'Snow leopard habitat', text: 'Snow leopards live in mountains.', imageSubject: 'Snow leopard', imagePrompt: 'Supporting habitat illustration' }, { title: 'Conservation', text: 'Protect habitats.' }] });
      const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
      expect(Object.keys(zip.files).some(name => /^ppt\/media\/.*\.png$/.test(name))).toBe(true);
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
      expect(xml).toContain('AI-generated illustration'); expect(xml).toContain('User model');
      expect(imageMock.mock.calls.at(-1)?.[0]).toMatchObject({ subject: 'Snow leopard', source: 'auto' });
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps an image failure field in the exported PPTX without dropping slide content', async () => {
    imageMock.mockRejectedValue(new Error('This image could not be generated because the image model encountered a problem.'));
    const file = await generateDeviceFile('generate_presentation', { title: 'Snow leopard', slides: [{ title: 'Habitat', text: 'Snow leopards live in mountains.', imageSubject: 'Snow leopard', imagePrompt: 'Habitat illustration' }] });
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('image model encountered a problem'); expect(xml).toContain('Snow leopards live in mountains.');
    expect(Object.keys(zip.files).some(name => /^ppt\/media\/.*\.png$/.test(name))).toBe(false);
  });
  it('writes Word headings, tables and genuine DOCX parts', async () => {
    const file = await generateDeviceFile('generate_document', { title: 'Report', sections });
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer()); const xml = await zip.file('word/document.xml')!.async('string');
    expect(file.filename).toBe('Report.docx'); expect(xml).toContain('Results'); expect(xml).toContain('w:tbl'); expect(xml).toContain('Heading1');
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('Calibri');
    expect(await readDeviceFile(new File([file.blob], 'report.docx'))).toContain('A useful report.');
  });
  it('writes real PowerPoint slides, native chart data and speaker notes with an accurate brief', async () => {
    const file = await generateDeviceFile('generate_presentation', { title: 'Sales', slides: [{ title: 'Overview', bullets: ['A useful insight'], notes: 'Explain this finding.' }, { title: 'Comparison', chart: { type: 'bar', labels: ['A', 'B'], values: [12, 27] } }] });
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    expect(file.summary).toContain('2-slide'); expect(file.summary).toContain('Comparison');
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('A useful insight');
    expect(await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')).toContain('Explain this finding');
    expect(await zip.file('ppt/charts/chart1.xml')!.async('string')).toContain('27');
  });
  it('writes multiple Excel sheets, formulas, styles and native chart relationships', async () => {
    const file = await generateDeviceFile('generate_spreadsheet', { title: 'Budget', sheets: [
      { name: 'Sales', rows: [['Category', 'Value'], ['A', 12], ['B', 27], ['Total', { formula: 'SUM(B2:B3)', result: 39, format: '0.00' }]], chart: { type: 'bar', labels: ['A', 'B'], values: [12, 27] } },
      { name: 'Notes', rows: [['Description'], ['Illustrative values']] }] });
    const buffer = await file.blob.arrayBuffer(); const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file('xl/charts/chart1.xml')!.async('string')).toContain('_VOID_Chart1');
    expect(await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string')).toContain('drawing1.xml');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet('Sales')!.getCell('B4').value).toEqual({ formula: 'SUM(B2:B3)', result: 39 });
    expect(workbook.getWorksheet('Sales')!.getCell('B4').numFmt).toBe('0.00'); expect(workbook.getWorksheet('Notes')!.getCell('A2').value).toBe('Illustrative values');
    expect(await readDeviceFile(new File([file.blob], 'budget.xlsx'))).toContain('Illustrative values');
  });
  it('writes an actual PDF with fillable form fields', async () => {
    const file = await generateDeviceFile('generate_pdf', { title: 'Report', sections, fields: [{ name: 'reviewer', label: 'Reviewer' }] });
    const pdf = new TextDecoder().decode(await file.blob.arrayBuffer());
    expect(pdf).toMatch(/^%PDF-/); expect(pdf).toContain('/AcroForm'); expect(pdf).toContain('reviewer');
  });
  it('rejects renamed Office files and invalid chart pairings', async () => {
    await expect(generateDeviceFile('file_write', { filename: 'fake.docx', content: '<html>Fake</html>' })).rejects.toThrow('format generator');
    await expect(generateDeviceFile('generate_presentation', { title: 'Invalid', slides: [{ title: 'Chart', chart: { type: 'bar', labels: ['A'], values: [1, 2] } }] })).rejects.toThrow('matching');
  });
});
describe('device transparency', () => {
  const records: UsageRecord[] = [{ id: '1', conversationId: 'a', providerId: 'custom', modelId: 'model', inputTokens: 1000, outputTokens: 2000, estimated: false }];
  it('reports unknown cost until rates are configured and calculates known rates accurately', () => {
    expect(usageSummary([], {}).estimatedCostUsd).toBeNull();
    expect(usageSummary(records, {}).estimatedCostUsd).toBeNull();
    expect(usageSummary(records, { 'custom/model': { input: 2, output: 8 } }).estimatedCostUsd).toBeCloseTo(.018);
    expect(usageSummary(records, { 'custom/model': { input: NaN, output: 8 } }).estimatedCostUsd).toBeNull();
    expect(usageSummary(records, {}).models[0].estimated).toBe(false);
  });
  it('recognizes real Mermaid diagrams while rejecting executable actions and configuration overrides', () => {
    const normalized = normalizeMermaid('mindmap\n  root((ML))\n    subgraph Algorithms\n      Clustering (K-means)\n    end');
    expect(normalized).toContain('    Algorithms');
    expect(normalized).toContain('["Clustering (K-means)"]');
    expect(normalized).not.toMatch(/subgraph|\bend\b/);
    expect(normalizeMermaid('```mermaid\nmindmap\n  root((VOID))\n    Research\n```')).toContain('mindmap');
    expect(normalizeMermaid('flowchart LR\n A[Click the button] --> B[Done]')).toBeTruthy();
    for (const code of ['flowchart LR\nclick A "https://example.com"', '%%{init:{"securityLevel":"loose"}}%%\nflowchart LR\nA-->B', 'mindmap', 'mindmap\n  root(<script>alert(1)</script>)']) expect(normalizeMermaid(code)).toBeNull();
  });
});
