/**
 * Screener universe, per-name review state, and criteria evaluation.
 *
 * This replaces the old "Top 10 picks" list. The universe below is a
 * watchlist, not a recommendation: nothing is ranked by conviction, the
 * qualitative notes carry an explicit review date, and what the user sees is
 * whatever passes the criteria they set.
 *
 * The imported notes have no verifiable authoring date, so every entry starts
 * with `reviewedAt: null` and is reported as needing review until the user reviews it.
 * Entry price and levels are user-owned data held in localStorage.
 */
(function (global) {
  const STORAGE_KEY = 'investment_screener_review_v1';
  const STALE_AFTER_DAYS = 90;
  const MINIMUM_VOLATILITY_SAMPLE = 20;

  const UNIVERSE = [
    {
      symbol: '2330.TW', name: 'TSMC', english: 'TSMC', type: 'stock', market: 'TWSE',
      currency: 'TWD', horizon: '1–3 years', liquidityStars: 5,
      thesis: [
        'Leading-edge process and advanced packaging capacity is the main bottleneck for AI accelerators, and foundry share is concentrated',
        'Process-node lead and gross-margin structure have stayed ahead of peers for years',
        'High foreign ownership and large daily turnover keep entry and exit slippage low'
      ],
      risk: 'Geopolitics (Taiwan Strait risk) and US-China export controls',
      invalidation: 'Advanced packaging utilization swings into oversupply, or a major customer cuts accelerator orders by more than 15%'
    },
    {
      symbol: '2454.TW', name: 'MediaTek', english: 'MediaTek', type: 'stock', market: 'TWSE',
      currency: 'TWD', horizon: '1–3 years', liquidityStars: 4,
      thesis: [
        'Mobile chip share sits with a handful of suppliers, with emerging-market shipments as the main driver',
        'On-device AI inference plus automotive and IoT diversify revenue',
        'Stable cash dividend policy and a consistent shareholder-return record'
      ],
      risk: 'Cyclical swings in the mid- and low-end handset market, plus competition from Qualcomm',
      invalidation: 'Flagship silicon loses a design win at a major customer, or mobile revenue falls year over year for two consecutive quarters'
    },
    {
      symbol: '2317.TW', name: 'Hon Hai', english: 'Hon Hai', type: 'stock', market: 'TWSE',
      currency: 'TWD', horizon: '1–2 years', liquidityStars: 4,
      thesis: [
        'Leading scale in AI server rack assembly, with order visibility driving the valuation',
        'The EV contract-manufacturing platform is a long-term transformation option',
        'A below-peer P/E with dividend yield providing support'
      ],
      risk: 'Concentration risk in Apple orders and a slipping EV production timeline',
      invalidation: 'AI server revenue share stops growing, or EV mass production slips more than another year'
    },
    {
      symbol: '2382.TW', name: 'Quanta Computer', english: 'Quanta Computer', type: 'stock', market: 'TWSE',
      currency: 'TWD', horizon: '1–2 years', liquidityStars: 4,
      thesis: [
        'Share of hyperscaler AI server manufacturing is the main growth source',
        'Rack-level system shipments lift both ASP and product mix',
        'Still trades at a discount to AI peers'
      ],
      risk: 'Customers are concentrated in a few hyperscalers, so a slowdown in AI capex hits hard',
      invalidation: 'A major cloud customer cuts capex guidance, or a peer takes over its manufacturing share'
    },
    {
      symbol: '2308.TW', name: 'Delta Electronics', english: 'Delta Electronics', type: 'stock', market: 'TWSE',
      currency: 'TWD', horizon: '2–3 years', liquidityStars: 3,
      thesis: [
        'Data-center power and thermal management benefit directly from compute expansion',
        'EV charging and industrial automation provide a second growth curve',
        'Own-brand design carries better gross margins than pure contract manufacturing'
      ],
      risk: 'Raw-material cost swings and uncertain subsidy policy in the EV charging market',
      invalidation: 'Power-business gross margin falls for two consecutive quarters, or data-center order growth turns negative'
    },
    {
      symbol: 'BTC-USD', name: 'Bitcoin', english: 'Bitcoin', type: 'crypto', market: 'Crypto',
      currency: 'USD', horizon: '2–4 years', liquidityStars: 5,
      thesis: [
        'The spot ETF channel lowers the friction cost of institutional allocation',
        'A declining issuance rate with a store-of-value narrative',
        'The deepest liquidity in the market, executable at any size'
      ],
      risk: 'Abrupt regulatory shifts and cyclical sentiment drawdowns of 40–80%',
      invalidation: 'Sustained ETF net outflows alongside a break below the 200-day average, or a major jurisdiction restricting institutional holdings'
    },
    {
      symbol: 'ETH-USD', name: 'Ethereum', english: 'Ethereum', type: 'crypto', market: 'Crypto',
      currency: 'USD', horizon: '2–3 years', liquidityStars: 5,
      thesis: [
        'Staking yield and fee burning regulate the supply side',
        'The Layer 2 ecosystem is the main source of on-chain activity',
        'Market depth improved after spot ETFs were approved'
      ],
      risk: 'Competing chains eroding developer share and delayed protocol upgrades',
      invalidation: 'On-chain fee revenue and L2 settlement volume fall for two consecutive quarters, or staking yield drops below the risk-free rate'
    }
  ];

  /**
   * The universe carries at most this many crypto names. Crypto correlations
   * are high enough that a longer list adds volatility without adding
   * diversification, so the two deepest-liquidity names stand in for the asset
   * class and the cap is enforced rather than left to editing discipline.
   */
  const MAX_CRYPTO = 2;

  const CRITERIA_DEFAULTS = {
    market: 'all',
    minLiquidity: 3,
    maxVolatility: 1.2,
    signal: 'all',
    trendFilter: 'all',
    hideStale: false
  };

  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (error) {
      return false;
    }
  }

  function getReview(symbol) {
    const record = readStore()[symbol] || {};
    return {
      entryDate: record.entryDate || null,
      entryPrice: Number.isFinite(Number(record.entryPrice)) ? Number(record.entryPrice) : null,
      target: Number.isFinite(Number(record.target)) ? Number(record.target) : null,
      stop: Number.isFinite(Number(record.stop)) ? Number(record.stop) : null,
      invalidation: record.invalidation || null,
      reviewedAt: record.reviewedAt || null
    };
  }

  function saveReview(symbol, patch) {
    const store = readStore();
    store[symbol] = { ...(store[symbol] || {}), ...patch };
    writeStore(store);
    return getReview(symbol);
  }

  function clearReview(symbol) {
    const store = readStore();
    delete store[symbol];
    writeStore(store);
  }

  function daysSince(dateString) {
    if (!dateString) return null;
    const parsed = Date.parse(dateString);
    if (!Number.isFinite(parsed)) return null;
    return Math.floor((Date.now() - parsed) / 86400000);
  }

  /**
   * A thesis with no review date is treated exactly like an expired one: the
   * user cannot tell whether it was written yesterday or two years ago, which
   * is the failure mode this flag exists to prevent.
   */
  function reviewStatus(review) {
    const age = daysSince(review.reviewedAt);
    if (age == null) {
      return { state: 'unreviewed', label: 'Needs review', detail: 'No review date recorded', ageDays: null };
    }
    if (age > STALE_AFTER_DAYS) {
      return { state: 'stale', label: 'Needs review', detail: `${age} days since last review`, ageDays: age };
    }
    return { state: 'fresh', label: 'Reviewed', detail: `Reviewed ${age} days ago`, ageDays: age };
  }

  /** Merge the static universe with live analytics and user-entered levels. */
  function buildRows({ universe = UNIVERSE, seriesMap = {}, signalsBySymbol = {}, fxRate = null, base = 'TWD' } = {}) {
    return universe.map(item => {
      const series = seriesMap[item.symbol];
      const bars = series?.data || [];
      const closes = bars.map(bar => Number(bar.adjClose ?? bar.close)).filter(Number.isFinite);
      const lastClose = closes.length ? closes[closes.length - 1] : null;
      const signal = signalsBySymbol[item.symbol] || null;
      const review = getReview(item.symbol);
      const status = reviewStatus(review);
      const isUsdQuoted = item.currency === 'USD';

      const convert = value => {
        if (!Number.isFinite(value)) return null;
        if (!fxRate) return isUsdQuoted === (base === 'USD') ? value : null;
        if (base === 'TWD') return isUsdQuoted ? value * fxRate : value;
        return isUsdQuoted ? value : value / fxRate;
      };

      // An empty return series yields 0, which reads as "this name does not
      // move" while history is still loading. Unknown must stay unknown.
      const returns = TA.simpleReturns(closes);
      const volatility = returns.length >= MINIMUM_VOLATILITY_SAMPLE
        ? TA.annualizedVolatility(returns)
        : null;
      const sinceReturn = review.entryPrice && lastClose ? lastClose / review.entryPrice - 1 : null;
      const toTarget = review.target && lastClose ? review.target / lastClose - 1 : null;
      const toStop = review.stop && lastClose ? review.stop / lastClose - 1 : null;

      return {
        ...item,
        review,
        status,
        lastClose,
        lastCloseInBase: convert(lastClose),
        entryPriceInBase: convert(review.entryPrice),
        lastBarAt: bars.length ? bars[bars.length - 1].timestamp : null,
        volatility,
        signal,
        sinceReturn,
        toTarget,
        toStop,
        aboveSlowMa: signal?.point?.maSlow != null && signal.point.close != null
          ? signal.point.close > signal.point.maSlow
          : null,
        hasData: Boolean(lastClose)
      };
    });
  }

  /** Keep the first MAX_CRYPTO crypto rows; universe order is liquidity order. */
  function capCrypto(rows, limit = MAX_CRYPTO) {
    let kept = 0;
    return rows.filter(row => {
      if (row.type !== 'crypto') return true;
      kept += 1;
      return kept <= limit;
    });
  }

  function applyCriteria(rows, criteria) {
    const settings = { ...CRITERIA_DEFAULTS, ...criteria };
    const passed = rows.filter(row => {
      if (settings.market === 'tw' && row.type !== 'stock') return false;
      if (settings.market === 'crypto' && row.type !== 'crypto') return false;
      if (row.liquidityStars < settings.minLiquidity) return false;
      if (settings.hideStale && row.status.state !== 'fresh') return false;
      if (Number.isFinite(row.volatility) && row.volatility > settings.maxVolatility) return false;
      if (settings.signal !== 'all' && row.signal?.state !== settings.signal) return false;
      if (settings.trendFilter === 'above' && row.aboveSlowMa !== true) return false;
      if (settings.trendFilter === 'below' && row.aboveSlowMa !== false) return false;
      return true;
    });
    return capCrypto(passed);
  }

  global.Screener = {
    UNIVERSE,
    MAX_CRYPTO,
    CRITERIA_DEFAULTS,
    STALE_AFTER_DAYS,
    STORAGE_KEY,
    getReview,
    saveReview,
    clearReview,
    reviewStatus,
    buildRows,
    applyCriteria,
    symbols: () => UNIVERSE.map(item => item.symbol)
  };
}(window));
