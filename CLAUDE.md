# Alpha Intelligence — context for Claude Code

This is a live paper-portfolio tracker feeding Valerio's "Worth Knowing" Substack
newsletter. Read this before making changes — the code is straightforward, but
several decisions here look wrong until you know why they're that way. Getting
these wrong has caused real, painful debugging sessions before.

## What's in the repo

- `index.html`, `style.css`, `script.js` — the page itself
- `api/quotes.js` — main serverless function, runs on every page load. Fetches
  live prices for all positions + computes current value/return/weights
- `api/cron-update.js` — hit every 5 min by an external cron (cron-job.org),
  logs a history point even when nobody has the page open
- `api/debug-history.js` — READ-ONLY diagnostic. Visit it directly in a browser
  to see what's actually stored in each history key. Safe to hit anytime.
- `quotes.js` (repo root, **not** in `api/`) — stale leftover from an early
  8-position version of the portfolio (MU/NBIS/MRVL/LITE/IREN/AXTI/DRAM/BRUN).
  Not wired up as a Vercel route (Vercel only serves functions from `api/`),
  so it's dead code. Don't edit it thinking it's live; consider deleting it
  in a dedicated cleanup pass rather than as a side effect of an unrelated change.

## The one rule that matters most: rebalances touch THREE places

When Valerio reports a trade (usually a screenshot of TradingView order
history), three things need to change together:

1. **`POSITIONS` array in `api/quotes.js`** — update quantities/entry prices.
   Has a `name` field per position.
2. **`POSITIONS` array in `api/cron-update.js`** — same tickers, same
   quantities, same entry prices. NO `name` field. These two arrays must
   always match exactly, or the live value and the logged history diverge.
3. **`CLOSED_POSITIONS` array in `script.js`** — only when something is fully
   closed (not for a live position's size just changing). A close adds a
   `Closed` entry plus a separate `Trimmed` entry for each earlier trim of
   that position (see below).

**Before touching these files, verify the trade math with actual code
execution** (python/node), not by eyeballing it. Confirm sells roughly fund
buys, confirm gain% and $ figures. Valerio has been burned by silent
arithmetic mistakes before and expects the numbers to actually be checked,
not just look plausible.

Each rebalance also gets short notes (the little bubbles) under the positions it
touched. See "Notes" below.

## How to add a closed position correctly

- **Weight is computed from ENTRY price × quantity, not current price.** This
  is deliberate — it reflects sizing decisions, not day-to-day price noise.
- **Trims are always their own entries — never merge a trim into the closing
  entry.** (Valerio's rule, 2026-10-02.) When a position is fully closed
  after earlier trims, add one `status: 'Trimmed'` entry per trim and one
  `status: 'Closed'` entry for the final sale only. Each entry has its own
  date, its `buys` is just the shares that entry sold (at the position's
  entry price), and its `sells` is that one fill. See the `VIAV` entries
  (Aug 28 trim, Oct 2 close) and the `BE` entries (Sept 9 trim, Sept 21
  close). **Sells on the same day are one entry; sells on different days are separate entries** (so AXTI's
  two Aug 14 sells are one `Trimmed` entry, and its Aug 17 sale is its own `Closed` entry). The four old
  bundled entries (`MU`, `AXTI`, `LITE`, the Aug 25 `MRVL`) were split this way on 2026-10-08, from the
  TradingView export.
- **The repo does not store trim sale prices** (positions only keep size and
  entry price). Before adding a closed entry, check the git history of that
  ticker's `POSITIONS` line in `api/quotes.js` for size drops with an
  unchanged entry price (`git log -G"'TICKER'" -- api/quotes.js`). Each drop
  is a trim. Ask Valerio for each trim's fill price and date from the
  TradingView order history instead of guessing. Skipping this once left the
  `BE` trim out of the record.
- If a ticker is being closed that was **also closed once before at a
  genuinely different time** (a full re-entry, not a continuous holding),
  add a SEPARATE entry, since a re-entry is its own holding. See the two
  `MRVL` entries (closed Aug 25, re-bought, closed again Sept 9). Both stay
  in the array as their own accurate historical record.
- "Recently Closed" on the page shows only the **3 most recent** by date
  (`MAX_SHOWN` in `renderClosedPositions`), sorted by recency not
  performance. This is deliberate — don't change it to show more or sort by
  gain% unless explicitly asked.

## Why the historical data setup looks the way it does

This is the part that caused the most real trouble, so read carefully before
touching any of it:

- `TRUE_ORIGIN_VALUE` (100003.31) is the **fixed** $100k starting value from
  Aug 1, computed from the *original* 8-position portfolio. It never changes,
  regardless of how many rebalances happen.
- `ENTRY_VALUE` (computed fresh from current `POSITIONS`) is a **different
  number** — today's holdings' cost basis, used only for weight% math. Never
  use it as a stand-in for the true origin.
- `DISPLAY_START_TIMESTAMP` cuts the visible chart to start Aug 12, 3:45pm
  ET. Everything before that had real data-quality problems from early
  logging bugs. The on-page disclaimer explains this to visitors — if you
  ever change this cutoff, update the disclaimer text too.
- `HISTORY_KEY = 'alpha-intelligence-history-v6'` is the current live-writing
  key.
- `RECOVERY_KEY = 'alpha-intelligence-history-v2'` holds 1,933 **real**
  historical data points (Aug 6–21) that were discovered by accident after
  several failed migration attempts. `v2` is frozen — nothing writes to it
  anymore — but it's read fresh and merged in-memory into every response
  (`mergeRecovered` in `api/quotes.js`). **Never try to bulk-copy this data
  into another key** — an earlier attempt at that risked a serverless
  timeout mid-write. The merge-at-read-time approach is deliberate and
  correct; don't "simplify" it back into a copy.
- There's a graveyard of abandoned keys (`v2` through `v5`) from that
  migration saga. `PORTFOLIO_HISTORICAL_CLOSES` is a hand-researched daily
  backfill array, kept as a fallback for whatever the `v2` recovery doesn't
  cover — mostly superseded now, but still load-bearing for the earliest
  dates.

## Notes (the little bubbles)

- Each rebalance gets short notes, shown as small outlined bubbles under the
  position: how much was added to or opened in it, or how much a close made,
  plus a one-line reason when Valerio gives one. One or two sentences at most,
  plain and non-promotional.
- **Open positions:** add the buy to `TRADE_LOG` in `script.js` (keyed by ticker: date, `Opened` or
  `Added`, shares, fill price, and a `comment` when there is a note). A comment shows as the bubble for
  `NOTE_DAYS` (14) after its date and then disappears by itself, but stays in the ticker's history for good.
  **Closed positions:** put a `note` on the entry in `CLOSED_POSITIONS`; it shows for as long as the entry is
  one of the 3 most recent.
- **Pop-out:** after the page has loaded in, the bubbles pop out one at a time (`popNotes` in `script.js`),
  each with its own delay and duration. Only the first batch animates: the 20 second refresh rebuilds the rows
  and those bubbles just appear in place.
- **Where a note shows:** on a wide screen (1100px and up) it comes out beside
  its row in the empty margin, alternating right, left, right down the page (the
  other side if the preferred one is blocked; `layoutSideNotes` in `script.js`); on anything narrower,
  or as a last resort when neither margin has room, it sits under its row.
- **Dates:** a note on an open position leads with a small date line (the day
  the change was made, e.g. "Oct 7"), so it is always clear when it happened. A
  closed position's row already shows its own date, so its note has none.
- **Verify every factual claim in a note before it goes in** (an earnings
  beat, the date of another company's report, an analyst estimate), the same as
  any other published text. Prefer a primary source (an SEC 8-K or a company
  release) and compute the trade numbers from the fills. If a claim can't be
  confirmed, leave it out and tell Valerio instead of publishing it.

## Ticker history (click a slice in the pie)

- Clicking a slice opens that ticker's history under the pie (click again, the x, or Escape closes it): every
  buy from `TRADE_LOG`, every sale from `CLOSED_POSITIONS` with its return and $ gain, the comments, and three
  live figures (Realized, Open, Net P&L). Nothing extra to maintain: it reads the same two arrays as the rest
  of the page. **So every rebalance should log each buy in `TRADE_LOG`**, with its date and fill price.
- `TRADE_LOG` holds every buy for the open tickers, including the buys behind trades since closed, so a
  sale never appears without its purchase. Its dates and prices are the **exact fills from the TradingView paper
  trading export of 2026-10-08** (68 filled orders, Aug 3 to Oct 7), cross-checked in both directions: every
  `TRADE_LOG` row exists in the export and every export buy for an open ticker is in the log, and every sale in
  `CLOSED_POSITIONS` matches an export fill. Two trades in that export are **deliberately not on the site**,
  CBOE:RAM and OMXSTO:SIVE (bought Aug 14, sold Aug 17): Valerio's portfolio tracker does not cover them, so
  they were never shown. Do not add them back. A private copy of that export is kept in Claude's memory folder
  (`tradingview-orders-2026-10-08.csv`), not in this repo, because the repo is publicly served.
  **Check after any edit:** replaying a ticker's `TRADE_LOG` buys and its `CLOSED_POSITIONS` sells in date order
  must end at that ticker's current size and entry price in `POSITIONS`, and no sale may come before the first
  buy. If a trim's sale price is ever missing, leave it out of the log and ask for the fill from TradingView
  rather than guessing, since a size drop with no sale on record would fail that replay.
- A trim of a position that is still open is also its own `Trimmed` entry in `CLOSED_POSITIONS` (as for NBIS Aug 15
  and CIEN Aug 28), so it counts in Realized and in the win rate.
- The open position's share count isn't in the API response, so the panel backs it out of the weight
  (`openPosition`). Open P&L is on the current blended entry price, Realized is the sum of that ticker's
  `CLOSED_POSITIONS` entries.

## Stars (easter egg)

- In **dark mode while the market is closed**, a faint field of stars sits across the top of the page
  (`#stars`, a 440px-tall canvas behind the content; code is the "Stars" block at the top of `script.js`).
  They are thickest at the left and right edges and thin toward the middle where the title and chart are, and
  they twinkle very gently. When the market opens (checked on the 20 second refresh, with the same
  `isMarketOpen()` as the status text, so no holiday calendar) they drift up and fade one by one over ~3s.
  Switching to light mode fades them quickly, and `prefers-reduced-motion` shows them still.
- **Shooting star:** while the stars are up, one faint streak crosses the top (under a second, alternating
  from the left and right thirds, never over the middle). The first comes **30 seconds after the stars appear**,
  then **one every 90 seconds** (`SHOOT_FIRST_MS`, `SHOOT_EVERY_MS` in `script.js`). The timer restarts if the
  stars leave and come back. None with reduced motion. It is meant to be a secret, so do not advertise it.
- The sky is the same every time (fixed seed) and only the star colour comes from the theme (`--ink`). Keep it
  faint: it is meant to be found, not noticed.

## Light / dark theme

- Every colour lives as a CSS variable in `style.css`: the light set on `:root`, the dark set on
  `:root[data-theme="dark"]`. **Never hard-code a colour** in CSS or in the canvas code. The line chart and the
  pie read the variables at draw time (`themeColors()` in `script.js`), so a new colour goes in the variable
  sets, as a 6-digit hex (`withAlpha` parses it).
- The theme is chosen before first paint by an inline script in `index.html`: the visitor's saved choice
  (`localStorage` key `ai-theme`, wrapped in try/catch) or else their system setting. The button in the top
  right switches and saves it. Until someone clicks it, the page follows the system setting live. Switching
  redraws the charts (`applyTheme`).
- The control is an outlined pill switch (knob left = light, right = dark, `role="switch"`). Dark is the cream
  turned down to a warm brown (`--paper #302C25`), deliberately not near-black. Switching eases colours over
  ~0.35s via a temporary `.theme-fade` class, and the canvases fade out and back in around their redraw.
- Keep dark mode monochrome like the light one: same outline style, no new accent colours.

## Track record (the five figures under Recently Closed)

- One quiet row: Win rate, Profit factor, Avg win, Avg loss, Avg hold. All come from **every** entry in
  `CLOSED_POSITIONS` (closes and trims alike, each one a realized trade), not just the 3 shown, and open
  positions are in none of them. Nothing to maintain except the data: a new closed or trimmed entry is counted
  automatically.
- Win rate: a win is a sale above the entry price. Profit factor: total $ won on winning entries divided by
  total $ lost on losing ones. Avg win / Avg loss: the plain mean of those entries' % returns.
- **Every `CLOSED_POSITIONS` entry needs an `opened` date** (the day the shares it sold were first bought, first
  in first out) for Avg hold, taken from the TradingView order history.
- Max drawdown was tried and dropped (Valerio's call), as was a separate "Track record" section.
- The figures are centered under their labels, and Avg hold reads "21 days". The `opened` dates are exact
  (first buy of the shares sold, first in first out) from the TradingView export of 2026-10-08.

## Benchmarks and alpha (SMH, QQQ)

- `BENCHMARKS` in `api/quotes.js` holds one fixed baseline price per ETF: the
  **Aug 3, 2026 open** (SMH 530.43, QQQ 688.30), not the Jul 31 close. The
  portfolio's first orders were limit orders at the Jul 31 close that filled
  right around Monday's open (the average fills for MU, NBIS, MRVL and LITE
  landed within ~0.8% of it), so that is where a fair comparison starts.
  Using the Jul 31 close would add Monday's gap to the benchmark (SMH opened
  1.9% lower) and flatter the alpha by ~2 points. The baselines never change.
- Live ETF prices come from Finnhub inside the same `/api/quotes` request, in
  their own try/catch: if a benchmark quote fails, that row is left out and
  the portfolio's own numbers are unaffected.
- **Alpha = the portfolio's return since the Aug 1 start minus the
  benchmark's, in percentage points.** The portfolio return is
  `currentValue` against `TRUE_ORIGIN_VALUE` (never `ENTRY_VALUE`). The page
  computes it from the rounded figures it shows so the table adds up. This is
  simple excess return, not a risk-adjusted alpha, so say so if it goes in
  the newsletter.
- To add a benchmark, add a row to `BENCHMARKS` with that ETF's Aug 3, 2026
  opening price.

## Page load-in (top-to-bottom fade-up)

- The page loads in with the same `fadeUp` animation as the main site
  (valerio-site.vercel.app): 0.7s, `ease`, rising 10px, each block 50ms after
  the one above. Every top-level block in `index.html` carries the `rise`
  class. **A new section needs `rise` too**, or it will pop in on its own.
- The title group (`rise rise-now`: back link, heading, subtitle) plays as soon
  as the web font is ready. Everything else waits for the first `/api/quotes`
  data to be on the page, then cascades in page order (`revealData` in
  `script.js`). If the data isn't there after 3 seconds it reveals anyway. It
  runs once; the 20 second refreshes never replay it.
- Blocks are only held back while the `js` class on `<html>` is set (inline
  script in `index.html`, which also removes it after 8 seconds as a safety
  net), so the page can't get stuck invisible. `prefers-reduced-motion` turns
  the animation off.

## Known gotchas (already debugged once — don't rediscover these)

- **Finnhub free tier caps at 60 calls/min.** This site uses ~12 calls
  per page load (one per position plus the two benchmark ETFs). Multiple
  tabs/windows open at once, plus the cron job's own
  pings, can trip the limit — which then serves a *frozen, identical* quote
  instead of an error. If prices ever look stuck, check `/api/debug-history`
  for a repeating value before assuming the code is broken.
- **A failed refresh must not change the page's height.** The page refreshes every 20 seconds, and a
  failure (usually Finnhub rate limiting) used to swap the headline for "Unable to load prices", which wraps
  to two lines on a phone and pushed the reader's scroll position down ~38px until the next good refresh.
  Now `init()` keeps the last good numbers once anything has loaded (`hasLoaded`) and shows the error only if
  the very first load fails. The benchmarks section likewise keeps its last rows if only the ETF quotes fail.
  Keep any new refresh-driven element the same: never hide, replace or resize content above the reader on an error.
- **Scroll anchoring is switched off** (`html { overflow-anchor: none }` in `style.css`). Browsers otherwise
  nudge the scroll position when anything above the reader changes height, and this page refreshes itself every
  20 seconds. Don't remove it. Tested: with anchoring on, a 38px change above moved scroll 900 to 938; off, it stays 900.
- **Finnhub 429s come in bursts** and make `/api/quotes` return a 500 (`Finnhub request failed for X: 429`).
  Heavy testing against the live API, or several open tabs, can trigger it. In a quiet period it answers normally.
  An open tab keeps running the old JS until it is reloaded, so after a deploy hard refresh before judging a fix.
- **`isMarketOpenNow()` gates ALL history logging** to real NYSE hours
  (9:30am–4pm ET, weekdays). This is deliberate — it prevents flat, stale
  overnight/weekend data from polluting the chart. Don't remove it.
- **`MAX_PLAUSIBLE_SWING` (8%)** rejects implausible point-to-point jumps,
  but only when the gap since the last point is under 5 minutes — a
  rebalance can legitimately cause a bigger jump than 8% and shouldn't get
  blocked by this.
- **Valerio is in Luxembourg (CET/CEST).** Frontend time labels use the
  *browser's local timezone*; backend market-hours logic uses
  `America/New_York` explicitly. If a chart's time window looks confusing,
  check which timezone is actually being displayed before assuming a bug —
  this caused a real false alarm once.

## Style, for anything user-facing

- Simple, accessible, conversational writing for Substack posts — no
  semicolons, nothing overly technical. This feeds a real newsletter.
- When a post references a real public figure or a specific factual claim
  (e.g. a congressional stock disclosure), **verify it via search first**.
  Don't take a user-provided claim about a third party at face value if it's
  going into published content.
- When reporting a rebalance for the newsletter, the established format is:
  a one-sentence reflective opener (timeframe + overall performance,
  honestly stated, not spun positive), 1–2 short paragraphs on what changed
  and why, then a plain-text table: `New positions` (0% → X%), `Closed
  positions` (X% → 0%), and the full current `Portfolio (N positions)`
  weight list. Keep it short — this user has repeatedly asked for shorter,
  not longer.

## Before making changes

- Read the actual current file contents first — don't assume state from
  memory of past conversations.
- Verify any math with real computation before presenting it.
- For anything touching the live position arrays or the closed-positions
  history, work in Manual permission mode by default — this is real
  (paper-traded but publicly reported) financial data, not a throwaway
  project.
