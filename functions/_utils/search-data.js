import stocks from '../../data/taiwan_stocks.json';

const cryptoList = [
  { symbol: 'BTC-USD', name: '比特幣', english: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETH-USD', name: '以太幣', english: 'Ethereum', type: 'crypto' },
  { symbol: 'USDT-USD', name: '泰達幣', english: 'Tether', type: 'crypto' },
  { symbol: 'BNB-USD', name: '幣安幣', english: 'BNB', type: 'crypto' },
  { symbol: 'XRP-USD', name: '瑞波幣', english: 'XRP', type: 'crypto' },
  { symbol: 'ADA-USD', name: '艾達幣', english: 'Cardano', type: 'crypto' },
  { symbol: 'SOL-USD', name: '索拉納', english: 'Solana', type: 'crypto' },
  { symbol: 'DOGE-USD', name: '狗狗幣', english: 'Dogecoin', type: 'crypto' },
  { symbol: 'DOT-USD', name: '波卡', english: 'Polkadot', type: 'crypto' },
  { symbol: 'LTC-USD', name: '萊特幣', english: 'Litecoin', type: 'crypto' }
];

export const searchItems = [...stocks, ...cryptoList];

export function normalize(text) {
  if (!text && text !== 0) return '';
  try {
    return text
      .toString()
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\s._-]+/g, '');
  } catch (e) {
    return text.toString().toLowerCase();
  }
}

export function fuzzyTypoMatch(q, t) {
  if (!q || !t) return false;
  if (t.includes(q)) return true;

  if (q.length < 4) return false;

  const maxDistance = q.length <= 5 ? 1 : 2;
  if (Math.abs(q.length - t.length) > maxDistance) return false;

  const previous = Array.from({ length: t.length + 1 }, (_, index) => index);
  const current = Array(t.length + 1).fill(0);

  for (let i = 1; i <= q.length; i += 1) {
    current[0] = i;
    let rowMinimum = current[0];

    for (let j = 1; j <= t.length; j += 1) {
      const substitutionCost = q[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }

    if (rowMinimum > maxDistance) return false;

    for (let j = 0; j <= t.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[t.length] <= maxDistance;
}

export function scoreForItem(item, lower) {
  const aliasText = Array.isArray(item.aliases) ? item.aliases.join('') : '';
  const fields = {
    symbol: normalize(item.symbol),
    name: normalize(item.name),
    english: normalize(item.english),
    market: normalize(item.market),
    alias: normalize(aliasText)
  };

  let score = 999;

  if (fields.symbol.startsWith(lower)) score = Math.min(score, 0);
  if (fields.name.startsWith(lower)) score = Math.min(score, 1);
  if (fields.english.startsWith(lower)) score = Math.min(score, 1);
  if (fields.alias.startsWith(lower)) score = Math.min(score, 1);

  if (fields.symbol.includes(lower)) score = Math.min(score, 2);
  if (fields.name.includes(lower)) score = Math.min(score, 2);
  if (fields.english.includes(lower)) score = Math.min(score, 2);
  if (fields.alias.includes(lower)) score = Math.min(score, 2);

  if (fuzzyTypoMatch(lower, fields.name)) score = Math.min(score, 3);
  if (fuzzyTypoMatch(lower, fields.english)) score = Math.min(score, 3);
  if (fuzzyTypoMatch(lower, fields.alias)) score = Math.min(score, 3);

  if (fields.market.includes(lower)) score = Math.min(score, 4);

  return score === 999 ? 100 : score;
}
