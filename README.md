# Investment Platform

Simple Stock & Crypto analysis web UI for Taiwan-listed equities (TWD) and major cryptocurrencies (USD).

Features
- Search stocks and crypto (fuzzy, CN/EN/ticker)
- K-line (candlestick) charts with volume, MA20/60/200 and past signal flips marked on the price
- Time interval toggles (分/時/天/月), TWD/USD base-currency toggle with FX-adjusted values
- Per-asset news with relevance mapping and sentiment tags (unmapped market-wire stories are excluded from scoring)
- Signal engine: multi-horizon MA alignment, ADX trend-strength gate, ATR volatility regime, volume confirmation, numeric 0-100 confidence
- Published signal track record: every past flip with hit rate and average P&L
- Forecast as a P10/P50/P90 distribution — no point price targets
- Backtest tab: signal vs buy-and-hold, net of TW (0.1425% fee + 0.3% tax) or crypto (0.1% taker) costs, with Sharpe, max drawdown, turnover and cost drag
- Portfolio tab: inverse-volatility or equal weights, cash sleeve, correlation heatmap, risk contributions and correlation-aware effective bets
- Screener tab: the universe carries at most two crypto names (BTC, ETH) because crypto correlations are too high for a longer list to add diversification; user-set criteria produce the list; per-name entry price, target, stop and invalidation are stored locally, and any thesis unreviewed for 90+ days is flagged 待覆核
- Prominent disclaimer, data-source/delay banner, market-session state, and a published methodology write-up

Positioning
- The list is **screener output**, not a recommendation list. Nothing is ranked by conviction and no advice is offered.
- All returns shown are pre-tax. See the in-app 稅務與幣別說明 for TW dividend vs overseas-income treatment.
- If this is ever opened to the public in Taiwan, get local counsel on whether the feature set touches 投顧 licensing.

Quickstart
1. Install dependencies:

```bash
npm install
```

2. Run the server:

```bash
npm start
# then open http://localhost:3000
```

Windows PowerShell note: if `npm` is blocked by the local execution policy, use `npm.cmd start` or run `node server.js` directly.

Notes
- The project includes a local dataset at `data/taiwan_stocks.json`.
- The server proxies Yahoo Finance for chart, news, FX and batch-history data, with an in-process response cache and per-IP rate limiting.
- Prices are split/dividend adjusted (`adjClose`); raw OHLC is used only for candle rendering.
- Client analytics live in `public/lib/` (`indicators`, `signal`, `forecast`, `backtest`, `portfolio`, `screener`) and are shared by every view.
- Taiwan market holidays are not encoded; a weekday outside session hours reports 已收盤 and the last bar timestamp is always shown.

Regression test
```bash
npm run test:regression
```

Styles
- Tailwind utilities are compiled ahead of time into `public/vendor/tailwind.css` (checked in). The runtime CDN build is not used, so there is no build step at deploy time.
- After adding or changing a Tailwind class in `public/index.html`, `public/app.js` or `public/lib/*.js`, regenerate the stylesheet:

```bash
npm run build:css
```

Deployment (Cloudflare Pages)
- `wrangler.toml` pins `pages_build_output_dir = "public"`; the API is served by Pages Functions in `functions/api/*` mapped to `/api/*`.
- `server.js` is the local Express equivalent of those endpoints and is not part of the deployment.

License
- Internal/experimental. Add a license if you plan to publish.
