import fs from 'fs';
import path from 'path';

export function logDebug(msg: string) {
  try {
    fs.appendFileSync(path.join(process.cwd(), 'agent-debug.log'), new Date().toISOString() + ' ' + msg + '\n');
  } catch(e) {}
}
