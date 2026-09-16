// Loads the real browser SignalEngine (public/lib/signal.js + indicators.js) into a
// vm sandbox so Node scripts can compute the exact same signal the website shows,
// without duplicating or reimplementing any of its logic.
import fsSync from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(__dirname, '..', '..', 'public', 'lib');

function loadLibs() {
  const sandbox = { window: {}, console, Date, Math, JSON };
  vm.createContext(sandbox);
  for (const name of ['indicators.js', 'signal.js']) {
    const code = fsSync.readFileSync(path.join(LIB_DIR, name), 'utf8');
    vm.runInContext(code, sandbox, { filename: name });
    Object.assign(sandbox, sandbox.window);
  }
  return sandbox.window;
}

export function loadSignalEngine() {
  return loadLibs().SignalEngine;
}

export function loadTA() {
  return loadLibs().TA;
}
