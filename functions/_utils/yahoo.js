import { guessMarketFromExchange } from './market.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchYahooSearch(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return [];
    const data = await response.json();
    const quotes = data.quotes || [];
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

// Upstream failures are logged but never echoed to the client: the raw error
// message carries the request URL and runtime internals.
export function yahooErrorPayload(message, error) {
  console.warn(`[yahoo] ${message}:`, error?.message || error?.code || error);
  return {
    error: message,
    details: error?.status === 404
      ? 'The data provider has no data for this request.'
      : error?.status
        ? 'The data provider rejected the request.'
        : 'The data provider is unavailable. Try again shortly.'
  };
}

export function upstreamHttpStatus(error) {
  return error?.status === 404 ? 404 : 502;
}

export function parseGoogleRedirectLocation(location) {
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

export async function fetchGoogleWebsiteFallback(symbol) {
  const cleaned = symbol.replace(/(\..*|-.+)/, '').trim();
  const query = `${cleaned} official website`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&btnI=1`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'manual'
    });

    return parseGoogleRedirectLocation(response.headers.get('location'));
  } catch (error) {
    return null;
  }
}

export async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, timeoutMs);
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
