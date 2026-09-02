/**
 * Signal engine.
 *
 * Directional calls require agreement across three horizons (20 / 60 / 120 day)
 * and are gated by ADX so the model stays flat in ranging markets instead of
 * whipsawing on a single short moving-average crossover. Confidence is a
 * computed 0-100 number, not a hand-assigned label.
 *
 * News sentiment is deliberately excluded from the historical series: there is
 * no point-in-time headline archive, so including it would make the published
 * hit rate look better than it could ever have been in real time. It is applied
 * only as a tilt to the latest reading, and reported separately.
 */
(function (global) {
  const MA_FAST = 20;
  const MA_MID = 60;
  const MA_SLOW = 120;
  const ADX_PERIOD = 14;
  const ADX_TREND_FLOOR = 20;
  const ATR_PERIOD = 14;
  const VOLUME_PERIOD = 20;
  const MAX_PRICE_SCORE = 6;
  const ENTRY_SIGNAL_STATES = { BUY: 1, HOLD: 0, SELL: -1 };

  const POSITIVE_TERMS = [
    'growth', 'profit', 'beat', 'beats', 'upgrade', 'bullish', 'record', 'revenue',
    'earnings', 'buyback', 'dividend', 'partnership', 'approval', 'demand', 'strong',
    'outperform', 'raise', 'surge', 'rally', '成長', '獲利', '優於', '調升', '看多',
    '利多', '創新高', '營收', '股利', '合作', '批准', '需求', '強勁', '上漲'
  ];
  const NEGATIVE_TERMS = [
    'loss', 'miss', 'downgrade', 'bearish', 'lawsuit', 'probe', 'recall', 'delay',
    'weak', 'cut', 'slump', 'fall', 'drop', 'risk', 'warning', 'tariff', 'sanction',
    'decline', '虧損', '低於', '調降', '看空', '利空', '訴訟', '調查', '召回',
    '延遲', '疲弱', '下修', '下跌', '風險', '警告', '關稅', '制裁', '衰退'
  ];

  /** Per-headline sentiment so the news list can show the tag that feeds the signal. */
  function scoreHeadline(item) {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const positive = POSITIVE_TERMS.filter(term => text.includes(term.toLowerCase())).length;
    const negative = NEGATIVE_TERMS.filter(term => text.includes(term.toLowerCase())).length;
    const net = positive - negative;
    return {
      positive,
      negative,
      net,
      tone: net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'
    };
  }

  /**
   * Yahoo's per-symbol news feed mixes in unrelated market wire stories, so a
   * headline only feeds sentiment when it actually names the asset. The rest
   * stay visible but are labelled as general market noise.
   */
  function isRelevant(item, keywords = []) {
    if (!keywords.length) return true;
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    return keywords.some(keyword => keyword && text.includes(String(keyword).toLowerCase()));
  }

  function relevanceKeywords(asset = {}) {
    const root = String(asset.symbol || '').replace(/\.(TW|TWO)$/i, '').replace(/-USD$/i, '');
    return [asset.symbol, root, asset.name, asset.english].filter(Boolean);
  }

  function scoreNews(news = [], keywords = []) {
    const tagged = news.map(item => ({ ...item, relevant: isRelevant(item, keywords) }));
    const scored = tagged
      .filter(item => item.relevant)
      .slice(0, 10)
      .map(item => ({ ...item, sentiment: scoreHeadline(item) }));
    const positiveCount = scored.filter(item => item.sentiment.tone === 'positive').length;
    const negativeCount = scored.filter(item => item.sentiment.tone === 'negative').length;

    let score = 0;
    if (positiveCount > negativeCount) score += 1;
    if (negativeCount > positiveCount) score -= 1;
    if (positiveCount >= negativeCount + 3) score += 1;
    if (negativeCount >= positiveCount + 3) score -= 1;

    // Freshness is reported for the whole feed, not only the scored subset, so
    // the panel can still show when news last arrived.
    const newestTimestamp = tagged.reduce((newest, item) => {
      const seconds = Number(item.providerPublishTime);
      return Number.isFinite(seconds) ? Math.max(newest, seconds * 1000) : newest;
    }, 0);

    return {
      score,
      positiveCount,
      negativeCount,
      counted: scored.length,
      skipped: tagged.length - scored.length,
      newestTimestamp: newestTimestamp || null,
      scored,
      tagged
    };
  }

  function stateFromScore(score, trendStrength) {
    if (trendStrength != null && trendStrength < ADX_TREND_FLOOR) return 'HOLD';
    if (score >= 3) return 'BUY';
    if (score <= -3) return 'SELL';
    return 'HOLD';
  }

  /**
   * Walk-forward series of signal states. Every bar is scored using only data
   * available up to that bar, so the same output can drive the chart overlay,
   * the hit-rate table and the backtester.
   */
  function computeSignalSeries(bars = []) {
    const usable = bars
      .filter(bar => Number.isFinite(Number(bar.adjClose ?? bar.close)))
      .map(bar => ({
        timestamp: Number(bar.timestamp),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.adjClose ?? bar.close),
        rawClose: Number(bar.close),
        volume: Number(bar.volume) || 0
      }));

    if (usable.length < MA_FAST + 5) {
      return { bars: usable, points: [], insufficient: true, minimumBars: MA_FAST + 5 };
    }

    const closes = usable.map(bar => bar.close);
    const volumes = usable.map(bar => bar.volume);
    const maFast = TA.sma(closes, MA_FAST);
    const maMid = TA.sma(closes, Math.min(MA_MID, usable.length));
    const maSlow = usable.length >= MA_SLOW ? TA.sma(closes, MA_SLOW) : new Array(usable.length).fill(null);
    const adxSeries = TA.adx(usable, ADX_PERIOD);
    const atrSeries = TA.atr(usable, ATR_PERIOD);
    const volumeAverage = TA.sma(volumes, VOLUME_PERIOD);
    const atrPercentSeries = atrSeries.map((value, index) => (value == null ? null : value / closes[index]));

    const points = usable.map((bar, index) => {
      const fast = maFast[index];
      const mid = maMid[index];
      const slow = maSlow[index];
      const trendStrength = adxSeries[index];
      const atrPercent = atrPercentSeries[index];
      const volumeRatio = volumeAverage[index] ? bar.volume / volumeAverage[index] : null;

      if (fast == null || mid == null) {
        return { ...bar, index, state: 'HOLD', score: 0, confidence: 0, ready: false, drivers: [] };
      }

      const drivers = [];
      let score = 0;

      if (slow != null) {
        if (fast > mid && mid > slow) {
          score += 2;
          drivers.push({
            key: 'alignment',
            weight: 2,
            text: `MA${MA_FAST} > MA${MA_MID} > MA${MA_SLOW}: all three timeframes aligned bullish`,
            zh: `MA${MA_FAST} > MA${MA_MID} > MA${MA_SLOW}：三個週期同向偏多`
          });
        } else if (fast < mid && mid < slow) {
          score -= 2;
          drivers.push({
            key: 'alignment',
            weight: -2,
            text: `MA${MA_FAST} < MA${MA_MID} < MA${MA_SLOW}: all three timeframes aligned bearish`,
            zh: `MA${MA_FAST} < MA${MA_MID} < MA${MA_SLOW}：三個週期同向偏空`
          });
        } else {
          drivers.push({
            key: 'alignment',
            weight: 0,
            text: `MA${MA_FAST}/${MA_MID}/${MA_SLOW} are not aligned, so no trend is established`,
            zh: `MA${MA_FAST}/${MA_MID}/${MA_SLOW} 未同向，趨勢尚未確立`
          });
        }

        if (bar.close > slow) {
          score += 1;
          drivers.push({
            key: 'longTerm',
            weight: 1,
            text: `Close is above MA${MA_SLOW} (long-term bullish structure)`,
            zh: `收盤價站上 MA${MA_SLOW}（長期多方結構）`
          });
        } else {
          score -= 1;
          drivers.push({
            key: 'longTerm',
            weight: -1,
            text: `Close is below MA${MA_SLOW} (long-term bearish structure)`,
            zh: `收盤價跌破 MA${MA_SLOW}（長期空方結構）`
          });
        }
      } else {
        if (fast > mid) {
          score += 1;
          drivers.push({
            key: 'alignment',
            weight: 1,
            text: `MA${MA_FAST} > MA${MA_MID} (fewer than ${MA_SLOW} days of history, so the long-term average is excluded)`,
            zh: `MA${MA_FAST} > MA${MA_MID}（歷史不足 ${MA_SLOW} 日，長期均線未納入）`
          });
        } else if (fast < mid) {
          score -= 1;
          drivers.push({
            key: 'alignment',
            weight: -1,
            text: `MA${MA_FAST} < MA${MA_MID} (fewer than ${MA_SLOW} days of history, so the long-term average is excluded)`,
            zh: `MA${MA_FAST} < MA${MA_MID}（歷史不足 ${MA_SLOW} 日，長期均線未納入）`
          });
        }
      }

      if (trendStrength != null) {
        if (trendStrength >= 25) {
          score += score >= 0 ? 1 : -1;
          drivers.push({
            key: 'adx',
            weight: 1,
            text: `ADX(${ADX_PERIOD}) = ${trendStrength.toFixed(1)}, trend strength is sufficient`,
            zh: `ADX(${ADX_PERIOD}) = ${trendStrength.toFixed(1)}，趨勢強度足夠`
          });
        } else if (trendStrength < ADX_TREND_FLOOR) {
          drivers.push({
            key: 'adx',
            weight: 0,
            text: `ADX(${ADX_PERIOD}) = ${trendStrength.toFixed(1)} < ${ADX_TREND_FLOOR}, treated as ranging, directional signal suppressed`,
            zh: `ADX(${ADX_PERIOD}) = ${trendStrength.toFixed(1)} < ${ADX_TREND_FLOOR}，判定為盤整，方向訊號被抑制`
          });
        } else {
          drivers.push({
            key: 'adx',
            weight: 0,
            text: `ADX(${ADX_PERIOD}) = ${trendStrength.toFixed(1)}, trend strength is neutral`,
            zh: `ADX(${ADX_PERIOD}) = ${trendStrength.toFixed(1)}，趨勢強度中性`
          });
        }
      }

      if (volumeRatio != null) {
        if (volumeRatio >= 1.5 && score > 0) {
          score += 1;
          drivers.push({
            key: 'volume',
            weight: 1,
            text: `Volume is ${volumeRatio.toFixed(2)}x the ${VOLUME_PERIOD}-day average, confirming the advance`,
            zh: `成交量為 ${VOLUME_PERIOD} 日均量的 ${volumeRatio.toFixed(2)} 倍，量能確認上攻`
          });
        } else if (volumeRatio >= 1.5 && score < 0) {
          score -= 1;
          drivers.push({
            key: 'volume',
            weight: -1,
            text: `Volume is ${volumeRatio.toFixed(2)}x the ${VOLUME_PERIOD}-day average, confirming selling pressure`,
            zh: `成交量為 ${VOLUME_PERIOD} 日均量的 ${volumeRatio.toFixed(2)} 倍，量能確認賣壓`
          });
        } else if (volumeRatio < 0.7) {
          drivers.push({
            key: 'volume',
            weight: 0,
            text: `Volume is only ${volumeRatio.toFixed(2)}x the ${VOLUME_PERIOD}-day average, so there is no volume confirmation`,
            zh: `成交量僅 ${VOLUME_PERIOD} 日均量的 ${volumeRatio.toFixed(2)} 倍，缺乏量能確認`
          });
        } else {
          drivers.push({
            key: 'volume',
            weight: 0,
            text: `Volume is ${volumeRatio.toFixed(2)}x the ${VOLUME_PERIOD}-day average`,
            zh: `成交量為 ${VOLUME_PERIOD} 日均量的 ${volumeRatio.toFixed(2)} 倍`
          });
        }
      }

      const state = stateFromScore(score, trendStrength);
      const volatilityRank = atrPercent == null
        ? null
        : TA.percentileRank(atrPercentSeries.slice(0, index + 1).filter(value => value != null), atrPercent);

      // High realized volatility widens the outcome distribution, so identical
      // score strength earns less confidence in a high-ATR regime.
      const strength = Math.min(Math.abs(score) / MAX_PRICE_SCORE, 1);
      const trendFactor = trendStrength == null ? 0.6 : TA.clamp((trendStrength - 10) / 25, 0, 1);
      const regimeFactor = volatilityRank == null ? 0.85 : TA.clamp(1 - volatilityRank * 0.4, 0.6, 1);
      const confidence = state === 'HOLD'
        ? Math.round(strength * trendFactor * regimeFactor * 40)
        : Math.round(strength * trendFactor * regimeFactor * 100);

      return {
        ...bar,
        index,
        state,
        score,
        confidence: TA.clamp(confidence, 0, 100),
        ready: true,
        drivers,
        maFast: fast,
        maMid: mid,
        maSlow: slow,
        adx: trendStrength,
        atr: atrSeries[index],
        atrPercent,
        volatilityRank,
        volumeRatio
      };
    });

    return { bars: usable, points, insufficient: false, minimumBars: MA_FAST + 5 };
  }

  /**
   * Every past state change, with the return earned between that flip and the
   * next one. This is what turns a signal into something a user can audit.
   */
  function signalHistory(points = []) {
    const ready = points.filter(point => point.ready);
    if (ready.length < 2) return { flips: [], stats: null };

    const flips = [];
    let previousState = ready[0].state;
    for (let i = 1; i < ready.length; i += 1) {
      const point = ready[i];
      if (point.state !== previousState) {
        flips.push({
          timestamp: point.timestamp,
          index: point.index,
          state: point.state,
          from: previousState,
          price: point.close,
          confidence: point.confidence
        });
        previousState = point.state;
      }
    }

    const lastPoint = ready[ready.length - 1];
    flips.forEach((flip, position) => {
      const exit = flips[position + 1];
      const exitPrice = exit ? exit.price : lastPoint.close;
      const rawReturn = (exitPrice - flip.price) / flip.price;
      const direction = ENTRY_SIGNAL_STATES[flip.state] ?? 0;
      flip.exitTimestamp = exit ? exit.timestamp : lastPoint.timestamp;
      flip.exitPrice = exitPrice;
      flip.holdingDays = Math.max(1, Math.round((flip.exitTimestamp - flip.timestamp) / 86400000));
      flip.priceReturn = rawReturn;
      // A SELL that is followed by a fall is a win, so directional signals are
      // scored against the direction they called.
      flip.signalReturn = direction === 0 ? null : rawReturn * direction;
      flip.open = !exit;
    });

    const directional = flips.filter(flip => flip.signalReturn != null && !flip.open);
    const wins = directional.filter(flip => flip.signalReturn > 0);
    const stats = directional.length
      ? {
        total: directional.length,
        wins: wins.length,
        hitRate: wins.length / directional.length,
        averageReturn: TA.mean(directional.map(flip => flip.signalReturn)),
        averageWin: wins.length ? TA.mean(wins.map(flip => flip.signalReturn)) : null,
        averageLoss: directional.length - wins.length
          ? TA.mean(directional.filter(flip => flip.signalReturn <= 0).map(flip => flip.signalReturn))
          : null,
        averageHoldingDays: TA.mean(directional.map(flip => flip.holdingDays)),
        buyCount: directional.filter(flip => flip.state === 'BUY').length,
        sellCount: directional.filter(flip => flip.state === 'SELL').length
      }
      : null;

    return { flips, stats };
  }

  const STATE_PRESENTATION = {
    BUY: { label: 'BUY / add', zhLabel: 'BUY / 加碼', tone: 'buy' },
    SELL: { label: 'SELL / trim', zhLabel: 'SELL / 減碼', tone: 'sell' },
    HOLD: { label: 'HOLD / wait', zhLabel: 'HOLD / 觀望', tone: 'hold' }
  };

  /** Latest reading plus the news tilt, packaged for the UI. */
  function latestSignal(series, news = [], asset = null) {
    const ready = series.points.filter(point => point.ready);
    const newsSentiment = scoreNews(news, asset ? relevanceKeywords(asset) : []);

    if (!ready.length) {
      return {
        state: 'HOLD',
        label: 'HOLD / not enough data',
        zhLabel: 'HOLD / 資料不足',
        tone: 'hold',
        confidence: 0,
        priceScore: 0,
        newsSentiment,
        drivers: [{
          key: 'data',
          weight: 0,
          text: `Not enough history (at least ${series.minimumBars} daily bars required)`,
          zh: `歷史資料不足（至少需要 ${series.minimumBars} 根日線）`
        }],
        point: null
      };
    }

    const point = ready[ready.length - 1];
    const presentation = STATE_PRESENTATION[point.state];
    // News never flips the state; it only nudges how much confidence the price
    // structure earns, and disagreement is shown rather than hidden.
    const agreement = point.state === 'BUY' ? newsSentiment.score : point.state === 'SELL' ? -newsSentiment.score : 0;
    const confidence = TA.clamp(Math.round(point.confidence + agreement * 5), 0, 100);

    const drivers = point.drivers.slice();
    if (newsSentiment.counted) {
      drivers.push({
        key: 'news',
        weight: newsSentiment.score,
        text: `News sentiment: ${newsSentiment.counted} headlines matched this instrument (${newsSentiment.positiveCount} positive / ${newsSentiment.negativeCount} negative)`
          + `${newsSentiment.skipped ? `, plus ${newsSentiment.skipped} broad-market headlines not counted` : ''}`
          + `${agreement < 0 ? '; it contradicts the price signal, so confidence is reduced' : agreement > 0 ? '; it agrees with the price signal, so confidence is raised' : ''}`,
        zh: `新聞情緒：${newsSentiment.counted} 則標題與此標的相關（${newsSentiment.positiveCount} 則正面 / ${newsSentiment.negativeCount} 則負面）`
          + `${newsSentiment.skipped ? `，另有 ${newsSentiment.skipped} 則泛市場新聞未計入` : ''}`
          + `${agreement < 0 ? '；與價格訊號相反，信心度下修' : agreement > 0 ? '；與價格訊號一致，信心度上修' : ''}`
      });
    } else {
      drivers.push({
        key: 'news',
        weight: 0,
        text: `News sentiment: no headline explicitly mentions this instrument${newsSentiment.skipped ? ` (${newsSentiment.skipped} broad-market headlines not counted)` : ''}, so only price structure is used`,
        zh: `新聞情緒：查無明確提及此標的的標題${newsSentiment.skipped ? `（${newsSentiment.skipped} 則泛市場新聞未計入）` : ''}，僅採用價格結構`
      });
    }

    return {
      state: point.state,
      label: presentation.label,
      zhLabel: presentation.zhLabel,
      tone: presentation.tone,
      confidence,
      priceConfidence: point.confidence,
      priceScore: point.score,
      newsSentiment,
      drivers,
      point
    };
  }

  global.SignalEngine = {
    MA_FAST,
    MA_MID,
    MA_SLOW,
    ADX_TREND_FLOOR,
    computeSignalSeries,
    signalHistory,
    latestSignal,
    scoreNews,
    scoreHeadline,
    relevanceKeywords,
    isRelevant
  };
}(window));
