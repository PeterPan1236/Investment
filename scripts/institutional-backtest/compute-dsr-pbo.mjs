// READ-ONLY: applies Deflated Sharpe Ratio and CSCV/PBO to the strategy variants
// explored in this session, to check whether the best-looking result (RSI mean
// reversion, 2026-03~2026-09 window: 52.79% win rate / +1.82% avg return) still
// looks skillful after correcting for how many things we tried. Nothing deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateTrades, summarize } from './signal-lib.mjs';
import { detectBuySignalTransitions } from './platform-signal-lib.mjs';
import { computeMeanReversionSeries, detectOversoldTransitions } from './mean-reversion-lib.mjs';
import { loadSignalEngine, loadTA } from './signal-engine-loader.mjs';
import { sharpeRatio, skewness, kurtosis, deflatedSharpeRatio } from './dsr-lib.mjs';
import { computePBO } from './pbo-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }
function isoDate(d) { return d.toISOString().slice(0, 10); }

function buildWindows(count = 6, months = 6) {
  const windows = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const end = new Date(now); end.setMonth(end.getMonth() - i * months);
    const start = new Date(end); start.setMonth(start.getMonth() - months);
    windows.push({ start: isoDate(start), end: isoDate(end) });
  }
  return windows.reverse();
}

async function loadAllBars() {
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length >= 40) bySymbol.push(bars);
  }
  return bySymbol;
}

// Recomputes each strategy's trades restricted to a [start, end) window, so we
// can get a genuine per-window return array (not just the aggregated summary
// numbers that were printed earlier in this session).
function maAdxTrades(SignalEngine, bars, window, holdDays = 5) {
  const { points, insufficient } = SignalEngine.computeSignalSeries(bars);
  if (insufficient || !points?.length) return [];
  const states = points.map((p) => p.state);
  const signalIndexes = detectBuySignalTransitions(states).filter((i) => bars[i].date >= window.start && bars[i].date < window.end);
  if (signalIndexes.length === 0) return [];
  const series = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
  return simulateTrades(series, signalIndexes, { holdDays });
}

function rsiTrades(TA, bars, window, holdDays = 5) {
  const points = computeMeanReversionSeries(bars, TA, { requireBand: false });
  const states = points.map((p) => p.state);
  const signalIndexes = detectOversoldTransitions(states).filter((i) => bars[i].date >= window.start && bars[i].date < window.end);
  if (signalIndexes.length === 0) return [];
  const series = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
  return simulateTrades(series, signalIndexes, { holdDays });
}

async function main() {
  const SignalEngine = loadSignalEngine();
  const TA = loadTA();
  const allBars = await loadAllBars();
  const windows = buildWindows();

  console.log('=== 建立各策略在6個滾動窗口的逐窗口報酬序列 (用來估計 trial-to-trial Sharpe變異) ===');
  console.log('');

  // Five reconstructible, meaningfully-different strategy variants, each run
  // across the same 6 windows -> a Sharpe "matrix" for both DSR's null-variance
  // estimate and PBO's CSCV.
  const strategyDefs = [
    { name: 'MA/ADX 翻多, 5天持有', run: (bars, w) => maAdxTrades(SignalEngine, bars, w, 5) },
    { name: 'MA/ADX 翻多, 60天持有', run: (bars, w) => maAdxTrades(SignalEngine, bars, w, 60) },
    { name: 'RSI<30 均值回歸, 5天持有', run: (bars, w) => rsiTrades(TA, bars, w, 5) },
    { name: 'RSI<30 均值回歸, 3天持有', run: (bars, w) => rsiTrades(TA, bars, w, 3) },
    { name: 'RSI<30 均值回歸, 10天持有', run: (bars, w) => rsiTrades(TA, bars, w, 10) },
  ];

  const sharpeMatrix = strategyDefs.map((def) => ({ name: def.name, scores: [] }));
  const windowTradeCounts = strategyDefs.map(() => []);

  for (const window of windows) {
    for (let s = 0; s < strategyDefs.length; s++) {
      let trades = [];
      for (const bars of allBars) trades.push(...strategyDefs[s].run(bars, window));
      const returns = trades.map((t) => t.returnPct);
      const sr = sharpeRatio(returns) ?? 0;
      sharpeMatrix[s].scores.push(sr);
      windowTradeCounts[s].push(trades.length);
    }
    console.log(`${window.start}~${window.end}: ` + strategyDefs.map((d, i) => `${d.name}=${sharpeMatrix[i].scores.at(-1).toFixed(3)}`).join(' | '));
  }

  console.log('');
  console.log('=== Deflated Sharpe Ratio: 「最佳」結果 (RSI均值回歸 2026-03~2026-09, 5天持有) ===');

  const bestWindow = windows.at(-1);
  let bestTrades = [];
  for (const bars of allBars) bestTrades.push(...rsiTrades(TA, bars, bestWindow, 5));
  const bestReturns = bestTrades.map((t) => t.returnPct);
  const observedSharpe = sharpeRatio(bestReturns);
  const skew = skewness(bestReturns);
  const kurt = kurtosis(bestReturns);

  const allSharpes = sharpeMatrix.flatMap((s) => s.scores);
  const sharpeMean = allSharpes.reduce((a, b) => a + b, 0) / allSharpes.length;
  const sharpeVariance = allSharpes.reduce((acc, s) => acc + (s - sharpeMean) ** 2, 0) / (allSharpes.length - 1);

  // Conservative (small) trial count: only the 5 strategies x 6 windows = 30
  // reconstructible configurations actually re-run here. The real number of
  // "looks" taken at this data across the whole session (institutional-flow
  // signal, ~33 win-rate filter combinations, 12 stop/take-profit grids, 4
  // regime-filter variants, etc.) was closer to 55-60, so treat this DSR as an
  // OPTIMISTIC upper bound, not the true one.
  const numTrialsConservative = sharpeMatrix.length * windows.length; // 30
  const numTrialsRealistic = 58;

  for (const numTrials of [numTrialsConservative, numTrialsRealistic]) {
    const result = deflatedSharpeRatio({
      observedSharpe,
      numObservations: bestReturns.length,
      skew,
      kurtosis: kurt,
      numTrials,
      sharpeVarianceAcrossTrials: sharpeVariance,
    });
    console.log(
      `numTrials=${numTrials}: observedSharpe=${observedSharpe.toFixed(3)} sr0(null max)=${result.sr0.toFixed(3)} ` +
      `z=${result.z.toFixed(2)} DSR=${(result.dsr * 100).toFixed(1)}%`,
    );
  }

  console.log('');
  console.log('=== PBO (CSCV): 5個策略跨6個窗口, 挑IS最佳者在OOS的表現 ===');
  const { pbo, splits } = computePBO(sharpeMatrix);
  console.log(`PBO = ${(pbo * 100).toFixed(1)}% (${splits.filter((s) => s.underperformedOOS).length}/${splits.length} 個切分中, IS最佳策略在OOS淪為後段班)`);
  const winCounts = {};
  for (const s of splits) winCounts[s.selectedStrategy] = (winCounts[s.selectedStrategy] || 0) + 1;
  console.log('IS-winner分布:', JSON.stringify(winCounts));

  const lines = [];
  lines.push('# Deflated Sharpe Ratio / PBO：多重測試修正後,前面的結果還站得住腳嗎？（唯讀分析，未部署任何策略）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push('- **Deflated Sharpe Ratio (DSR)**（Bailey & Lopez de Prado, 2014）：把「試了N次、挑最好看的那次」這件事的選擇偏誤量化,回答「這個Sharpe ratio,扣掉純運氣期望值後,還有多少機率是真的」。');
  lines.push('- **PBO / CSCV**（Bailey, Borwein, Lopez de Prado & Zhu, 2014）：把樣本切成幾段,窮舉所有「一半當樣本內、一半當樣本外」的切法,檢查「樣本內表現最好的策略」在樣本外是否經常變成後段班——這個機率就是PBO,越高代表越可能是overfitting。');
  lines.push('- 這裡選了5個本session實際測過、可以重新產生完整交易報酬序列的代表性策略（MA/ADX 5天/60天持有、RSI均值回歸 3天/5天/10天持有），跨同樣的6個滾動6個月窗口計算Sharpe。');
  lines.push('');
  lines.push('## 各策略逐窗口 Sharpe ratio');
  lines.push('');
  lines.push('| 窗口 | ' + strategyDefs.map((d) => d.name).join(' | ') + ' |');
  lines.push('| --- | ' + strategyDefs.map(() => '---').join(' | ') + ' |');
  for (let w = 0; w < windows.length; w++) {
    lines.push(`| ${windows[w].start}~${windows[w].end} | ` + sharpeMatrix.map((s) => s.scores[w].toFixed(3)).join(' | ') + ' |');
  }
  lines.push('');
  lines.push('## Deflated Sharpe Ratio 結果（選定策略：RSI均值回歸, 2026-03~2026-09, 5天持有）');
  lines.push('');
  lines.push(`- 該窗口交易數 T = ${bestReturns.length}，觀察到的 Sharpe = ${observedSharpe.toFixed(3)}，偏態 = ${skew.toFixed(3)}，峰態 = ${kurt.toFixed(3)}`);
  lines.push(`- 用來估計「零技巧下最高Sharpe期望值」的跨試驗Sharpe變異，來自上表30個(策略x窗口)觀測值：variance = ${sharpeVariance.toFixed(4)}`);
  lines.push('');
  lines.push('| 假設試驗次數 N | 零技巧下期望最大Sharpe (SR0*) | z分數 | DSR (真有技巧的機率) |');
  lines.push('| --- | --- | --- | --- |');
  for (const numTrials of [numTrialsConservative, numTrialsRealistic]) {
    const result = deflatedSharpeRatio({ observedSharpe, numObservations: bestReturns.length, skew, kurtosis: kurt, numTrials, sharpeVarianceAcrossTrials: sharpeVariance });
    lines.push(`| ${numTrials} | ${result.sr0.toFixed(3)} | ${result.z.toFixed(2)} | ${pct(result.dsr, 1)} |`);
  }
  lines.push('');
  lines.push(`保守估計只用N=${numTrialsConservative}（本次腳本實際重跑的5策略x6窗口）；但整個session實際嘗試過的組合數（包含約33種win-rate過濾器疊加、5-12種停損停利網格、4種regime變體等）更接近N=${numTrialsRealistic}，所以N=${numTrialsRealistic}那一列才是比較誠實的估計，N=${numTrialsConservative}那一列是樂觀上界。`);
  lines.push('');
  lines.push('## PBO (CSCV) 結果');
  lines.push('');
  lines.push(`PBO = ${pct(pbo, 1)}（${splits.filter((s) => s.underperformedOOS).length}/${splits.length} 個樣本內外切分中，樣本內表現最好的策略在樣本外淪為後段班）`);
  lines.push('');
  lines.push('IS(樣本內)最佳策略當選次數分布：');
  lines.push('');
  lines.push('| 策略 | 當選為IS最佳的次數 |');
  lines.push('| --- | --- |');
  for (const [name, count] of Object.entries(winCounts)) lines.push(`| ${name} | ${count} |`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'dsr-pbo-analysis.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
