/**
 * Portfolio construction and concentration analysis.
 *
 * A list of ten ideas is not a portfolio until it has weights and a covariance
 * structure. The functions here size positions by inverse volatility (so a 60%
 * annualized-vol coin cannot quietly dominate the risk of a book that also
 * holds 25%-vol equities) and report how much independent risk actually
 * remains once correlations are accounted for.
 */
(function (global) {
  const DEFAULT_CASH_WEIGHT = 0.2;
  const MINIMUM_OVERLAP = 40;

  function dateKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  /**
   * Convert each series to the requested base currency using the FX series when
   * available, then align every symbol on the dates they all share.
   */
  function buildReturnMatrix(seriesMap, { base = 'TWD', fxSeries = null, symbols = null } = {}) {
    const keys = (symbols || Object.keys(seriesMap)).filter(symbol => seriesMap[symbol]?.data?.length);
    if (!keys.length) return { symbols: [], dates: [], returns: {}, closes: {} };

    const fxByDate = new Map();
    (fxSeries?.data || []).forEach(bar => {
      const rate = Number(bar.adjClose ?? bar.close);
      if (Number.isFinite(rate) && rate > 0) fxByDate.set(dateKey(bar.timestamp), rate);
    });

    const priceByDate = {};
    keys.forEach(symbol => {
      const isUsdQuoted = seriesMap[symbol].currency === 'USD' || /-USD$/i.test(symbol);
      const map = new Map();
      seriesMap[symbol].data.forEach(bar => {
        const price = Number(bar.adjClose ?? bar.close);
        if (!Number.isFinite(price) || price <= 0) return;
        const key = dateKey(bar.timestamp);

        let converted = price;
        if (base === 'TWD' && isUsdQuoted) {
          const rate = fxByDate.get(key);
          if (!rate) return;
          converted = price * rate;
        } else if (base === 'USD' && !isUsdQuoted) {
          const rate = fxByDate.get(key);
          if (!rate) return;
          converted = price / rate;
        }
        map.set(key, converted);
      });
      priceByDate[symbol] = map;
    });

    const dates = Array.from(priceByDate[keys[0]].keys())
      .filter(date => keys.every(symbol => priceByDate[symbol].has(date)))
      .sort();

    const closes = {};
    const returns = {};
    keys.forEach(symbol => {
      const series = dates.map(date => priceByDate[symbol].get(date));
      closes[symbol] = series;
      returns[symbol] = TA.simpleReturns(series);
    });

    return { symbols: keys, dates, returns, closes, base };
  }

  function correlationMatrix(matrix) {
    const { symbols, returns } = matrix;
    return symbols.map(rowSymbol => symbols.map(columnSymbol => (
      rowSymbol === columnSymbol ? 1 : TA.correlation(returns[rowSymbol], returns[columnSymbol])
    )));
  }

  function covariance(seriesA, seriesB) {
    const length = Math.min(seriesA.length, seriesB.length);
    if (length < 3) return 0;
    const a = seriesA.slice(-length);
    const b = seriesB.slice(-length);
    const meanA = TA.mean(a);
    const meanB = TA.mean(b);
    let total = 0;
    for (let i = 0; i < length; i += 1) total += (a[i] - meanA) * (b[i] - meanB);
    return total / (length - 1);
  }

  /** Inverse-volatility sizing: each name contributes comparable standalone risk. */
  function inverseVolatilityWeights(matrix, { cashWeight = DEFAULT_CASH_WEIGHT } = {}) {
    const { symbols, returns } = matrix;
    const volatilities = {};
    symbols.forEach(symbol => {
      volatilities[symbol] = TA.annualizedVolatility(returns[symbol]) || null;
    });

    const investable = symbols.filter(symbol => volatilities[symbol]);
    const inverse = investable.map(symbol => 1 / volatilities[symbol]);
    const inverseTotal = inverse.reduce((sum, value) => sum + value, 0);
    const riskBudget = TA.clamp(1 - cashWeight, 0, 1);

    const weights = {};
    investable.forEach((symbol, index) => {
      weights[symbol] = inverseTotal ? (inverse[index] / inverseTotal) * riskBudget : 0;
    });
    symbols.filter(symbol => !volatilities[symbol]).forEach(symbol => { weights[symbol] = 0; });

    return { weights, volatilities, cashWeight: TA.clamp(cashWeight, 0, 1) };
  }

  function equalWeights(matrix, { cashWeight = DEFAULT_CASH_WEIGHT } = {}) {
    const { symbols, returns } = matrix;
    const riskBudget = TA.clamp(1 - cashWeight, 0, 1);
    const weights = {};
    const volatilities = {};
    symbols.forEach(symbol => {
      volatilities[symbol] = TA.annualizedVolatility(returns[symbol]) || null;
      weights[symbol] = riskBudget / symbols.length;
    });
    return { weights, volatilities, cashWeight: TA.clamp(cashWeight, 0, 1) };
  }

  function analyzePortfolio(matrix, sizing) {
    const { symbols, returns } = matrix;
    const { weights, volatilities, cashWeight } = sizing;
    const overlap = Math.min(...symbols.map(symbol => returns[symbol].length));
    if (!symbols.length || overlap < MINIMUM_OVERLAP) {
      return { available: false, reason: `Not enough overlapping daily returns (${MINIMUM_OVERLAP} days required, ${Number.isFinite(overlap) ? overlap : 0} available).` };
    }

    const covarianceMatrix = symbols.map(rowSymbol => symbols.map(columnSymbol => (
      covariance(returns[rowSymbol], returns[columnSymbol])
    )));
    const weightVector = symbols.map(symbol => weights[symbol] || 0);

    let dailyVariance = 0;
    symbols.forEach((_, i) => {
      symbols.forEach((__, j) => {
        dailyVariance += weightVector[i] * weightVector[j] * covarianceMatrix[i][j];
      });
    });
    const dailyVolatility = Math.sqrt(Math.max(dailyVariance, 0));
    const annualizedVolatility = dailyVolatility * Math.sqrt(TA.TRADING_DAYS_PER_YEAR);

    // Marginal risk contributions expose the gap between capital weight and
    // risk weight, which is the real story in a mixed equity + crypto book.
    const riskContributions = symbols.map((symbol, i) => {
      const marginal = symbols.reduce((sum, __, j) => sum + weightVector[j] * covarianceMatrix[i][j], 0);
      const contribution = dailyVariance ? (weightVector[i] * marginal) / dailyVariance : 0;
      return { symbol, weight: weightVector[i], riskShare: contribution, volatility: volatilities[symbol] };
    });

    const portfolioReturns = [];
    for (let t = 0; t < overlap; t += 1) {
      let total = 0;
      symbols.forEach((symbol, i) => {
        total += weightVector[i] * returns[symbol][returns[symbol].length - overlap + t];
      });
      portfolioReturns.push(total);
    }

    const equityCurve = [1];
    portfolioReturns.forEach(value => equityCurve.push(equityCurve[equityCurve.length - 1] * (1 + value)));

    const weightedAverageVolatility = symbols.reduce((sum, symbol, i) => (
      sum + weightVector[i] * (volatilities[symbol] || 0)
    ), 0);
    const diversificationRatio = annualizedVolatility ? weightedAverageVolatility / annualizedVolatility : null;
    const investedWeight = weightVector.reduce((sum, value) => sum + value, 0);
    // HHI is only meaningful on weights that sum to 1, so the risky sleeve is
    // renormalized first. Using raw weights inflates 1/HHI by 1/investedWeight²
    // and can report more effective positions than the book actually holds.
    const herfindahl = investedWeight
      ? weightVector.reduce((sum, value) => sum + (value / investedWeight) * (value / investedWeight), 0)
      : 0;

    const correlations = correlationMatrix(matrix);
    const offDiagonal = [];
    symbols.forEach((_, i) => {
      symbols.forEach((__, j) => {
        if (j > i && correlations[i][j] != null) offDiagonal.push(correlations[i][j]);
      });
    });

    return {
      available: true,
      symbols,
      weights,
      cashWeight,
      investedWeight,
      volatilities,
      correlations,
      riskContributions: riskContributions.sort((a, b) => b.riskShare - a.riskShare),
      annualizedVolatility,
      maxDrawdown: TA.maxDrawdown(equityCurve),
      equityCurve,
      sampleDays: overlap,
      diversificationRatio,
      // 1/HHI counts equally weighted holdings carrying the same capital
      // concentration; it ignores correlation, so it always flatters a book.
      effectivePositions: herfindahl ? 1 / herfindahl : null,
      // The squared diversification ratio is the standard correlation-aware
      // count of independent bets: perfectly correlated holdings collapse to 1
      // no matter how many line items the list has.
      effectiveBets: diversificationRatio ? Math.pow(diversificationRatio, 2) : null,
      averageCorrelation: offDiagonal.length ? TA.mean(offDiagonal) : null,
      maxCorrelation: offDiagonal.length ? Math.max(...offDiagonal) : null
    };
  }

  global.Portfolio = {
    DEFAULT_CASH_WEIGHT,
    buildReturnMatrix,
    correlationMatrix,
    inverseVolatilityWeights,
    equalWeights,
    analyzePortfolio
  };
}(window));
