// Combinatorially Symmetric Cross-Validation / Probability of Backtest
// Overfitting (Bailey, Borwein, Lopez de Prado & Zhu, 2014). Given each
// candidate strategy's performance (Sharpe ratio, or any per-period score)
// across the same S sub-periods, PBO answers: across every way of splitting
// those periods into an in-sample half and an out-of-sample half, how often
// does "whichever strategy looked best in-sample" turn out to be a below-
// median performer out-of-sample?

function combinations(items, k) {
  const results = [];
  function recurse(start, combo) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      combo.push(items[i]);
      recurse(i + 1, combo);
      combo.pop();
    }
  }
  recurse(0, []);
  return results;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// scoresByStrategy: array of { name, scores: number[] } — all `scores` arrays
// must be the same length S (one score per sub-period, e.g. per-window Sharpe).
export function computePBO(scoresByStrategy) {
  const numStrategies = scoresByStrategy.length;
  const numPeriods = scoresByStrategy[0].scores.length;
  const half = Math.floor(numPeriods / 2);
  const allPeriods = Array.from({ length: numPeriods }, (_, i) => i);
  const isCombos = combinations(allPeriods, half);

  const splits = [];
  for (const isIdx of isCombos) {
    const oosIdx = allPeriods.filter((i) => !isIdx.includes(i));

    const isMeans = scoresByStrategy.map((s) => mean(isIdx.map((i) => s.scores[i])));
    const oosMeans = scoresByStrategy.map((s) => mean(oosIdx.map((i) => s.scores[i])));

    let bestIdx = 0;
    for (let i = 1; i < numStrategies; i++) {
      if (isMeans[i] > isMeans[bestIdx]) bestIdx = i;
    }

    const sortedOOS = [...oosMeans].sort((a, b) => a - b);
    const rank = sortedOOS.indexOf(oosMeans[bestIdx]) + 1; // 1-based ascending rank
    const omega = rank / (numStrategies + 1);
    const logit = Math.log(omega / (1 - omega));

    splits.push({
      isPeriods: isIdx,
      oosPeriods: oosIdx,
      selectedStrategy: scoresByStrategy[bestIdx].name,
      oosRank: rank,
      logit,
      underperformedOOS: logit <= 0,
    });
  }

  const pbo = splits.filter((s) => s.underperformedOOS).length / splits.length;
  return { pbo, splits };
}
