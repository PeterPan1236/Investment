const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const suggestionList = document.getElementById('suggestionList');
const historyList = document.getElementById('historyList');
const itemSummary = document.getElementById('itemSummary');
const newsList = document.getElementById('newsList');
const timeTabs = document.getElementById('timeTabs');
const refreshButton = document.getElementById('refreshButton');
const refreshStatus = document.getElementById('refreshStatus');
const reportButton = document.getElementById('generateReportBtn');
const reportButtonLabel = document.getElementById('reportButtonLabel');
const reportLanguageGroup = document.getElementById('reportLanguageToggle');
const reportLanguageButtons = Array.from(document.querySelectorAll('[data-report-lang]'));
const reportHint = document.getElementById('reportHint');
const reportSheet = document.getElementById('reportSheet');
const chartContainer = document.getElementById('chart');
const strategyPanel = document.getElementById('strategyPanel');
const strategyModal = document.getElementById('strategyModal');
const modalTitle = document.getElementById('modalTitle');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalBody = document.getElementById('modalBody');
const websiteBox = document.getElementById('websiteBox');
const themeButtons = Array.from(document.querySelectorAll('[data-theme-option]'));
const baseCurrencyButtons = Array.from(document.querySelectorAll('[data-base]'));
const viewTabs = document.getElementById('viewTabs');
const signalHistoryBody = document.getElementById('signalHistoryBody');
const backtestBody = document.getElementById('backtestBody');
const backtestControls = document.getElementById('backtestControls');
const portfolioBody = document.getElementById('portfolioBody');
const portfolioControls = document.getElementById('portfolioControls');
const screenerControls = document.getElementById('screenerControls');
const screenerList = document.getElementById('screenerList');
const screenerSummary = document.getElementById('screenerSummary');

const HISTORY_KEY = 'investment_search_history';
const THEME_KEY = 'investment_theme';
const BASE_CURRENCY_KEY = 'investment_base_currency';
const REPORT_LANGUAGE_KEY = 'investment_report_language';
const SIGNAL_INTERVAL = '1d';
const SIGNAL_RANGE = '2y';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const state = {
  searchHistory: [],
  selectedItem: null,
  currentInterval: '1d',
  reportLanguage: 'en',
  currentRange: '1mo',
  baseCurrency: 'TWD',
  fx: null,
  marketStatus: null,
  chartInstance: null,
  portfolioChartInstance: null,
  backtestChartInstance: null,
  currentChartData: [],
  signalBars: [],
  signalSeries: null,
  signalHistory: null,
  latestSignal: null,
  forecast: null,
  currentNews: [],
  currentWebsite: null,
  activeView: 'overview',
  isRefreshing: false,
  searchRequestId: 0,
  marketDataRequestId: 0,
  strategyRefreshTimer: null,
  marketRefreshTimer: null,
  universeHistory: null,
  universeRange: null,
  universeSignals: {},
  panelMeta: {}
};

/* ------------------------------------------------------------------ utils */

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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json();
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatSignedPercent(ratio, decimals = 2) {
  const number = Number(ratio);
  if (!Number.isFinite(number)) return '--';
  return `${number >= 0 ? '+' : ''}${(number * 100).toFixed(decimals)}%`;
}

function formatPercent(ratio, decimals = 1) {
  const number = Number(ratio);
  if (!Number.isFinite(number)) return '--';
  return `${(number * 100).toFixed(decimals)}%`;
}

function toneClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '';
  return number > 0 ? 'positive' : 'negative';
}

function formatDateTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return '--';
  return new Date(Number(timestamp)).toLocaleString('zh-TW', {
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function formatDate(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return '--';
  return new Date(Number(timestamp)).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function currencyOf(item) {
  return item?.type === 'crypto' || /-USD$/i.test(item?.symbol || '') ? 'USD' : 'TWD';
}

function convertToBase(value, fromCurrency) {
  if (!Number.isFinite(Number(value))) return null;
  if (fromCurrency === state.baseCurrency) return Number(value);
  if (!state.fx?.rate) return null;
  return state.baseCurrency === 'TWD' ? Number(value) * state.fx.rate : Number(value) / state.fx.rate;
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/* ------------------------------------------------------- source / status */

function setPanelMeta(key, parts) {
  state.panelMeta[key] = parts;
  const node = document.querySelector(`[data-panel-meta="${key}"]`);
  if (!node) return;
  node.innerHTML = parts
    .filter(Boolean)
    .map(part => `<span>${escapeHTML(part)}</span>`)
    .join('');
}

function sourceLine(extra = []) {
  return ['Source: Yahoo Finance', 'Quotes delayed ~15 min', 'Prices adjusted for splits and dividends', ...extra];
}

function renderSourceBar() {
  const updated = document.getElementById('sourceUpdated');
  if (updated) updated.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });

  const twNode = document.getElementById('marketStatusTw');
  if (twNode && state.marketStatus?.taiwan) {
    twNode.textContent = `${state.marketStatus.taiwan.label} (${state.marketStatus.taiwan.session})`;
    twNode.dataset.state = state.marketStatus.taiwan.state;
  }

  const fxNode = document.getElementById('fxRateLabel');
  if (fxNode) {
    fxNode.textContent = state.fx?.rate ? `USD/TWD ${formatNumber(state.fx.rate, 3)}` : 'USD/TWD --';
  }
}

async function loadMarketStatus() {
  try {
    state.marketStatus = await fetchJson('/api/market-status');
  } catch (error) {
    state.marketStatus = null;
  }
  renderSourceBar();
}

async function loadFxRate() {
  try {
    state.fx = await fetchJson('/api/fx');
  } catch (error) {
    state.fx = null;
  }
  renderSourceBar();
}

/** Taiwan equities only trade in-session, so a stale bar must say so. */
function marketNoteFor(item) {
  if (!item) return '';
  if (currencyOf(item) === 'USD') return 'Crypto trades 24/7';
  const status = state.marketStatus?.taiwan;
  if (!status) return '';
  return status.state === 'open' ? 'Taiwan market open' : `Taiwan market ${status.label}; showing last close`;
}

/* --------------------------------------------------------- theme / base */

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

  if (state.chartInstance && state.currentChartData.length && state.selectedItem) {
    renderChart(state.currentChartData, state.selectedItem);
  }
  if (state.activeView === 'backtest') renderBacktestView();
  if (state.activeView === 'portfolio') renderPortfolioView();
}

function setBaseCurrency(base, { persist = true } = {}) {
  state.baseCurrency = base === 'USD' ? 'USD' : 'TWD';
  baseCurrencyButtons.forEach(button => {
    const isActive = button.dataset.base === state.baseCurrency;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  if (persist) {
    try {
      localStorage.setItem(BASE_CURRENCY_KEY, state.baseCurrency);
    } catch (error) {
      // Non-fatal: the toggle still applies for this session.
    }
  }

  if (state.selectedItem) buildSummary(state.selectedItem);
  renderScreenerView();
  if (state.activeView === 'portfolio') renderPortfolioView();
}

/* -------------------------------------------------------------- history */

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    state.searchHistory = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    state.searchHistory = [];
  }
  renderHistory();
}

function saveHistory(query) {
  if (!query) return;
  state.searchHistory = state.searchHistory.filter(item => item !== query);
  state.searchHistory.unshift(query);
  if (state.searchHistory.length > 20) state.searchHistory.length = 20;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.searchHistory));
  } catch (error) {
    // Ignore storage failures; history is a convenience only.
  }
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!state.searchHistory.length) {
    historyList.innerHTML = '<div class="chip is-empty">No recent searches</div>';
    return;
  }

  state.searchHistory.forEach(query => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
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
    state.searchRequestId += 1;
    suggestionList.innerHTML = '';
    return;
  }

  if (save) saveHistory(trimmed);

  const requestId = ++state.searchRequestId;
  let items = [];
  try {
    items = await fetchJson(`/api/search?query=${encodeURIComponent(trimmed)}`);
  } catch (error) {
    if (requestId !== state.searchRequestId) return;
    suggestionList.innerHTML = '<div class="suggestion-item">Search is temporarily unavailable.</div>';
    return;
  }

  if (requestId !== state.searchRequestId) return;
  suggestionList.innerHTML = '';

  if (!items.length) {
    suggestionList.innerHTML = '<div class="suggestion-item">No matching stock or crypto asset.</div>';
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
        row.nextElementSibling?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (row.previousElementSibling) row.previousElementSibling.focus();
        else searchInput.focus();
      }
    });
    suggestionList.appendChild(row);
  });
}

/* --------------------------------------------------------------- charts */

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
    volume: cssVar('--chart-volume', 'rgba(0, 122, 255, 0.34)'),
    heatmapMid: cssVar('--chart-heatmap-mid', '#f4f6fb'),
    heatmapLabel: cssVar('--chart-heatmap-label', '#111827'),
    splitArea: cssVar('--chart-split-area', 'rgba(17, 24, 39, 0.03)')
  };
}

function renderChartEmptyState(title = 'Select an instrument', body = 'Search for an instrument to load price, volume, and moving averages.') {
  if (state.chartInstance) {
    state.chartInstance.dispose();
    state.chartInstance = null;
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

function movingAverageSeries(values, period) {
  return TA.sma(values, period).map(value => (value == null ? '-' : Number(value.toFixed(2))));
}

/**
 * A 1-month window holds ~22 bars, so an MA computed from the visible window
 * alone leaves MA60 and MA120 empty. The signal engine already loads two years
 * of daily bars, so those are used as warm-up and only the visible tail is drawn.
 */
function movingAverageOverlays(displayData, closeValues) {
  let closes = closeValues;
  let offset = 0;

  if (state.currentInterval === SIGNAL_INTERVAL && state.signalBars.length && displayData.length) {
    const firstDate = isoDate(displayData[0].timestamp);
    const startIndex = state.signalBars.findIndex(bar => isoDate(bar.timestamp) === firstDate);
    if (startIndex > 0) {
      const warmup = state.signalBars.slice(0, startIndex).map(bar => Number(bar.adjClose ?? bar.close));
      closes = warmup.concat(closeValues);
      offset = warmup.length;
    }
  }

  // The averages run over bars, not days, so only the daily chart may call them
  // MA20/MA60/MA120 without qualification.
  const unit = state.currentInterval === SIGNAL_INTERVAL ? ''
    : state.currentInterval === '1mo' ? ' (months)'
      : ' (bars)';

  return [
    { name: `MA20${unit}`, period: 20, color: 'ma5' },
    { name: `MA60${unit}`, period: 60, color: 'ma10' },
    { name: `MA120${unit}`, period: 120, color: 'ma20' }
  ]
    .map(ma => ({ ...ma, data: movingAverageSeries(closes, ma.period).slice(offset) }))
    // An MA with no plottable point in the window is a legend entry pointing at
    // an invisible line, so it is left out entirely.
    .filter(ma => ma.data.some(value => value !== '-'));
}

/**
 * Past signal flips are drawn on the price chart. An untracked signal is a
 * claim; a plotted one can be checked against what happened next.
 */
function signalMarkPoints(categoryData, data) {
  if (!state.signalHistory?.flips?.length || state.currentInterval !== '1d') return [];
  const indexByDate = new Map(data.map((bar, index) => [isoDate(bar.timestamp), index]));

  return state.signalHistory.flips
    .map(flip => {
      const index = indexByDate.get(isoDate(flip.timestamp));
      if (index == null || flip.state === 'HOLD') return null;
      return {
        name: flip.state,
        coord: [categoryData[index], flip.state === 'BUY' ? data[index].low : data[index].high],
        value: flip.state === 'BUY' ? 'B' : 'S',
        symbolRotate: flip.state === 'BUY' ? 0 : 180,
        itemStyle: { color: flip.state === 'BUY' ? cssVar('--positive-text', '#1f9d55') : cssVar('--negative-text', '#d92d20') }
      };
    })
    .filter(Boolean);
}

function renderChart(data, selectedItem) {
  if (!data || !data.length) {
    renderChartEmptyState('No chart data', 'Price history for this instrument is unavailable right now.');
    return;
  }

  if (typeof echarts === 'undefined') {
    renderChartEmptyState('Chart failed to load', 'The charting library did not load; the rest of the market data still works.');
    return;
  }

  const categoryData = data.map(d => formatDateTime(d.timestamp));
  const values = data.map(d => [d.open, d.close, d.low, d.high]);
  const volume = data.map(d => d.volume || 0);
  const closeValues = data.map(d => Number(d.adjClose ?? d.close));
  const palette = getChartPalette();

  if (!state.chartInstance) {
    chartContainer.innerHTML = '';
    state.chartInstance = echarts.init(chartContainer);
  }

  const marks = signalMarkPoints(categoryData, data);
  const overlays = movingAverageOverlays(data, closeValues);

  state.chartInstance.setOption({
    backgroundColor: 'transparent',
    color: [palette.green, palette.ma5, palette.ma10, palette.ma20, palette.volume],
    title: {
      text: `${selectedItem.name || selectedItem.symbol} ${selectedItem.symbol} · ${state.currentInterval} / ${state.currentRange}`,
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
      position: (pos) => [pos[0] + 10, pos[1] - 30]
    },
    legend: { data: ['Candles', ...overlays.map(ma => ma.name), 'Volume'], top: 32, textStyle: { color: palette.muted } },
    grid: [
      { left: '7%', right: '5%', top: '16%', height: '55%' },
      { left: '7%', right: '5%', top: '76%', height: '15%' }
    ],
    xAxis: [
      {
        type: 'category', data: categoryData, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: palette.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: palette.muted, interval: Math.max(0, Math.floor(categoryData.length / 8)) }
      },
      { type: 'category', gridIndex: 1, data: categoryData, axisLabel: { show: false }, axisLine: { show: false } }
    ],
    yAxis: [
      { scale: true, splitLine: { lineStyle: { color: palette.gridLine } }, axisLine: { show: false }, axisLabel: { color: palette.muted } },
      { scale: true, gridIndex: 1, splitNumber: 2, splitLine: { lineStyle: { color: palette.gridLine } }, axisLine: { show: false }, axisLabel: { color: palette.muted } }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 },
      {
        show: true, xAxisIndex: [0, 1], type: 'slider', top: '92%', height: 20, start: 60, end: 100,
        borderColor: 'transparent', fillerColor: palette.zoomFill,
        handleStyle: { color: palette.blue }, textStyle: { color: palette.muted }
      }
    ],
    series: [
      {
        name: 'Candles',
        type: 'candlestick',
        data: values,
        itemStyle: {
          color: palette.green, color0: palette.red,
          borderColor: palette.greenBorder, borderColor0: palette.redBorder
        },
        markPoint: marks.length ? {
          symbol: 'pin',
          symbolSize: 34,
          label: { color: '#fff', fontSize: 10, fontWeight: 700 },
          data: marks
        } : undefined
      },
      ...overlays.map(ma => ({
        name: ma.name,
        type: 'line',
        data: ma.data,
        smooth: true,
        lineStyle: { color: palette[ma.color], opacity: 0.9 },
        itemStyle: { color: palette[ma.color] },
        symbol: 'none',
        connectNulls: false
      })),
      { name: 'Volume', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volume, itemStyle: { color: palette.volume } }
    ]
  }, true);
}

/* -------------------------------------------------------------- summary */

const defaultSummary = {
  name: '', symbol: '', type: '', price: '--', change: '--', percent: '--', volume: '--', trend: '--'
};

function buildSummary(data = defaultSummary) {
  const nativeCurrency = currencyOf(data);
  const converted = data.lastClose != null ? convertToBase(data.lastClose, nativeCurrency) : null;
  const baseLine = converted != null && nativeCurrency !== state.baseCurrency
    ? `<div class="summary-sub">≈ ${formatNumber(converted, 2)} ${state.baseCurrency}</div>`
    : '';

  itemSummary.innerHTML = `
    <div class="summary-head">
      <div class="summary-title">${escapeHTML(data.name || 'Select an instrument')}</div>
      ${data.symbol ? `<span class="summary-note">${escapeHTML(marketNoteFor(data))}</span>` : ''}
    </div>
    <div class="summary-row grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5">
      <div class="summary-card">
        <strong>Symbol / market</strong>
        <div class="value">${escapeHTML(data.symbol || '--')} / ${escapeHTML(data.market || (data.type === 'crypto' ? 'Crypto' : '--'))}</div>
      </div>
      <div class="summary-card">
        <strong>Last price (${escapeHTML(nativeCurrency)})</strong>
        <div class="value">${escapeHTML(data.price ?? '--')}</div>
        ${baseLine}
      </div>
      <div class="summary-card">
        <strong>Change</strong>
        <div class="value ${toneClass(data.changeRatio)}">${escapeHTML(data.change ?? '--')} (${escapeHTML(data.percent ?? '--')})</div>
      </div>
      <div class="summary-card">
        <strong>Volume</strong>
        <div class="value">${escapeHTML(data.volume ?? '--')}</div>
      </div>
      <div class="summary-card">
        <strong>Last bar</strong>
        <div class="value">${escapeHTML(data.lastBarLabel || '--')}</div>
      </div>
    </div>
  `;
}

function updateSummaryFromChart(data) {
  if (!data.length || !state.selectedItem) return;
  const last = data[data.length - 1];
  const previous = data[data.length - 2] || last;
  const change = last.close - previous.close;
  const ratio = previous.close ? change / previous.close : 0;

  Object.assign(state.selectedItem, {
    lastClose: last.close,
    price: formatNumber(last.close, 2),
    change: `${change >= 0 ? '+' : ''}${formatNumber(change, 2)}`,
    percent: formatSignedPercent(ratio),
    changeRatio: ratio,
    volume: last.volume ? formatNumber(last.volume, 0) : '--',
    lastBarLabel: formatDateTime(last.timestamp)
  });

  buildSummary(state.selectedItem);
}

/* ----------------------------------------------------------------- news */

function renderNews(news) {
  newsList.innerHTML = '';
  if (!news || !news.length) {
    newsList.innerHTML = '<div class="news-item">No related news available.</div>';
    return;
  }

  const keywords = state.selectedItem ? SignalEngine.relevanceKeywords(state.selectedItem) : [];

  news.forEach(item => {
    const relevant = SignalEngine.isRelevant(item, keywords);
    const sentiment = SignalEngine.scoreHeadline(item);
    const publishedAt = item.providerPublishTime ? Number(item.providerPublishTime) * 1000 : null;
    const block = document.createElement('div');
    block.className = `news-item${relevant ? '' : ' news-unmapped'}`;
    block.innerHTML = `
      <div class="news-top">
        <a href="${safeExternalUrl(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title || 'Untitled')}</a>
        ${relevant
          ? `<span class="sentiment-tag sentiment-${sentiment.tone}">${sentiment.tone === 'positive' ? 'Positive' : sentiment.tone === 'negative' ? 'Negative' : 'Neutral'} ${sentiment.net >= 0 ? '+' : ''}${sentiment.net}</span>`
          : '<span class="sentiment-tag sentiment-neutral">Broad market · not counted</span>'}
      </div>
      <div class="news-meta">
        <span>${escapeHTML(relevant ? item.symbol || state.selectedItem?.symbol || '' : 'Not matched to this instrument')}</span>
        <span>${escapeHTML(item.publisher || 'Unattributed source')}</span>
        <span>${publishedAt ? escapeHTML(formatDateTime(publishedAt)) : 'No publish time'}</span>
      </div>
      ${item.summary ? `<p>${escapeHTML(item.summary)}</p>` : ''}
    `;
    newsList.appendChild(block);
  });
}

/* --------------------------------------------------------------- signal */

function renderForecastFan(forecast) {
  if (!forecast?.available) {
    return `<div class="forecast-empty">${escapeHTML(forecast?.reason || 'Not enough data to estimate a range.')}</div>`;
  }

  return `
    <div class="forecast-grid grid grid-cols-1 md:grid-cols-3 gap-2.5">
      ${forecast.horizons.map(item => {
        const width = Math.max(item.p90 - item.p10, 1e-9);
        const medianOffset = ((item.p50 - item.p10) / width) * 100;
        const boxLeft = ((item.p25 - item.p10) / width) * 100;
        const boxWidth = ((item.p75 - item.p25) / width) * 100;
        return `
          <div class="forecast-card">
            <div class="forecast-label">${item.days} trading days</div>
            <div class="forecast-band" role="img" aria-label="P10 ${formatNumber(item.p10, 2)}, median ${formatNumber(item.p50, 2)}, P90 ${formatNumber(item.p90, 2)}">
              <span class="band-box" style="left:${boxLeft.toFixed(2)}%;width:${boxWidth.toFixed(2)}%"></span>
              <span class="band-median" style="left:${medianOffset.toFixed(2)}%"></span>
            </div>
            <div class="forecast-scale">
              <span>P10 ${formatNumber(item.p10, 2)}</span>
              <span>P50 ${formatNumber(item.p50, 2)}</span>
              <span>P90 ${formatNumber(item.p90, 2)}</span>
            </div>
            <div class="forecast-width">80% band width ≈ ${formatPercent(item.widthPercent)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function confidenceBar(confidence) {
  return `
    <div class="confidence">
      <div class="confidence-head">
        <span>Confidence</span>
        <strong>${confidence} / 100</strong>
      </div>
      <div class="confidence-track"><span style="width:${TA.clamp(confidence, 0, 100)}%"></span></div>
    </div>
  `;
}

function renderStrategySignal() {
  const signal = state.latestSignal;
  const forecast = state.forecast;

  if (!signal) {
    strategyPanel.className = 'strategy-box signal-hold';
    strategyPanel.innerHTML = `
      <div class="strategy-header">
        <div>
          <h2>Signal engine</h2>
          <p>Pick an instrument to compute a signal from 20/60/120-day moving-average structure, ADX trend strength, volatility percentile, and volume.</p>
        </div>
      </div>
    `;
    return;
  }

  const point = signal.point;
  strategyPanel.className = `strategy-box signal-${signal.tone}`;
  strategyPanel.innerHTML = `
    <div class="strategy-header grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-start gap-4">
      <div>
        <h2>Signal engine</h2>
        <p>
          Multi-timeframe moving-average alignment (MA${SignalEngine.MA_FAST}/${SignalEngine.MA_MID}/${SignalEngine.MA_SLOW}) plus an ADX trend-strength floor,
          ATR volatility percentile, and volume confirmation. Below ADX ${SignalEngine.ADX_TREND_FLOOR} the market is treated as ranging and directional signals are suppressed. Not personal investment advice.
        </p>
      </div>
      <div class="strategy-actions flex flex-wrap items-center justify-stretch md:justify-end gap-2.5 w-full md:w-auto">
        <div class="strategy-badge w-full md:w-auto">${escapeHTML(signal.label)}</div>
        <button class="view-details-btn w-full md:w-auto" id="viewDetailsBtn" type="button">Technical details</button>
      </div>
    </div>

    <div class="strategy-summary">
      ${confidenceBar(signal.confidence)}
      <div class="signal-metrics">
        <div><span>Price structure score</span><strong>${signal.priceScore > 0 ? '+' : ''}${signal.priceScore}</strong></div>
        <div><span>ADX(14)</span><strong>${point?.adx != null ? formatNumber(point.adx, 1) : '--'}</strong></div>
        <div><span>ATR volatility percentile</span><strong>${point?.volatilityRank != null ? formatPercent(point.volatilityRank, 0) : '--'}</strong></div>
        <div><span>Volume ratio (20d)</span><strong>${point?.volumeRatio != null ? `${formatNumber(point.volumeRatio, 2)}x` : '--'}</strong></div>
      </div>
    </div>

    <div class="forecast-panel">
      <div class="forecast-heading">
        <h3>Price probability bands</h3>
        <span>A distribution, not a single price target</span>
      </div>
      ${renderForecastFan(forecast)}
      ${forecast?.available ? `<p class="forecast-method">${escapeHTML(forecast.method)}</p>` : ''}
    </div>

    <div class="strategy-rationales">
      ${signal.drivers.map(driver => `
        <div class="strategy-rationale weight-${driver.weight > 0 ? 'positive' : driver.weight < 0 ? 'negative' : 'neutral'}">
          ${escapeHTML(driver.text)}
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('viewDetailsBtn')?.addEventListener('click', showTechnicalModal);
}

function renderSignalHistoryView() {
  if (!state.signalHistory || !state.selectedItem) {
    signalHistoryBody.innerHTML = '<div class="empty-note">Select an instrument to see historical signals and hit rate.</div>';
    setPanelMeta('signal', sourceLine());
    return;
  }

  const { flips, stats } = state.signalHistory;
  const directional = flips.filter(flip => flip.state !== 'HOLD');

  if (!directional.length) {
    signalHistoryBody.innerHTML = '<div class="empty-note">No directional signal flips in this window (the model read it as ranging most of the time).</div>';
  } else {
    const statsHTML = stats ? `
      <div class="stat-row">
        <div class="stat"><span>Closed signals</span><strong>${stats.total}</strong></div>
        <div class="stat"><span>Hit rate</span><strong class="${stats.hitRate >= 0.5 ? 'positive' : 'negative'}">${formatPercent(stats.hitRate)}</strong></div>
        <div class="stat"><span>Average P/L per signal</span><strong class="${toneClass(stats.averageReturn)}">${formatSignedPercent(stats.averageReturn)}</strong></div>
        <div class="stat"><span>Average win / loss</span><strong>${formatSignedPercent(stats.averageWin)} / ${formatSignedPercent(stats.averageLoss)}</strong></div>
        <div class="stat"><span>Average holding days</span><strong>${formatNumber(stats.averageHoldingDays, 0)}</strong></div>
        <div class="stat"><span>BUY / SELL count</span><strong>${stats.buyCount} / ${stats.sellCount}</strong></div>
      </div>
    ` : '<div class="empty-note">No closed directional signals to summarize yet.</div>';

    const rows = directional.slice().reverse().map(flip => `
      <tr>
        <td>${escapeHTML(formatDate(flip.timestamp))}</td>
        <td><span class="state-pill state-${flip.state.toLowerCase()}">${flip.state}</span></td>
        <td>${formatNumber(flip.price, 2)}</td>
        <td>${flip.open ? 'Open' : escapeHTML(formatDate(flip.exitTimestamp))}</td>
        <td>${flip.open ? '--' : formatNumber(flip.exitPrice, 2)}</td>
        <td>${flip.holdingDays}</td>
        <td class="${toneClass(flip.signalReturn)}">${flip.open ? 'Unsettled' : formatSignedPercent(flip.signalReturn)}</td>
      </tr>
    `).join('');

    signalHistoryBody.innerHTML = `
      ${statsHTML}
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Signal date</th><th>State</th><th>Signal price</th><th>Exit date</th><th>Exit price</th><th>Holding days</th><th>Signal return</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="fine-print">
        Signal return is direction x price change: a decline after SELL counts as a hit. Statistics cover price-structure signals only and
        exclude news sentiment (no point-in-time news archive exists, so including it would overstate the hit rate). Past results do not predict future performance.
      </p>
    `;
  }

  setPanelMeta('signal', sourceLine([
    `Sample: ${state.selectedItem.symbol}, ${SIGNAL_RANGE} of daily bars`,
    `Last bar: ${formatDate(state.signalBars[state.signalBars.length - 1]?.timestamp)}`
  ]));
}

/**
 * Mechanical entry/stop/target from ATR and the last 20 bars. Shared by the
 * technical modal and the printable report so the two cannot drift apart.
 */
function referenceLevels(point) {
  if (!point || !state.signalBars.length) return null;
  const recent = state.signalBars.slice(-20);
  const support = Math.min(...recent.map(bar => Number(bar.low)));
  const resistance = Math.max(...recent.map(bar => Number(bar.high)));
  const atr = point.atr;

  if (point.state === 'BUY') {
    return {
      entry: point.close,
      stop: Math.min(support - atr * 0.1, point.close - atr * 1.5),
      target: Math.max(resistance + atr * 0.1, point.close + atr * 2)
    };
  }
  if (point.state === 'SELL') {
    return {
      entry: point.close,
      stop: Math.max(resistance + atr * 0.1, point.close + atr * 1.5),
      target: Math.min(support - atr * 0.1, point.close - atr * 2)
    };
  }
  return null;
}

function showTechnicalModal() {
  const point = state.latestSignal?.point;
  if (!point) return;

  const closes = state.signalBars.map(bar => Number(bar.adjClose ?? bar.close));
  const rsiSeries = TA.rsi(closes, 14);
  const rsi = rsiSeries[rsiSeries.length - 1];
  const levels = referenceLevels(point);

  modalTitle.textContent = `${state.selectedItem?.name || ''} ${state.selectedItem?.symbol || ''} technical details`;
  modalBody.innerHTML = `
    <div class="analysis-section">
      <h3>Indicator values</h3>
      <div class="analysis-metrics grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
        <div class="metric-card"><div class="metric-label">Close (adjusted)</div><div class="metric-value">${formatNumber(point.close, 2)}</div></div>
        <div class="metric-card"><div class="metric-label">MA20 / MA60</div><div class="metric-value" style="font-size:1rem;">${formatNumber(point.maFast, 2)} / ${formatNumber(point.maMid, 2)}</div></div>
        <div class="metric-card"><div class="metric-label">MA120</div><div class="metric-value">${point.maSlow != null ? formatNumber(point.maSlow, 2) : 'Not enough data'}</div></div>
        <div class="metric-card"><div class="metric-label">ADX(14)</div><div class="metric-value">${point.adx != null ? formatNumber(point.adx, 1) : '--'}</div></div>
        <div class="metric-card"><div class="metric-label">RSI(14)</div><div class="metric-value ${rsi > 70 ? 'negative' : rsi < 30 ? 'positive' : ''}">${formatNumber(rsi, 1)}</div></div>
        <div class="metric-card"><div class="metric-label">ATR(14) / price</div><div class="metric-value">${formatPercent(point.atrPercent, 2)}</div></div>
        <div class="metric-card"><div class="metric-label">Volatility percentile</div><div class="metric-value">${point.volatilityRank != null ? formatPercent(point.volatilityRank, 0) : '--'}</div></div>
        <div class="metric-card"><div class="metric-label">Volume ratio</div><div class="metric-value">${point.volumeRatio != null ? `${formatNumber(point.volumeRatio, 2)}x` : '--'}</div></div>
      </div>
    </div>

    <div class="analysis-section">
      <h3>Reference exit levels</h3>
      <div class="recommendation-box">
        ${levels ? `
          <div class="recommendation-item"><div class="recommendation-label">Reference entry</div><div class="recommendation-value">${formatNumber(levels.entry, 2)}</div></div>
          <div class="recommendation-item"><div class="recommendation-label">Stop (1.5 ATR or prior support)</div><div class="recommendation-value" style="color: var(--negative-text);">${formatNumber(levels.stop, 2)}</div></div>
          <div class="recommendation-item"><div class="recommendation-label">Target (2 ATR or prior resistance)</div><div class="recommendation-value" style="color: var(--positive-text);">${formatNumber(levels.target, 2)}</div></div>
          <div class="recommendation-item"><div class="recommendation-label">Risk / reward</div><div class="recommendation-value">${formatNumber(Math.abs(levels.target - levels.entry) / Math.abs(levels.entry - levels.stop), 2)} : 1</div></div>
        ` : '<div class="recommendation-item"><div class="recommendation-label">Currently HOLD</div><div class="recommendation-value">The model reads the market as ranging or the signals disagree, so no entry or exit levels are given.</div></div>'}
      </div>
    </div>

    <div class="analysis-section">
      <h3>Signal composition</h3>
      <div class="recommendation-box">
        ${state.latestSignal.drivers.map(driver => `
          <div class="recommendation-item"><div class="recommendation-value">${escapeHTML(driver.text)}</div></div>
        `).join('')}
      </div>
    </div>
    <p class="fine-print">Levels come from ATR and the highs and lows of the last 20 bars. They are a mechanical risk-control reference, not price targets or investment advice.</p>
  `;
  openModal();
}

/* -------------------------------------------------------------- backtest */

function renderBacktestView() {
  if (!state.selectedItem || !state.signalSeries) {
    backtestBody.innerHTML = '<div class="empty-note">Select an instrument on the Overview tab first, then run the backtest.</div>';
    setPanelMeta('backtest', sourceLine());
    return;
  }

  const fromInput = document.getElementById('backtestFrom').value;
  const toInput = document.getElementById('backtestTo').value;

  // Without this the engine reports "not enough bars", which points at the data
  // rather than at the inverted range the user actually typed.
  if (fromInput && toInput && Date.parse(fromInput) > Date.parse(toInput)) {
    backtestBody.innerHTML = '<div class="empty-note">The start date is after the end date. Swap them, or clear both to use the history length above.</div>';
    setPanelMeta('backtest', sourceLine());
    return;
  }

  const result = Backtest.runBacktest({
    points: state.signalSeries.points,
    symbol: state.selectedItem.symbol,
    type: state.selectedItem.type,
    from: fromInput ? Date.parse(fromInput) : null,
    to: toInput ? Date.parse(toInput) + 86399000 : null
  });

  if (!result.available) {
    backtestBody.innerHTML = `<div class="empty-note">${escapeHTML(result.reason)}</div>`;
    setPanelMeta('backtest', sourceLine());
    return;
  }

  const verdict = result.beatsBuyAndHold
    ? 'Over this window, the strategy beat buy & hold after costs.'
    : 'Over this window, the strategy lost to buy & hold after costs, which is the norm for plain moving-average strategies once costs are deducted.';

  backtestBody.innerHTML = `
    <div class="verdict ${result.beatsBuyAndHold ? 'verdict-good' : 'verdict-warn'}">${escapeHTML(verdict)}</div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Metric</th><th>Signal strategy (after costs)</th><th>Buy &amp; hold (after costs)</th></tr></thead>
        <tbody>
          <tr><td>Total return</td><td class="${toneClass(result.strategy.totalReturn)}">${formatSignedPercent(result.strategy.totalReturn)}</td><td class="${toneClass(result.hold.totalReturn)}">${formatSignedPercent(result.hold.totalReturn)}</td></tr>
          <tr><td>Annualized return</td><td class="${toneClass(result.strategy.annualizedReturn)}">${formatSignedPercent(result.strategy.annualizedReturn)}</td><td class="${toneClass(result.hold.annualizedReturn)}">${formatSignedPercent(result.hold.annualizedReturn)}</td></tr>
          <tr><td>Annualized volatility</td><td>${formatPercent(result.strategy.annualizedVolatility)}</td><td>${formatPercent(result.hold.annualizedVolatility)}</td></tr>
          <tr><td>Sharpe (rf=0)</td><td>${formatNumber(result.strategy.sharpe, 2)}</td><td>${formatNumber(result.hold.sharpe, 2)}</td></tr>
          <tr><td>Max drawdown</td><td class="negative">${formatPercent(result.strategy.maxDrawdown)}</td><td class="negative">${formatPercent(result.hold.maxDrawdown)}</td></tr>
        </tbody>
      </table>
    </div>

    <div id="backtestChart" class="mini-chart"></div>

    <div class="stat-row">
      <div class="stat"><span>Trades</span><strong>${result.tradeCount}</strong></div>
      <div class="stat"><span>Win rate per trade</span><strong>${result.winRate == null ? '--' : formatPercent(result.winRate)}</strong></div>
      <div class="stat"><span>Turnover per year</span><strong>${formatNumber(result.turnoverPerYear, 2)}x</strong></div>
      <div class="stat"><span>Cost drag</span><strong class="negative">${formatSignedPercent(-Math.abs(result.costDragReturn))}</strong></div>
      <div class="stat"><span>Time in market</span><strong>${formatPercent(result.timeInMarket)}</strong></div>
      <div class="stat"><span>Sample</span><strong>${result.bars} daily bars</strong></div>
    </div>

    <p class="fine-print">
      Cost model: ${escapeHTML(result.costs.label)} — ${escapeHTML(result.costs.note)}.
      Signals fire at the T close and positions open at T+1; SELL means flat, never short; buy &amp; hold also pays one-way entry and exit costs.
      Slippage, borrow fees, and tax differences are excluded. Backtested results do not guarantee future performance.
    </p>
  `;

  renderBacktestChart(result);
  setPanelMeta('backtest', sourceLine([
    `Window: ${formatDate(result.from)} – ${formatDate(result.to)}`,
    `Cost model: ${result.costs.label}`
  ]));
}

function renderBacktestChart(result) {
  const container = document.getElementById('backtestChart');
  if (!container || typeof echarts === 'undefined') return;

  if (state.backtestChartInstance) state.backtestChartInstance.dispose();
  state.backtestChartInstance = echarts.init(container);
  const palette = getChartPalette();

  state.backtestChartInstance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', backgroundColor: palette.tooltipBg, borderColor: palette.tooltipBorder, textStyle: { color: palette.ink } },
    legend: { data: ['Signal strategy', 'Buy & hold'], textStyle: { color: palette.muted }, top: 0 },
    grid: { left: '10%', right: '4%', top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: result.timestamps.map(formatDate),
      axisLine: { lineStyle: { color: palette.axisLine } },
      axisLabel: { color: palette.muted, interval: Math.max(0, Math.floor(result.timestamps.length / 6)) }
    },
    yAxis: {
      type: 'value', scale: true,
      splitLine: { lineStyle: { color: palette.gridLine } },
      axisLabel: { color: palette.muted, formatter: value => `${(value * 100).toFixed(0)}` }
    },
    series: [
      { name: 'Signal strategy', type: 'line', data: result.strategyEquity, symbol: 'none', lineStyle: { color: palette.blue, width: 2 } },
      { name: 'Buy & hold', type: 'line', data: result.holdEquity, symbol: 'none', lineStyle: { color: palette.muted, width: 2, type: 'dashed' } }
    ]
  }, true);
}

/* ------------------------------------------------------------- portfolio */

async function loadUniverseHistory(range) {
  if (state.universeHistory && state.universeRange === range) return state.universeHistory;

  const symbols = [...Screener.symbols(), 'TWD=X'].join(',');
  const payload = await fetchJson(`/api/history?symbols=${encodeURIComponent(symbols)}&range=${encodeURIComponent(range)}`);
  state.universeHistory = payload;
  state.universeRange = range;

  state.universeSignals = {};
  Screener.symbols().forEach(symbol => {
    const series = payload.series[symbol];
    if (!series?.data?.length) return;
    const computed = SignalEngine.computeSignalSeries(series.data);
    state.universeSignals[symbol] = SignalEngine.latestSignal(computed, []);
  });

  return payload;
}

async function renderPortfolioView() {
  const range = document.getElementById('portfolioRange').value;
  const cashWeight = Number(document.getElementById('cashWeight').value);
  const method = document.getElementById('sizingMethod').value;

  portfolioBody.innerHTML = '<div class="empty-note">Calculating…</div>';

  let payload;
  try {
    payload = await loadUniverseHistory(range);
  } catch (error) {
    portfolioBody.innerHTML = '<div class="empty-note">Could not load history; try again shortly (the free quote source may be rate-limiting).</div>';
    return;
  }

  const matrix = Portfolio.buildReturnMatrix(payload.series, {
    base: state.baseCurrency,
    fxSeries: payload.series['TWD=X'],
    symbols: Screener.symbols().filter(symbol => payload.series[symbol])
  });

  const sizing = method === 'equal'
    ? Portfolio.equalWeights(matrix, { cashWeight })
    : Portfolio.inverseVolatilityWeights(matrix, { cashWeight });
  const analysis = Portfolio.analyzePortfolio(matrix, sizing);

  if (!analysis.available) {
    portfolioBody.innerHTML = `<div class="empty-note">${escapeHTML(analysis.reason)}</div>`;
    return;
  }

  const nameBySymbol = new Map(Screener.UNIVERSE.map(item => [item.symbol, item.name]));
  const cryptoWeight = analysis.symbols.reduce((sum, symbol) => (
    /-USD$/i.test(symbol) ? sum + (analysis.weights[symbol] || 0) : sum
  ), 0);
  const cryptoRisk = analysis.riskContributions
    .filter(item => /-USD$/i.test(item.symbol))
    .reduce((sum, item) => sum + item.riskShare, 0);

  const weightRows = analysis.riskContributions.map(item => `
    <tr>
      <td>${escapeHTML(item.symbol)}<span class="row-sub">${escapeHTML(nameBySymbol.get(item.symbol) || '')}</span></td>
      <td>${formatPercent(item.weight)}</td>
      <td>${formatPercent(item.riskShare)}</td>
      <td>${formatPercent(item.volatility)}</td>
      <td class="${item.riskShare > item.weight * 1.25 ? 'negative' : ''}">${item.weight ? formatNumber(item.riskShare / item.weight, 2) : '--'}x</td>
    </tr>
  `).join('');

  portfolioBody.innerHTML = `
    <div class="stat-row">
      <div class="stat"><span>Portfolio annualized volatility</span><strong>${formatPercent(analysis.annualizedVolatility)}</strong></div>
      <div class="stat"><span>Max drawdown (in sample)</span><strong class="negative">${formatPercent(analysis.maxDrawdown)}</strong></div>
      <div class="stat"><span>Cash level</span><strong>${formatPercent(analysis.cashWeight)}</strong></div>
      <div class="stat"><span>Average correlation</span><strong>${formatNumber(analysis.averageCorrelation, 2)}</strong></div>
      <div class="stat"><span>Effective positions (by weight)</span><strong>${formatNumber(analysis.effectivePositions, 1)}</strong></div>
      <div class="stat"><span>Effective bets (correlation-adjusted)</span><strong class="${analysis.effectiveBets < 4 ? 'negative' : ''}">${formatNumber(analysis.effectiveBets, 1)}</strong></div>
    </div>

    <div class="insight ${analysis.effectiveBets < 4 || cryptoRisk > 0.6 ? 'insight-warn' : ''}">
      The list holds ${analysis.symbols.length} names, but after accounting for correlation it is really only
      <strong>${formatNumber(analysis.effectiveBets, 1)}</strong> independent bets (average correlation ${formatNumber(analysis.averageCorrelation, 2)},
      highest correlation ${formatNumber(analysis.maxCorrelation, 2)}).
      Crypto takes ${formatPercent(cryptoWeight)} of capital but ${formatPercent(cryptoRisk)} of risk.
      Diversification ratio ${formatNumber(analysis.diversificationRatio, 2)} (1.0 means no diversification benefit at all).
    </div>

    <div class="split-grid">
      <div>
        <h3 class="sub-heading">Suggested weights &amp; risk contribution</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Instrument</th><th>Capital weight</th><th>Risk share</th><th>Annualized volatility</th><th>Risk / weight</th></tr></thead>
            <tbody>
              ${weightRows}
              <tr class="row-cash"><td>Cash</td><td>${formatPercent(analysis.cashWeight)}</td><td>0.0%</td><td>0.0%</td><td>--</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 class="sub-heading">Correlation matrix</h3>
        <div id="correlationHeatmap" class="mini-chart"></div>
      </div>
    </div>

    <p class="fine-print">
      Weights are computed by code using ${method === 'equal' ? 'equal weighting' : 'inverse volatility'} and are not personal investment advice.
      Correlation and volatility are estimated from daily returns over ${analysis.sampleDays} common trading days, denominated in ${state.baseCurrency} (USD instruments are converted with daily USD/TWD data).
      In-sample results shift with the window, and max drawdown is the historical value for this sample period.
    </p>
  `;

  renderCorrelationHeatmap(analysis);
  setPanelMeta('portfolio', sourceLine([
    `Sample: ${analysis.sampleDays} common trading days`,
    `Base currency: ${state.baseCurrency}`,
    payload.failed?.length ? `Unavailable: ${payload.failed.join(', ')}` : ''
  ]));
}

function renderCorrelationHeatmap(analysis) {
  const container = document.getElementById('correlationHeatmap');
  if (!container || typeof echarts === 'undefined') return;

  if (state.portfolioChartInstance) state.portfolioChartInstance.dispose();
  state.portfolioChartInstance = echarts.init(container);
  const palette = getChartPalette();
  const labels = analysis.symbols.map(symbol => symbol.replace('-USD', '').replace('.TW', ''));

  const data = [];
  analysis.symbols.forEach((_, i) => {
    analysis.symbols.forEach((__, j) => {
      const value = analysis.correlations[i][j];
      data.push([j, i, value == null ? '-' : Number(value.toFixed(2))]);
    });
  });

  state.portfolioChartInstance.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      textStyle: { color: palette.ink },
      formatter: params => `${labels[params.value[1]]} × ${labels[params.value[0]]}<br/>Correlation ${params.value[2]}`
    },
    grid: { left: 70, right: 20, top: 10, bottom: 70 },
    xAxis: { type: 'category', data: labels, axisLabel: { color: palette.muted, rotate: 45, fontSize: 10 }, splitArea: { show: true, areaStyle: { color: [palette.splitArea] } } },
    yAxis: { type: 'category', data: labels, axisLabel: { color: palette.muted, fontSize: 10 }, splitArea: { show: true, areaStyle: { color: [palette.splitArea] } } },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      textStyle: { color: palette.muted },
      // The midpoint tracks the surface color so the matrix does not sit as a
      // light slab inside the dark theme.
      inRange: { color: ['#2f6fed', palette.heatmapMid, '#e5484d'] }
    },
    series: [{
      type: 'heatmap',
      data,
      label: { show: labels.length <= 12, fontSize: 9, color: palette.heatmapLabel },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } }
    }]
  }, true);
}

/* -------------------------------------------------------------- screener */

function readCriteria() {
  return {
    market: document.getElementById('criteriaMarket').value,
    minLiquidity: Number(document.getElementById('criteriaLiquidity').value),
    maxVolatility: Number(document.getElementById('criteriaVolatility').value),
    signal: document.getElementById('criteriaSignal').value,
    trendFilter: document.getElementById('criteriaTrend').value,
    hideStale: document.getElementById('criteriaHideStale').checked
  };
}

function screenerCardHTML(row) {
  const currency = row.currency;
  const status = row.status;
  const signalState = row.signal?.state || '--';

  return `
    <article class="screen-card status-${status.state}" data-symbol="${escapeHTML(row.symbol)}">
      <header class="screen-head">
        <div class="screen-title">
          <span class="screen-symbol">${escapeHTML(row.symbol)}</span>
          <span class="screen-name">${escapeHTML(row.name)}</span>
          ${row.english && row.english !== row.name ? `<span class="screen-english">${escapeHTML(row.english)}</span>` : ''}
        </div>
        <div class="screen-badges">
          <span class="badge badge-review badge-${status.state}">${escapeHTML(status.label)} · ${escapeHTML(status.detail)}</span>
          <span class="badge">${escapeHTML(row.type === 'crypto' ? 'Crypto' : row.market)}</span>
          <span class="badge">${escapeHTML(row.horizon)}</span>
          <span class="badge">Liquidity ${'★'.repeat(row.liquidityStars)}${'☆'.repeat(5 - row.liquidityStars)}</span>
          <span class="badge state-pill state-${signalState.toLowerCase()}">${escapeHTML(signalState)}</span>
        </div>
      </header>

      <div class="screen-metrics">
        <div><span>Idea date</span><strong>${escapeHTML(row.review.entryDate || 'Not set')}</strong></div>
        <div><span>Price at idea</span><strong>${row.review.entryPrice != null ? `${formatNumber(row.review.entryPrice, 2)} ${currency}` : 'Not set'}</strong></div>
        <div><span>Current price</span><strong>${row.lastClose != null ? `${formatNumber(row.lastClose, 2)} ${currency}` : '--'}</strong></div>
        <div><span>Cumulative return</span><strong class="${toneClass(row.sinceReturn)}">${row.sinceReturn == null ? 'Set a price at idea first' : formatSignedPercent(row.sinceReturn)}</strong></div>
        <div><span>Annualized volatility</span><strong>${formatPercent(row.volatility)}</strong></div>
        <div><span>vs. MA120</span><strong>${row.aboveSlowMa == null ? '--' : row.aboveSlowMa ? 'Above' : 'Below'}</strong></div>
      </div>

      <div class="screen-exit">
        <div class="exit-item"><span>Target price</span><strong>${row.review.target != null ? `${formatNumber(row.review.target, 2)} (${formatSignedPercent(row.toTarget)} from current)` : 'Not set'}</strong></div>
        <div class="exit-item"><span>Stop price</span><strong>${row.review.stop != null ? `${formatNumber(row.review.stop, 2)} (${formatSignedPercent(row.toStop)} from current)` : 'Not set'}</strong></div>
        <div class="exit-item exit-invalidation"><span>Invalidation</span><strong>${escapeHTML(row.review.invalidation || row.invalidation)}</strong></div>
      </div>

      <details class="screen-notes">
        <summary>Observation notes (${status.state === 'fresh' ? 'reviewed' : 'not reviewed, for reference only'})</summary>
        <ul>${row.thesis.map(line => `<li>${escapeHTML(line)}</li>`).join('')}</ul>
        <p class="screen-risk">⚠ Risk: ${escapeHTML(row.risk)}</p>
      </details>

      <footer class="screen-actions">
        <button type="button" data-action="load">Load chart</button>
        <button type="button" data-action="edit">Edit entry &amp; exit</button>
        <button type="button" data-action="review">Mark reviewed today</button>
      </footer>
    </article>
  `;
}

function renderScreenerView() {
  if (!screenerList) return;
  const criteria = readCriteria();
  const rows = Screener.buildRows({
    seriesMap: state.universeHistory?.series || {},
    signalsBySymbol: state.universeSignals,
    fxRate: state.fx?.rate || null,
    base: state.baseCurrency
  });
  const filtered = Screener.applyCriteria(rows, criteria);
  const stale = rows.filter(row => row.status.state !== 'fresh').length;

  screenerSummary.innerHTML = `
    <div class="stat-row">
      <div class="stat"><span>Matches</span><strong>${filtered.length} / ${rows.length}</strong></div>
      <div class="stat"><span>Needs review</span><strong class="${stale ? 'negative' : ''}">${stale}</strong></div>
      <div class="stat"><span>Idea price set</span><strong>${rows.filter(row => row.review.entryPrice != null).length}</strong></div>
      <div class="stat"><span>Data status</span><strong>${state.universeHistory ? 'Loaded' : 'Not loaded'}</strong></div>
    </div>
  `;

  screenerList.innerHTML = filtered.length
    ? filtered.map(screenerCardHTML).join('')
    : '<div class="empty-note">No instruments match the current filters; try loosening them.</div>';

  setPanelMeta('screener', sourceLine([
    state.universeHistory ? `Sample window: ${state.universeRange}` : 'History not loaded yet',
    `Flagged for review after ${Screener.STALE_AFTER_DAYS} days without a review`
  ]));
}

function openReviewEditor(symbol) {
  const item = Screener.UNIVERSE.find(entry => entry.symbol === symbol);
  const review = Screener.getReview(symbol);
  if (!item) return;

  modalTitle.textContent = `${item.name} ${symbol} · entry and exit`;
  modalBody.innerHTML = `
    <form id="reviewForm" class="review-form">
      <p class="fine-print">You maintain these fields yourself. They stay in this browser (localStorage) and are never uploaded.</p>
      <label class="control"><span>Idea date</span><input type="date" name="entryDate" value="${escapeHTML(review.entryDate || '')}" /></label>
      <label class="control"><span>Price at idea (${escapeHTML(item.currency)})</span><input type="number" step="any" name="entryPrice" value="${review.entryPrice ?? ''}" /></label>
      <label class="control"><span>Target price</span><input type="number" step="any" name="target" value="${review.target ?? ''}" /></label>
      <label class="control"><span>Stop price</span><input type="number" step="any" name="stop" value="${review.stop ?? ''}" /></label>
      <label class="control control-wide"><span>Invalidation</span><input type="text" name="invalidation" value="${escapeHTML(review.invalidation || item.invalidation)}" /></label>
      <div class="review-actions">
        <button type="submit">Save and mark reviewed</button>
        <button type="button" id="clearReviewBtn" class="ghost-button">Clear settings for this name</button>
      </div>
    </form>
  `;
  openModal();

  document.getElementById('reviewForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    Screener.saveReview(symbol, {
      entryDate: form.get('entryDate') || null,
      entryPrice: form.get('entryPrice') ? Number(form.get('entryPrice')) : null,
      target: form.get('target') ? Number(form.get('target')) : null,
      stop: form.get('stop') ? Number(form.get('stop')) : null,
      invalidation: form.get('invalidation') || null,
      reviewedAt: isoDate(Date.now())
    });
    closeModal();
    renderScreenerView();
  });

  document.getElementById('clearReviewBtn').addEventListener('click', () => {
    Screener.clearReview(symbol);
    closeModal();
    renderScreenerView();
  });
}

/* ---------------------------------------------------------------- report */

/**
 * The report is the one artefact that leaves the browser, so it carries its own
 * language rather than following the interface. Everything the report prints —
 * including the signal drivers and the forecast method — has a Chinese variant
 * generated alongside the English one, so the numbers can never diverge.
 */
const REPORT_LANGUAGES = ['en', 'zh'];

/** Yahoo range codes read as jargon in prose, so the report spells them out. */
const REPORT_RANGE_WORDS = {
  en: { '6mo': '6 months', '1y': '1 year', '2y': '2 years', '5y': '5 years' },
  zh: { '6mo': '6 個月', '1y': '1 年', '2y': '2 年', '5y': '5 年' }
};

function reportRangeLabel(range, lang) {
  return REPORT_RANGE_WORDS[lang]?.[range] || range;
}

const REPORT_COPY = {
  en: {
    locale: 'en-GB',
    documentTitle: 'Investment Platform · Signal report',
    generated: 'Generated',
    pricesIn: 'Prices in',
    signalState: 'Signal state',
    confidence: 'Confidence',
    callout: 'This state is the mechanical output of a moving-average, ADX, volatility, and volume rule set applied to public quotes. It is <strong>not investment advice, not an offer, and not a personal recommendation</strong>. Read the limitations on the last page before acting on anything here.',
    snapshot: 'Market snapshot',
    lastPrice: 'Last price',
    change: 'Change',
    volume: 'Volume',
    lastBar: 'Last bar',
    dataSource: 'Data source',
    dataSourceValue: 'Yahoo Finance, quotes delayed ~15 min, adjusted for splits and dividends',
    indicators: 'Indicators driving the state',
    priceScore: 'Price structure score',
    movingAverages: 'MA20 / MA60 / MA120',
    notEnoughData: 'Not enough data',
    adx: 'ADX(14)',
    atr: 'ATR(14) / price',
    volatilityRank: 'Volatility percentile',
    volumeRatio: 'Volume ratio (20d)',
    levels: 'Reference levels',
    entry: 'Reference entry',
    stop: 'Stop (1.5 ATR or prior support)',
    target: 'Target (2 ATR or prior resistance)',
    riskReward: 'Risk / reward',
    levelsNote: 'Levels are computed from ATR and the highs and lows of the last 20 bars. They are a mechanical risk-control reference, not price targets.',
    holdNote: 'The state is HOLD: the model reads the market as ranging or the signals disagree, so no entry or exit levels are produced.',
    bands: 'Price probability bands',
    horizon: 'Horizon',
    tradingDays: days => `${days} trading days`,
    median: 'Median',
    bandWidth: '80% width',
    noBands: 'Not enough data to estimate a range.',
    trackRecord: 'Track record of this rule set',
    closedSignals: 'Closed signals',
    hitRate: 'Hit rate',
    averagePL: 'Average P/L',
    averageWinLoss: 'Average win / loss',
    averageHolding: 'Average holding days',
    noClosed: 'No closed directional signals in the sample window.',
    trackNote: range => `Measured over ${range} of daily bars, direction x price change, exiting at the next state flip. Price-structure signals only; news sentiment is excluded because no point-in-time news archive exists.`,
    disclaimerHeading: 'Limitations and disclaimer',
    disclaimer: generatedAt => [
      'Every figure is computed by code from delayed public quotes. Nothing here is investment advice, an offer, or a personal recommendation.',
      'BUY / HOLD / SELL are labels for a rule-set state, not instructions. SELL means flat in the backtest, never short.',
      'Returns are pre-tax and exclude slippage and borrow costs. Taiwan equities and crypto are taxed differently, so after-tax ranking can reverse.',
      'Historical hit rates are in-sample and do not predict future performance.',
      `Generated ${generatedAt} from a ${reportRangeLabel(SIGNAL_RANGE, 'en')} daily sample. Verify against your broker before acting.`
    ],
    footerLeft: symbol => `Investment Platform · signal report · ${symbol}`,
    footerRight: generatedAt => `Generated ${generatedAt} · Not investment advice`
  },
  zh: {
    locale: 'zh-TW',
    documentTitle: 'Investment Platform · 訊號報告',
    generated: '產生時間',
    pricesIn: '報價幣別',
    signalState: '訊號狀態',
    confidence: '信心度',
    callout: '此狀態為均線結構、ADX、波動度與量能規則套用於公開報價後的機械式輸出，<strong>不構成投資建議、要約或個別推薦</strong>。採取任何行動前，請先閱讀最後一節的限制說明。',
    snapshot: '市場快照',
    lastPrice: '最新價',
    change: '漲跌',
    volume: '成交量',
    lastBar: '最後一根 K 棒',
    dataSource: '資料來源',
    dataSourceValue: 'Yahoo Finance，報價延遲約 15 分鐘，價格已還原除權息與分割',
    indicators: '影響狀態的指標',
    priceScore: '價格結構分數',
    movingAverages: 'MA20 / MA60 / MA120',
    notEnoughData: '資料不足',
    adx: 'ADX(14)',
    atr: 'ATR(14) / 價格',
    volatilityRank: '波動度分位',
    volumeRatio: '量能比（20 日）',
    levels: '參考價位',
    entry: '參考進場',
    stop: '停損（1.5 ATR 或前波支撐）',
    target: '目標（2 ATR 或前波壓力）',
    riskReward: '風險報酬比',
    levelsNote: '價位由 ATR 與最近 20 根 K 棒的高低點計算，屬機械式風控參考，並非目標價。',
    holdNote: '目前狀態為 HOLD：模型判定為盤整或訊號不一致，因此不提供進出場價位。',
    bands: '價格機率區間',
    horizon: '期間',
    tradingDays: days => `${days} 個交易日`,
    median: '中位數',
    bandWidth: '80% 區間寬度',
    noBands: '資料不足，無法估計區間。',
    trackRecord: '此規則的歷史表現',
    closedSignals: '已結束訊號',
    hitRate: '命中率',
    averagePL: '平均損益',
    averageWinLoss: '平均獲利 / 虧損',
    averageHolding: '平均持有天數',
    noClosed: '樣本期間內沒有已結束的方向性訊號。',
    trackNote: range => `以 ${range}的日線衡量，採「方向 × 價格變動」計算，並以下一次狀態翻轉為出場點。僅涵蓋價格結構訊號；因為沒有可回溯的歷史新聞，故不含新聞情緒。`,
    disclaimerHeading: '限制與免責聲明',
    disclaimer: generatedAt => [
      '所有數字皆由程式依延遲的公開報價計算，不構成投資建議、要約或個別推薦。',
      'BUY / HOLD / SELL 是規則狀態的標籤，不是指令。回測中的 SELL 代表空手，不做空。',
      '報酬均為稅前，且未計入滑價與借券成本。台股與加密資產稅負結構不同，稅後排序可能與稅前相反。',
      '歷史命中率為樣本內結果，不代表未來績效。',
      `本報告產生於 ${generatedAt}，樣本為 ${reportRangeLabel(SIGNAL_RANGE, 'zh')}的日線。採取行動前請與您的券商核對。`
    ],
    footerLeft: symbol => `Investment Platform · 訊號報告 · ${symbol}`,
    footerRight: generatedAt => `產生於 ${generatedAt} · 非投資建議`
  }
};

const REPORT_UI_COPY = {
  en: {
    button: 'Generate PDF report',
    preparing: 'Preparing…',
    hintEnabled: 'The report covers the current signal, indicators, probability bands, and track record. Your browser opens its print dialog — choose "Save as PDF".',
    hintDisabled: 'Search for an instrument to enable the report. It prints the current signal, indicators, probability bands, and track record as a PDF.',
    languageLabel: 'Report language'
  },
  zh: {
    button: '產生 PDF 報告',
    preparing: '準備中…',
    hintEnabled: '報告包含目前訊號、指標、機率區間與歷史表現。瀏覽器會開啟列印視窗，請選擇「另存為 PDF」。',
    hintDisabled: '搜尋標的後即可產生報告。報告會將目前訊號、指標、機率區間與歷史表現輸出為 PDF。',
    languageLabel: '報告語言'
  }
};

function readReportLanguage() {
  try {
    const stored = localStorage.getItem(REPORT_LANGUAGE_KEY);
    return REPORT_LANGUAGES.includes(stored) ? stored : 'en';
  } catch (error) {
    return 'en';
  }
}

function setReportLanguage(language, { persist = true } = {}) {
  const normalized = REPORT_LANGUAGES.includes(language) ? language : 'en';
  state.reportLanguage = normalized;

  reportLanguageButtons.forEach(button => {
    const isActive = button.dataset.reportLang === normalized;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  if (persist) {
    try {
      localStorage.setItem(REPORT_LANGUAGE_KEY, normalized);
    } catch (error) {
      // A blocked storage write only costs the preference, not the feature.
    }
  }

  setReportState({});
}

function setReportState({ enabled = Boolean(state.selectedItem && state.latestSignal), preparing = false } = {}) {
  if (!reportButton) return;
  const ui = REPORT_UI_COPY[state.reportLanguage] || REPORT_UI_COPY.en;

  reportButton.disabled = preparing || !enabled;
  reportButton.classList.toggle('is-loading', preparing);
  reportButton.setAttribute('aria-disabled', String(reportButton.disabled));
  if (reportButtonLabel) reportButtonLabel.textContent = preparing ? ui.preparing : ui.button;
  if (reportLanguageGroup) reportLanguageGroup.setAttribute('aria-label', ui.languageLabel);
  const hint = enabled ? ui.hintEnabled : ui.hintDisabled;
  if (reportHint) reportHint.textContent = hint;
  reportButton.title = hint;
}

function reportRow(label, value) {
  return `<tr><th scope="row">${escapeHTML(label)}</th><td>${value}</td></tr>`;
}

function buildReportHTML(language = state.reportLanguage) {
  const item = state.selectedItem;
  const signal = state.latestSignal;
  const point = signal?.point;
  if (!item || !signal) return '';

  const lang = REPORT_LANGUAGES.includes(language) ? language : 'en';
  const t = REPORT_COPY[lang];
  const currency = currencyOf(item);
  const levels = referenceLevels(point);
  const stats = state.signalHistory?.stats;
  const forecast = state.forecast;
  const generatedAt = formatDateTime(Date.now());
  const stateLabel = lang === 'zh' ? (signal.zhLabel || signal.label) : signal.label;
  const driverText = driver => (lang === 'zh' ? (driver.zh || driver.text) : driver.text);

  const bands = forecast?.available
    ? forecast.horizons.map(h => `
        <tr>
          <td>${escapeHTML(t.tradingDays(h.days))}</td>
          <td>${formatNumber(h.p10, 2)}</td>
          <td>${formatNumber(h.p50, 2)}</td>
          <td>${formatNumber(h.p90, 2)}</td>
          <td>${formatPercent(h.widthPercent)}</td>
        </tr>`).join('')
    : '';
  const forecastNote = forecast?.available
    ? (lang === 'zh' ? (forecast.zhMethod || forecast.method) : forecast.method)
    : (lang === 'zh' ? (forecast?.zhReason || t.noBands) : (forecast?.reason || t.noBands));

  return `
    <article class="report-page" lang="${lang === 'zh' ? 'zh-Hant' : 'en'}">
      <header class="report-head">
        <div>
          <p class="report-eyebrow">${escapeHTML(t.documentTitle)}</p>
          <h1>${escapeHTML(item.name || item.symbol)} <span>${escapeHTML(item.symbol)}</span></h1>
          <p class="report-sub">
            ${escapeHTML(item.market || (item.type === 'crypto' ? 'Crypto' : ''))} ·
            ${escapeHTML(t.generated)} ${escapeHTML(generatedAt)} ·
            ${escapeHTML(t.pricesIn)} ${escapeHTML(currency)}
          </p>
        </div>
        <div class="report-state report-state-${escapeHTML(signal.tone)}">
          <span>${escapeHTML(t.signalState)}</span>
          <strong>${escapeHTML(stateLabel)}</strong>
          <span>${escapeHTML(t.confidence)} ${signal.confidence == null ? '--' : `${Math.round(signal.confidence)} / 100`}</span>
        </div>
      </header>

      <p class="report-callout">${t.callout}</p>

      <section class="report-section">
        <h2>${escapeHTML(t.snapshot)}</h2>
        <table class="report-table">
          <tbody>
            ${reportRow(t.lastPrice, `${escapeHTML(String(item.price ?? '--'))} ${escapeHTML(currency)}`)}
            ${reportRow(t.change, `${escapeHTML(String(item.change ?? '--'))} (${escapeHTML(String(item.percent ?? '--'))})`)}
            ${reportRow(t.volume, escapeHTML(String(item.volume ?? '--')))}
            ${reportRow(t.lastBar, escapeHTML(String(item.lastBarLabel ?? '--')))}
            ${reportRow(t.dataSource, escapeHTML(t.dataSourceValue))}
          </tbody>
        </table>
      </section>

      <section class="report-section">
        <h2>${escapeHTML(t.indicators)}</h2>
        <table class="report-table">
          <tbody>
            ${reportRow(t.priceScore, `${signal.priceScore > 0 ? '+' : ''}${signal.priceScore}`)}
            ${reportRow(t.movingAverages, `${formatNumber(point?.maFast, 2)} / ${formatNumber(point?.maMid, 2)} / ${point?.maSlow != null ? formatNumber(point.maSlow, 2) : escapeHTML(t.notEnoughData)}`)}
            ${reportRow(t.adx, point?.adx != null ? formatNumber(point.adx, 1) : '--')}
            ${reportRow(t.atr, formatPercent(point?.atrPercent, 2))}
            ${reportRow(t.volatilityRank, point?.volatilityRank != null ? formatPercent(point.volatilityRank, 0) : '--')}
            ${reportRow(t.volumeRatio, point?.volumeRatio != null ? `${formatNumber(point.volumeRatio, 2)}x` : '--')}
          </tbody>
        </table>
        <ul class="report-drivers">
          ${signal.drivers.map(d => `<li class="driver-${d.weight > 0 ? 'positive' : d.weight < 0 ? 'negative' : 'neutral'}">${escapeHTML(driverText(d))}</li>`).join('')}
        </ul>
      </section>

      <section class="report-section">
        <h2>${escapeHTML(t.levels)}</h2>
        ${levels ? `
          <table class="report-table">
            <tbody>
              ${reportRow(t.entry, `${formatNumber(levels.entry, 2)} ${escapeHTML(currency)}`)}
              ${reportRow(t.stop, `${formatNumber(levels.stop, 2)} ${escapeHTML(currency)}`)}
              ${reportRow(t.target, `${formatNumber(levels.target, 2)} ${escapeHTML(currency)}`)}
              ${reportRow(t.riskReward, `${formatNumber(Math.abs(levels.target - levels.entry) / Math.abs(levels.entry - levels.stop), 2)} : 1`)}
            </tbody>
          </table>
          <p class="report-note">${escapeHTML(t.levelsNote)}</p>
        ` : `<p class="report-note">${escapeHTML(t.holdNote)}</p>`}
      </section>

      <section class="report-section">
        <h2>${escapeHTML(t.bands)}</h2>
        ${bands ? `
          <table class="report-table report-table-grid">
            <thead><tr><th>${escapeHTML(t.horizon)}</th><th>P10</th><th>${escapeHTML(t.median)}</th><th>P90</th><th>${escapeHTML(t.bandWidth)}</th></tr></thead>
            <tbody>${bands}</tbody>
          </table>
        ` : ''}
        <p class="report-note">${escapeHTML(forecastNote)}</p>
      </section>

      <section class="report-section">
        <h2>${escapeHTML(t.trackRecord)}</h2>
        ${stats && stats.total ? `
          <table class="report-table report-table-grid">
            <thead><tr>
              <th>${escapeHTML(t.closedSignals)}</th>
              <th>${escapeHTML(t.hitRate)}</th>
              <th>${escapeHTML(t.averagePL)}</th>
              <th>${escapeHTML(t.averageWinLoss)}</th>
              <th>${escapeHTML(t.averageHolding)}</th>
            </tr></thead>
            <tbody>
              <tr>
                <td>${stats.total}</td>
                <td>${formatPercent(stats.hitRate)}</td>
                <td>${formatSignedPercent(stats.averageReturn)}</td>
                <td>${formatSignedPercent(stats.averageWin)} / ${formatSignedPercent(stats.averageLoss)}</td>
                <td>${formatNumber(stats.averageHoldingDays, 0)}</td>
              </tr>
            </tbody>
          </table>
        ` : `<p class="report-note">${escapeHTML(t.noClosed)}</p>`}
        <p class="report-note">${escapeHTML(t.trackNote(reportRangeLabel(SIGNAL_RANGE, lang)))}</p>
      </section>

      <section class="report-section report-disclaimer">
        <h2>${escapeHTML(t.disclaimerHeading)}</h2>
        <ul>
          ${t.disclaimer(generatedAt).map(line => `<li>${escapeHTML(line)}</li>`).join('')}
        </ul>
      </section>

      <footer class="report-footer">
        <span>${escapeHTML(t.footerLeft(item.symbol))}</span>
        <span>${escapeHTML(t.footerRight(generatedAt))}</span>
      </footer>
    </article>
  `;
}

function generateReport() {
  if (!state.selectedItem || !state.latestSignal || !reportSheet) return;
  setReportState({ preparing: true });
  reportSheet.innerHTML = buildReportHTML();
  reportSheet.setAttribute('aria-hidden', 'false');
  reportSheet.lang = state.reportLanguage === 'zh' ? 'zh-Hant' : 'en';

  const done = () => {
    reportSheet.setAttribute('aria-hidden', 'true');
    setReportState({});
  };

  // afterprint does not fire in every browser, so the reset is also queued.
  window.addEventListener('afterprint', done, { once: true });
  window.setTimeout(() => {
    try {
      window.print();
    } finally {
      window.setTimeout(done, 500);
    }
  }, 50);
}

/* ---------------------------------------------------------------- modals */

/* The body lock stops the page behind the overlay from scrolling, which is
 * what produced two scrollbars side by side. */
function openModal() {
  strategyModal.classList.add('show');
  document.body.classList.add('modal-open');
}

function closeModal() {
  strategyModal.classList.remove('show');
  document.body.classList.remove('modal-open');
}

function showMethodologyModal() {
  modalTitle.textContent = 'Methodology';
  modalBody.innerHTML = `
    <div class="analysis-section">
      <h3>How the signal is computed</h3>
      <ul class="doc-list">
        <li>Data: Yahoo Finance daily bars, adjusted close for splits and dividends; quotes delayed about 15 minutes.</li>
        <li>Trend structure: MA20 / MA60 / MA120 alignment scores ±2 when all three point the same way, plus ±1 for close versus MA120.</li>
        <li>Trend strength: ADX(14) ≥ 25 adds 1 point; ADX(14) &lt; ${SignalEngine.ADX_TREND_FLOOR} marks the market as ranging and every directional signal is downgraded to HOLD.</li>
        <li>Volume: when volume is at least 1.5x the 20-day average, ±1 point is added in the current direction.</li>
        <li>State thresholds: score ≥ +3 is BUY, ≤ −3 is SELL, anything else is HOLD.</li>
        <li>Confidence = score strength x trend-strength factor x volatility-percentile factor, mapped to 0–100; high-volatility regimes push confidence down.</li>
        <li>News sentiment only nudges confidence (±5 per point) and <strong>never changes the state</strong>; historical statistics exclude news entirely.</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>How the price bands are computed</h3>
      <ul class="doc-list">
        <li>The model is a random walk: the median carries only shrunken historical drift (x0.25, capped at ±0.4%/day).</li>
        <li>Bands are the P10 / P25 / P75 / P90 quantiles from realized volatility scaled by √t.</li>
        <li>This site gives <strong>no single price target</strong>, because point forecasts from short samples are not accurate enough to justify one.</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>Backtest rules</h3>
      <ul class="doc-list">
        <li>Signals fire at the T close and positions open at T+1, so no bar uses its own information.</li>
        <li>Long or flat only; SELL means exit, not short.</li>
        <li>Costs: Taiwan equities pay 0.1425% commission (both sides, undiscounted) plus 0.3% securities transaction tax on sales; crypto pays a 0.1% taker fee on both sides.</li>
        <li>Buy &amp; hold also pays one-way entry and exit costs, so both are compared on the same basis.</li>
        <li>Slippage, borrow fees, and tax differences are excluded; in-sample results do not predict future performance.</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>Portfolio risk</h3>
      <ul class="doc-list">
        <li>Weights default to inverse volatility (risk parity) so high-volatility names cannot dominate portfolio risk; equal weighting is also available.</li>
        <li>Correlation, volatility, and max drawdown come from daily returns on common trading days, with USD instruments converted to the base currency using daily USD/TWD data.</li>
        <li>"Effective bets" is the square of the diversification ratio (weighted average volatility ÷ portfolio volatility)². It collapses highly correlated holdings into a single bet, so a number far below the position count means the list looks diversified but is really one factor bet.</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>Known limitations</h3>
      <ul class="doc-list">
        <li>There is no built-in Taiwan holiday calendar, so non-trading days show as closed with the timestamp of the last bar.</li>
        <li>News sentiment is keyword scoring rather than a semantic model, so it handles sarcasm and complex sentences poorly.</li>
        <li>The free quote source can fail under load; the server caches and rate-limits requests, but empty states are still possible.</li>
      </ul>
    </div>
  `;
  openModal();
}

function showTaxModal() {
  modalTitle.textContent = 'Currency and tax notes';
  modalBody.innerHTML = `
    <div class="analysis-section">
      <h3>Currency</h3>
      <ul class="doc-list">
        <li>Taiwan equities are quoted in TWD and crypto in USD; the toggle above converts both to a single base currency.</li>
        <li>Conversion uses Yahoo Finance daily USD/TWD data, and portfolio correlation and volatility are computed on the converted series.</li>
        <li>FX moves are themselves a source of return: measured in TWD, a USD asset's return includes currency gains and losses.</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>Tax differences (general information, not tax advice)</h3>
      <ul class="doc-list">
        <li>Taiwan equities: capital gains tax on securities is currently suspended; sales incur a 0.3% securities transaction tax; <strong>dividend income</strong> is folded into personal income tax (or taxed separately) and also triggers the second-generation NHI supplementary premium.</li>
        <li>Crypto assets: gains and losses realized through offshore exchanges are in practice usually classed as <strong>overseas income</strong>, which falls under the alternative minimum tax threshold; trading through a domestic operator may instead count as domestic income.</li>
        <li>The two tax structures differ, so <strong>the after-tax ranking can reverse the pre-tax ranking</strong>; every return figure on this site is pre-tax.</li>
        <li>Individual circumstances vary widely, so consult an accountant or the tax authority before filing. This section is general information, not tax advice.</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>Regulatory position</h3>
      <ul class="doc-list">
        <li>This site provides <strong>the output of user-defined filters and quantitative calculations</strong>. It makes no individual recommendations, manages no money, and charges no advisory fee.</li>
        <li>In Taiwan, offering analysis or recommendations on individual securities to the general public can fall under the licensing requirements of the Securities Investment Trust and Consulting Act. Get local legal advice before opening this to the public or commercializing it.</li>
      </ul>
    </div>
  `;
  openModal();
}

/* ------------------------------------------------------------ data flow */

function setRefreshState({ loading = false, message = '', enabled = Boolean(state.selectedItem) } = {}) {
  state.isRefreshing = loading;
  if (refreshButton) {
    refreshButton.disabled = loading || !enabled;
    refreshButton.classList.toggle('is-loading', loading);
    refreshButton.textContent = loading ? 'Refreshing…' : 'Refresh';
  }
  if (refreshStatus && message) refreshStatus.textContent = message;
}

function recomputeSignal() {
  state.signalSeries = SignalEngine.computeSignalSeries(state.signalBars);
  state.signalHistory = SignalEngine.signalHistory(state.signalSeries.points);
  state.latestSignal = SignalEngine.latestSignal(state.signalSeries, state.currentNews, state.selectedItem);
  state.forecast = Forecast.computeForecastFan(state.signalBars);
  renderStrategySignal();
  renderSignalHistoryView();
  setReportState({});
}

async function loadMarketData(symbol) {
  const requestId = ++state.marketDataRequestId;
  const interval = state.currentInterval;
  const range = state.currentRange;

  const [displayResult, signalResult, newsResult, profileResult] = await Promise.allSettled([
    fetchJson(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`),
    fetchJson(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${SIGNAL_INTERVAL}&range=${SIGNAL_RANGE}`),
    fetchJson(`/api/news?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`/api/profile?symbol=${encodeURIComponent(symbol)}`).catch(() => null)
  ]);

  if (requestId !== state.marketDataRequestId || state.selectedItem?.symbol !== symbol) return false;

  const displayData = displayResult.status === 'fulfilled' ? displayResult.value?.data || [] : [];
  state.currentNews = newsResult.status === 'fulfilled' && Array.isArray(newsResult.value) ? newsResult.value : [];
  state.signalBars = signalResult.status === 'fulfilled' ? signalResult.value?.data || [] : displayData;

  recomputeSignal();

  if (displayData.length) {
    state.currentChartData = displayData;
    renderChart(displayData, state.selectedItem);
    updateSummaryFromChart(displayData);
  } else {
    state.currentChartData = [];
    renderChartEmptyState('No chart data', 'Price history for this instrument could not be loaded.');
  }

  const website = profileResult.status === 'fulfilled' ? profileResult.value?.website || null : null;
  state.currentWebsite = website;
  renderCompanyWebsite(website);
  renderNews(state.currentNews);

  const newestNews = state.latestSignal?.newsSentiment?.newestTimestamp;
  setPanelMeta('chart', sourceLine([
    marketNoteFor(state.selectedItem),
    `Last bar: ${formatDateTime(displayData[displayData.length - 1]?.timestamp)}`
  ]));
  setPanelMeta('news', sourceLine([
    `${state.currentNews.length} headlines after dedupe, ${state.latestSignal?.newsSentiment?.counted ?? 0} matched to this instrument`,
    newestNews ? `Latest headline: ${formatDateTime(newestNews)}` : 'No publish times available'
  ]));

  if (state.activeView === 'backtest') renderBacktestView();
  return true;
}

function renderCompanyWebsite(website) {
  if (!websiteBox) return;
  if (!website && !state.selectedItem) {
    websiteBox.innerHTML = '';
    return;
  }
  websiteBox.innerHTML = `
    <div class="website-box">
      <strong>Official website</strong>
      ${website ? `<a href="${safeExternalUrl(website)}" target="_blank" rel="noopener noreferrer">${escapeHTML(website)}</a>` : '<span>Not available</span>'}
    </div>
  `;
}

async function refreshCurrentMarketData() {
  if (!state.selectedItem?.symbol || state.isRefreshing) return;
  const symbol = state.selectedItem.symbol;
  setRefreshState({ loading: true, message: `Refreshing ${symbol}…` });

  let message = '';
  try {
    await loadMarketData(symbol);
    message = `Updated at ${new Date().toLocaleTimeString('en-GB', { hour12: false })}.`;
  } catch (error) {
    message = 'Refresh failed; try again shortly.';
  } finally {
    setRefreshState({ loading: false, message });
    renderSourceBar();
  }
}

function restartAutoRefresh(symbol) {
  [state.strategyRefreshTimer, state.marketRefreshTimer].forEach(timer => timer && clearInterval(timer));
  state.strategyRefreshTimer = null;
  state.marketRefreshTimer = null;
  if (!symbol) return;

  state.marketRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    refreshCurrentMarketData();
  }, AUTO_REFRESH_MS);
}

function setActiveTab(interval, range) {
  state.currentInterval = interval;
  state.currentRange = range;
  Array.from(timeTabs.children).forEach(button => {
    button.classList.toggle('active', button.dataset.interval === interval && button.dataset.range === range);
  });
}

function selectItem(item) {
  state.selectedItem = { ...item, website: null };
  state.currentWebsite = null;
  state.signalBars = [];
  state.signalSeries = null;
  state.signalHistory = null;
  state.latestSignal = null;
  state.forecast = null;

  setRefreshState({ loading: true, message: `Loading ${item.symbol}…`, enabled: true });
  saveHistory(item.symbol || item.english || item.name);
  searchInput.value = item.symbol || item.english || item.name || searchInput.value;
  suggestionList.innerHTML = '';
  renderStrategySignal();
  renderSignalHistoryView();
  renderCompanyWebsite(null);
  buildSummary({
    name: item.name,
    symbol: item.symbol,
    market: item.market || (item.type === 'crypto' ? 'Crypto' : 'Taiwan Stock'),
    type: item.type
  });
  setActiveTab('1d', '1mo');
  restartAutoRefresh(item.symbol);

  loadMarketData(item.symbol)
    .then(loaded => {
      if (loaded !== false && state.selectedItem?.symbol === item.symbol) {
        setRefreshState({ loading: false, message: `Updated at ${new Date().toLocaleTimeString('en-GB', { hour12: false })}.` });
      }
    })
    .catch(() => {
      if (state.selectedItem?.symbol === item.symbol) {
        setRefreshState({ loading: false, message: 'Initial load failed; press Refresh.' });
      }
    });
}

/* ----------------------------------------------------------------- views */

function setActiveView(view) {
  state.activeView = view;
  Array.from(viewTabs.children).forEach(button => {
    const isActive = button.dataset.view === view;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('[data-view-panel]').forEach(panel => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });

  if (view === 'backtest') renderBacktestView();
  if (view === 'portfolio') renderPortfolioView();
  if (view === 'screener' && !state.universeHistory) {
    loadUniverseHistory(document.getElementById('portfolioRange').value)
      .then(renderScreenerView)
      .catch(() => renderScreenerView());
  }
  if (state.chartInstance) state.chartInstance.resize();
}

/* ------------------------------------------------------------- listeners */

searchButton.addEventListener('click', () => performSearch(searchInput.value, { autoSelect: true }));

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
    state.searchRequestId += 1;
    suggestionList.innerHTML = '';
  }
});

timeTabs.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !state.selectedItem) return;
  setActiveTab(button.dataset.interval, button.dataset.range);
  loadMarketData(state.selectedItem.symbol);
});

viewTabs.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button) setActiveView(button.dataset.view);
});

refreshButton?.addEventListener('click', refreshCurrentMarketData);
reportButton?.addEventListener('click', generateReport);
reportLanguageButtons.forEach(button => {
  button.addEventListener('click', () => setReportLanguage(button.dataset.reportLang));
});

themeButtons.forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeOption)));
baseCurrencyButtons.forEach(button => button.addEventListener('click', () => setBaseCurrency(button.dataset.base)));

backtestControls.addEventListener('submit', event => {
  event.preventDefault();
  renderBacktestView();
});

portfolioControls.addEventListener('submit', event => {
  event.preventDefault();
  state.universeHistory = null;
  renderPortfolioView();
});

screenerControls.addEventListener('change', renderScreenerView);

screenerList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const symbol = button.closest('[data-symbol]')?.dataset.symbol;
  const item = Screener.UNIVERSE.find(entry => entry.symbol === symbol);
  if (!item) return;

  if (button.dataset.action === 'load') {
    setActiveView('overview');
    selectItem({ symbol: item.symbol, name: item.name, english: item.english, type: item.type, market: item.market });
  } else if (button.dataset.action === 'edit') {
    openReviewEditor(symbol);
  } else if (button.dataset.action === 'review') {
    Screener.saveReview(symbol, { reviewedAt: isoDate(Date.now()) });
    renderScreenerView();
  }
});

document.getElementById('methodologyBtn').addEventListener('click', showMethodologyModal);
document.getElementById('taxNoteBtn').addEventListener('click', showTaxModal);
modalCloseBtn.addEventListener('click', closeModal);
strategyModal.addEventListener('click', event => {
  if (event.target === strategyModal) closeModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
});

window.addEventListener('resize', () => {
  state.chartInstance?.resize();
  state.backtestChartInstance?.resize();
  state.portfolioChartInstance?.resize();
});

window.addEventListener('beforeunload', () => {
  [state.strategyRefreshTimer, state.marketRefreshTimer].forEach(timer => timer && clearInterval(timer));
});

/* ------------------------------------------------------------------ init */

function initTheme() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', { persist: false });
}

function initBaseCurrency() {
  let stored = 'TWD';
  try {
    stored = localStorage.getItem(BASE_CURRENCY_KEY) || 'TWD';
  } catch (error) {
    stored = 'TWD';
  }
  setBaseCurrency(stored, { persist: false });
}

function initBacktestDates() {
  const to = new Date();
  const from = new Date(to.getTime() - 730 * 86400000);
  document.getElementById('backtestFrom').value = isoDate(from.getTime());
  document.getElementById('backtestTo').value = isoDate(to.getTime());
}

initTheme();
initBaseCurrency();
initBacktestDates();
buildSummary(defaultSummary);
renderChartEmptyState();
renderStrategySignal();
renderSignalHistoryView();
renderScreenerView();
setRefreshState({ enabled: false });
setReportLanguage(readReportLanguage(), { persist: false });
setReportState({ enabled: false });
loadHistory();
loadMarketStatus();
loadFxRate();
setPanelMeta('chart', sourceLine());
setPanelMeta('news', sourceLine());
setPanelMeta('backtest', sourceLine());
setPanelMeta('portfolio', sourceLine());

window.selectItem = selectItem;
