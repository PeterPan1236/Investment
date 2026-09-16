const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/signal-lib.mjs');
}

function bar(date, trustNet, foreignNet, open, close) {
  return { date, trustNet, foreignNet, open, close };
}

test('fires only after 3+ consecutive days of trust-fund net buying with foreign net buying on the last day', async () => {
  const { detectSignals } = await loadLib();
  const series = [
    bar('d0', 100, 100, 10, 10),
    bar('d1', 100, 100, 10, 10),
    bar('d2', 100, 100, 10, 10), // 3rd consecutive day, foreign > 0 -> signal
    bar('d3', -50, 100, 10, 10),
  ];
  assert.deepStrictEqual(detectSignals(series, { streakDays: 3 }), [2]);
});

test('does not fire on only 2 consecutive days of trust-fund buying', async () => {
  const { detectSignals } = await loadLib();
  const series = [
    bar('d0', -10, 100, 10, 10),
    bar('d1', 100, 100, 10, 10),
    bar('d2', 100, 100, 10, 10),
  ];
  assert.deepStrictEqual(detectSignals(series, { streakDays: 3 }), []);
});

test('does not fire when foreign investors are net selling on the signal day', async () => {
  const { detectSignals } = await loadLib();
  const series = [
    bar('d0', 100, 100, 10, 10),
    bar('d1', 100, 100, 10, 10),
    bar('d2', 100, -5, 10, 10), // trust streak intact, but foreign net <= 0
  ];
  assert.deepStrictEqual(detectSignals(series, { streakDays: 3 }), []);
});

test('a streak longer than 3 days still fires exactly once per qualifying day', async () => {
  const { detectSignals } = await loadLib();
  const series = [
    bar('d0', 100, 100, 10, 10),
    bar('d1', 100, 100, 10, 10),
    bar('d2', 100, 100, 10, 10), // signal
    bar('d3', 100, 100, 10, 10), // still a qualifying day (3 days back are all positive)
  ];
  assert.deepStrictEqual(detectSignals(series, { streakDays: 3 }), [2, 3]);
});

test('enters next day at open and exits after holding exactly N trading days at close', async () => {
  const { simulateTrades } = await loadLib();
  const series = [
    bar('d0', 0, 0, 100, 101), // t=0 signal
    bar('d1', 0, 0, 110, 112), // entry: open=110
    bar('d2', 0, 0, 113, 114),
    bar('d3', 0, 0, 115, 116),
    bar('d4', 0, 0, 117, 118),
    bar('d5', 0, 0, 119, 120), // exit: close=120 (5th trading day of the hold)
    bar('d6', 0, 0, 121, 122),
  ];
  const trades = simulateTrades(series, [0], { holdDays: 5 });
  assert.strictEqual(trades.length, 1);
  const [trade] = trades;
  assert.strictEqual(trade.entryDate, 'd1');
  assert.strictEqual(trade.exitDate, 'd5');
  assert.strictEqual(trade.entryPrice, 110);
  assert.strictEqual(trade.exitPrice, 120);
  assert.ok(Math.abs(trade.returnPct - (120 - 110) / 110) < 1e-12, 'return computed as (exit-entry)/entry');
});

test('skips a trade when there are not enough future bars to complete the hold', async () => {
  const { simulateTrades } = await loadLib();
  const series = [
    bar('d0', 0, 0, 100, 101),
    bar('d1', 0, 0, 110, 112),
    bar('d2', 0, 0, 113, 114),
  ];
  const trades = simulateTrades(series, [0], { holdDays: 5 });
  assert.strictEqual(trades.length, 0);
});

test('ignores a new signal that fires while a position from an earlier signal is still open', async () => {
  const { simulateTrades } = await loadLib();
  const series = [
    bar('d0', 0, 0, 100, 100), // signal A
    bar('d1', 0, 0, 100, 100), // entry A
    bar('d2', 0, 0, 100, 100), // signal B fires here, but position A still open (holds through d5)
    bar('d3', 0, 0, 100, 100),
    bar('d4', 0, 0, 100, 100),
    bar('d5', 0, 0, 100, 105), // exit A
    bar('d6', 0, 0, 100, 100),
  ];
  const trades = simulateTrades(series, [0, 2], { holdDays: 5 });
  assert.strictEqual(trades.length, 1, 'signal B must be ignored while A is still open');
  assert.strictEqual(trades[0].entryDate, 'd1');
});

test('win rate, average return and cumulative return are computed correctly on a fixed sample', async () => {
  const { summarize } = await loadLib();
  const trades = [
    { returnPct: 0.10 },
    { returnPct: -0.05 },
    { returnPct: 0.02 },
    { returnPct: -0.02 },
  ];
  const stats = summarize(trades);
  assert.strictEqual(stats.tradeCount, 4);
  assert.strictEqual(stats.winCount, 2);
  assert.strictEqual(stats.winRate, 0.5);
  assert.ok(Math.abs(stats.avgReturn - 0.0125) < 1e-12);
  const expectedCumulative = 1.10 * 0.95 * 1.02 * 0.98 - 1;
  assert.ok(Math.abs(stats.cumulativeReturn - expectedCumulative) < 1e-12);
});

test('summarize returns nulls instead of NaN when there are no trades', async () => {
  const { summarize } = await loadLib();
  const stats = summarize([]);
  assert.strictEqual(stats.tradeCount, 0);
  assert.strictEqual(stats.winRate, null);
  assert.strictEqual(stats.avgReturn, null);
  assert.strictEqual(stats.cumulativeReturn, null);
});
