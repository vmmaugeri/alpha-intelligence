const POSITIONS = [
  { ticker: 'SILC', quantity: 125.64, entryPrice: 49.99  },
  { ticker: 'BRUN', quantity: 694.14, entryPrice: 20.21  },
  { ticker: 'INTC', quantity: 176.28, entryPrice: 102.16 },
  { ticker: 'AMZN', quantity: 68.35,  entryPrice: 263.37 },
  { ticker: 'NBIS', quantity: 70.87,  entryPrice: 185.50 },
  { ticker: 'VIAV', quantity: 260.6,  entryPrice: 43.02  },
  { ticker: 'CIEN', quantity: 40.42,  entryPrice: 429.61 },
  { ticker: 'MRVL', quantity: 55.52,  entryPrice: 181.30 },
  { ticker: 'LITE', quantity: 11.19,  entryPrice: 687.06 },
];

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HISTORY_KEY = 'alpha-intelligence-history-v2';
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

    const rawLast = await upstashGetPath(`/lrange/${encodeURIComponent(HISTORY_KEY)}/-1/-1`);
    const last = Array.isArray(rawLast) && rawLast.length > 0 ? JSON.parse(rawLast[0]) : null;
    const isPlausible = !last || Math.abs(currentValue - last.value) / last.value <= MAX_PLAUSIBLE_SWING;

    if (!isMarketOpenNow()) {
      res.status(200).json({ ok: true, skipped: 'market closed, not logged' });
      return;
    }

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
