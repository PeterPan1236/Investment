/**
 * Volatility-based forecast distribution.
 *
 * A point price target from a few months of daily bars is noise presented as
 * precision, so nothing here returns one. The model is a damped random walk:
 * the median path uses a heavily shrunk historical drift, and the band comes
 * from realized volatility scaled by the square root of the horizon.
 */
(function (global) {
  const DEFAULT_HORIZONS = [5, 10, 20];
  const DRIFT_SHRINK = 0.25;
  const MAX_DAILY_DRIFT = 0.004;
  const Z_SCORES = { p10: -1.2816, p25: -0.6745, p75: 0.6745, p90: 1.2816 };
  const MINIMUM_BARS = 30;

  function logReturns(closes) {
    const result = [];
    for (let i = 1; i < closes.length; i += 1) {
      if (closes[i - 1] > 0 && closes[i] > 0) result.push(Math.log(closes[i] / closes[i - 1]));
    }
    return result;
  }

  function computeForecastFan(bars = [], horizons = DEFAULT_HORIZONS) {
    const closes = bars
      .map(bar => Number(bar.adjClose ?? bar.close))
      .filter(value => Number.isFinite(value) && value > 0);

    if (closes.length < MINIMUM_BARS) {
      return {
        available: false,
        reason: `估計區間需要至少 ${MINIMUM_BARS} 根日線，目前只有 ${closes.length} 根。`,
        horizons: []
      };
    }

    const returns = logReturns(closes);
    const dailyVolatility = TA.stdev(returns);
    const rawDrift = TA.mean(returns) ?? 0;
    // Sample drift over a few hundred bars is mostly estimation error, so it is
    // shrunk hard and capped before being projected forward.
    const drift = TA.clamp(rawDrift * DRIFT_SHRINK, -MAX_DAILY_DRIFT, MAX_DAILY_DRIFT);
    const lastClose = closes[closes.length - 1];

    if (!dailyVolatility) {
      return { available: false, reason: '報酬率波動為零，無法估計區間。', horizons: [] };
    }

    const projected = horizons.map(days => {
      const sigma = dailyVolatility * Math.sqrt(days);
      const center = Math.log(lastClose) + drift * days;
      const quantile = z => Math.exp(center + z * sigma);

      return {
        days,
        p10: quantile(Z_SCORES.p10),
        p25: quantile(Z_SCORES.p25),
        p50: Math.exp(center),
        p75: quantile(Z_SCORES.p75),
        p90: quantile(Z_SCORES.p90),
        sigma,
        widthPercent: (quantile(Z_SCORES.p90) - quantile(Z_SCORES.p10)) / lastClose
      };
    });

    return {
      available: true,
      lastClose,
      dailyVolatility,
      annualizedVolatility: dailyVolatility * Math.sqrt(TA.TRADING_DAYS_PER_YEAR),
      drift,
      sampleSize: returns.length,
      horizons: projected,
      method: `以 ${returns.length} 筆日報酬估計的隨機漫步：中位數僅含收縮後漂移（原始漂移 × ${DRIFT_SHRINK}），`
        + `區間為年化波動 ${((dailyVolatility * Math.sqrt(TA.TRADING_DAYS_PER_YEAR)) * 100).toFixed(1)}% 依 √t 外推的 P10–P90。`
        + '此為機率區間，非目標價。'
    };
  }

  global.Forecast = { computeForecastFan, DEFAULT_HORIZONS, MINIMUM_BARS };
}(window));
