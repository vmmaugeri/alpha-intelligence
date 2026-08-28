// Vercel serverless function: /api/cron-update
// Called by an external scheduler (cron-job.org) on a fixed schedule (e.g.
// every 5 minutes) to log a portfolio value point to the shared history —
// independent of whether anyone actually has the page open. Vercel's own
// Hobby-plan cron is capped at once/day, so this uses a free external
// pinger instead; this route is a normal HTTP endpoint either way.

const POSITIONS = [
  { ticker: 'INTC', quantity: 186.28, entryPrice: 101.59 },
  { ticker: 'BRUN', quantity: 894.14, entryPrice: 19.96  },
  { ticker: 'BE',   quantity: 77.23,  entryPrice: 213.90 },
  { ticker: 'NBIS', quantity: 79.87,  entryPrice: 188.37 },
  { ticker: 'MRVL', quantity: 70,     entryPrice: 222.50 },
  { ticker: 'CRWD', quantity: 60.71,  entryPrice: 215.07 },
  { ticker: 'CIEN', quantity: 24.42,  entryPrice: 429.61 },
  { ticker: 'VIAV', quantity: 157.6,  entryPrice: 43.02  },
  { ticker: 'SILC', quantity: 130.64, entryPrice: 49.81  },
];

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HISTORY_KEY = 'alpha-intelligence-history-v6';
const MAX_HISTORY_POINTS = 5000;
const MAX_PLAUSIBLE_SWING = 0.08;

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

async function logPoint(key, currentValue) {
  const rawLast = await upstashGetPath(`/lrange/${encodeURIComponent(key)}/-1/-1`);
  const last = Array.isArray(rawLast) && rawLast.length > 0 ? JSON.parse(rawLast[0]) : null;
  const isPlausible = !last || Math.abs(currentValue - last.value) / last.value <= MAX_PLAUSIBLE_SWING;

  if (!isPlausible) return false;

  const point = { t: new Date().toISOString(), value: currentValue };
  await upstashPostPath(`/rpush/${encodeURIComponent(key)}`, JSON.stringify(point));
  await upstashGetPath(`/ltrim/${encodeURIComponent(key)}/-${MAX_HISTORY_POINTS}/-1`);
  return true;
}

module.exports = async (req, res) => {
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

    if (!isMarketOpenNow()) {
      res.status(200).json({ ok: true, skipped: 'market closed, not logged' });
      return;
    }

    const logged = await logPoint(HISTORY_KEY, currentValue);

    res.status(200).json({ ok: true, logged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
