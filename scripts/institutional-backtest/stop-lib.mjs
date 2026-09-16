// Pure functions: fixed-holding-period trade simulation with an intraday
// stop-loss / take-profit overlay. series items need {date, open, high, low, close}.

export function simulateTradesWithStops(series, signalIndexes, { holdDays = 5, stopLossPct = null, takeProfitPct = null } = {}) {
  const trades = [];
  let busyUntil = -1;
  for (const t of signalIndexes) {
    if (t <= busyUntil) continue;
    const entryIndex = t + 1;
    const lastPossibleExit = entryIndex + holdDays - 1;
    if (lastPossibleExit >= series.length) continue;
    const entryPrice = series[entryIndex].open;
    if (!(entryPrice > 0)) continue;

    const stopPrice = stopLossPct != null ? entryPrice * (1 - stopLossPct) : null;
    const targetPrice = takeProfitPct != null ? entryPrice * (1 + takeProfitPct) : null;

    let exitIndex = lastPossibleExit;
    let exitPrice = series[lastPossibleExit].close;
    let exitReason = 'holdDaysElapsed';

    // Walk day by day within the hold window; a day that breaches both stop and
    // target is treated conservatively as the stop firing first (intraday order
    // of high/low touches is unknown from daily bars).
    for (let i = entryIndex; i <= lastPossibleExit; i++) {
      const bar = series[i];
      const hitStop = stopPrice != null && bar.low <= stopPrice;
      const hitTarget = targetPrice != null && bar.high >= targetPrice;
      if (hitStop) {
        exitIndex = i;
        exitPrice = stopPrice;
        exitReason = 'stopLoss';
        break;
      }
      if (hitTarget) {
        exitIndex = i;
        exitPrice = targetPrice;
        exitReason = 'takeProfit';
        break;
      }
    }

    const returnPct = (exitPrice - entryPrice) / entryPrice;
    trades.push({
      signalDate: series[t].date,
      entryDate: series[entryIndex].date,
      exitDate: series[exitIndex].date,
      entryPrice,
      exitPrice,
      returnPct,
      exitReason,
    });
    busyUntil = exitIndex;
  }
  return trades;
}

// Same as simulateTradesWithStops, but the stop-loss only arms when the entry
// day falls in a "stress" market regime (regimeMap: date -> {isStress}); in a
// normal regime the trade runs with no stop, exiting at the fixed hold-day close.
export function simulateTradesWithConditionalStop(series, signalIndexes, regimeMap, { holdDays = 5, stopLossPct = null } = {}) {
  const trades = [];
  let busyUntil = -1;
  for (const t of signalIndexes) {
    if (t <= busyUntil) continue;
    const entryIndex = t + 1;
    const lastPossibleExit = entryIndex + holdDays - 1;
    if (lastPossibleExit >= series.length) continue;
    const entryPrice = series[entryIndex].open;
    if (!(entryPrice > 0)) continue;

    const entryRegime = regimeMap.get(series[entryIndex].date);
    const stopActive = Boolean(entryRegime?.isStress) && stopLossPct != null;
    const stopPrice = stopActive ? entryPrice * (1 - stopLossPct) : null;

    let exitIndex = lastPossibleExit;
    let exitPrice = series[lastPossibleExit].close;
    let exitReason = 'holdDaysElapsed';

    if (stopPrice != null) {
      for (let i = entryIndex; i <= lastPossibleExit; i++) {
        if (series[i].low <= stopPrice) {
          exitIndex = i;
          exitPrice = stopPrice;
          exitReason = 'stopLoss';
          break;
        }
      }
    }

    const returnPct = (exitPrice - entryPrice) / entryPrice;
    trades.push({
      signalDate: series[t].date,
      entryDate: series[entryIndex].date,
      exitDate: series[exitIndex].date,
      entryPrice,
      exitPrice,
      returnPct,
      exitReason,
      regimeActive: stopActive,
    });
    busyUntil = exitIndex;
  }
  return trades;
}
