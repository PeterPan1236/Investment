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
const SIGNAL_INTERVAL = '1d';
const SIGNAL_RANGE = '2y';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const state = {
  searchHistory: [],
  selectedItem: null,
  currentInterval: '1d',
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
  return ['資料來源：Yahoo Finance', '報價延遲約 15 分鐘', '價格已還原除權息／分割', ...extra];
}

function renderSourceBar() {
  const updated = document.getElementById('sourceUpdated');
  if (updated) updated.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  const twNode = document.getElementById('marketStatusTw');
  if (twNode && state.marketStatus?.taiwan) {
    twNode.textContent = `${state.marketStatus.taiwan.label}（${state.marketStatus.taiwan.session}）`;
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
  if (currencyOf(item) === 'USD') return 'Crypto 24/7 交易';
  const status = state.marketStatus?.taiwan;
  if (!status) return '';
  return status.state === 'open' ? '台股盤中' : `台股${status.label}，顯示為最後收盤資料`;
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
    historyList.innerHTML = '<div class="chip is-empty">尚無查詢紀錄</div>';
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
    suggestionList.innerHTML = '<div class="suggestion-item">搜尋服務暫時無法使用。</div>';
    return;
  }

  if (requestId !== state.searchRequestId) return;
  suggestionList.innerHTML = '';

  if (!items.length) {
    suggestionList.innerHTML = '<div class="suggestion-item">查無符合的股票或加密資產。</div>';
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
    volume: cssVar('--chart-volume', 'rgba(0, 122, 255, 0.34)')
  };
}

function renderChartEmptyState(title = '選擇一檔標的', body = '搜尋標的以載入價格、成交量與均線。') {
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
    renderChartEmptyState('沒有圖表資料', '目前無法取得此標的的價格歷史。');
    return;
  }

  if (typeof echarts === 'undefined') {
    renderChartEmptyState('圖表無法載入', '圖表函式庫載入失敗，其餘市場資料仍可使用。');
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
    legend: { data: ['Candles', 'MA20', 'MA60', 'MA200', 'Volume'], top: 32, textStyle: { color: palette.muted } },
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
      { name: 'MA20', type: 'line', data: movingAverageSeries(closeValues, 20), smooth: true, lineStyle: { color: palette.ma5, opacity: 0.9 }, symbol: 'none' },
      { name: 'MA60', type: 'line', data: movingAverageSeries(closeValues, 60), smooth: true, lineStyle: { color: palette.ma10, opacity: 0.9 }, symbol: 'none' },
      { name: 'MA200', type: 'line', data: movingAverageSeries(closeValues, 200), smooth: true, lineStyle: { color: palette.ma20, opacity: 0.9 }, symbol: 'none' },
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
      <div class="summary-title">${escapeHTML(data.name || '選擇一檔標的')}</div>
      ${data.symbol ? `<span class="summary-note">${escapeHTML(marketNoteFor(data))}</span>` : ''}
    </div>
    <div class="summary-row grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5">
      <div class="summary-card">
        <strong>代號 / 市場</strong>
        <div class="value">${escapeHTML(data.symbol || '--')} / ${escapeHTML(data.market || (data.type === 'crypto' ? 'Crypto' : '--'))}</div>
      </div>
      <div class="summary-card">
        <strong>最新價 (${escapeHTML(nativeCurrency)})</strong>
        <div class="value">${escapeHTML(data.price ?? '--')}</div>
        ${baseLine}
      </div>
      <div class="summary-card">
        <strong>漲跌</strong>
        <div class="value ${toneClass(data.changeRatio)}">${escapeHTML(data.change ?? '--')} (${escapeHTML(data.percent ?? '--')})</div>
      </div>
      <div class="summary-card">
        <strong>成交量</strong>
        <div class="value">${escapeHTML(data.volume ?? '--')}</div>
      </div>
      <div class="summary-card">
        <strong>最後一根 K 棒</strong>
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
    newsList.innerHTML = '<div class="news-item">目前沒有可用的相關新聞。</div>';
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
          ? `<span class="sentiment-tag sentiment-${sentiment.tone}">${sentiment.tone === 'positive' ? '正面' : sentiment.tone === 'negative' ? '負面' : '中性'} ${sentiment.net >= 0 ? '+' : ''}${sentiment.net}</span>`
          : '<span class="sentiment-tag sentiment-neutral">泛市場 · 未計入</span>'}
      </div>
      <div class="news-meta">
        <span>${escapeHTML(relevant ? item.symbol || state.selectedItem?.symbol || '' : '未對應到此標的')}</span>
        <span>${escapeHTML(item.publisher || '未標示來源')}</span>
        <span>${publishedAt ? escapeHTML(formatDateTime(publishedAt)) : '無發布時間'}</span>
      </div>
      ${item.summary ? `<p>${escapeHTML(item.summary)}</p>` : ''}
    `;
    newsList.appendChild(block);
  });
}

/* --------------------------------------------------------------- signal */

function renderForecastFan(forecast) {
  if (!forecast?.available) {
    return `<div class="forecast-empty">${escapeHTML(forecast?.reason || '資料不足，無法估計區間。')}</div>`;
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
            <div class="forecast-label">${item.days} 個交易日</div>
            <div class="forecast-band" role="img" aria-label="P10 ${formatNumber(item.p10, 2)}、中位數 ${formatNumber(item.p50, 2)}、P90 ${formatNumber(item.p90, 2)}">
              <span class="band-box" style="left:${boxLeft.toFixed(2)}%;width:${boxWidth.toFixed(2)}%"></span>
              <span class="band-median" style="left:${medianOffset.toFixed(2)}%"></span>
            </div>
            <div class="forecast-scale">
              <span>P10 ${formatNumber(item.p10, 2)}</span>
              <span>P50 ${formatNumber(item.p50, 2)}</span>
              <span>P90 ${formatNumber(item.p90, 2)}</span>
            </div>
            <div class="forecast-width">80% 區間寬度 ≈ ${formatPercent(item.widthPercent)}</div>
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
        <span>信心度</span>
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
          <h2>訊號引擎</h2>
          <p>選擇標的後，將以 20/60/200 日均線結構、ADX 趨勢強度、波動度分位與量能計算訊號。</p>
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
        <h2>訊號引擎</h2>
        <p>
          多週期均線排列（MA${SignalEngine.MA_FAST}/${SignalEngine.MA_MID}/${SignalEngine.MA_SLOW}）＋ ADX 趨勢強度門檻
          ＋ ATR 波動度分位 ＋ 量能確認。ADX 低於 ${SignalEngine.ADX_TREND_FLOOR} 時判定為盤整，方向訊號會被抑制。非個別投資建議。
        </p>
      </div>
      <div class="strategy-actions flex flex-wrap items-center justify-stretch md:justify-end gap-2.5 w-full md:w-auto">
        <div class="strategy-badge w-full md:w-auto">${escapeHTML(signal.label)}</div>
        <button class="view-details-btn w-full md:w-auto" id="viewDetailsBtn" type="button">技術細節</button>
      </div>
    </div>

    <div class="strategy-summary">
      ${confidenceBar(signal.confidence)}
      <div class="signal-metrics">
        <div><span>價格結構分數</span><strong>${signal.priceScore > 0 ? '+' : ''}${signal.priceScore}</strong></div>
        <div><span>ADX(14)</span><strong>${point?.adx != null ? formatNumber(point.adx, 1) : '--'}</strong></div>
        <div><span>ATR 波動分位</span><strong>${point?.volatilityRank != null ? formatPercent(point.volatilityRank, 0) : '--'}</strong></div>
        <div><span>量能比 (20日)</span><strong>${point?.volumeRatio != null ? `${formatNumber(point.volumeRatio, 2)}x` : '--'}</strong></div>
      </div>
    </div>

    <div class="forecast-panel">
      <div class="forecast-heading">
        <h3>價格機率區間</h3>
        <span>顯示分布，不提供單一目標價</span>
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
    signalHistoryBody.innerHTML = '<div class="empty-note">選擇標的後顯示歷史訊號與命中率。</div>';
    setPanelMeta('signal', sourceLine());
    return;
  }

  const { flips, stats } = state.signalHistory;
  const directional = flips.filter(flip => flip.state !== 'HOLD');

  if (!directional.length) {
    signalHistoryBody.innerHTML = '<div class="empty-note">此區間內沒有方向性訊號翻轉（模型多數時間判定為盤整）。</div>';
  } else {
    const statsHTML = stats ? `
      <div class="stat-row">
        <div class="stat"><span>已結束訊號</span><strong>${stats.total}</strong></div>
        <div class="stat"><span>命中率</span><strong class="${stats.hitRate >= 0.5 ? 'positive' : 'negative'}">${formatPercent(stats.hitRate)}</strong></div>
        <div class="stat"><span>平均每次損益</span><strong class="${toneClass(stats.averageReturn)}">${formatSignedPercent(stats.averageReturn)}</strong></div>
        <div class="stat"><span>平均獲利 / 虧損</span><strong>${formatSignedPercent(stats.averageWin)} / ${formatSignedPercent(stats.averageLoss)}</strong></div>
        <div class="stat"><span>平均持有天數</span><strong>${formatNumber(stats.averageHoldingDays, 0)}</strong></div>
        <div class="stat"><span>BUY / SELL 次數</span><strong>${stats.buyCount} / ${stats.sellCount}</strong></div>
      </div>
    ` : '<div class="empty-note">尚無已結束的方向性訊號可統計。</div>';

    const rows = directional.slice().reverse().map(flip => `
      <tr>
        <td>${escapeHTML(formatDate(flip.timestamp))}</td>
        <td><span class="state-pill state-${flip.state.toLowerCase()}">${flip.state}</span></td>
        <td>${formatNumber(flip.price, 2)}</td>
        <td>${flip.open ? '持續中' : escapeHTML(formatDate(flip.exitTimestamp))}</td>
        <td>${flip.open ? '--' : formatNumber(flip.exitPrice, 2)}</td>
        <td>${flip.holdingDays}</td>
        <td class="${toneClass(flip.signalReturn)}">${flip.open ? '未結算' : formatSignedPercent(flip.signalReturn)}</td>
      </tr>
    `).join('');

    signalHistoryBody.innerHTML = `
      ${statsHTML}
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>訊號日期</th><th>狀態</th><th>訊號價</th><th>結束日期</th><th>結束價</th><th>持有天數</th><th>訊號報酬</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="fine-print">
        訊號報酬以「方向 × 價格變動」計算：SELL 之後下跌視為命中。統計僅涵蓋價格結構訊號，
        不含新聞情緒（沒有可回溯的歷史新聞，納入會高估命中率）。此為歷史結果，不代表未來績效。
      </p>
    `;
  }

  setPanelMeta('signal', sourceLine([
    `樣本：${state.selectedItem.symbol} ${SIGNAL_RANGE} 日線`,
    `最後一根 K 棒：${formatDate(state.signalBars[state.signalBars.length - 1]?.timestamp)}`
  ]));
}

function showTechnicalModal() {
  const point = state.latestSignal?.point;
  if (!point) return;

  const closes = state.signalBars.map(bar => Number(bar.adjClose ?? bar.close));
  const rsiSeries = TA.rsi(closes, 14);
  const rsi = rsiSeries[rsiSeries.length - 1];
  const recent = state.signalBars.slice(-20);
  const support = Math.min(...recent.map(bar => Number(bar.low)));
  const resistance = Math.max(...recent.map(bar => Number(bar.high)));
  const atr = point.atr;

  const levels = point.state === 'BUY'
    ? { entry: point.close, stop: Math.min(support - atr * 0.1, point.close - atr * 1.5), target: Math.max(resistance + atr * 0.1, point.close + atr * 2) }
    : point.state === 'SELL'
      ? { entry: point.close, stop: Math.max(resistance + atr * 0.1, point.close + atr * 1.5), target: Math.min(support - atr * 0.1, point.close - atr * 2) }
      : null;

  modalTitle.textContent = `${state.selectedItem?.name || ''} ${state.selectedItem?.symbol || ''} 技術細節`;
  modalBody.innerHTML = `
    <div class="analysis-section">
      <h3>指標數值</h3>
      <div class="analysis-metrics grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
        <div class="metric-card"><div class="metric-label">收盤（還原）</div><div class="metric-value">${formatNumber(point.close, 2)}</div></div>
        <div class="metric-card"><div class="metric-label">MA20 / MA60</div><div class="metric-value" style="font-size:1rem;">${formatNumber(point.maFast, 2)} / ${formatNumber(point.maMid, 2)}</div></div>
        <div class="metric-card"><div class="metric-label">MA200</div><div class="metric-value">${point.maSlow != null ? formatNumber(point.maSlow, 2) : '資料不足'}</div></div>
        <div class="metric-card"><div class="metric-label">ADX(14)</div><div class="metric-value">${point.adx != null ? formatNumber(point.adx, 1) : '--'}</div></div>
        <div class="metric-card"><div class="metric-label">RSI(14)</div><div class="metric-value ${rsi > 70 ? 'negative' : rsi < 30 ? 'positive' : ''}">${formatNumber(rsi, 1)}</div></div>
        <div class="metric-card"><div class="metric-label">ATR(14) / 價格</div><div class="metric-value">${formatPercent(point.atrPercent, 2)}</div></div>
        <div class="metric-card"><div class="metric-label">波動度分位</div><div class="metric-value">${point.volatilityRank != null ? formatPercent(point.volatilityRank, 0) : '--'}</div></div>
        <div class="metric-card"><div class="metric-label">量能比</div><div class="metric-value">${point.volumeRatio != null ? `${formatNumber(point.volumeRatio, 2)}x` : '--'}</div></div>
      </div>
    </div>

    <div class="analysis-section">
      <h3>參考出場條件</h3>
      <div class="recommendation-box">
        ${levels ? `
          <div class="recommendation-item"><div class="recommendation-label">參考進場</div><div class="recommendation-value">${formatNumber(levels.entry, 2)}</div></div>
          <div class="recommendation-item"><div class="recommendation-label">停損（1.5 ATR 或前波支撐）</div><div class="recommendation-value" style="color: var(--negative-text);">${formatNumber(levels.stop, 2)}</div></div>
          <div class="recommendation-item"><div class="recommendation-label">目標（2 ATR 或前波壓力）</div><div class="recommendation-value" style="color: var(--positive-text);">${formatNumber(levels.target, 2)}</div></div>
          <div class="recommendation-item"><div class="recommendation-label">風險報酬比</div><div class="recommendation-value">${formatNumber(Math.abs(levels.target - levels.entry) / Math.abs(levels.entry - levels.stop), 2)} : 1</div></div>
        ` : '<div class="recommendation-item"><div class="recommendation-label">目前為 HOLD</div><div class="recommendation-value">模型判定為盤整或訊號不一致，不提供進出場價位。</div></div>'}
      </div>
    </div>

    <div class="analysis-section">
      <h3>訊號組成</h3>
      <div class="recommendation-box">
        ${state.latestSignal.drivers.map(driver => `
          <div class="recommendation-item"><div class="recommendation-value">${escapeHTML(driver.text)}</div></div>
        `).join('')}
      </div>
    </div>
    <p class="fine-print">價位由 ATR 與近 20 根 K 棒的高低點計算，屬於機械式風控參考，非目標價或投資建議。</p>
  `;
  openModal();
}

/* -------------------------------------------------------------- backtest */

function renderBacktestView() {
  if (!state.selectedItem || !state.signalSeries) {
    backtestBody.innerHTML = '<div class="empty-note">先在「市場總覽」選擇標的，再執行回測。</div>';
    setPanelMeta('backtest', sourceLine());
    return;
  }

  const fromInput = document.getElementById('backtestFrom').value;
  const toInput = document.getElementById('backtestTo').value;
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
    ? '此區間內，含成本後策略優於買進持有。'
    : '此區間內，含成本後策略「輸給」買進持有 — 多數單純均線策略在扣除成本後都是如此，這裡如實呈現。';

  backtestBody.innerHTML = `
    <div class="verdict ${result.beatsBuyAndHold ? 'verdict-good' : 'verdict-warn'}">${escapeHTML(verdict)}</div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>指標</th><th>訊號策略（含成本）</th><th>買進持有（含成本）</th></tr></thead>
        <tbody>
          <tr><td>總報酬</td><td class="${toneClass(result.strategy.totalReturn)}">${formatSignedPercent(result.strategy.totalReturn)}</td><td class="${toneClass(result.hold.totalReturn)}">${formatSignedPercent(result.hold.totalReturn)}</td></tr>
          <tr><td>年化報酬</td><td class="${toneClass(result.strategy.annualizedReturn)}">${formatSignedPercent(result.strategy.annualizedReturn)}</td><td class="${toneClass(result.hold.annualizedReturn)}">${formatSignedPercent(result.hold.annualizedReturn)}</td></tr>
          <tr><td>年化波動</td><td>${formatPercent(result.strategy.annualizedVolatility)}</td><td>${formatPercent(result.hold.annualizedVolatility)}</td></tr>
          <tr><td>Sharpe (rf=0)</td><td>${formatNumber(result.strategy.sharpe, 2)}</td><td>${formatNumber(result.hold.sharpe, 2)}</td></tr>
          <tr><td>最大回撤</td><td class="negative">${formatPercent(result.strategy.maxDrawdown)}</td><td class="negative">${formatPercent(result.hold.maxDrawdown)}</td></tr>
        </tbody>
      </table>
    </div>

    <div id="backtestChart" class="mini-chart"></div>

    <div class="stat-row">
      <div class="stat"><span>交易次數</span><strong>${result.tradeCount}</strong></div>
      <div class="stat"><span>單筆勝率</span><strong>${result.winRate == null ? '--' : formatPercent(result.winRate)}</strong></div>
      <div class="stat"><span>年周轉率</span><strong>${formatNumber(result.turnoverPerYear, 2)}x</strong></div>
      <div class="stat"><span>成本拖累</span><strong class="negative">${formatSignedPercent(-Math.abs(result.costDragReturn))}</strong></div>
      <div class="stat"><span>在市場時間</span><strong>${formatPercent(result.timeInMarket)}</strong></div>
      <div class="stat"><span>樣本</span><strong>${result.bars} 根日線</strong></div>
    </div>

    <p class="fine-print">
      成本模型：${escapeHTML(result.costs.label)} — ${escapeHTML(result.costs.note)}。
      訊號於 T 日收盤產生、T+1 日才建立部位；SELL 視為空手（不做空）；買進持有亦計入單邊進出成本。
      未計入滑價、借券成本與稅務差異。歷史回測不保證未來績效。
    </p>
  `;

  renderBacktestChart(result);
  setPanelMeta('backtest', sourceLine([
    `區間：${formatDate(result.from)} – ${formatDate(result.to)}`,
    `成本模型：${result.costs.label}`
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
    legend: { data: ['訊號策略', '買進持有'], textStyle: { color: palette.muted }, top: 0 },
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
      { name: '訊號策略', type: 'line', data: result.strategyEquity, symbol: 'none', lineStyle: { color: palette.blue, width: 2 } },
      { name: '買進持有', type: 'line', data: result.holdEquity, symbol: 'none', lineStyle: { color: palette.muted, width: 2, type: 'dashed' } }
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

  portfolioBody.innerHTML = '<div class="empty-note">計算中…</div>';

  let payload;
  try {
    payload = await loadUniverseHistory(range);
  } catch (error) {
    portfolioBody.innerHTML = '<div class="empty-note">無法載入歷史資料，請稍後再試（免費報價來源可能已限流）。</div>';
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
      <div class="stat"><span>投組年化波動</span><strong>${formatPercent(analysis.annualizedVolatility)}</strong></div>
      <div class="stat"><span>最大回撤（樣本內）</span><strong class="negative">${formatPercent(analysis.maxDrawdown)}</strong></div>
      <div class="stat"><span>現金水位</span><strong>${formatPercent(analysis.cashWeight)}</strong></div>
      <div class="stat"><span>平均相關係數</span><strong>${formatNumber(analysis.averageCorrelation, 2)}</strong></div>
      <div class="stat"><span>有效持股數（權重）</span><strong>${formatNumber(analysis.effectivePositions, 1)}</strong></div>
      <div class="stat"><span>有效賭注數（含相關性）</span><strong class="${analysis.effectiveBets < 4 ? 'negative' : ''}">${formatNumber(analysis.effectiveBets, 1)}</strong></div>
    </div>

    <div class="insight ${analysis.effectiveBets < 4 || cryptoRisk > 0.6 ? 'insight-warn' : ''}">
      名單有 ${analysis.symbols.length} 檔，但把相關性算進去後，實際上只有
      <strong>${formatNumber(analysis.effectiveBets, 1)}</strong> 個獨立賭注（平均相關 ${formatNumber(analysis.averageCorrelation, 2)}、
      最高相關 ${formatNumber(analysis.maxCorrelation, 2)}）。
      Crypto 佔資金 ${formatPercent(cryptoWeight)}，卻佔風險 ${formatPercent(cryptoRisk)}。
      分散化比率 ${formatNumber(analysis.diversificationRatio, 2)}（1.0 代表完全沒有分散效果）。
    </div>

    <div class="split-grid">
      <div>
        <h3 class="sub-heading">建議權重與風險貢獻</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>標的</th><th>資金權重</th><th>風險佔比</th><th>年化波動</th><th>風險/權重</th></tr></thead>
            <tbody>
              ${weightRows}
              <tr class="row-cash"><td>現金</td><td>${formatPercent(analysis.cashWeight)}</td><td>0.0%</td><td>0.0%</td><td>--</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 class="sub-heading">相關係數矩陣</h3>
        <div id="correlationHeatmap" class="mini-chart"></div>
      </div>
    </div>

    <p class="fine-print">
      權重為程式依 ${method === 'equal' ? '等權重' : '波動度反比'} 計算的輸出，並非個別投資建議。
      相關性與波動以 ${analysis.sampleDays} 個共同交易日的日報酬估計，並以 ${state.baseCurrency} 計價（USD 標的已用 USD/TWD 日資料換算）。
      樣本內結果會隨區間改變，最大回撤為此樣本期間的歷史值。
    </p>
  `;

  renderCorrelationHeatmap(analysis);
  setPanelMeta('portfolio', sourceLine([
    `樣本：${analysis.sampleDays} 個共同交易日`,
    `計價幣別：${state.baseCurrency}`,
    payload.failed?.length ? `未取得：${payload.failed.join(', ')}` : ''
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
      formatter: params => `${labels[params.value[1]]} × ${labels[params.value[0]]}<br/>相關係數 ${params.value[2]}`
    },
    grid: { left: 70, right: 20, top: 10, bottom: 70 },
    xAxis: { type: 'category', data: labels, axisLabel: { color: palette.muted, rotate: 45, fontSize: 10 }, splitArea: { show: true } },
    yAxis: { type: 'category', data: labels, axisLabel: { color: palette.muted, fontSize: 10 }, splitArea: { show: true } },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      textStyle: { color: palette.muted },
      inRange: { color: ['#2f6fed', '#f4f6fb', '#e5484d'] }
    },
    series: [{
      type: 'heatmap',
      data,
      label: { show: labels.length <= 12, fontSize: 9, color: '#111827' },
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
          <span class="screen-english">${escapeHTML(row.english)}</span>
        </div>
        <div class="screen-badges">
          <span class="badge badge-review badge-${status.state}">${escapeHTML(status.label)} · ${escapeHTML(status.detail)}</span>
          <span class="badge">${escapeHTML(row.type === 'crypto' ? 'Crypto' : row.market)}</span>
          <span class="badge">${escapeHTML(row.horizon)}</span>
          <span class="badge">流動性 ${'★'.repeat(row.liquidityStars)}${'☆'.repeat(5 - row.liquidityStars)}</span>
          <span class="badge state-pill state-${signalState.toLowerCase()}">${escapeHTML(signalState)}</span>
        </div>
      </header>

      <div class="screen-metrics">
        <div><span>建議日期</span><strong>${escapeHTML(row.review.entryDate || '未設定')}</strong></div>
        <div><span>建議時價</span><strong>${row.review.entryPrice != null ? `${formatNumber(row.review.entryPrice, 2)} ${currency}` : '未設定'}</strong></div>
        <div><span>現價</span><strong>${row.lastClose != null ? `${formatNumber(row.lastClose, 2)} ${currency}` : '--'}</strong></div>
        <div><span>累積報酬</span><strong class="${toneClass(row.sinceReturn)}">${row.sinceReturn == null ? '需先設定建議時價' : formatSignedPercent(row.sinceReturn)}</strong></div>
        <div><span>年化波動</span><strong>${formatPercent(row.volatility)}</strong></div>
        <div><span>相對 MA200</span><strong>${row.aboveSlowMa == null ? '--' : row.aboveSlowMa ? '站上' : '跌破'}</strong></div>
      </div>

      <div class="screen-exit">
        <div class="exit-item"><span>目標價</span><strong>${row.review.target != null ? `${formatNumber(row.review.target, 2)}（距現價 ${formatSignedPercent(row.toTarget)}）` : '未設定'}</strong></div>
        <div class="exit-item"><span>停損價</span><strong>${row.review.stop != null ? `${formatNumber(row.review.stop, 2)}（距現價 ${formatSignedPercent(row.toStop)}）` : '未設定'}</strong></div>
        <div class="exit-item exit-invalidation"><span>失效條件</span><strong>${escapeHTML(row.review.invalidation || row.invalidation)}</strong></div>
      </div>

      <details class="screen-notes">
        <summary>觀察筆記（${status.state === 'fresh' ? '已覆核' : '未覆核，僅供參考'}）</summary>
        <ul>${row.thesis.map(line => `<li>${escapeHTML(line)}</li>`).join('')}</ul>
        <p class="screen-risk">⚠ 風險：${escapeHTML(row.risk)}</p>
      </details>

      <footer class="screen-actions">
        <button type="button" data-action="load">載入圖表</button>
        <button type="button" data-action="edit">編輯進場與出場條件</button>
        <button type="button" data-action="review">標記今日已覆核</button>
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
      <div class="stat"><span>符合條件</span><strong>${filtered.length} / ${rows.length}</strong></div>
      <div class="stat"><span>待覆核</span><strong class="${stale ? 'negative' : ''}">${stale}</strong></div>
      <div class="stat"><span>已設定建議價</span><strong>${rows.filter(row => row.review.entryPrice != null).length}</strong></div>
      <div class="stat"><span>資料狀態</span><strong>${state.universeHistory ? '已載入' : '尚未載入'}</strong></div>
    </div>
  `;

  screenerList.innerHTML = filtered.length
    ? filtered.map(screenerCardHTML).join('')
    : '<div class="empty-note">沒有標的符合目前條件，請放寬篩選。</div>';

  setPanelMeta('screener', sourceLine([
    state.universeHistory ? `樣本區間：${state.universeRange}` : '尚未載入歷史資料',
    `逾 ${Screener.STALE_AFTER_DAYS} 天未覆核即標記待覆核`
  ]));
}

function openReviewEditor(symbol) {
  const item = Screener.UNIVERSE.find(entry => entry.symbol === symbol);
  const review = Screener.getReview(symbol);
  if (!item) return;

  modalTitle.textContent = `${item.name} ${symbol} · 進場與出場條件`;
  modalBody.innerHTML = `
    <form id="reviewForm" class="review-form">
      <p class="fine-print">這些欄位由你自己維護，僅存在本機瀏覽器（localStorage），不會上傳。</p>
      <label class="control"><span>建議日期</span><input type="date" name="entryDate" value="${escapeHTML(review.entryDate || '')}" /></label>
      <label class="control"><span>建議時價（${escapeHTML(item.currency)}）</span><input type="number" step="any" name="entryPrice" value="${review.entryPrice ?? ''}" /></label>
      <label class="control"><span>目標價</span><input type="number" step="any" name="target" value="${review.target ?? ''}" /></label>
      <label class="control"><span>停損價</span><input type="number" step="any" name="stop" value="${review.stop ?? ''}" /></label>
      <label class="control control-wide"><span>失效條件</span><input type="text" name="invalidation" value="${escapeHTML(review.invalidation || item.invalidation)}" /></label>
      <div class="review-actions">
        <button type="submit">儲存並標記已覆核</button>
        <button type="button" id="clearReviewBtn" class="ghost-button">清除本檔設定</button>
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
  modalTitle.textContent = '方法論';
  modalBody.innerHTML = `
    <div class="analysis-section">
      <h3>訊號如何計算</h3>
      <ul class="doc-list">
        <li>資料：Yahoo Finance 日線，價格已還原除權息與分割（adjusted close）；報價延遲約 15 分鐘。</li>
        <li>趨勢結構：MA20 / MA60 / MA200 排列，三線同向給 ±2 分，收盤相對 MA200 再給 ±1 分。</li>
        <li>趨勢強度：ADX(14) ≥ 25 加 1 分；ADX(14) &lt; ${SignalEngine.ADX_TREND_FLOOR} 直接判定為盤整，方向訊號一律降為 HOLD。</li>
        <li>量能：成交量 ≥ 20 日均量 1.5 倍時，往當下方向加 ±1 分。</li>
        <li>狀態門檻：分數 ≥ +3 為 BUY，≤ −3 為 SELL，其餘為 HOLD。</li>
        <li>信心度 = 分數強度 × 趨勢強度係數 × 波動度分位係數，換算為 0–100；高波動區間會壓低信心度。</li>
        <li>新聞情緒僅微調信心度（每分 ±5），<strong>不會改變狀態</strong>；歷史統計完全不含新聞。</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>價格區間如何計算</h3>
      <ul class="doc-list">
        <li>模型為隨機漫步：中位數僅含收縮後（×0.25，且上限 ±0.4%/日）的歷史漂移。</li>
        <li>區間為實現波動度依 √t 外推的 P10 / P25 / P75 / P90 分位。</li>
        <li>本站<strong>不提供單一目標價</strong>，因為短樣本的點預測精度不足以支撐該呈現方式。</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>回測規則</h3>
      <ul class="doc-list">
        <li>T 日收盤產生訊號，T+1 日才建立部位，避免用到當根 K 棒自身資訊。</li>
        <li>只做多／空手，SELL 代表出場而非放空。</li>
        <li>成本：台股手續費 0.1425%（雙邊、未折扣）＋ 賣出證交稅 0.3%；Crypto taker 0.1% 雙邊。</li>
        <li>買進持有同樣計入單邊進出成本，兩者比較基準一致。</li>
        <li>未計入滑價、借券費與稅務差異；樣本內結果不代表未來績效。</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>投組風險</h3>
      <ul class="doc-list">
        <li>權重預設為波動度反比（風險平衡），使高波動標的不會壟斷投組風險；亦可切換等權重。</li>
        <li>相關係數、波動度與最大回撤由共同交易日的日報酬計算，USD 標的以 USD/TWD 日資料換算為基準幣別。</li>
        <li>「有效賭注數」= 分散化比率的平方（加權平均波動 ÷ 投組波動）²：這個定義會把高度相關的持股折算成同一個賭注，數字遠小於持股數即代表名單看似分散、實則押注同一因子。</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>已知限制</h3>
      <ul class="doc-list">
        <li>台股假日未內建行事曆，非交易日以「已收盤」呈現，並標示最後一根 K 棒時間。</li>
        <li>新聞情緒為關鍵字計分，非語意模型，對反諷與複雜語句判讀有限。</li>
        <li>免費報價來源在高流量下可能失敗；伺服器端已加入快取與流量限制，仍可能出現空白狀態。</li>
      </ul>
    </div>
  `;
  openModal();
}

function showTaxModal() {
  modalTitle.textContent = '幣別與稅務說明';
  modalBody.innerHTML = `
    <div class="analysis-section">
      <h3>幣別</h3>
      <ul class="doc-list">
        <li>台股以 TWD 報價、Crypto 以 USD 報價；上方切換鈕會將兩者換算為同一基準幣別。</li>
        <li>換算採用 Yahoo Finance 的 USD/TWD 日資料，投組相關性與波動亦以換算後序列計算。</li>
        <li>匯率變動本身即為報酬來源之一：以 TWD 計價時，USD 資產的報酬同時包含匯兌損益。</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>稅務差異（一般性資訊，非稅務建議）</h3>
      <ul class="doc-list">
        <li>台股：證券交易所得目前停徵；賣出時課 0.3% 證券交易稅；<strong>股利所得</strong>併入綜合所得稅（或採分開計稅），並涉及二代健保補充保費。</li>
        <li>加密資產：個人透過境外交易所的處分損益，實務上多歸類為<strong>海外所得</strong>，涉及最低稅負制（基本所得額）門檻；透過境內業者交易則可能認定為境內所得。</li>
        <li>兩者稅負結構不同，<strong>稅後排序可能與稅前排序相反</strong>；本站所有報酬數字皆為稅前。</li>
        <li>個人情況差異大，實際申報請洽會計師或稅務機關；本段僅為一般性說明，不構成稅務建議。</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h3>法規定位</h3>
      <ul class="doc-list">
        <li>本站提供的是<strong>使用者自訂條件的篩選輸出與量化計算</strong>，不提供個別標的推薦、不代客操作、不收取顧問報酬。</li>
        <li>在台灣，對不特定人提供個別有價證券的分析意見或推介，可能涉及《證券投資信託及顧問法》的投顧業務許可要求。若要對外開放或商業化，請先取得當地法律意見。</li>
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
    refreshButton.textContent = loading ? '更新中…' : '重新整理';
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
    renderChartEmptyState('沒有圖表資料', '無法載入此標的的價格歷史。');
  }

  const website = profileResult.status === 'fulfilled' ? profileResult.value?.website || null : null;
  state.currentWebsite = website;
  renderCompanyWebsite(website);
  renderNews(state.currentNews);

  const newestNews = state.latestSignal?.newsSentiment?.newestTimestamp;
  setPanelMeta('chart', sourceLine([
    marketNoteFor(state.selectedItem),
    `最後一根 K 棒：${formatDateTime(displayData[displayData.length - 1]?.timestamp)}`
  ]));
  setPanelMeta('news', sourceLine([
    `已去重 ${state.currentNews.length} 則，其中 ${state.latestSignal?.newsSentiment?.counted ?? 0} 則對應到此標的`,
    newestNews ? `最新標題：${formatDateTime(newestNews)}` : '無可用發布時間'
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
      <strong>官方網站</strong>
      ${website ? `<a href="${safeExternalUrl(website)}" target="_blank" rel="noopener noreferrer">${escapeHTML(website)}</a>` : '<span>尚無資料</span>'}
    </div>
  `;
}

async function refreshCurrentMarketData() {
  if (!state.selectedItem?.symbol || state.isRefreshing) return;
  const symbol = state.selectedItem.symbol;
  setRefreshState({ loading: true, message: `更新 ${symbol} 中…` });

  let message = '';
  try {
    await loadMarketData(symbol);
    message = `已於 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })} 更新。`;
  } catch (error) {
    message = '更新失敗，稍後再試。';
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

  setRefreshState({ loading: true, message: `載入 ${item.symbol} 中…`, enabled: true });
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
        setRefreshState({ loading: false, message: `已於 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })} 更新。` });
      }
    })
    .catch(() => {
      if (state.selectedItem?.symbol === item.symbol) {
        setRefreshState({ loading: false, message: '初次載入失敗，請按重新整理。' });
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
loadHistory();
loadMarketStatus();
loadFxRate();
setPanelMeta('chart', sourceLine());
setPanelMeta('news', sourceLine());
setPanelMeta('backtest', sourceLine());
setPanelMeta('portfolio', sourceLine());

window.selectItem = selectItem;
