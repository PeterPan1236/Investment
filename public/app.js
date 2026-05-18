const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const suggestionList = document.getElementById('suggestionList');
const historyList = document.getElementById('historyList');
const itemSummary = document.getElementById('itemSummary');
const newsList = document.getElementById('newsList');
const timeTabs = document.getElementById('timeTabs');
const chartContainer = document.getElementById('chart');
const strategyPanel = document.getElementById('strategyPanel');

const HISTORY_KEY = 'investment_search_history';
let searchHistory = [];
let selectedItem = null;
let currentInterval = '1d';
let currentRange = '1mo';
let chartInstance = null;
let searchRequestId = 0;

const defaultState = {
  name: '',
  symbol: '',
  type: '',
  price: '--',
  change: '--',
  percent: '--',
  volume: '--',
  trend: '--'
};

function loadHistory() {
  try {
    searchHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch (error) {
    searchHistory = [];
  }
  searchHistory = Array.isArray(searchHistory) ? searchHistory : [];
  renderHistory();
}

function saveHistory(query) {
  if (!query) return;
  searchHistory = searchHistory.filter(item => item !== query);
  searchHistory.unshift(query);
  if (searchHistory.length > 30) searchHistory.length = 30;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory));
  renderHistory();
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function safeExternalUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch (error) {
    return '#';
  }
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!searchHistory.length) {
    historyList.innerHTML = '<div class="chip">尚無搜尋紀錄</div>';
    return;
  }

  searchHistory.forEach(query => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = query;
    chip.addEventListener('click', () => {
      searchInput.value = query;
      performSearch(query);
    });
    historyList.appendChild(chip);
  });
}

async function performSearch(query, { save = true } = {}) {
  const trimmed = query.trim();
  if (!trimmed) {
    searchRequestId += 1;
    suggestionList.innerHTML = '';
    return;
  }

  if (save) saveHistory(trimmed);

  const requestId = ++searchRequestId;
  let items = [];
  try {
    const response = await fetch(`/api/search?query=${encodeURIComponent(trimmed)}`);
    if (!response.ok) throw new Error(`Search failed with ${response.status}`);
    items = await response.json();
  } catch (error) {
    if (requestId !== searchRequestId) return;
    suggestionList.innerHTML = '<div class="suggestion-item">搜尋服務暫時無法使用，請稍後再試。</div>';
    return;
  }

  if (requestId !== searchRequestId) return;
  suggestionList.innerHTML = '';

  if (!items.length) {
    suggestionList.innerHTML = '<div class="suggestion-item">找不到符合的股票或 Crypto，請確認關鍵字。</div>';
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'suggestion-item';
    row.innerHTML = `
      <div class="symbol">${escapeHTML(item.symbol)}</div>
      <div class="info">
        <div><strong>${escapeHTML(item.name)}</strong> ${item.english ? `(${escapeHTML(item.english)})` : ''}</div>
        <div class="muted">${escapeHTML(item.type === 'crypto' ? 'Crypto' : item.market || 'Taiwan Stock')}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      selectItem(item);
    });
    suggestionList.appendChild(row);
  });
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function average(values) {
  const finiteValues = values.map(Number).filter(Number.isFinite);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function buildSummary(data = defaultState) {
  const displayName = escapeHTML(data.name || '尚未選擇標的');
  const symbol = escapeHTML(data.symbol || '--');
  const market = escapeHTML(data.market || (data.type === 'crypto' ? 'Crypto' : '--'));
  const price = escapeHTML(data.price);
  const change = escapeHTML(data.change);
  const percent = escapeHTML(data.percent);
  const volume = escapeHTML(data.volume);
  const trend = escapeHTML(data.trend);

  itemSummary.innerHTML = `
    <div class="summary-title">${displayName}</div>
    <div class="summary-row">
      <div class="summary-card">
        <strong>代號 / 市場</strong>
        <div class="value">${symbol} / ${market}</div>
      </div>
      <div class="summary-card">
        <strong>最新價格</strong>
        <div class="value">${price}</div>
      </div>
      <div class="summary-card">
        <strong>漲跌幅</strong>
        <div class="value">${change} (${percent})</div>
      </div>
      <div class="summary-card">
        <strong>成交量</strong>
        <div class="value">${volume}</div>
      </div>
      <div class="summary-card">
        <strong>技術趨勢</strong>
        <div class="value">${trend}</div>
      </div>
    </div>
  `;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-TW', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function calculateMA(values, period) {
  const result = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      result.push('-');
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const sum = slice.reduce((total, value) => total + value, 0);
    result.push((sum / period).toFixed(2));
  }
  return result;
}

function renderChart(data, selectedItem) {
  if (!data || !data.length) {
    chartContainer.innerHTML = '<div style="color: #94a3b8; padding: 34px;">目前無可用走勢資料，請稍後重新嘗試。</div>';
    return;
  }

  const categoryData = data.map(d => formatTime(d.timestamp));
  const values = data.map(d => [d.open, d.close, d.low, d.high]);
  const volume = data.map(d => d.volume || 0);
  const closeValues = data.map(d => d.close);

  const ma5 = calculateMA(closeValues, 5);
  const ma10 = calculateMA(closeValues, 10);
  const ma20 = calculateMA(closeValues, 20);

  if (!chartInstance) {
    chartInstance = echarts.init(chartContainer);
  }

  const option = {
    backgroundColor: 'transparent',
    title: {
      text: `${selectedItem.name || selectedItem.symbol} ${selectedItem.symbol} - ${currentInterval} / ${currentRange}`,
      left: 'left',
      textStyle: { color: '#e2e8f0' }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      position: function (pos, params, el, elRect, size) {
        return [pos[0] + 10, pos[1] - 30];
      }
    },
    legend: {
      data: ['K 線', 'MA5', 'MA10', 'MA20', '成交量'],
      textStyle: { color: '#94a3b8' }
    },
    grid: [
      { left: '10%', right: '8%', top: '12%', height: '55%' },
      { left: '10%', right: '8%', top: '73%', height: '18%' }
    ],
    xAxis: [
      {
        type: 'category',
        data: categoryData,
        scale: true,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', interval: Math.max(0, Math.floor(categoryData.length / 8)) }
      },
      {
        type: 'category',
        gridIndex: 1,
        data: categoryData,
        axisLabel: { show: false },
        axisLine: { show: false }
      }
    ],
    yAxis: [
      {
        scale: true,
        splitLine: { show: false },
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8' }
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8' }
      }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 },
      { show: true, xAxisIndex: [0, 1], type: 'slider', top: '92%', start: 60, end: 100 }
    ],
    series: [
      {
        name: 'K 線',
        type: 'candlestick',
        data: values,
        itemStyle: {
          color: '#22c55e',
          color0: '#ef4444',
          borderColor: '#22c55e',
          borderColor0: '#ef4444'
        }
      },
      {
        name: 'MA5',
        type: 'line',
        data: ma5,
        smooth: true,
        lineStyle: { opacity: 0.8 },
        symbol: 'none'
      },
      {
        name: 'MA10',
        type: 'line',
        data: ma10,
        smooth: true,
        lineStyle: { opacity: 0.8 },
        symbol: 'none'
      },
      {
        name: 'MA20',
        type: 'line',
        data: ma20,
        smooth: true,
        lineStyle: { opacity: 0.8 },
        symbol: 'none'
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volume,
        itemStyle: { color: '#64748b' }
      }
    ]
  };

  chartInstance.setOption(option);
}

function analyzeTrend(data) {
  if (!data || data.length < 2) {
    return {
      score: 0,
      rationales: ['Price trend: chart data is not sufficient for a signal.']
    };
  }

  const closes = data.map(point => Number(point.close)).filter(Number.isFinite);
  if (closes.length < 2) {
    return {
      score: 0,
      rationales: ['Price trend: closing prices are not sufficient for a signal.']
    };
  }

  let score = 0;
  const rationales = [];
  const lastClose = closes[closes.length - 1];
  const firstClose = closes[0];
  const windowReturn = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const shortPeriod = Math.min(5, closes.length);
  const longPeriod = Math.min(20, closes.length);
  const shortMA = average(closes.slice(-shortPeriod));
  const longMA = average(closes.slice(-longPeriod));

  if (longMA && lastClose > longMA * 1.003) {
    score += 1;
    rationales.push(`Price trend: latest close is ${formatPercent(((lastClose - longMA) / longMA) * 100)} above MA${longPeriod}.`);
  } else if (longMA && lastClose < longMA * 0.997) {
    score -= 1;
    rationales.push(`Price trend: latest close is ${formatPercent(((lastClose - longMA) / longMA) * 100)} below MA${longPeriod}.`);
  } else {
    rationales.push(`Price trend: latest close is near MA${longPeriod}, so momentum is not decisive.`);
  }

  if (shortMA && longMA && shortMA > longMA * 1.003) {
    score += 1;
    rationales.push(`Moving average: MA${shortPeriod} is above MA${longPeriod}, suggesting near-term strength.`);
  } else if (shortMA && longMA && shortMA < longMA * 0.997) {
    score -= 1;
    rationales.push(`Moving average: MA${shortPeriod} is below MA${longPeriod}, suggesting near-term weakness.`);
  }

  if (windowReturn > 3) {
    score += 1;
    rationales.push(`Momentum: selected range return is ${formatPercent(windowReturn)}.`);
  } else if (windowReturn < -3) {
    score -= 1;
    rationales.push(`Momentum: selected range return is ${formatPercent(windowReturn)}.`);
  } else {
    rationales.push(`Momentum: selected range return is modest at ${formatPercent(windowReturn)}.`);
  }

  const volumes = data.map(point => Number(point.volume)).filter(value => Number.isFinite(value) && value > 0);
  if (volumes.length >= 3) {
    const lastVolume = volumes[volumes.length - 1];
    const recentAverageVolume = average(volumes.slice(Math.max(0, volumes.length - 11), -1));
    if (recentAverageVolume) {
      const volumeRatio = lastVolume / recentAverageVolume;
      if (volumeRatio >= 1.5 && windowReturn > 0) {
        score += 1;
        rationales.push(`Volume: last volume is ${volumeRatio.toFixed(1)}x recent average, confirming the up move.`);
      } else if (volumeRatio >= 1.5 && windowReturn < 0) {
        score -= 1;
        rationales.push(`Volume: last volume is ${volumeRatio.toFixed(1)}x recent average, confirming selling pressure.`);
      } else {
        rationales.push(`Volume: last volume is ${volumeRatio.toFixed(1)}x recent average.`);
      }
    }
  }

  return { score, rationales };
}

function analyzeNews(news) {
  if (!news || !news.length) {
    return {
      score: 0,
      rationales: ['News: no recent headlines were available for confirmation.']
    };
  }

  const positiveTerms = [
    'growth', 'profit', 'beat', 'beats', 'upgrade', 'bullish', 'record', 'revenue',
    'earnings', 'buyback', 'dividend', 'partnership', 'approval', 'demand', 'strong',
    'outperform', 'raise', 'surge', 'rally', '成長', '獲利', '優於', '調升', '看多',
    '利多', '創新高', '營收', '股利', '合作', '批准', '需求', '強勁', '上漲'
  ];
  const negativeTerms = [
    'loss', 'miss', 'downgrade', 'bearish', 'lawsuit', 'probe', 'recall', 'delay',
    'weak', 'cut', 'slump', 'fall', 'drop', 'risk', 'warning', 'tariff', 'sanction',
    'decline', '虧損', '低於', '調降', '看空', '利空', '訴訟', '調查', '召回',
    '延遲', '疲弱', '下修', '下跌', '風險', '警告', '關稅', '制裁', '衰退'
  ];

  let positiveCount = 0;
  let negativeCount = 0;
  news.slice(0, 10).forEach(item => {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const positiveHits = positiveTerms.filter(term => text.includes(term.toLowerCase())).length;
    const negativeHits = negativeTerms.filter(term => text.includes(term.toLowerCase())).length;
    if (positiveHits > negativeHits) positiveCount += 1;
    if (negativeHits > positiveHits) negativeCount += 1;
  });

  let score = 0;
  if (positiveCount > negativeCount) score += 1;
  if (negativeCount > positiveCount) score -= 1;
  if (positiveCount >= negativeCount + 3) score += 1;
  if (negativeCount >= positiveCount + 3) score -= 1;

  const rationales = [
    `News: ${positiveCount} positive and ${negativeCount} negative keyword signals found in the latest ${Math.min(news.length, 10)} headlines.`
  ];

  if (positiveCount === negativeCount) {
    rationales.push('News: headline tone is mixed or neutral, so price action carries more weight.');
  } else if (positiveCount > negativeCount) {
    rationales.push('News: headline tone supports a more constructive stance.');
  } else {
    rationales.push('News: headline tone argues for more caution.');
  }

  return { score, rationales };
}

function buildStrategySignal(chartData, news) {
  const trend = analyzeTrend(chartData);
  const headline = analyzeNews(news);
  const score = trend.score + headline.score;

  if (score >= 4) {
    return {
      label: 'BUY / Add',
      tone: 'buy',
      confidence: 'Higher',
      summary: 'Trend and news are both constructive. Consider staged buying, with risk controls below recent support.',
      rationales: [...trend.rationales, ...headline.rationales]
    };
  }

  if (score >= 2) {
    return {
      label: 'BUY on Pullback / Hold',
      tone: 'buy',
      confidence: 'Medium',
      summary: 'The setup leans bullish, but waiting for a pullback or confirmation can improve entry discipline.',
      rationales: [...trend.rationales, ...headline.rationales]
    };
  }

  if (score <= -4) {
    return {
      label: 'SELL / Reduce',
      tone: 'sell',
      confidence: 'Higher',
      summary: 'Trend and news both lean negative. Reducing exposure or using a tighter stop is favored.',
      rationales: [...trend.rationales, ...headline.rationales]
    };
  }

  if (score <= -2) {
    return {
      label: 'Avoid New Buy / Trim',
      tone: 'sell',
      confidence: 'Medium',
      summary: 'The setup leans cautious. Avoid chasing and consider trimming if risk limits are breached.',
      rationales: [...trend.rationales, ...headline.rationales]
    };
  }

  return {
    label: 'HOLD / Wait',
    tone: 'hold',
    confidence: 'Low',
    summary: 'Signals are mixed. A neutral stance is favored until price trend or news flow confirms direction.',
    rationales: [...trend.rationales, ...headline.rationales]
  };
}

function renderStrategySignal(chartData = [], news = []) {
  const signal = buildStrategySignal(chartData, news);
  strategyPanel.className = `strategy-box signal-${signal.tone}`;
  strategyPanel.innerHTML = `
    <div class="strategy-header">
      <div>
        <h2>Buy/Sell Strategy</h2>
        <p>Rule-based educational signal. Not personalized financial advice.</p>
      </div>
      <div class="strategy-badge">${escapeHTML(signal.label)}</div>
    </div>
    <div class="strategy-summary">
      <span>Confidence: ${escapeHTML(signal.confidence)}</span>
      <p>${escapeHTML(signal.summary)}</p>
    </div>
    <div class="strategy-rationales">
      ${signal.rationales.map(reason => `<div class="strategy-rationale">${escapeHTML(reason)}</div>`).join('')}
    </div>
  `;
}

async function loadMarketData(symbol) {
  const [chartResult, newsResult] = await Promise.allSettled([
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(currentInterval)}&range=${encodeURIComponent(currentRange)}`)
      .then(response => (response.ok ? response.json() : null)),
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then(response => (response.ok ? response.json() : null))
  ]);

  const chartData = chartResult.status === 'fulfilled' ? chartResult.value : null;
  if (chartData && chartData.data) {
    renderChart(chartData.data, selectedItem);
    updateSummaryFromChart(chartData.data);
  } else {
    chartContainer.innerHTML = '<div style="color:#94a3b8;padding:28px;">無法取得走勢資料，請稍後再試。</div>';
  }

  const news = newsResult.status === 'fulfilled' && newsResult.value ? newsResult.value : [];
  renderStrategySignal(chartData?.data || [], news);

  if (news.length) {
    renderNews(news);
  } else {
    newsList.innerHTML = '<div class="news-item">無法取得新聞。</div>';
  }
}

function updateSummaryFromChart(data) {
  if (!data.length) return;
  const last = data[data.length - 1];
  const prev = data[data.length - 2] || last;
  const price = last.close;
  const change = price - prev.close;
  const percent = prev.close ? (change / prev.close) * 100 : 0;
  const volume = last.volume || 0;

  selectedItem.price = `${formatNumber(price, 2)} ${selectedItem.type === 'crypto' ? 'USD' : 'TWD'}`;
  selectedItem.change = `${change >= 0 ? '+' : ''}${formatNumber(change, 2)}`;
  selectedItem.percent = `${change >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
  selectedItem.volume = volume ? `${formatNumber(volume, 0)}` : '--';
  selectedItem.trend = percent > 0 ? '多頭' : percent < 0 ? '空頭' : '震盪';

  buildSummary(selectedItem);
}

function renderNews(news) {
  newsList.innerHTML = '';
  if (!news || !news.length) {
    newsList.innerHTML = '<div class="news-item">找不到相關新聞。</div>';
    return;
  }

  news.forEach(item => {
    const block = document.createElement('div');
    block.className = 'news-item';
    const href = safeExternalUrl(item.link);
    const title = escapeHTML(item.title || 'Untitled');
    const publisher = escapeHTML(item.publisher || '');
    const publishedAt = item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toLocaleString('zh-TW', { hour12: false }) : '';
    const summary = item.summary ? `<p>${escapeHTML(item.summary)}</p>` : '';
    block.innerHTML = `
      <a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>
      <div class="news-meta">${publisher} ${escapeHTML(publishedAt)}</div>
      ${summary}
    `;
    newsList.appendChild(block);
  });
}

function selectItem(item) {
  selectedItem = { ...item };
  currentInterval = '1d';
  currentRange = '1mo';
  renderStrategySignal([], []);
  buildSummary({
    name: item.name,
    symbol: item.symbol,
    market: item.market || (item.type === 'crypto' ? 'Crypto' : '台灣股'),
    type: item.type
  });
  setActiveTab('1d', '1mo');
  loadMarketData(item.symbol);
}

function setActiveTab(interval, range) {
  currentInterval = interval;
  currentRange = range;
  Array.from(timeTabs.children).forEach(button => {
    const buttonInterval = button.dataset.interval;
    const buttonRange = button.dataset.range;
    button.classList.toggle('active', buttonInterval === interval && buttonRange === range);
  });
}

searchButton.addEventListener('click', () => {
  performSearch(searchInput.value);
});

searchInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    performSearch(searchInput.value);
  }
});

searchInput.addEventListener('input', () => {
  if (searchInput.value.trim().length >= 1) {
    performSearch(searchInput.value, { save: false });
  } else {
    searchRequestId += 1;
    suggestionList.innerHTML = '';
  }
});

timeTabs.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !selectedItem) return;

  const interval = button.dataset.interval;
  const range = button.dataset.range;
  setActiveTab(interval, range);
  loadMarketData(selectedItem.symbol);
});

buildSummary(defaultState);
renderStrategySignal([], []);
loadHistory();
