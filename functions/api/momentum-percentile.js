import {
  chartUrl,
  isValidMarketSymbol,
  normalizeChartResult,
  QUOTE_DELAY_MINUTES,
  validRanges
} from '../_utils/market.js';
import { fetchJsonWithTimeout } from '../_utils/yahoo.js';
import { searchItems } from '../_utils/search-data.js';

const MOMENTUM_LOOKBACK = 20;

// Every requested symbol needs the whole watchlist's trailing-return matrix to
// rank against, so this is cached per range (not per symbol) - a cold request
// fetches ~60 upstream charts once, then every symbol query for that range is
// a cache hit until it expires.
const matrixCache = new Map();
const MATRIX_TTL_MS = 15 * 60 * 1000;

function computeTrailingReturns(bars) {
  return bars.map((bar, i) => {
    if (i < MOMENTUM_LOOKBACK) return null;
    const past = bars[i - MOMENTUM_LOOKBACK].close;
    if (!(past > 0)) return null;
    return (bar.close - past) / past;
  });
}

async function buildMomentumMatrix(range) {
  const cached = matrixCache.get(range);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const universe = searchItems.filter(item => item.type === 'stock');
  const settled = await Promise.allSettled(universe.map(async item => {
    const body = await fetchJsonWithTimeout(chartUrl(item.symbol, '1d', range));
    const result = body.chart?.result?.[0];
    if (!result || !result.timestamp) throw new Error('No chart data available');
    const bars = normalizeChartResult(result);
    return { symbol: item.symbol, bars, momentum: computeTrailingReturns(bars) };
  }));

  // date (yyyy-mm-dd) -> array of { symbol, momentum }
  const byDate = new Map();
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    const { symbol, bars, momentum } = outcome.value;
    bars.forEach((bar, i) => {
      if (momentum[i] == null) return;
      const dateKey = new Date(bar.timestamp).toISOString().slice(0, 10);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push({ symbol, momentum: momentum[i] });
    });
  }

  const value = { byDate, universeSize: universe.length };
  matrixCache.set(range, { value, expiresAt: Date.now() + MATRIX_TTL_MS });
  return value;
}

function percentileOf(entries, symbol) {
  const target = entries.find(e => e.symbol === symbol);
  if (!target || entries.length < 20) return null;
  const below = entries.filter(e => e.momentum < target.momentum).length;
  return below / (entries.length - 1 || 1);
}

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim();
  const range = searchParams.get('range') || '2y';

  if (!symbol) {
    return Response.json({ error: 'Missing symbol parameter' }, { status: 400 });
  }
  if (!isValidMarketSymbol(symbol)) {
    return Response.json({ error: 'Invalid symbol parameter' }, { status: 400 });
  }
  if (!validRanges.has(range)) {
    return Response.json({ error: 'Invalid range parameter' }, { status: 400 });
  }

  try {
    const { byDate, universeSize } = await buildMomentumMatrix(range);
    const percentiles = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dateKey, entries]) => ({
        timestamp: Date.parse(`${dateKey}T00:00:00.000Z`),
        percentile: percentileOf(entries, symbol)
      }));

    return Response.json({
      symbol,
      range,
      universeSize,
      percentiles,
      source: { provider: 'Yahoo Finance', delayMinutes: QUOTE_DELAY_MINUTES, fetchedAt: Date.now(), adjusted: true }
    });
  } catch (error) {
    return Response.json({ error: 'Unable to compute momentum percentile', message: String(error?.message || error) }, { status: 502 });
  }
}
