import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const resolveModule = createRequire(import.meta.url).resolve;

// Mermaid's real parser needs a DOM for label sanitization. Keep that DOM and
// Mermaid's global configuration isolated from the agent server in one worker.
let worker: Worker | undefined;
let initialized = false;
let serial = 0;
const pending = new Map<number, (error: string | null) => void>();
function parserWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const ready = (async () => {
      const { JSDOM } = await import(${JSON.stringify(pathToFileURL(resolveModule('jsdom')).href)});
      const dom = new JSDOM('<!doctype html><html><body></body></html>');
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      const mermaid = (await import(${JSON.stringify(pathToFileURL(resolveModule('mermaid')).href)})).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
      parentPort.postMessage({ready: true});
      return mermaid;
    })();
    let queue = Promise.resolve();
    parentPort.on('message', ({id, code}) => {
      queue = queue.catch(() => {}).then(async () => {
        try { await (await ready).parse(code); parentPort.postMessage({id, error: null}); }
        catch (error) { parentPort.postMessage({id, error: String(error.message || 'Invalid Mermaid syntax').slice(0, 600)}); }
      });
    });
  `, { eval: true, execArgv: [] });
  instance.on('message', ({ id, error, ready }: { id: number; error: string | null; ready?: boolean }) => {
    if (ready) { initialized = true; return; }
    pending.get(id)?.(error); pending.delete(id);
    if (!pending.size) instance.unref();
  });
  instance.on('error', () => {
    for (const finish of pending.values()) finish('Diagram syntax validation is unavailable.');
    pending.clear(); worker = undefined; initialized = false;
  });
  instance.on('exit', () => { if (worker === instance) { worker = undefined; initialized = false; } });
  instance.unref(); worker = instance;
  return instance;
}
export function warmDiagramParser(): void { parserWorker(); }

export async function validateDiagramSyntax(code: string): Promise<string | null> {
  return new Promise(resolve => {
    const id = ++serial, instance = parserWorker();
    const timer = setTimeout(() => {
      for (const finish of pending.values()) finish('Diagram syntax validation timed out.');
      pending.clear(); worker = undefined; initialized = false;
      void instance.terminate();
    }, initialized ? 15_000 : 45_000);
    pending.set(id, error => { clearTimeout(timer); resolve(error); });
    instance.ref(); instance.postMessage({ id, code });
  });
}
