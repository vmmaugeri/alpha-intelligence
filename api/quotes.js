// Vercel serverless function: /api/quotes
// Fetches live prices for the portfolio's positions from Finnhub,
// then computes current value, all-time return, and per-position weight.

const POSITIONS = [
  { ticker: 'INTC', name: 'Intel Corporation',      quantity: 186.28, entryPrice: 101.59 },
  { ticker: 'NBIS', name: 'Nebius Group',           quantity: 82.44,  entryPrice: 208.63 },
  { ticker: 'AAOI', name: 'Applied Optoelectronics', quantity: 136.64, entryPrice: 111.21 },
  { ticker: 'MU',   name: 'Micron Technology',      quantity: 23.63,  entryPrice: 1018.46 },
  { ticker: 'CIEN', name: 'Ciena Corporation',      quantity: 24.42,  entryPrice: 429.61 },
  { ticker: 'SNDK', name: 'SanDisk Corporation',    quantity: 8.73,   entryPrice: 1758.48 },
  { ticker: 'META', name: 'Meta Platforms',         quantity: 12.06,  entryPrice: 708.13 },
  { ticker: 'MRVL', name: 'Marvell Technology',     quantity: 27.34,  entryPrice: 272.42 },
  { ticker: 'LITE', name: 'Lumentum Holdings',      quantity: 7.16,   entryPrice: 1117.08 },
];

const ENTRY_VALUE = POSITIONS.reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const HISTORY_KEY = 'alpha-intelligence-history-v6';
const RECOVERY_KEY = 'alpha-intelligence-history-v2';
const MAX_HISTORY_POINTS = 5000;
const MIN_INTERVAL_MS = 55 * 1000;
const MAX_PLAUSIBLE_SWING = 0.08;
const ORIGIN_TIMESTAMP = '2026-08-01T00:00:00Z';

const DISPLAY_START_TIMESTAMP = '2026-08-12T19:45:00Z'; // Aug 12, 3:45pm ET

const TRUE_ORIGIN_VALUE = 100003.31;

// Benchmarks the portfolio is compared against. Each baseline is the Aug 3, 2026 OPEN, not the Jul 31
// close: the portfolio's first orders filled right around Monday's open (the average fills for
// MU/NBIS/MRVL/LITE landed within ~0.8% of it), so that is where a fair comparison has to start.
// Starting from the Jul 31 close would add Monday's gap to the benchmark's return (SMH opened 1.9%
// lower) and flatter the alpha. Fixed forever, like TRUE_ORIGIN_VALUE.
const BENCHMARKS = [
  { symbol: 'SMH', name: 'Semiconductors', baseline: 530.43 },
  { symbol: 'QQQ', name: 'Nasdaq-100',     baseline: 688.30 },
];

const PORTFOLIO_HISTORICAL_CLOSES = [
  { t: '2026-08-01T00:00:00Z', value: 100003.31 },
  { t: '2026-08-03T20:00:00Z', value: 109333.05 },
  { t: '2026-08-04T20:00:00Z', value: 116158.31 },
  { t: '2026-08-05T20:00:00Z', value: 112848.92 },
  { t: '2026-08-06T20:00:00Z', value: 108925.21 },
  { t: '2026-08-07T20:00:00Z', value: 113820.80 },
  { t: '2026-08-10T20:00:00Z', value: 107356.39 },
  { t: '2026-08-11T20:00:00Z', value: 109910.23 },
  { t: '2026-08-12T20:00:00Z', value: 123180.61 },
  { t: '2026-08-13T20:00:00Z', value: 124123.28 },
  { t: '2026-08-14T20:00:00Z', value: 127729.55 },
  { t: '2026-08-17T20:00:00Z', value: 130879.45 },
  { t: '2026-08-18T20:00:00Z', value: 121062.93 },
  { t: '2026-08-19T20:00:00Z', value: 117682.47 },
  { t: '2026-08-20T20:00:00Z', value: 117974.20 },
  { t: '2026-08-21T20:00:00Z', value: 117175.20 },
];

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

async function readRawHistory(key) {
  try {
    const raw = await upstashGetPath(`/lrange/${encodeURIComponent(key)}/0/-1`);
    return Array.isArray(raw) ? raw.map((s) => JSON.parse(s)) : [];
  } catch {
    return [];
  }
}

async function readAndUpdateHistory(key, entryValue, originTimestamp, currentValue, backfillPoints) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return [];

  let history = [];
  try {
    const raw = await upstashGetPath(`/lrange/${encodeURIComponent(key)}/0/-1`);
    history = Array.isArray(raw) ? raw.map((s) => JSON.parse(s)) : [];
  } catch {
    history = [];
  }

  const originTime = new Date(originTimestamp).getTime();
  const hasOrigin = history.length > 0 && new Date(history[0].t).getTime() <= originTime;
  if (!hasOrigin) {
    const pointsToSeed =
      backfillPoints && backfillPoints.length > 0
        ? backfillPoints
        : [{ t: originTimestamp, value: entryValue }];
    for (let i = pointsToSeed.length - 1; i >= 0; i--) {
      await upstashPostPath(`/lpush/${encodeURIComponent(key)}`, JSON.stringify(pointsToSeed[i]));
    }
    history = [...pointsToSeed, ...history];
  }

  const last = history[history.length - 1];
  const now = Date.now();
  const msSinceLast = last ? now - new Date(last.t).getTime() : Infinity;
  const dueForNewPoint = !last || msSinceLast >= MIN_INTERVAL_MS;

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

function mergeRecovered(liveHistory, recovered) {
  if (!recovered || recovered.length === 0) return liveHistory;
  const recoveredStart = new Date(recovered[0].t).getTime();
  const recoveredEnd = new Date(recovered[recovered.length - 1].t).getTime();
  const before = liveHistory.filter((p) => new Date(p.t).getTime() < recoveredStart);
  const after = liveHistory.filter((p) => new Date(p.t).getTime() > recoveredEnd);
  return [...before, ...recovered, ...after];
}

// Live benchmark returns since the baseline. Never throws: if a quote fails or comes back empty, that
// benchmark is left out, so a problem here can't take the portfolio's own numbers down with it.
async function fetchBenchmarks(apiKey) {
  try {
    const rows = await Promise.all(
      BENCHMARKS.map(async (b) => {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${b.symbol}&token=${apiKey}`);
        if (!r.ok) return null;
        const data = await r.json();
        if (!data || !data.c) return null;
        return {
          symbol: b.symbol,
          name: b.name,
          baseline: b.baseline,
          currentPrice: data.c,
          returnPct: ((data.c - b.baseline) / b.baseline) * 100,
        };
      })
    );
    return rows.filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = async (req, res) => {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'FINNHUB_API_KEY is not set on the server.' });
    return;
  }

  try {
    const benchmarksPromise = fetchBenchmarks(apiKey);

    const quotes = await Promise.all(
      POSITIONS.map(async (p) => {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${p.ticker}&token=${apiKey}`
        );
        if (!r.ok) {
          throw new Error(`Finnhub request failed for ${p.ticker}: ${r.status}`);
        }
        const data = await r.json();
        const currentPrice = data && data.c ? data.c : p.entryPrice;
        return { ...p, currentPrice, changePct: data ? data.dp : 0 };
      })
    );

    const currentValue = quotes.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const allTimeReturnPct = ((currentValue - ENTRY_VALUE) / ENTRY_VALUE) * 100;

    let history = await readAndUpdateHistory(HISTORY_KEY, TRUE_ORIGIN_VALUE, ORIGIN_TIMESTAMP, currentValue, PORTFOLIO_HISTORICAL_CLOSES);
    const recovered = await readRawHistory(RECOVERY_KEY);
    history = mergeRecovered(history, recovered);

    const displayStartTime = new Date(DISPLAY_START_TIMESTAMP).getTime();
    history = history.filter((p) => new Date(p.t).getTime() >= displayStartTime);

    const positions = quotes
      .map((p) => ({
        ticker: p.ticker,
        name: p.name,
        weight: ((p.quantity * p.entryPrice) / ENTRY_VALUE) * 100,
        currentPrice: p.currentPrice,
        entryPrice: p.entryPrice,
        dayChangePct: p.changePct,
        returnPct: ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100,
      }))
      .sort((a, b) => b.weight - a.weight);

    const benchmarks = await benchmarksPromise;

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(200).json({
      currentValue,
      entryValue: ENTRY_VALUE,
      trueOriginValue: TRUE_ORIGIN_VALUE,
      allTimeReturnPct,
      positions,
      benchmarks,
      history,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
