// Vercel serverless function: /api/quotes
// Fetches live prices for the portfolio's positions from Finnhub,
// then computes current value, all-time return, and per-position weight.

const POSITIONS = [
  { ticker: 'SILC', name: 'Silicom Ltd',           quantity: 125.64, entryPrice: 49.99  },
  { ticker: 'BRUN', name: 'Boost Run',             quantity: 694.14, entryPrice: 20.21  },
  { ticker: 'INTC', name: 'Intel Corporation',     quantity: 176.28, entryPrice: 102.16 },
  { ticker: 'AMZN', name: 'Amazon.com',            quantity: 68.35,  entryPrice: 263.37 },
  { ticker: 'NBIS', name: 'Nebius Group',          quantity: 70.87,  entryPrice: 185.50 },
  { ticker: 'VIAV', name: 'Viavi Solutions',       quantity: 260.6,  entryPrice: 43.02  },
  { ticker: 'CIEN', name: 'Ciena Corporation',     quantity: 40.42,  entryPrice: 429.61 },
  { ticker: 'MRVL', name: 'Marvell Technology',    quantity: 55.52,  entryPrice: 181.30 },
  { ticker: 'LITE', name: 'Lumentum Holdings',     quantity: 11.19,  entryPrice: 687.06 },
];

// Current cost basis across today's holdings — used for per-position weight%
// only. NOT used as the chart's baseline/reference anymore (see script.js) —
// a rebalance mixes old and new entry dates, so this number stops meaning
// "day one" the moment holdings change. The true Aug 1 $100k origin lives
// permanently as history[0] in Upstash instead, untouched by rebalancing.
const ENTRY_VALUE = POSITIONS.reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);

// --- Shared history, stored in Upstash Redis (not per-visitor localStorage) ---
// This is what makes the chart identical for every visitor: everyone reads and
// appends to the same record instead of each browser keeping its own copy.
//
// Stored as a Redis LIST (via RPUSH) rather than a single JSON blob (via GET/SET).
// A GET-modify-SET cycle isn't safe when more than one request can happen close
// together — two requests can both read the same starting point and then one
// silently overwrites the other's save. RPUSH is atomic: concurrent pushes can
// never stomp on each other, no matter how many happen at once.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HISTORY_KEY = 'alpha-intelligence-history-v2';
const MAX_HISTORY_POINTS = 5000;
const MIN_INTERVAL_MS = 55 * 1000; // don't log a new point more than ~once/min, even under heavy traffic
const MAX_PLAUSIBLE_SWING = 0.08; // reject a point implying an >8% move in under a minute — almost certainly bad data, not a real swing
const ORIGIN_TIMESTAMP = '2026-08-01T00:00:00Z'; // matches the page's stated start date

// --- S&P 500 benchmark (tracked via SPY, the ETF) ---
// $754.30 is SPY's derived close for Fri Jul 31 2026: SPY's actual Jul 30
// close ($741.69) carried forward by the S&P 500 index's own +1.7% move on
// Jul 31 — not a guess, just the same day's index return applied to SPY's
// last confirmed price, since SPY tracks the index closely.
const SPY_ENTRY_PRICE = 754.30;
const SPY_HISTORY_KEY = 'alpha-intelligence-spy-v1';

// Checks real NYSE hours in America/New_York — used to skip logging new
// history points while the market's closed. Finnhub just echoes the last
// close price overnight/weekends, so without this the chart fills up with
// long runs of identical flat points instead of jumping cleanly from one
// session's close to the next session's open.
function isMarketOpenNow() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  if (map.weekday === 'Sat' || map.weekday === 'Sun') return false;
  const minutesNow = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);
  return minutesNow >= 9 * 60 + 30 && minutesNow < 16 * 60;
}

async function upstashGetPath(path) {
  const r = await fetch(`${UPSTASH_URL}${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.result;
}

async function upstashPostPath(path, body) {
  const r = await fetch(`${UPSTASH_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body,
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.result;
}

async function readAndUpdateHistory(key, entryValue, originTimestamp, currentValue) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return []; // not configured yet — chart just stays empty

  let history = [];
  try {
    const raw = await upstashGetPath(`/lrange/${encodeURIComponent(key)}/0/-1`);
    history = Array.isArray(raw) ? raw.map((s) => JSON.parse(s)) : [];
  } catch {
    history = [];
  }

  // Seed the origin point if it's missing — checks whether the *first*
  // recorded point is already at-or-before the entry date, rather than just
  // checking for an empty list, since a key created after the portfolio
  // started can already have later data in it without ever having the true
  // starting anchor. Inserted at the front (LPUSH) so it doesn't disturb
  // whatever's already been recorded.
  const originTime = new Date(originTimestamp).getTime();
  const hasOrigin = history.length > 0 && new Date(history[0].t).getTime() <= originTime;
  if (!hasOrigin) {
    const originPoint = { t: originTimestamp, value: entryValue };
    await upstashPostPath(`/lpush/${encodeURIComponent(key)}`, JSON.stringify(originPoint));
    history.unshift(originPoint);
  }

  const last = history[history.length - 1];
  const now = Date.now();
  const msSinceLast = last ? now - new Date(last.t).getTime() : Infinity;
  const dueForNewPoint = !last || msSinceLast >= MIN_INTERVAL_MS;

  // Only apply the swing-sanity check against a *recent* point (last few
  // minutes) — a bigger gap since the last point (like right after the
  // seeded Aug 1 origin, or after the page hasn't been checked in a while)
  // can easily span real market movement, not just bad data.
  const RECENT_WINDOW_MS = 5 * 60 * 1000;
  const isPlausible =
    !last ||
    msSinceLast > RECENT_WINDOW_MS ||
    Math.abs(currentValue - last.value) / last.value <= MAX_PLAUSIBLE_SWING;

  if (dueForNewPoint && isPlausible && isMarketOpenNow()) {
    const point = { t: new Date().toISOString(), value: currentValue };
    await upstashPostPath(`/rpush/${encodeURIComponent(key)}`, JSON.stringify(point));
    await upstashGetPath(`/ltrim/${encodeURIComponent(key)}/-${MAX_HISTORY_POINTS}/-1`);
    history.push(point);
  }

  return history;
}

module.exports = async (req, res) => {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'FINNHUB_API_KEY is not set on the server.' });
    return;
  }

  try {
    const quotes = await Promise.all(
      POSITIONS.map(async (p) => {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${p.ticker}&token=${apiKey}`
        );
        if (!r.ok) {
          throw new Error(`Finnhub request failed for ${p.ticker}: ${r.status}`);
        }
        const data = await r.json();
        // Finnhub returns c=0 for unknown symbols rather than an error — guard against that.
        const currentPrice = data && data.c ? data.c : p.entryPrice;
        return { ...p, currentPrice, changePct: data ? data.dp : 0 };
      })
    );

    const currentValue = quotes.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const allTimeReturnPct = ((currentValue - ENTRY_VALUE) / ENTRY_VALUE) * 100;

    // SPY fetch is best-effort — if it fails, the benchmark line just won't
    // show rather than breaking the whole page (the portfolio itself never
    // depends on this succeeding).
    let spyPrice = null;
    try {
      const spyRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${apiKey}`);
      if (spyRes.ok) {
        const spyData = await spyRes.json();
        spyPrice = spyData && spyData.c ? spyData.c : null;
      }
    } catch {
      spyPrice = null;
    }

    const history = await readAndUpdateHistory(HISTORY_KEY, ENTRY_VALUE, ORIGIN_TIMESTAMP, currentValue);
    const spyHistory = spyPrice != null
      ? await readAndUpdateHistory(SPY_HISTORY_KEY, SPY_ENTRY_PRICE, ORIGIN_TIMESTAMP, spyPrice)
      : [];

    const positions = quotes
      .map((p) => ({
        ticker: p.ticker,
        name: p.name,
        weight: ((p.quantity * p.entryPrice) / ENTRY_VALUE) * 100,
        currentPrice: p.currentPrice,
        entryPrice: p.entryPrice,
        dayChangePct: p.changePct, // Finnhub's intraday change (prev close -> now)
        returnPct: ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100, // since your entry
      }))
      .sort((a, b) => b.weight - a.weight);

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(200).json({
      currentValue,
      entryValue: ENTRY_VALUE,
      allTimeReturnPct,
      positions,
      history,
      spyHistory,
      spyEntryPrice: SPY_ENTRY_PRICE,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
