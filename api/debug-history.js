// Vercel serverless function: /api/debug-history
// READ-ONLY diagnostic — reports exactly what's actually stored in each of
// the portfolio's old history keys, without changing anything. Visit this
// URL directly in a browser to see the raw truth: how many points each key
// has, its first and last timestamp, and how many of those points actually
// have DIFFERENT values from the one before them (a flat run of repeated
// values isn't real intraday data — real 5-min ticks should show constant
// small variation).

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashGetPath(path) {
  const r = await fetch(`${UPSTASH_URL}${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.result;
}

async function readRaw(key) {
  try {
    const raw = await upstashGetPath(`/lrange/${encodeURIComponent(key)}/0/-1`);
    return Array.isArray(raw) ? raw.map((s) => JSON.parse(s)) : [];
  } catch {
    return [];
  }
}

function summarize(history) {
  if (history.length === 0) return { count: 0, note: 'empty or missing' };

  let distinctValueCount = 1;
  let smallestGapMs = Infinity;
  for (let i = 1; i < history.length; i++) {
    if (history[i].value !== history[i - 1].value) distinctValueCount++;
    const gap = new Date(history[i].t).getTime() - new Date(history[i - 1].t).getTime();
    if (gap > 0 && gap < smallestGapMs) smallestGapMs = gap;
  }

  return {
    count: history.length,
    first: history[0],
    last: history[history.length - 1],
    distinctValueCount,
    smallestGapMinutes: smallestGapMs === Infinity ? null : Math.round(smallestGapMs / 60000),
    firstFewPoints: history.slice(0, 5),
    lastFewPoints: history.slice(-5),
  };
}

module.exports = async (req, res) => {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    res.status(500).json({ error: 'Missing Upstash env vars' });
    return;
  }

  const keys = [
    'alpha-intelligence-history-v2',
    'alpha-intelligence-history-v3',
    'alpha-intelligence-history-v4',
    'alpha-intelligence-history-v5',
    'alpha-intelligence-history-v6',
  ];

  const results = {};
  for (const key of keys) {
    const history = await readRaw(key);
    results[key] = summarize(history);
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(results);
};
