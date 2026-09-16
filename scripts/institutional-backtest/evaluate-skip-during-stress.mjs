// READ-ONLY: instead of stopping-out mid-trade during a stress regime, simply
// don't take new mean-reversion signals while the regime is stressed. Compares
// against the same rolling windows. Nothing deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateTrades, summarize } from './signal-lib.mjs';
import { computeMeanReversionSeries, detectOversoldTransitions } from './mean-reversion-lib.mjs';
import { computeMarketRegime } from './market-regime-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function buildWindows() {
  const windows = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const end = new Date(now); end.setMonth(end.getMonth() - i * 6);
    const start = new Date(end); start.setMonth(start.getMonth() - 6);
    windows.push({ start: isoDate(start), end: isoDate(end) });
  }
  return windows.reverse();
}

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const dailyReturnsByDate = new Map();
  const perSymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 40) continue;
    for (let i = 1; i < bars.length; i++) {
      const prevClose = bars[i - 1].close;
      if (!(prevClose > 0)) continue;
      const ret = (bars[i].close - prevClose) / prevClose;
      if (!dailyReturnsByDate.has(bars[i].date)) dailyReturnsByDate.set(bars[i].date, []);
      dailyReturnsByDate.get(bars[i].date).push(ret);
    }
    const points = computeMeanReversionSeries(bars, TA, { requireBand: false });
    const states = points.map((p) => p.state);
    const signalIndexes = detectOversoldTransitions(states);
    if (signalIndexes.length === 0) continue;
    const series = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
    perSymbol.push({ bars, series, signalIndexes });
  }
  const regimeMap = computeMarketRegime(dailyReturnsByDate, { lookback: 20, stressThreshold: -0.08 });

  const windows = buildWindows();
  console.log('=== 崩跌regime期間乾脆不進場 vs 基準 ===');
  const rows = [];
  for (const w of windows) {
    let baseTrades = [];
    let skipTrades = [];
    for (const { bars, series, signalIndexes } of perSymbol) {
      const inWindow = signalIndexes.filter((i) => bars[i].date >= w.start && bars[i].date < w.end);
      if (inWindow.length === 0) continue;
      baseTrades.push(...simulateTrades(series, inWindow, { holdDays: HOLD_DAYS }));
      const notStress = inWindow.filter((i) => !regimeMap.get(bars[i].date)?.isStress);
      skipTrades.push(...simulateTrades(series, notStress, { holdDays: HOLD_DAYS }));
    }
    const b = summarize(baseTrades);
    const s = summarize(skipTrades);
    rows.push({ window: `${w.start}~${w.end}`, b, s });
    console.log(`${w.start}~${w.end}: baseline n=${b.tradeCount} win=${pct(b.winRate)} avg=${pct(b.avgReturn)} | skip-stress n=${s.tradeCount} win=${pct(s.winRate)} avg=${pct(s.avgReturn)}`);
  }
}

main();
