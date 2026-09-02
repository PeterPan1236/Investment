const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.disable('x-powered-by');

const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (configuredCorsOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin));
  }
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const stocks = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'taiwan_stocks.json'), 'utf8'));
const cryptoList = [
  { symbol: 'BTC-USD', name: 'Bitcoin', english: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETH-USD', name: 'Ethereum', english: 'Ethereum', type: 'crypto' },
  { symbol: 'USDT-USD', name: 'Tether', english: 'Tether', type: 'crypto' },
  { symbol: 'BNB-USD', name: 'BNB', english: 'BNB', type: 'crypto' },
  { symbol: 'XRP-USD', name: 'XRP', english: 'XRP', type: 'crypto' },
  { symbol: 'ADA-USD', name: 'Cardano', english: 'Cardano', type: 'crypto' },
  { symbol: 'SOL-USD', name: 'Solana', english: 'Solana', type: 'crypto' },
  { symbol: 'DOGE-USD', name: 'Dogecoin', english: 'Dogecoin', type: 'crypto' },
  { symbol: 'DOT-USD', name: 'Polkadot', english: 'Polkadot', type: 'crypto' },
  { symbol: 'LTC-USD', name: 'Litecoin', english: 'Litecoin', type: 'crypto' }
];
const searchItems = [...stocks, ...cryptoList];
const validIntervals = new Set(['5m', '30m', '1d', '1mo']);
const validRanges = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);

const QUOTE_DELAY_MINUTES = 15;
const upstreamCache = new Map();

function cacheGet(key) {
  const entry = upstreamCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    upstreamCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  upstreamCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (upstreamCache.size > 400) {
    const oldestKey = upstreamCache.keys().next().value;
    upstreamCache.delete(oldestKey);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of upstreamCache) {
    if (now > entry.expiresAt) upstreamCache.delete(key);
  }
}, 60 * 1000).unref();

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};

// Single upstream call per (url, ttl) window. Free Yahoo endpoints throttle
// aggressively, so every fan-out request (batch history, screener quotes)
// must share the same cache.
async function fetchYahooJson(url, ttlMs) {
  const cached = cacheGet(url);
  if (cached) return cached;

  const response = await axios.get(url, { timeout: 15000, headers: YAHOO_HEADERS });
  cacheSet(url, response.data, ttlMs);
  return response.data;
}

async function fetchYahooText(url, ttlMs) {
  const cached = cacheGet(url);
  if (cached) return cached;

  const response = await axios.get(url, { timeout: 15000, headers: YAHOO_HEADERS, responseType: 'text' });
  const text = typeof response.data === 'string' ? response.data : String(response.data);
  cacheSet(url, text, ttlMs);
  return text;
}

function decodeXmlEntities(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : null;
}

/**
 * Yahoo's search endpoint returns a general markets feed regardless of the
 * symbol queried, which left the sentiment driver with nothing to score. The
 * per-symbol RSS headline feed is the only free endpoint that is actually
 * scoped to the instrument.
 */
async function fetchSymbolHeadlines(symbol) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const xml = await fetchYahooText(url, 5 * 60 * 1000);
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  return blocks.map(block => {
    const published = Date.parse(tagText(block, 'pubDate') || '');
    return {
      symbol,
      title: tagText(block, 'title'),
      link: tagText(block, 'link'),
      publisher: tagText(block, 'source') || 'Yahoo Finance',
      providerPublishTime: Number.isFinite(published) ? Math.floor(published / 1000) : null,
      summary: tagText(block, 'description')
    };
  }).filter(item => item.title);
}

function chartUrl(symbol, interval, range) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
    + '&includePrePost=false&events=div%2Csplit';
}

// Split/dividend adjusted closes are required for moving averages, returns and
// backtests; raw OHLC is kept for candle rendering only.
function normalizeChartResult(result) {
  const quote = result.indicators?.quote?.[0] || {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const timestamps = result.timestamp || [];

  return timestamps
    .map((timestamp, index) => ({
      timestamp: timestamp * 1000,
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
      adjClose: adjClose[index] ?? quote.close?.[index],
      volume: quote.volume?.[index]
    }))
    .filter(point => point.open != null && point.close != null && point.high != null && point.low != null);
}

const TAIPEI_TIMEZONE = 'Asia/Taipei';

function taipeiParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIMEZONE,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute)
  };
}

// TWSE regular session is 09:00-13:30 Taipei time on weekdays. Public holidays
// are not encoded here, so a weekday with no fresh bar is reported as stale
// rather than open; the client shows the last bar timestamp either way.
function taiwanMarketStatus(now = new Date()) {
  const { weekday, minutes } = taipeiParts(now);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const openMinutes = 9 * 60;
  const closeMinutes = 13 * 60 + 30;

  if (isWeekend) {
    return { state: 'closed', label: 'Closed (weekend)', session: 'TWSE 09:00–13:30 (UTC+8)' };
  }
  if (minutes < openMinutes) {
    return { state: 'pre', label: 'Pre-open', session: 'TWSE 09:00–13:30 (UTC+8)' };
  }
  if (minutes > closeMinutes) {
    return { state: 'closed', label: 'Closed', session: 'TWSE 09:00–13:30 (UTC+8)' };
  }
  return { state: 'open', label: 'Open', session: 'TWSE 09:00–13:30 (UTC+8)' };
}

function isValidMarketSymbol(symbol) {
  return /^[A-Za-z0-9.^=-]{1,32}$/.test(symbol);
}

function normalize(text) {
  if (!text && text !== 0) return '';
  try {
    return text
      .toString()
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\s._-]+/g, '');
  } catch (e) {
    return text.toString().toLowerCase();
  }
}

function fuzzyTypoMatch(q, t) {
  if (!q || !t) return false;
  if (t.includes(q)) return true;

  if (q.length < 4) return false;

  const maxDistance = q.length <= 5 ? 1 : 2;
  if (Math.abs(q.length - t.length) > maxDistance) return false;

  const previous = Array.from({ length: t.length + 1 }, (_, index) => index);
  const current = Array(t.length + 1).fill(0);

  for (let i = 1; i <= q.length; i += 1) {
    current[0] = i;
    let rowMinimum = current[0];

    for (let j = 1; j <= t.length; j += 1) {
      const substitutionCost = q[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }

    if (rowMinimum > maxDistance) return false;

    for (let j = 0; j <= t.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[t.length] <= maxDistance;
}

function scoreForItem(item, lower) {
  const aliasText = Array.isArray(item.aliases) ? item.aliases.join('') : '';
  const fields = {
    symbol: normalize(item.symbol),
    name: normalize(item.name),
    english: normalize(item.english),
    market: normalize(item.market),
    alias: normalize(aliasText)
  };

  // best = 0, worse = higher
  let score = 999;

  if (fields.symbol.startsWith(lower)) score = Math.min(score, 0);
  if (fields.name.startsWith(lower)) score = Math.min(score, 1);
  if (fields.english.startsWith(lower)) score = Math.min(score, 1);
  if (fields.alias.startsWith(lower)) score = Math.min(score, 1);

  if (fields.symbol.includes(lower)) score = Math.min(score, 2);
  if (fields.name.includes(lower)) score = Math.min(score, 2);
  if (fields.english.includes(lower)) score = Math.min(score, 2);
  if (fields.alias.includes(lower)) score = Math.min(score, 2);

  if (fuzzyTypoMatch(lower, fields.name)) score = Math.min(score, 3);
  if (fuzzyTypoMatch(lower, fields.english)) score = Math.min(score, 3);
  if (fuzzyTypoMatch(lower, fields.alias)) score = Math.min(score, 3);

  if (fields.market.includes(lower)) score = Math.min(score, 4);

  return score === 999 ? 100 : score;
}

const US_EXCHANGE_CODES = new Set(['nms', 'ngm', 'ncm', 'nyq', 'ase', 'pcx', 'bts', 'cxi']);

function guessMarketFromExchange(exchange, quoteType) {
  if (!exchange) return undefined;
  const normalized = exchange.toLowerCase();
  if (normalized.includes('tai')) return 'TWSE';
  if (normalized.includes('otc') || normalized.includes('tpe')) return 'TPEx';
  if (normalized.includes('crypto') || normalized.includes('binance') || normalized.includes('coinbase') || quoteType === 'CRYPTOCURRENCY') return 'Crypto';
  if (US_EXCHANGE_CODES.has(normalized) || normalized.includes('nasdaq') || normalized.includes('nyse') || normalized.includes('nysemkt')) return 'US';
  return exchange;
}

async function fetchYahooSearch(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });
    const quotes = response.data.quotes || [];
    return quotes.map(q => ({
      symbol: q.symbol || query,
      name: q.longname || q.shortname || q.symbol || query,
      english: q.shortname || q.symbol || query,
      type: q.quoteType === 'CRYPTOCURRENCY' ? 'crypto' : 'stock',
      market: q.exchange ? guessMarketFromExchange(q.exchange, q.quoteType) : undefined
    }));
  } catch (error) {
    return [];
  }
}

const ipRequestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, rec] of ipRequestCounts) {
    if (rec.windowStart < cutoff) ipRequestCounts.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

function rateLimitMiddleware(req, res, next) {
  // Only trust X-Forwarded-For when explicitly running behind a reverse proxy;
  // otherwise clients can spoof the header to bypass rate limiting.
  const forwardedIp = TRUST_PROXY ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = forwardedIp || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = ipRequestCounts.get(ip);
  if (!rec || now - rec.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipRequestCounts.set(ip, { windowStart: now, count: 1 });
    return next();
  }
  rec.count += 1;
  if (rec.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
  }
  next();
}

app.use('/api/', rateLimitMiddleware);

// Upstream failures are logged server-side but never echoed to the client:
// the raw axios message carries the request URL and library internals.
function yahooErrorPayload(message, error) {
  const upstream = error.response?.status;
  console.warn(`[yahoo] ${message}:`, error.message || error.code || error);
  return {
    error: message,
    details: upstream === 404
      ? 'The data provider has no data for this request.'
      : upstream
        ? 'The data provider rejected the request.'
        : 'The data provider is unavailable. Try again shortly.'
  };
}

function upstreamHttpStatus(error) {
  return error.response?.status === 404 ? 404 : 502;
}

app.get('/api/search', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const lower = normalize(query);
  const localResults = searchItems
    .map(item => ({ ...item, score: scoreForItem(item, lower) }))
    .filter(item => item.score < 100)
    .sort((a, b) => a.score - b.score)
    .slice(0, 30)
    .map(({ score, ...rest }) => rest);

  if (localResults.length > 0) {
    return res.json(localResults);
  }

  const yahooResults = await fetchYahooSearch(query);
  return res.json(yahooResults.slice(0, 30));
});

// wildcard and server start moved to file end to avoid intercepting /api routes

app.get('/api/chart', async (req, res) => {
  const symbol = (req.query.symbol || '').trim();
  const interval = req.query.interval || '1d';
  const range = req.query.range || '1mo';

  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }
  if (!isValidMarketSymbol(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol parameter' });
  }
  if (!validIntervals.has(interval)) {
    return res.status(400).json({ error: 'Invalid interval parameter' });
  }
  if (!validRanges.has(range)) {
    return res.status(400).json({ error: 'Invalid range parameter' });
  }

  const ttlMs = interval === '5m' ? 60 * 1000 : interval === '30m' ? 5 * 60 * 1000 : 15 * 60 * 1000;

  try {
    const body = await fetchYahooJson(chartUrl(symbol, interval, range), ttlMs);
    const result = body.chart?.result?.[0];
    if (!result || !result.timestamp) {
      return res.status(404).json({ error: 'No chart data available' });
    }

    const data = normalizeChartResult(result);
    return res.json({
      symbol,
      meta: result.meta || {},
      data,
      source: dataSourceInfo(data)
    });
  } catch (error) {
    return res.status(upstreamHttpStatus(error)).json(yahooErrorPayload('Unable to fetch chart data', error));
  }
});

function dataSourceInfo(data = []) {
  const lastBar = data.length ? data[data.length - 1].timestamp : null;
  return {
    provider: 'Yahoo Finance',
    delayMinutes: QUOTE_DELAY_MINUTES,
    fetchedAt: Date.now(),
    lastBarAt: lastBar,
    adjusted: true
  };
}

app.get('/api/market-status', (req, res) => {
  const now = new Date();
  res.json({
    taiwan: taiwanMarketStatus(now),
    crypto: { state: 'open', label: '24/7 trading', session: 'Crypto around the clock' },
    fetchedAt: now.getTime(),
    delayMinutes: QUOTE_DELAY_MINUTES
  });
});

// USD/TWD lets the client show every asset in one base currency and compute
// FX-adjusted returns for the mixed TW-equity + crypto list.
app.get('/api/fx', async (req, res) => {
  try {
    const body = await fetchYahooJson(chartUrl('TWD=X', '1d', '1mo'), 15 * 60 * 1000);
    const result = body.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(value => Number.isFinite(value));
    const rate = closes.length ? closes[closes.length - 1] : result?.meta?.regularMarketPrice;

    if (!Number.isFinite(rate)) {
      return res.status(502).json({ error: 'Unable to resolve USD/TWD rate' });
    }

    return res.json({
      pair: 'USDTWD',
      rate,
      fetchedAt: Date.now(),
      provider: 'Yahoo Finance',
      delayMinutes: QUOTE_DELAY_MINUTES
    });
  } catch (error) {
    return res.status(502).json(yahooErrorPayload('Unable to fetch FX rate', error));
  }
});

const MAX_BATCH_SYMBOLS = 20;

// Batch daily history for the screener: portfolio weights, the correlation
// matrix and since-added returns all need the same series, so they are fetched
// once and shared through the upstream cache.
app.get('/api/history', async (req, res) => {
  const raw = (req.query.symbols || '').trim();
  const range = req.query.range || '1y';

  if (!raw) {
    return res.status(400).json({ error: 'Missing symbols parameter' });
  }
  if (!validRanges.has(range)) {
    return res.status(400).json({ error: 'Invalid range parameter' });
  }

  const symbols = Array.from(new Set(raw.split(',').map(symbol => symbol.trim()).filter(Boolean)));
  if (!symbols.length) {
    return res.status(400).json({ error: 'Missing symbols parameter' });
  }
  if (symbols.length > MAX_BATCH_SYMBOLS) {
    return res.status(400).json({ error: `At most ${MAX_BATCH_SYMBOLS} symbols per request` });
  }
  if (!symbols.every(isValidMarketSymbol)) {
    return res.status(400).json({ error: 'Invalid symbol parameter' });
  }

  const settled = await Promise.allSettled(symbols.map(async symbol => {
    const body = await fetchYahooJson(chartUrl(symbol, '1d', range), 15 * 60 * 1000);
    const result = body.chart?.result?.[0];
    if (!result || !result.timestamp) throw new Error('No chart data available');
    return { symbol, data: normalizeChartResult(result), currency: result.meta?.currency || null };
  }));

  const series = {};
  const failed = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      series[outcome.value.symbol] = outcome.value;
    } else {
      failed.push(symbols[index]);
    }
  });

  if (!Object.keys(series).length) {
    return res.status(502).json({ error: 'Unable to fetch history for any requested symbol', failed });
  }

  return res.json({
    range,
    series,
    failed,
    source: { provider: 'Yahoo Finance', delayMinutes: QUOTE_DELAY_MINUTES, fetchedAt: Date.now(), adjusted: true }
  });
});

app.get('/api/news', async (req, res) => {
  const symbol = (req.query.symbol || '').trim();
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }
  if (!isValidMarketSymbol(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol parameter' });
  }

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}`;

  try {
    // Symbol-scoped RSS first; the search feed is only a fallback because its
    // headlines are market-wide and rarely mention the instrument at all.
    let news = await fetchSymbolHeadlines(symbol).catch(() => []);

    if (!news.length) {
      const body = await fetchYahooJson(url, 5 * 60 * 1000);
      news = body.news || [];
      if (!news.length) {
        const quotes = body.quotes || [];
        news = quotes.flatMap(q => q.news || []);
      }
    }

    // Yahoo repeats the same story across syndication partners; dedupe on the
    // normalized headline so sentiment is not counted twice.
    const seen = new Set();
    const items = news
      .map(n => ({
        symbol,
        title: n.title,
        link: n.link,
        publisher: n.publisher,
        providerPublishTime: n.providerPublishTime,
        summary: n.summary
      }))
      .filter(item => {
        const key = normalize(item.title || '').slice(0, 80);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.providerPublishTime || 0) - (a.providerPublishTime || 0))
      .slice(0, 20);

    return res.json(items);
  } catch (error) {
    return res.status(upstreamHttpStatus(error)).json(yahooErrorPayload('Unable to fetch news', error));
  }
});

function parseGoogleRedirectLocation(location) {
  if (!location) {
    return null;
  }

  try {
    const url = new URL(location, 'https://www.google.com');
    const target = url.searchParams.get('q');
    return target || location;
  } catch (error) {
    try {
      const query = location.split('?')[1] || '';
      return new URLSearchParams(query).get('q') || location;
    } catch (innerError) {
      return location;
    }
  }
}

function isKnownSymbol(symbol) {
  const lower = symbol.toLowerCase();
  return searchItems.some(item => String(item.symbol).toLowerCase() === lower);
}

async function fetchGoogleWebsiteFallback(symbol) {
  const cleaned = symbol.replace(/(\..*|-.+)/, '').trim();
  const query = `${cleaned} official website`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&btnI=1`;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400
    });

    return parseGoogleRedirectLocation(response.headers.location);
  } catch (error) {
    const location = error.response?.headers?.location;
    return parseGoogleRedirectLocation(location);
  }
}

app.get('/api/profile', async (req, res) => {
  const symbol = (req.query.symbol || '').trim();
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }
  if (!isValidMarketSymbol(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol parameter' });
  }

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryProfile`;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });

    const summary = response.data.quoteSummary?.result?.[0];
    const profile = summary?.summaryProfile || {};
    let website = profile.website || null;

    if (!website && (summary || isKnownSymbol(symbol))) {
      website = await fetchGoogleWebsiteFallback(symbol);
    }

    if (!website && !summary && !isKnownSymbol(symbol)) {
      return res.status(404).json({ error: 'Unknown symbol' });
    }

    if (website) {
      return res.json({ website, industry: profile.industry || null, sector: profile.sector || null });
    }

    return res.status(502).json({
      error: 'Unable to fetch official company website from Yahoo or Google fallback.',
      details: 'Yahoo profile returned no website and Google fallback also failed.'
    });
  } catch (error) {
    const fallbackWebsite = isKnownSymbol(symbol) ? await fetchGoogleWebsiteFallback(symbol) : null;
    if (fallbackWebsite) {
      return res.json({ website: fallbackWebsite, industry: null, sector: null });
    }

    if (!isKnownSymbol(symbol) && error.response?.status === 404) {
      return res.status(404).json({ error: 'Unknown symbol' });
    }

    return res.status(502).json({
      error: 'Unable to fetch company profile from Yahoo and Google fallback failed.',
      details: 'The data provider is unavailable. Try again shortly.'
    });
  }
});

// Unknown API routes must return JSON 404, not the SPA shell
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Wildcard fallback and server start should be last so API routes are reachable
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
