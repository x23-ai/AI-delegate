/**
 * Simple tool to fetch OP token circulating supply.
 * Source: https://static.optimism.io/tokenomics/circulatingSupply.txt
 */

const OP_SUPPLY_URL = 'https://static.optimism.io/tokenomics/circulatingSupply.txt';
import { log, colors } from '../utils/logger.js';

export interface CirculatingSupply {
  supply: number; // numeric representation (may lose precision if extremely large)
  raw: string; // exact raw text
  fetchedAt: string; // ISO timestamp
  unit: 'OP';
}

export async function getOPCirculatingSupply(): Promise<CirculatingSupply> {
  const spinner = log.spinner('Fetch OP circulating supply');
  const start = Date.now();
  const res = await fetch(OP_SUPPLY_URL, { method: 'GET' });
  const ms = Date.now() - start;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    spinner.stop(`${colors.red('✗')} OP supply fetch ${colors.dim(`(${ms}ms)`)}`);
    log.error(`${colors.blue('OP supply')} ${colors.red('✗')} ${colors.dim(`(${ms}ms)`)} ${colors.red(String(res.status))}`);
    throw new Error(`Failed to fetch OP circulating supply ${res.status}: ${text}`);
  }
  spinner.stop(`${colors.green('✓')} OP supply fetched ${colors.dim(`(${ms}ms)`)}`);
  log.info(`${colors.blue('OP supply')} ${colors.green('✓')} ${colors.dim(`(${ms}ms)`)}`);
  const raw = (await res.text()).trim();
  // Normalize: remove commas/underscores/spaces
  const normalized = raw.replace(/[,_\s]/g, '');
  const supply = Number(normalized);
  if (!Number.isFinite(supply)) {
    throw new Error(`Unable to parse OP circulating supply from '${raw}'`);
  }
  return { supply, raw, fetchedAt: new Date().toISOString(), unit: 'OP' };
}
