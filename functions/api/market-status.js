import { QUOTE_DELAY_MINUTES, taiwanMarketStatus } from '../_utils/market.js';

export async function onRequestGet() {
  const now = new Date();
  return Response.json({
    taiwan: taiwanMarketStatus(now),
    crypto: { state: 'open', label: '24/7 交易', session: 'Crypto 全天候' },
    fetchedAt: now.getTime(),
    delayMinutes: QUOTE_DELAY_MINUTES
  });
}
