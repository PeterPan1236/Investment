import {
  MAX_BATCH_SYMBOLS,
  QUOTE_DELAY_MINUTES,
  chartUrl,
  isValidMarketSymbol,
  normalizeChartResult,
  validRanges
} from '../_utils/market.js';
import { fetchJsonWithTimeout } from '../_utils/yahoo.js';

// Batch daily history for the screener: portfolio weights, the correlation
// matrix and since-added returns all need the same series.
export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get('symbols') || '').trim();
  const range = searchParams.get('range') || '1y';

  if (!raw) {
    return Response.json({ error: 'Missing symbols parameter' }, { status: 400 });
  }
  if (!validRanges.has(range)) {
    return Response.json({ error: 'Invalid range parameter' }, { status: 400 });
  }

  const symbols = Array.from(new Set(raw.split(',').map(symbol => symbol.trim()).filter(Boolean)));
  if (!symbols.length) {
    return Response.json({ error: 'Missing symbols parameter' }, { status: 400 });
  }
  if (symbols.length > MAX_BATCH_SYMBOLS) {
    return Response.json({ error: `At most ${MAX_BATCH_SYMBOLS} symbols per request` }, { status: 400 });
  }
  if (!symbols.every(isValidMarketSymbol)) {
    return Response.json({ error: 'Invalid symbol parameter' }, { status: 400 });
  }

  const settled = await Promise.allSettled(symbols.map(async symbol => {
    const body = await fetchJsonWithTimeout(chartUrl(symbol, '1d', range));
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
    return Response.json({ error: 'Unable to fetch history for any requested symbol', failed }, { status: 502 });
  }

  return Response.json({
    range,
    series,
    failed,
    source: { provider: 'Yahoo Finance', delayMinutes: QUOTE_DELAY_MINUTES, fetchedAt: Date.now(), adjusted: true }
  });
}
