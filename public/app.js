const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const suggestionList = document.getElementById('suggestionList');
const historyList = document.getElementById('historyList');
const itemSummary = document.getElementById('itemSummary');
const newsList = document.getElementById('newsList');
const timeTabs = document.getElementById('timeTabs');
const chartContainer = document.getElementById('chart');

const HISTORY_KEY = 'investment_search_history';
let searchHistory = [];
let selectedItem = null;
let currentInterval = '1d';
let currentRange = '1mo';
let chartInstance = null;

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

async function performSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  saveHistory(trimmed);
  const response = await fetch(`/api/search?query=${encodeURIComponent(trimmed)}`);
  const items = await response.json();
  suggestionList.innerHTML = '';

  if (!items.length) {
    suggestionList.innerHTML = '<div class="suggestion-item">找不到符合的股票或 Crypto，請確認關鍵字。</div>';
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'suggestion-item';
    row.innerHTML = `
      <div class="symbol">${item.symbol}</div>
      <div class="info">
        <div><strong>${item.name}</strong> ${item.english ? `(${item.english})` : ''}</div>
        <div class="muted">${item.type === 'crypto' ? 'Crypto' : item.market || 'Taiwan Stock'}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      selectItem(item);
    });
    suggestionList.appendChild(row);
  });
}

function formatNumber(value, decimals = 2) {
  if (value == null || Number.isNaN(value)) return '--';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function buildSummary(data = defaultState) {
  itemSummary.innerHTML = `
    <div class="summary-title">${data.name || '尚未選擇標的'}</div>
    <div class="summary-row">
      <div class="summary-card">
        <strong>代號 / 市場</strong>
        <div class="value">${data.symbol || '--'} / ${data.market || (data.type === 'crypto' ? 'Crypto' : '--')}</div>
      </div>
      <div class="summary-card">
        <strong>最新價格</strong>
        <div class="value">${data.price}</div>
      </div>
      <div class="summary-card">
        <strong>漲跌幅</strong>
        <div class="value">${data.change} (${data.percent})</div>
      </div>
      <div class="summary-card">
        <strong>成交量</strong>
        <div class="value">${data.volume}</div>
      </div>
      <div class="summary-card">
        <strong>技術趨勢</strong>
        <div class="value">${data.trend}</div>
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

async function loadMarketData(symbol) {
  const [chartResponse, newsResponse] = await Promise.all([
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(currentInterval)}&range=${encodeURIComponent(currentRange)}`),
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
  ]);

  const chartData = chartResponse.ok ? await chartResponse.json() : null;
  if (chartData && chartData.data) {
    renderChart(chartData.data, selectedItem);
    updateSummaryFromChart(chartData.data);
  } else {
    chartContainer.innerHTML = '<div style="color:#94a3b8;padding:28px;">無法取得走勢資料，請稍後再試。</div>';
  }

  if (newsResponse.ok) {
    const news = await newsResponse.json();
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
    block.innerHTML = `
      <a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>
      <div class="news-meta">${item.publisher || ''} ${item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toLocaleString('zh-TW', { hour12: false }) : ''}</div>
      ${item.summary ? `<p>${item.summary}</p>` : ''}
    `;
    newsList.appendChild(block);
  });
}

function selectItem(item) {
  selectedItem = { ...item };
  currentInterval = '1d';
  currentRange = '1mo';
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
    performSearch(searchInput.value);
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
loadHistory();
