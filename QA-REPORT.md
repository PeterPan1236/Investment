# QA Report — Investment Platform (2026-07-02)

## Checklist

| # | Area | Check | Result |
|---|------|-------|--------|
| 1 | Server boot | `node server.js` starts, serves SPA (200) | PASS |
| 2 | Search API | Empty query returns top 30 (superseded: it now returns 400, see update below); `2330tw`, `btcusd`, `tsmc`, `honhai`, typo `medatek` all return correct top result; no unrelated fuzzy matches | PASS |
| 3 | Input validation | Bad symbol → 400, bad interval/range → 400 | PASS |
| 4 | Unknown API route | `/api/doesnotexist` | **FAIL → FIXED** (was 200 + HTML SPA shell; now 404 JSON) |
| 5 | Rate limiting | 60 req/min then 429 | PASS, but **spoofable → FIXED** (X-Forwarded-For rotation bypassed the limit; header now trusted only with `TRUST_PROXY=1`) |
| 6 | Market classification | Yahoo US exchange codes | **FAIL → FIXED** (`NMS`/`NYQ`/`ASE` etc. never matched `nasdaq`/`nyse` substrings; US stocks showed raw code. Also `Coinbase` contained `ase` risk — now exact-code match, crypto checked first) |
| 7 | Chart rendering | Empty state → chart transition | **BUG → FIXED** (empty-state markup was left inside the container under the transparent ECharts canvas) |
| 8 | Chart resize | Window resize / rotation | **BUG → FIXED** (no resize handler; chart stayed at old size — added `chartInstance.resize()`) |
| 9 | RSI indicator | Pure-uptrend series | **BUG → FIXED** (returned ~99.0 instead of 100 when avgLoss = 0) |
| 10 | Risk/Reward levels | Sell-signal take-profit | **EDGE FIXED** (could compute ≤ 0 for volatile assets; clamped to 0.01) |
| 11 | Theme init | Corrupted `localStorage` value | **EDGE FIXED** (invalid value leaked into `data-theme`; now validated to light/dark) |
| 12 | CF Pages middleware | CORS preflight | **GAP FIXED** (OPTIONS requests got no `Allow-Methods`/`Allow-Headers`; now answered with 204) |
| 13 | CF Pages middleware | Rate-limit map growth | **EDGE FIXED** (unbounded Map; now pruned past 1000 entries) |
| 14 | XSS | All user/remote strings escaped (`escapeHTML`), links via `safeExternalUrl`, CSP `script-src 'self'` | PASS |
| 15 | Stale-response races | Request-id guards on search and market data | PASS (by design + harness assertion) |
| 16 | HTML/DOM ids | Every `getElementById` target exists in index.html | PASS |
| 17 | Syntax | `node --check` on all 10 JS files | PASS |
| 18 | Yahoo upstream | Live chart/news/profile fetch | NOT TESTABLE in sandbox (outbound blocked); code path reviewed OK |
| 19 | Playwright E2E | `npm run test:regression` | Browser download blocked in sandbox; all 5 pre-browser API assertions PASS. Run locally to confirm the UI flow. |

## Files changed

- `server.js` — API 404 handler; rate-limit IP no longer trusts spoofable `X-Forwarded-For` (opt-in via `TRUST_PROXY=1` when behind a proxy); US exchange-code detection; crypto checked before US.
- `functions/_utils/market.js` — same exchange-code fix; accepts `quoteType`.
- `functions/_utils/yahoo.js` — passes `quoteType` through.
- `functions/_middleware.js` — CORS preflight handling; rate-limit map pruning.
- `public/app.js` — chart container cleared before ECharts init; window-resize handler; RSI = 100 edge case; take-profit/stop-loss clamped positive.
- `public/theme-init.js` — saved theme validated.

## Verification performed

Local server on test ports: SPA 200, unknown API 404 JSON, invalid params 400, rate limit 429 after 60 (with rotating XFF headers — no bypass), all 5 harness search assertions pass, `guessMarketFromExchange` unit cases pass, RSI uptrend = 100.

## Recommended follow-up

- Run `npm run test:regression` on your machine (needs `npx playwright install`).
- If you deploy behind a reverse proxy, set `TRUST_PROXY=1` so per-client rate limiting uses the forwarded IP.

## Update (2026-09-02)

Behaviour changed after this report was written:

- `/api/search` with an empty query now returns `400 Missing query parameter` instead of dumping the first 30 universe entries.
- `/api/chart` and `/api/news` map an upstream 404 to `404` and everything else to `502`, and no longer echo the upstream error message, code or URL to the client.
- `/api/profile` only uses the Google "I'm feeling lucky" fallback for symbols in the local universe or confirmed by Yahoo; unknown symbols return `404` instead of an unrelated website.
- `/api/news` reads Yahoo's symbol-scoped RSS headline feed, falling back to the search feed only when it is empty.
- The UI is English; Chinese company names are kept as search aliases in `data/taiwan_stocks.json`.
