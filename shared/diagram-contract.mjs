const diagramHeader = /^(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|block-beta|packet-beta|architecture-beta|sankey-beta|xychart-beta|zenuml)\b/i;
export function diagramAnswer(value) {
  if (typeof value !== 'string') return null;
  const blocks = [...value.matchAll(/```(?:mermaid|mindmap)\s*\n([\s\S]*?)```/gi)];
  const candidates = blocks.length ? blocks.map(match => match[1]) : [value.replace(/^mermaid\s*\n/i, '')];
  const codes = candidates.map(normalizeMermaid);
  if (!codes.length || !codes.every(Boolean)) return null;
  if (!blocks.length) return '```mermaid\n' + codes[0] + '\n```';
  let index = 0;
  // Replace only diagram fences. Keep the explanation, examples and code intact.
  return value.replace(/```(?:mermaid|mindmap)\s*\n([\s\S]*?)```/gi, () => '```mermaid\n' + codes[index++] + '\n```');
}
export function compactMindmap(code, maxNodes = 19) {
  if (!/^mindmap\b/i.test(code)) return code;
  const lines = code.split(/\r?\n/);
  const nodes = lines.slice(1).map((line, index) => ({ line, index, indent: line.match(/^\s*/)[0].replace(/\t/g, '  ').length }))
    .filter(node => node.line.trim() && !/^\s*(?:%%|::)/.test(node.line));
  if (nodes.length <= maxNodes) return code;
  const root = nodes[0];
  if (!root) return code;
  const branchIndent = Math.min(...nodes.slice(1).filter(node => node.indent > root.indent).map(node => node.indent));
  const branches = nodes.filter(node => node.indent === branchIndent).slice(0, 6);
  const chosen = new Set([root.index, ...branches.map(node => node.index)]);
  const children = branches.map(branch => {
    const nextBranch = nodes.find(node => node.index > branch.index && node.indent <= branch.indent);
    const descendants = nodes.filter(node => node.index > branch.index && (!nextBranch || node.index < nextBranch.index));
    const indent = Math.min(...descendants.map(node => node.indent));
    return descendants.filter(node => node.indent === indent).slice(0, 3);
  });
  // Balance the small overview across branches instead of filling the first branch.
  for (let depth = 0; depth < 3; depth++) for (const group of children) {
    if (chosen.size < maxNodes && group[depth]) chosen.add(group[depth].index);
  }
  return [lines[0], ...nodes.filter(node => chosen.has(node.index)).map(node => node.line)].join('\n');
}
export function normalizeMermaid(value) {
  if (typeof value !== 'string' || value.length > 50000) return null;
  let code = value.replace(/^\uFEFF/, '').trim().replace(/^```(?:mermaid|mindmap)?\s*\n?/i, '').replace(/\s*```$/, '').trim();
  // Generated diagrams cannot override the site's security/theme or embed actions/assets.
  if (!code || /%%\s*\{|^---\s*$|^\s*(?:click|callback|href)\s|<\/?(?:script|iframe|img|image|a)\b|javascript:|https?:\/\//im.test(code)) return null;
  if (/^mindmap\b/i.test(code)) {
    let lines = code.replace(/\t/g, '  ').split(/\r?\n/);
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
    code = compactMindmap(code);
  } else if (/^(?:flowchart|graph)\b/i.test(code)) {
    // LLMs often leave parentheses and punctuation unquoted in box/diamond labels.
    // Quote these labels without touching authored Markdown strings or styling.
    code = code.replace(/\b([A-Za-z_][\w-]*)(\[|\{)([^\[\]{}\n]*)(\]|\})/g, (whole, id, open, label, close) => {
      if ((open === '[') !== (close === ']') || /^\s*["']/.test(label) || !/[()"<>]/.test(label)) return whole;
      return `${id}${open}"${label.replace(/"/g, '#quot;').replace(/<br\s*\/?\s*>/gi, ' ')}"${close}`;
    });
  }
  const meaningful = code.split(/\r?\n/).filter(line => line.trim() && !/^\s*%%/.test(line));
  return meaningful.length >= 2 && diagramHeader.test(meaningful[0].trim()) ? code : null;
}
export const DIAGRAM_GENERATION_DIRECTIVE = `Give the complete written answer alongside useful diagrams. A diagram supplements the explanation; never replace requested study guidance, details or executable code with only a diagram. For study preparation/learning roadmaps, include one compact Mermaid mindmap unless the user requests a different diagram or no visuals. Honor the latest requested type: "mermaid diagram not mindmap" means flowchart, not mindmap. If both types are explicitly requested, include both. For code generation, provide the requested working code and explanation first. Assess its actual control flow: nontrivial recursion, several decisions, dependency ordering, cycle detection, state transitions, retries or multi-stage interactions benefit from a visual, so include one small flowchart or sequenceDiagram explaining those steps even without an explicit diagram request. For example, Kahn topological sorting with cycle detection, recursive tree traversal, and a multi-stage authentication/retry workflow should include a diagram. A simple utility, single expression or short linear snippet should not. Always omit diagrams when the user asks for code only or no diagrams.
Return one complete fenced mermaid block per diagram. Mindmaps: one root, 4-6 main branches, at most 2 short children per branch, 19 nodes maximum, at most 3 levels including the root. Put detailed study topics and exercises in prose, not dozens of leaf nodes. Flowcharts: use stable simple IDs, quoted labels, 5-12 meaningful nodes; sequenceDiagram for interactions. Use native chart JSON for quantitative charts. Use restrained contrasting colors for groups when helpful; preserve a requested palette. For flowcharts, classDef/class with purple #493886, green #17654e and blue #155478 with light text are supported. Keep labels short, use quoted Mermaid Markdown strings with actual line breaks for subtitles, never HTML line breaks. Use decision diamonds and labeled branches for choices. Mindmaps use automatic branch colors; indentation defines the hierarchy. Do not mix flowchart classDef/style/subgraph/end into mindmaps. Never add init/config directives, embedded HTML, links, click actions, placeholders or an empty outline. If no topic is available, ask for it in ordinary text. Follow supplied facts and labels.`;
