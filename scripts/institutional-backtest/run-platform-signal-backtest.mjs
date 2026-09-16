// Backtests the platform's own MA/ADX SignalEngine BUY signal (public/lib/signal.js)
// as a fixed-holding-period strategy: enter the day after the state first flips to
// BUY, hold exactly HOLD_DAYS trading days, then exit — same convention as the
// institutional buy-streak backtest, so the two are directly comparable.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateTrades, summarize } from './signal-lib.mjs';
import { detectBuySignalTransitions } from './platform-signal-lib.mjs';
import { loadSignalEngine } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const STOCKS_FILE = path.join(__dirname, '..', '..', 'data', 'taiwan_stocks.json');

const HOLD_DAYS = Number(process.argv[2]) || 5;
const REPORT_FILE = path.join(
  __dirname, '..', '..', 'reports',
  HOLD_DAYS === 5 ? 'platform-signal-backtest.md' : `platform-signal-backtest-hold${HOLD_DAYS}.md`,
);

async function loadNameMap() {
  try {
    const list = JSON.parse(await fs.readFile(STOCKS_FILE, 'utf8'));
    const map = new Map();
    for (const item of list) {
      const code = item.symbol?.split('.')[0];
      if (code) map.set(code, item.name || item.english || code);
    }
    return map;
  } catch {
    return new Map();
  }
}

function pct(x, digits = 2) {
  return x == null ? 'n/a' : `${(x * 100).toFixed(digits)}%`;
}

async function main() {
  const SignalEngine = loadSignalEngine();
  const nameMap = await loadNameMap();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));

  const allTrades = [];
  const perSymbol = [];

  for (const file of files) {
    const code = file.replace('.json', '');
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    const { points, insufficient } = SignalEngine.computeSignalSeries(bars);
    if (insufficient || !points || points.length === 0) continue;

    const states = points.map((p) => p.state);
    const signalIndexes = detectBuySignalTransitions(states);
    if (signalIndexes.length === 0) continue;

    // points and bars share the same order/length (computeSignalSeries only maps,
    // never drops, when every bar already has a finite close - true for our cache).
    const series = bars.map((bar) => ({ date: bar.date, open: bar.open, close: bar.close }));
    const trades = simulateTrades(series, signalIndexes, { holdDays: HOLD_DAYS });
    if (trades.length === 0) continue;

    const stats = summarize(trades);
    perSymbol.push({ code, name: nameMap.get(code) || code, ...stats });
    for (const trade of trades) allTrades.push({ code, ...trade });
  }

  const overall = summarize(allTrades);
  perSymbol.sort((a, b) => b.tradeCount - a.tradeCount);

  console.log(`=== 平台策略訊號 (MA/ADX BUY), 隔日進場持有${HOLD_DAYS}個交易日 ===`);
  console.log(`symbols with >=1 trade: ${perSymbol.length}`);
  console.log(`total trades: ${overall.tradeCount}`);
  console.log(`win rate: ${pct(overall.winRate)}`);
  console.log(`avg return per trade: ${pct(overall.avgReturn)}`);
  console.log(`median return per trade: ${pct(overall.medianReturn)}`);

  const top20 = perSymbol.slice(0, 20);
  const lines = [];
  lines.push(`# 平台策略訊號（MA/ADX BUY）：隔日進場、持有${HOLD_DAYS}個交易日 回測報告`);
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論與假設');
  lines.push('');
  lines.push('- 訊號來源：網站既有 `public/lib/signal.js` 的 `SignalEngine`（MA20/60/120 三週期同向 + ADX(14) 趨勢強度門檻 + 成交量確認），與網站 Signals/Backtest 分頁算法完全相同的程式碼，直接以 Node 執行（`node:vm` 載入同一份 `signal.js`/`indicators.js`）。');
  lines.push('- 訊號事件：狀態「首次翻多（HOLD/SELL → BUY）」的那一天視為一次訊號，而非只要維持 BUY 就每天都算一次。');
  lines.push(`- 進出場：訊號日隔一個交易日以「開盤價」進場，持有 ${HOLD_DAYS} 個交易日後以「收盤價」出場（未計交易成本/滑價），與網站內建 Backtest 分頁「訊號翻轉才出場」的作法不同——這裡改成固定天數出場，兩者結果不可直接互相比較。`);
  lines.push('- 同一檔股票在部位持有期間出現新訊號不重複進場（不加碼）。');
  lines.push('- 股票範圍：與前一份法人買賣超回測相同的 1097 檔 TWSE 上市股票（3 年內曾出現於 T86 且代號為 4 碼純數字者）。');
  lines.push('- 進出場價格未做除權息調整。');
  lines.push('- 全市場常同時有數十檔股票觸發訊號、部位重疊，因此只提供「單筆交易」統計，不提供假設資金序列復投的總資金曲線。');
  lines.push('');
  lines.push('## 全市場總結');
  lines.push('');
  lines.push('| 指標 | 數值 |');
  lines.push('| --- | --- |');
  lines.push(`| 有訊號股票數 | ${perSymbol.length} |`);
  lines.push(`| 總交易筆數 | ${overall.tradeCount} |`);
  lines.push(`| 勝率 | ${pct(overall.winRate)} |`);
  lines.push(`| 平均單筆報酬率 | ${pct(overall.avgReturn)} |`);
  lines.push(`| 中位數單筆報酬率 | ${pct(overall.medianReturn)} |`);
  lines.push('');
  lines.push('## 交易次數最多的前 20 檔');
  lines.push('');
  lines.push('| 代號 | 名稱 | 交易數 | 勝率 | 平均報酬率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const s of top20) {
    lines.push(`| ${s.code} | ${s.name} | ${s.tradeCount} | ${pct(s.winRate)} | ${pct(s.avgReturn)} |`);
  }

  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
