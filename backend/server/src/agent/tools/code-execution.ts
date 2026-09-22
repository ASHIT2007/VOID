import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';

export function registerCodeExecutionTools(): void {
  const handler: ToolHandler = async (args) => {
    const code = args.code as string;
    const language = (args.language as string) || 'python';

    if (typeof code !== 'string') {
      return { content: '', error: 'Code must be a string' };
    }

    const tmpDir = path.join(os.tmpdir(), crypto.randomUUID());
    fs.mkdirSync(tmpDir, { recursive: true });

    const filename = language === 'javascript' ? 'script.js' : 'script.py';
    const filepath = path.join(tmpDir, filename);
    fs.writeFileSync(filepath, code, 'utf-8');

    const cmd = language === 'javascript' ? 'node' : 'python3';

    return new Promise((resolve) => {
      const child = spawn(cmd, [filepath], { cwd: tmpDir, timeout: 30000 });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        let content = `Execution finished with code ${code}\n\n`;
        if (stdout) content += `STDOUT:\n${stdout}\n`;
        if (stderr) content += `STDERR:\n${stderr}\n`;

        try {
          const files = fs.readdirSync(tmpDir).filter(f => f !== filename);
          if (files.length > 0) {
            content += `\nFiles created:\n${files.join('\n')}\n`;
          }
        } catch (e) {}

        setTimeout(() => {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }, 5000);

        resolve({ content });
      });

      child.on('error', (err) => {
        setTimeout(() => {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }, 5000);
        resolve({ content: '', error: `Execution failed: ${err.message}` });
      });
    });
  };

  registerTool(
    'code_execution',
    {
      type: 'function',
      function: {
        name: 'code_execution',
        description: 'Execute Python or JavaScript code',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'The code to execute' },
            language: { type: 'string', enum: ['python', 'javascript'], description: 'The programming language' }
          },
          required: ['code']
        }
      }
    },
    handler,
    { requiresConfirmation: true, readOnly: false, category: 'code' }
  );
}
