export async function runDeviceCode(code: string, language: string, onStatus: (text: string) => void = () => {}): Promise<string> {
  if (!['python', 'javascript'].includes(language) || code.length > 30000) throw new Error('Use Python or JavaScript, at most 30,000 characters.');
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe'); iframe.sandbox.add('allow-scripts'); iframe.src = '/api/sandbox'; iframe.hidden = true;
    const id = crypto.randomUUID();
    let started = false;
    const finish = (error?: string, output?: string) => { clearTimeout(timer); window.removeEventListener('message', listener); iframe.remove(); error ? reject(new Error(error)) : resolve(output || '(No output)'); };
    const listener = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type === 'ready' && !started) { started = true; iframe.contentWindow?.postMessage({ type: 'run', id, code, language }, '*'); return; }
      if (data?.id !== id) return;
      if (data.type === 'status') onStatus(String(data.text));
      else if (data.type === 'timeout') finish('Execution exceeded 30 seconds and was stopped.');
      else if (data.type === 'result') finish(data.success ? undefined : String(data.error || 'Execution failed.'), String(data.output || ''));
    };
    const timer = setTimeout(() => finish('Execution exceeded 35 seconds and was stopped.'), 35000);
    window.addEventListener('message', listener); document.body.appendChild(iframe);
  });
}
