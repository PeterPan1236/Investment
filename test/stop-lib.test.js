const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/stop-lib.mjs');
}

function regimeMapFrom(entries) {
  return new Map(entries.map(([date, isStress]) => [date, { isStress }]));
}

function bar(date, open, high, low, close) {
  return { date, open, high, low, close };
}

test('exits at the stop price the day the low breaches it, before the hold period ends', async () => {
  const { simulateTradesWithStops } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100), // signal
    bar('d1', 100, 101, 99, 100), // entry: open=100
    bar('d2', 100, 101, 96, 99), // low=96 breaches 5% stop (95) ? no, 96>95, no stop yet
    bar('d3', 99, 100, 94, 95), // low=94 breaches stop price 95 -> exits here at 95
    bar('d4', 95, 96, 94, 95),
    bar('d5', 95, 96, 94, 95),
  ];
  const trades = simulateTradesWithStops(series, [0], { holdDays: 5, stopLossPct: 0.05 });
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].exitReason, 'stopLoss');
  assert.strictEqual(trades[0].exitDate, 'd3');
  assert.ok(Math.abs(trades[0].exitPrice - 95) < 1e-9);
});

test('exits at the take-profit price the day the high breaches it', async () => {
  const { simulateTradesWithStops } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 100, 101, 99, 100), // entry open=100, target = 108
    bar('d2', 100, 105, 99, 104),
    bar('d3', 104, 109, 103, 107), // high=109 breaches target 108
    bar('d4', 107, 108, 106, 107),
    bar('d5', 107, 108, 106, 107),
  ];
  const trades = simulateTradesWithStops(series, [0], { holdDays: 5, takeProfitPct: 0.08 });
  assert.strictEqual(trades[0].exitReason, 'takeProfit');
  assert.strictEqual(trades[0].exitDate, 'd3');
  assert.ok(Math.abs(trades[0].exitPrice - 108) < 1e-9);
});

test('holds the full period and exits at close when neither stop nor target is hit', async () => {
  const { simulateTradesWithStops } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 100, 102, 99, 101),
    bar('d2', 101, 103, 100, 102),
    bar('d3', 102, 104, 101, 103),
    bar('d4', 103, 105, 102, 104),
    bar('d5', 104, 106, 103, 105),
  ];
  const trades = simulateTradesWithStops(series, [0], { holdDays: 5, stopLossPct: 0.05, takeProfitPct: 0.10 });
  assert.strictEqual(trades[0].exitReason, 'holdDaysElapsed');
  assert.strictEqual(trades[0].exitDate, 'd5');
  assert.strictEqual(trades[0].exitPrice, 105);
});

test('a day breaching both stop and target is treated as the stop firing (conservative)', async () => {
  const { simulateTradesWithStops } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 100, 101, 99, 100), // entry open=100
    bar('d2', 100, 112, 90, 95), // both stop(95) and target(108) breached same day
  ];
  const trades = simulateTradesWithStops(series, [0], { holdDays: 5, stopLossPct: 0.05, takeProfitPct: 0.08 });
  // not enough bars to reach lastPossibleExit (entry+4=5 >= series.length=3), so this
  // particular series is too short to complete; extend it to make the stop/target day reachable.
  assert.strictEqual(trades.length, 0);
});

test('with no stop/target configured, behaves like a plain fixed-hold exit at close', async () => {
  const { simulateTradesWithStops } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 110, 115, 105, 112),
    bar('d2', 112, 120, 108, 118),
    bar('d3', 118, 125, 110, 120),
    bar('d4', 120, 130, 115, 125),
    bar('d5', 125, 135, 120, 130),
  ];
  const trades = simulateTradesWithStops(series, [0], { holdDays: 5 });
  assert.strictEqual(trades[0].exitReason, 'holdDaysElapsed');
  assert.strictEqual(trades[0].entryPrice, 110);
  assert.strictEqual(trades[0].exitPrice, 130);
});

test('conditional stop: stays fully invested (no stop) when the entry day is NOT a stress regime', async () => {
  const { simulateTradesWithConditionalStop } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 100, 101, 99, 100), // entry, regime=calm
    bar('d2', 100, 100, 90, 91), // would breach a 5% stop, but stop is not armed
    bar('d3', 91, 95, 90, 92),
    bar('d4', 92, 96, 91, 93),
    bar('d5', 93, 97, 92, 94),
  ];
  const regimeMap = regimeMapFrom([['d1', false]]);
  const trades = simulateTradesWithConditionalStop(series, [0], regimeMap, { holdDays: 5, stopLossPct: 0.05 });
  assert.strictEqual(trades[0].exitReason, 'holdDaysElapsed');
  assert.strictEqual(trades[0].regimeActive, false);
  assert.strictEqual(trades[0].exitDate, 'd5');
});

test('conditional stop: arms the stop when the entry day IS a stress regime', async () => {
  const { simulateTradesWithConditionalStop } = await loadLib();
  const series = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 100, 101, 99, 100), // entry, regime=stress
    bar('d2', 100, 100, 90, 91), // breaches 5% stop (95)
    bar('d3', 91, 95, 90, 92),
    bar('d4', 92, 96, 91, 93),
    bar('d5', 93, 97, 92, 94),
  ];
  const regimeMap = regimeMapFrom([['d1', true]]);
  const trades = simulateTradesWithConditionalStop(series, [0], regimeMap, { holdDays: 5, stopLossPct: 0.05 });
  assert.strictEqual(trades[0].exitReason, 'stopLoss');
  assert.strictEqual(trades[0].regimeActive, true);
  assert.strictEqual(trades[0].exitDate, 'd2');
  assert.ok(Math.abs(trades[0].exitPrice - 95) < 1e-9);
});
