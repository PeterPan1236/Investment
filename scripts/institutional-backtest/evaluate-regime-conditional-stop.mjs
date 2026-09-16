// READ-ONLY evaluation: does a stop-loss that only arms during a market-wide
// stress regime (built from the existing universe's own cross-sectional returns,
// since no TAIEX feed is cached) fix the one bad rolling window (2025-03~2025-09,
// avg -2.40%) found in the mean-reversion validation, without giving back the
// gains from the good windows? Nothing deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './signal-lib.mjs';
import { simulateTradesWithConditionalStop } from './stop-lib.mjs';
import { computeMeanReversionSeries, detectOversoldTransitions } from './mean-reversion-lib.mjs';
import { computeMarketRegime } from './market-regime-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const WINDOW_MONTHS = 6;
const WINDOW_COUNT = 6;
const STRESS_LOOKBACK = 20;
const STRESS_THRESHOLD = -0.08;

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
  return windows.reverse();
}

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));

  // Pass 1: build the market-wide daily-return map (for the regime index) and,
  // in the same pass, cache each symbol's bars + mean-reversion signal indexes.
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
    perSymbol.push({ bars, signalIndexes });
  }

  const regimeMap = computeMarketRegime(dailyReturnsByDate, { lookback: STRESS_LOOKBACK, stressThreshold: STRESS_THRESHOLD });
  const stressDayCount = [...regimeMap.values()].filter((r) => r.isStress).length;
  console.log(`market regime index built: ${regimeMap.size} trading days, ${stressDayCount} flagged as stress (trailing ${STRESS_LOOKBACK}d return <= ${pct(STRESS_THRESHOLD)})`);
  console.log('');

  const windows = buildWindows();
  const stopLossPct = 0.05;

  console.log(`=== RSI<30 均值回歸, 情境式停損 (只在壓力regime啟動, 停損${pct(stopLossPct)}) vs 無停損基準 ===`);
  console.log('');

  const rows = [];
  for (const w of windows) {
    let baselineTrades = [];
    let conditionalTrades = [];
    for (const { bars, signalIndexes } of perSymbol) {
      const inWindow = signalIndexes.filter((i) => bars[i].date >= w.start && bars[i].date < w.end);
      if (inWindow.length === 0) continue;
      baselineTrades.push(...simulateTradesWithConditionalStop(bars, inWindow, regimeMap, { holdDays: HOLD_DAYS, stopLossPct: null }));
      conditionalTrades.push(...simulateTradesWithConditionalStop(bars, inWindow, regimeMap, { holdDays: HOLD_DAYS, stopLossPct }));
    }
    const baseStats = summarize(baselineTrades);
    const condStats = summarize(conditionalTrades);
    const stoppedCount = conditionalTrades.filter((t) => t.exitReason === 'stopLoss').length;
    rows.push({ window: `${w.start} ~ ${w.end}`, baseStats, condStats, stoppedCount });
    console.log(
      `${w.start} ~ ${w.end}: baseline n=${baseStats.tradeCount} winRate=${pct(baseStats.winRate)} avg=${pct(baseStats.avgReturn)} | ` +
      `regime-stop n=${condStats.tradeCount} winRate=${pct(condStats.winRate)} avg=${pct(condStats.avgReturn)} (${stoppedCount}筆觸發停損)`,
    );
  }

  const lines = [];
  lines.push('# 情境式停損（僅壓力regime啟動）評估：均值回歸訊號（唯讀評估，未部署任何策略）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push('- 市場regime指標：因為沒有快取TAIEX大盤資料，改用現有1097檔股票universe自建的等權重合成指數——每個交易日取全市場個股報酬的中位數(避免單一個股極端值主導)，逐日複利成一條合成指數。');
  lines.push(`- 壓力regime定義：合成指數trailing ${STRESS_LOOKBACK}個交易日報酬 <= ${pct(STRESS_THRESHOLD)}，該日視為「系統性下跌」。`);
  lines.push(`- 情境式停損：進場當天若正處於壓力regime才啟動${pct(stopLossPct)}停損；非壓力期間完全不設停損，跟先前validation的無停損基準相同。`);
  lines.push('- 訊號、進出場規則不變：RSI(14)<30首次觸發、隔日開盤進場、持有5個交易日。');
  lines.push('');
  lines.push(`## 全歷史規模：${regimeMap.size}個交易日中有${stressDayCount}天被標記為壓力regime`);
  lines.push('');
  lines.push('## 各窗口對照');
  lines.push('');
  lines.push('| 窗口 | 基準交易數 | 基準勝率 | 基準平均報酬 | 情境停損交易數 | 情境停損勝率 | 情境停損平均報酬 | 觸發停損筆數 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(
      `| ${r.window} | ${r.baseStats.tradeCount} | ${pct(r.baseStats.winRate)} | ${pct(r.baseStats.avgReturn)} | ` +
      `${r.condStats.tradeCount} | ${pct(r.condStats.winRate)} | ${pct(r.condStats.avgReturn)} | ${r.stoppedCount} |`,
    );
  }
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'regime-conditional-stop-evaluation.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
