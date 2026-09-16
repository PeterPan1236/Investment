// READ-ONLY analysis. Does not change any strategy logic or place any trades.
// Scopes the platform MA/ADX BUY signal (5-trading-day hold) to the last 6 months
// of signal dates and breaks win rate / return down by the factors available at
// the moment each signal fired (confidence, ADX, volume ratio, volatility rank,
// score, long-term structure, weekday) to see what actually separates winners
// from losers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './signal-lib.mjs';
import { detectBuySignalTransitions } from './platform-signal-lib.mjs';
import { loadSignalEngine } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const STOCKS_FILE = path.join(__dirname, '..', '..', 'data', 'taiwan_stocks.json');
const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'platform-signal-6mo-analysis.md');

const HOLD_DAYS = 5;
const MONTHS_BACK = 6;

function pct(x, digits = 2) {
  return x == null ? 'n/a' : `${(x * 100).toFixed(digits)}%`;
}

function num(x, digits = 1) {
  return x == null ? 'n/a' : x.toFixed(digits);
}

// Trades enriched with the point's own feature snapshot at the signal bar,
// captured at the moment the signal fired (no lookahead).
function simulateTradesWithFeatures(bars, points, signalIndexes, holdDays) {
  const trades = [];
  let busyUntil = -1;
  for (const t of signalIndexes) {
    if (t <= busyUntil) continue;
    const entryIndex = t + 1;
    const exitIndex = entryIndex + holdDays - 1;
    if (exitIndex >= bars.length) continue;
    const entryPrice = bars[entryIndex].open;
    const exitPrice = bars[exitIndex].close;
    if (!(entryPrice > 0)) continue;
    const returnPct = (exitPrice - entryPrice) / entryPrice;
    const p = points[t];
    trades.push({
      signalDate: bars[t].date,
      entryDate: bars[entryIndex].date,
      exitDate: bars[exitIndex].date,
      returnPct,
      win: returnPct > 0,
      confidence: p.confidence,
      score: p.score,
      adx: p.adx,
      volumeRatio: p.volumeRatio,
      atrPercent: p.atrPercent,
      volatilityRank: p.volatilityRank,
      closeVsMaSlow: p.maSlow ? (p.close - p.maSlow) / p.maSlow : null,
      weekday: new Date(bars[entryIndex].timestamp).getUTCDay(),
    });
    busyUntil = exitIndex;
  }
  return trades;
}

function bucketBy(trades, keyFn, bucketLabels) {
  const buckets = new Map(bucketLabels.map((l) => [l, []]));
  for (const trade of trades) {
    const label = keyFn(trade);
    if (label == null || !buckets.has(label)) continue;
    buckets.get(label).push(trade);
  }
  const rows = [];
  for (const label of bucketLabels) {
    const group = buckets.get(label);
    const stats = summarize(group.map((t) => ({ returnPct: t.returnPct })));
    rows.push({ label, ...stats });
  }
  return rows;
}

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

function confidenceBucket(t) {
  if (t.confidence == null) return null;
  if (t.confidence < 40) return '<40';
  if (t.confidence < 70) return '40-69';
  return '70+';
}

function adxBucket(t) {
  if (t.adx == null) return null;
  if (t.adx < 25) return '<25 (弱/剛達門檻)';
  if (t.adx < 35) return '25-34';
  return '35+';
}

function volumeBucket(t) {
  if (t.volumeRatio == null) return null;
  if (t.volumeRatio < 1.0) return '<1.0x (量縮)';
  if (t.volumeRatio < 1.5) return '1.0-1.5x';
  return '1.5x+ (量增確認)';
}

function volatilityBucket(t) {
  if (t.volatilityRank == null) return null;
  if (t.volatilityRank < 0.33) return '低波動 (後1/3)';
  if (t.volatilityRank < 0.66) return '中波動';
  return '高波動 (前1/3)';
}

function scoreBucket(t) {
  if (t.score == null) return null;
  if (t.score <= 3) return '3 (剛過門檻)';
  if (t.score <= 4) return '4';
  return '5+';
}

function structureBucket(t) {
  if (t.closeVsMaSlow == null) return null;
  if (t.closeVsMaSlow < 0.03) return '<3% 剛站上MA120';
  if (t.closeVsMaSlow < 0.10) return '3-10%';
  return '10%+ 遠離MA120';
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayBucket(t) {
  return `週${WEEKDAY_NAMES[t.weekday]}`;
}

function renderBucketTable(lines, title, rows) {
  lines.push(`### ${title}`);
  lines.push('');
  lines.push('| 分組 | 交易數 | 勝率 | 平均報酬率 | 中位數報酬率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) {
    if (r.tradeCount === 0) continue;
    lines.push(`| ${r.label} | ${r.tradeCount} | ${pct(r.winRate)} | ${pct(r.avgReturn)} | ${pct(r.medianReturn)} |`);
  }
  lines.push('');
}

async function main() {
  const SignalEngine = loadSignalEngine();
  const nameMap = await loadNameMap();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const allTrades = [];
  const perSymbol = new Map();

  for (const file of files) {
    const code = file.replace('.json', '');
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    const { points, insufficient } = SignalEngine.computeSignalSeries(bars);
    if (insufficient || !points || points.length === 0) continue;

    const states = points.map((p) => p.state);
    const signalIndexes = detectBuySignalTransitions(states).filter((i) => bars[i].date >= cutoffIso);
    if (signalIndexes.length === 0) continue;

    const trades = simulateTradesWithFeatures(bars, points, signalIndexes, HOLD_DAYS);
    for (const trade of trades) {
      allTrades.push({ code, ...trade });
      if (!perSymbol.has(code)) perSymbol.set(code, []);
      perSymbol.get(code).push(trade);
    }
  }

  const overall = summarize(allTrades.map((t) => ({ returnPct: t.returnPct })));

  console.log(`=== 平台策略訊號, 近${MONTHS_BACK}個月訊號日 (>=${cutoffIso}), 持有${HOLD_DAYS}個交易日 baseline ===`);
  console.log(`total trades: ${overall.tradeCount}`);
  console.log(`win rate: ${pct(overall.winRate)}`);
  console.log(`avg return: ${pct(overall.avgReturn)}`);
  console.log(`median return: ${pct(overall.medianReturn)}`);

  const lines = [];
  lines.push('# 平台策略訊號（MA/ADX BUY）近6個月表現與勝率因子分析（唯讀分析，未變更任何策略邏輯）');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push(`訊號日範圍: ${cutoffIso} 至今`);
  lines.push('');
  lines.push('## 1. 六個月基準表現');
  lines.push('');
  lines.push('| 指標 | 數值 |');
  lines.push('| --- | --- |');
  lines.push(`| 有訊號股票數 | ${perSymbol.size} |`);
  lines.push(`| 總交易筆數 | ${overall.tradeCount} |`);
  lines.push(`| 勝率 | ${pct(overall.winRate)} |`);
  lines.push(`| 平均單筆報酬率 | ${pct(overall.avgReturn)} |`);
  lines.push(`| 中位數單筆報酬率 | ${pct(overall.medianReturn)} |`);
  lines.push('');
  lines.push('注意：本表僅計入訊號日之後仍有足夠交易日可完整跑完 5 天持有的交易，最近約一週內的訊號因資料不足而被排除，屬正常現象。');
  lines.push('');
  lines.push('## 2. 進場當下可觀察因子 vs 勝率/報酬率');
  lines.push('');
  renderBucketTable(lines, '訊號信心分數 (confidence)', bucketBy(allTrades, confidenceBucket, ['<40', '40-69', '70+']));
  renderBucketTable(lines, 'ADX 趨勢強度', bucketBy(allTrades, adxBucket, ['<25 (弱/剛達門檻)', '25-34', '35+']));
  renderBucketTable(lines, '成交量比 (vs 20日均量)', bucketBy(allTrades, volumeBucket, ['<1.0x (量縮)', '1.0-1.5x', '1.5x+ (量增確認)']));
  renderBucketTable(lines, '波動度分位 (ATR% percentile)', bucketBy(allTrades, volatilityBucket, ['低波動 (後1/3)', '中波動', '高波動 (前1/3)']));
  renderBucketTable(lines, '訊號分數 (score)', bucketBy(allTrades, scoreBucket, ['3 (剛過門檻)', '4', '5+']));
  renderBucketTable(lines, '收盤價偏離 MA120 幅度', bucketBy(allTrades, structureBucket, ['<3% 剛站上MA120', '3-10%', '10%+ 遠離MA120']));
  renderBucketTable(lines, '進場星期', bucketBy(allTrades, weekdayBucket, ['週一', '週二', '週三', '週四', '週五']));

  const bySymbol = [...perSymbol.entries()]
    .map(([code, trades]) => ({ code, name: nameMap.get(code) || code, ...summarize(trades.map((t) => ({ returnPct: t.returnPct }))) }))
    .filter((s) => s.tradeCount >= 3)
    .sort((a, b) => b.winRate - a.winRate);

  lines.push('## 3. 個股層級：勝率最高 / 最低（交易數 >= 3 筆）');
  lines.push('');
  lines.push('### 表現最好的 15 檔');
  lines.push('');
  lines.push('| 代號 | 名稱 | 交易數 | 勝率 | 平均報酬率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const s of bySymbol.slice(0, 15)) {
    lines.push(`| ${s.code} | ${s.name} | ${s.tradeCount} | ${pct(s.winRate)} | ${pct(s.avgReturn)} |`);
  }
  lines.push('');
  lines.push('### 表現最差的 15 檔');
  lines.push('');
  lines.push('| 代號 | 名稱 | 交易數 | 勝率 | 平均報酬率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const s of bySymbol.slice(-15).reverse()) {
    lines.push(`| ${s.code} | ${s.name} | ${s.tradeCount} | ${pct(s.winRate)} | ${pct(s.avgReturn)} |`);
  }
  lines.push('');

  // Illustrative only: re-slice the SAME already-computed historical trades by the
  // two strongest factors found above. This is retrospective bucket analysis, not
  // a new strategy being run or deployed — no entry/exit logic has changed.
  const filtered = allTrades.filter((t) => volumeBucket(t) !== '1.5x+ (量增確認)' && adxBucket(t) !== '25-34');
  const filteredStats = summarize(filtered.map((t) => ({ returnPct: t.returnPct })));
  lines.push('## 4. 假設性情境（僅重新切片既有歷史交易，未產生新策略/未執行）');
  lines.push('');
  lines.push('若排除「成交量比 >= 1.5x」與「ADX 落在 25-34 區間」這兩組表現最差的訊號，同一批歷史交易剩餘部分的統計：');
  lines.push('');
  lines.push('| 指標 | 原始基準 | 排除兩個最差因子後 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| 交易數 | ${overall.tradeCount} | ${filteredStats.tradeCount} |`);
  lines.push(`| 勝率 | ${pct(overall.winRate)} | ${pct(filteredStats.winRate)} |`);
  lines.push(`| 平均報酬率 | ${pct(overall.avgReturn)} | ${pct(filteredStats.avgReturn)} |`);
  lines.push(`| 中位數報酬率 | ${pct(overall.medianReturn)} | ${pct(filteredStats.medianReturn)} |`);
  lines.push('');
  lines.push('這只是同一份歷史資料的事後切片（in-sample），不是樣本外驗證，數字會偏樂觀；真正的效果需要用第 5 章節的方法論在獨立資料上驗證。');
  lines.push('');

  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
