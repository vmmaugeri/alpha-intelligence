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

const ENTRY_VALUE = POSITIONS.reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HISTORY_KEY = 'alpha-intelligence-history-v5'; // bumped from v4 — v4 discarded v3's real accumulated intraday data entirely in favor of the hand-researched daily backfill alone. This key recovers that real data instead (see RECOVERY_KEY below and the recoveryKey logic in readAndUpdateHistory) rather than throwing it away a second time.
const RECOVERY_KEY = 'alpha-intelligence-history-v3'; // v3 was never deleted, just stopped being read — its real logged data (if any is still genuinely usable) gets recovered and merged with the backfill on first seed
const MAX_HISTORY_POINTS = 5000;
const MIN_INTERVAL_MS = 55 * 1000;
const MAX_PLAUSIBLE_SWING = 0.08;
const ORIGIN_TIMESTAMP = '2026-08-01T00:00:00Z';

const TRUE_ORIGIN_VALUE = 100003.31;

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

// --- S&P 500 benchmark (tracked via SPY, the ETF) ---
const SPY_ENTRY_PRICE = 747.03;
const SPY_HISTORY_KEY = 'alpha-intelligence-spy-v2';

const SPY_HISTORICAL_CLOSES = [
  { t: '2026-08-01T00:00:00Z', value: 747.03 },
  { t: '2026-08-03T20:00:00Z', value: 757.67 },
  { t: '2026-08-04T20:00:00Z', value: 771.33 },
  { t: '2026-08-05T20:00:00Z', value: 769.79 },
  { t: '2026-08-06T20:00:00Z', value: 768.56 },
  { t: '2026-08-07T20:00:00Z', value: 773.26 },
  { t: '2026-08-10T20:00:00Z', value: 773.03 },
  { t: '2026-08-11T20:00:00Z', value: 770.56 },
  { t: '2026-08-12T20:00:00Z', value: 772.49 },
  { t: '2026-08-13T20:00:00Z', value: 777.88 },
  { t: '2026-08-14T20:00:00Z', value: 776.34 },
  { t: '2026-08-17T20:00:00Z', value: 772.67 },
  { t: '2026-08-18T20:00:00Z', value: 767.45 },
  { t: '2026-08-19T20:00:00Z', value: 769.06 },
  { t: '2026-08-20T20:00:00Z', value: 762.60 },
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

// Same check as isMarketOpenNow, but for an arbitrary stored timestamp
// rather than right now — used to find real data worth recovering from an
// old history key.
function wasOffHours(isoString) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(isoString));
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  if (map.weekday === 'Sat' || map.weekday === 'Sun') return true;
  const minutesOfDay = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);
  return minutesOfDay < 9 * 60 + 30 || minutesOfDay >= 16 * 60;
}

// A point logged outside real market hours could only have come from the
// OLD code, before the market-hours-gating fix existed — the current code
// physically can't produce one. Scanning for the LAST such violation finds
// exactly where the old, contaminated logging stops and genuine live
// tracking begins; everything after that point is real and worth keeping.
function findGoodDataBoundary(history) {
  let lastBadIndex = -1;
  for (let i = 0; i < history.length; i++) {
    if (wasOffHours(history[i].t)) lastBadIndex = i;
  }
  return lastBadIndex + 1;
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

async function readAndUpdateHistory(key, entryValue, originTimestamp, currentValue, backfillPoints, recoveryKey) {
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
    let pointsToSeed =
      backfillPoints && backfillPoints.length > 0
        ? backfillPoints
        : [{ t: originTimestamp, value: entryValue }];

    // If an old key is given, check it for real live-logged data that's
    // still genuinely usable, rather than only ever falling back to the
    // hand-researched daily backfill — a previous migration discarded real
    // accumulated intraday data outright instead of recovering it, which
    // is exactly the mistake this avoids repeating.
    if (recoveryKey) {
      const oldHistory = await readRawHistory(recoveryKey);
      const boundaryIdx = findGoodDataBoundary(oldHistory);
      const recoveredGood = oldHistory.slice(boundaryIdx);
      if (recoveredGood.length > 0) {
        const recoveredStart = new Date(recoveredGood[0].t).getTime();
        pointsToSeed = pointsToSeed.filter((p) => new Date(p.t).getTime() < recoveredStart);
        pointsToSeed = [...pointsToSeed, ...recoveredGood];
      }
    }

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
        const currentPrice = data && data.c ? data.c : p.entryPrice;
        return { ...p, currentPrice, changePct: data ? data.dp : 0 };
      })
    );

    const currentValue = quotes.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const allTimeReturnPct = ((currentValue - ENTRY_VALUE) / ENTRY_VALUE) * 100;

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

    const history = await readAndUpdateHistory(HISTORY_KEY, TRUE_ORIGIN_VALUE, ORIGIN_TIMESTAMP, currentValue, PORTFOLIO_HISTORICAL_CLOSES, RECOVERY_KEY);
    const spyHistory = spyPrice != null
      ? await readAndUpdateHistory(SPY_HISTORY_KEY, SPY_ENTRY_PRICE, ORIGIN_TIMESTAMP, spyPrice, SPY_HISTORICAL_CLOSES)
      : [];

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
