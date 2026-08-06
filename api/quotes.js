// Vercel serverless function: /api/quotes
// Fetches live prices for the portfolio's 8 positions from Finnhub,
// then computes current value, all-time return, and per-position weight.

const POSITIONS = [
  { ticker: 'MU',   name: 'Micron Technology',    quantity: 24.3,   entryPrice: 783.26 },
  { ticker: 'NBIS', name: 'Nebius Group',          quantity: 78.77,  entryPrice: 185.50 },
  { ticker: 'MRVL', name: 'Marvell Technology',    quantity: 79.97,  entryPrice: 181.30 },
  { ticker: 'LITE', name: 'Lumentum Holdings',     quantity: 15.4,   entryPrice: 687.06 },
  { ticker: 'IREN', name: 'IREN Limited',          quantity: 271.73, entryPrice: 36.60  },
  { ticker: 'AXTI', name: 'AXT Inc.',              quantity: 165.48, entryPrice: 57.79  },
  { ticker: 'DRAM', name: 'Roundhill Memory ETF',  quantity: 158,    entryPrice: 49.00  },
  { ticker: 'BRUN', name: 'Boost Run',             quantity: 694.14, entryPrice: 20.21  },
];

// Fixed baseline: the $ value of the portfolio at entry, computed from actual
// average fill prices. Originally ~$96,953 after the initial 8 buys; the
// remaining cash was then deployed into BRUN, bringing the total to ~$100k.
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

async function readAndUpdateHistory(currentValue) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return []; // not configured yet — chart just stays empty

  let history = [];
  try {
    const raw = await upstashGetPath(`/lrange/${encodeURIComponent(HISTORY_KEY)}/0/-1`);
    history = Array.isArray(raw) ? raw.map((s) => JSON.parse(s)) : [];
  } catch {
    history = [];
  }

  // One-time seed: if the shared history is still empty, anchor it with the
  // known, exact $100k entry point — we don't have a live feed reaching back
  // to day one, but this one number is certain, so the chart always shows a
  // true starting point rather than an arbitrary first live reading.
  if (history.length === 0) {
    const originPoint = { t: ORIGIN_TIMESTAMP, value: ENTRY_VALUE };
    await upstashPostPath(`/rpush/${encodeURIComponent(HISTORY_KEY)}`, JSON.stringify(originPoint));
    history.push(originPoint);
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

  if (dueForNewPoint && isPlausible) {
    const point = { t: new Date().toISOString(), value: currentValue };
    await upstashPostPath(`/rpush/${encodeURIComponent(HISTORY_KEY)}`, JSON.stringify(point));
    await upstashGetPath(`/ltrim/${encodeURIComponent(HISTORY_KEY)}/-${MAX_HISTORY_POINTS}/-1`);
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

    const history = await readAndUpdateHistory(currentValue);

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

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(200).json({
      currentValue,
      entryValue: ENTRY_VALUE,
      allTimeReturnPct,
      positions,
      history,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
