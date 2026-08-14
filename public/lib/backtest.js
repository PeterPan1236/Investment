/**
 * Long/flat backtest of the signal engine, net of realistic Taiwan and crypto
 * trading costs.
 *
 * Rules that keep the result honest:
 *  - the state read at bar t is only traded from bar t+1, so no bar's own close
 *    is used to decide the position that captures it;
 *  - SELL means flat, not short, matching what the UI actually recommends;
 *  - buy-and-hold pays entry and exit costs too, so the comparison is fair.
 */
(function (global) {
  const COST_MODELS = {
    tw: {
      label: '台股',
      buyCost: 0.001425,
      sellCost: 0.001425 + 0.003,
      note: '手續費 0.1425%（未折扣）＋ 賣出證交稅 0.3%'
    },
    crypto: {
      label: 'Crypto',
      buyCost: 0.001,
      sellCost: 0.001,
      note: '交易所 taker 費率 0.1%（雙邊）'
    }
  };

  function costModelFor(symbol = '', type = '') {
    if (type === 'crypto' || /-USD$/i.test(symbol)) return { key: 'crypto', ...COST_MODELS.crypto };
    return { key: 'tw', ...COST_MODELS.tw };
  }

  function sliceByDate(points, fromMs, toMs) {
    return points.filter(point => {
      if (Number.isFinite(fromMs) && point.timestamp < fromMs) return false;
      if (Number.isFinite(toMs) && point.timestamp > toMs) return false;
      return true;
    });
  }

  function summarize(equityCurve, returns) {
    const totalReturn = equityCurve.length > 1 ? equityCurve[equityCurve.length - 1] / equityCurve[0] - 1 : 0;
    return {
      totalReturn,
      annualizedReturn: TA.annualizedReturn(equityCurve),
      annualizedVolatility: TA.annualizedVolatility(returns),
      sharpe: TA.sharpeRatio(returns),
      maxDrawdown: TA.maxDrawdown(equityCurve)
    };
  }

  function runBacktest({ points = [], symbol = '', type = '', from = null, to = null } = {}) {
    const ready = sliceByDate(points.filter(point => point.ready), from, to);
    if (ready.length < 40) {
      return { available: false, reason: `回測需要至少 40 根可用日線，目前只有 ${ready.length} 根。` };
    }

    const costs = costModelFor(symbol, type);
    const timestamps = [];
    const strategyEquity = [1];
    const holdEquity = [1];
    const strategyReturns = [];
    const holdReturns = [];
    const grossEquityTrack = [1];
    const trades = [];

    let position = 0;
    let grossEquity = 1;
    let netEquity = 1;
    let holdValue = 1 - costs.buyCost;
    let entryPrice = null;
    let entryTimestamp = null;
    let turnover = 0;
    let totalCost = 0;
    let barsInMarket = 0;

    timestamps.push(ready[0].timestamp);

    for (let i = 1; i < ready.length; i += 1) {
      const previous = ready[i - 1];
      const current = ready[i];
      const barReturn = (current.close - previous.close) / previous.close;
      // Position for this bar was decided on the previous bar's close.
      const targetPosition = previous.state === 'BUY' ? 1 : 0;

      if (targetPosition !== position) {
        const cost = targetPosition > position ? costs.buyCost : costs.sellCost;
        const traded = Math.abs(targetPosition - position);
        netEquity *= 1 - cost * traded;
        totalCost += cost * traded;
        turnover += traded;

        if (targetPosition === 1) {
          entryPrice = previous.close;
          entryTimestamp = previous.timestamp;
        } else if (entryPrice != null) {
          trades.push({
            entryTimestamp,
            exitTimestamp: previous.timestamp,
            entryPrice,
            exitPrice: previous.close,
            grossReturn: previous.close / entryPrice - 1,
            netReturn: (previous.close / entryPrice) * (1 - costs.buyCost) * (1 - costs.sellCost) - 1
          });
          entryPrice = null;
          entryTimestamp = null;
        }
        position = targetPosition;
      }

      const appliedReturn = barReturn * position;
      const equityBefore = netEquity;
      netEquity *= 1 + appliedReturn;
      grossEquity *= 1 + appliedReturn;
      holdValue *= 1 + barReturn;
      if (position === 1) barsInMarket += 1;

      timestamps.push(current.timestamp);
      strategyEquity.push(netEquity);
      grossEquityTrack.push(grossEquity);
      holdEquity.push(holdValue);
      strategyReturns.push(equityBefore ? netEquity / equityBefore - 1 : 0);
      holdReturns.push(barReturn);
    }

    // Both series are marked to a liquidation so neither hides an exit cost.
    const finalStrategy = position === 1 ? netEquity * (1 - costs.sellCost) : netEquity;
    const finalHold = holdValue * (1 - costs.sellCost);
    strategyEquity[strategyEquity.length - 1] = finalStrategy;
    holdEquity[holdEquity.length - 1] = finalHold;

    if (position === 1 && entryPrice != null) {
      const lastPoint = ready[ready.length - 1];
      trades.push({
        entryTimestamp,
        exitTimestamp: lastPoint.timestamp,
        entryPrice,
        exitPrice: lastPoint.close,
        grossReturn: lastPoint.close / entryPrice - 1,
        netReturn: (lastPoint.close / entryPrice) * (1 - costs.buyCost) * (1 - costs.sellCost) - 1,
        open: true
      });
    }

    const years = Math.max((ready[ready.length - 1].timestamp - ready[0].timestamp) / (365.25 * 86400000), 1 / 365.25);
    const strategy = summarize(strategyEquity, strategyReturns);
    const hold = summarize(holdEquity, holdReturns);
    const winners = trades.filter(trade => trade.netReturn > 0);

    return {
      available: true,
      symbol,
      costs,
      from: ready[0].timestamp,
      to: ready[ready.length - 1].timestamp,
      bars: ready.length,
      years,
      timestamps,
      strategyEquity,
      holdEquity,
      strategy,
      hold,
      excessReturn: strategy.totalReturn - hold.totalReturn,
      beatsBuyAndHold: strategy.totalReturn > hold.totalReturn,
      trades,
      tradeCount: trades.length,
      winRate: trades.length ? winners.length / trades.length : null,
      turnover,
      turnoverPerYear: turnover / years,
      totalCostDrag: totalCost,
      grossTotalReturn: grossEquityTrack[grossEquityTrack.length - 1] - 1,
      costDragReturn: (grossEquityTrack[grossEquityTrack.length - 1] - 1) - strategy.totalReturn,
      timeInMarket: barsInMarket / Math.max(ready.length - 1, 1)
    };
  }

  global.Backtest = { runBacktest, costModelFor, COST_MODELS };
}(window));
