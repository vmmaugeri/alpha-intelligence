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
   closed (not for a live position's size just changing).

**Before touching these files, verify the trade math with actual code
execution** (python/node), not by eyeballing it. Confirm sells roughly fund
buys, confirm gain% and $ figures. Valerio has been burned by silent
arithmetic mistakes before and expects the numbers to actually be checked,
not just look plausible.

## How to add a closed position correctly

- **Weight is computed from ENTRY price × quantity, not current price.** This
  is deliberate — it reflects sizing decisions, not day-to-day price noise.
- If a position is being fully closed *after* an earlier partial trim in the
  **same holding period**, merge both tranches into ONE entry (see `MU`,
  `AXTI`, `LITE` as examples): one `buys` array for the original full
  position, one `sells` array with each tranche as its own line, `status:
  'Closed'`, and the date of the *final* closing trade.
- If a ticker is being closed that was **also closed once before at a
  genuinely different time** (a full re-entry, not a continuous holding),
  add a SEPARATE entry instead of merging — see the two `MRVL` entries
  (closed Aug 25, re-bought, closed again Sept 9). Both stay in the array as
  their own accurate historical record.
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

## Known gotchas (already debugged once — don't rediscover these)

- **Finnhub free tier caps at 60 calls/min.** This site uses ~9 calls per
  page load. Multiple tabs/windows open at once, plus the cron job's own
  pings, can trip the limit — which then serves a *frozen, identical* quote
  instead of an error. If prices ever look stuck, check `/api/debug-history`
  for a repeating value before assuming the code is broken.
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
