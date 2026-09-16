// READ-ONLY evaluation: does adding an intraday stop-loss/take-profit overlay
// to the existing MA/ADX BUY signal change win rate / return, on the same
// 6-month window used in the earlier factor analysis? Does not modify the
// live signal or execute anything.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './signal-lib.mjs';
import { simulateTradesWithStops } from './stop-lib.mjs';
import { detectBuySignalTransitions } from './platform-signal-lib.mjs';
import { loadSignalEngine } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const MONTHS_BACK = 6;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }

async function main() {
  const SignalEngine = loadSignalEngine();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    const { points, insufficient } = SignalEngine.computeSignalSeries(bars);
    if (insufficient || !points || points.length === 0) continue;
    const states = points.map((p) => p.state);
    const signalIndexes = detectBuySignalTransitions(states).filter((i) => bars[i].date >= cutoffIso);
    if (signalIndexes.length === 0) continue;
    bySymbol.push({ bars, signalIndexes });
  }

  const scenarios = [
    { label: '無停損停利 (baseline)', stopLossPct: null, takeProfitPct: null },
    { label: '停損2% / 停利4%', stopLossPct: 0.02, takeProfitPct: 0.04 },
    { label: '停損3% / 停利5%', stopLossPct: 0.03, takeProfitPct: 0.05 },
    { label: '停損3% / 停利8%', stopLossPct: 0.03, takeProfitPct: 0.08 },
    { label: '停損5% / 停利8%', stopLossPct: 0.05, takeProfitPct: 0.08 },
    { label: '只停損3% (無停利)', stopLossPct: 0.03, takeProfitPct: null },
    { label: '只停利5% (無停損)', stopLossPct: null, takeProfitPct: 0.05 },
  ];

  console.log(`=== 停損/停利疊加評估, 近${MONTHS_BACK}個月訊號日 (>=${cutoffIso}), 最長持有${HOLD_DAYS}個交易日 ===`);
  console.log('');

  const rows = [];
  for (const scenario of scenarios) {
    let allTrades = [];
    for (const { bars, signalIndexes } of bySymbol) {
      const trades = simulateTradesWithStops(bars, signalIndexes, {
        holdDays: HOLD_DAYS,
        stopLossPct: scenario.stopLossPct,
        takeProfitPct: scenario.takeProfitPct,
      });
      allTrades.push(...trades);
    }
    const stats = summarize(allTrades);
    const stopCount = allTrades.filter((t) => t.exitReason === 'stopLoss').length;
    const targetCount = allTrades.filter((t) => t.exitReason === 'takeProfit').length;
    rows.push({ scenario: scenario.label, ...stats, stopCount, targetCount });
    console.log(
      `${scenario.label}: n=${stats.tradeCount} winRate=${pct(stats.winRate)} avg=${pct(stats.avgReturn)} median=${pct(stats.medianReturn)} ` +
      `(停損出場${stopCount}筆, 停利出場${targetCount}筆)`,
    );
  }

  const lines = [];
  lines.push('# MA/ADX BUY 訊號 + 停損停利機制評估（唯讀評估，未變更任何實際策略邏輯）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push(`訊號日範圍: ${cutoffIso} 至今，最長持有 ${HOLD_DAYS} 個交易日（提早觸發停損/停利則提早出場）`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push('- 進場條件與訊號來源完全不變（同一套 MA/ADX BUY 翻多訊號、隔日開盤進場）。');
  lines.push('- 每個交易日檢查當天最高/最低價：最低價觸及停損價即以停損價出場；最高價觸及停利價即以停利價出場；兩者同天觸發時保守認定停損先發生（日K無法得知盤中順序）。');
  lines.push('- 若持有期間都沒觸發，維持原本「第5個交易日收盤出場」。');
  lines.push('- 未計入交易成本/滑價；停損停利假設用限價單成交在設定價位，實際滑價會侵蝕停損停利的效果。');
  lines.push('');
  lines.push('## 結果');
  lines.push('');
  lines.push('| 情境 | 交易數 | 勝率 | 平均報酬率 | 中位數報酬率 | 停損出場筆數 | 停利出場筆數 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.scenario} | ${r.tradeCount} | ${pct(r.winRate)} | ${pct(r.avgReturn)} | ${pct(r.medianReturn)} | ${r.stopCount} | ${r.targetCount} |`);
  }
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'stop-loss-take-profit-evaluation.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
