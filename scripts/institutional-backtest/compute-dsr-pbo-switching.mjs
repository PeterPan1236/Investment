// READ-ONLY: DSR/PBO for the 3-way choice now on the table (RSI long-short,
// momentum long-short, factor-switching), across the same 6 rolling windows.
// Nothing deployed.
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

  const periods = [];
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
        if (pastClose > 0) momentumCrossSection.push({ factor: -((bars[idx].close - pastClose) / pastClose), returnPct });
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

  const switchReturn = new Array(periods.length).fill(null);
  for (let i = 1; i < periods.length; i++) {
    const prevRsiWon = periods[i - 1].rsiReturn >= periods[i - 1].momentumReturn;
    switchReturn[i] = prevRsiWon ? periods[i].rsiReturn : periods[i].momentumReturn;
  }

  const windows = buildWindows();
  const rsiSharpeByWindow = [];
  const momentumSharpeByWindow = [];
  const switchSharpeByWindow = [];

  console.log('=== 三策略逐窗口年化Sharpe ===');
  for (const w of windows) {
    const idxs = periods.map((p, i) => i).filter((i) => periods[i].date >= w.start && periods[i].date < w.end);
    const rsiReturns = idxs.map((i) => periods[i].rsiReturn);
    const momentumReturns = idxs.map((i) => periods[i].momentumReturn);
    const switchReturns = idxs.filter((i) => switchReturn[i] != null).map((i) => switchReturn[i]);

    const ann = (returns) => {
      const sr = sharpeRatio(returns);
      return sr == null ? 0 : sr * Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS);
    };
    const rsiA = ann(rsiReturns), momA = ann(momentumReturns), swA = ann(switchReturns);
    rsiSharpeByWindow.push(rsiA); momentumSharpeByWindow.push(momA); switchSharpeByWindow.push(swA);
    console.log(`${w.start}~${w.end}: RSI=${rsiA.toFixed(3)} 動能=${momA.toFixed(3)} 切換=${swA.toFixed(3)}`);
  }

  const sharpeMatrix = [
    { name: 'RSI反轉多空對沖', scores: rsiSharpeByWindow },
    { name: '動能多空對沖', scores: momentumSharpeByWindow },
    { name: '因子切換', scores: switchSharpeByWindow },
  ];
  const { pbo, splits } = computePBO(sharpeMatrix);
  const winCounts = {};
  for (const s of splits) winCounts[s.selectedStrategy] = (winCounts[s.selectedStrategy] || 0) + 1;

  console.log('');
  console.log(`=== PBO (3策略 x 6窗口 CSCV) ===`);
  console.log(`PBO = ${pct(pbo, 1)} (${splits.filter((s) => s.underperformedOOS).length}/${splits.length})`);
  console.log('IS-winner分布:', JSON.stringify(winCounts));

  const switchFullReturns = switchReturn.filter((r) => r != null);
  const observedSharpe = sharpeRatio(switchFullReturns);
  const skew = skewness(switchFullReturns);
  const kurt = kurtosis(switchFullReturns);
  const allWindowSharpesPerPeriod = [...rsiSharpeByWindow, ...momentumSharpeByWindow, ...switchSharpeByWindow].map((s) => s / Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS));
  const meanS = allWindowSharpesPerPeriod.reduce((a, b) => a + b, 0) / allWindowSharpesPerPeriod.length;
  const varianceAcrossTrials = allWindowSharpesPerPeriod.reduce((acc, s) => acc + (s - meanS) ** 2, 0) / (allWindowSharpesPerPeriod.length - 1);

  console.log('');
  console.log('=== DSR: 切換策略全期結果, numTrials=3 ===');
  const result = deflatedSharpeRatio({
    observedSharpe, numObservations: switchFullReturns.length, skew, kurtosis: kurt, numTrials: 3, sharpeVarianceAcrossTrials: varianceAcrossTrials,
  });
  console.log(`observedSharpe(per-period)=${observedSharpe.toFixed(3)} sr0=${result.sr0.toFixed(3)} z=${result.z.toFixed(2)} DSR=${pct(result.dsr, 1)}`);

  const lines = [];
  lines.push('# 因子切換策略：三選一(RSI/動能/切換)的DSR/PBO檢定（唯讀分析，未部署）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 逐窗口年化Sharpe對照');
  lines.push('');
  lines.push('| 窗口 | RSI反轉 | 動能 | 因子切換 |');
  lines.push('| --- | --- | --- | --- |');
  for (let i = 0; i < windows.length; i++) {
    lines.push(`| ${windows[i].start}~${windows[i].end} | ${rsiSharpeByWindow[i].toFixed(3)} | ${momentumSharpeByWindow[i].toFixed(3)} | ${switchSharpeByWindow[i].toFixed(3)} |`);
  }
  lines.push('');
  lines.push('## PBO (CSCV, 3策略 x 6窗口)');
  lines.push('');
  lines.push(`PBO = ${pct(pbo, 1)}`);
  lines.push('');
  lines.push('IS-winner分布：');
  lines.push('');
  for (const [name, count] of Object.entries(winCounts)) lines.push(`- ${name}: ${count}`);
  lines.push('');
  lines.push('## DSR (切換策略全期結果, numTrials=3)');
  lines.push('');
  lines.push(`- per-period Sharpe = ${observedSharpe.toFixed(3)}，T = ${switchFullReturns.length}`);
  lines.push(`- 零技巧下3次試驗期望最大Sharpe (SR0*) = ${result.sr0.toFixed(3)}`);
  lines.push(`- z = ${result.z.toFixed(2)}, **DSR = ${pct(result.dsr, 1)}**`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'dsr-pbo-switching-analysis.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
