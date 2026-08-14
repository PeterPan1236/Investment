/**
 * Shared technical / statistical primitives.
 *
 * Every function here takes plain arrays and returns plain numbers or arrays so
 * the signal engine, the backtester and the portfolio panel all compute from
 * exactly the same definitions.
 */
(function (global) {
  const TRADING_DAYS_PER_YEAR = 252;

  function toNumbers(values) {
    return values.map(Number).filter(Number.isFinite);
  }

  function mean(values) {
    const numbers = toNumbers(values);
    if (!numbers.length) return null;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }

  function stdev(values, { sample = true } = {}) {
    const numbers = toNumbers(values);
    const divisor = sample ? numbers.length - 1 : numbers.length;
    if (divisor <= 0) return null;
    const average = mean(numbers);
    const variance = numbers.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / divisor;
    return Math.sqrt(variance);
  }

  function median(values) {
    const sorted = toNumbers(values).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const midpoint = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  /** Simple moving average aligned to the input series; leading slots are null. */
  function sma(values, period) {
    const result = new Array(values.length).fill(null);
    if (period <= 0) return result;

    let rollingSum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = Number(values[i]);
      if (!Number.isFinite(value)) return result;
      rollingSum += value;
      if (i >= period) rollingSum -= Number(values[i - period]);
      if (i >= period - 1) result[i] = rollingSum / period;
    }
    return result;
  }

  function wilderSmooth(values, period) {
    const result = new Array(values.length).fill(null);
    if (values.length < period || period <= 0) return result;

    let accumulator = 0;
    for (let i = 0; i < period; i += 1) accumulator += values[i];
    result[period - 1] = accumulator / period;

    for (let i = period; i < values.length; i += 1) {
      result[i] = (result[i - 1] * (period - 1) + values[i]) / period;
    }
    return result;
  }

  /** True range series; index 0 is high-low because there is no prior close. */
  function trueRange(bars) {
    return bars.map((bar, index) => {
      const high = Number(bar.high);
      const low = Number(bar.low);
      if (!index) return high - low;
      const previousClose = Number(bars[index - 1].close);
      return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    });
  }

  function atr(bars, period = 14) {
    return wilderSmooth(trueRange(bars), period);
  }

  /**
   * Wilder's ADX. Used only as a trend-strength gate: below ~20 the market is
   * ranging and directional signals are suppressed.
   */
  function adx(bars, period = 14) {
    const length = bars.length;
    const empty = new Array(length).fill(null);
    if (length < period * 2 + 1) return empty;

    const plusDM = new Array(length).fill(0);
    const minusDM = new Array(length).fill(0);
    for (let i = 1; i < length; i += 1) {
      const upMove = Number(bars[i].high) - Number(bars[i - 1].high);
      const downMove = Number(bars[i - 1].low) - Number(bars[i].low);
      plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
      minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    }

    const smoothedTR = wilderSmooth(trueRange(bars), period);
    const smoothedPlus = wilderSmooth(plusDM, period);
    const smoothedMinus = wilderSmooth(minusDM, period);

    const dx = new Array(length).fill(null);
    for (let i = 0; i < length; i += 1) {
      if (!smoothedTR[i]) continue;
      const plusDI = (smoothedPlus[i] / smoothedTR[i]) * 100;
      const minusDI = (smoothedMinus[i] / smoothedTR[i]) * 100;
      const sum = plusDI + minusDI;
      dx[i] = sum ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0;
    }

    const firstIndex = dx.findIndex(value => value != null);
    if (firstIndex === -1) return empty;

    const result = new Array(length).fill(null);
    const seedEnd = firstIndex + period;
    if (seedEnd > length) return empty;

    let seed = 0;
    for (let i = firstIndex; i < seedEnd; i += 1) seed += dx[i] ?? 0;
    result[seedEnd - 1] = seed / period;
    for (let i = seedEnd; i < length; i += 1) {
      result[i] = (result[i - 1] * (period - 1) + (dx[i] ?? 0)) / period;
    }
    return result;
  }

  function rsi(closes, period = 14) {
    const length = closes.length;
    const result = new Array(length).fill(null);
    if (length <= period) return result;

    let averageGain = 0;
    let averageLoss = 0;
    for (let i = 1; i <= period; i += 1) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) averageGain += change;
      else averageLoss -= change;
    }
    averageGain /= period;
    averageLoss /= period;
    result[period] = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));

    for (let i = period + 1; i < length; i += 1) {
      const change = closes[i] - closes[i - 1];
      averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
      result[i] = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
    }
    return result;
  }

  /** Fraction of the trailing window that the latest value exceeds, 0..1. */
  function percentileRank(values, value, lookback = 252) {
    const window = toNumbers(values.slice(-lookback));
    if (!window.length || !Number.isFinite(value)) return null;
    const below = window.filter(item => item <= value).length;
    return below / window.length;
  }

  function simpleReturns(values) {
    const result = [];
    for (let i = 1; i < values.length; i += 1) {
      const previous = Number(values[i - 1]);
      const current = Number(values[i]);
      if (Number.isFinite(previous) && Number.isFinite(current) && previous > 0) {
        result.push((current - previous) / previous);
      }
    }
    return result;
  }

  function annualizedVolatility(returns) {
    const deviation = stdev(returns);
    return deviation == null ? null : deviation * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  function annualizedReturn(equityCurve) {
    if (equityCurve.length < 2) return null;
    const total = equityCurve[equityCurve.length - 1] / equityCurve[0];
    if (!Number.isFinite(total) || total <= 0) return null;
    const years = (equityCurve.length - 1) / TRADING_DAYS_PER_YEAR;
    if (years <= 0) return null;
    return Math.pow(total, 1 / years) - 1;
  }

  function sharpeRatio(returns, riskFreeAnnual = 0) {
    const dailyRiskFree = riskFreeAnnual / TRADING_DAYS_PER_YEAR;
    const excess = returns.map(value => value - dailyRiskFree);
    const average = mean(excess);
    const deviation = stdev(excess);
    if (average == null || !deviation) return null;
    return (average / deviation) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  function maxDrawdown(equityCurve) {
    let peak = -Infinity;
    let worst = 0;
    equityCurve.forEach(value => {
      if (value > peak) peak = value;
      if (peak > 0) worst = Math.min(worst, value / peak - 1);
    });
    return worst;
  }

  function correlation(seriesA, seriesB) {
    const length = Math.min(seriesA.length, seriesB.length);
    if (length < 3) return null;
    const a = seriesA.slice(-length);
    const b = seriesB.slice(-length);
    const meanA = mean(a);
    const meanB = mean(b);
    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;
    for (let i = 0; i < length; i += 1) {
      const deltaA = a[i] - meanA;
      const deltaB = b[i] - meanB;
      covariance += deltaA * deltaB;
      varianceA += deltaA * deltaA;
      varianceB += deltaB * deltaB;
    }
    if (!varianceA || !varianceB) return null;
    return covariance / Math.sqrt(varianceA * varianceB);
  }

  global.TA = {
    TRADING_DAYS_PER_YEAR,
    mean,
    stdev,
    median,
    clamp,
    sma,
    atr,
    adx,
    rsi,
    trueRange,
    percentileRank,
    simpleReturns,
    annualizedVolatility,
    annualizedReturn,
    sharpeRatio,
    maxDrawdown,
    correlation
  };
}(window));
