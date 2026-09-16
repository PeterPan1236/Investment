// Pure functions: a mean-reversion alternative to the platform's trend-following
// MA/ADX signal. Oversold = RSI below threshold, optionally also requiring the
// close to be below a rolling Bollinger-style lower band. TA is injected (loaded
// from the real public/lib/indicators.js via signal-engine-loader.mjs) so this
// never reimplements RSI/SMA/stdev math.

export function computeMeanReversionSeries(bars, TA, { rsiPeriod = 14, bandPeriod = 20, bandK = 2, requireBand = true } = {}) {
  const closes = bars.map((b) => b.close);
  const rsiSeries = TA.rsi(closes, rsiPeriod);

  const points = bars.map((bar, i) => {
    const rsiValue = rsiSeries[i];
    let lowerBand = null;
    if (i >= bandPeriod - 1) {
      const window = closes.slice(i - bandPeriod + 1, i + 1);
      const bandMean = TA.mean(window);
      const bandStdev = TA.stdev(window);
      lowerBand = bandMean - bandK * bandStdev;
    }

    const rsiOversold = rsiValue != null && rsiValue < 30;
    const belowBand = lowerBand != null && bar.close < lowerBand;
    const oversold = requireBand ? rsiOversold && belowBand : rsiOversold;

    return { ...bar, rsi: rsiValue, lowerBand, state: oversold ? 'OVERSOLD' : 'NONE' };
  });

  return points;
}

export function detectOversoldTransitions(states) {
  const signals = [];
  for (let i = 0; i < states.length; i++) {
    const prev = i === 0 ? null : states[i - 1];
    if (states[i] === 'OVERSOLD' && prev !== 'OVERSOLD') {
      signals.push(i);
    }
  }
  return signals;
}
