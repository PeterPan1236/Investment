/**
 * Screener universe, per-name review state, and criteria evaluation.
 *
 * This replaces the old "Top 10 推薦標的" list. The universe below is a
 * watchlist, not a recommendation: nothing is ranked by conviction, the
 * qualitative notes carry an explicit review date, and what the user sees is
 * whatever passes the criteria they set.
 *
 * The imported notes have no verifiable authoring date, so every entry starts
 * with `reviewedAt: null` and is reported as 待覆核 until the user reviews it.
 * Entry price and levels are user-owned data held in localStorage.
 */
(function (global) {
  const STORAGE_KEY = 'investment_screener_review_v1';
  const STALE_AFTER_DAYS = 90;

  const UNIVERSE = [
    {
      symbol: '2330.TW', name: '台積電', english: 'TSMC', type: 'stock', market: '上市',
      currency: 'TWD', horizon: '1–3 年', liquidityStars: 5,
      thesis: [
        '先進製程與先進封裝產能為 AI 加速器的主要瓶頸，代工市占集中',
        '製程節點領先幅度與毛利率結構長期優於同業',
        '外資持股比重高、日均成交金額大，進出滑價低'
      ],
      risk: '地緣政治（台海風險）、美中科技戰出口管制',
      invalidation: '先進封裝產能利用率轉為過剩、或主要客戶下修加速器訂單逾 15%'
    },
    {
      symbol: '2454.TW', name: '聯發科', english: 'MediaTek', type: 'stock', market: '上市',
      currency: 'TWD', horizon: '1–3 年', liquidityStars: 4,
      thesis: [
        '行動晶片市占集中於少數供應商，新興市場出貨為主要動能',
        '端側 AI 推論與車用／IoT 為營收多角化方向',
        '現金股利政策穩定，股東回饋紀錄一致'
      ],
      risk: '中低階手機市場週期性波動、競爭來自高通',
      invalidation: '旗艦晶片在主要客戶的設計導入被競爭者取代，或行動業務營收連兩季年減'
    },
    {
      symbol: '2317.TW', name: '鴻海', english: 'Hon Hai', type: 'stock', market: '上市',
      currency: 'TWD', horizon: '1–2 年', liquidityStars: 4,
      thesis: [
        'AI 伺服器機櫃組裝規模領先，訂單能見度為主要評價驅動',
        'EV 代工平台為長期轉型選項',
        '相對同業本益比偏低、股利率具支撐'
      ],
      risk: '蘋果訂單集中風險、EV 量產時間表落後',
      invalidation: 'AI 伺服器營收佔比停止成長，或 EV 量產時程再度遞延超過一年'
    },
    {
      symbol: '2382.TW', name: '廣達', english: 'Quanta Computer', type: 'stock', market: '上市',
      currency: 'TWD', horizon: '1–2 年', liquidityStars: 4,
      thesis: [
        '雲端業者 AI 伺服器代工份額為主要成長來源',
        '機櫃級整機出貨帶動單價與產品組合提升',
        '相對 AI 同業評價仍有折價'
      ],
      risk: '客戶集中於少數雲端業者，AI 資本支出週期放緩衝擊大',
      invalidation: '主要雲端客戶下修資本支出指引，或代工份額被同業取代'
    },
    {
      symbol: '2308.TW', name: '台達電', english: 'Delta Electronics', type: 'stock', market: '上市',
      currency: 'TWD', horizon: '2–3 年', liquidityStars: 3,
      thesis: [
        '資料中心電源與散熱為算力擴張的直接受惠環節',
        'EV 充電與工業自動化提供第二成長曲線',
        '自有品牌設計的毛利率結構優於純代工'
      ],
      risk: '原物料成本波動、EV 充電市場補貼政策不確定性',
      invalidation: '電源事業毛利率連兩季下滑，或資料中心訂單成長轉負'
    },
    {
      symbol: 'BTC-USD', name: '比特幣', english: 'Bitcoin', type: 'crypto', market: 'Crypto',
      currency: 'USD', horizon: '2–4 年', liquidityStars: 5,
      thesis: [
        '現貨 ETF 通道使機構配置的摩擦成本下降',
        '供給發行率遞減，敘事以價值儲存為主',
        '全球流動性最深，任何規模皆可執行'
      ],
      risk: '監管政策驟變、市場情緒週期性暴跌 40–80%',
      invalidation: 'ETF 連續淨流出且跌破 200 日均線，或主要司法管轄區限制機構持有'
    },
    {
      symbol: 'ETH-USD', name: '以太幣', english: 'Ethereum', type: 'crypto', market: 'Crypto',
      currency: 'USD', horizon: '2–3 年', liquidityStars: 5,
      thesis: [
        '質押收益與手續費燃燒機制構成供給面調節',
        'Layer 2 生態為主要鏈上活動來源',
        '現貨 ETF 開放後市場深度改善'
      ],
      risk: '競爭鏈侵蝕開發者市占、技術升級延遲',
      invalidation: '鏈上手續費收入與 L2 結算量連續兩季下滑，或質押收益率跌破無風險利率'
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
      return { state: 'unreviewed', label: '待覆核', detail: '未標註覆核日期', ageDays: null };
    }
    if (age > STALE_AFTER_DAYS) {
      return { state: 'stale', label: '待覆核', detail: `已 ${age} 天未覆核`, ageDays: age };
    }
    return { state: 'fresh', label: '已覆核', detail: `${age} 天前覆核`, ageDays: age };
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

      const volatility = TA.annualizedVolatility(TA.simpleReturns(closes));
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
