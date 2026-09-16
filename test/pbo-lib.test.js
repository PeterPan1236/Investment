const test = require('node:test');
const assert = require('node:assert');

async function loadLib() {
  return import('../scripts/institutional-backtest/pbo-lib.mjs');
}

test('a strategy that is uniformly best in every period has PBO = 0', async () => {
  const { computePBO } = await loadLib();
  const scoresByStrategy = [
    { name: 'always-best', scores: [2, 2, 2, 2, 2, 2] },
    { name: 'always-worst', scores: [0, 0, 0, 0, 0, 0] },
    { name: 'middling', scores: [1, 1, 1, 1, 1, 1] },
  ];
  const { pbo } = computePBO(scoresByStrategy);
  assert.strictEqual(pbo, 0);
});

test('a strategy that is only good in-sample and bad out-of-sample gives PBO = 1', async () => {
  const { computePBO } = await loadLib();
  // "overfit" wins whichever periods it is fit on (in-sample) but is worst everywhere else.
  const scoresByStrategy = [
    { name: 'overfit', scores: [10, -10, 10, -10, 10, -10] },
    { name: 'stable', scores: [1, 1, 1, 1, 1, 1] },
  ];
  // In-sample mean of 'overfit' over any 3-period combo is either dominated by
  // the +10s or the -10s; when it wins in-sample (drew the +10 periods), its
  // out-of-sample periods are the -10 ones, so it loses OOS every time it wins IS.
  const { pbo, splits } = computePBO(scoresByStrategy);
  const timesOverfitWonIS = splits.filter((s) => s.selectedStrategy === 'overfit').length;
  assert.ok(timesOverfitWonIS > 0, 'overfit should win in-sample at least sometimes');
  const overfitWinsThatUnderperformOOS = splits.filter((s) => s.selectedStrategy === 'overfit' && s.underperformedOOS);
  assert.strictEqual(overfitWinsThatUnderperformOOS.length, timesOverfitWonIS);
});

test('with only 2 strategies, oosRank is always 1 or 2', async () => {
  const { computePBO } = await loadLib();
  const scoresByStrategy = [
    { name: 'a', scores: [1, 2, 3, 4] },
    { name: 'b', scores: [4, 3, 2, 1] },
  ];
  const { splits } = computePBO(scoresByStrategy);
  for (const s of splits) {
    assert.ok(s.oosRank === 1 || s.oosRank === 2);
  }
});

test('enumerates all C(numPeriods, floor(numPeriods/2)) in-sample splits', async () => {
  const { computePBO } = await loadLib();
  const scoresByStrategy = [
    { name: 'a', scores: [1, 2, 3, 4, 5, 6] },
    { name: 'b', scores: [6, 5, 4, 3, 2, 1] },
  ];
  const { splits } = computePBO(scoresByStrategy);
  assert.strictEqual(splits.length, 20); // C(6,3) = 20
});
