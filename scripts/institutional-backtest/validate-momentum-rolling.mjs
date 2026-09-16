// READ-ONLY: rolling 6-month window validation for the momentum long-short
// portfolio, same discipline applied earlier to the RSI long-only signal.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAndSplit, computeLongShortReturn } from './cross-sectional-lib.mjs';
import { sharpeRatio } from './dsr-lib.mjs';

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
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 60) continue;
    const dateToIndex = new Map(bars.map((b, i) => [b.date, i]));
    bySymbol.push({ bars, dateToIndex });
  }

  const dateCoverage = new Map();
  for (const { bars } of bySymbol) for (const bar of bars) dateCoverage.set(bar.date, (dateCoverage.get(bar.date) || 0) + 1);
  const majorityThreshold = bySymbol.length * 0.5;
  const calendar = [...dateCoverage.entries()].filter(([, c]) => c >= majorityThreshold).map(([d]) => d).sort();
  const rebalanceDates = [];
  for (let i = 0; i < calendar.length; i += HOLD_DAYS) rebalanceDates.push(calendar[i]);

  // Precompute every period's portfolio return once, tagged by date.
  const allPeriods = [];
  for (const rebalanceDate of rebalanceDates) {
    const crossSection = [];
    for (const { bars, dateToIndex } of bySymbol) {
      const idx = dateToIndex.get(rebalanceDate);
      if (idx == null || idx < MOMENTUM_LOOKBACK) continue;
      const pastClose = bars[idx - MOMENTUM_LOOKBACK].close;
      const currentClose = bars[idx].close;
      if (!(pastClose > 0)) continue;
      const momentum = (currentClose - pastClose) / pastClose;
      const entryIndex = idx + 1;
      const exitIndex = entryIndex + HOLD_DAYS - 1;
      if (exitIndex >= bars.length) continue;
      const entryPrice = bars[entryIndex].open;
      const exitPrice = bars[exitIndex].close;
      if (!(entryPrice > 0)) continue;
      const returnPct = (exitPrice - entryPrice) / entryPrice;
      crossSection.push({ factor: -momentum, returnPct });
    }
    const { longGroup, shortGroup } = rankAndSplit(crossSection, { decileFraction: DECILE_FRACTION, minPerSide: MIN_PER_SIDE });
    const result = computeLongShortReturn(longGroup, shortGroup);
    if (result.portfolioReturn != null) allPeriods.push({ date: rebalanceDate, portfolioReturn: result.portfolioReturn });
  }

  const windows = buildWindows();
  console.log('=== 動能長短對沖, 滾動6個月窗口驗證 ===');
  const rows = [];
  for (const w of windows) {
    const inWindow = allPeriods.filter((p) => p.date >= w.start && p.date < w.end).map((p) => p.portfolioReturn);
    if (inWindow.length === 0) { console.log(`${w.start}~${w.end}: no periods`); continue; }
    const winRate = inWindow.filter((r) => r > 0).length / inWindow.length;
    const avgReturn = inWindow.reduce((a, b) => a + b, 0) / inWindow.length;
    const sr = sharpeRatio(inWindow);
    const annualizedSharpe = sr == null ? null : sr * Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS);
    rows.push({ window: `${w.start}~${w.end}`, n: inWindow.length, winRate, avgReturn, annualizedSharpe });
    console.log(`${w.start}~${w.end}: n=${inWindow.length} winRate=${pct(winRate)} avg=${pct(avgReturn)} annualizedSharpe=${annualizedSharpe?.toFixed(3)}`);
  }

  const sharpes = rows.map((r) => r.annualizedSharpe).filter((s) => s != null);
  const positiveWindows = sharpes.filter((s) => s > 0).length;
  console.log('');
  console.log(`windows with positive annualized Sharpe: ${positiveWindows}/${sharpes.length}`);
  console.log(`Sharpe range: ${Math.min(...sharpes).toFixed(3)} ~ ${Math.max(...sharpes).toFixed(3)}, mean: ${(sharpes.reduce((a,b)=>a+b,0)/sharpes.length).toFixed(3)}`);

  const lines = [];
  lines.push('# 動能長短對沖：滾動6個月窗口樣本外驗證（唯讀，未部署）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| 窗口 | 期數 | 勝率 | 平均每期報酬 | 年化Sharpe |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) lines.push(`| ${r.window} | ${r.n} | ${pct(r.winRate)} | ${pct(r.avgReturn)} | ${r.annualizedSharpe?.toFixed(3)} |`);
  lines.push('');
  lines.push(`正Sharpe窗口數：${positiveWindows}/${sharpes.length}`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'momentum-rolling-validation.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
