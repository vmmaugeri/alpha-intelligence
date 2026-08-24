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
  text.textContent = open ? 'Market open' : 'Market closed';
  if (dot) dot.classList.toggle('open', open);
}

let chartState = null;
let lastEntryValue = null;
let lastHistory = [];
let lastCurrentValue = null;
let lastTrueOriginValue = null;
let selectedRange = '1W';

const RANGE_MS = {
  '24H': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  // 'All' deliberately has no entry — handled as a special case (no time filter at all)
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

  let pct;
  if (selectedRange === 'All' && lastTrueOriginValue != null) {
    pct = ((lastCurrentValue - lastTrueOriginValue) / lastTrueOriginValue) * 100;
  } else {
    const filtered = filterHistoryByRange(lastHistory, selectedRange);
    pct = computeRangeReturnPct(filtered, lastCurrentValue);
  }

  if (pct == null) return;
  const sign = pct >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${pct.toFixed(2)}% ${RANGE_LABELS[selectedRange] || ''}`;
  changeEl.classList.toggle('negative', pct < 0);
}

function renderChart(hoverIndex) {
  const filtered = filterHistoryByRange(lastHistory, selectedRange);
  drawChart(filtered, lastEntryValue, hoverIndex);
  updateRangeStat();
}

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

function drawChart(history, entryValue, hoverIndex) {
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

  const rangeIsPositive = history[history.length - 1].value >= history[0].value;
  const lineColor = rangeIsPositive ? '#6E8259' : '#A14A3F';
  const fillColorTop = rangeIsPositive ? 'rgba(110, 130, 89, 0.22)' : 'rgba(161, 74, 63, 0.18)';
  const fillColorBottom = rangeIsPositive ? 'rgba(110, 130, 89, 0)' : 'rgba(161, 74, 63, 0)';

  const rawMin = dataMin;
  const rawMax = dataMax;
  const showOriginLine = selectedRange === 'All';

  const ticks = niceTicks(rawMin, rawMax, 4);
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const range = max - min || 1;

  const xFor = (i) =>
    history.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (history.length - 1)) * plotW;
  const yFor = (v) => padTop + plotH - ((v - min) / range) * plotH;

  const points = history.map((h, i) => [xFor(i), yFor(h.value)]);

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
