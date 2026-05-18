const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
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

function normalize(text) {
  if (!text && text !== 0) return '';
    try {
      return text
        .toString()
        .normalize('NFKD')
        .toLowerCase()
        .replace(/\s+/g, '');
  } catch (e) {
    return text.toString().toLowerCase();
  }
}

function fuzzySubsequenceMatch(q, t) {
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
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

  if (fuzzySubsequenceMatch(lower, fields.name)) score = Math.min(score, 3);
  if (fuzzySubsequenceMatch(lower, fields.english)) score = Math.min(score, 3);
  if (fuzzySubsequenceMatch(lower, fields.alias)) score = Math.min(score, 3);

  if (fields.market.includes(lower)) score = Math.min(score, 4);

  return score === 999 ? 100 : score;
}

function guessMarketFromExchange(exchange, quoteType) {
  if (!exchange) return undefined;
  const normalized = exchange.toLowerCase();
  if (normalized.includes('tai')) return '上市';
  if (normalized.includes('otc') || normalized.includes('tpe')) return '上櫃';
  if (normalized.includes('otc') && quoteType === 'EQUITY') return '上櫃';
  if (normalized.includes('nasdaq') || normalized.includes('nyse') || normalized.includes('nysemkt') || normalized.includes('nyq')) return 'US';
  if (normalized.includes('crypto') || normalized.includes('binance') || normalized.includes('coinbase')) return 'Crypto';
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

// Temporary debug endpoint to inspect normalized fields and scores
app.get('/api/debug_search', (req, res) => {
  const query = (req.query.query || '').trim();
  const lower = normalize(query);
  const debug = searchItems.map(item => {
    const aliasText = Array.isArray(item.aliases) ? item.aliases.join('') : '';
    const fields = {
      symbol: normalize(item.symbol),
      name: normalize(item.name),
      english: normalize(item.english),
      market: normalize(item.market),
      alias: normalize(aliasText)
    };
    const score = scoreForItem(item, lower);
    return { symbol: item.symbol, name: item.name, fields, score };
  }).filter(d => d.symbol === '8215.TW' || d.score < 50).slice(0, 50);
  res.json({ query, lower, results: debug });
});

// wildcard and server start moved to file end to avoid intercepting /api routes

app.get('/api/chart', async (req, res) => {
  const symbol = (req.query.symbol || '').trim();
  const interval = req.query.interval || '1d';
  const range = req.query.range || '1mo';

  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
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

// Wildcard fallback and server start should be last so API routes are reachable
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
