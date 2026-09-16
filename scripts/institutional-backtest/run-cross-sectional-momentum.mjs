// READ-ONLY backtest: cross-sectional long-short, dollar-neutral portfolio using
// a MOMENTUM factor instead of RSI reversal — go long the strongest trailing-
// 20-day performers, short the weakest, on the hypothesis that TWSE shows
// "strength persists" rather than "oversold reverts" (suggested by the RSI
// long-short backtest coming out negative, implying the opposite sign).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAndSplit, computeLongShortReturn } from './cross-sectional-lib.mjs';
import { sharpeRatio, skewness, kurtosis } from './dsr-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = path.join(__dirname, '..', '..', 'data', 'platform-signal', 'ohlcv');
const HOLD_DAYS = 5;
const MOMENTUM_LOOKBACK = 20;
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
  const files = (await fs.readdir(OHLCV_DIR)).filter((f) => f.endsWith('.json'));

  const bySymbol = [];
  for (const file of files) {
    const bars = JSON.parse(await fs.readFile(path.join(OHLCV_DIR, file), 'utf8'));
    if (bars.length < 60) continue;
    const dateToIndex = new Map(bars.map((b, i) => [b.date, i]));
    bySymbol.push({ code: file.replace('.json', ''), bars, dateToIndex });
  }

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

  console.log(`universe: ${bySymbol.length} symbols, calendar: ${calendar.length} trading days, ${rebalanceDates.length} rebalance periods`);
  console.log('');

  const periodReturns = [];
  const periodDetails = [];

  for (const rebalanceDate of rebalanceDates) {
    const crossSection = [];
    for (const { code, bars, dateToIndex } of bySymbol) {
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

      // Negate momentum so rankAndSplit's "long = low factor" extreme becomes
      // "long = highest momentum" (winners), matching momentum-strategy convention.
      crossSection.push({ code, factor: -momentum, returnPct });
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

  console.log(`=== 全市場 動能排序 (trailing${MOMENTUM_LOOKBACK}日報酬), 多空對沖 (Long最強decile / Short最弱decile) ===`);
  console.log(`periods: ${periodReturns.length}, win rate: ${pct(winRate)}, avg return/period: ${pct(avgReturn)}`);
  console.log(`per-period Sharpe: ${sr?.toFixed(3)}, annualized Sharpe: ${annualizedSharpe?.toFixed(3)}`);
  console.log(`total return: ${pct(totalReturn)}, annualized return: ${pct(annualizedReturn)}`);
  console.log(`max drawdown: ${pct(drawdown)}`);
  console.log(`skewness: ${skew.toFixed(3)}, kurtosis: ${kurt.toFixed(3)}`);

  const lines = [];
  lines.push('# 全市場 Cross-sectional 長短對沖組合：動能因子 (唯讀回測，未部署)');
  lines.push('');
  lines.push(`生成時間: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 方法論');
  lines.push('');
  lines.push(`- 因子：trailing ${MOMENTUM_LOOKBACK} 個交易日報酬（動能），與RSI反轉方向相反——做多過去表現最強的10%，放空最弱的10%。`);
  lines.push(`- 其餘規則與RSI版本完全相同：每 ${HOLD_DAYS} 個交易日重新平衡、隔日開盤進場、持有到期收盤出場、組內等權重、每邊至少 ${MIN_PER_SIDE} 檔、資金完全對沖。`);
  lines.push('- 用同一套 `cross-sectional-lib.mjs`，只換了因子計算方式，可直接跟RSI版本的Sharpe/報酬對照。');
  lines.push('');
  lines.push('## 結果');
  lines.push('');
  lines.push('| 指標 | RSI反轉 (先前結果) | 動能 (本次) |');
  lines.push('| --- | --- | --- |');
  lines.push(`| 勝率 | 45.07% | ${pct(winRate)} |`);
  lines.push(`| 平均每期報酬 | -0.20% | ${pct(avgReturn)} |`);
  lines.push(`| 年化 Sharpe | -0.729 | ${annualizedSharpe?.toFixed(3)} |`);
  lines.push(`| 全期總報酬 | -26.30% | ${pct(totalReturn)} |`);
  lines.push(`| 最大回撤 | -38.74% | ${pct(drawdown)} |`);
  lines.push('');

  const REPORT_FILE = path.join(__dirname, '..', '..', 'reports', 'cross-sectional-momentum-backtest.md');
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, lines.join('\n') + '\n');
  console.log(`\nReport written to ${REPORT_FILE}`);
}

main();
