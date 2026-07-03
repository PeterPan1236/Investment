import { searchItems, normalize, scoreForItem } from '../_utils/search-data.js';
import { fetchYahooSearch } from '../_utils/yahoo.js';

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('query') || '').trim();

  if (!query) {
    return Response.json(searchItems.slice(0, 30));
  }

  const lower = normalize(query);
  const localResults = searchItems
    .map(item => ({ ...item, score: scoreForItem(item, lower) }))
    .filter(item => item.score < 100)
    .sort((a, b) => a.score - b.score)
    .slice(0, 30)
    .map(({ score, ...rest }) => rest);

  if (localResults.length > 0) {
    return Response.json(localResults);
  }

  const yahooResults = await fetchYahooSearch(query);
  return Response.json(yahooResults.slice(0, 30));
}
