export type GeneratedFile = { filename: string; blob: Blob; summary: string };
const text = (value: unknown, max = 12000) => typeof value === 'string' ? value.slice(0, max) : '';
const safeName = (value: unknown) => text(value, 80).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'VOID document';
const list = (value: unknown, max: number) => { if (!Array.isArray(value) || !value.length || value.length > max) throw new Error(`Supply 1–${max} content items.`); return value; };
export async function generateDeviceFile(name: string, input: Record<string, any>): Promise<GeneratedFile> {
  const title = safeName(input.title);
  if (name === 'file_write') {
    const filename = text(input.filename, 100).split(/[\\/]/).pop() || 'void.txt';
    if (!/\.(?:txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml|log)$/i.test(filename)) throw new Error('Raw files support text/code/CSV. Use the matching format generator for office files.');
    return { filename, blob: new Blob([text(input.content, 100000)], { type: 'text/plain;charset=utf-8' }), summary: `Created ${filename}.` };
  }
  if (name === 'generate_document') {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun } = await import('docx');
    const paragraphs: any[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
    for (const section of list(input.sections, 60)) {
      if (section.heading) paragraphs.push(new Paragraph({ text: text(section.heading, 200), heading: HeadingLevel.HEADING_1 }));
      for (const paragraph of text(section.text).split(/\n\n+/).filter(Boolean)) paragraphs.push(new Paragraph({ children: [new TextRun(paragraph)], spacing: { after: 180 } }));
      for (const bullet of (Array.isArray(section.bullets) ? section.bullets.slice(0, 20) : [])) paragraphs.push(new Paragraph({ text: text(bullet), bullet: { level: 0 } }));
      if (section.table) paragraphs.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: list(section.table, 100).map((row, index) => new TableRow({ tableHeader: index === 0,
        children: list(row, 15).map(cell => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(cell).slice(0, 1500), bold: index === 0 })] })] })) })) }));
      if (typeof section.image === 'string' && section.image.length <= 3000000) {
        const image = section.image.match(/^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/);
        if (!image) throw new Error('Embedded images must be actual PNG/JPEG/GIF data URLs.');
        const bytes = Uint8Array.from(atob(image[2]), character => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${image[1]}` }));
        const scale = Math.min(480 / bitmap.width, 400 / bitmap.height, 1);
        const transformation = { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) }; bitmap.close();
        paragraphs.push(new Paragraph({ children: [new ImageRun({ data: bytes, type: image[1] === 'jpeg' ? 'jpg' : image[1] as 'png' | 'gif', transformation })] }));
      }
    }
    const document = new Document({ title, styles: { default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 140, line: 280 } } } } },
      sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: paragraphs }] });
    return { filename: `${title}.docx`, blob: await Packer.toBlob(document), summary: `Created “${title}” as a styled Word document with ${input.sections.length} section${input.sections.length === 1 ? '' : 's'}.` };
  }
  if (name === 'generate_presentation') {
    const { default: PptxGenJS } = await import('pptxgenjs'); const presentation = new PptxGenJS(); presentation.layout = 'LAYOUT_WIDE'; presentation.title = title;
    const dark = input.theme !== 'light'; const foreground = dark ? 'F5F5F5' : '171717';
    presentation.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };
    const slides = list(input.slides, 40);
    const imageSlots = slides.map((source, index) => !source.chart && typeof source.imagePrompt === 'string' && source.imagePrompt.trim() ? index : -1)
      .filter(index => index >= 0).slice(0, Math.min(6, Math.ceil(slides.length * .6)));
    const preparedImages = new Map<number, { data?: string; caption?: string; error?: string }>();
    if (imageSlots.length) {
      const { requestDesignImage } = await import('@/lib/design/design-image-client');
      // Two bounded preparations at a time keep per-user model quotas useful.
      for (let start = 0; start < imageSlots.length; start += 2) {
        await Promise.all(imageSlots.slice(start, start + 2).map(async index => {
          const source = slides[index];
          try {
            const result = await requestDesignImage({ subject: text(source.imageSubject || source.title || title, 120),
              prompt: text(source.imagePrompt, 2000), grounding: [source.title, source.text, ...(source.bullets || [])].filter(Boolean).join(' ').slice(0, 12000),
              source: source.imageSource === 'reference' ? 'reference' : 'auto', quality: 'medium', format: 'presentation', seed: index });
            if (!result.url || result.omitted) return;
            const imageUrl = result.url.startsWith('/') ? result.url : `/api/image-proxy?url=${encodeURIComponent(result.url)}`;
            const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
            if (!response.ok || !/^image\/(png|jpeg|webp)/i.test(response.headers.get('content-type') || '')) throw new Error('The image could not be loaded.');
            const blob = await response.blob();
            if (blob.size > 10 * 1024 * 1024) throw new Error('The image is too large.');
            const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
            preparedImages.set(index, { data, caption: result.generated ? `AI-generated illustration · ${result.modelUsed}` : `Web reference · ${result.sourceUrl || result.modelUsed}` });
          } catch (error) {
            preparedImages.set(index, { error: error instanceof Error ? error.message.slice(0, 280) : 'Image unavailable: the image model encountered a problem.' });
          }
        }));
      }
    }
    for (const [index, source] of slides.entries()) {
      const slide = presentation.addSlide(); slide.background = { color: dark ? '202020' : 'FAFAFA' };
      slide.addText(text(source.title, 180), { x: .6, y: .5, w: 12.1, h: 1, fontSize: index === 0 && !source.chart ? 34 : 27, bold: true, color: foreground, breakLine: false, fit: 'shrink' });
      if (source.chart) {
        const chart = validateSimpleChart(source.chart);
        slide.addChart(chart.type as any, [{ name: text(chart.title) || 'Values', labels: chart.labels, values: chart.values }], { x: .8, y: 1.7, w: 8.3, h: 4.6,
          showLegend: false, showValue: true, chartColors: ['737373', 'A3A3A3', '525252'], showTitle: false, catAxisLabelColor: foreground, valAxisLabelColor: foreground });
        slide.addText(text(source.text, 700), { x: 9.5, y: 1.8, w: 3, h: 4.5, fontSize: 16, color: foreground, fit: 'shrink' });
      } else {
        const visual = preparedImages.get(index);
        const contentWidth = visual ? 7 : 11.7;
        if (source.text) slide.addText(text(source.text, 1300), { x: .8, y: 1.7, w: contentWidth, h: source.bullets?.length ? 1.5 : 4.5, fontSize: 20, color: foreground, fit: 'shrink' });
        if (source.bullets?.length) slide.addText(source.bullets.slice(0, 8).map((bullet: unknown) => ({ text: text(bullet, 220), options: { bullet: true, breakLine: true } })),
          { x: .9, y: source.text ? 3.3 : 1.8, w: visual ? 6.8 : 11.4, h: source.text ? 3 : 4.5, fontSize: 19, paraSpaceAfter: 14, color: foreground, fit: 'shrink' });
      }
      const visual = preparedImages.get(index);
      if (visual?.data) {
        slide.addImage({ data: visual.data, x: 8.2, y: 1.8, w: 4.3, h: 4.3, sizing: { type: 'contain', w: 4.3, h: 4.3 } });
        slide.addText(visual.caption || '', { x: 8.2, y: 6.3, w: 4.3, h: .5, fontSize: 9, color: '737373', fit: 'shrink' });
      } else if (visual?.error) {
        slide.addText(visual.error, { x: 8.2, y: 2, w: 4.3, h: 3.8, fontSize: 14, color: foreground, fill: { color: dark ? '303030' : 'E5E5E5' }, margin: .2 });
      }
      slide.addText(`${index + 1} / ${slides.length}`, { x: 11.9, y: 7.1, w: .9, h: .2, fontSize: 10, color: '737373' });
      if (source.notes) slide.addNotes(text(source.notes));
    }
    const buffer = await presentation.write({ outputType: 'arraybuffer' });
    return { filename: `${title}.pptx`, blob: new Blob([buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), summary: `Created “${title}”, a ${slides.length}-slide presentation. It covers ${slides.slice(0, 4).map(slide => text(slide.title)).join(', ')}.` };
  }
  if (name === 'generate_spreadsheet') {
    const { default: ExcelJS } = await import('exceljs'); const workbook = new ExcelJS.Workbook(); workbook.creator = 'VOID'; workbook.calcProperties.fullCalcOnLoad = true;
    const charts: Array<{ chart: ReturnType<typeof validateSimpleChart>; sheetIndex: number }> = [];
    for (const [index, source] of list(input.sheets, 12).entries()) {
      const sheetName = text(source.name, 31).replace(/[\\/?*\[\]:]/g, '') || `Sheet ${index + 1}`;
      if (workbook.getWorksheet(sheetName)) throw new Error('Sheet names must be unique.');
      const sheet = workbook.addWorksheet(sheetName);
      const rows = list(source.rows, 1000);
      for (const row of rows) {
        const cells = list(row, 50).map(cell => {
          if (cell === null || typeof cell === 'boolean' || typeof cell === 'number' && Number.isFinite(cell)) return cell;
          if (typeof cell === 'string') return cell.slice(0, 3000);
          if (cell && typeof cell.formula === 'string' && cell.formula.length < 500 && !/[\[\]]|https?:|WEBSERVICE|HYPERLINK|DDE/i.test(cell.formula)) {
            return { formula: cell.formula.replace(/^=/, ''), ...(typeof cell.result === 'number' && Number.isFinite(cell.result) ? { result: cell.result } : {}) };
          }
          throw new Error('Cells must contain text, numbers or a supported formula.');
        });
        const added = sheet.addRow(cells);
        row.forEach((cell: any, column: number) => { if (cell && typeof cell === 'object' && typeof cell.format === 'string') added.getCell(column + 1).numFmt = cell.format.slice(0, 50); });
      }
      sheet.getRow(1).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
      sheet.columns.forEach(column => { column.width = 22; }); sheet.views = [{ state: 'frozen', ySplit: 1 }];
      if (source.chart) charts.push({ chart: validateSimpleChart(source.chart), sheetIndex: index + 1 });
    }
    // Reuse the existing PPTX native chart writer for standards-compliant OOXML.
    for (const [index, { chart }] of charts.entries()) {
      const data = workbook.addWorksheet(`_VOID_Chart${index + 1}`, { state: 'veryHidden' });
      data.addRow(['Category', 'Values']); chart.labels.forEach((label, row) => data.addRow([label, chart.values[row]]));
    }
    let buffer: ArrayBuffer = await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer;
    if (charts.length) buffer = await addWorkbookCharts(buffer, charts);
    return { filename: `${title}.xlsx`, blob: new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), summary: `Created “${title}” with ${input.sheets.length} sheet${input.sheets.length === 1 ? '' : 's'}${charts.length ? ` and ${charts.length} native chart${charts.length === 1 ? '' : 's'}` : ''}. Formula results are recalculated by Excel on opening.` };
  }
  if (name === 'generate_pdf') {
    const latin = (value: string) => value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...');
    if (/[^\u0000-\u00ff]/.test(latin(JSON.stringify(input)))) throw new Error('The built-in PDF font cannot reliably render this script. Create a Word document instead, or use the document editor with an appropriate font and PDF export.');
    const { jsPDF, AcroFormTextField } = await import('jspdf'); const pdf = new jsPDF(); let y = 20;
    const write = (value: string, size = 11, bold = false) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
      for (const line of pdf.splitTextToSize(latin(value), 172)) { if (y > 275) { pdf.addPage(); y = 20; } pdf.text(line, 19, y); y += size * .5 + 2; }
      y += 4;
    };
    write(title, 22, true);
    for (const section of list(input.sections, 60)) { if (section.heading) write(text(section.heading), 15, true); if (section.text) write(text(section.text));
      if (section.table) for (const [index, row] of list(section.table, 100).entries()) {
        const cells = list(row, 12); const width = 172 / cells.length; pdf.setFont('helvetica', index === 0 ? 'bold' : 'normal'); pdf.setFontSize(10);
        const lines = cells.map(cell => pdf.splitTextToSize(latin(String(cell)), width - 6) as string[]);
        const height = Math.max(...lines.map(cell => cell.length)) * 5 + 6;
        if (height > 245) throw new Error('A PDF table row is too long for one page. Shorten the cells or use a Word document.');
        if (y + height > 277) { pdf.addPage(); y = 20; }
        lines.forEach((cell, column) => { pdf.setDrawColor('#b4b4b4'); pdf.setFillColor(index === 0 ? '#e6e6e6' : '#ffffff'); pdf.rect(19 + column * width, y, width, height, 'FD'); pdf.setTextColor('#1e1e1e'); pdf.text(cell, 22 + column * width, y + 6); }); y += height;
      } y += 4; }
    for (const field of (Array.isArray(input.fields) ? input.fields.slice(0, 30) : [])) {
      if (y > 250) { pdf.addPage(); y = 20; } write(text(field.label, 100), 11, true);
      const inputField = new AcroFormTextField(); inputField.fieldName = text(field.name, 100); inputField.x = 19; inputField.y = y; inputField.width = 172; inputField.height = 12; pdf.addField(inputField); y += 22;
    }
    return { filename: `${title}.pdf`, blob: pdf.output('blob'), summary: `Created “${title}” as a ${pdf.getNumberOfPages()}-page PDF${input.fields?.length ? ' with fillable fields' : ''}.` };
  }
  throw new Error('Unsupported file format.');
}
function validateSimpleChart(chart: any) {
  if (!chart || !['bar', 'line', 'pie'].includes(chart.type) || !Array.isArray(chart.labels) || !Array.isArray(chart.values)
    || !chart.labels.length || chart.labels.length > 100 || chart.labels.length !== chart.values.length || chart.labels.some((label: unknown) => typeof label !== 'string')
    || chart.values.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Charts need a bar/line/pie type and matching labels/numeric values.');
  if (chart.type === 'pie' && (chart.values.some((value: number) => value < 0) || !chart.values.some((value: number) => value > 0))) throw new Error('Pie values must be non-negative with a positive total.');
  return chart as { type: string; title?: string; labels: string[]; values: number[] };
}
async function addWorkbookCharts(buffer: ArrayBuffer, charts: Array<{ chart: ReturnType<typeof validateSimpleChart>; sheetIndex: number }>) {
  const [{ default: JSZip }, { default: PptxGenJS }] = await Promise.all([import('jszip'), import('pptxgenjs')]);
  const zip = await JSZip.loadAsync(buffer); let contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  for (const [index, { chart, sheetIndex }] of charts.entries()) {
    const number = index + 1; const deck = new PptxGenJS(); deck.addSlide().addChart(chart.type as any, [{ name: 'Values', labels: chart.labels, values: chart.values }], { x: 0, y: 0, w: 8, h: 4, showLegend: false });
    const chartZip = await JSZip.loadAsync(await deck.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
    const chartPart = chartZip.file(/^ppt\/charts\/chart\d+\.xml$/)[0];
    if (!chartPart) throw new Error('The chart writer returned no native chart.');
    const xml = (await chartPart.async('string')).replace(/<c:externalData\b(?:[^>]*\/>|[\s\S]*?<\/c:externalData>)/g, '').replace(/Sheet1/g, `_VOID_Chart${number}`);
    zip.file(`xl/charts/chart${number}.xml`, xml);
    zip.file(`xl/drawings/drawing${number}.xml`, `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>14</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${number}" name="VOID Chart ${number}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${number}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${number}.xml"/></Relationships>`);
    const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`;
    zip.file(sheetPath, (await zip.file(sheetPath)!.async('string')).replace('</worksheet>', `<drawing r:id="rIdVoidChart"/></worksheet>`));
    const relationshipsPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`;
    const relationships = zip.file(relationshipsPath) ? await zip.file(relationshipsPath)!.async('string') : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    zip.file(relationshipsPath, relationships.replace('</Relationships>', `<Relationship Id="rIdVoidChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${number}.xml"/></Relationships>`));
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="/xl/charts/chart${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/drawings/drawing${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  }
  zip.file('[Content_Types].xml', contentTypes); return zip.generateAsync({ type: 'arraybuffer' });
}
