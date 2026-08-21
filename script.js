function formatCurrency(n) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatCompact(n) {
  return '$' + (n / 1000).toFixed(1) + 'k';
}

function formatAxisLabel(isoString) {
  const d = new Date(isoString);
  if (selectedRange === '24H') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTooltipLabel(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// --- Market status (real NYSE hours, via America/New_York time) ---
function getNYParts() {
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
  return { weekday: map.weekday, hour: parseInt(map.hour, 10), minute: parseInt(map.minute, 10) };
}

function isMarketOpen() {
  const { weekday, hour, minute } = getNYParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutesNow = hour * 60 + minute;
  return minutesNow >= 9 * 60 + 30 && minutesNow < 16 * 60;
}

function updateMarketStatus() {
  const text = document.getElementById('marketStatusText');
  const dot = document.getElementById('statusDot');
  if (!text) return;
  const open = isMarketOpen();
  text.textContent = open ? 'NYSE open' : 'NYSE closed';
  if (dot) dot.classList.toggle('open', open);
}

let chartState = null;
let lastEntryValue = null;
let lastHistory = [];
let lastCurrentValue = null;
let lastSpyHistory = [];
let lastSpyEntryPrice = null;
let selectedRange = '1W';

// Finds the SPY history point closest in time to a given timestamp — used to
// line the benchmark line up with the portfolio line's own x-positions
// rather than plotting two series with independently-drifting point counts.
function nearestValue(history, targetTime) {
  if (!history || history.length === 0) return null;
  let best = history[0];
  let bestDiff = Math.abs(new Date(best.t).getTime() - targetTime);
  for (const h of history) {
    const diff = Math.abs(new Date(h.t).getTime() - targetTime);
    if (diff < bestDiff) {
      best = h;
      bestDiff = diff;
    }
  }
  return best.value;
}

const RANGE_MS = {
  '24H': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

const RANGE_LABELS = {
  '24H': 'past 24h',
  '1W': 'past week',
  '1M': 'past month',
  All: 'all time',
};

function filterHistoryByRange(history, range) {
  if (range === 'All') return history;
  const windowMs = RANGE_MS[range] || RANGE_MS['1W'];
  const cutoff = Date.now() - windowMs;
  const filtered = history.filter((h) => new Date(h.t).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : history.slice(-1);
}

function computeRangeReturnPct(filteredHistory, currentValue) {
  if (!filteredHistory || filteredHistory.length === 0 || currentValue == null) return null;
  const startValue = filteredHistory[0].value;
  if (!startValue) return null;
  return ((currentValue - startValue) / startValue) * 100;
}

function updateRangeStat() {
  const changeEl = document.getElementById('allTimeChange');
  if (!changeEl) return;
  const filtered = filterHistoryByRange(lastHistory, selectedRange);
  const pct = computeRangeReturnPct(filtered, lastCurrentValue);
  if (pct == null) return;
  const sign = pct >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${pct.toFixed(2)}% ${RANGE_LABELS[selectedRange] || ''}`;
  changeEl.classList.toggle('negative', pct < 0);
}

function renderChart(hoverIndex) {
  const filtered = filterHistoryByRange(lastHistory, selectedRange);
  drawChart(filtered, lastEntryValue, hoverIndex, lastSpyHistory, lastSpyEntryPrice);
  updateRangeStat();
  updateLegend();
}

// Keeps the "S&P 500" legend item in sync with whether the benchmark line
// is actually being drawn (see MIN_SPY_POINTS in drawChart) — otherwise the
// legend would reference a line that isn't there yet.
function updateLegend() {
  const legend = document.getElementById('chartLegend');
  if (!legend) return;
  const items = legend.querySelectorAll('.legend-item');
  const benchmarkItem = items[1];
  if (benchmarkItem) {
    benchmarkItem.style.display = lastSpyHistory && lastSpyHistory.length >= 4 ? '' : 'none';
  }
}

// Picks clean, round gridline values (e.g. 100k / 105k / 110k) rather than
// arbitrary fractions of the data range — standard "nice ticks" approach.
function niceTicks(min, max, targetCount) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const roughStep = (max - min) / (targetCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;
  let step;
  if (residual >= 5) step = 10 * magnitude;
  else if (residual >= 2) step = 5 * magnitude;
  else if (residual >= 1) step = 2 * magnitude;
  else step = magnitude;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
    ticks.push(v);
  }
  return ticks;
}

function drawChart(history, entryValue, hoverIndex, spyHistory, spyEntryPrice) {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (history.length === 0) return;

  const padLeft = 52;
  const padRight = 8;
  const padTop = 14;
  const padBottom = 22;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = history.map((h) => h.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  // Color reflects whether the *currently visible window* is up or down —
  // same basis as the % shown next to the range buttons — not the all-time
  // status, so the chart always matches whatever number it's sitting next to.
  const rangeIsPositive = history[history.length - 1].value >= history[0].value;
  const lineColor = rangeIsPositive ? '#6E8259' : '#A14A3F';
  const fillColorTop = rangeIsPositive ? 'rgba(110, 130, 89, 0.22)' : 'rgba(161, 74, 63, 0.18)';
  const fillColorBottom = rangeIsPositive ? 'rgba(110, 130, 89, 0)' : 'rgba(161, 74, 63, 0)';

  // Benchmark: "if this same starting capital had gone into SPY instead" —
  // computed in dollar terms so it plots on the exact same axis as the
  // portfolio line, using the nearest SPY reading to each portfolio
  // timestamp so both lines share identical x-positions. Requires a handful
  // of real readings first — with only the origin point logged so far (SPY
  // tracking is new), every timestamp would resolve to that same single
  // point and draw as a flat, misleading line. Better to not show it yet
  // than show something that looks broken.
  const MIN_SPY_POINTS = 4;
  let benchmarkValues = null;
  if (spyHistory && spyHistory.length >= MIN_SPY_POINTS && spyEntryPrice && entryValue != null) {
    benchmarkValues = history.map((h) => {
      const spyPrice = nearestValue(spyHistory, new Date(h.t).getTime());
      return spyPrice != null ? entryValue * (spyPrice / spyEntryPrice) : null;
    });
  }

  // Scale to the real data. The Aug 1 origin line only ever applies to the
  // "All" view — folding a 2+ week old reference point into a 24H/1W/1M
  // window defeats the point of zooming in, regardless of how close that
  // point happens to be to the current value. Real data is always shown in
  // full either way; only the optional origin line is view-dependent. The
  // benchmark line is included in the scale on every view, since comparing
  // against it is useful at any zoom level.
  const forceOrigin = selectedRange === 'All';
  let rawMin = dataMin;
  let rawMax = dataMax;
  let showOriginLine = false;

  if (entryValue != null && forceOrigin) {
    rawMin = Math.min(rawMin, entryValue);
    rawMax = Math.max(rawMax, entryValue);
    showOriginLine = true;
  }

  if (benchmarkValues) {
    benchmarkValues.forEach((v) => {
      if (v == null) return;
      rawMin = Math.min(rawMin, v);
      rawMax = Math.max(rawMax, v);
    });
  }

  const ticks = niceTicks(rawMin, rawMax, 4);
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const range = max - min || 1;

  const xFor = (i) =>
    history.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (history.length - 1)) * plotW;
  const yFor = (v) => padTop + plotH - ((v - min) / range) * plotH;

  const points = history.map((h, i) => [xFor(i), yFor(h.value)]);
  const benchmarkPoints = benchmarkValues
    ? benchmarkValues.map((v, i) => (v != null ? [xFor(i), yFor(v)] : null))
    : null;

  // Gridlines at round values, with compact $ labels
  ctx.font = '10px Raleway, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ticks.forEach((v) => {
    const y = yFor(v);
    ctx.strokeStyle = '#E6E1D4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillStyle = '#8F8A7C';
    ctx.fillText(formatCompact(v), padLeft - 8, y);
  });

  // Dashed baseline at the entry value — only when it fits the visible range
  if (entryValue != null && showOriginLine) {
    const by = yFor(entryValue);
    ctx.strokeStyle = '#C9C1AE';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, by);
    ctx.lineTo(width - padRight, by);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Benchmark line (S&P 500) — thin, muted, no fill, drawn under the
  // portfolio line so the portfolio stays the visually dominant series.
  if (benchmarkPoints) {
    ctx.strokeStyle = '#8A97A8';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    benchmarkPoints.forEach((p) => {
      if (!p) return;
      if (!started) {
        ctx.moveTo(p[0], p[1]);
        started = true;
      } else {
        ctx.lineTo(p[0], p[1]);
      }
    });
    if (started) ctx.stroke();
  }

  // Soft fill under the line
  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  gradient.addColorStop(0, fillColorTop);
  gradient.addColorStop(1, fillColorBottom);
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(points[points.length - 1][0], padTop + plotH);
  ctx.lineTo(points[0][0], padTop + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Performance line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Hover guide line
  if (hoverIndex != null && points[hoverIndex]) {
    const [hx] = points[hoverIndex];
    ctx.strokeStyle = 'rgba(51, 50, 46, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();
  }

  // A dot at the current value, plus one at whatever's being hovered
  points.forEach(([x, y], i) => {
    const isLast = i === points.length - 1;
    const isHover = i === hoverIndex;
    if (!isLast && !isHover) return;
    ctx.beginPath();
    ctx.arc(x, y, isHover ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
  });

  // Date labels (first / last point)
  ctx.fillStyle = '#8F8A7C';
  ctx.font = '10px Raleway, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(formatAxisLabel(history[0].t), padLeft, height - 4);
  if (history.length > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(formatAxisLabel(history[history.length - 1].t), width - padRight, height - 4);
  }

  chartState = { history, points };
}

function attachChartInteractivity() {
  const canvas = document.getElementById('chart');
  const tooltip = document.getElementById('chartTooltip');
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', (e) => {
    if (!chartState || chartState.points.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let nearest = 0;
    let bestDist = Infinity;
    chartState.points.forEach(([x], i) => {
      const d = Math.abs(x - mx);
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    });
    const point = chartState.history[nearest];
    drawChart(chartState.history, lastEntryValue, nearest, lastSpyHistory, lastSpyEntryPrice);
    tooltip.textContent = `${formatTooltipLabel(point.t)} \u2014 ${formatCurrency(point.value)}`;
    tooltip.style.left = chartState.points[nearest][0] + 'px';
    tooltip.style.top = chartState.points[nearest][1] + 'px';
    tooltip.style.opacity = '1';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
    if (chartState) drawChart(chartState.history, lastEntryValue, null, lastSpyHistory, lastSpyEntryPrice);
  });
}

// --- Closed & trimmed positions ---
// Static historical record (no live prices needed — these are settled).
// Each entry's "buys" represents only the cost basis of shares that were
// actually sold (not the full original holding, for positions that are
// merely trimmed and still partly held) — this keeps the math scoped to
// exactly the sold portion. Gain % and $ are computed from these raw
// tranches rather than typed in, so the numbers are directly checkable.
const CLOSED_POSITIONS = [
  {
    ticker: 'IREN',
    status: 'Closed',
    buys: [{ qty: 271.73, price: 36.60 }],
    sells: [{ qty: 271.73, price: 44.58 }],
  },
  {
    ticker: 'DRAM',
    status: 'Closed',
    buys: [{ qty: 158, price: 49.00 }],
    sells: [{ qty: 158, price: 58.02 }],
  },
  {
    ticker: 'MU',
    status: 'Closed',
    buys: [{ qty: 24.3, price: 783.26 }],
    sells: [
      { qty: 4.85, price: 975.58 },
      { qty: 19.45, price: 999.60 },
    ],
  },
  {
    ticker: 'MRVL',
    status: 'Trimmed',
    buys: [{ qty: 24.45, price: 181.30 }],
    sells: [{ qty: 24.45, price: 222.25 }],
  },
  {
    ticker: 'LITE',
    status: 'Trimmed',
    buys: [{ qty: 4.21, price: 687.06 }],
    sells: [{ qty: 4.21, price: 890.00 }],
  },
  {
    ticker: 'AXTI',
    status: 'Closed',
    buys: [
      { qty: 165.48, price: 57.79 },
      { qty: 10.32, price: 77.66 },
    ],
    sells: [
      { qty: 69.4, price: 78.25 },
      { qty: 46.44, price: 77.68 },
      { qty: 59.96, price: 88.01 },
    ],
  },
  {
    ticker: 'NBIS',
    status: 'Trimmed',
    buys: [{ qty: 7.9, price: 185.50 }],
    sells: [{ qty: 7.9, price: 272.82 }],
  },
];

function computeClosedSummary(pos) {
  const soldQty = pos.sells.reduce((s, x) => s + x.qty, 0);
  const soldValue = pos.sells.reduce((s, x) => s + x.qty * x.price, 0);
  const boughtValue = pos.buys.reduce((s, x) => s + x.qty * x.price, 0);
  const gainPct = ((soldValue - boughtValue) / boughtValue) * 100;
  const gainUsd =
    pos.usdCostBasis != null ? pos.usdCostBasis * (gainPct / 100) : soldValue - boughtValue;
  return { soldQty, gainPct, gainUsd };
}

function renderClosedPositions() {
  const list = document.getElementById('closedPositions');
  if (!list) return;
  list.innerHTML = '';

  const ranked = CLOSED_POSITIONS.map((pos) => ({ pos, summary: computeClosedSummary(pos) })).sort(
    (a, b) => b.summary.gainPct - a.summary.gainPct
  );

  ranked.forEach(({ pos, summary }) => {
    const { gainPct, gainUsd } = summary;
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'closed-name';

    const ticker = document.createElement('span');
    ticker.className = 'closed-ticker';
    ticker.textContent = pos.ticker;

    const status = document.createElement('span');
    status.className = 'closed-status';
    status.textContent = pos.status;

    name.appendChild(ticker);
    name.appendChild(status);

    const change = document.createElement('span');
    change.className = 'closed-change';
    const sign = gainPct >= 0 ? '+' : '';
    change.innerHTML = `${sign}${gainPct.toFixed(1)}% <span class="closed-usd">(${sign}${formatCurrency(
      gainUsd
    )})</span>`;
    change.classList.toggle('negative', gainPct < 0);

    li.appendChild(name);
    li.appendChild(change);
    list.appendChild(li);
  });
}

function attachRangeButtons() {
  const buttons = document.querySelectorAll('.range-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedRange = btn.dataset.range;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      renderChart();
    });
  });
}

function setMover(el, position) {
  if (!el || !position) return;
  const sign = position.dayChangePct >= 0 ? '+' : '';
  el.textContent = `${position.ticker} ${sign}${position.dayChangePct.toFixed(1)}%`;
  el.classList.toggle('negative', position.dayChangePct < 0);
}

// Swaps the favicon between 📈 and 📉 based on all-time direction — deliberately
// using the stable all-time figure rather than a noisier short-term one, so it
// doesn't flicker back and forth on minor moves between refreshes.
function updateFavicon(isPositive) {
  const emoji = isPositive ? '\u{1F4C8}' : '\u{1F4C9}';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`;
  const link = document.getElementById('favicon');
  if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

async function init() {
  const valueEl = document.getElementById('currentValue');

  try {
    const res = await fetch('/api/quotes');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    valueEl.textContent = formatCurrency(data.currentValue);

    lastHistory = data.history || [];
    // Use the true origin point (history[0], permanently the Aug 1 $100k
    // anchor) for the chart's dashed baseline — not data.entryValue, which
    // is recomputed from today's holdings and stops meaning "day one" the
    // moment a rebalance mixes old and new entry dates.
    lastEntryValue = (lastHistory[0] && lastHistory[0].value) || data.entryValue;
    lastCurrentValue = data.currentValue;
    lastSpyHistory = data.spyHistory || [];
    lastSpyEntryPrice = data.spyEntryPrice || null;
    renderChart();
    updateFavicon(data.allTimeReturnPct >= 0);

    const list = document.getElementById('positions');
    list.innerHTML = '';
    data.positions.forEach((p) => {
      const li = document.createElement('li');

      const name = document.createElement('a');
      name.className = 'pos-name';
      name.href = `https://finance.yahoo.com/quote/${p.ticker}`;
      name.target = '_blank';
      name.rel = 'noopener';
      name.textContent = p.ticker;

      const right = document.createElement('span');
      right.className = 'pos-right';

      const change = document.createElement('span');
      change.className = 'pos-change';
      const changeSign = p.returnPct >= 0 ? '+' : '';
      change.textContent = `${changeSign}${p.returnPct.toFixed(1)}%`;
      change.classList.toggle('negative', p.returnPct < 0);

      const weight = document.createElement('span');
      weight.className = 'pos-weight';
      weight.textContent = `${Math.round(p.weight)}%`;

      right.appendChild(change);
      right.appendChild(weight);
      li.appendChild(name);
      li.appendChild(right);
      list.appendChild(li);
    });

    if (data.positions.length > 0) {
      const gainer = data.positions.reduce((a, b) => (b.dayChangePct > a.dayChangePct ? b : a));
      const loser = data.positions.reduce((a, b) => (b.dayChangePct < a.dayChangePct ? b : a));
      setMover(document.getElementById('gainerValue'), gainer);
      setMover(document.getElementById('loserValue'), loser);
    }

    document.getElementById('updated').textContent =
      'Updated ' + new Date(data.updatedAt).toLocaleString();
  } catch (err) {
    valueEl.textContent = 'Unable to load prices';
    console.error(err);
  }
}

async function tick() {
  await init();
  updateMarketStatus();
}

tick();
attachChartInteractivity();
attachRangeButtons();
renderClosedPositions();

// Auto-refresh every 20s — matches the server-side cache window in
// api/quotes.js. Well within Finnhub's free-tier rate limit (60/min;
// this uses 8 per refresh, so ~24/min even at this pace).
setInterval(tick, 20000);
