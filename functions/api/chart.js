import {
  chartUrl,
  dataSourceInfo,
  isValidMarketSymbol,
  normalizeChartResult,
  validIntervals,
  validRanges
} from '../_utils/market.js';
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

  try {
    const body = await fetchJsonWithTimeout(chartUrl(symbol, interval, range));
    const result = body.chart?.result?.[0];
    if (!result || !result.timestamp) {
      return Response.json({ error: 'No chart data available' }, { status: 404 });
    }

    const data = normalizeChartResult(result);
    return Response.json({ symbol, meta: result.meta || {}, data, source: dataSourceInfo(data) });
  } catch (error) {
    return Response.json(yahooErrorPayload('Unable to fetch chart data', error), { status: 500 });
  }
}
