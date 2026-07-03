const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const suggestionList = document.getElementById('suggestionList');
const historyList = document.getElementById('historyList');
const itemSummary = document.getElementById('itemSummary');
const newsList = document.getElementById('newsList');
const timeTabs = document.getElementById('timeTabs');
const refreshButton = document.getElementById('refreshButton');
const refreshStatus = document.getElementById('refreshStatus');
const chartContainer = document.getElementById('chart');
const strategyPanel = document.getElementById('strategyPanel');
const strategyModal = document.getElementById('strategyModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalBody = document.getElementById('modalBody');
const websiteBox = document.getElementById('websiteBox');
const themeButtons = Array.from(document.querySelectorAll('[data-theme-option]'));

const HISTORY_KEY = 'investment_search_history';
const THEME_KEY = 'investment_theme';
const STRATEGY_INTERVAL = '1d';
const STRATEGY_RANGE = '1mo';
const STRATEGY_LOOKBACK_LABEL = '30-day daily trend';
const STRATEGY_REFRESH_MS = 5 * 60 * 1000;

const TOP_PICKS = [
  {
    symbol: '2330.TW', name: '台積電', english: 'TSMC', type: 'stock', market: '上市',
    horizon: '1–3 年', liquidityStars: 5,
    reasons: [
      'AI 晶片唯一可信賴代工廠，CoWoS 先進封裝供不應求至 2026 年底',
      '2nm 量產技術領先競爭對手 2–3 年，毛利率 53%+ 護城河深',
      '外資持倉約 75%，日均成交額 > NT$200 億，進出滑價極低'
    ],
    risk: '地緣政治（台海風險）、美中科技戰出口管制'
  },
  {
    symbol: '2454.TW', name: '聯發科', english: 'MediaTek', type: 'stock', market: '上市',
    horizon: '1–3 年', liquidityStars: 4,
    reasons: [
      '5G 手機晶片全球市占 ~35%，主攻印度/東南亞高成長市場',
      'AI 端側推理晶片（天璣 AI）切入車用/IoT，營收多角化',
      '現金殖利率穩定 > 4%，每年回購計畫，股東回饋佳'
    ],
    risk: '中低階手機市場週期性波動、競爭來自高通'
  },
  {
    symbol: '2317.TW', name: '鴻海', english: 'Hon Hai', type: 'stock', market: '上市',
    horizon: '1–2 年', liquidityStars: 4,
    reasons: [
      'NVIDIA GB200 AI 伺服器主要組裝廠，AI 訂單能見度強',
      'EV 平台 MIH 已有多家車廠採用，長期轉型故事完整',
      '本益比 < 12x，股價低估明顯，殖利率 > 4%'
    ],
    risk: '蘋果訂單集中風險、EV 量產時間表落後'
  },
  {
    symbol: '2382.TW', name: '廣達', english: 'Quanta Computer', type: 'stock', market: '上市',
    horizon: '1–2 年', liquidityStars: 4,
    reasons: [
      'Meta / Google AI 伺服器首選代工夥伴，AI 營收佔比快速提升',
      '與 NVIDIA 深度合作，GB200 NVL72 機架主要承接廠',
      '股價相對 AI 題材同業仍有折價，基本面補漲空間較大'
    ],
    risk: '客戶集中於 Meta/Google，AI 投資週期放緩影響大'
  },
  {
    symbol: '2308.TW', name: '台達電', english: 'Delta Electronics', type: 'stock', market: '上市',
    horizon: '2–3 年', liquidityStars: 3,
    reasons: [
      'AI 資料中心電源供應器（PSU）全球市占第一，直接受益算力擴張',
      'EV 充電樁快速佈局歐美，充電網路建設為長期確定性需求',
      '品牌自有設計毛利率高於純代工，護城河深且持續投入 R&D'
    ],
    risk: '原物料成本波動、EV 充電市場補貼政策不確定性'
  },
  {
    symbol: 'BTC-USD', name: '比特幣', english: 'Bitcoin', type: 'crypto', market: 'Crypto',
    horizon: '2–4 年', liquidityStars: 5,
    reasons: [
      '美國現貨 ETF 通過後機構持倉持續增加，2024 年減半供給縮減',
      '數位黃金敘事成熟，部分主權財富基金已開始配置',
      '24h 全球流動性最深，bid-ask spread < 0.01%，任何規模均可執行'
    ],
    risk: '監管政策驟變、市場情緒週期性暴跌 40–80%'
  },
  {
    symbol: 'ETH-USD', name: '以太幣', english: 'Ethereum', type: 'crypto', market: 'Crypto',
    horizon: '2–3 年', liquidityStars: 5,
    reasons: [
      '質押年化 ~3–4%，EIP-1559 燃燒機制使 ETH 在高活動期通縮',
      'Layer 2（Arbitrum / Base）生態系帶動鏈上活動，ETH 消耗持續',
      '現貨 ETF 開放後機構資金入場，市場深度明顯改善'
    ],
    risk: '競爭鏈（Solana）侵蝕開發者市占、技術升級延遲'
  },
  {
    symbol: 'SOL-USD', name: '索拉納', english: 'Solana', type: 'crypto', market: 'Crypto',
    horizon: '1–3 年', liquidityStars: 4,
    reasons: [
      '高吞吐量、低手續費，DeFi / PayFi 開發者首選鏈',
      'Firedancer 升級預計大幅提升穩定性，消除中心化疑慮',
      '2024–25 生態活躍度（DEX 交易量、新地址數）均創歷史新高'
    ],
    risk: '歷史停機記錄（去中心化爭議）、幣種波動大'
  },
  {
    symbol: 'BNB-USD', name: '幣安幣', english: 'BNB', type: 'crypto', market: 'Crypto',
    horizon: '1–2 年', liquidityStars: 4,
    reasons: [
      'Binance 全球最大交易所平台幣，每季回購銷毀通縮明確',
      'BSC 鏈上 DeFi 活躍，Gas 費消耗穩定支撐真實需求',
      '持有享 Binance 手續費折扣，平台綁定效應強'
    ],
    risk: 'CZ 法律事件聲譽影響、監管對 Binance 不確定性'
  },
  {
    symbol: 'XRP-USD', name: '瑞波幣', english: 'XRP', type: 'crypto', market: 'Crypto',
    horizon: '1–2 年', liquidityStars: 4,
    reasons: [
      'SEC 訴訟基本勝訴，主要法律不確定性解除，機構可重新配置',
      'RippleNet 跨境支付已有 300+ 金融機構採用，B2B 需求真實',
      '流通釋放速度慢、Ripple 鎖倉機制可控，供給壓力低'
    ],
    risk: 'SEC 上訴尚未完全結束、Ripple 公司大量持倉集中'
  }
];

let searchHistory = [];
let selectedItem = null;
let currentInterval = '1d';
let currentRange = '1mo';
let chartInstance = null;
let searchRequestId = 0;
let marketDataRequestId = 0;
let strategyRefreshTimer = null;
let marketRefreshTimer = null;
let currentChartData = [];
let currentStrategyData = [];
let currentNews = [];
let currentWebsite = null;
let isRefreshing = false;

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getChartPalette() {
  return {
    ink: cssVar('--chart-ink', '#111827'),
    muted: cssVar('--chart-muted', '#667085'),
    axisLine: cssVar('--chart-axis-line', 'rgba(17, 24, 39, 0.16)'),
    gridLine: cssVar('--chart-grid-line', 'rgba(17, 24, 39, 0.06)'),
    tooltipBg: cssVar('--chart-tooltip-bg', 'rgba(255, 255, 255, 0.96)'),
    tooltipBorder: cssVar('--chart-tooltip-border', 'rgba(17, 24, 39, 0.12)'),
    zoomFill: cssVar('--chart-zoom-fill', 'rgba(0, 122, 255, 0.12)'),
    blue: cssVar('--blue', '#007aff'),
    green: cssVar('--green', '#34c759'),
    greenBorder: cssVar('--positive-text', '#1f9d55'),
    red: cssVar('--red', '#ff3b30'),
    redBorder: cssVar('--negative-text', '#d92d20'),
    ma5: cssVar('--chart-ma5', '#5470c6'),
    ma10: cssVar('--chart-ma10', '#91cc75'),
    ma20: cssVar('--chart-ma20', '#fac858'),
    volume: cssVar('--chart-volume', 'rgba(0, 122, 255, 0.34)')
  };
}

function setTheme(theme, { persist = true } = {}) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalizedTheme;
  themeButtons.forEach(button => {
    const isActive = button.dataset.themeOption === normalizedTheme;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, normalizedTheme);
    } catch (error) {
      // Ignore storage failures; the visible theme still changes for this session.
    }
  }

  if (chartInstance && currentChartData.length && selectedItem) {
    renderChart(currentChartData, selectedItem);
  }
}

function initTheme() {
  const initialTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  setTheme(initialTheme, { persist: false });
}

function setRefreshState({ loading = false, message = '', enabled = Boolean(selectedItem) } = {}) {
  isRefreshing = loading;
  if (refreshButton) {
    refreshButton.disabled = loading || !enabled;
    refreshButton.classList.toggle('is-loading', loading);
    refreshButton.textContent = loading ? 'Refreshing...' : 'Refresh Data';
  }

  if (refreshStatus && message) {
    refreshStatus.textContent = message;
  }
}

function formattedRefreshTime() {
  return new Date().toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

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

function renderChartEmptyState(title = 'Select an asset', body = 'Search for an asset to load price history, volume, and moving averages.') {
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }

  chartContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-inner">
        <div class="empty-chart" aria-hidden="true">
          ${Array.from({ length: 8 }, () => '<span class="empty-candle"></span>').join('')}
        </div>
        <div>
          <h3>${escapeHTML(title)}</h3>
          <p>${escapeHTML(body)}</p>
        </div>
      </div>
    </div>
  `;
}

function renderCompanyWebsite(website) {
  if (!websiteBox) return;
  if (!website && !selectedItem) {
    websiteBox.innerHTML = '';
    return;
  }

  websiteBox.innerHTML = `
    <div class="website-box">
      <strong>Official Site</strong>
      ${website ? `<a href="${safeExternalUrl(website)}" target="_blank" rel="noopener noreferrer">${escapeHTML(website)}</a>` : '<span>Not available yet</span>'}
    </div>
  `;
}

async function fetchCompanyWebsite(symbol) {
  try {
    const response = await fetch(`/api/profile?symbol=${encodeURIComponent(symbol)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.website || null;
  } catch (error) {
    return null;
  }
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!searchHistory.length) {
    historyList.innerHTML = '<div class="chip is-empty">No recent searches</div>';
    return;
  }

  searchHistory.forEach(query => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = query;
    chip.addEventListener('click', () => {
      searchInput.value = query;
      performSearch(query, { autoSelect: true });
    });
    historyList.appendChild(chip);
  });
}

async function performSearch(query, { save = true, autoSelect = false } = {}) {
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
    suggestionList.innerHTML = '<div class="suggestion-item">Search is temporarily unavailable.</div>';
    return;
  }

  if (requestId !== searchRequestId) return;
  suggestionList.innerHTML = '';

  if (!items.length) {
    suggestionList.innerHTML = '<div class="suggestion-item">No matching stock or crypto asset found.</div>';
    return;
  }

  if (autoSelect) {
    selectItem(items[0]);
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'suggestion-item';
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');
    row.innerHTML = `
      <div class="symbol">${escapeHTML(item.symbol)}</div>
      <div class="info">
        <div><strong>${escapeHTML(item.name || item.english || item.symbol)}</strong> ${item.english && item.english !== item.name ? `(${escapeHTML(item.english)})` : ''}</div>
        <div class="muted">${escapeHTML(item.type === 'crypto' ? 'Crypto' : item.market || 'Taiwan Stock')}</div>
      </div>
    `;
    row.addEventListener('click', () => selectItem(item));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectItem(item);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = row.nextElementSibling;
        if (next) next.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = row.previousElementSibling;
        if (prev) prev.focus();
        else searchInput.focus();
      }
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
  const displayName = escapeHTML(data.name || 'Select an asset');
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
        <strong>Symbol / Market</strong>
        <div class="value">${symbol} / ${market}</div>
      </div>
      <div class="summary-card">
        <strong>Last Price</strong>
        <div class="value">${price}</div>
      </div>
      <div class="summary-card">
        <strong>Change</strong>
        <div class="value">${change} (${percent})</div>
      </div>
      <div class="summary-card">
        <strong>Volume</strong>
        <div class="value">${volume}</div>
      </div>
      <div class="summary-card">
        <strong>Trend</strong>
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
    renderChartEmptyState('No chart data', 'Price history is not available for this asset right now.');
    return;
  }

  if (typeof echarts === 'undefined') {
    renderChartEmptyState('Chart unavailable', 'The chart library did not load, but the rest of the market data remains available.');
    return;
  }

  const categoryData = data.map(d => formatTime(d.timestamp));
  const values = data.map(d => [d.open, d.close, d.low, d.high]);
  const volume = data.map(d => d.volume || 0);
  const closeValues = data.map(d => d.close);

  const ma5 = calculateMA(closeValues, 5);
  const ma10 = calculateMA(closeValues, 10);
  const ma20 = calculateMA(closeValues, 20);
  const palette = getChartPalette();

  if (!chartInstance) {
    // Clear any empty-state markup so it doesn't linger behind the transparent chart.
    chartContainer.innerHTML = '';
    chartInstance = echarts.init(chartContainer);
  }

  const option = {
    backgroundColor: 'transparent',
    color: [palette.green, palette.ma5, palette.ma10, palette.ma20, palette.volume],
    title: {
      text: `${selectedItem.name || selectedItem.symbol} ${selectedItem.symbol} - ${currentInterval} / ${currentRange}`,
      left: 'left',
      top: 6,
      textStyle: { color: palette.ink, fontSize: 15, fontWeight: 700 }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      textStyle: { color: palette.ink },
      position: function (pos, params, el, elRect, size) {
        return [pos[0] + 10, pos[1] - 30];
      }
    },
    legend: {
      data: ['Candles', 'MA5', 'MA10', 'MA20', 'Volume'],
      top: 32,
      textStyle: { color: palette.muted }
    },
    grid: [
      { left: '7%', right: '5%', top: '16%', height: '55%' },
      { left: '7%', right: '5%', top: '76%', height: '15%' }
    ],
    xAxis: [
      {
        type: 'category',
        data: categoryData,
        scale: true,
        boundaryGap: false,
        axisLine: { lineStyle: { color: palette.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: palette.muted, interval: Math.max(0, Math.floor(categoryData.length / 8)) }
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
        splitLine: { lineStyle: { color: palette.gridLine } },
        axisLine: { show: false },
        axisLabel: { color: palette.muted }
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        splitLine: { lineStyle: { color: palette.gridLine } },
        axisLine: { show: false },
        axisLabel: { color: palette.muted }
      }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 },
      {
        show: true,
        xAxisIndex: [0, 1],
        type: 'slider',
        top: '92%',
        height: 20,
        start: 60,
        end: 100,
        borderColor: 'transparent',
        fillerColor: palette.zoomFill,
        handleStyle: { color: palette.blue },
        textStyle: { color: palette.muted }
      }
    ],
    series: [
      {
        name: 'Candles',
        type: 'candlestick',
        data: values,
        itemStyle: {
          color: palette.green,
          color0: palette.red,
          borderColor: palette.greenBorder,
          borderColor0: palette.redBorder
        }
      },
      {
        name: 'MA5',
        type: 'line',
        data: ma5,
        smooth: true,
        lineStyle: { color: palette.ma5, opacity: 0.9 },
        symbol: 'none'
      },
      {
        name: 'MA10',
        type: 'line',
        data: ma10,
        smooth: true,
        lineStyle: { color: palette.ma10, opacity: 0.9 },
        symbol: 'none'
      },
      {
        name: 'MA20',
        type: 'line',
        data: ma20,
        smooth: true,
        lineStyle: { color: palette.ma20, opacity: 0.9 },
        symbol: 'none'
      },
      {
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volume,
        itemStyle: { color: palette.volume }
      }
    ]
  };

  chartInstance.setOption(option, true);
}

function analyzeTrend(data, label = 'Price trend') {
  if (!data || data.length < 2) {
    return {
      score: 0,
      rationales: [`${label}: chart data is not sufficient for a signal.`]
    };
  }

  const closes = data.map(point => Number(point.close)).filter(Number.isFinite);
  if (closes.length < 2) {
    return {
      score: 0,
      rationales: [`${label}: closing prices are not sufficient for a signal.`]
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
    rationales.push(`${label}: latest close is ${formatPercent(((lastClose - longMA) / longMA) * 100)} above MA${longPeriod}.`);
  } else if (longMA && lastClose < longMA * 0.997) {
    score -= 1;
    rationales.push(`${label}: latest close is ${formatPercent(((lastClose - longMA) / longMA) * 100)} below MA${longPeriod}.`);
  } else {
    rationales.push(`${label}: latest close is near MA${longPeriod}, so momentum is not decisive.`);
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

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function linearSlopePerDay(points) {
  const firstTimestamp = points[0].timestamp;
  const samples = points.map(point => ({
    x: (point.timestamp - firstTimestamp) / (24 * 60 * 60 * 1000),
    y: Number(point.close)
  })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (samples.length < 2) return 0;

  const meanX = average(samples.map(point => point.x));
  const meanY = average(samples.map(point => point.y));
  const denominator = samples.reduce((sum, point) => sum + Math.pow(point.x - meanX, 2), 0);
  if (!denominator) return 0;

  return samples.reduce((sum, point) => sum + ((point.x - meanX) * (point.y - meanY)), 0) / denominator;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function calculatePriceForecasts(chartData = [], news = [], contextLabel = 'loaded chart') {
  const points = chartData
    .map(point => ({
      ...point,
      timestamp: Number(point.timestamp),
      close: Number(point.close)
    }))
    .filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length < 3) {
    return {
      horizons: [],
      rationale: `Forecast needs at least three valid closing prices from the ${contextLabel}.`
    };
  }

  const closes = points.map(point => point.close);
  const lastClose = closes[closes.length - 1];
  const firstClose = closes[0];
  const totalDays = Math.max((points[points.length - 1].timestamp - points[0].timestamp) / (24 * 60 * 60 * 1000), 1);
  const recentLookback = Math.min(8, points.length - 1);
  const recentPoint = points[points.length - 1 - recentLookback];
  const recentDays = Math.max((points[points.length - 1].timestamp - recentPoint.timestamp) / (24 * 60 * 60 * 1000), 1);
  const regressionSlope = linearSlopePerDay(points);
  const recentSlope = (lastClose - recentPoint.close) / recentDays;
  const blendedSlope = (regressionSlope * 0.6) + (recentSlope * 0.4);
  const newsScore = analyzeNews(news).score;
  const newsBiasPerDay = lastClose * clamp(newsScore, -2, 2) * 0.001;
  const returns = [];

  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }

  const timestampGaps = [];
  for (let i = 1; i < points.length; i += 1) {
    timestampGaps.push((points[i].timestamp - points[i - 1].timestamp) / (24 * 60 * 60 * 1000));
  }

  const medianGapDays = Math.max(median(timestampGaps) || 1, 1 / (24 * 12));
  const pointVolatility = standardDeviation(returns);
  const dailyVolatility = pointVolatility / Math.sqrt(medianGapDays);
  const minimumRangePercent = 0.006;

  const horizons = [3, 5, 10].map(days => {
    const drift = (blendedSlope + newsBiasPerDay) * days;
    const estimate = Math.max(0.01, lastClose + drift);
    const rangePercent = Math.max(minimumRangePercent, dailyVolatility * Math.sqrt(days) * 1.25);
    const low = Math.max(0.01, estimate * (1 - rangePercent));
    const high = estimate * (1 + rangePercent);
    const changePercent = ((estimate - lastClose) / lastClose) * 100;
    const tone = changePercent > 0.5 ? 'positive' : changePercent < -0.5 ? 'negative' : 'neutral';

    return {
      days,
      estimate,
      low,
      high,
      changePercent,
      tone
    };
  });

  const trendReturn = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  return {
    horizons,
    rationale: `Uses ${points.length} ${contextLabel} price points over ${formatNumber(totalDays, 1)} days, blended trend drift, recent momentum, volatility, and headline sentiment. Lookback return: ${formatPercent(trendReturn)}.`
  };
}

function renderForecastCards(forecast) {
  if (!forecast?.horizons?.length) {
    return `
      <div class="forecast-empty">
        Forecast unavailable until an asset has enough chart history.
      </div>
    `;
  }

  return `
    <div class="forecast-grid">
      ${forecast.horizons.map(item => `
        <div class="forecast-card forecast-${item.tone}">
          <div class="forecast-label">${item.days}-Day Forecast</div>
          <div class="forecast-price">${formatNumber(item.estimate, 2)}</div>
          <div class="forecast-change">${formatPercent(item.changePercent)}</div>
          <div class="forecast-range">${formatNumber(item.low, 2)} - ${formatNumber(item.high, 2)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildStrategySignal(chartData, news) {
  const trend = analyzeTrend(chartData, STRATEGY_LOOKBACK_LABEL);
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
  const forecast = calculatePriceForecasts(chartData, news, STRATEGY_LOOKBACK_LABEL);
  strategyPanel.className = `strategy-box signal-${signal.tone}`;
  strategyPanel.innerHTML = `
    <div class="strategy-header">
      <div>
        <h2>Auto Buy/Sell Strategy</h2>
        <p>Automatically adjusted from the prior 30-day daily trend and latest headlines. Not personalized financial advice.</p>
      </div>
      <div class="strategy-actions">
        <div class="strategy-badge">${escapeHTML(signal.label)}</div>
        <button class="view-details-btn" id="viewDetailsBtn">Details</button>
      </div>
    </div>
    <div class="strategy-summary">
      <span>Confidence: ${escapeHTML(signal.confidence)}</span>
      <p>${escapeHTML(signal.summary)}</p>
    </div>
    <div class="forecast-panel">
      <div class="forecast-heading">
        <h3>Price Forecast</h3>
        <span>Model estimate, not financial advice</span>
      </div>
      ${renderForecastCards(forecast)}
      <p>${escapeHTML(forecast.rationale)}</p>
    </div>
    <div class="strategy-rationales">
      ${signal.rationales.map(reason => `<div class="strategy-rationale">${escapeHTML(reason)}</div>`).join('')}
    </div>
  `;

  document.getElementById('viewDetailsBtn')?.addEventListener('click', () => {
    showStrategyAnalysisModal(chartData, news, signal, forecast);
  });
}

async function fetchStrategyInputs(symbol) {
  const [chartResult, newsResult] = await Promise.allSettled([
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(STRATEGY_INTERVAL)}&range=${encodeURIComponent(STRATEGY_RANGE)}`)
      .then(response => (response.ok ? response.json() : null)),
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then(response => (response.ok ? response.json() : null))
  ]);

  return {
    chartData: chartResult.status === 'fulfilled' && chartResult.value?.data ? chartResult.value.data : null,
    news: newsResult.status === 'fulfilled' && Array.isArray(newsResult.value) ? newsResult.value : null
  };
}

async function refreshStrategyInputs(symbol, { renderHeadlines = false } = {}) {
  if (!symbol || selectedItem?.symbol !== symbol) return;

  const { chartData, news } = await fetchStrategyInputs(symbol);
  if (selectedItem?.symbol !== symbol) return;

  if (chartData) currentStrategyData = chartData;
  if (news) currentNews = news;
  renderStrategySignal(currentStrategyData, currentNews);

  if (renderHeadlines) {
    if (currentNews.length) {
      renderNews(currentNews);
    } else {
      newsList.innerHTML = '<div class="news-item">No recent headlines available.</div>';
    }
  }
}

function restartStrategyAutoRefresh(symbol) {
  if (strategyRefreshTimer) {
    clearInterval(strategyRefreshTimer);
    strategyRefreshTimer = null;
  }

  if (!symbol) return;

  strategyRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    refreshStrategyInputs(symbol, { renderHeadlines: true });
  }, STRATEGY_REFRESH_MS);
}

function restartMarketAutoRefresh(symbol) {
  if (marketRefreshTimer) {
    clearInterval(marketRefreshTimer);
    marketRefreshTimer = null;
  }

  if (!symbol) return;

  marketRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    refreshCurrentMarketData();
  }, STRATEGY_REFRESH_MS);
}

async function loadMarketData(symbol) {
  const requestId = ++marketDataRequestId;
  const requestedInterval = currentInterval;
  const requestedRange = currentRange;
  const strategyChartPromise = currentInterval === STRATEGY_INTERVAL && currentRange === STRATEGY_RANGE
    ? null
    : fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(STRATEGY_INTERVAL)}&range=${encodeURIComponent(STRATEGY_RANGE)}`)
      .then(response => (response.ok ? response.json() : null));

  const [chartResult, newsResult, profileResult, strategyChartResult] = await Promise.allSettled([
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(requestedInterval)}&range=${encodeURIComponent(requestedRange)}`)
      .then(response => (response.ok ? response.json() : null)),
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then(response => (response.ok ? response.json() : null)),
    fetchCompanyWebsite(symbol),
    strategyChartPromise || Promise.resolve(null)
  ]);

  if (requestId !== marketDataRequestId || selectedItem?.symbol !== symbol) {
    return false;
  }

  const chartData = chartResult.status === 'fulfilled' ? chartResult.value : null;
  if (chartData && chartData.data) {
    renderChart(chartData.data, selectedItem);
    updateSummaryFromChart(chartData.data);
    currentChartData = chartData.data;
  } else {
    renderChartEmptyState('No chart data', 'Price history could not be loaded for this selection.');
    currentChartData = [];
  }

  const news = newsResult.status === 'fulfilled' && newsResult.value ? newsResult.value : [];
  currentNews = news;

  const strategyChartData = strategyChartResult.status === 'fulfilled' && strategyChartResult.value?.data
    ? strategyChartResult.value.data
    : chartData?.data || [];
  currentStrategyData = strategyChartData;

  const website = profileResult.status === 'fulfilled' ? profileResult.value : null;
  currentWebsite = website;
  if (selectedItem) {
    selectedItem.website = website;
  }
  renderCompanyWebsite(website);
  renderStrategySignal(strategyChartData, news);

  if (news.length) {
    renderNews(news);
  } else {
    newsList.innerHTML = '<div class="news-item">No recent headlines available.</div>';
  }

  return true;
}

async function refreshCurrentMarketData() {
  if (!selectedItem?.symbol || isRefreshing) return;

  const symbol = selectedItem.symbol;
  setRefreshState({ loading: true, message: `Refreshing ${symbol}...` });

  let message = '';
  try {
    await loadMarketData(symbol);
    message = `Updated at ${formattedRefreshTime()}.`;
  } catch (error) {
    message = 'Refresh failed. Try again in a moment.';
  } finally {
    if (selectedItem?.symbol === symbol) {
      setRefreshState({ loading: false, message });
    } else {
      setRefreshState({ loading: false, message: 'Ready to refresh live data.' });
    }
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
  selectedItem.trend = percent > 0 ? 'Uptrend' : percent < 0 ? 'Downtrend' : 'Flat';

  buildSummary(selectedItem);
}

function renderNews(news) {
  newsList.innerHTML = '';
  if (!news || !news.length) {
    newsList.innerHTML = '<div class="news-item">No matching headlines found.</div>';
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
  selectedItem = { ...item, website: null };
  currentInterval = '1d';
  currentRange = '1mo';
  currentWebsite = null;
  currentStrategyData = [];
  setRefreshState({ loading: true, message: `Loading ${item.symbol}...`, enabled: true });
  saveHistory(item.symbol || item.english || item.name);
  searchInput.value = item.symbol || item.english || item.name || searchInput.value;
  suggestionList.innerHTML = '';
  renderStrategySignal([], []);
  renderCompanyWebsite(null);
  buildSummary({
    name: item.name,
    symbol: item.symbol,
    market: item.market || (item.type === 'crypto' ? 'Crypto' : 'Taiwan Stock'),
    type: item.type
  });
  setActiveTab('1d', '1mo');
  restartStrategyAutoRefresh(item.symbol);
  restartMarketAutoRefresh(item.symbol);
  loadMarketData(item.symbol)
    .then(loaded => {
      if (loaded !== false && selectedItem?.symbol === item.symbol) {
        setRefreshState({ loading: false, message: `Updated at ${formattedRefreshTime()}.` });
      }
    })
    .catch(() => {
      if (selectedItem?.symbol === item.symbol) {
        setRefreshState({ loading: false, message: 'Initial load failed. Use Refresh Data to try again.' });
      }
    });
}

function calculateTechnicalIndicators(data) {
  if (!data || data.length < 20) {
    return null;
  }

  const closes = data.map(d => Number(d.close)).filter(Number.isFinite);
  const highs = data.map(d => Number(d.high)).filter(Number.isFinite);
  const lows = data.map(d => Number(d.low)).filter(Number.isFinite);
  const volumes = data.map(d => Number(d.volume)).filter(d => Number.isFinite(d) && d > 0);

  const currentPrice = closes[closes.length - 1];
  const highest = Math.max(...highs);
  const lowest = Math.min(...lows);
  const range = highest - lowest;

  // RSI — Wilder's smoothed EMA (14-period)
  const rsiPeriod = 14;
  let avgGain = 0;
  let avgLoss = 0;
  const rsiSeedEnd = Math.min(rsiPeriod, closes.length - 1);
  for (let i = 1; i <= rsiSeedEnd; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= rsiPeriod;
  avgLoss /= rsiPeriod;
  for (let i = rsiPeriod + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (rsiPeriod - 1) + (change > 0 ? change : 0)) / rsiPeriod;
    avgLoss = (avgLoss * (rsiPeriod - 1) + (change < 0 ? -change : 0)) / rsiPeriod;
  }
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  // Support and Resistance (using high/low of period)
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-20));

  // Price momentum (% change)
  const change1Week = closes.length >= 5 ? ((closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5]) * 100 : 0;
  const change1Month = closes.length >= 20 ? ((closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20]) * 100 : 0;

  // Average volume
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  const lastVolume = volumes[volumes.length - 1] || 0;
  const volumeRatio = avgVolume > 0 ? (lastVolume / avgVolume) : 0;

  // Volatility (Standard deviation of returns)
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100;

  return {
    currentPrice,
    highest,
    lowest,
    range,
    rsi,
    support,
    resistance,
    change1Week,
    change1Month,
    avgVolume: Math.round(avgVolume),
    lastVolume: Math.round(lastVolume),
    volumeRatio,
    volatility
  };
}

function calculateRiskReward(data, signal) {
  if (!data || data.length === 0) return null;
  if (signal.tone === 'hold') return null;

  const closes = data.map(d => Number(d.close)).filter(Number.isFinite);
  const highs = data.map(d => Number(d.high)).filter(Number.isFinite);
  const lows = data.map(d => Number(d.low)).filter(Number.isFinite);

  const minLen = Math.min(closes.length, highs.length, lows.length);
  if (minLen < 2) return null;

  const currentPrice = closes[closes.length - 1];

  // ATR over up to 14 bars
  const atrPeriod = Math.min(14, minLen - 1);
  let atrSum = 0;
  for (let i = minLen - atrPeriod; i < minLen; i++) {
    const h = highs[i] ?? closes[i];
    const l = lows[i] ?? closes[i];
    const prev = closes[i - 1] ?? closes[i];
    atrSum += Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev));
  }
  const atr = atrSum / atrPeriod;
  if (!atr || atr <= 0) return null;

  const lookback = Math.min(20, minLen);
  const support = Math.min(...lows.slice(-lookback));
  const resistance = Math.max(...highs.slice(-lookback));

  let entryPrice, stopLoss, takeProfit;

  if (signal.tone === 'buy') {
    entryPrice = currentPrice;
    stopLoss = Math.min(support - atr * 0.1, entryPrice - atr * 1.5);
    takeProfit = Math.max(resistance + atr * 0.1, entryPrice + atr);
  } else {
    entryPrice = currentPrice;
    stopLoss = Math.max(resistance + atr * 0.1, entryPrice + atr * 1.5);
    takeProfit = Math.min(support - atr * 0.1, entryPrice - atr);
  }

  // Price levels can never be negative or zero.
  stopLoss = Math.max(stopLoss, 0.01);
  takeProfit = Math.max(takeProfit, 0.01);

  const riskAmount = Math.abs(entryPrice - stopLoss);
  const rewardAmount = Math.abs(takeProfit - entryPrice);
  const riskRewardRatio = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  return { entryPrice, stopLoss, takeProfit, riskAmount, rewardAmount, riskRewardRatio };
}

function showStrategyAnalysisModal(chartData, news, signal, forecast = calculatePriceForecasts(chartData, news, STRATEGY_LOOKBACK_LABEL)) {
  const indicators = calculateTechnicalIndicators(chartData);
  const riskReward = calculateRiskReward(chartData, signal);

  let analysisHTML = `
    <div class="analysis-section">
      <h3>Technical Indicators</h3>
      <div class="analysis-metrics">
  `;

  if (indicators) {
    analysisHTML += `
      <div class="metric-card">
        <div class="metric-label">Current Price</div>
        <div class="metric-value">${formatNumber(indicators.currentPrice, 2)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">RSI (14)</div>
        <div class="metric-value ${indicators.rsi > 70 ? 'negative' : indicators.rsi < 30 ? 'positive' : ''}">${formatNumber(indicators.rsi, 1)}</div>
        <div style="font-size: 0.75rem; color: var(--muted); margin-top: 4px;">
          ${indicators.rsi > 70 ? 'Overbought' : indicators.rsi < 30 ? 'Oversold' : 'Neutral'}
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Support / Resistance</div>
        <div class="metric-value" style="font-size: 1rem;">${formatNumber(indicators.support, 2)} / ${formatNumber(indicators.resistance, 2)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">5-Session Move</div>
        <div class="metric-value ${indicators.change1Week > 0 ? 'positive' : indicators.change1Week < 0 ? 'negative' : ''}">${formatPercent(indicators.change1Week)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">20-Session Move</div>
        <div class="metric-value ${indicators.change1Month > 0 ? 'positive' : indicators.change1Month < 0 ? 'negative' : ''}">${formatPercent(indicators.change1Month)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Volatility</div>
        <div class="metric-value">${formatNumber(indicators.volatility, 2)}%</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Volume Ratio</div>
        <div class="metric-value">${formatNumber(indicators.volumeRatio, 2)}x</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Latest Volume</div>
        <div class="metric-value">${formatNumber(indicators.lastVolume, 0)}</div>
      </div>
    `;
  } else {
    analysisHTML += `
      <div class="metric-card" style="grid-column: span 2;">
        <div class="metric-label">Insufficient Data</div>
        <div class="metric-value" style="font-size: 1rem;">There is not enough price history to calculate technical indicators.</div>
      </div>
    `;
  }

  analysisHTML += `</div></div>`;

  analysisHTML += `
    <div class="analysis-section">
      <h3>Price Forecast</h3>
      ${renderForecastCards(forecast)}
      <div class="forecast-method">${escapeHTML(forecast.rationale)}</div>
    </div>
  `;

  if (riskReward) {
    analysisHTML += `
      <div class="analysis-section">
        <h3>Entry / Exit</h3>
        <div class="recommendation-box">
          <div class="recommendation-item">
            <div class="recommendation-label">Entry Reference</div>
            <div class="recommendation-value">${formatNumber(riskReward.entryPrice, 2)}</div>
          </div>
          <div class="recommendation-item">
            <div class="recommendation-label">Stop Loss</div>
            <div class="recommendation-value" style="color: var(--negative-text);">${formatNumber(riskReward.stopLoss, 2)}</div>
          </div>
          <div class="recommendation-item">
            <div class="recommendation-label">Take Profit</div>
            <div class="recommendation-value" style="color: var(--positive-text);">${formatNumber(riskReward.takeProfit, 2)}</div>
          </div>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Risk / Reward</h3>
        <div class="risk-reward-box">
          <div class="risk-reward-row">
            <span class="risk-reward-label">Risk Amount</span>
            <span class="risk-reward-value" style="color: var(--negative-text);">${formatNumber(riskReward.riskAmount, 2)}</span>
          </div>
          <div class="risk-reward-row">
            <span class="risk-reward-label">Reward Amount</span>
            <span class="risk-reward-value" style="color: var(--positive-text);">${formatNumber(riskReward.rewardAmount, 2)}</span>
          </div>
          <div class="risk-reward-row">
            <span class="risk-reward-label">R:R Ratio</span>
            <span class="risk-reward-value">${formatNumber(riskReward.riskRewardRatio, 2)} : 1</span>
          </div>
        </div>
      </div>
    `;
  } else if (signal.tone === 'hold') {
    analysisHTML += `
      <div class="analysis-section">
        <h3>Entry / Exit</h3>
        <div class="recommendation-box">
          <div class="recommendation-item">
            <div class="recommendation-label">No Active Trade Signal</div>
            <div class="recommendation-value">Signals are mixed. No entry or exit levels are suggested — wait for trend confirmation before acting.</div>
          </div>
        </div>
      </div>
    `;
  } else {
    analysisHTML += `
      <div class="analysis-section">
        <h3>Entry / Exit</h3>
        <div class="recommendation-box">
          <div class="recommendation-item">
            <div class="recommendation-label">Insufficient Data</div>
            <div class="recommendation-value">There is not enough price history to calculate a stop loss or target.</div>
          </div>
        </div>
      </div>
    `;
  }

  analysisHTML += `
    <div class="analysis-section">
      <h3>Signal Drivers</h3>
      <div class="recommendation-box">
        ${signal.rationales.map(reason => `
          <div class="recommendation-item">
            <div class="recommendation-value">${escapeHTML(reason)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  modalBody.innerHTML = analysisHTML;
  strategyModal.classList.add('show');
}

function closeStrategyModal() {
  strategyModal.classList.remove('show');
}

function renderTopPicks() {
  const container = document.getElementById('topPicksList');
  if (!container) return;
  container.innerHTML = '';
  TOP_PICKS.forEach((pick, index) => {
    const card = document.createElement('div');
    card.className = 'pick-card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Load ${pick.english || pick.name} (${pick.symbol})`);
    const stars = '★'.repeat(pick.liquidityStars) + '☆'.repeat(5 - pick.liquidityStars);
    card.innerHTML = `
      <div class="pick-rank">${index + 1}</div>
      <div class="pick-body">
        <div class="pick-head">
          <div class="pick-title">
            <span class="pick-symbol">${escapeHTML(pick.symbol)}</span>
            <span class="pick-name">${escapeHTML(pick.name)}</span>
            <span class="pick-english">${escapeHTML(pick.english)}</span>
          </div>
          <div class="pick-badges">
            <span class="pick-badge pick-market">${escapeHTML(pick.type === 'crypto' ? 'Crypto' : pick.market)}</span>
            <span class="pick-badge pick-horizon">⏱ ${escapeHTML(pick.horizon)}</span>
            <span class="pick-badge pick-liquidity">💧 ${stars}</span>
          </div>
        </div>
        <ul class="pick-reasons">
          ${pick.reasons.map(r => `<li>${escapeHTML(r)}</li>`).join('')}
        </ul>
        <div class="pick-risk">⚠ 風險：${escapeHTML(pick.risk)}</div>
      </div>
    `;
    const load = () => selectItem({ symbol: pick.symbol, name: pick.name, english: pick.english, type: pick.type, market: pick.market });
    card.addEventListener('click', load);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        load();
      }
    });
    container.appendChild(card);
  });
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
  performSearch(searchInput.value, { autoSelect: true });
});

searchInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    performSearch(searchInput.value, { autoSelect: true });
  } else if (event.key === 'ArrowDown') {
    const firstOption = suggestionList.querySelector('[role="option"]');
    if (firstOption) {
      event.preventDefault();
      firstOption.focus();
    }
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

refreshButton?.addEventListener('click', refreshCurrentMarketData);

themeButtons.forEach(button => {
  button.addEventListener('click', () => {
    setTheme(button.dataset.themeOption);
  });
});

initTheme();
buildSummary(defaultState);
renderChartEmptyState();
renderStrategySignal([], []);
setRefreshState({ enabled: false });
loadHistory();
renderTopPicks();

// Modal event listeners
modalCloseBtn.addEventListener('click', closeStrategyModal);

strategyModal.addEventListener('click', (event) => {
  if (event.target === strategyModal) {
    closeStrategyModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeStrategyModal();
  }
});

window.addEventListener('resize', () => {
  if (chartInstance) {
    chartInstance.resize();
  }
});

window.addEventListener('beforeunload', () => {
  if (strategyRefreshTimer) {
    clearInterval(strategyRefreshTimer);
    strategyRefreshTimer = null;
  }
  if (marketRefreshTimer) {
    clearInterval(marketRefreshTimer);
    marketRefreshTimer = null;
  }
});

window.selectItem = selectItem;
