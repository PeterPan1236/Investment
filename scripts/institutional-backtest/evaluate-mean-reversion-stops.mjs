// READ-ONLY: mean-reversion (RSI<30) signal + stop-loss/take-profit overlay,
// same 6-month window. Purely comparative, nothing deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './signal-lib.mjs';
import { simulateTradesWithStops } from './stop-lib.mjs';
import { computeMeanReversionSeries, detectOversoldTransitions } from './mean-reversion-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const MONTHS_BACK = 6;
const HOLD_DAYS = 5;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 40) continue;
    const points = computeMeanReversionSeries(bars, TA, { requireBand: false });
    const states = points.map((p) => p.state);
    const signalIndexes = detectOversoldTransitions(states).filter((i) => bars[i].date >= cutoffIso);
    if (signalIndexes.length === 0) continue;
    bySymbol.push({ bars, signalIndexes });
  }

  const scenarios = [
    { label: '無停損停利 (baseline)', stopLossPct: null, takeProfitPct: null },
    { label: '停損3% / 停利5%', stopLossPct: 0.03, takeProfitPct: 0.05 },
    { label: '停損5% / 停利8%', stopLossPct: 0.05, takeProfitPct: 0.08 },
    { label: '只停損3%', stopLossPct: 0.03, takeProfitPct: null },
    { label: '只停利5%', stopLossPct: null, takeProfitPct: 0.05 },
  ];

  console.log(`=== 均值回歸(RSI<30) + 停損停利, 近${MONTHS_BACK}個月, 持有${HOLD_DAYS}天 ===`);
  for (const s of scenarios) {
    let allTrades = [];
    for (const { bars, signalIndexes } of bySymbol) {
      allTrades.push(...simulateTradesWithStops(bars, signalIndexes, { holdDays: HOLD_DAYS, stopLossPct: s.stopLossPct, takeProfitPct: s.takeProfitPct }));
    }
    const stats = summarize(allTrades);
    console.log(`${s.label}: n=${stats.tradeCount} winRate=${pct(stats.winRate)} avg=${pct(stats.avgReturn)} median=${pct(stats.medianReturn)}`);
  }
}

main();
