const diagramHeader = /^(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|block-beta|packet-beta|architecture-beta|sankey-beta|xychart-beta|zenuml)\b/i;
export function diagramAnswer(value) {
  if (typeof value !== 'string') return null;
  const blocks = [...value.matchAll(/```(?:mermaid|mindmap)\s*\n([\s\S]*?)```/gi)];
  const candidates = blocks.length ? blocks.map(match => match[1]) : [value.replace(/^mermaid\s*\n/i, '')];
  const codes = candidates.map(normalizeMermaid);
  return codes.length && codes.every(Boolean) ? codes.map(code => '```mermaid\n' + code + '\n```').join('\n\n') : null;
}
export function normalizeMermaid(value) {
  if (typeof value !== 'string' || value.length > 50000) return null;
  let code = value.replace(/^\uFEFF/, '').trim().replace(/^```(?:mermaid|mindmap)?\s*\n?/i, '').replace(/\s*```$/, '').trim();
  // Generated diagrams cannot override the site's security/theme or embed actions/assets.
  if (!code || /%%\s*\{|^---\s*$|^\s*(?:click|callback|href)\s|<\/?(?:script|iframe|img|image|a)\b|javascript:|https?:\/\//im.test(code)) return null;
  if (/^mindmap\b/i.test(code)) {
    let lines = code.split(/\r?\n/);
    // Some providers mix flowchart grouping with mindmap indentation. These
    // render as literal "subgraph"/"end" nodes unless converted to headings.
    const groups = lines.filter(line => /^\s*subgraph\s+\S/.test(line)).length;
    if (groups && groups === lines.filter(line => /^\s*end\s*$/.test(line)).length) {
      lines = lines.filter(line => !/^\s*end\s*$/.test(line)).map(line => line.replace(/^(\s*)subgraph\s+/, '$1'));
    }
    code = lines.map((line, index) => {
      // A plain label such as "Clustering (K-means)" otherwise loses its
      // prefix because Mermaid treats that prefix as an invisible node ID.
      const plain = line.match(/^(\s+)([^()[\]{}]+\s+\([^()]+\))\s*$/);
      return plain ? `${plain[1]}void_node_${index}[${JSON.stringify(plain[2].trim())}]` : line;
    }).join('\n');
  }
  const meaningful = code.split(/\r?\n/).filter(line => line.trim() && !/^\s*%%/.test(line));
  return meaningful.length >= 2 && diagramHeader.test(meaningful[0].trim()) ? code : null;
}
export const DIAGRAM_GENERATION_DIRECTIVE = `When a user requests a flowchart, mind map or Mermaid diagram, render it as a visual rather than explaining implementation. Return a brief explanation and one complete fenced mermaid block per requested diagram; if both a flowchart and a mind map are requested, return both. Use Mermaid mindmap with an indented root and meaningful child nodes for mind maps; flowchart for process/relationships; sequenceDiagram for interactions. Use native chart JSON for quantitative charts. Use a restrained, readable palette to distinguish groups or stages when helpful. For flowcharts, use classDef/class with hex fills, contrasting text and subtle borders; purple #493886, green #17654e and blue #155478 with light text work well. Preserve a user's requested palette, including monochrome. Keep labels concise; use quoted Mermaid Markdown strings with actual line breaks for short subtitles, never HTML line breaks. Use decision diamonds and labeled branches for choices. Mind maps receive automatic branch colors; preserve indentation and avoid flowchart classDef/style commands in mindmaps. Never add init/config directives, embedded HTML, links, click actions, placeholder Branch 1/Topic nodes or an empty outline. If no topic can be resolved from the conversation, ask the user which topic to map in ordinary text. Do not invent a topic or return a generic placeholder diagram. Quote punctuation in flowchart node labels. Follow the user's supplied facts and labels.`;
