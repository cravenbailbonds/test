# RankPilot

An all-in-one visibility platform for local businesses and the agencies that serve them: **Google Maps rankings, Google Business Profile, reviews, listings, technical SEO, keywords, organic rankings, backlinks, and AI-assistant visibility**, with one prioritized action plan on top.

It covers the jobs of an all-in-one SEO suite plus a local-SEO add-on, and goes further where those tools fall short:

| Area | What you get | What's better |
|---|---|---|
| **Map Rank Grid** | Geo-grid scans (3×3 to 15×15, 0.5 to 25 mi, square/circle/distance-ring shapes). ARP, ATRP, Share of Local Voice, CTR-weighted visibility score. Click any pin to see who outranks you from that exact spot. | Plain-English insights ("you hold the 3-pack out to 1.5 mi; weakest direction is north"), a **competitor leaderboard across the whole grid**, side-by-side before/after maps, scan-over-scan deltas, and automatic weekly re-scans. Uses DataForSEO's GPS-exact Maps SERP when available, which is more faithful than a city-level check. |
| **Business Profile** | Completeness score with weighted checks and a fix for each. | **Benchmarks you against the businesses actually beating you on your grid** (review gap, rating gap, categories). |
| **Reviews** | Rating, distribution, velocity, unreplied count, sentiment, **alerts for new and negative reviews**, **competitor review tracking** (rating, count and reviews/month for the businesses beating you on the grid). | **Theme analysis** (speed, staff, price, communication, trust) shows *why* people are unhappy, plus one-click AI reply drafts that are on-brand, specific and locally relevant. |
| **Review Requests** | Paste customers, send SMS (Twilio) or email (Resend) review requests now or on a delay, automatic reminder, tracked links, click-through and reviews-gained stats. | Same direct link for every customer, so it stays inside Google's rules. Works in test mode with no keys. |
| **Listings** | Fetches each directory profile you paste and verifies name, address and phone. | Flags *other* phone numbers found on listings and gives a weighted list of missing directories with links to claim them. |
| **Site Audit** | Real crawler, 61 checks, scores by area, weekly re-audits, Core Web Vitals (PageSpeed Insights): status codes, broken links, redirect chains, HTTPS and mixed content, titles, descriptions, H1s, thin content, alt text, canonicals, internal-link depth, speed. | **Local-SEO checks** (LocalBusiness schema, NAP on page, city in content and titles, click-to-call, map embed) and **AI-search readiness checks** (AI crawlers blocked in robots.txt, llms.txt, FAQ content, schema sameAs). Works with no API keys. |
| **Competitor Research** | Domain Overview (keywords, traffic, ranking distribution, intent), Top Pages, and **Keyword Gap** across you + 4 competitors (missing / weak / untapped / strong / shared). | Track any gap keyword in one click. |
| **Keyword Research** | Ideas with volume, KD, CPC, intent and 12-month trend. | An **Opportunity score** (volume × winnability × buyer intent), **topic clusters** (one page per cluster), and the **questions customers ask AI**. |
| **Rank Tracking** | Desktop + mobile, multiple cities/ZIPs, up to 20 competitors' positions, share of voice, SERP features, estimated clicks, trend, **cannibalization detection** and **drop alerts**. | Tracks whether **Google's AI Overview appears and whether it cites you**, per keyword. |
| **Traffic Insights** | Google Search Console queries, pages and daily clicks; GA4 traffic sources. | **Visits from AI assistants** (ChatGPT, Perplexity, Gemini, Claude, Copilot), quick-win queries and low-CTR titles to rewrite. |
| **Backlinks** | Authority, referring domains and backlinks for you and up to 4 competitors, plus a **backlink audit** scoring every referring domain for spam and generating a Google disavow file. | **Link gap**: sites linking to competitors but not to you. |
| **AI Visibility** | Asks **Claude, ChatGPT, Gemini and Perplexity** the questions your customers ask, using live web search, then measures mention rate, position, sentiment, AI share of voice, competitors recommended and **sources cited**. | **Brand perception matrix**: how AI describes you vs competitors on each selling point (speed, price, reputation, expertise…), with the gaps to close. Per-engine breakdown and drop alerts. |
| **Content Studio** | **Content briefs built from the pages that currently rank** (length, headings, terms, questions, schema), GBP posts, service/location pages, blogs, meta tags, GBP description, FAQ + FAQPage schema, **llms.txt**, LocalBusiness JSON-LD, review-request SMS/email, **repurposing into social posts and email**. | Built-in content grader (keyword use, readability, structure, local signals, related-term coverage). The writer is instructed never to invent facts: it uses `[placeholders]` instead. |
| **Action Plan** | Every module feeds one to-do list ranked by impact ÷ effort, with checkboxes. | Optional AI strategist summary: what's holding you back, plus a this-week and this-month plan. |
| **Client Report** | Printable / Save-as-PDF report with your logo and colors, **live share links**, email delivery and weekly/monthly schedules. | Written in plain English for business owners. |
| **Alerts** | In-app feed plus email for negative reviews, rating drops, map/rank/AI drops and site-health drops. | |

## Quick start

```bash
npm install
cp .env.example .env     # optional - add whichever keys you have
npm start                # http://localhost:3000
```

Click **Add Business**, then **Try with a sample business** to explore immediately. Every module works without keys in clearly labelled **DEMO DATA** mode, except the site audit and listings checker, which always run live. Review requests and report emails run in test mode (recorded, not sent) until email/SMS keys are added.

## Put it online (use it from your phone)

1. Merge the pull request into `main` (Render deploys from the default branch).
2. Open **https://render.com/deploy?repo=https://github.com/cravenbailbonds/test**, sign in with GitHub and allow Render to see the repository.
3. When asked, set **APP_PASSWORD** (required, it protects your data) and paste any API keys you have. Blank keys keep that module in demo mode.
4. Click **Deploy**. After a few minutes you get an address like `https://rankpilot-xxxx.onrender.com`.
5. On your phone, open that address, enter the password (any username), then **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android) to get an app icon.

The free plan is fine for trying it, but it sleeps after 15 minutes idle (the first visit then takes about a minute) and **erases saved data on every restart or redeploy**. For real use, switch the service to the Starter plan, add a 1 GB disk mounted at `/var/data`, and set `DATA_DIR=/var/data`. Scheduled scans and review-request sending need the server awake, which also requires a paid plan.

## Data providers (all optional)

| Key | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Live AI visibility checks (Claude with web search), review replies, content writer, keyword questions, AI strategist summary. An `ant auth login` profile also works. |
| `GOOGLE_PLACES_API_KEY` | Live Maps rankings via Places API (New), "find my business" autofill, live profile and reviews. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | GPS-exact Google Maps grid (most accurate), organic SERPs with AI Overview detection, keyword volumes and ideas, competitor domains and keyword gap, backlinks and backlink audit, content briefs from real ranking pages. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY` | ChatGPT, Gemini and Perplexity in AI Visibility. |
| `RESEND_API_KEY` + `EMAIL_FROM` | Email review requests, alert emails, report emails. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | SMS review requests. |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Search Console + GA4 in Traffic Insights. Add the service account's email as a user on both properties. |
| `PAGESPEED_API_KEY` | Optional; Core Web Vitals work without it at low volume. |
| `PUBLIC_URL` | The address customers and clients reach the app at, used in review links and share links. |
| `APP_PASSWORD` | Password-protects the app. Set it before hosting publicly. Review links and shared reports stay public. |

The grid's **Data source** picker chooses DataForSEO, then Google Places, then demo. Approximate cost per 7×7 scan: 49 API calls.

## Architecture

```
server/
  index.js            HTTP API + static hosting (Node built-ins only)
  store.js            JSON document store (projects + every scan, kept for trends)
  scheduler.js        automatic daily/weekly re-scans
  lib/geo.js          grid geometry (square, circle, rings), haversine
  lib/metrics.js      ARP, ATRP, SoLV, CTR-weighted visibility, leaderboards
  providers/          places.js, dataforseo.js, ai.js (Claude), engines.js (ChatGPT/Gemini/Perplexity),
                      google.js (GSC/GA4), messaging.js (email/SMS), demo.js (deterministic simulation)
  modules/            maprank, gbp, reviews, reviewrequests, citations, audit, keywords, research, linkaudit,
                      brief, traffic, aivisibility, content, reports, notify, actionplan
public/               vanilla JS single-page app, Leaflet (vendored) for maps, hand-rolled SVG charts
test/                 node:test suite
```

The only runtime dependency is `@anthropic-ai/sdk`. Data lives in `data/db.json`. Modules only call `store.js`, so swapping in Postgres later is contained to that one file.

```bash
npm test
```

## Notes and limits

- The Google Places "search from a point" approach approximates what a searcher at that spot sees. For production-grade grid accuracy, use DataForSEO.
- Pushing listings to 70+ directories needs a paid aggregator partner (e.g. BrightLocal, Yext). RankPilot checks listings but does not distribute them.
- Prompt-volume data like SEMrush's Prompt Research comes from proprietary datasets and isn't included.
- Reply status for reviews and GBP posting need Google Business Profile API access, which Google grants per application. The integration point is `server/modules/reviews.js`.
- Some directories block automated fetches. The listings checker reports those so you can verify them by hand.
- AI answers vary run to run. Track the trend across scheduled runs rather than any single run.
