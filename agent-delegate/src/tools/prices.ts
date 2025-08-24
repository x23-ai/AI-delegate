/**
 * Alchemy Prices API tool
 * Lightweight client to fetch current and historical token prices.
 *
 * Configuration (env):
 * - ALCHEMY_PRICES_API_KEY: your Alchemy Prices API key (required to use the API)
 * - ALCHEMY_PRICES_BASE_URL: base URL, defaults to 'https://api.g.alchemy.com/prices/v1'
 * - ALCHEMY_PRICES_BY_SYMBOL_PATH: path for spot-by-symbol (default: 'tokens/by-symbol')
 * - ALCHEMY_PRICES_BY_ADDRESS_PATH: path for spot-by-address (default: 'tokens/by-address')
 * - ALCHEMY_PRICES_HIST_PATH: path for historical series (default: 'tokens/historical')
 *
 * Notes:
 * - Depending on your Alchemy account/plan, the exact endpoint paths may vary.
 *   If your account uses different paths, set the *_PATH env vars accordingly.
 */

import { log, colors } from '../utils/logger.js';

export type Fiat = 'USD' | 'EUR' | 'GBP' | string;

export type Interval = '5m' | '1h' | '1d';

export interface PricesConfig {
  apiKey?: string;
  baseUrl?: string;
  bySymbolPath?: string;
  byAddressPath?: string;
  histPath?: string;
  timeoutMs?: number;
}

export type AddressOnChain = { address: string; chainId?: number | string; network?: string };

export interface SpotPriceParams {
  symbol?: string; // e.g., 'OP'
  asset?: AddressOnChain; // contract address and optional chainId
  currencies?: Fiat[]; // e.g., ['USD']
  convert?: Fiat; // deprecated: maps to currencies [convert]
  at?: number | Date | string; // optional UNIX seconds or ISO string
}

export interface HistoricalPriceParams {
  symbol?: string;
  asset?: AddressOnChain; // contract address and optional chainId
  currencies?: Fiat[]; // e.g., ['USD']
  convert?: Fiat; // deprecated: maps to currencies [convert]
  start: number | Date | string; // inclusive
  end?: number | Date | string; // exclusive (defaults to now)
  interval?: Interval; // default '1d'
  limit?: number; // optional cap on returned points
  withMarketData?: boolean; // include market cap and volume
}

export interface SpotPriceQuote {
  symbol?: string;
  address?: string;
  chainId?: number | string;
  price: number; // in `currency`
  currency: Fiat; // e.g., 'USD'
  at: string; // ISO timestamp
  source: 'alchemy';
  raw?: any; // raw response for debugging
}

export interface PricePoint {
  ts: string; // ISO
  price: number; // in `currency`
}

export interface PriceSeries {
  symbol?: string;
  address?: string;
  chainId?: number | string;
  currency: Fiat;
  interval: Interval;
  points: PricePoint[];
  source: 'alchemy';
  raw?: any; // raw response for debugging
}

export class AlchemyPricesClient {
  private apiKey: string | undefined;
  private baseUrl: string;
  private bySymbolPath: string;
  private byAddressPath: string;
  private histPath: string;
  private timeoutMs: number;

  constructor(cfg: PricesConfig = {}) {
    this.apiKey = cfg.apiKey ?? process.env.ALCHEMY_PRICES_API_KEY;
    this.baseUrl = (cfg.baseUrl ?? process.env.ALCHEMY_PRICES_BASE_URL ?? 'https://api.g.alchemy.com/prices/v1').replace(/\/$/, '');
    this.bySymbolPath = (cfg.bySymbolPath ?? process.env.ALCHEMY_PRICES_BY_SYMBOL_PATH ?? 'tokens/by-symbol').replace(/^\//, '');
    this.byAddressPath = (cfg.byAddressPath ?? process.env.ALCHEMY_PRICES_BY_ADDRESS_PATH ?? 'tokens/by-address').replace(/^\//, '');
    this.histPath = (cfg.histPath ?? process.env.ALCHEMY_PRICES_HIST_PATH ?? 'tokens/historical').replace(/^\//, '');
    this.timeoutMs = Number(cfg.timeoutMs ?? process.env.ALCHEMY_PRICES_TIMEOUT_MS ?? 15000);
  }

  /**
   * Fetch the spot (current or point-in-time) price.
   */
  async getSpotPrice(params: SpotPriceParams): Promise<SpotPriceQuote> {
    const { symbol, asset, at } = params;
    if (!this.apiKey) throw new Error('ALCHEMY_PRICES_API_KEY is not set');
    if (!symbol && !asset?.address) throw new Error('getSpotPrice requires a symbol or asset.address');
    // If a historical timestamp is requested, derive spot from the historical series
    const ts = toUnixOpt(at);
    if (ts) {
      const series = await this.getHistoricalSeries({ symbol, asset, start: ts, end: ts, interval: '1d', limit: 1 });
      const p = series.points[series.points.length - 1];
      if (!p) throw new Error('No historical price returned at requested timestamp');
      return {
        symbol,
        address: asset?.address,
        chainId: asset?.chainId,
        price: p.price,
        currency: series.currency,
        at: p.ts,
        source: 'alchemy',
        raw: series.raw,
      };
    }

    const spinner = log.spinner('Alchemy spot price');
    const path = symbol ? this.bySymbolPath : this.byAddressPath;
    const base = `${this.baseUrl}/${encodeURIComponent(this.apiKey!)}/${path}`;
    const currencies = normalizeCurrencies(params);
    let res: Response;
    const start = Date.now();
    if (symbol) {
      const u = new URL(base);
      u.searchParams.append('symbols', String(symbol).toUpperCase());
      (currencies || []).forEach((c) => u.searchParams.append('currencies', String(c)));
      res = await fetchWithTimeout(u.toString(), { method: 'GET' }, this.timeoutMs);
    } else {
      const body = { addresses: [{ network: resolveNetwork(asset!), address: asset!.address }], currencies } as any;
      res = await fetchWithTimeout(base, { method: 'POST', body: JSON.stringify(body) }, this.timeoutMs);
    }
    const ms = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      spinner.stop(`${colors.red('✗')} Alchemy spot ${colors.dim(`(${ms}ms)`)}`);
      throw new Error(`Alchemy spot price ${res.status}: ${text}`);
    }
    const json = await res.json().catch(() => ({}));
    spinner.stop(`${colors.green('✓')} Alchemy spot ${colors.dim(`(${ms}ms)`)}`);
    const q = mapSpot(json);
    return {
      symbol,
      address: asset?.address,
      chainId: asset?.chainId,
      price: q.price,
      currency: (q.currency || (currencies && currencies[0]) || 'USD') as Fiat,
      at: q.at || new Date().toISOString(),
      source: 'alchemy',
      raw: json,
    };
  }

  /**
   * Fetch historical price series between start and end.
   */
  async getHistoricalSeries(params: HistoricalPriceParams): Promise<PriceSeries> {
    const { symbol, asset, start, end, interval = '1d', limit, withMarketData } = params;
    if (!this.apiKey) throw new Error('ALCHEMY_PRICES_API_KEY is not set');
    if (!symbol && !asset?.address) throw new Error('getHistoricalSeries requires a symbol or asset.address');
    const sUnix = toUnix(start);
    const eUnix = end ? toUnix(end) : Math.floor(Date.now() / 1000);

    const spinner = log.spinner('Alchemy historical prices');
    const url = `${this.baseUrl}/${encodeURIComponent(this.apiKey!)}/${this.histPath}`;
    const body: any = {
      startTime: sUnix,
      endTime: eUnix,
      interval,
      withMarketData: withMarketData ?? false,
    };
    if (symbol) {
      body.symbol = String(symbol).toUpperCase();
    } else if (asset?.address) {
      body.network = resolveNetwork(asset);
      body.address = asset.address;
    }
    // Remove undefined fields
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

    const startMs = Date.now();
    const res = await fetchWithTimeout(url, { method: 'POST', body: JSON.stringify(body) }, this.timeoutMs);
    const ms = Date.now() - startMs;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      spinner.stop(`${colors.red('✗')} Alchemy historical ${colors.dim(`(${ms}ms)`)}`);
      throw new Error(`Alchemy historical prices ${res.status}: ${text}`);
    }
    const json = await res.json().catch(() => ({}));
    spinner.stop(`${colors.green('✓')} Alchemy historical ${colors.dim(`(${ms}ms)`)}`);
    let series = mapSeries(json);
    // Automatic fallback: if symbol returned 0 points and we know a canonical address (or asset provided), try address
    if ((symbol || asset?.address) && series.points.length === 0) {
      const fallbackAsset = asset?.address
        ? asset
        : inferAssetFromSymbol(symbol);
      if (fallbackAsset?.address) {
        try {
          const body2: any = {
            network: resolveNetwork(fallbackAsset),
            address: fallbackAsset.address,
            startTime: sUnix,
            endTime: eUnix,
            interval,
            withMarketData: withMarketData ?? false,
          };
          const res2 = await fetchWithTimeout(url, { method: 'POST', body: JSON.stringify(body2) }, this.timeoutMs);
          if (res2.ok) {
            const json2 = await res2.json().catch(() => ({}));
            const series2 = mapSeries(json2);
            if (series2.points.length > 0) series = series2;
          }
        } catch {}
      }
    }
    return {
      symbol,
      address: asset?.address,
      chainId: asset?.chainId,
      currency: (series.currency || 'USD') as Fiat,
      interval: (series.interval || interval) as Interval,
      points: series.points,
      source: 'alchemy',
      raw: json,
    };
  }
}

// Convenience helpers for common assets
export const KNOWN_ASSETS = {
  OP_OPTIMISM: {
    address: '0x4200000000000000000000000000000000000042',
    chainId: 10,
  } as AddressOnChain,
};

// Optional env-driven symbol map to network/address for fallback
// Env var: ALCHEMY_PRICES_SYMBOL_MAP = '{"OP":{"network":"opt-mainnet","address":"0x4200...0042"}, ...}'
let _symbolMapCache: Record<string, { network?: string; address?: string; chainId?: number | string }> | null = null;
function getEnvSymbolMap() {
  if (_symbolMapCache) return _symbolMapCache;
  const raw = process.env.ALCHEMY_PRICES_SYMBOL_MAP;
  if (!raw) {
    _symbolMapCache = {};
    return _symbolMapCache;
  }
  try {
    const obj = JSON.parse(raw);
    const map: Record<string, { network?: string; address?: string; chainId?: number | string }> = {};
    for (const [k, v] of Object.entries<any>(obj || {})) {
      if (!k) continue;
      const sym = k.toUpperCase().trim();
      if (v && (v as any).address) {
        map[sym] = { address: (v as any).address, network: (v as any).network, chainId: (v as any).chainId };
      }
    }
    _symbolMapCache = map;
  } catch {
    _symbolMapCache = {};
  }
  return _symbolMapCache;
}

function inferAssetFromSymbol(symbol?: string | null): AddressOnChain | undefined {
  if (!symbol) return undefined;
  const s = symbol.toUpperCase().trim();
  // Env map takes precedence
  const envMap = getEnvSymbolMap();
  if (envMap[s]?.address) {
    const m = envMap[s]!;
    return { address: m.address!, chainId: m.chainId, network: m.network };
  }
  if (s === 'OP') return { ...KNOWN_ASSETS.OP_OPTIMISM, network: 'opt-mainnet' };
  return undefined;
}

// Internal mapping helpers to normalize JSON from the API to our types
function mapSpot(json: any): { price: number; currency?: string; at?: string } {
  // Expected shape per spec:
  // { data: [ { symbol, prices: [{ currency, value, lastUpdatedAt }], error } ] }
  try {
    const arr = (json && json.data) || [];
    const first = arr[0];
    const priceObj = first?.prices?.[0];
    const value = typeof priceObj?.value === 'string' ? parseFloat(priceObj.value) : Number(priceObj?.value);
    if (Number.isFinite(value)) {
      return { price: value, currency: priceObj?.currency, at: priceObj?.lastUpdatedAt };
    }
  } catch {}
  throw new Error('Unexpected spot price response format');
}

function mapSeries(json: any): { currency?: string; interval?: string; points: PricePoint[] } {
  // Expected shape per spec:
  // Primary shapes observed:
  // 1) { symbol, currency, data: [{ value, timestamp, ... }] }
  // 2) { data: { symbol, prices: [{ value, timestamp, ... }] } }
  // 3) { data: [ { symbol, prices: [...] } ] }
  try {
    let pts: any[] | undefined;
    let currency: string | undefined = (json as any)?.currency;
    const data = (json as any)?.data;
    // Shape 1: top-level currency + data array of points
    if (Array.isArray(data) && data.length && data[0] && (data[0].value !== undefined || data[0].price !== undefined)) {
      pts = data;
    }
    // Shape 2: nested data.prices
    if (!pts && data && Array.isArray((data as any).prices)) {
      pts = (data as any).prices;
      currency = currency || (data as any).currency;
    }
    // Shape 3: array-wrapped with prices
    if (!pts && Array.isArray(data) && data.length && Array.isArray((data as any)[0].prices)) {
      pts = (data as any)[0].prices;
    }
    // Fallbacks
    if (!pts && Array.isArray((json as any).prices)) {
      pts = (json as any).prices;
    }
    if (!pts) pts = [];
    const points = pts.map((it: any) => {
      const price = typeof it?.value === 'string' ? parseFloat(it.value) : Number(it?.value);
      const ts = it?.timestamp || it?.time || it?.ts;
      if (!Number.isFinite(price) || !ts) throw new Error('bad point');
      const iso = typeof ts === 'number' ? new Date(ts * (ts > 2e10 ? 1 : 1000)).toISOString() : new Date(ts).toISOString();
      return { ts: iso, price } as PricePoint;
    });
    return { currency, interval: undefined, points };
  } catch {}
  throw new Error('Unexpected historical prices response format');
}

// chainId → Alchemy network identifier (subset)
function chainIdToNetwork(chainId?: number | string): string | undefined {
  const n = typeof chainId === 'string' ? Number(chainId) : chainId;
  if (!Number.isFinite(n as number)) return undefined;
  switch (Number(n)) {
    case 1:
      return 'eth-mainnet';
    case 10:
      return 'opt-mainnet';
    case 137:
      return 'pol-mainnet';
    case 8453:
      return 'base-mainnet';
    default:
      return undefined;
  }
}

function resolveNetwork(asset: AddressOnChain): string {
  return asset.network || chainIdToNetwork(asset.chainId) || 'eth-mainnet';
}

function normalizeCurrencies(p: { currencies?: Fiat[]; convert?: Fiat }): string[] | undefined {
  if (Array.isArray(p.currencies) && p.currencies.length > 0) return p.currencies as string[];
  if (p.convert) return [String(p.convert)];
  return ['USD'];
}

function toUnix(dt: number | Date | string): number {
  if (typeof dt === 'number') return dt > 1e12 ? Math.floor(dt / 1000) : Math.floor(dt);
  if (dt instanceof Date) return Math.floor(dt.getTime() / 1000);
  const n = Number(dt);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const parsed = Date.parse(dt);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  throw new Error(`Invalid date/time: ${String(dt)}`);
}

function toUnixOpt(dt?: number | Date | string): number | undefined {
  if (dt === undefined) return undefined;
  try {
    return toUnix(dt);
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'accept': 'application/json', 'content-type': 'application/json', ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}
