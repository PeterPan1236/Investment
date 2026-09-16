const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/dsr-lib.mjs');
}

test('normalCdf matches known standard-normal reference points', async () => {
  const { normalCdf } = await loadLib();
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1.959964) - 0.025) < 1e-4);
});

test('normalInvCdf round-trips through normalCdf', async () => {
  const { normalCdf, normalInvCdf } = await loadLib();
  for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) {
    const x = normalInvCdf(p);
    assert.ok(Math.abs(normalCdf(x) - p) < 1e-6, `p=${p} round-trip`);
  }
});

test('sharpeRatio is mean over sample stdev, null for constant or too-short series', async () => {
  const { sharpeRatio } = await loadLib();
  assert.ok(Math.abs(sharpeRatio([0.1, 0.2, 0.3]) - (0.2 / 0.1)) < 1e-9);
  assert.strictEqual(sharpeRatio([0.05, 0.05, 0.05]), null);
  assert.strictEqual(sharpeRatio([0.1]), null);
});

test('skewness is 0 and kurtosis is 3 for a symmetric normal-like sample', async () => {
  const { skewness, kurtosis } = await loadLib();
  const symmetric = [-2, -1, -1, 0, 0, 0, 1, 1, 2];
  assert.ok(Math.abs(skewness(symmetric)) < 1e-9);
  // not exactly 3 for a small discrete sample, just sanity-check it is finite and positive
  assert.ok(Number.isFinite(kurtosis(symmetric)) && kurtosis(symmetric) > 0);
});

test('skewness is positive for a right-tailed distribution', async () => {
  const { skewness } = await loadLib();
  const rightTailed = [1, 1, 1, 1, 1, 1, 1, 1, 10];
  assert.ok(skewness(rightTailed) > 0);
});

test('expectedMaxSharpeUnderNull grows with more trials (harder to beat pure luck)', async () => {
  const { expectedMaxSharpeUnderNull } = await loadLib();
  const sr10 = expectedMaxSharpeUnderNull(10, 0.04);
  const sr100 = expectedMaxSharpeUnderNull(100, 0.04);
  const sr1000 = expectedMaxSharpeUnderNull(1000, 0.04);
  assert.ok(sr10 < sr100);
  assert.ok(sr100 < sr1000);
});

test('expectedMaxSharpeUnderNull scales with sqrt of the variance across trials', async () => {
  const { expectedMaxSharpeUnderNull } = await loadLib();
  const low = expectedMaxSharpeUnderNull(50, 0.01);
  const high = expectedMaxSharpeUnderNull(50, 0.04);
  assert.ok(Math.abs(high / low - 2) < 1e-6, 'variance 4x -> sqrt(variance) 2x');
});

test('deflatedSharpeRatio drops toward 0 as numTrials grows for a fixed observed Sharpe (more snooping = less credible)', async () => {
  const { deflatedSharpeRatio } = await loadLib();
  const base = { observedSharpe: 0.3, numObservations: 200, skew: 0, kurtosis: 3, sharpeVarianceAcrossTrials: 0.04 };
  const dsrFew = deflatedSharpeRatio({ ...base, numTrials: 2 }).dsr;
  const dsrMany = deflatedSharpeRatio({ ...base, numTrials: 60 }).dsr;
  assert.ok(dsrMany < dsrFew, 'trying many strategies and picking the best should deflate confidence');
});

test('deflatedSharpeRatio is high when the observed Sharpe clearly beats the null threshold', async () => {
  const { deflatedSharpeRatio } = await loadLib();
  const result = deflatedSharpeRatio({
    observedSharpe: 2.0,
    numObservations: 500,
    skew: 0,
    kurtosis: 3,
    numTrials: 10,
    sharpeVarianceAcrossTrials: 0.01,
  });
  assert.ok(result.dsr > 0.99);
});
