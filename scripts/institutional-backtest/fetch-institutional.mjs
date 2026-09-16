// Fetches TWSE 三大法人買賣超日報 (T86) for every calendar day over the last N years,
// caching one raw JSON file per date so the run is resumable and idempotent.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '..', '..', 'data', 'institutional', 'raw');
const YEARS_BACK = 3;
const REQUEST_DELAY_MS = 400;
const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

async function fetchOneDate(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateStr}&selectType=ALLBUT0999&response=json`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(500);
    }
  }
  return null;
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });

  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - YEARS_BACK);

  let fetched = 0;
  let skippedExisting = 0;
  let skippedWeekend = 0;
  let noData = 0;
  let failed = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (isWeekend(d)) {
      skippedWeekend++;
      continue;
    }
    const dateStr = formatDate(d);
    const outPath = path.join(RAW_DIR, `${dateStr}.json`);
    try {
      await fs.access(outPath);
      skippedExisting++;
      continue;
    } catch {
      // not cached yet, fetch it
    }

    try {
      const json = await fetchOneDate(dateStr);
      if (!json || json.stat !== 'OK' || !Array.isArray(json.data) || json.data.length === 0) {
        noData++;
      } else {
        await fs.writeFile(outPath, JSON.stringify(json));
        fetched++;
      }
    } catch (err) {
      failed++;
      console.error(`FAILED ${dateStr}: ${err.message}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `Done. fetched=${fetched} skippedExisting=${skippedExisting} skippedWeekend=${skippedWeekend} noData(holiday)=${noData} failed=${failed}`,
  );
}

main();
