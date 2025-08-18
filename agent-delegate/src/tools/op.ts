/**
 * Simple tool to fetch OP token circulating supply.
 * Source: https://static.optimism.io/tokenomics/circulatingSupply.txt
 */

const OP_SUPPLY_URL = 'https://static.optimism.io/tokenomics/circulatingSupply.txt';

export interface CirculatingSupply {
  supply: number; // numeric representation (may lose precision if extremely large)
  raw: string; // exact raw text
  fetchedAt: string; // ISO timestamp
  unit: 'OP';
}

export async function getOPCirculatingSupply(): Promise<CirculatingSupply> {
  const res = await fetch(OP_SUPPLY_URL, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch OP circulating supply ${res.status}: ${text}`);
  }
  const raw = (await res.text()).trim();
  // Normalize: remove commas/underscores/spaces
  const normalized = raw.replace(/[,_\s]/g, '');
  const supply = Number(normalized);
  if (!Number.isFinite(supply)) {
    throw new Error(`Unable to parse OP circulating supply from '${raw}'`);
  }
  return { supply, raw, fetchedAt: new Date().toISOString(), unit: 'OP' };
}

