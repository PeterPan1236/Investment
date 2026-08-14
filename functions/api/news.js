import { isValidMarketSymbol } from '../_utils/market.js';
import { fetchJsonWithTimeout, yahooErrorPayload } from '../_utils/yahoo.js';

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim();

  if (!symbol) {
    return Response.json({ error: 'Missing symbol parameter' }, { status: 400 });
  }
  if (!isValidMarketSymbol(symbol)) {
    return Response.json({ error: 'Invalid symbol parameter' }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}`;

  try {
    const body = await fetchJsonWithTimeout(url);
    let news = body.news || [];
    if (!news.length) {
      const quotes = body.quotes || [];
      news = quotes.flatMap(q => q.news || []);
    }

    // Yahoo repeats the same story across syndication partners; dedupe on the
    // normalized headline so sentiment is not counted twice.
    const seen = new Set();
    const items = news
      .map(n => ({
        symbol,
        title: n.title,
        link: n.link,
        publisher: n.publisher,
        providerPublishTime: n.providerPublishTime,
        summary: n.summary
      }))
      .filter(item => {
        const key = (item.title || '').toLowerCase().replace(/\s+/g, '').slice(0, 80);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.providerPublishTime || 0) - (a.providerPublishTime || 0))
      .slice(0, 20);

    return Response.json(items);
  } catch (error) {
    return Response.json(yahooErrorPayload('Unable to fetch news', error), { status: 500 });
  }
}
