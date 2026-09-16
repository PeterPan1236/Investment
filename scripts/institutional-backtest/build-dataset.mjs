// Merges cached T86 raw files + cached Yahoo price files into one consolidated
// data/institutional/flows.json: { code: [{date, foreignNet, trustNet, open, close}, ...] }
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '..', '..', 'data', 'institutional', 'raw');
const PRICES_DIR = path.join(__dirname, '..', '..', 'data', 'institutional', 'prices');
const OUT_FILE = path.join(__dirname, '..', '..', 'data', 'institutional', 'flows.json');
const STOCK_CODE_RE = /^\d{4}$/;

// T86 field indices (see fetch-institutional.mjs / README note in QA report):
// 4  = 外陸資買賣超股數(不含外資自營商)  -> foreignNet
// 10 = 投信買賣超股數                    -> trustNet
const FOREIGN_NET_INDEX = 4;
const TRUST_NET_INDEX = 10;

function parseNumber(str) {
  return parseInt(String(str).replace(/,/g, ''), 10) || 0;
}

function toIsoDate(rocDateStr) {
  // raw file name is YYYYMMDD (Gregorian, from our own fetch script), not ROC.
  return `${rocDateStr.slice(0, 4)}-${rocDateStr.slice(4, 6)}-${rocDateStr.slice(6, 8)}`;
}

async function loadInstitutionalByCode() {
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort();
  const byCode = new Map();
  for (const file of files) {
    const dateStr = file.replace('.json', '');
    const isoDate = toIsoDate(dateStr);
    const json = JSON.parse(await fs.readFile(path.join(RAW_DIR, file), 'utf8'));
    for (const row of json.data || []) {
      const code = row[0];
      if (!STOCK_CODE_RE.test(code)) continue;
      const foreignNet = parseNumber(row[FOREIGN_NET_INDEX]);
      const trustNet = parseNumber(row[TRUST_NET_INDEX]);
      if (!byCode.has(code)) byCode.set(code, new Map());
      byCode.get(code).set(isoDate, { foreignNet, trustNet });
    }
  }
  return byCode;
}

async function main() {
  const institutionalByCode = await loadInstitutionalByCode();
  const priceFiles = (await fs.readdir(PRICES_DIR)).filter((f) => f.endsWith('.json'));

  const flows = {};
  let totalSeries = 0;
  let totalDays = 0;

  for (const file of priceFiles) {
    const code = file.replace('.json', '');
    const institutional = institutionalByCode.get(code);
    if (!institutional) continue;

    const priceBars = JSON.parse(await fs.readFile(path.join(PRICES_DIR, file), 'utf8'));
    const merged = [];
    for (const bar of priceBars) {
      const flow = institutional.get(bar.date);
      if (!flow) continue;
      merged.push({ date: bar.date, foreignNet: flow.foreignNet, trustNet: flow.trustNet, open: bar.open, close: bar.close });
    }
    merged.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (merged.length > 0) {
      flows[code] = merged;
      totalSeries++;
      totalDays += merged.length;
    }
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(flows));
  console.log(`Wrote ${OUT_FILE}: ${totalSeries} symbols, ${totalDays} total symbol-days`);
}

main();
