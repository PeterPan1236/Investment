const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/cross-sectional-lib.mjs');
}

function stock(code, factor, returnPct) {
  return { code, factor, returnPct };
}

test('rankAndSplit takes the low-factor extreme as long and high-factor extreme as short', async () => {
  const { rankAndSplit } = await loadLib();
  const crossSection = Array.from({ length: 20 }, (_, i) => stock(`s${i}`, i, 0));
  const { longGroup, shortGroup } = rankAndSplit(crossSection, { decileFraction: 0.1, minPerSide: 2 });
  assert.strictEqual(longGroup.length, 2);
  assert.strictEqual(shortGroup.length, 2);
  assert.deepStrictEqual(longGroup.map((s) => s.code), ['s0', 's1']);
  assert.deepStrictEqual(shortGroup.map((s) => s.code), ['s18', 's19']);
});

test('rankAndSplit returns empty groups when the cross-section is too small for both sides', async () => {
  const { rankAndSplit } = await loadLib();
  const crossSection = [stock('a', 1, 0), stock('b', 2, 0), stock('c', 3, 0)];
  const { longGroup, shortGroup } = rankAndSplit(crossSection, { minPerSide: 5 });
  assert.strictEqual(longGroup.length, 0);
  assert.strictEqual(shortGroup.length, 0);
});

test('computeLongShortReturn is the spread between the long basket and short basket average returns', async () => {
  const { computeLongShortReturn } = await loadLib();
  const longGroup = [stock('a', 1, 0.05), stock('b', 2, 0.03)]; // avg +4%
  const shortGroup = [stock('c', 9, -0.02), stock('d', 10, 0.00)]; // avg -1%
  const result = computeLongShortReturn(longGroup, shortGroup);
  assert.ok(Math.abs(result.longReturn - 0.04) < 1e-9);
  assert.ok(Math.abs(result.shortReturn - (-0.01)) < 1e-9);
  assert.ok(Math.abs(result.portfolioReturn - 0.05) < 1e-9, 'long avg minus short avg');
});

test('computeLongShortReturn returns nulls when either side is empty', async () => {
  const { computeLongShortReturn } = await loadLib();
  const result = computeLongShortReturn([], [stock('a', 1, 0.1)]);
  assert.strictEqual(result.portfolioReturn, null);
});
