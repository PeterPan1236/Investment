const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/market-regime-lib.mjs');
}

function buildDailyReturns(returnsByDateArray) {
  const map = new Map();
  for (const [date, returns] of returnsByDateArray) map.set(date, returns);
  return map;
}

test('flags a day as stress only once the trailing lookback return breaches the threshold', async () => {
  const { computeMarketRegime } = await loadLib();
  // 25 flat days, then a sharp -10% single-day drop on day 20, then flat again.
  const entries = [];
  for (let i = 0; i < 25; i++) {
    const ret = i === 20 ? -0.10 : 0;
    entries.push([`d${i}`, [ret]]);
  }
  const regime = computeMarketRegime(buildDailyReturns(entries), { lookback: 5, stressThreshold: -0.08 });
  // The drop is included in the trailing-5 window for days 20..24.
  assert.strictEqual(regime.get('d19').isStress, false);
  assert.strictEqual(regime.get('d20').isStress, true, 'the drop day itself already reflects the -10% move in its own index level');
  assert.strictEqual(regime.get('d24').isStress, true);
  assert.strictEqual(regime.get('d25') === undefined, true);
});

test('uses the median of same-day cross-sectional returns, ignoring outliers', async () => {
  const { computeMarketRegime } = await loadLib();
  const entries = [
    ['d0', [0, 0, 0]],
    ['d1', [-0.5, 0.01, 0.01]], // one crashed stock should not dominate the median
  ];
  const regime = computeMarketRegime(buildDailyReturns(entries));
  assert.ok(Math.abs(regime.get('d1').indexLevel - 101) < 1e-6, 'median day return of 0.01 applied to index');
});

test('trailingReturn and isStress are null/false before enough history accumulates', async () => {
  const { computeMarketRegime } = await loadLib();
  const entries = [['d0', [0.01]], ['d1', [0.01]]];
  const regime = computeMarketRegime(buildDailyReturns(entries), { lookback: 20 });
  assert.strictEqual(regime.get('d0').trailingReturn, null);
  assert.strictEqual(regime.get('d0').isStress, false);
});

test('computeVolatilityRegime flags a day only once realized vol is in the top percentile of its own trailing history', async () => {
  const { computeVolatilityRegime } = await loadLib();
  const entries = [];
  // 60 calm days (small alternating returns), then a burst of 10 wild days.
  for (let i = 0; i < 60; i++) entries.push([`calm${i}`, [i % 2 === 0 ? 0.001 : -0.001]]);
  for (let i = 0; i < 10; i++) entries.push([`wild${i}`, [i % 2 === 0 ? 0.05 : -0.05]]);
  const regime = computeVolatilityRegime(buildDailyReturns(entries), { volWindow: 5, percentileLookback: 252, stressPercentile: 0.85 });
  assert.strictEqual(regime.get('calm30').isStress, false);
  assert.strictEqual(regime.get('wild9').isStress, true);
});

test('computeVolatilityRegime returns null percentile/volatility before enough history', async () => {
  const { computeVolatilityRegime } = await loadLib();
  const entries = [['d0', [0.01]], ['d1', [0.01]]];
  const regime = computeVolatilityRegime(buildDailyReturns(entries), { volWindow: 20 });
  assert.strictEqual(regime.get('d0').volatility, null);
  assert.strictEqual(regime.get('d0').isStress, false);
});
