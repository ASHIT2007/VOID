import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'frontend/public/sandbox-runtime');
await fs.mkdir(output, { recursive: true });
for (const name of ['pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await fs.copyFile(path.join(root, 'node_modules/pyodide', name), path.join(output, name));
}
await fs.copyFile(path.join(root, 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm'), path.join(output, 'emscripten-module.wasm'));
const licenseFiles = ['pyodide-MPL-2.0.txt', 'cpython-LICENSE.txt', 'quickjs-MIT.txt'];
const notices = `VOID ships unmodified Pyodide and QuickJS runtime libraries.\nPyodide source: https://github.com/pyodide/pyodide/tree/314.0.7\nCPython source: https://github.com/python/cpython/tree/v3.14.0\nQuickJS/adapter source: https://github.com/justjake/quickjs-emscripten\n\n` + (await Promise.all(licenseFiles.map(name => fs.readFile(path.join(root, 'docs/licenses', name), 'utf8')))).join('\n\n');
await fs.writeFile(path.join(output, 'NOTICES.txt'), notices);
await build({ entryPoints: [path.join(root, 'frontend/lib/workspace/sandbox-worker.ts')], outfile: path.join(output, 'worker.js'), bundle: true, platform: 'browser', format: 'iife', minify: true, logLevel: 'warning' });
console.log('Local Python and JavaScript sandbox assets prepared.');
