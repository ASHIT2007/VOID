import { RELEASE_SYNC, newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten';
declare function importScripts(...urls: string[]): void;
declare const self: { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown): void; loadPyodide?: (options: object) => Promise<any> };
self.onmessage = async ({ data }) => {
  let output = '';
  const append = (value: string) => { output = (output + value + '\n').slice(0, 40000); };
  try {
    if (!['python', 'javascript'].includes(data.language) || typeof data.code !== 'string' || data.code.length > 30000) throw new Error('Unsupported program.');
    self.postMessage({ type: 'status', text: 'Loading the local runtime…' });
    if (data.language === 'javascript') {
      const engine = await newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmLocation: `${data.base}/emscripten-module.wasm` }));
      const runtime = engine.newRuntime(); runtime.setMemoryLimit(64 * 1024 * 1024); runtime.setMaxStackSize(512 * 1024);
      const deadline = Date.now() + 10000; runtime.setInterruptHandler(() => Date.now() > deadline);
      const vm = runtime.newContext();
      try {
        const log = vm.newFunction('log', (...args) => append(args.map(arg => String(vm.dump(arg))).join(' ')));
        const consoleObject = vm.newObject(); vm.setProp(consoleObject, 'log', log); vm.setProp(consoleObject, 'error', log); vm.setProp(vm.global, 'console', consoleObject);
        consoleObject.dispose(); log.dispose();
        self.postMessage({ type: 'status', text: 'Running JavaScript…' });
        const result = vm.evalCode(data.code);
        if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw new Error(error.message || 'JavaScript failed.'); }
        const value = vm.dump(result.value); result.value.dispose(); if (value !== undefined) append(String(value));
      } finally { vm.dispose(); runtime.dispose(); }
    } else {
      importScripts(`${data.base}/pyodide.js`);
      const python = await self.loadPyodide!({ indexURL: data.base + '/', stdout: append, stderr: append });
      // No host bindings are provided. The enclosing opaque-origin worker CSP
      // blocks network except immutable local runtime assets, and has no DOM/storage.
      self.postMessage({ type: 'status', text: 'Running Python…' });
      const result = await python.runPythonAsync(data.code);
      if (result !== undefined && result !== null) append(String(result));
      result?.destroy?.();
    }
    self.postMessage({ type: 'result', output: output || '(No output)', success: true });
  } catch (error) { self.postMessage({ type: 'result', output, success: false, error: error instanceof Error ? error.message.slice(0, 1500) : 'Execution failed.' }); }
};
