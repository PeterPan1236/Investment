// READ-ONLY validation: does the RSI<30 mean-reversion signal (5-day hold) hold up
// across independent 6-month windows spanning the full 3-year cache, or was the
// most recent 6-month result (52.79% win rate) a one-off regime? Nothing deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateTrades, summarize } from './signal-lib.mjs';
import { computeMeanReversionSeries, detectOversoldTransitions } from './mean-reversion-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const WINDOW_MONTHS = 6;
const WINDOW_COUNT = 6; // 6 x 6mo = 3 years

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }

function isoDate(d) { return d.toISOString().slice(0, 10); }

function buildWindows() {
  const windows = [];
  const now = new Date();
  for (let i = 0; i < WINDOW_COUNT; i++) {
    const end = new Date(now);
    end.setMonth(end.getMonth() - i * WINDOW_MONTHS);
    const start = new Date(end);
    start.setMonth(start.getMonth() - WINDOW_MONTHS);
    windows.push({ start: isoDate(start), end: isoDate(end) });
  }
  return windows.reverse(); // oldest first
}

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const windows = buildWindows();

  // Precompute signal indexes + series once per symbol; slice per window afterwards.
  const perSymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 40) continue;
    const points = computeMeanReversionSeries(bars, TA, { requireBand: false });
    const states = points.map((p) => p.state);
    const signalIndexes = detectOversoldTransitions(states);
    if (signalIndexes.length === 0) continue;
    const series = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
    perSymbol.push({ bars, series, signalIndexes });
  }

  console.log(`=== RSI<30 均值回歸訊號, 滾動6個月窗口驗證 (持有${HOLD_DAYS}天) ===`);
  console.log('');

  const rows = [];
  for (const w of windows) {
    let allTrades = [];
    for (const { bars, series, signalIndexes } of perSymbol) {
      const inWindow = signalIndexes.filter((i) => bars[i].date >= w.start && bars[i].date < w.end);
      if (inWindow.length === 0) continue;
      allTrades.push(...simulateTrades(series, inWindow, { holdDays: HOLD_DAYS }));
    }
    const stats = summarize(allTrades);
    rows.push({ window: `${w.start} ~ ${w.end}`, ...stats });
    console.log(`${w.start} ~ ${w.end}: n=${stats.tradeCount} winRate=${pct(stats.winRate)} avg=${pct(stats.avgReturn)} median=${pct(stats.medianReturn)}`);
  }

  const validWindows = rows.filter((r) => r.tradeCount > 0);
  const winRates = validWindows.map((r) => r.winRate);
  const avgReturns = validWindows.map((r) => r.avgReturn);
  const summaryLine = (arr) => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { min, max, mean };
  };
  const winRateSpread = summaryLine(winRates);
  const avgReturnSpread = summaryLine(avgReturns);

  console.log('');
  console.log(`win rate across windows: min=${pct(winRateSpread.min)} mean=${pct(winRateSpread.mean)} max=${pct(winRateSpread.max)}`);
  console.log(`avg return across windows: min=${pct(avgReturnSpread.min)} mean=${pct(avgReturnSpread.mean)} max=${pct(avgReturnSpread.max)}`);
  console.log(`windows with positive avg return: ${avgReturns.filter((r) => r > 0).length} / ${avgReturns.length}`);
  console.log(`windows with win rate >= 50%: ${winRates.filter((r) => r >= 0.5).length} / ${winRates.length}`);

  const lines = [];
  lines.push('# RSI<30 均值回歸訊號：滾動6個月窗口樣本外驗證（唯讀，未部署）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push(`持有天數: ${HOLD_DAYS} 個交易日；窗口長度: ${WINDOW_MONTHS} 個月，共 ${WINDOW_COUNT} 個不重疊窗口涵蓋近3年`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push('- 把近3年資料切成6個互不重疊的連續6個月窗口，各窗口獨立計算訊號與交易（不共用訊號，避免同一筆交易被算進兩個窗口）。');
  lines.push('- 最新一個窗口即為前一輪分析的「近6個月」結果（52.79%勝率），可直接對照。');
  lines.push('- 訊號、進出場規則與先前完全相同：RSI(14)<30 首次觸發、隔日開盤進場、持有5個交易日收盤出場。');
  lines.push('');
  lines.push('## 各窗口結果');
  lines.push('');
  lines.push('| 窗口 | 交易數 | 勝率 | 平均報酬率 | 中位數報酬率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.window} | ${r.tradeCount} | ${pct(r.winRate)} | ${pct(r.avgReturn)} | ${pct(r.medianReturn)} |`);
  }
  lines.push('');
  lines.push('## 穩定性總結');
  lines.push('');
  lines.push(`- 勝率範圍：${pct(winRateSpread.min)} ~ ${pct(winRateSpread.max)}，平均 ${pct(winRateSpread.mean)}`);
  lines.push(`- 平均報酬範圍：${pct(avgReturnSpread.min)} ~ ${pct(avgReturnSpread.max)}，平均 ${pct(avgReturnSpread.mean)}`);
  lines.push(`- ${avgReturns.filter((r) => r > 0).length}/${avgReturns.length} 個窗口平均報酬為正`);
  lines.push(`- ${winRates.filter((r) => r >= 0.5).length}/${winRates.length} 個窗口勝率達50%以上`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'mean-reversion-rolling-validation.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
