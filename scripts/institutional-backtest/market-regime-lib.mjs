// Pure function: turns per-date cross-sectional returns (across the whole stock
// universe) into a synthetic equal-weighted market index and flags "stress" days
// (trailing return over `lookback` trading days at or below `stressThreshold`).
// We don't have a TAIEX feed cached, so the index is built from the same OHLCV
// data already fetched for every other backtest in this folder.

export function computeMarketRegime(dailyReturnsByDate, { lookback = 20, stressThreshold = -0.08 } = {}) {
  const dates = [...dailyReturnsByDate.keys()].sort();
  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  let indexLevel = 100;
  const levels = [];
  for (const date of dates) {
    const returns = dailyReturnsByDate.get(date);
    const dayReturn = returns.length > 0 ? median(returns) : 0;
    indexLevel *= 1 + dayReturn;
    levels.push({ date, dayReturn, indexLevel });
  }

  const regime = new Map();
  for (let i = 0; i < levels.length; i++) {
    const trailingReturn = i >= lookback ? (levels[i].indexLevel - levels[i - lookback].indexLevel) / levels[i - lookback].indexLevel : null;
    const isStress = trailingReturn != null && trailingReturn <= stressThreshold;
    regime.set(levels[i].date, { indexLevel: levels[i].indexLevel, trailingReturn, isStress });
  }
  return regime;
}

function sampleStdev(values) {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// VIX-style alternative: instead of "did the index already fall X%", flag days
// where realized volatility of the synthetic index itself is unusually high
// relative to its own trailing 1-year distribution (a percentile, not a level,
// so it adapts to regime-dependent baseline vol rather than using one fixed cut).
export function computeVolatilityRegime(dailyReturnsByDate, { volWindow = 20, percentileLookback = 252, stressPercentile = 0.85 } = {}) {
  const dates = [...dailyReturnsByDate.keys()].sort();
  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const dayReturns = dates.map((date) => {
    const returns = dailyReturnsByDate.get(date);
    return returns.length > 0 ? median(returns) : 0;
  });

  const vol = dates.map((_, i) => (i >= volWindow - 1 ? sampleStdev(dayReturns.slice(i - volWindow + 1, i + 1)) : null));

  const regime = new Map();
  for (let i = 0; i < dates.length; i++) {
    let percentile = null;
    if (vol[i] != null) {
      const historyStart = Math.max(0, i - percentileLookback);
      const history = vol.slice(historyStart, i).filter((v) => v != null);
      if (history.length >= 20) {
        const below = history.filter((v) => v < vol[i]).length;
        percentile = below / history.length;
      }
    }
    const isStress = percentile != null && percentile >= stressPercentile;
    regime.set(dates[i], { volatility: vol[i], percentile, isStress });
  }
  return regime;
}
