# Alpha Intelligence — live portfolio page

A minimal live-tracking page for the $100k paper portfolio, matching the style of
the about/link-tree page. Static frontend + one serverless function that fetches
live prices so your Finnhub key never sits in browser-visible code.

## What's in here

- `index.html`, `style.css`, `script.js` — the page itself
- `api/quotes.js` — serverless function (runs on Vercel, not in the browser).
  Fetches live prices from Finnhub for the 8 positions, computes current value
  and all-time return against the fixed entry value, returns it as JSON.

## Setup (10 minutes)

1. **Get a free Finnhub API key**
   Sign up at [finnhub.io/register](https://finnhub.io/register) — free tier is
   plenty for 8 tickers refreshed on page load (60 requests/min limit).

2. **Push this folder to a GitHub repo**
   ```
   cd alpha-intelligence
   git init
   git add .
   git commit -m "Alpha Intelligence portfolio page"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

3. **Import into Vercel**
   Go to [vercel.com/new](https://vercel.com/new), import the repo. Framework
   preset: "Other" (no build step needed — it'll auto-detect the `api/` folder).

4. **Add your API key as an environment variable**
   In the Vercel project → Settings → Environment Variables, add:
   ```
   FINNHUB_API_KEY = <your key from step 1>
   ```
   Redeploy after adding it (Vercel doesn't pick up new env vars on an existing
   deployment automatically).

5. **Deploy.** Your live URL is ready — that's the link to drop into the
   "Portfolio" row on the about page (currently marked "coming soon").

## Good to know

- **Entry prices and quantities are hardcoded** in `api/quotes.js` (the Friday
  31 July 2026 close prices) — that's your fixed "day one" baseline and won't
  change unless you edit the file.
- **The performance history (the line in the graph) currently lives in the
  browser's local storage**, not a shared database. That means it builds up
  correctly for you as you check it over time, but a first-time visitor on a
  different device won't see your accumulated history — just today's snapshot.
  If you want the graph to be identical for every visitor from day one, the
  next step would be a small shared database (e.g. Vercel KV) instead of
  localStorage — happy to add that when you're ready, it's a fairly small
  change to `api/quotes.js` and `script.js`.
- Prices refresh each time the page is loaded (not continuously) — reload to
  get the latest.
