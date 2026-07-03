import { isValidMarketSymbol } from '../_utils/market.js';
import { fetchJsonWithTimeout, fetchGoogleWebsiteFallback } from '../_utils/yahoo.js';

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim();

  if (!symbol) {
    return Response.json({ error: 'Missing symbol parameter' }, { status: 400 });
  }
  if (!isValidMarketSymbol(symbol)) {
    return Response.json({ error: 'Invalid symbol parameter' }, { status: 400 });
  }

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryProfile`;

  try {
    const body = await fetchJsonWithTimeout(url);
    const profile = body.quoteSummary?.result?.[0]?.summaryProfile || {};
    let website = profile.website || null;

    if (!website) {
      website = await fetchGoogleWebsiteFallback(symbol);
    }

    if (website) {
      return Response.json({ website, industry: profile.industry || null, sector: profile.sector || null });
    }

    return Response.json({
      error: 'Unable to fetch official company website from Yahoo or Google fallback.',
      details: 'Yahoo profile returned no website and Google fallback also failed.'
    }, { status: 502 });
  } catch (error) {
    const fallbackWebsite = await fetchGoogleWebsiteFallback(symbol);
    if (fallbackWebsite) {
      return Response.json({ website: fallbackWebsite, industry: null, sector: null });
    }

    return Response.json({
      error: 'Unable to fetch company profile from Yahoo and Google fallback failed.',
      details: error.message
    }, { status: 502 });
  }
}
