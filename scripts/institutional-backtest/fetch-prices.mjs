// Scans cached T86 raw files for every plain 4-digit stock code seen, then pulls
// 3 years of daily OHLC from Yahoo Finance per code, caching one file per symbol.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '..', '..', 'data', 'institutional', 'raw');
const PRICES_DIR = path.join(__dirname, '..', '..', 'data', 'institutional', 'prices');
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 1;
const STOCK_CODE_RE = /^\d{4}$/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectUniverse() {
  const files = await fs.readdir(RAW_DIR);
  const codes = new Set();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(await fs.readFile(path.join(RAW_DIR, file), 'utf8'));
    for (const row of json.data || []) {
      const code = row[0];
      if (STOCK_CODE_RE.test(code)) codes.add(code);
    }
  }
  return [...codes].sort();
}

async function fetchOneSymbol(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?range=3y&interval=1d`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) return null;
      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const bars = [];
      for (let i = 0; i < timestamps.length; i++) {
        const open = quote.open?.[i];
        const close = quote.close?.[i];
        if (open == null || close == null) continue;
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        bars.push({ date, open, close });
      }
      return bars;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(500);
    }
  }
  return null;
}

async function main() {
  await fs.mkdir(PRICES_DIR, { recursive: true });
  const universe = await collectUniverse();
  console.log(`Universe size: ${universe.length} TWSE stock codes`);

  let fetched = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (const code of universe) {
    const outPath = path.join(PRICES_DIR, `${code}.json`);
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
