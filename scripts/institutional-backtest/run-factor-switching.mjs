// READ-ONLY: adaptive factor-switching backtest. At each rebalance, use
// whichever of {RSI reversal, momentum} long-short portfolio had the better
// return in the PREVIOUS period (no lookahead — purely realized, known-at-
// decision-time information) as this period's factor. Tests whether the
// striking window-to-window anti-correlation found between the two factors
// can be harvested by switching, rather than committing to either one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAndSplit, computeLongShortReturn } from './cross-sectional-lib.mjs';
import { sharpeRatio } from './dsr-lib.mjs';
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

function maxDrawdown(equityCurve) {
  let peak = -Infinity, worst = 0;
  for (const v of equityCurve) { if (v > peak) peak = v; if (peak > 0) worst = Math.min(worst, v / peak - 1); }
  return worst;
}

function statsFor(returns) {
  const winRate = returns.filter((r) => r > 0).length / returns.length;
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sr = sharpeRatio(returns);
  const annualizedSharpe = sr == null ? null : sr * Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS);
  let equity = 1; const curve = [1];
  for (const r of returns) { equity *= 1 + r; curve.push(equity); }
  return { n: returns.length, winRate, avgReturn, annualizedSharpe, totalReturn: equity - 1, maxDrawdown: maxDrawdown(curve) };
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

  // Switching: period i's factor choice is based on period i-1's REALIZED returns (no lookahead).
  const switchingReturns = [];
  const switchingChoices = [];
  for (let i = 1; i < periods.length; i++) {
    const prevRsiWon = periods[i - 1].rsiReturn >= periods[i - 1].momentumReturn;
    const chosenReturn = prevRsiWon ? periods[i].rsiReturn : periods[i].momentumReturn;
    switchingReturns.push(chosenReturn);
    switchingChoices.push(prevRsiWon ? 'RSI' : 'momentum');
  }

  const rsiReturns = periods.map((p) => p.rsiReturn);
  const momentumReturns = periods.map((p) => p.momentumReturn);

  console.log('=== 全期比較: RSI 單獨 vs 動能 單獨 vs 因子切換 ===');
  const rsiStats = statsFor(rsiReturns);
  const momentumStats = statsFor(momentumReturns);
  const switchStats = statsFor(switchingReturns);
  for (const [label, s] of [['RSI', rsiStats], ['動能', momentumStats], ['切換', switchStats]]) {
    console.log(`${label}: n=${s.n} winRate=${pct(s.winRate)} avg=${pct(s.avgReturn)} annualizedSharpe=${s.annualizedSharpe?.toFixed(3)} totalReturn=${pct(s.totalReturn)} maxDD=${pct(s.maxDrawdown)}`);
  }
  const rsiChosenCount = switchingChoices.filter((c) => c === 'RSI').length;
  console.log(`切換次數: RSI被選 ${rsiChosenCount}/${switchingChoices.length}, 動能被選 ${switchingChoices.length - rsiChosenCount}/${switchingChoices.length}`);

  console.log('');
  console.log('=== 滾動6個月窗口 ===');
  const windows = buildWindows();
  const rows = [];
  for (const w of windows) {
    const idxInWindow = periods.map((p, i) => i).filter((i) => i >= 1 && periods[i].date >= w.start && periods[i].date < w.end);
    if (idxInWindow.length === 0) continue;
    const windowSwitchReturns = idxInWindow.map((i) => switchingReturns[i - 1]);
    const s = statsFor(windowSwitchReturns);
    rows.push({ window: `${w.start}~${w.end}`, ...s });
    console.log(`${w.start}~${w.end}: n=${s.n} winRate=${pct(s.winRate)} avg=${pct(s.avgReturn)} annualizedSharpe=${s.annualizedSharpe?.toFixed(3)}`);
  }

  const lines = [];
  lines.push('# 因子切換（依上一期實現表現選RSI或動能）長短對沖回測（唯讀，未部署）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push('- 切換規則：每期開始前，比較上一期RSI組合與動能組合哪個報酬較高（已實現、無lookahead），這期就用該因子。');
  lines.push('- 其餘規則與先前完全相同：5天持有、每5個交易日重新平衡、多空各10%、資金對沖。');
  lines.push('');
  lines.push('## 全期比較');
  lines.push('');
  lines.push('| 策略 | 期數 | 勝率 | 平均每期報酬 | 年化Sharpe | 全期總報酬 | 最大回撤 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [label, s] of [['RSI單獨', rsiStats], ['動能單獨', momentumStats], ['因子切換', switchStats]]) {
    lines.push(`| ${label} | ${s.n} | ${pct(s.winRate)} | ${pct(s.avgReturn)} | ${s.annualizedSharpe?.toFixed(3)} | ${pct(s.totalReturn)} | ${pct(s.maxDrawdown)} |`);
  }
  lines.push('');
  lines.push(`切換分布：RSI被選 ${rsiChosenCount}/${switchingChoices.length} 次，動能被選 ${switchingChoices.length - rsiChosenCount}/${switchingChoices.length} 次`);
  lines.push('');
  lines.push('## 滾動6個月窗口（切換策略）');
  lines.push('');
  lines.push('| 窗口 | 期數 | 勝率 | 平均每期報酬 | 年化Sharpe |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) lines.push(`| ${r.window} | ${r.n} | ${pct(r.winRate)} | ${pct(r.avgReturn)} | ${r.annualizedSharpe?.toFixed(3)} |`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'factor-switching-backtest.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
