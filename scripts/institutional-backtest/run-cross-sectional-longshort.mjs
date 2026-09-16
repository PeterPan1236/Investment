// READ-ONLY backtest: cross-sectional long-short, dollar-neutral portfolio.
// Every `holdDays` trading days, rank the whole universe by RSI(14) (same
// factor as the earlier long-only mean-reversion signal), go long the bottom
// decile (most oversold) and short the top decile (most overbought), equal
// weight each side. Because both sides are taken every period, broad market
// moves cancel out — this directly tests whether the earlier long-only edge
// was real stock-picking skill or just long exposure riding the market.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAndSplit, computeLongShortReturn } from './cross-sectional-lib.mjs';
import { sharpeRatio, skewness, kurtosis } from './dsr-lib.mjs';
import { loadTA } from './signal-engine-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const DECILE_FRACTION = 0.1;
const MIN_PER_SIDE = 20;
const TRADING_DAYS_PER_YEAR = 252;

function pct(x, d = 2) { return x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`; }

function maxDrawdown(equityCurve) {
  let peak = -Infinity;
  let worst = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

async function main() {
  const TA = loadTA();
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));

  // Load every symbol's bars + RSI series, and index bars by date for fast lookup.
  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 60) continue;
    const closes = bars.map((b) => b.close);
    const rsiSeries = TA.rsi(closes, 14);
    const dateToIndex = new Map(bars.map((b, i) => [b.date, i]));
    bySymbol.push({ code: file.replace('.json', ''), bars, rsiSeries, dateToIndex });
  }

  // Master rebalance calendar: dates present in at least half the universe,
  // sampled every HOLD_DAYS trading days so periods don't overlap.
  const dateCoverage = new Map();
  for (const { bars } of bySymbol) {
    for (const bar of bars) dateCoverage.set(bar.date, (dateCoverage.get(bar.date) || 0) + 1);
  }
  const majorityThreshold = bySymbol.length * 0.5;
  const calendar = [...dateCoverage.entries()]
    .filter(([, count]) => count >= majorityThreshold)
    .map(([date]) => date)
    .sort();

  const rebalanceDates = [];
  for (let i = 0; i < calendar.length; i += HOLD_DAYS) rebalanceDates.push(calendar[i]);

  console.log(`universe: ${bySymbol.length} symbols, calendar: ${calendar.length} trading days, ${rebalanceDates.length} rebalance periods (every ${HOLD_DAYS} trading days)`);
  console.log('');

  const periodReturns = [];
  const periodDetails = [];

  for (const rebalanceDate of rebalanceDates) {
    const crossSection = [];
    for (const { code, bars, rsiSeries, dateToIndex } of bySymbol) {
      const idx = dateToIndex.get(rebalanceDate);
      if (idx == null) continue;
      const rsi = rsiSeries[idx];
      if (rsi == null) continue;
      const entryIndex = idx + 1;
      const exitIndex = entryIndex + HOLD_DAYS - 1;
      if (exitIndex >= bars.length) continue;
      const entryPrice = bars[entryIndex].open;
      const exitPrice = bars[exitIndex].close;
      if (!(entryPrice > 0)) continue;
      const returnPct = (exitPrice - entryPrice) / entryPrice;
      crossSection.push({ code, factor: rsi, returnPct });
    }

    const { longGroup, shortGroup } = rankAndSplit(crossSection, { decileFraction: DECILE_FRACTION, minPerSide: MIN_PER_SIDE });
    const result = computeLongShortReturn(longGroup, shortGroup);
    if (result.portfolioReturn == null) continue;

    periodReturns.push(result.portfolioReturn);
    periodDetails.push({ date: rebalanceDate, ...result });
  }

  const winCount = periodReturns.filter((r) => r > 0).length;
  const winRate = winCount / periodReturns.length;
  const avgReturn = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
  const sr = sharpeRatio(periodReturns);
  const annualizedSharpe = sr == null ? null : sr * Math.sqrt(TRADING_DAYS_PER_YEAR / HOLD_DAYS);
  const skew = skewness(periodReturns);
  const kurt = kurtosis(periodReturns);

  let equity = 1;
  const equityCurve = [1];
  for (const r of periodReturns) { equity *= 1 + r; equityCurve.push(equity); }
  const totalReturn = equity - 1;
  const years = (periodReturns.length * HOLD_DAYS) / TRADING_DAYS_PER_YEAR;
  const annualizedReturn = years > 0 ? Math.pow(equity, 1 / years) - 1 : null;
  const drawdown = maxDrawdown(equityCurve);

  console.log('=== 全市場 RSI 排序, 多空對沖組合 (Long最低decile / Short最高decile) ===');
  console.log(`periods: ${periodReturns.length}, win rate: ${pct(winRate)}, avg return/period: ${pct(avgReturn)}`);
  console.log(`per-period Sharpe: ${sr?.toFixed(3)}, annualized Sharpe: ${annualizedSharpe?.toFixed(3)}`);
  console.log(`total return over full period: ${pct(totalReturn)}, annualized return: ${pct(annualizedReturn)}`);
  console.log(`max drawdown: ${pct(drawdown)}`);
  console.log(`skewness: ${skew.toFixed(3)}, kurtosis: ${kurt.toFixed(3)}`);

  const lines = [];
  lines.push('# 全市場 Cross-sectional 長短對沖組合：RSI排序、多空各10% (唯讀回測，未部署)');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push(`- 因子：RSI(14)，跟先前「長多單邊」的均值回歸訊號同一個因子，但這次是全市場排序，不是二元觸發。`);
  lines.push(`- 每 ${HOLD_DAYS} 個交易日重新平衡一次（不重疊區間）：對當天有效樣本排序，做多RSI最低的10%（最超賣）、放空RSI最高的10%（最超買），組內等權重。`);
  lines.push(`- 每邊至少 ${MIN_PER_SIDE} 檔才成立該期，避免樣本不足時的極端結果。`);
  lines.push('- 進出場：隔一個交易日開盤進場，持有到期收盤出場，多空同時建倉/平倉，資金完全對沖（多空金額相等）。');
  lines.push('- 這個組合報酬 = 多方平均報酬 - 空方平均報酬，理論上市場系統性漲跌（beta）會互相抵銷，剩下的才是「選股能力」(alpha)，可直接檢驗前面長多單邊策略的報酬有多少其實只是搭了大盤的順風車。');
  lines.push('');
  lines.push('## 結果');
  lines.push('');
  lines.push('| 指標 | 數值 |');
  lines.push('| --- | --- |');
  lines.push(`| 重新平衡期數 | ${periodReturns.length} |`);
  lines.push(`| 勝率（單期為正的比例） | ${pct(winRate)} |`);
  lines.push(`| 平均每期報酬 | ${pct(avgReturn)} |`);
  lines.push(`| 每期 Sharpe | ${sr?.toFixed(3)} |`);
  lines.push(`| 年化 Sharpe | ${annualizedSharpe?.toFixed(3)} |`);
  lines.push(`| 全期總報酬（複利） | ${pct(totalReturn)} |`);
  lines.push(`| 年化報酬 | ${pct(annualizedReturn)} |`);
  lines.push(`| 最大回撤 | ${pct(drawdown)} |`);
  lines.push(`| 偏態 / 峰態 | ${skew.toFixed(3)} / ${kurt.toFixed(3)} |`);
  lines.push('');
  lines.push('## 逐期報酬（前20期與後20期）');
  lines.push('');
  lines.push('| 日期 | 多方報酬 | 空方報酬 | 組合報酬 | 多方檔數 | 空方檔數 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  const sampleDetails = [...periodDetails.slice(0, 20), ...periodDetails.slice(-20)];
  for (const d of sampleDetails) {
    lines.push(`| ${d.date} | ${pct(d.longReturn)} | ${pct(d.shortReturn)} | ${pct(d.portfolioReturn)} | ${d.longCount} | ${d.shortCount} |`);
  }
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'cross-sectional-longshort-backtest.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
