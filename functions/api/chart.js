import { isValidMarketSymbol, validIntervals, validRanges } from '../_utils/market.js';
import { fetchJsonWithTimeout, yahooErrorPayload } from '../_utils/yahoo.js';

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim();
  const interval = searchParams.get('interval') || '1d';
  const range = searchParams.get('range') || '1mo';

  if (!symbol) {
    return Response.json({ error: 'Missing symbol parameter' }, { status: 400 });
  }
  if (!isValidMarketSymbol(symbol)) {
    return Response.json({ error: 'Invalid symbol parameter' }, { status: 400 });
  }
  if (!validIntervals.has(interval)) {
    return Response.json({ error: 'Invalid interval parameter' }, { status: 400 });
  }
  if (!validRanges.has(range)) {
    return Response.json({ error: 'Invalid range parameter' }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`;

  try {
    const body = await fetchJsonWithTimeout(url);
    const result = body.chart?.result?.[0];
    if (!result || !result.timestamp) {
      return Response.json({ error: 'No chart data available' }, { status: 404 });
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

    return Response.json({ symbol, meta: result.meta || {}, data });
  } catch (error) {
    return Response.json(yahooErrorPayload('Unable to fetch chart data', error), { status: 500 });
  }
}
