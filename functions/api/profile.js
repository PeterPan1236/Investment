import { isValidMarketSymbol } from '../_utils/market.js';
import { searchItems } from '../_utils/search-data.js';
import { fetchJsonWithTimeout, fetchGoogleWebsiteFallback } from '../_utils/yahoo.js';

function isKnownSymbol(symbol) {
  const lower = symbol.toLowerCase();
  return searchItems.some(item => String(item.symbol).toLowerCase() === lower);
}

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
    const summary = body.quoteSummary?.result?.[0];
    const profile = summary?.summaryProfile || {};
    let website = profile.website || null;

    // The Google "I'm feeling lucky" fallback resolves nonsense symbols to
    // unrelated sites, so it only runs for symbols the app actually knows.
    if (!website && (summary || isKnownSymbol(symbol))) {
      website = await fetchGoogleWebsiteFallback(symbol);
    }

    if (!website && !summary && !isKnownSymbol(symbol)) {
      return Response.json({ error: 'Unknown symbol' }, { status: 404 });
    }

    if (website) {
      return Response.json({ website, industry: profile.industry || null, sector: profile.sector || null });
    }

    return Response.json({
      error: 'Unable to fetch official company website from Yahoo or Google fallback.',
      details: 'Yahoo profile returned no website and Google fallback also failed.'
    }, { status: 502 });
  } catch (error) {
    const fallbackWebsite = isKnownSymbol(symbol) ? await fetchGoogleWebsiteFallback(symbol) : null;
    if (fallbackWebsite) {
      return Response.json({ website: fallbackWebsite, industry: null, sector: null });
    }

    return Response.json({
      error: 'Unable to fetch company profile from Yahoo and Google fallback failed.',
      details: 'The data provider is unavailable. Try again shortly.'
    }, { status: 502 });
  }
}
