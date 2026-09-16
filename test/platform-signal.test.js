const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/platform-signal-lib.mjs');
}

test('fires only on the day the state first flips to BUY, not on every subsequent BUY day', async () => {
  const { detectBuySignalTransitions } = await loadLib();
  const states = ['HOLD', 'HOLD', 'BUY', 'BUY', 'BUY', 'SELL', 'BUY'];
  assert.deepStrictEqual(detectBuySignalTransitions(states), [2, 6]);
});

test('a BUY on the very first day counts as a signal', async () => {
  const { detectBuySignalTransitions } = await loadLib();
  const states = ['BUY', 'BUY', 'HOLD'];
  assert.deepStrictEqual(detectBuySignalTransitions(states), [0]);
});

test('no signals when the state never reaches BUY', async () => {
  const { detectBuySignalTransitions } = await loadLib();
  const states = ['HOLD', 'SELL', 'HOLD'];
  assert.deepStrictEqual(detectBuySignalTransitions(states), []);
});
