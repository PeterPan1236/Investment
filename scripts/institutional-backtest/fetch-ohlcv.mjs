// Fetches full OHLCV (needed by public/lib/signal.js: high/low/volume, not just open/close)
// for the same universe already resolved in data/institutional/prices/, caching one file
// per symbol under data/platform-signal/ohlcv/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRICES_DIR = path.join(__dirname, '..', '..', 'data', 'institutional', 'prices');
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same normalization as functions/_utils/market.js normalizeChartResult, reimplemented
// here since that file is an ESM module written for the Cloudflare Workers runtime.
function normalizeChartResult(result) {
  const quote = result.indicators?.quote?.[0] || {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const timestamps = result.timestamp || [];
  return timestamps
    .map((timestamp, index) => ({
      timestamp: timestamp * 1000,
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
      adjClose: adjClose[index] ?? quote.close?.[index],
      volume: quote.volume?.[index],
    }))
    .filter((p) => p.open != null && p.close != null && p.high != null && p.low != null);
}

async function fetchOneSymbol(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?range=3y&interval=1d`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result || !result.timestamp) return null;
      return normalizeChartResult(result);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(500);
    }
  }
  return null;
}

async function main() {
  await fs.mkdir(OHLCV_DIR, { recursive: true });
  const codes = (await fs.readdir(PRICES_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  console.log(`Universe size: ${codes.length}`);

  let fetched = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (const code of codes) {
    const outPath = path.join(OHLCV_DIR, `${code}.json`);
    try {
      await fs.access(outPath);
      skippedExisting++;
      continue;
    } catch {
      // not cached yet
    }

    try {
      const bars = await fetchOneSymbol(code);
      if (bars && bars.length > 0) {
        await fs.writeFile(outPath, JSON.stringify(bars));
        fetched++;
      } else {
        failed++;
        console.error(`NO DATA for ${code}`);
      }
    } catch (err) {
      failed++;
      console.error(`FAILED ${code}: ${err.message}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`Done. fetched=${fetched} skippedExisting=${skippedExisting} failed=${failed}`);
}

main();
