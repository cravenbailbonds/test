# RankPilot

An all-in-one visibility platform for local businesses and the agencies that serve them: **Google Maps rankings, Google Business Profile, reviews, listings, technical SEO, keywords, organic rankings, backlinks, and AI-assistant visibility**, with one prioritized action plan on top.

It covers the jobs of an all-in-one SEO suite plus a local-SEO add-on, and goes further where those tools fall short:

| Area | What you get | What's better |
|---|---|---|
| **Map Rank Grid** | Geo-grid scans (3×3 to 15×15, 0.5 to 25 mi, square/circle/distance-ring shapes). ARP, ATRP, Share of Local Voice, CTR-weighted visibility score. Click any pin to see who outranks you from that exact spot. | Plain-English insights ("you hold the 3-pack out to 1.5 mi; weakest direction is north"), a **competitor leaderboard across the whole grid**, side-by-side before/after maps, scan-over-scan deltas, and automatic weekly re-scans. Uses DataForSEO's GPS-exact Maps SERP when available, which is more faithful than a city-level check. |
| **Business Profile** | Completeness score with weighted checks and a fix for each. | **Benchmarks you against the businesses actually beating you on your grid** (review gap, rating gap, categories). |
| **Reviews** | Rating, distribution, velocity, unreplied count, sentiment. | **Theme analysis** (speed, staff, price, communication, trust) shows *why* people are unhappy, plus one-click AI reply drafts that are on-brand, specific and locally relevant. |
| **Listings** | Fetches each directory profile you paste and verifies name, address and phone. | Flags *other* phone numbers found on listings and gives a weighted list of missing directories with links to claim them. |
| **Site Audit** | Real crawler, 45+ checks: status codes, broken links, redirect chains, HTTPS and mixed content, titles, descriptions, H1s, thin content, alt text, canonicals, internal-link depth, speed. | **Local-SEO checks** (LocalBusiness schema, NAP on page, city in content and titles, click-to-call, map embed) and **AI-search readiness checks** (AI crawlers blocked in robots.txt, llms.txt, FAQ content, schema sameAs). Works with no API keys. |
| **Keyword Research** | Ideas with volume, KD, CPC, intent and 12-month trend. | An **Opportunity score** (volume × winnability × buyer intent), **topic clusters** (one page per cluster), and the **questions customers ask AI**. |
| **Rank Tracking** | Positions, change, SERP features, estimated clicks, visibility trend. | Tracks whether **Google's AI Overview appears and whether it cites you**, per keyword. |
| **Backlinks** | Authority, referring domains and backlinks for you and up to 4 competitors. | **Link gap**: sites linking to competitors but not to you. |
| **AI Visibility** | Asks AI assistants the questions your customers ask, using live web search, then measures mention rate, position, sentiment, AI share of voice, competitors recommended and **sources cited**. | Tells you which sources the AI trusts for your category and what to fix to get recommended. |
| **Content Studio** | GBP posts, service/location pages, blogs, meta tags, GBP description, FAQ + FAQPage schema, **llms.txt**, LocalBusiness JSON-LD, review-request SMS/email. | Built-in content grader (keyword use, readability, structure, local signals, related-term coverage). The writer is instructed never to invent facts: it uses `[placeholders]` instead. |
| **Action Plan** | Every module feeds one to-do list ranked by impact ÷ effort, with checkboxes. | Optional AI strategist summary: what's holding you back, plus a this-week and this-month plan. |
| **Client Report** | Printable / Save-as-PDF report. | Written in plain English for business owners. |

## Quick start

```bash
npm install
cp .env.example .env     # optional - add whichever keys you have
npm start                # http://localhost:3000
```

Click **Add Business**, then **Try with a sample business** to explore immediately. Every module works without keys in clearly labelled **DEMO DATA** mode, except the site audit and listings checker, which always run live.

## Data providers (all optional)

| Key | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Live AI visibility checks (Claude with web search), review replies, content writer, keyword questions, AI strategist summary. An `ant auth login` profile also works. |
| `GOOGLE_PLACES_API_KEY` | Live Maps rankings via Places API (New), "find my business" autofill, live profile and reviews. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | GPS-exact Google Maps grid (most accurate), organic SERPs with AI Overview detection, keyword volumes and ideas, backlinks. |

The grid's **Data source** picker chooses DataForSEO, then Google Places, then demo. Approximate cost per 7×7 scan: 49 API calls.

## Architecture

```
server/
  index.js            HTTP API + static hosting (Node built-ins only)
  store.js            JSON document store (projects + every scan, kept for trends)
  scheduler.js        automatic daily/weekly re-scans
  lib/geo.js          grid geometry (square, circle, rings), haversine
  lib/metrics.js      ARP, ATRP, SoLV, CTR-weighted visibility, leaderboards
  providers/          places.js, dataforseo.js, ai.js (Claude), demo.js (deterministic simulation)
  modules/            maprank, gbp, reviews, citations, audit, keywords, aivisibility, content, actionplan
public/               vanilla JS single-page app, Leaflet (vendored) for maps, hand-rolled SVG charts
test/                 node:test suite
```

The only runtime dependency is `@anthropic-ai/sdk`. Data lives in `data/db.json`. Modules only call `store.js`, so swapping in Postgres later is contained to that one file.

```bash
npm test
```

## Notes and limits

- The Google Places "search from a point" approach approximates what a searcher at that spot sees. For production-grade grid accuracy, use DataForSEO.
- Reply status for reviews and GBP posting need Google Business Profile API access, which Google grants per application. The integration point is `server/modules/reviews.js`.
- Some directories block automated fetches. The listings checker reports those so you can verify them by hand.
- AI answers vary run to run. Track the trend across scheduled runs rather than any single run.
