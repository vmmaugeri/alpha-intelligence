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
let selectedRange = '1W';

const RANGE_MS = {
  '24H': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

// Filters the full history down to the selected window. If a window would be
// empty (e.g. "24H" before the portfolio is even a day old), falls back to
// showing whatever's most recent rather than an empty chart.
function filterHistoryByRange(history, range) {
  const windowMs = RANGE_MS[range] || RANGE_MS['1W'];
  const cutoff = Date.now() - windowMs;
  const filtered = history.filter((h) => new Date(h.t).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : history.slice(-1);
}

function renderChart(hoverIndex) {
  const filtered = filterHistoryByRange(lastHistory, selectedRange);
  drawChart(filtered, lastEntryValue, hoverIndex);
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
  const rawValues = entryValue != null ? [...values, entryValue] : values;
  const rawMin = Math.min(...rawValues);
  const rawMax = Math.max(...rawValues);

  const ticks = niceTicks(rawMin, rawMax, 4);
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const range = max - min || 1;

  const xFor = (i) =>
    history.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (history.length - 1)) * plotW;
  const yFor = (v) => padTop + plotH - ((v - min) / range) * plotH;

  const points = history.map((h, i) => [xFor(i), yFor(h.value)]);

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

  // Dashed baseline at the entry value
  if (entryValue != null) {
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

  // Soft fill under the line
  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  gradient.addColorStop(0, 'rgba(110, 130, 89, 0.22)');
  gradient.addColorStop(1, 'rgba(110, 130, 89, 0)');
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
  ctx.strokeStyle = '#6E8259';
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
    ctx.fillStyle = '#6E8259';
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
    drawChart(chartState.history, lastEntryValue, nearest);
    tooltip.textContent = `${formatTooltipLabel(point.t)} \u2014 ${formatCurrency(point.value)}`;
    tooltip.style.left = chartState.points[nearest][0] + 'px';
    tooltip.style.top = chartState.points[nearest][1] + 'px';
    tooltip.style.opacity = '1';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
    if (chartState) drawChart(chartState.history, lastEntryValue, null);
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

async function init() {
  const valueEl = document.getElementById('currentValue');
  const changeEl = document.getElementById('allTimeChange');

  try {
    const res = await fetch('/api/quotes');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    valueEl.textContent = formatCurrency(data.currentValue);

    const sign = data.allTimeReturnPct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${data.allTimeReturnPct.toFixed(2)}% all time`;
    changeEl.classList.toggle('negative', data.allTimeReturnPct < 0);

    lastHistory = data.history || [];
    lastEntryValue = data.entryValue;
    renderChart();

    const list = document.getElementById('positions');
    list.innerHTML = '';
    data.positions.forEach((p) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'pos-name';
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

// Auto-refresh every 60s — matches the server-side cache window in
// api/quotes.js, so this is as often as a reload would actually get you
// fresh data anyway.
setInterval(tick, 60000);
