import { execFileSync } from 'node:child_process';

// Scan the index so accidentally staged ignored files cannot bypass this check.
// Only locations are printed: credential values must never enter CI logs.
const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
const ids = entries.filter(entry => !entry.startsWith('160000 ')).map(entry => entry.split(' ')[1]);
const sizes = new Map(execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objectsize)'], {
  input: ids.join('\n') + '\n', encoding: 'utf8',
}).trim().split('\n').map(line => { const [id, size] = line.split(' '); return [id, Number(size)]; }));
const smallIds = [...new Set(ids.filter(id => sizes.get(id) <= 5 * 1024 * 1024))];
const blobs = execFileSync('git', ['cat-file', '--batch'], {
  input: smallIds.join('\n') + '\n', maxBuffer: 256 * 1024 * 1024,
});
const contents = new Map();
let offset = 0;
for (const id of smallIds) {
  const headerEnd = blobs.indexOf(10, offset);
  const size = sizes.get(id);
  contents.set(id, blobs.subarray(headerEnd + 1, headerEnd + 1 + size));
  offset = headerEnd + size + 2;
}
const secretPatterns = [
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bgsk_[0-9A-Za-z]{40,}\b/,
  /\bsk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{40,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{30,}\b/,
  /\bhf_[0-9A-Za-z]{30,}\b/,
  /\b(?:tgp_v1_|nvapi-)[0-9A-Za-z_-]{30,}\b/,
  /\bsk_[0-9A-Za-z]{30,}\b/,
  /\bAQ\.[0-9A-Za-z_-]{35,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const entry of entries) {
  const [metadata, filename] = entry.split('\t');
  const [mode, objectId] = metadata.split(' ');
  if (mode === '160000') { problems.push(`${filename}: nested repository is not a source checkout`); continue; }
  if (/(^|\/)(?:node_modules[^/]*|\.next[^/]*|data|\.venv|__pycache__)\//.test(filename)
    || /(^|\/)\.env(?:\.|$)/.test(filename) && !filename.endsWith('.env.example')
    || /\.(?:db|sqlite)(?:[.-].*)?$/.test(filename)
    || /(?:\.log|\.tsbuildinfo|\.pem|\.key)$/.test(filename)) {
    problems.push(`${filename}: private or generated file`);
  }
  const size = sizes.get(objectId);
  if (size > 50 * 1024 * 1024) { problems.push(`${filename}: exceeds 50 MiB; use external asset storage`); continue; }
  if (size > 5 * 1024 * 1024) continue;
  const content = contents.get(objectId);
  if (content.includes(0)) continue;
  const lines = content.toString('utf8').split('\n');
  lines.forEach((line, index) => {
    if (secretPatterns.some(pattern => pattern.test(line))) problems.push(`${filename}:${index + 1}: possible credential`);
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Repository check passed (${entries.length} staged/tracked files).`);
}
