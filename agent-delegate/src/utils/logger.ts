type Level = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = (process.env.LOG_LEVEL as Level) || 'info';
let currentLevel: Level = ['error', 'warn', 'info', 'debug'].includes(envLevel) ? envLevel : 'info';

export function setLogLevel(level: Level) {
  currentLevel = level;
}

function shouldLog(level: Level) {
  return LEVELS[level] <= LEVELS[currentLevel];
}

function ts() {
  return new Date().toISOString();
}

export const log = {
  error: (msg: string, data?: unknown) => {
    if (!shouldLog('error')) return;
    console.error(`${prefix('error')} ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: unknown) => {
    if (!shouldLog('warn')) return;
    console.warn(`${prefix('warn ')} ${msg}`, data ?? '');
  },
  info: (msg: string, data?: unknown) => {
    if (!shouldLog('info')) return;
    console.log(`${prefix('info ')} ${msg}`, data ?? '');
  },
  debug: (msg: string, data?: unknown) => {
    if (!shouldLog('debug')) return;
    console.log(`${prefix('debug')} ${msg}`, data ?? '');
  },
  time: async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
    const start = Date.now();
    try {
      const result = await fn();
      const ms = Date.now() - start;
      return { result, ms };
    } catch (e) {
      const ms = Date.now() - start;
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { durationMs: ms });
    }
  },
  spinner(label: string) {
    const colorize = getColorFns();
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    let active = true;
    const start = Date.now();
    const tty = typeof process !== 'undefined' && !!process.stdout && !!process.stdout.isTTY;
    const simpleMode = !tty || process.env.FORCE_SIMPLE_SPINNER === '1';
    // Print an immediate first tick so users see progress without waiting for the first interval.
    const firstLine = colorize.cyan(`${frames[0]} ${label} (0s)`);
    if (tty && !simpleMode) {
      process.stdout.write(`\r${firstLine}`);
    } else {
      console.log(`${prefix('info ')} ${label} … 0s`);
    }
    let lastLoggedSec = -1;
    const interval = setInterval(() => {
      if (!active) return;
      const sec = Math.floor((Date.now() - start) / 1000);
      const frame = frames[(i = (i + 1) % frames.length)];
      const line = colorize.cyan(`${frame} ${label} (${sec}s)`);
      if (tty && !simpleMode) {
        process.stdout.write(`\r${line}`);
      } else {
        // Fallback to line-per-second logging when no TTY or forced simple mode
        if (sec !== lastLoggedSec) {
          lastLoggedSec = sec;
          console.log(`${prefix('info ')} ${label} … ${sec}s`);
        }
      }
    }, 120);
    return {
      stop(msg?: string) {
        active = false;
        clearInterval(interval);
        if (tty && !simpleMode) process.stdout.write('\r');
        if (msg) console.log(`${prefix('info ')} ${colorize.green(msg)}`);
      },
    };
  },
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Color helpers
function getColorFns() {
  const tty = typeof process !== 'undefined' && !!process.stdout && !!process.stdout.isTTY;
  const noColor = process.env.NO_COLOR === '1' || process.env.FORCE_COLOR === '0';
  const use = tty && !noColor;
  const wrap = (open: string, close: string) => (s: string) => (use ? `${open}${s}${close}` : s);
  return {
    red: wrap('\x1b[31m', '\x1b[39m'),
    yellow: wrap('\x1b[33m', '\x1b[39m'),
    green: wrap('\x1b[32m', '\x1b[39m'),
    blue: wrap('\x1b[34m', '\x1b[39m'),
    magenta: wrap('\x1b[35m', '\x1b[39m'),
    cyan: wrap('\x1b[36m', '\x1b[39m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
    bold: wrap('\x1b[1m', '\x1b[22m'),
  };
}

export const colors = getColorFns();

function prefix(levelTag: string) {
  const color = getColorFns();
  const now = `[${ts()}]`;
  const lvl =
    levelTag.trim() === 'error'
      ? color.red('[error]')
      : levelTag.trim() === 'warn'
      ? color.yellow('[warn ]')
      : levelTag.trim() === 'debug'
      ? color.dim('[debug]')
      : color.cyan('[info ]');
  return `${now} ${lvl}`;
}
