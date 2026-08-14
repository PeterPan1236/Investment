import { QUOTE_DELAY_MINUTES, chartUrl } from '../_utils/market.js';
import { fetchJsonWithTimeout, yahooErrorPayload } from '../_utils/yahoo.js';

// USD/TWD lets the client show every asset in one base currency and compute
// FX-adjusted returns for the mixed TW-equity + crypto list.
export async function onRequestGet() {
  try {
    const body = await fetchJsonWithTimeout(chartUrl('TWD=X', '1d', '1mo'));
    const result = body.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(value => Number.isFinite(value));
    const rate = closes.length ? closes[closes.length - 1] : result?.meta?.regularMarketPrice;

    if (!Number.isFinite(rate)) {
      return Response.json({ error: 'Unable to resolve USD/TWD rate' }, { status: 502 });
    }

    return Response.json({
      pair: 'USDTWD',
      rate,
      fetchedAt: Date.now(),
      provider: 'Yahoo Finance',
      delayMinutes: QUOTE_DELAY_MINUTES
    });
  } catch (error) {
    return Response.json(yahooErrorPayload('Unable to fetch FX rate', error), { status: 502 });
  }
}
