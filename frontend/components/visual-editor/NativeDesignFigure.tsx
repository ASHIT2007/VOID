import type { DesignPalette, Slide } from "@/types/presentation";
import { EditableElement, elementId, type CanvasEditor } from "./EditableElement";
import { readableInk } from "@/lib/design/visual-theme";

/** Content-backed figures, shared by slide and poster compositions. */
export function NativeDesignFigure({ slide, palette, editor }: { slide: Slide; palette: DesignPalette; editor?: CanvasEditor }) {
  const matrix = slide.content.matrix;
  if (matrix?.items?.length) return (
    <div className="relative h-full min-h-[20cqw] pl-[5%] pb-[5%]" data-native-figure="matrix">
      <div className="relative h-full border-b-2 border-l-2" style={{ borderColor: palette.primary }}>
        <div className="absolute left-1/2 h-full border-l border-dashed opacity-30" style={{ borderColor: palette.text }} />
        <div className="absolute top-1/2 w-full border-t border-dashed opacity-30" style={{ borderColor: palette.text }} />
        {matrix.items.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y)).map((item, index) => (
          <div key={index} className="absolute max-w-[24%] -translate-x-1/2 translate-y-1/2 text-center text-[1.1cqw] leading-tight" style={{ left: `${Math.min(88, Math.max(12, item.x))}%`, bottom: `${Math.min(90, Math.max(12, item.y))}%`, color: palette.text }}>
            <span className="mx-auto mb-[0.5cqw] block h-[1cqw] w-[1cqw] rounded-full" style={{ background: index % 2 ? palette.secondary : palette.primary }} />{item.label}
          </div>
        ))}
      </div>
      <span className="absolute bottom-0 left-1/3 text-[1.1cqw]">{matrix.xLabel}</span>
      <span className="absolute left-0 top-1/2 -rotate-90 text-[1.1cqw] origin-left">{matrix.yLabel}</span>
    </div>
  );

  const steps = slide.content.process || [];
  if (steps.length) {
    const radial = slide.layout === "cycle";
    const hierarchy = slide.layout === "hierarchy";
    return (
      <div className="relative grid h-full min-h-[21cqw] gap-[1.8cqw]" data-native-figure={radial ? "cycle" : hierarchy ? "hierarchy" : "process"} style={{ gridTemplateColumns: radial ? "repeat(2, minmax(0, 1fr))" : hierarchy ? "repeat(2, minmax(0, 1fr))" : `repeat(${Math.min(3, steps.length)}, minmax(0, 1fr))` }}>
        {steps.map((item, index) => (
          <div key={index} className="relative border-t-[0.35cqw] pt-[1.2cqw]" style={{ borderColor: index % 2 ? palette.secondary : palette.primary, gridColumn: hierarchy && index === 0 ? "1 / -1" : undefined }}>
            <span className="mb-[1cqw] inline-flex h-[2.8cqw] min-w-[2.8cqw] items-center justify-center px-[0.4cqw] text-[1.2cqw] font-bold" style={{ backgroundColor: palette.primary, color: readableInk(palette.primary), borderRadius: radial ? "50%" : 0 }}>{index + 1}</span>
            <EditableElement id={elementId(slide.id, "label", index * 2)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index * 2)]} editor={editor} value={item.title}><h3 className="text-[1.6cqw] font-bold leading-tight">{item.title}</h3></EditableElement>
            {item.description && <EditableElement id={elementId(slide.id, "label", index * 2 + 1)} kind="label" state={slide.elementStyles?.[elementId(slide.id, "label", index * 2 + 1)]} editor={editor} value={item.description}><p className="mt-[0.7cqw] text-[1.2cqw] leading-snug" style={{ color: palette.muted }}>{item.description}</p></EditableElement>}
            {radial && <span className="absolute right-[1%] top-[1cqw] text-[2cqw]" aria-hidden="true">{index === steps.length - 1 ? "↺" : "→"}</span>}
          </div>
        ))}
      </div>
    );
  }

  const chart = slide.content.chart;
  if (chart?.data?.length) {
    const entries = chart.data.filter((item) => Number.isFinite(item.value));
    const min = Math.min(0, ...entries.map((item) => item.value));
    const max = Math.max(1, ...entries.map((item) => item.value));
    const span = max - min;
    const baseline = 170 - (0 - min) / span * 145;
    const points = entries.map((item, index) => ({ x: 35 + index / Math.max(1, entries.length - 1) * 330, y: 170 - (item.value - min) / span * 145 }));
    const total = entries.reduce((sum, item) => sum + Math.max(0, item.value), 0);
    let offset = 0;
    const colors = [palette.primary, palette.secondary, palette.accent];
    return (
      <figure className="flex h-full min-h-[18cqw] flex-col justify-center" data-native-figure={chart.type}>
        <svg viewBox="0 0 400 215" className="max-h-[28cqw] w-full" role="img" aria-label={`${slide.title}: ${entries.map((item) => `${item.label} ${item.value}${chart.unit || ""}`).join(", ")}`}>
          {chart.type === "donut" && total > 0 && entries.every((item) => item.value >= 0) ? entries.map((item, index) => {
            const fraction = item.value / total * 100;
            const start = offset;
            offset += fraction;
            return <circle key={index} cx="200" cy="100" r="65" fill="none" stroke={colors[index % colors.length]} strokeWidth="32" pathLength="100" strokeDasharray={`${fraction} ${100 - fraction}`} strokeDashoffset={-start} transform="rotate(-90 200 100)" />;
          }) : <>
            <line x1="20" x2="380" y1={baseline} y2={baseline} stroke={palette.muted} strokeWidth="0.7" />
            {chart.type === "line" || chart.type === "area" ? <>
              {chart.type === "area" && <polygon points={`35,${baseline} ${points.map(({ x, y }) => `${x},${y}`).join(" ")} 365,${baseline}`} fill={palette.primary} opacity="0.14" />}
              <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} stroke={palette.primary} strokeWidth="3" fill="none" />
              {points.map(({ x, y }, index) => <circle key={index} cx={x} cy={y} r="4" fill={palette.primary} />)}
            </> : entries.map((item, index) => {
              const width = 330 / Math.max(1, entries.length);
              const y = 170 - (item.value - min) / span * 145;
              return <rect key={index} x={30 + index * width} y={Math.min(y, baseline)} width={width * 0.65} height={Math.max(0.5, Math.abs(y - baseline))} fill={colors[index % colors.length]} />;
            })}
          </>}
        </svg>
        <figcaption className="grid gap-[0.6cqw] text-[1.15cqw] leading-snug" style={{ gridTemplateColumns: `repeat(${Math.min(3, entries.length)}, minmax(0, 1fr))` }}>
          {entries.map((item, index) => <div key={index}><strong style={{ color: readableInk(palette.background, colors[index % colors.length]) }}>{item.value}{chart.unit || ""}</strong> <span>{item.label}</span></div>)}
        </figcaption>
      </figure>
    );
  }
  return null;
}
