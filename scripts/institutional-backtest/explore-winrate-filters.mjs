// READ-ONLY exploration: how high can win rate go by stacking filters on the
// existing historical trades, and at what sample-size cost? Does not change any
// strategy logic or execute anything.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './signal-lib.mjs';
import { detectBuySignalTransitions } from './platform-signal-lib.mjs';
import { loadSignalEngine } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const MONTHS_BACK = 6;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }

function simulateTradesWithFeatures(bars, points, signalIndexes, holdDays) {
  const trades = [];
  let busyUntil = -1;
  for (const t of signalIndexes) {
    if (t <= busyUntil) continue;
    const entryIndex = t + 1;
    const exitIndex = entryIndex + holdDays - 1;
    if (exitIndex >= bars.length) continue;
    const entryPrice = bars[entryIndex].open;
    const exitPrice = bars[exitIndex].close;
    if (!(entryPrice > 0)) continue;
    const returnPct = (exitPrice - entryPrice) / entryPrice;
    const p = points[t];
    trades.push({
      returnPct,
      confidence: p.confidence,
      score: p.score,
      adx: p.adx,
      volumeRatio: p.volumeRatio,
      volatilityRank: p.volatilityRank,
      closeVsMaSlow: p.maSlow ? (p.close - p.maSlow) / p.maSlow : null,
      weekday: new Date(bars[entryIndex].timestamp).getUTCDay(),
    });
    busyUntil = exitIndex;
  }
  return trades;
}

async function main() {
  const SignalEngine = loadSignalEngine();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const allTrades = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    const { points, insufficient } = SignalEngine.computeSignalSeries(bars);
    if (insufficient || !points || points.length === 0) continue;
    const states = points.map((p) => p.state);
    const signalIndexes = detectBuySignalTransitions(states).filter((i) => bars[i].date >= cutoffIso);
    if (signalIndexes.length === 0) continue;
    allTrades.push(...simulateTradesWithFeatures(bars, points, signalIndexes, HOLD_DAYS));
  }

  const baseline = summarize(allTrades.map((t) => ({ returnPct: t.returnPct })));
  console.log(`baseline: n=${baseline.tradeCount} winRate=${pct(baseline.winRate)} avg=${pct(baseline.avgReturn)}`);
  console.log('');

  const goodWeekdays = new Set([1, 3, 5]); // Mon, Wed, Fri (UTC day-of-week, matches bars.timestamp)

  const stages = [
    { label: '+排除量增>=1.5x', pred: (t) => t.volumeRatio == null || t.volumeRatio < 1.5 },
    { label: '+排除ADX 25-34', pred: (t) => t.adx == null || t.adx < 25 || t.adx >= 35 },
    { label: '+只留週一三五進場', pred: (t) => goodWeekdays.has(t.weekday) },
    { label: '+MA120偏離<10%', pred: (t) => t.closeVsMaSlow == null || t.closeVsMaSlow < 0.10 },
    { label: '+score=4 (排除3與5+)', pred: (t) => t.score === 4 },
  ];

  let pool = allTrades;
  console.log(`stage 0 (baseline): n=${pool.length} winRate=${pct(summarize(pool.map(t=>({returnPct:t.returnPct}))).winRate)}`);
  for (const stage of stages) {
    pool = pool.filter(stage.pred);
    const stats = summarize(pool.map((t) => ({ returnPct: t.returnPct })));
    console.log(`${stage.label}: n=${stats.tradeCount} winRate=${pct(stats.winRate)} avg=${pct(stats.avgReturn)} median=${pct(stats.medianReturn)}`);
  }

  console.log('');
  console.log('--- single best 2-factor AND combos ranked by win rate (n>=30) ---');
  const factors = [
    ['volume<1.5x', (t) => t.volumeRatio == null || t.volumeRatio < 1.5],
    ['volume<1.0x', (t) => t.volumeRatio == null || t.volumeRatio < 1.0],
    ['adx<25', (t) => t.adx == null || t.adx < 25],
    ['adx not 25-34', (t) => t.adx == null || t.adx < 25 || t.adx >= 35],
    ['weekday Mon/Wed/Fri', (t) => goodWeekdays.has(t.weekday)],
    ['maSlowDist<10%', (t) => t.closeVsMaSlow == null || t.closeVsMaSlow < 0.10],
    ['score=4', (t) => t.score === 4],
    ['confidence>=40', (t) => t.confidence >= 40],
  ];
  const results = [];
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const [nameA, predA] = factors[i];
      const [nameB, predB] = factors[j];
      const subset = allTrades.filter((t) => predA(t) && predB(t));
      const stats = summarize(subset.map((t) => ({ returnPct: t.returnPct })));
      if (stats.tradeCount >= 30) {
        results.push({ combo: `${nameA} AND ${nameB}`, ...stats });
      }
    }
  }
  results.sort((a, b) => b.winRate - a.winRate);
  for (const r of results.slice(0, 10)) {
    console.log(`${r.combo}: n=${r.tradeCount} winRate=${pct(r.winRate)} avg=${pct(r.avgReturn)}`);
  }
}

main();
