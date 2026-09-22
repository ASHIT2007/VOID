import React, { useEffect, useRef, useState } from "react";
import { 
  Download, 
  FileText, 
  Check, 
  Copy, 
  Sparkles, 
  Lightbulb, 
  ShieldAlert, 
  BarChart2,
  Pencil,
  Undo2,
  Redo2,
} from "lucide-react";
import type { ReportData, ReportSection } from "@/types/report";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableCell, TableRow, WidthType } from "docx";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell 
} from "recharts";

type CanvaDocStudioProps = {
  data: ReportData;
  onClose?: () => void;
  onChange?: (data: ReportData) => void;
};

export default function CanvaDocStudio({ data: initialData, onChange }: CanvaDocStudioProps) {
  const [data, setData] = useState(initialData);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const undoStack = useRef<ReportData[]>([]);
  const redoStack = useRef<ReportData[]>([]);

  useEffect(() => setData(initialData), [initialData]);

  const commitData = (next: ReportData) => {
    undoStack.current = [...undoStack.current.slice(-39), data];
    redoStack.current = [];
    setData(next);
    onChange?.(next);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(data);
    setData(previous);
    onChange?.(previous);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(data);
    setData(next);
    onChange?.(next);
  };

  const updateSection = (index: number, patch: Partial<ReportSection>) => {
    commitData({ ...data, sections: data.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section) });
  };

  // PDF Export
  const handleExportPDF = async () => {
    setExporting("pdf");
    try {
      const element = document.getElementById("canva-doc-canvas");
      if (!element) return;

      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4"
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfPageHeight = pdf.internal.pageSize.getHeight();
      const renderedHeight = (canvas.height * pdfWidth) / canvas.width;
      const pageCount = Math.max(1, Math.ceil(renderedHeight / pdfPageHeight));
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        if (pageIndex > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(imgData, "PNG", 0, -(pageIndex * pdfPageHeight), pdfWidth, renderedHeight);
      }
      const fileName = `${data.title.replace(/[^\w\s\-]/gi, "")}_Report.pdf`;
      pdf.save(fileName);
    } catch (e) {
      console.error("PDF Export error:", e);
    } finally {
      setExporting(null);
    }
  };

  // DOCX Export
  const handleExportDOCX = async () => {
    setExporting("docx");
    try {
      const docChildren: Array<Paragraph | Table> = [
        new Paragraph({
          text: data.title,
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Author: ${data.author} | Category: ${data.category} | Date: ${data.date}`, italics: true })
          ]
        })
      ];

      data.sections.forEach((sec) => {
        if (sec.title) {
          docChildren.push(
            new Paragraph({
              text: sec.title,
              heading: HeadingLevel.HEADING_1,
            })
          );
        }
        if (sec.content) {
          docChildren.push(new Paragraph({ text: sec.content }));
        }
        if (sec.items) {
          sec.items.forEach((item) => {
            docChildren.push(new Paragraph({ text: item, bullet: { level: 0 } }));
          });
        }
        if (sec.metrics?.length) {
          sec.metrics.forEach((metric) => docChildren.push(new Paragraph({
            children: [new TextRun({ text: `${metric.label}: `, bold: true }), new TextRun({ text: `${metric.value}${metric.trend ? ` (${metric.trend})` : ''}` })],
          })));
        }
        if (sec.table?.columns.length && sec.table.rows.length) {
          docChildren.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: sec.table.columns.map((column) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: column.header, bold: true })] })] })) }),
              ...sec.table.rows.map((row) => new TableRow({ children: sec.table!.columns.map((column) => new TableCell({ children: [new Paragraph(String(row[column.key] ?? ''))] })) })),
            ],
          }));
        }
        if (sec.chart?.data.length) {
          docChildren.push(new Paragraph({ children: [new TextRun({ text: 'Chart data: ', bold: true }), new TextRun(sec.chart.data.map((point) => `${point.label} ${point.value}`).join(', '))] }));
        }
      });

      const doc = new Document({
        sections: [{ properties: {}, children: docChildren }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.title.replace(/[^\w\s\-]/gi, "")}_Report.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("DOCX Export error:", e);
    } finally {
      setExporting(null);
    }
  };

  // Copy Markdown
  const handleCopyMarkdown = () => {
    let md = `# ${data.title}\n\n*${data.category} | ${data.author} | ${data.date}*\n\n`;
    data.sections.forEach((s) => {
      if (s.title) md += `## ${s.title}\n\n`;
      if (s.content) md += `${s.content}\n\n`;
      if (s.items) {
        s.items.forEach((item) => (md += `- ${item}\n`));
        md += `\n`;
      }
    });
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chartColors = ["#111111", "#4B5563", "#9CA3AF", "#D1D5DB", "#6B7280"];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0c0d0e] font-sans text-gray-100">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#111214] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-white/70"><FileText size={16} /></div>
          <div className="min-w-0"><h3 className="max-w-xs truncate text-[13px] font-semibold">{data.title}</h3><p className="text-[10px] text-white/40">Report · {data.sections.length} sections · {data.readTime} read</p></div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={undoStack.current.length === 0} className="grid h-8 w-8 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-20" title="Undo"><Undo2 size={15} /></button>
          <button onClick={redo} disabled={redoStack.current.length === 0} className="grid h-8 w-8 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-20" title="Redo"><Redo2 size={15} /></button>
          <button onClick={() => setEditing((value) => !value)} aria-pressed={editing} className={`grid h-8 w-8 place-items-center rounded-md ${editing ? "bg-white text-black" : "text-white/55 hover:bg-white/[0.07] hover:text-white"}`} title="Edit report text"><Pencil size={15} /></button>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <button onClick={handleCopyMarkdown} className="grid h-8 w-8 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white" title="Copy report text">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
          <button onClick={handleExportDOCX} disabled={!!exporting} className="hidden h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[11px] text-white/75 hover:bg-white/[0.07] sm:flex disabled:opacity-30"><FileText size={13} />{exporting === "docx" ? "Building" : "Word"}</button>
          <button onClick={handleExportPDF} disabled={!!exporting} className="flex h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[11px] font-semibold text-black hover:bg-white/90 disabled:opacity-30"><Download size={13} />{exporting === "pdf" ? "Exporting" : "PDF"}</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-white/[0.08] bg-[#111214] px-3 py-4 xl:block">
          <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Document outline</p>
          <div className="space-y-1">{data.sections.map((section, index) => <button key={section.id} onClick={() => document.getElementById(`report-section-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} className="w-full rounded-md px-2 py-2 text-left text-[11px] leading-snug text-white/50 hover:bg-white/[0.05] hover:text-white"><span className="mr-2 tabular-nums text-white/25">{String(index + 1).padStart(2, "0")}</span>{section.title || section.type.replace(/_/g, " ")}</button>)}</div>
        </aside>

        <div className="flex-1 overflow-y-auto bg-[#191a1c] p-4 sm:p-8" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          {editing && <div className="sticky top-0 z-20 mx-auto mb-3 w-fit rounded-md border border-white/10 bg-[#111214]/95 px-3 py-1.5 text-[11px] text-white/55 shadow-lg backdrop-blur">Click report text to edit it directly</div>}
          <article id="canva-doc-canvas" className="mx-auto min-h-[1120px] w-full max-w-[850px] space-y-10 bg-white px-[8%] py-[9%] text-[#202124] shadow-[0_28px_90px_rgba(0,0,0,0.5)]">
            <header className="space-y-5 border-b border-black/15 pb-8">
              <div className="flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-black/45"><span>{data.category}</span><span>{data.readTime} read</span></div>
              <h1 contentEditable={editing} suppressContentEditableWarning onBlur={(event) => event.currentTarget.innerText.trim() !== data.title && commitData({ ...data, title: event.currentTarget.innerText.trim() })} className={`text-4xl font-bold leading-[1.08] tracking-[-0.035em] outline-none ${editing ? "hover:outline hover:outline-1 hover:outline-black/25 focus:outline-2 focus:outline-black" : ""}`}>{data.title}</h1>
              <div className="flex items-center justify-between text-[11px] text-black/45"><span>{data.author}</span><span>{data.date}</span></div>
            </header>

            {data.sections.map((section, sectionIndex) => (
              <section id={`report-section-${sectionIndex}`} key={section.id} className="scroll-mt-6 space-y-4">
                {section.title && <h2 contentEditable={editing} suppressContentEditableWarning onBlur={(event) => event.currentTarget.innerText.trim() !== section.title && updateSection(sectionIndex, { title: event.currentTarget.innerText.trim() })} className={`text-xl font-bold tracking-[-0.02em] outline-none ${editing ? "hover:outline hover:outline-1 hover:outline-black/20 focus:outline-2 focus:outline-black" : ""}`}>{section.title}</h2>}
                {section.content && <p contentEditable={editing} suppressContentEditableWarning onBlur={(event) => event.currentTarget.innerText.trim() !== section.content && updateSection(sectionIndex, { content: event.currentTarget.innerText.trim() })} className={`whitespace-pre-wrap text-[13px] leading-[1.75] text-black/75 outline-none ${editing ? "hover:outline hover:outline-1 hover:outline-black/20 focus:outline-2 focus:outline-black" : ""}`}>{section.content}</p>}
                {section.items && <ul className="space-y-2.5 pl-5">{section.items.map((item, itemIndex) => <li key={itemIndex} className="list-square text-[13px] leading-relaxed text-black/75"><span contentEditable={editing} suppressContentEditableWarning onBlur={(event) => { const value = event.currentTarget.innerText.trim(); if (value === item) return; const items = [...(section.items || [])]; items[itemIndex] = value; updateSection(sectionIndex, { items }); }} className={`outline-none ${editing ? "hover:outline hover:outline-1 hover:outline-black/20 focus:outline-2 focus:outline-black" : ""}`}>{item}</span></li>)}</ul>}

                {section.metrics && section.metrics.length > 0 && <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-3">{section.metrics.map((metric, index) => <div key={index} className="border-t-2 border-black pt-3"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-black/45">{metric.label}</span><div className="mt-1 text-2xl font-bold text-black">{metric.value}</div>{metric.trend && <span className="mt-1 block text-[10px] text-black/45">{metric.trend}</span>}</div>)}</div>}

                {section.callout && <div className="flex items-start gap-3 border-l-4 border-black bg-black/[0.035] px-4 py-3 text-black/75">{section.callout.variant === "warning" ? <ShieldAlert size={18} className="mt-0.5 shrink-0" /> : section.callout.variant === "insight" ? <Lightbulb size={18} className="mt-0.5 shrink-0" /> : <Sparkles size={18} className="mt-0.5 shrink-0" />}<p className="text-[12px] leading-relaxed">{section.callout.text}</p></div>}

                {section.chart?.data && <div className="space-y-2 border border-black/10 p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-black/45"><BarChart2 size={13} /><span>Data view</span></div><div className="h-56 w-full pt-2"><ResponsiveContainer width="100%" height="100%">{section.chart.chartType === "line" ? <LineChart data={section.chart.data}><XAxis dataKey="label" stroke="#6B7280" fontSize={10} /><YAxis stroke="#6B7280" fontSize={10} /><Tooltip /><Line type="monotone" dataKey="value" stroke="#111111" strokeWidth={2} /></LineChart> : section.chart.chartType === "pie" ? <PieChart><Pie data={section.chart.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={70}>{section.chart.data.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip /></PieChart> : <BarChart data={section.chart.data}><XAxis dataKey="label" stroke="#6B7280" fontSize={10} /><YAxis stroke="#6B7280" fontSize={10} /><Tooltip /><Bar dataKey="value" fill="#111111" radius={[2, 2, 0, 0]} /></BarChart>}</ResponsiveContainer></div></div>}

                {section.table && <div className="overflow-x-auto border border-black/15"><table className="w-full text-left text-[11px] text-black/70"><thead className="border-b border-black/15 bg-black text-white"><tr>{section.table.columns.map((column) => <th key={column.key} className="px-3 py-2.5 font-semibold">{column.header}</th>)}</tr></thead><tbody className="divide-y divide-black/10">{section.table.rows.map((row, rowIndex) => <tr key={rowIndex} className={rowIndex % 2 ? "bg-black/[0.025]" : ""}>{section.table!.columns.map((column) => <td key={column.key} className="px-3 py-2.5 align-middle">{row[column.key]}</td>)}</tr>)}</tbody></table></div>}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}
