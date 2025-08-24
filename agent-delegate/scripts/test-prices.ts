import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

import { AlchemyPricesClient, KNOWN_ASSETS } from '../src/tools/prices.js';

async function main() {
  const apiKey = process.env.ALCHEMY_PRICES_API_KEY;
  if (!apiKey) {
    console.log('[prices:test] SKIP: ALCHEMY_PRICES_API_KEY not set');
    process.exit(0);
    return;
  }

  const prices = new AlchemyPricesClient();
  let failures = 0;

  // 1) Spot by symbol (OP)
  try {
    const spot = await prices.getSpotPrice({ symbol: 'OP', currencies: ['USD'] });
    console.log('[prices:test] spot(OP/USD):', spot.price, '@', spot.at);
    if (!(typeof spot.price === 'number' && spot.price > 0)) {
      console.error('[prices:test] FAIL: spot price must be > 0');
      failures++;
    }
  } catch (e) {
    console.error('[prices:test] FAIL: spot by symbol threw', e);
    failures++;
  }

  // 2) Spot by address (OP on Optimism)
  try {
    const spot = await prices.getSpotPrice({ asset: { address: KNOWN_ASSETS.OP_OPTIMISM.address, network: 'opt-mainnet' }, currencies: ['USD'] });
    console.log('[prices:test] spot(OP@0x..0042/USD):', spot.price, '@', spot.at);
    if (!(typeof spot.price === 'number' && spot.price > 0)) {
      console.error('[prices:test] FAIL: spot by address price must be > 0');
      failures++;
    }
  } catch (e) {
    console.error('[prices:test] FAIL: spot by address threw', e);
    failures++;
  }

  // 3) Short historical series (last 3 days, daily)
  try {
    const now = Date.now();
    const start = new Date(now - 3 * 24 * 60 * 60 * 1000);
    const end = new Date(now);
    const series = await prices.getHistoricalSeries({ symbol: 'OP', start, end, interval: '1d', currencies: ['USD'], limit: 5 });
    console.log('[prices:test] hist(OP/USD): points=', series.points.length, 'interval=', series.interval);
    if (!(Array.isArray(series.points) && series.points.length > 0)) {
      console.error('[prices:test] FAIL: historical series must return at least 1 point');
      failures++;
    } else if (!series.points.every((p) => typeof p.price === 'number' && p.price > 0)) {
      console.error('[prices:test] FAIL: historical series contains non-positive price');
      failures++;
    }
  } catch (e) {
    console.error('[prices:test] FAIL: historical series threw', e);
    failures++;
  }

  if (failures > 0) {
    console.error(`[prices:test] FAILED with ${failures} error(s)`);
    process.exit(1);
  } else {
    console.log('[prices:test] OK');
  }
}

main().catch((err) => {
  console.error('[prices:test] UNCAUGHT', err);
  process.exit(1);
});
