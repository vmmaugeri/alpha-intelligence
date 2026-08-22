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
const HISTORY_KEY = 'alpha-intelligence-history-v3'; // bumped from v2 — that key had real flat/stale runs baked in from before the market-hours and race-condition fixes; this key gets a correct real backfill instead (see below)
const MAX_HISTORY_POINTS = 5000;
const MIN_INTERVAL_MS = 55 * 1000;
const MAX_PLAUSIBLE_SWING = 0.08;
const ORIGIN_TIMESTAMP = '2026-08-01T00:00:00Z';

// The true portfolio value on day one, computed from the *original* 8-position
// holdings (before any rebalancing) — fixed independently of ENTRY_VALUE above,
// which reflects today's holdings and changes every time the portfolio rebalances.
const TRUE_ORIGIN_VALUE = 100003.31;

// Real daily portfolio totals for Aug 3–13 2026, computed from the original
// 8-position holdings' actual quantities and real historical closing prices
// (source: stockanalysis.com/Tiingo for MU/NBIS/MRVL/LITE/IREN/AXTI/DRAM,
// marketbeat.com for BRUN) — replaces the flat/stale stretch that was baked
// into the old history key from before the market-hours and race-condition
// fixes. Backfill deliberately stops at Aug 13: Aug 14 and Aug 15 were both
// rebalance days into different holdings entirely, and reconstructing that
// stretch accurately would need real historical data for seven more tickers
// across two overlapping windows — rather than approximate that, live
// tracking simply resumes from today, connecting Aug 13 directly to today's
// first real point instead of asserting invented values in between.
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
];

// --- S&P 500 benchmark (tracked via SPY, the ETF) ---
// $747.03 is SPY's real, confirmed close for Fri Jul 31 2026 (source:
// stockanalysis.com/Tiingo) — matches the entry date used for the
// portfolio's own origin. An earlier version of this file had a derived
// estimate ($754.30) that turned out to be off; this replaces it with the
// actual number.
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

    const history = await readAndUpdateHistory(HISTORY_KEY, TRUE_ORIGIN_VALUE, ORIGIN_TIMESTAMP, currentValue, PORTFOLIO_HISTORICAL_CLOSES);
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
