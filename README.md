# Investment Platform

Simple Stock & Crypto analysis web UI for Taiwan-listed equities (TWD) and major cryptocurrencies (USD).

Features
- Search stocks and crypto (fuzzy, CN/EN/ticker)
- K-line (candlestick) charts with volume and moving averages
- Time interval toggles (分/時/天/月)
- Trending news via Yahoo Finance

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

Notes
- The project includes a local dataset at `data/taiwan_stocks.json`.
- The server proxies Yahoo Finance for chart and news data.

License
- Internal/experimental. Add a license if you plan to publish.
