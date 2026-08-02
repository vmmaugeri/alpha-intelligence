const HISTORY_KEY = 'alpha-intelligence-history';

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

// Records today's index value (portfolio value rebased to 100 at entry).
// One entry per day — reloading the page the same day just updates today's point.
// NOTE: this history lives in the visitor's browser (localStorage), so right now
// it only builds up for whoever is viewing from the same device/browser over time.
function updateHistory(indexValue) {
  const history = loadHistory();
  const today = todayStr();
  const existing = history.find((h) => h.date === today);
  if (existing) {
    existing.value = indexValue;
  } else {
    history.push({ date: today, value: indexValue });
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

function drawChart(history) {
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

  const pad = 20;
  const values = history.map((h) => h.value);
  const min = Math.min(...values, 100);
  const max = Math.max(...values, 100);
  const range = max - min || 1;

  const points = history.map((h, i) => {
    const x =
      history.length === 1
        ? width / 2
        : pad + (i / (history.length - 1)) * (width - pad * 2);
    const y = height - pad - ((h.value - min) / range) * (height - pad * 2);
    return [x, y];
  });

  // Dashed baseline at the entry point (index = 100)
  const baselineY = height - pad - ((100 - min) / range) * (height - pad * 2);
  ctx.strokeStyle = '#E6E1D4';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, baselineY);
  ctx.lineTo(width - pad, baselineY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Performance line
  ctx.strokeStyle = '#6E8259';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dot marking the latest value
  const [lastX, lastY] = points[points.length - 1];
  ctx.fillStyle = '#6E8259';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();
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

    const indexValue = (data.currentValue / data.entryValue) * 100;
    const history = updateHistory(indexValue);
    drawChart(history);

    const list = document.getElementById('positions');
    list.innerHTML = '';
    data.positions.forEach((p) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'pos-name';
      name.textContent = p.name;
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
