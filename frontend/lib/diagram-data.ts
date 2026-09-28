const label = (value: unknown) => String(value ?? '').replace(/[&<>"\n\r]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\n': ' ', '\r': ' ' }[character]!)).slice(0, 200);
export function mindMapToMermaid(data: { title: string; categories: Array<{ name: string; children: string[] }> }) {
  return `mindmap\n  root["${label(data.title)}"]\n${data.categories.filter(Boolean).slice(0, 40).map((category, index) => `    branch${index}["${label(category.name)}"]\n${(Array.isArray(category.children) ? category.children : []).slice(0, 40).map((child, childIndex) => `      topic${index}_${childIndex}["${label(child)}"]`).join('\n')}`).join('\n')}`;
}
export function graphToMermaid(data: { directed?: boolean; nodes: Array<{ id: string; label?: string }>; edges: Array<{ from: string; to: string; label?: string }> }) {
  const safeNodes = data.nodes.filter(node => node && typeof node.id === 'string').slice(0, 200);
  const ids = new Map(safeNodes.map((node, index) => [node.id, `node${index}`]));
  const nodes = safeNodes.map(node => `  ${ids.get(node.id)}["${label(node.label || node.id)}"]`);
  const edges = data.edges.filter(edge => edge && ids.has(edge.from) && ids.has(edge.to)).slice(0, 400).map(edge => `  ${ids.get(edge.from)} ${data.directed ? '-->' : '---'}${edge.label ? `|"${label(edge.label)}"|` : ''} ${ids.get(edge.to)}`);
  return ['flowchart LR', ...nodes, ...edges].join('\n');
}
