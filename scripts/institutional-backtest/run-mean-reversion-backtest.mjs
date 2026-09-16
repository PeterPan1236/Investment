// READ-ONLY evaluation: mean-reversion alternative (RSI oversold, optionally
// confirmed by a lower Bollinger-style band) vs the platform's trend-following
// MA/ADX BUY signal, on the same 6-month window. Does not modify or deploy
// anything - purely comparative backtesting on already-cached OHLCV data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateTrades, summarize } from './signal-lib.mjs';
import { computeMeanReversionSeries, detectOversoldTransitions } from './mean-reversion-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const MONTHS_BACK = 6;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const variants = [
    { label: 'RSI<30 單獨', requireBand: false, holdDays: 5 },
    { label: 'RSI<30 + 跌破布林下軌', requireBand: true, holdDays: 5 },
    { label: 'RSI<30 單獨, 持有3天', requireBand: false, holdDays: 3 },
    { label: 'RSI<30 + 布林下軌, 持有3天', requireBand: true, holdDays: 3 },
    { label: 'RSI<30 單獨, 持有10天', requireBand: false, holdDays: 10 },
  ];

  console.log(`=== 均值回歸訊號 (RSI oversold), 近${MONTHS_BACK}個月訊號日 (>=${cutoffIso}) ===`);
  console.log('');

  const rows = [];
  for (const variant of variants) {
    let allTrades = [];
    let symbolsWithSignal = 0;
    for (const file of files) {
      const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
      if (bars.length < 40) continue;
      const points = computeMeanReversionSeries(bars, TA, { requireBand: variant.requireBand });
      const states = points.map((p) => p.state);
      const signalIndexes = detectOversoldTransitions(states).filter((i) => bars[i].date >= cutoffIso);
      if (signalIndexes.length === 0) continue;
      symbolsWithSignal++;
      const series = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
      const trades = simulateTrades(series, signalIndexes, { holdDays: variant.holdDays });
      allTrades.push(...trades);
    }
    const stats = summarize(allTrades);
    rows.push({ variant: variant.label, symbolsWithSignal, ...stats });
    console.log(`${variant.label}: symbols=${symbolsWithSignal} n=${stats.tradeCount} winRate=${pct(stats.winRate)} avg=${pct(stats.avgReturn)} median=${pct(stats.medianReturn)}`);
  }

  const lines = [];
  lines.push('# 均值回歸訊號（RSI超賣）vs 趨勢跟隨訊號（MA/ADX）比較（唯讀評估，未部署任何策略）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push(`訊號日範圍: ${cutoffIso} 至今`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push('- 訊號來源：`public/lib/indicators.js` 的真實 `TA.rsi`（透過 `signal-engine-loader.mjs` 載入，非重寫），RSI(14) < 30 視為超賣。');
  lines.push('- 可選加嚴條件：收盤價同時跌破 20 日布林下軌（均值 - 2 倍標準差）才算訊號，用於過濾單純RSI假訊號。');
  lines.push('- 訊號事件：狀態「首次轉為超賣」的那一天，隔一個交易日開盤進場，固定持有天數後收盤出場（同一套 `simulateTrades`/`summarize`，與先前 MA/ADX 回測相同的進出場與勝率/報酬率定義，可直接互相比較）。');
  lines.push('- 股票範圍與資料期間：與先前所有回測相同的 1097 檔 TWSE 上市股票 OHLCV 快取。');
  lines.push('');
  lines.push('## 結果（對照組：MA/ADX BUY 訊號 5天持有 baseline 為 勝率41.18% / 平均-0.19%）');
  lines.push('');
  lines.push('| 變體 | 有訊號股票數 | 交易數 | 勝率 | 平均報酬率 | 中位數報酬率 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.variant} | ${r.symbolsWithSignal} | ${r.tradeCount} | ${pct(r.winRate)} | ${pct(r.avgReturn)} | ${pct(r.medianReturn)} |`);
  }
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'mean-reversion-vs-trend-following.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
