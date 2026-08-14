export const validIntervals = new Set(['5m', '30m', '1d', '1mo']);
export const validRanges = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);

export const QUOTE_DELAY_MINUTES = 15;
export const MAX_BATCH_SYMBOLS = 20;

export function chartUrl(symbol, interval, range) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
    + '&includePrePost=false&events=div%2Csplit';
}

// Split/dividend adjusted closes are required for moving averages, returns and
// backtests; raw OHLC is kept for candle rendering only.
export function normalizeChartResult(result) {
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

export function dataSourceInfo(data = []) {
  return {
    provider: 'Yahoo Finance',
    delayMinutes: QUOTE_DELAY_MINUTES,
    fetchedAt: Date.now(),
    lastBarAt: data.length ? data[data.length - 1].timestamp : null,
    adjusted: true
  };
}

const TAIPEI_TIMEZONE = 'Asia/Taipei';

// TWSE regular session is 09:00-13:30 Taipei time on weekdays. Public holidays
// are not encoded here, so a weekday with no fresh bar is reported as stale
// rather than open; the client shows the last bar timestamp either way.
export function taiwanMarketStatus(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIMEZONE,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const session = 'TWSE 09:00–13:30 (UTC+8)';

  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') {
    return { state: 'closed', label: '休市（週末）', session };
  }
  if (minutes < 9 * 60) {
    return { state: 'pre', label: '尚未開盤', session };
  }
  if (minutes > 13 * 60 + 30) {
    return { state: 'closed', label: '已收盤', session };
  }
  return { state: 'open', label: '盤中', session };
}

export function isValidMarketSymbol(symbol) {
  return /^[A-Za-z0-9.^=-]{1,32}$/.test(symbol);
}

const US_EXCHANGE_CODES = new Set(['nms', 'ngm', 'ncm', 'nyq', 'ase', 'pcx', 'bts', 'cxi']);

export function guessMarketFromExchange(exchange, quoteType) {
  if (!exchange) return undefined;
  const normalized = exchange.toLowerCase();
  if (normalized.includes('tai')) return '上市';
  if (normalized.includes('otc') || normalized.includes('tpe')) return '上櫃';
  if (normalized.includes('crypto') || normalized.includes('binance') || normalized.includes('coinbase') || quoteType === 'CRYPTOCURRENCY') return 'Crypto';
  if (US_EXCHANGE_CODES.has(normalized) || normalized.includes('nasdaq') || normalized.includes('nyse') || normalized.includes('nysemkt')) return 'US';
  return exchange;
}
