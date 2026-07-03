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
  { symbol: 'BTC-USD', name: '比特幣', english: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETH-USD', name: '以太幣', english: 'Ethereum', type: 'crypto' },
  { symbol: 'USDT-USD', name: '泰達幣', english: 'Tether', type: 'crypto' },
  { symbol: 'BNB-USD', name: '幣安幣', english: 'BNB', type: 'crypto' },
  { symbol: 'XRP-USD', name: '瑞波幣', english: 'XRP', type: 'crypto' },
  { symbol: 'ADA-USD', name: '艾達幣', english: 'Cardano', type: 'crypto' },
  { symbol: 'SOL-USD', name: '索拉納', english: 'Solana', type: 'crypto' },
  { symbol: 'DOGE-USD', name: '狗狗幣', english: 'Dogecoin', type: 'crypto' },
  { symbol: 'DOT-USD', name: '波卡', english: 'Polkadot', type: 'crypto' },
  { symbol: 'LTC-USD', name: '萊特幣', english: 'Litecoin', type: 'crypto' }
];
const searchItems = [...stocks, ...cryptoList];
const validIntervals = new Set(['5m', '30m', '1d', '1mo']);
const validRanges = new Set(['1d', '5d', '1mo', '5y']);

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
  if (normalized.includes('tai')) return '上市';
  if (normalized.includes('otc') || normalized.includes('tpe')) return '上櫃';
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

function yahooErrorPayload(message, error) {
  return {
    error: message,
    details: error.message || error.code || 'Unknown Yahoo Finance error',
    code: error.code,
    status: error.response?.status
  };
}

app.get('/api/search', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) {
    return res.json(searchItems.slice(0, 30));
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

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });

    const result = response.data.chart?.result?.[0];
    if (!result || !result.timestamp) {
      return res.status(404).json({ error: 'No chart data available' });
    }

    const quote = result.indicators?.quote?.[0] || {};
    const timestamps = result.timestamp || [];
    const data = timestamps
      .map((timestamp, index) => ({
        timestamp: timestamp * 1000,
        open: quote.open?.[index],
        high: quote.high?.[index],
        low: quote.low?.[index],
        close: quote.close?.[index],
        volume: quote.volume?.[index]
      }))
      .filter(point => point.open != null && point.close != null && point.high != null && point.low != null);

    return res.json({ symbol, meta: result.meta || {}, data });
  } catch (error) {
    return res.status(500).json(yahooErrorPayload('Unable to fetch chart data', error));
  }
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
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });

    let news = response.data.news || [];
    if (!news.length) {
      const quotes = response.data.quotes || [];
      news = quotes.flatMap(q => q.news || []);
    }

    const items = news
      .slice(0, 20)
      .map(n => ({
        title: n.title,
        link: n.link,
        publisher: n.publisher,
        providerPublishTime: n.providerPublishTime,
        summary: n.summary
      }));

    return res.json(items);
  } catch (error) {
    return res.status(500).json(yahooErrorPayload('Unable to fetch news', error));
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

    const profile = response.data.quoteSummary?.result?.[0]?.summaryProfile || {};
    let website = profile.website || null;

    if (!website) {
      website = await fetchGoogleWebsiteFallback(symbol);
    }

    if (website) {
      return res.json({ website, industry: profile.industry || null, sector: profile.sector || null });
    }

    return res.status(502).json({
      error: 'Unable to fetch official company website from Yahoo or Google fallback.',
      details: 'Yahoo profile returned no website and Google fallback also failed.'
    });
  } catch (error) {
    const fallbackWebsite = await fetchGoogleWebsiteFallback(symbol);
    if (fallbackWebsite) {
      return res.json({ website: fallbackWebsite, industry: null, sector: null });
    }

    return res.status(502).json({
      error: 'Unable to fetch company profile from Yahoo and Google fallback failed.',
      details: error.message
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
