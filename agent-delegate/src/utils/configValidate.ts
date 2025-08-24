import { AVAILABLE_PROTOCOLS, DISCUSSION_URL } from './x23Config.js';
import { log, colors } from './logger.js';

function bool(val: any): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  const s = String(val).toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return undefined;
}

export function validateConfig(): void {
  const errs: string[] = [];
  if (!process.env.X23_API_KEY) errs.push('X23_API_KEY is required for search tools');
  if (!Array.isArray(AVAILABLE_PROTOCOLS) || AVAILABLE_PROTOCOLS.length === 0)
    errs.push('X23_PROTOCOLS must include at least one protocol');
  if (!DISCUSSION_URL) errs.push('X23_DISCUSSION_URL must be set');

  const numeric = [
    ['REASONER_REFINE_ITERS', 1, 6],
    ['REASONER_PREMISE_EVIDENCE_MAX', 0, 10],
    ['DEVILS_PREMISE_EVIDENCE_MAX', 0, 10],
    ['REASONER_EVIDENCE_CONCURRENCY', 1, 6],
    ['DEVILS_EVIDENCE_CONCURRENCY', 1, 6],
  ] as const;
  for (const [key, min, max] of numeric) {
    const v = process.env[key];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max)
      errs.push(`${key} must be a number in [${min}, ${max}]`);
  }
  const flags = ['FACT_ENABLE_QUERY_REWRITE'];
  for (const f of flags) {
    const b = bool(process.env[f]);
    if (process.env[f] !== undefined && b === undefined)
      errs.push(`${f} must be a boolean (1/0/true/false/yes/no)`);
  }

  if (errs.length) {
    errs.forEach((e) => log.error(colors.red(`Config error: ${e}`)));
    throw new Error('Invalid configuration. See errors above.');
  }
  log.info('Config validated', {
    protocols: AVAILABLE_PROTOCOLS,
    forum: DISCUSSION_URL,
  });

  // Optional: Alchemy Prices API key for price checks
  if (!process.env.ALCHEMY_PRICES_API_KEY) {
    log.warn('ALCHEMY_PRICES_API_KEY not set — price lookups will be unavailable');
  }
  // Optional: Symbol map for price fallback
  if (process.env.ALCHEMY_PRICES_SYMBOL_MAP) {
    try {
      const m = JSON.parse(process.env.ALCHEMY_PRICES_SYMBOL_MAP);
      if (!m || typeof m !== 'object') throw new Error('not an object');
    } catch (e) {
      log.warn('Invalid ALCHEMY_PRICES_SYMBOL_MAP (must be JSON object mapping symbol→{network,address})');
    }
  }
}
