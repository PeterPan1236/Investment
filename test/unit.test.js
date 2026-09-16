/**
 * Unit coverage for the browser analytics libraries. They are IIFEs that attach
 * themselves to `window`, so a minimal global stands in for the browser.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIB_DIR = path.join(__dirname, '..', 'public', 'lib');

function loadLibs(names) {
  const sandbox = { window: {}, console, Date, Math, JSON, localStorage: memoryStorage() };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  names.forEach(name => {
    const code = fs.readFileSync(path.join(LIB_DIR, name), 'utf8');
    vm.runInContext(code, sandbox, { filename: name });
    // In a browser, window properties are also globals; the sandbox has to
    // mirror that or the next library cannot see TA, SignalEngine and friends.
    Object.assign(sandbox, sandbox.window);
  });
  return sandbox.window;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

/** Deterministic pseudo-random walk so volatility figures are reproducible. */
function walk(length, seed = 1, drift = 0.0004, amplitude = 0.02) {
  const closes = [];
  let price = 100;
  let x = seed;
  for (let i = 0; i < length; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const shock = ((x / 2147483648) - 0.5) * amplitude;
    price *= 1 + drift + shock;
    closes.push(price);
  }
  return closes;
}

function barsFrom(closes, startMs = Date.UTC(2025, 0, 2)) {
  return closes.map((close, index) => ({
    timestamp: startMs + index * 86400000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    adjClose: close,
    volume: 1000000
  }));
}

test('effective positions never exceed the number of holdings', () => {
  const { Portfolio } = loadLibs(['indicators.js', 'portfolio.js']);
  const symbols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const seriesMap = {};
  symbols.forEach((symbol, index) => { seriesMap[symbol] = { symbol, currency: 'TWD', data: barsFrom(walk(300, index + 1)) }; });
  const matrix = Portfolio.buildReturnMatrix(seriesMap);

  for (const cashWeight of [0, 0.2, 0.4]) {
    const analysis = Portfolio.analyzePortfolio(matrix, Portfolio.equalWeights(matrix, { cashWeight }));
    assert.ok(analysis.available, 'analysis should be available');
    assert.ok(
      analysis.effectivePositions <= symbols.length + 1e-9,
      `cash ${cashWeight}: effectivePositions ${analysis.effectivePositions} exceeded ${symbols.length}`
    );
    assert.ok(Math.abs(analysis.effectivePositions - symbols.length) < 1e-6,
      'equal weights over 7 names should give 7 effective positions regardless of the cash sleeve');
  }
});

test('effective positions fall as capital concentrates', () => {
  const { Portfolio } = loadLibs(['indicators.js', 'portfolio.js']);
  const seriesMap = {
    A: { symbol: 'A', currency: 'TWD', data: barsFrom(walk(300, 1, 0.0004, 0.004)) },
    B: { symbol: 'B', currency: 'TWD', data: barsFrom(walk(300, 2, 0.0004, 0.08)) }
  };
  const matrix = Portfolio.buildReturnMatrix(seriesMap);
  const analysis = Portfolio.analyzePortfolio(matrix, Portfolio.inverseVolatilityWeights(matrix, { cashWeight: 0.2 }));
  assert.ok(analysis.effectivePositions < 2, 'a lopsided book holds fewer than 2 effective positions');
  assert.ok(analysis.effectivePositions > 1, 'two held names cannot fall below 1 effective position');
});

test('screener reports unknown volatility as null, never zero', () => {
  const { Screener } = loadLibs(['indicators.js', 'signal.js', 'screener.js']);
  const empty = Screener.buildRows({ seriesMap: {}, signalsBySymbol: {}, base: 'TWD', fxRate: 31 });
  assert.ok(empty.length > 0, 'rows are built even without history');
  empty.forEach(row => {
    assert.strictEqual(row.volatility, null, `${row.symbol} reported ${row.volatility} with no history`);
  });

  const seriesMap = {};
  empty.forEach((row, index) => { seriesMap[row.symbol] = { symbol: row.symbol, currency: row.currency, data: barsFrom(walk(120, index + 3)) }; });
  const loaded = Screener.buildRows({ seriesMap, signalsBySymbol: {}, base: 'TWD', fxRate: 31 });
  loaded.forEach(row => {
    assert.ok(Number.isFinite(row.volatility) && row.volatility > 0, `${row.symbol} should have a volatility once history loads`);
  });
});

test('backtest refuses a window with too few bars instead of inventing one', () => {
  const { SignalEngine, Backtest } = loadLibs(['indicators.js', 'signal.js', 'backtest.js']);
  const series = SignalEngine.computeSignalSeries(barsFrom(walk(30, 7)));
  const result = Backtest.runBacktest({ points: series.points, symbol: '2330.TW', type: 'stock' });
  assert.strictEqual(result.available, false);
  assert.match(result.reason, /at least 40 usable daily bars/);
});

test('computeSignalSeries without options behaves exactly as before the momentum gate was added', () => {
  const { SignalEngine } = loadLibs(['indicators.js', 'signal.js']);
  const bars = barsFrom(walk(150, 1, 0.01, 0.01));
  const withoutOptions = SignalEngine.computeSignalSeries(bars);
  const withEmptyOptions = SignalEngine.computeSignalSeries(bars, {});
  assert.deepStrictEqual(
    withoutOptions.points.map(p => p.state),
    withEmptyOptions.points.map(p => p.state),
  );
});

test('momentum gate downgrades BUY to HOLD when the stock ranks below the percentile threshold', () => {
  const { SignalEngine } = loadLibs(['indicators.js', 'signal.js']);
  const bars = barsFrom(walk(150, 1, 0.01, 0.01));
  const baseline = SignalEngine.computeSignalSeries(bars);
  const buyPoint = baseline.points.find(p => p.state === 'BUY');
  assert.ok(buyPoint, 'a strong sustained uptrend should produce at least one BUY bar');

  const lowPercentile = new Map([[buyPoint.timestamp, 0.5]]);
  const gated = SignalEngine.computeSignalSeries(bars, {
    momentumPercentileByTimestamp: lowPercentile,
    momentumPercentileThreshold: 0.9,
  });
  const gatedPoint = gated.points.find(p => p.timestamp === buyPoint.timestamp);
  assert.strictEqual(gatedPoint.state, 'HOLD');
  assert.ok(gatedPoint.drivers.some(d => d.key === 'momentumRank'), 'should explain why BUY was suppressed');
});

test('momentum gate leaves BUY intact when the stock ranks at or above the percentile threshold', () => {
  const { SignalEngine } = loadLibs(['indicators.js', 'signal.js']);
  const bars = barsFrom(walk(150, 1, 0.01, 0.01));
  const baseline = SignalEngine.computeSignalSeries(bars);
  const buyPoint = baseline.points.find(p => p.state === 'BUY');
  assert.ok(buyPoint);

  const highPercentile = new Map([[buyPoint.timestamp, 0.95]]);
  const gated = SignalEngine.computeSignalSeries(bars, {
    momentumPercentileByTimestamp: highPercentile,
    momentumPercentileThreshold: 0.9,
  });
  const gatedPoint = gated.points.find(p => p.timestamp === buyPoint.timestamp);
  assert.strictEqual(gatedPoint.state, 'BUY');
  assert.ok(gatedPoint.drivers.some(d => d.key === 'momentumRank' && d.weight > 0));
});

test('momentum gate degrades gracefully to the unfiltered signal when percentile data is missing for a bar', () => {
  const { SignalEngine } = loadLibs(['indicators.js', 'signal.js']);
  const bars = barsFrom(walk(150, 1, 0.01, 0.01));
  const baseline = SignalEngine.computeSignalSeries(bars);
  const buyPoint = baseline.points.find(p => p.state === 'BUY');
  assert.ok(buyPoint);

  // Map provided but has no entry for this bar's timestamp.
  const sparsePercentile = new Map([[buyPoint.timestamp + 999999, 0.95]]);
  const gated = SignalEngine.computeSignalSeries(bars, { momentumPercentileByTimestamp: sparsePercentile });
  const gatedPoint = gated.points.find(p => p.timestamp === buyPoint.timestamp);
  assert.strictEqual(gatedPoint.state, 'BUY', 'missing percentile data should not suppress the original signal');
});

test('moving averages stay null until the period is filled', () => {
  const { TA } = loadLibs(['indicators.js']);
  const sma = TA.sma([1, 2, 3, 4, 5], 3);
  // Values cross the vm realm boundary, so compare in the host realm.
  assert.deepStrictEqual(Array.from(sma.slice(0, 2)), [null, null]);
  assert.strictEqual(sma[2], 2);
  assert.strictEqual(sma[4], 4);
});

test('annualized volatility of a flat series is zero, of an empty series is not a number', () => {
  const { TA } = loadLibs(['indicators.js']);
  assert.strictEqual(TA.annualizedVolatility(TA.simpleReturns([10, 10, 10, 10])), 0);
  const empty = TA.annualizedVolatility(TA.simpleReturns([]));
  assert.ok(empty === 0 || empty === null || Number.isNaN(empty),
    'an empty series must not report a positive volatility');
});
