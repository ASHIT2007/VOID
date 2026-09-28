import type { MermaidConfig } from 'mermaid';

/** Color belongs to the diagram; surrounding app controls stay neutral. */
export function mermaidConfig(theme: 'dark' | 'light'): MermaidConfig {
  const dark = theme === 'dark';
  const foreground = dark ? '#e5e7eb' : '#1f2937';
  const palette = dark
    ? ['#f5f5f5', '#493886', '#155478', '#17654e', '#716023', '#783850', '#405476']
    : ['#1f2937', '#ede9fe', '#dbeafe', '#d1fae5', '#fef3c7', '#fce7f3', '#e0e7ff'];
  const scales = Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
    const color = palette[index === 0 ? 0 : 1 + (index - 1) % (palette.length - 1)];
    return [[`cScale${index}`, color], [`cScaleLabel${index}`, index === 0 ? (dark ? '#171717' : '#ffffff') : foreground], [`cScaleInv${index}`, dark ? '#d4d4d4' : '#525252']];
  }).flat());
  return {
    startOnLoad: false, theme: 'base', securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false,
    fontFamily: 'Arial, Helvetica, sans-serif',
    // Only clear label backplates. Never override authored node fills or text colors.
    themeCSS: '.mindmap-node .label rect { fill: transparent; stroke: none; } .node rect { rx: 6; ry: 6; }',
    flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis', nodeSpacing: 36, rankSpacing: 42, padding: 16 },
    mindmap: { useMaxWidth: true, padding: 16, maxNodeWidth: 200 },
    themeVariables: {
      ...scales, darkMode: dark, background: 'transparent', fontSize: '14px',
      primaryColor: dark ? '#493886' : '#ede9fe', primaryTextColor: foreground,
      primaryBorderColor: dark ? '#8270bc' : '#a78bfa',
      secondaryColor: dark ? '#17654e' : '#d1fae5', secondaryTextColor: foreground,
      secondaryBorderColor: dark ? '#37997b' : '#6ee7b7',
      tertiaryColor: dark ? '#155478' : '#dbeafe', tertiaryTextColor: foreground,
      tertiaryBorderColor: dark ? '#4385ab' : '#93c5fd',
      textColor: foreground, lineColor: dark ? '#a3a3a3' : '#737373',
      clusterBkg: dark ? '#242424' : '#f5f5f5', clusterBorder: dark ? '#525252' : '#d4d4d4',
      edgeLabelBackground: dark ? '#1e1e1e' : '#ffffff',
      // Mermaid's mindmap root uses git colors rather than the branch scale.
      git0: palette[0], gitBranchLabel0: dark ? '#171717' : '#ffffff',
    },
  };
}
