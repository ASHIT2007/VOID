/** Conservative fallback detection: prose mentioning code is still prose. */
export function detectCodeLanguage(code: string, language = ""): string {
  const aliases: Record<string, string> = { js: "javascript", ts: "typescript", md: "markdown", mdx: "markdown", txt: "text", plaintext: "text", plain: "text" };
  const label = language.trim().toLowerCase();
  const explicit = aliases[label] || label;
  const value = code.trim();
  const lines = value.split(/\r?\n/);
  const headings = lines.filter(line => /^\s{0,3}#{1,6}\s+\S/.test(line)).length;
  const markdownItems = lines.filter(line => /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+|>\s+|\*\*[^*]+\*\*)/.test(line)).length;
  const codeStatements = /^\s*(?:(?:export\s+)?(?:const|let|var)\s+[\w$[{][^\n]*=|(?:export\s+)?(?:async\s+)?function\s*[\w$]*\s*\(|import\s.+\sfrom\s|(?:def|class)\s+\w+|(?:console\.log|print)\s*\()/m.test(value);
  // Repair obviously mislabelled Markdown, while leaving real program source intact.
  if ((!explicit || ["code", "javascript", "text", "markdown"].includes(explicit)) && !codeStatements && (headings >= 2 || (headings >= 1 && markdownItems >= 2))) return "markdown";
  if (explicit && explicit !== "code") return explicit;
  if (/^[\[{]/.test(value)) {
    try { JSON.parse(value); return "json"; } catch { /* Continue conservative detection. */ }
  }
  if (/^(?:<!doctype html|<html\b|<body\b|<div\b|<section\b)/i.test(value)) return "html";
  if (/^<svg\b/i.test(value)) return "svg";
  if (/^\s*(?:export\s+)?(?:interface\s+\w+\s*\{|type\s+\w+\s*=)/m.test(value)) return "typescript";
  if (/^\s*(?:import\s+React\b|return\s*\(?\s*<[A-Z])|className=["'{]/m.test(value)) return "tsx";
  if (/^\s*(?:from\s+\w[\w.]*\s+import|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(value)) return "python";
  if (codeStatements) return "javascript";
  if (/^\s*(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\b/im.test(value)) return "sql";
  if (/^\s*(?:#!\/.*(?:bash|sh)|(?:npm|pnpm|yarn|git|curl|docker)\s+)/m.test(value)) return "bash";
  if (/^\s*#include\s*[<"]|\bstd::/.test(value)) return "cpp";
  if (/\bpublic\s+static\s+void\s+main\b|\bSystem\.out\.println\s*\(/.test(value)) return "java";
  if (/\bnamespace\s+[\w.]+\s*[{;]|\bConsole\.WriteLine\s*\(/.test(value)) return "csharp";
  if (/^[.#]?[a-z][\w-]*(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*:[^;]+;/im.test(value)) return "css";
  return "text";
}
