// Pure functions: institutional buy-streak signal + fixed-holding-period backtest.
// series: array of { date, foreignNet, trustNet, open, close }, sorted ascending by date.

export function detectSignals(series, { streakDays = 3 } = {}) {
  const signals = [];
  for (let i = streakDays - 1; i < series.length; i++) {
    let streak = true;
    for (let k = 0; k < streakDays; k++) {
      if (series[i - k].trustNet <= 0) {
        streak = false;
        break;
      }
    }
    if (streak && series[i].foreignNet > 0) {
      signals.push(i);
    }
  }
  return signals;
}

export function simulateTrades(series, signalIndexes, { holdDays = 5 } = {}) {
  const trades = [];
  let busyUntil = -1;
  for (const t of signalIndexes) {
    if (t <= busyUntil) continue; // already in a position, skip overlapping signal
    const entryIndex = t + 1;
    const exitIndex = entryIndex + holdDays - 1;
    if (exitIndex >= series.length) continue; // not enough future bars to complete the trade
    const entryPrice = series[entryIndex].open;
    const exitPrice = series[exitIndex].close;
    if (!(entryPrice > 0)) continue;
    const returnPct = (exitPrice - entryPrice) / entryPrice;
    trades.push({
      signalDate: series[t].date,
      entryDate: series[entryIndex].date,
      exitDate: series[exitIndex].date,
      entryPrice,
      exitPrice,
      returnPct,
    });
    busyUntil = exitIndex;
  }
  return trades;
}

export function summarize(trades) {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return { tradeCount: 0, winCount: 0, winRate: null, avgReturn: null, medianReturn: null, cumulativeReturn: null };
  }
  const returns = trades.map((tr) => tr.returnPct);
  const winCount = returns.filter((r) => r > 0).length;
  const avgReturn = returns.reduce((a, b) => a + b, 0) / tradeCount;
  const sorted = [...returns].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianReturn = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const cumulativeReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  return {
    tradeCount,
    winCount,
    winRate: winCount / tradeCount,
    avgReturn,
    medianReturn,
    cumulativeReturn,
  };
}
