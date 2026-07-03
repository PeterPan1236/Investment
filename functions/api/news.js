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

    const items = news
      .slice(0, 20)
      .map(n => ({
        title: n.title,
        link: n.link,
        publisher: n.publisher,
        providerPublishTime: n.providerPublishTime,
        summary: n.summary
      }));

    return Response.json(items);
  } catch (error) {
    return Response.json(yahooErrorPayload('Unable to fetch news', error), { status: 500 });
  }
}
