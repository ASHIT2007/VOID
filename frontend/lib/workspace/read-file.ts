/** Local formats never leave the device merely to extract their text. */
export async function readDeviceFile(file: File): Promise<string | null> {
  if (file.size > 15000000) throw new Error('Choose a file smaller than 15 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const parts = zip.file(/^word\/(?:document|header\d+|footer\d+)\.xml$/);
    if (!parts.length) throw new Error('The selected file has no Word document content.');
    const paragraphs: string[] = [];
    for (const part of parts) {
      const xml = await part.async('string');
      if (xml.length > 10000000) throw new Error('This document is too large to extract safely.');
      paragraphs.push(xml.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]!)
        .replace(/&#(x[\da-f]+|\d+);/gi, (_, value) => { const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value); return code <= 0x10ffff ? String.fromCodePoint(code) : ''; }));
    }
    return paragraphs.join('\n').slice(0, 95000);
  }
  if (['xlsx', 'xls'].includes(extension || '')) {
    const XLSX = await import('xlsx'); const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false, bookVBA: false });
    return workbook.SheetNames.slice(0, 20).map(name => `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name]).slice(0, 20000)}`).join('\n\n').slice(0, 95000);
  }
  if (['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'css', 'html', 'xml', 'yaml', 'yml', 'log'].includes(extension || '') || file.type.startsWith('text/')) return (await file.text()).slice(0, 95000);
  // PDF/OCR and vision use the existing configured-service path after approval.
  return null;
}
