const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const TEST_PORT = 3001;
const SERVER_START_PATTERN = new RegExp(`Server running at http:\/\/localhost:${TEST_PORT}`);
const SERVER_URL = `http://localhost:${TEST_PORT}`;
const SERVER_START_TIMEOUT = 20000;
const STEP_TIMEOUT = 15000;

function buildChartFixture(symbol = '2330.TW') {
  const start = Date.UTC(2026, 3, 20);
  const basePrice = symbol === 'BTC-USD' ? 50000 : 800;
  const data = Array.from({ length: 30 }, (_, index) => {
    const close = basePrice + index * 4 + (index % 3) * 2;
    return {
      timestamp: start + index * 24 * 60 * 60 * 1000,
      open: close - 3,
      high: close + 8,
      low: close - 10,
      close,
      volume: 20000000 + index * 125000
    };
  });

  return {
    symbol,
    meta: { currency: 'TWD', symbol },
    data
  };
}

const newsFixture = [
  {
    title: 'TSMC revenue growth remains strong',
    link: 'https://example.com/tsmc-growth',
    publisher: 'QA Fixture News',
    providerPublishTime: 1776652800,
    summary: 'Revenue and demand signals remain constructive in this deterministic test fixture.'
  },
  {
    title: 'Chip demand outlook supports earnings',
    link: 'https://example.com/chip-demand',
    publisher: 'QA Fixture News',
    providerPublishTime: 1776566400,
    summary: 'Strong demand and earnings momentum are included for strategy analysis coverage.'
  }
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function assertSearchTop(query, expectedSymbol, forbiddenSymbols = []) {
  const response = await fetch(`${SERVER_URL}/api/search?query=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error(`Search API failed for "${query}": ${response.status}`);
  }

  const results = await response.json();
  const firstSymbol = results[0]?.symbol;
  if (firstSymbol !== expectedSymbol) {
    throw new Error(`Search "${query}" expected top result ${expectedSymbol}, got ${firstSymbol || 'none'}`);
  }

  const returnedSymbols = new Set(results.map(item => item.symbol));
  const forbiddenHit = forbiddenSymbols.find(symbol => returnedSymbols.has(symbol));
  if (forbiddenHit) {
    throw new Error(`Search "${query}" returned unrelated fuzzy match ${forbiddenHit}`);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(TEST_PORT) }
    });

    let started = false;
    const stdoutChunks = [];
    const stderrChunks = [];

    function cleanup() {
      server.stdout.removeAllListeners();
      server.stderr.removeAllListeners();
      server.removeAllListeners();
    }

    const timeout = setTimeout(() => {
      if (!started) {
        server.kill();
        cleanup();
        reject(new Error(`Server did not start within timeout. stderr:\n${stderrChunks.join('')}`));
      }
    }, SERVER_START_TIMEOUT);

    server.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdoutChunks.push(text);
      if (!started && SERVER_START_PATTERN.test(text)) {
        started = true;
        clearTimeout(timeout);
        resolve({ server, stdout: stdoutChunks.join('') });
      }
    });

    server.stderr.on('data', chunk => {
      stderrChunks.push(chunk.toString());
    });

    server.on('error', err => {
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    server.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (!started) {
        reject(new Error(`Server exited before startup: code=${code} signal=${signal}. stderr:\n${stderrChunks.join('')}`));
      }
    });
  });
}

(async () => {
  let browser;
  let serverProcess;
  const apiEvents = [];
  const pageErrors = [];
  try {
    const server = await startServer();
    serverProcess = server.server;
    console.log('Server started. Running regression test.');

    await assertSearchTop('2330tw', '2330.TW');
    await assertSearchTop('btcusd', 'BTC-USD');
    await assertSearchTop('tsmc', '2330.TW', ['1536.TW']);
    await assertSearchTop('honhai', '2317.TW', ['2207.TW']);
    await assertSearchTop('medatek', '2454.TW');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const chartDelays = new Map();
    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });
    page.on('requestfailed', request => {
      if (request.url().includes('/api/')) {
        apiEvents.push(`failed ${request.url()} ${request.failure()?.errorText || ''}`);
      }
    });
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        apiEvents.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.route('**/api/chart**', async route => {
      const symbol = new URL(route.request().url()).searchParams.get('symbol') || '2330.TW';
      const delayMs = chartDelays.get(symbol) || 0;
      if (delayMs) {
        await delay(delayMs);
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildChartFixture(symbol))
      });
    });
    await page.route('**/api/news**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(newsFixture)
    }));
    await page.route('**/api/profile**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ website: 'https://www.tsmc.com/english', industry: 'Semiconductors', sector: 'Technology' })
    }));

    await page.goto(SERVER_URL, { timeout: STEP_TIMEOUT });
    await page.waitForSelector('#searchInput', { timeout: STEP_TIMEOUT });

    await page.fill('#searchInput', '2330');
    const [chartResponse, newsResponse] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/chart?symbol=') && response.status() === 200, { timeout: STEP_TIMEOUT }),
      page.waitForResponse(response => response.url().includes('/api/news?symbol=') && response.status() === 200, { timeout: STEP_TIMEOUT }),
      page.click('#searchButton')
    ]);

    if (!chartResponse.ok() || !newsResponse.ok()) {
      throw new Error(`Chart or news API returned non-200: chart=${chartResponse.status()} news=${newsResponse.status()}`);
    }

    const suggestionCount = await page.locator('.suggestion-item').count();
    if (suggestionCount !== 0) {
      throw new Error(`Search button should select the best match and close suggestions, but ${suggestionCount} suggestions remain.`);
    }

    const searchValue = await page.inputValue('#searchInput');
    if (searchValue !== '2330.TW') {
      throw new Error(`Search input was not normalized to the selected symbol: ${searchValue}`);
    }

    await page.waitForSelector('#websiteBox a', { timeout: STEP_TIMEOUT });
    const websiteLink = await page.getAttribute('#websiteBox a', 'href');
    const websiteText = await page.innerText('#websiteBox a');
    if (!websiteLink || websiteLink === '#' || !websiteText || websiteText.includes('無法取得')) {
      throw new Error(`Official website link did not render correctly: href=${websiteLink} text=${websiteText}`);
    }

    // The signal engine now lives on its own tab, so it must be opened before
    // its panel can be asserted against.
    await page.click('button[data-view="signal"]');
    await page.waitForSelector('#viewDetailsBtn', { timeout: STEP_TIMEOUT });
    const strategyText = await page.innerText('#strategyPanel');
    if (!strategyText.includes('訊號引擎') || !strategyText.includes('ADX')) {
      throw new Error(`Strategy panel does not describe the multi-horizon signal engine:\n${strategyText}`);
    }
    if (!strategyText.includes('信心度')) {
      throw new Error('Strategy panel is missing the numeric confidence readout.');
    }

    await page.click('#viewDetailsBtn');

    await page.waitForSelector('#strategyModal.show', { timeout: STEP_TIMEOUT });
    const modalSectionCount = await page.locator('#strategyModal .analysis-section').count();
    const modalMetricCount = await page.locator('#strategyModal .metric-card, #strategyModal .recommendation-item').count();
    if (modalSectionCount < 3 || modalMetricCount < 3) {
      throw new Error(`Modal did not render expected analysis content: sections=${modalSectionCount} metrics=${modalMetricCount}`);
    }

    await page.click('#modalCloseBtn');
    await page.waitForFunction(() => !document.querySelector('#strategyModal').classList.contains('show'), null, { timeout: STEP_TIMEOUT });

    await page.click('button[data-view="overview"]');
    const tabButton = await page.waitForSelector('button[data-interval="30m"][data-range="5d"]', { timeout: STEP_TIMEOUT });
    const [chartResponse2, strategyChartResponse] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/chart?symbol=') && response.url().includes('interval=30m') && response.url().includes('range=5d') && response.status() === 200, { timeout: STEP_TIMEOUT }),
      // The signal engine always reloads two years of daily bars, regardless of
      // the interval selected for the displayed chart.
      page.waitForResponse(response => response.url().includes('/api/chart?symbol=') && response.url().includes('interval=1d') && response.url().includes('range=2y') && response.status() === 200, { timeout: STEP_TIMEOUT }),
      tabButton.click()
    ]);
    if (!chartResponse2.ok() || !strategyChartResponse.ok()) {
      throw new Error(`Tab switch chart API returned non-200: chart=${chartResponse2.status()} strategy=${strategyChartResponse.status()}`);
    }

    const isActiveTab = await page.locator('button[data-interval="30m"][data-range="5d"]').evaluate(button => button.classList.contains('active'));
    if (!isActiveTab) {
      throw new Error('The 30m tab did not become active after clicking.');
    }

    chartDelays.set('2330.TW', 650);
    await page.evaluate(() => {
      window.selectItem({ symbol: '2330.TW', name: 'TSMC', type: 'stock', market: 'Taiwan Stock' });
      window.selectItem({ symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto', market: 'Crypto' });
    });
    await page.waitForFunction(() => document.querySelector('#itemSummary')?.innerText.includes('BTC-USD'), null, { timeout: STEP_TIMEOUT });
    await page.waitForTimeout(1000);
    const finalSummaryText = await page.innerText('#itemSummary');
    if (!finalSummaryText.includes('BTC-USD') || !finalSummaryText.includes('最新價 (USD)') || !finalSummaryText.includes('50,120.00')) {
      throw new Error(`Stale market-data response overwrote the latest selection:\n${finalSummaryText}`);
    }

    console.log('Regression test passed: search, modal, and tab-switch workflow completed successfully.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Regression test failed:', error.message);
    if (apiEvents.length) {
      console.error(`Observed API traffic:\n${apiEvents.join('\n')}`);
    }
    if (pageErrors.length) {
      console.error(`Page errors:\n${pageErrors.join('\n')}`);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (serverProcess) {
      serverProcess.kill();
    }
  }
})();
