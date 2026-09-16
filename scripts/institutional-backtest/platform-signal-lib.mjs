// Pure helper: turns a SignalEngine state series into discrete "signal day" events
// (the day the state first flips to BUY), which run-backtest's simulateTrades/summarize
// (from signal-lib.mjs) can then turn into fixed-holding-period trades.

export function detectBuySignalTransitions(states) {
  const signals = [];
  for (let i = 0; i < states.length; i++) {
    const prev = i === 0 ? null : states[i - 1];
    if (states[i] === 'BUY' && prev !== 'BUY') {
      signals.push(i);
    }
  }
  return signals;
}
