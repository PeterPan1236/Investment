// Pure statistical primitives for the Deflated Sharpe Ratio (Bailey & Lopez de
// Prado, "The Deflated Sharpe Ratio", 2014). DSR asks: after trying N strategy
// variants and reporting whichever looked best, is the observed Sharpe ratio
// still distinguishable from the best Sharpe you'd expect to see by pure luck
// out of N random (skill-less) trials?

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sharpeRatio(returns) {
  if (returns.length < 2) return null;
  const m = mean(returns);
  const variance = returns.reduce((acc, r) => acc + (r - m) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd < 1e-12 ? null : m / sd;
}

// Population (n-denominator) skewness/kurtosis, as used in the Mertens (2002)
// standard-error-of-Sharpe formula that DSR relies on. Kurtosis here is "raw"
// (normal distribution -> 3), not excess kurtosis.
export function skewness(returns) {
  const n = returns.length;
  const m = mean(returns);
  const s = Math.sqrt(returns.reduce((acc, r) => acc + (r - m) ** 2, 0) / n);
  if (s === 0) return 0;
  const m3 = returns.reduce((acc, r) => acc + (r - m) ** 3, 0) / n;
  return m3 / s ** 3;
}

export function kurtosis(returns) {
  const n = returns.length;
  const m = mean(returns);
  const s = Math.sqrt(returns.reduce((acc, r) => acc + (r - m) ** 2, 0) / n);
  if (s === 0) return 3;
  const m4 = returns.reduce((acc, r) => acc + (r - m) ** 4, 0) / n;
  return m4 / s ** 4;
}

// Abramowitz & Stegun 7.1.26 approximation, max absolute error ~1.5e-7.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// Acklam's rational approximation of the standard normal quantile function.
export function normalInvCdf(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const EULER_MASCHERONI = 0.5772156649015329;

// Expected maximum Sharpe ratio you'd see if you ran `numTrials` skill-less
// (zero true Sharpe) strategies and reported whichever came out on top, given
// how much Sharpe ratios vary trial-to-trial (sharpeVariance).
export function expectedMaxSharpeUnderNull(numTrials, sharpeVariance) {
  if (numTrials < 2 || sharpeVariance <= 0) return 0;
  const term1 = (1 - EULER_MASCHERONI) * normalInvCdf(1 - 1 / numTrials);
  const term2 = EULER_MASCHERONI * normalInvCdf(1 - 1 / (numTrials * Math.E));
  return Math.sqrt(sharpeVariance) * (term1 + term2);
}

// Returns the deflated Sharpe ratio: the probability that the true Sharpe ratio
// of the SELECTED strategy exceeds the expected-max-under-null benchmark, i.e.
// that the observed result isn't just the best of `numTrials` lucky draws.
export function deflatedSharpeRatio({ observedSharpe, numObservations, skew, kurtosis: kurtosisRaw, numTrials, sharpeVarianceAcrossTrials }) {
  const sr0 = expectedMaxSharpeUnderNull(numTrials, sharpeVarianceAcrossTrials);
  const sigmaSR = Math.sqrt(
    (1 - skew * observedSharpe + ((kurtosisRaw - 1) / 4) * observedSharpe ** 2) / (numObservations - 1),
  );
  const z = (observedSharpe - sr0) / sigmaSR;
  return { sr0, sigmaSR, z, dsr: normalCdf(z) };
}
