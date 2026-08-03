const HISTORY_KEY = 'alpha-intelligence-history-v2';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Records today's actual portfolio dollar value.
// One entry per day — reloading the page the same day just updates today's point.
// NOTE: this history lives in the visitor's browser (localStorage), so right now
// it only builds up for whoever is viewing from the same device/browser over time.
function updateHistory(value) {
  const history = loadHistory();
  const today = todayStr();
  const existing = history.find((h) => h.date === today);
  if (existing) {
    existing.value = value;
  } else {
    history.push({ date: today, value });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  saveHistory(history);
  return history;
}

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

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  const allValues = entryValue != null ? [...values, entryValue] : values;
  let min = Math.min(...allValues);
  let max = Math.max(...allValues);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const cushion = (max - min) * 0.15;
  min -= cushion;
  max += cushion;
  const range = max - min || 1;

  const xFor = (i) =>
    history.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (history.length - 1)) * plotW;
  const yFor = (v) => padTop + plotH - ((v - min) / range) * plotH;

  const points = history.map((h, i) => [xFor(i), yFor(h.value)]);

  // Gridlines with compact $ labels (top / middle / bottom)
  ctx.font = '10px Raleway, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  [max - cushion, (max + min) / 2, min + cushion].forEach((v) => {
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

  // Dots at every point — hollow for past days, solid for today/hovered
  points.forEach(([x, y], i) => {
    const isLast = i === points.length - 1;
    const isHover = i === hoverIndex;
    const filled = isLast || isHover;
    ctx.beginPath();
    ctx.arc(x, y, isHover ? 5 : isLast ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = filled ? '#6E8259' : '#F7F1E3';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#6E8259';
    ctx.stroke();
  });

  // Date labels (first / last day)
  ctx.fillStyle = '#8F8A7C';
  ctx.font = '10px Raleway, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(formatDateLabel(history[0].date), padLeft, height - 4);
  if (history.length > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(formatDateLabel(history[history.length - 1].date), width - padRight, height - 4);
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
    tooltip.textContent = `${formatDateLabel(point.date)} \u2014 ${formatCurrency(point.value)}`;
    tooltip.style.left = chartState.points[nearest][0] + 'px';
    tooltip.style.top = chartState.points[nearest][1] + 'px';
    tooltip.style.opacity = '1';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
    if (chartState) drawChart(chartState.history, lastEntryValue, null);
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

    const history = updateHistory(data.currentValue);
    lastEntryValue = data.entryValue;
    drawChart(history, data.entryValue);

    const list = document.getElementById('positions');
    list.innerHTML = '';
    data.positions.forEach((p) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'pos-name';
      name.textContent = p.ticker;
      const weight = document.createElement('span');
      weight.className = 'pos-weight';
      weight.textContent = `${Math.round(p.weight)}%`;
      li.appendChild(name);
      li.appendChild(weight);
      list.appendChild(li);
    });

    document.getElementById('updated').textContent =
      'Updated ' + new Date(data.updatedAt).toLocaleString();
  } catch (err) {
    valueEl.textContent = 'Unable to load prices';
    console.error(err);
  }
}

init();
updateMarketStatus();
attachChartInteractivity();
