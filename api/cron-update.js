// Vercel serverless function: /api/cron-update
// Called by an external scheduler (cron-job.org) on a fixed schedule (e.g.
// every 5 minutes) to log a portfolio value point to the shared history —
// independent of whether anyone actually has the page open. Vercel's own
// Hobby-plan cron is capped at once/day, so this uses a free external
// pinger instead; this route is a normal HTTP endpoint either way.

const POSITIONS = [
  { ticker: 'MU',   quantity: 24.3,   entryPrice: 783.26 },
  { ticker: 'NBIS', quantity: 78.77,  entryPrice: 185.50 },
  { ticker: 'MRVL', quantity: 79.97,  entryPrice: 181.30 },
  { ticker: 'LITE', quantity: 15.4,   entryPrice: 687.06 },
  { ticker: 'IREN', quantity: 271.73, entryPrice: 36.60  },
  { ticker: 'AXTI', quantity: 165.48, entryPrice: 57.79  },
  { ticker: 'DRAM', quantity: 158,    entryPrice: 49.00  },
  { ticker: 'BRUN', quantity: 694.14, entryPrice: 20.21  },
];

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HISTORY_KEY = 'alpha-intelligence-history-v2';
const MAX_HISTORY_POINTS = 5000;
const MAX_PLAUSIBLE_SWING = 0.08; // same sanity guard as api/quotes.js

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

module.exports = async (req, res) => {
  // Optional shared-secret check — only enforced if CRON_SECRET is set, so
  // this works immediately without requiring extra setup, but can be locked
  // down by adding that env var and putting the same value in the scheduler's
  // URL as ?secret=...
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || !UPSTASH_URL || !UPSTASH_TOKEN) {
    res.status(500).json({ error: 'Missing required environment variables.' });
    return;
  }

  try {
    const prices = await Promise.all(
      POSITIONS.map(async (p) => {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${p.ticker}&token=${apiKey}`);
        if (!r.ok) throw new Error(`Finnhub failed for ${p.ticker}: ${r.status}`);
        const data = await r.json();
        return data && data.c ? data.c : p.entryPrice;
      })
    );

    const currentValue = POSITIONS.reduce((sum, p, i) => sum + p.quantity * prices[i], 0);

    const rawLast = await upstashGetPath(`/lrange/${encodeURIComponent(HISTORY_KEY)}/-1/-1`);
    const last = Array.isArray(rawLast) && rawLast.length > 0 ? JSON.parse(rawLast[0]) : null;
    const isPlausible = !last || Math.abs(currentValue - last.value) / last.value <= MAX_PLAUSIBLE_SWING;

    if (!isPlausible) {
      res.status(200).json({ ok: true, skipped: 'implausible swing, not logged' });
      return;
    }

    const point = { t: new Date().toISOString(), value: currentValue };
    await upstashPostPath(`/rpush/${encodeURIComponent(HISTORY_KEY)}`, JSON.stringify(point));
    await upstashGetPath(`/ltrim/${encodeURIComponent(HISTORY_KEY)}/-${MAX_HISTORY_POINTS}/-1`);

    res.status(200).json({ ok: true, point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
