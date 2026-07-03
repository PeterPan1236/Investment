export const validIntervals = new Set(['5m', '30m', '1d', '1mo']);
export const validRanges = new Set(['1d', '5d', '1mo', '5y']);

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
