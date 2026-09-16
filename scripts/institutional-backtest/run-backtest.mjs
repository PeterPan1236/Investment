// Runs the trust-fund-buy-streak + foreign-net-buy signal across the whole flows.json
// universe, aggregates trades market-wide, and writes a report.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSignals, simulateTrades, summarize } from './signal-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS_FILE = path.join(__dirname, '..', '..', 'data', 'institutional', 'flows.json');
const STOCKS_FILE = path.join(__dirname, '..', '..', 'data', 'taiwan_stocks.json');
const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'institutional-buy-streak-backtest.md');

const STREAK_DAYS = 3;
const HOLD_DAYS = 5;

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
  const flows = JSON.parse(await fs.readFile(FLOWS_FILE, 'utf8'));
  const nameMap = await loadNameMap();

  const allTrades = [];
  const perSymbol = [];

  for (const [code, series] of Object.entries(flows)) {
    const signals = detectSignals(series, { streakDays: STREAK_DAYS });
    const trades = simulateTrades(series, signals, { holdDays: HOLD_DAYS });
    if (trades.length === 0) continue;
    const stats = summarize(trades);
    perSymbol.push({ code, name: nameMap.get(code) || code, ...stats });
    for (const trade of trades) allTrades.push({ code, ...trade });
  }

  const overall = summarize(allTrades);
  perSymbol.sort((a, b) => b.tradeCount - a.tradeCount);

  console.log('=== 投信連買3天以上 + 外資同步買超, 隔日進場持有5個交易日 ===');
  console.log(`symbols with >=1 trade: ${perSymbol.length}`);
  console.log(`total trades: ${overall.tradeCount}`);
  console.log(`win rate: ${pct(overall.winRate)}`);
  console.log(`avg return per trade: ${pct(overall.avgReturn)}`);
  console.log(`median return per trade: ${pct(overall.medianReturn)}`);

  const top20 = perSymbol.slice(0, 20);
  const lines = [];
  lines.push('# 投信連買3天以上 + 外資同步買超：隔日進場、持有5個交易日 回測報告');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論與假設');
  lines.push('');
  lines.push('- 資料源：TWSE 官方 T86 三大法人買賣超日報（近 3 年，逐日快取於 `data/institutional/raw/`）+ Yahoo Finance 日 K（`data/institutional/prices/`）。');
  lines.push('- 股票範圍：3 年內曾出現於 T86 且代號為 4 碼純數字者（一般上市股票，排除 ETF/權證等其他代碼格式）。');
  lines.push('- 「外資」= T86 欄位「外陸資買賣超股數(不含外資自營商)」，不含外資自營商避險/自行買賣部位。');
  lines.push('- 「投信」= T86 欄位「投信買賣超股數」。');
  lines.push(`- 訊號條件：投信買賣超連續 ${STREAK_DAYS} 個交易日皆為正，且第 ${STREAK_DAYS} 天（訊號日）外資買賣超同時為正。`);
  lines.push(`- 進出場：訊號日隔一個交易日以「開盤價」進場，持有 ${HOLD_DAYS} 個交易日後以「收盤價」出場（未計交易成本/滑價）。`);
  lines.push('- 同一檔股票在部位持有期間出現新訊號不重複進場（不加碼）。');
  lines.push('- 進出場價格未做除權息調整；若持有期間剛好跨過分割/減資基準日，該筆交易報酬率可能失真。');
  lines.push('- 全市場常同時有數十檔股票觸發訊號、部位重疊，因此本報告只給「單筆交易」統計（勝率/平均/中位數報酬），不提供假設資金序列復投的「總資金曲線」——那類數字在大量重疊部位下沒有實際意義。');
  lines.push('');
  lines.push('## 全市場總結');
  lines.push('');
  lines.push(`| 指標 | 數值 |`);
  lines.push(`| --- | --- |`);
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
