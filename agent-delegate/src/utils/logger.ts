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
    if (shouldLog('error')) console.error(`[${ts()}] [error] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: unknown) => {
    if (shouldLog('warn')) console.warn(`[${ts()}] [warn ] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: unknown) => {
    if (shouldLog('info')) console.log(`[${ts()}] [info ] ${msg}`, data ?? '');
  },
  debug: (msg: string, data?: unknown) => {
    if (shouldLog('debug')) console.log(`[${ts()}] [debug] ${msg}`, data ?? '');
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
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    let active = true;
    const start = Date.now();
    const tty = typeof process !== 'undefined' && process.stdout && process.stdout.isTTY;
    const interval = setInterval(() => {
      if (!active) return;
      const sec = Math.floor((Date.now() - start) / 1000);
      const frame = frames[i = (i + 1) % frames.length];
      const line = `${frame} ${label} (${sec}s)`;
      if (tty) {
        process.stdout.write(`\r${line}`);
      } else {
        // Fallback to periodic info logs when no TTY
        if (sec % 5 === 0) console.log(`[${ts()}] [info ] ${label} … ${sec}s`);
      }
    }, 120);
    return {
      stop(msg?: string) {
        active = false;
        clearInterval(interval);
        if (tty) process.stdout.write('\r');
        if (msg) console.log(`[${ts()}] [info ] ${msg}`);
      },
    };
  },
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
