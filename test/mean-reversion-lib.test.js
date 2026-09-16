const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/mean-reversion-lib.mjs');
}

function bar(date, close) {
  return { date, close };
}

test('detectOversoldTransitions fires only on the day state first flips to OVERSOLD', async () => {
  const { detectOversoldTransitions } = await loadLib();
  const states = ['NONE', 'OVERSOLD', 'OVERSOLD', 'NONE', 'OVERSOLD'];
  assert.deepStrictEqual(detectOversoldTransitions(states), [1, 4]);
});

test('computeMeanReversionSeries flags OVERSOLD only where RSI < 30 (band requirement off)', async () => {
  const { computeMeanReversionSeries } = await loadLib();
  // Fake TA: rsi() returns a fixed pattern regardless of closes, mean/stdev unused when requireBand=false.
  const fakeTA = {
    rsi: (closes, period) => closes.map((_, i) => (i === 5 ? 20 : 50)),
    mean: () => 0,
    stdev: () => 0,
  };
  const bars = Array.from({ length: 10 }, (_, i) => bar(`d${i}`, 100 + i));
  const points = computeMeanReversionSeries(bars, fakeTA, { requireBand: false });
  assert.strictEqual(points[5].state, 'OVERSOLD');
  assert.strictEqual(points[0].state, 'NONE');
});

test('computeMeanReversionSeries requires close below the lower band when requireBand is true', async () => {
  const { computeMeanReversionSeries } = await loadLib();
  const fakeTA = {
    rsi: (closes) => closes.map(() => 20), // always oversold by RSI alone
    mean: () => 100,
    stdev: () => 5, // lower band = 100 - 2*5 = 90
  };
  const bars = [
    ...Array.from({ length: 19 }, (_, i) => bar(`d${i}`, 100)),
    bar('d19', 95), // above band (90) -> not oversold even though RSI says so
    bar('d20', 85), // below band -> oversold
  ];
  const points = computeMeanReversionSeries(bars, fakeTA, { bandPeriod: 20, bandK: 2, requireBand: true });
  assert.strictEqual(points[19].state, 'NONE');
  assert.strictEqual(points[20].state, 'OVERSOLD');
});

test('integrates with the real TA.rsi from public/lib/indicators.js', async () => {
  const { computeMeanReversionSeries } = await loadLib();
  const { loadTA } = await import('../scripts/institutional-backtest/signal-engine-loader.mjs');
  const TA = loadTA();
  // A sustained decline should eventually push RSI below 30.
  const closes = [];
  let price = 100;
  for (let i = 0; i < 30; i++) {
    price -= 1;
    closes.push(price);
  }
  const bars = closes.map((c, i) => bar(`d${i}`, c));
  const points = computeMeanReversionSeries(bars, TA, { requireBand: false });
  const anyOversold = points.some((p) => p.state === 'OVERSOLD');
  assert.ok(anyOversold, 'a steady 30-point decline should trigger RSI < 30 at some point');
});
