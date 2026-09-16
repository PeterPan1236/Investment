// Pure functions: cross-sectional long-short (dollar-neutral) portfolio
// construction. Given one rebalance date's cross-section of {code, factor,
// returnPct} — factor ranks stocks (e.g. RSI, lower = more oversold), returnPct
// is that stock's already-computed forward return over the holding period —
// split into a long basket (factor's low extreme) and a short basket (high
// extreme) and compute the equal-weighted, dollar-neutral portfolio return.

export function rankAndSplit(crossSection, { decileFraction = 0.1, minPerSide = 5 } = {}) {
  const n = crossSection.length;
  const sideSize = Math.max(minPerSide, Math.floor(n * decileFraction));
  if (n < sideSize * 2) return { longGroup: [], shortGroup: [] };

  const sorted = [...crossSection].sort((a, b) => a.factor - b.factor);
  const longGroup = sorted.slice(0, sideSize); // lowest factor value (e.g. most oversold)
  const shortGroup = sorted.slice(-sideSize); // highest factor value (e.g. most overbought)
  return { longGroup, shortGroup };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeLongShortReturn(longGroup, shortGroup) {
  if (longGroup.length === 0 || shortGroup.length === 0) {
    return { longReturn: null, shortReturn: null, portfolioReturn: null, longCount: 0, shortCount: 0 };
  }
  const longReturn = mean(longGroup.map((s) => s.returnPct));
  const shortReturn = mean(shortGroup.map((s) => s.returnPct));
  return {
    longReturn,
    shortReturn,
    portfolioReturn: longReturn - shortReturn,
    longCount: longGroup.length,
    shortCount: shortGroup.length,
  };
}
