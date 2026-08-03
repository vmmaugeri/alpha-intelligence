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
  { ticker: 'BRUN', name: 'Boost Run',             quantity: 548.9,  entryPrice: 20.00  },
];

// Fixed baseline: the $ value of the portfolio at entry (Fri Jul 31 2026 close),
// computed from actual average fill prices (not the original limit-order prices —
// those filled better than the limit, so true cost basis is ~$96,953, not $100k).
const ENTRY_VALUE = POSITIONS.reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);

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

    const positions = quotes
      .map((p) => ({
        ticker: p.ticker,
        name: p.name,
        weight: ((p.quantity * p.entryPrice) / ENTRY_VALUE) * 100,
        currentPrice: p.currentPrice,
        changePct: p.changePct,
      }))
      .sort((a, b) => b.weight - a.weight);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(200).json({
      currentValue,
      entryValue: ENTRY_VALUE,
      allTimeReturnPct,
      positions,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
