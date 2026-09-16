// READ-ONLY: DSR/PBO applied to the choice between the two cross-sectional
// long-short factors tried (RSI reversal vs momentum), across the same 6
// rolling windows. Answers: after correcting for "we tried 2 factors and are
// about to report the one that looked better", does momentum's result still
// look like real skill? Nothing deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAndSplit, computeLongShortReturn } from './cross-sectional-lib.mjs';
import { sharpeRatio, skewness, kurtosis, deflatedSharpeRatio } from './dsr-lib.mjs';
import { computePBO } from './pbo-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const MOMENTUM_LOOKBACK = 20;
const DECILE_FRACTION = 0.1;
const MIN_PER_SIDE = 20;
const TRADING_DAYS_PER_YEAR = 252;
const WINDOW_MONTHS = 6;
const WINDOW_COUNT = 6;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }
function isoDate(d) { return d.toISOString().slice(0, 10); }

function buildWindows() {
  const windows = [];
  const now = new Date();
  for (let i = 0; i < WINDOW_COUNT; i++) {
    const end = new Date(now); end.setMonth(end.getMonth() - i * WINDOW_MONTHS);
    const start = new Date(end); start.setMonth(start.getMonth() - WINDOW_MONTHS);
    windows.push({ start: isoDate(start), end: isoDate(end) });
  }
  return windows.reverse();
}

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));

  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 60) continue;
    const closes = bars.map((b) => b.close);
    const rsiSeries = TA.rsi(closes, 14);
    const dateToIndex = new Map(bars.map((b, i) => [b.date, i]));
    bySymbol.push({ bars, rsiSeries, dateToIndex });
  }

  const dateCoverage = new Map();
  for (const { bars } of bySymbol) for (const bar of bars) dateCoverage.set(bar.date, (dateCoverage.get(bar.date) || 0) + 1);
  const majorityThreshold = bySymbol.length * 0.5;
  const calendar = [...dateCoverage.entries()].filter(([, c]) => c >= majorityThreshold).map(([d]) => d).sort();
  const rebalanceDates = [];
  for (let i = 0; i < calendar.length; i += HOLD_DAYS) rebalanceDates.push(calendar[i]);

  // One pass, both factors computed from the same cross-section per period.
  const periods = []; // { date, rsiReturn, momentumReturn }
  for (const rebalanceDate of rebalanceDates) {
    const rsiCrossSection = [];
    const momentumCrossSection = [];
    for (const { bars, rsiSeries, dateToIndex } of bySymbol) {
      const idx = dateToIndex.get(rebalanceDate);
      if (idx == null) continue;
      const entryIndex = idx + 1;
      const exitIndex = entryIndex + HOLD_DAYS - 1;
      if (exitIndex >= bars.length) continue;
      const entryPrice = bars[entryIndex].open;
      const exitPrice = bars[exitIndex].close;
      if (!(entryPrice > 0)) continue;
      const returnPct = (exitPrice - entryPrice) / entryPrice;

      const rsi = rsiSeries[idx];
      if (rsi != null) rsiCrossSection.push({ factor: rsi, returnPct });

      if (idx >= MOMENTUM_LOOKBACK) {
        const pastClose = bars[idx - MOMENTUM_LOOKBACK].close;
        if (pastClose > 0) {
          const momentum = (bars[idx].close - pastClose) / pastClose;
          momentumCrossSection.push({ factor: -momentum, returnPct });
        }
      }
    }

    const rsiSplit = rankAndSplit(rsiCrossSection, { decileFraction: DECILE_FRACTION, minPerSide: MIN_PER_SIDE });
    const momentumSplit = rankAndSplit(momentumCrossSection, { decileFraction: DECILE_FRACTION, minPerSide: MIN_PER_SIDE });
    const rsiResult = computeLongShortReturn(rsiSplit.longGroup, rsiSplit.shortGroup);
    const momentumResult = computeLongShortReturn(momentumSplit.longGroup, momentumSplit.shortGroup);

    if (rsiResult.portfolioReturn != null && momentumResult.portfolioReturn != null) {
      periods.push({ date: rebalanceDate, rsiReturn: rsiResult.portfolioReturn, momentumReturn: momentumResult.portfolioReturn });
    }
  }

  const windows = buildWindows();
  const rsiSharpeByWindow = [];
  const momentumSharpeByWindow = [];

  console.log('=== 兩個因子逐窗口年化Sharpe ===');
  for (const w of windows) {
    const inWindow = periods.filter((p) => p.date >= w.start && p.date < w.end);
    const rsiReturns = inWindow.map((p) => p.rsiReturn);
    const momentumReturns = inWindow.map((p) => p.momentumReturn);
    const rsiSR = sharpeRatio(rsiReturns);
    const momentumSR = sharpeRatio(momentumReturns);
    const rsiAnnualized = rsiSR == null ? 0 : rsiSR * Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS);
    const momentumAnnualized = momentumSR == null ? 0 : momentumSR * Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS);
    rsiSharpeByWindow.push(rsiAnnualized);
    momentumSharpeByWindow.push(momentumAnnualized);
    console.log(`${w.start}~${w.end}: RSI=${rsiAnnualized.toFixed(3)} 動能=${momentumAnnualized.toFixed(3)}`);
  }

  // --- PBO (CSCV) across the 2 factors x 6 windows ---
  const sharpeMatrix = [
    { name: 'RSI反轉多空對沖', scores: rsiSharpeByWindow },
    { name: '動能多空對沖', scores: momentumSharpeByWindow },
  ];
  const { pbo, splits } = computePBO(sharpeMatrix);
  console.log('');
  console.log(`=== PBO (2因子 x 6窗口 CSCV) ===`);
  console.log(`PBO = ${pct(pbo, 1)} (${splits.filter((s) => s.underperformedOOS).length}/${splits.length})`);

  // --- DSR for momentum's full-period result, numTrials = 2 (the two factors actually tried) ---
  const momentumFullReturns = periods.map((p) => p.momentumReturn);
  const observedSharpe = sharpeRatio(momentumFullReturns);
  const skew = skewness(momentumFullReturns);
  const kurt = kurtosis(momentumFullReturns);

  const allWindowSharpes = [...rsiSharpeByWindow, ...momentumSharpeByWindow].map((s) => s / Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS)); // back to per-period scale
  const meanS = allWindowSharpes.reduce((a, b) => a + b, 0) / allWindowSharpes.length;
  const varianceAcrossTrials = allWindowSharpes.reduce((acc, s) => acc + (s - meanS) ** 2, 0) / (allWindowSharpes.length - 1);

  console.log('');
  console.log('=== DSR: 動能全期結果, numTrials=2 (只挑了RSI vs 動能這兩個因子) ===');
  const result = deflatedSharpeRatio({
    observedSharpe,
    numObservations: momentumFullReturns.length,
    skew,
    kurtosis: kurt,
    numTrials: 2,
    sharpeVarianceAcrossTrials: varianceAcrossTrials,
  });
  console.log(`observedSharpe(per-period)=${observedSharpe.toFixed(3)} sr0=${result.sr0.toFixed(3)} z=${result.z.toFixed(2)} DSR=${pct(result.dsr, 1)}`);

  const lines = [];
  lines.push('# Cross-sectional 多空對沖：兩因子(RSI vs 動能)的DSR/PBO檢定（唯讀分析，未部署）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 逐窗口年化Sharpe對照');
  lines.push('');
  lines.push('| 窗口 | RSI反轉 | 動能 |');
  lines.push('| --- | --- | --- |');
  for (let i = 0; i < windows.length; i++) {
    lines.push(`| ${windows[i].start}~${windows[i].end} | ${rsiSharpeByWindow[i].toFixed(3)} | ${momentumSharpeByWindow[i].toFixed(3)} |`);
  }
  lines.push('');
  lines.push('## PBO (CSCV, 2因子 x 6窗口)');
  lines.push('');
  lines.push(`PBO = ${pct(pbo, 1)}（${splits.filter((s) => s.underperformedOOS).length}/${splits.length} 個切分中，樣本內較優的因子在樣本外變成後段班）`);
  lines.push('');
  lines.push('## DSR (動能全期結果, numTrials=2)');
  lines.push('');
  lines.push(`- 動能策略全期 per-period Sharpe = ${observedSharpe.toFixed(3)}，T = ${momentumFullReturns.length} 期，偏態 = ${skew.toFixed(3)}，峰態 = ${kurt.toFixed(3)}`);
  lines.push(`- 零技巧下2次試驗期望最大Sharpe (SR0*) = ${result.sr0.toFixed(3)}`);
  lines.push(`- z = ${result.z.toFixed(2)}, **DSR = ${pct(result.dsr, 1)}**`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'dsr-pbo-longshort-analysis.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
