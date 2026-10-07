// --- Theme ---
// The colours live in style.css as variables. The canvas charts read them from there at draw time, so
// light and dark stay in one place.
const THEME_KEY = 'ai-theme';

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  return {
    ink: get('--ink'),
    muted: get('--muted'),
    accent: get('--accent'),
    negative: get('--negative'),
    hairline: get('--hairline'),
    origin: get('--chart-origin'),
  };
}

// '#RRGGBB' plus an opacity, as an rgba() string for the chart's fills.
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function savedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch (e) {
    return null;
  }
}

let themeFadeTimer = null;
let themeRedrawTimer = null;

function applyTheme(theme, save) {
  const root = document.documentElement;
  const animate = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const canvases = [...document.querySelectorAll('canvas')];

  // Ease the colours over for a moment. The canvases can't ease, so they fade out, get redrawn in the new
  // colours, and fade back in.
  if (animate) {
    root.classList.add('theme-fade');
    clearTimeout(themeFadeTimer);
    themeFadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 500);
    canvases.forEach((c) => (c.style.opacity = '0'));
  }

  root.setAttribute('data-theme', theme);
  const button = document.getElementById('themeToggle');
  if (button) button.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
  if (save) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
  }

  const redraw = () => {
    if (lastHistory.length > 0) renderChart();
    if (pieState) drawPie(pieState.positions, pieHover);
    canvases.forEach((c) => (c.style.opacity = ''));
  };
  clearTimeout(themeRedrawTimer);
  if (animate) themeRedrawTimer = setTimeout(redraw, 170);
  else redraw();
}

function attachThemeToggle() {
  const button = document.getElementById('themeToggle');
  const current = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  if (button) {
    button.setAttribute('aria-checked', current() === 'dark' ? 'true' : 'false');
    button.addEventListener('click', () => applyTheme(current() === 'dark' ? 'light' : 'dark', true));
  }
  // Until the visitor picks one, follow the system setting live.
  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light', false);
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
  }
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
  const colors = themeColors();
  const lineColor = rangeIsPositive ? colors.accent : colors.negative;
  const fillColorTop = withAlpha(lineColor, rangeIsPositive ? 0.22 : 0.18);
  const fillColorBottom = withAlpha(lineColor, 0);

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
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.fillText(formatCompact(v), padLeft - 8, y);
  });

  if (entryValue != null && showOriginLine) {
    const by = yFor(entryValue);
    ctx.strokeStyle = colors.origin;
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
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

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

  if (hoverIndex != null && points[hoverIndex]) {
    const [hx] = points[hoverIndex];
    ctx.strokeStyle = withAlpha(colors.ink, 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();
  }

  points.forEach(([x, y], i) => {
    const isLast = i === points.length - 1;
    const isHover = i === hoverIndex;
    if (!isLast && !isHover) return;
    ctx.beginPath();
    ctx.arc(x, y, isHover ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
  });

  ctx.fillStyle = colors.muted;
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

// --- Closed & trimmed positions ---
// Static historical record (no live prices needed — these are settled).
const CLOSED_POSITIONS = [
  {
    ticker: 'PENG',
    status: 'Closed',
    date: '2026-10-07',
    buys: [{ qty: 88.03, price: 60.50 }],
    sells: [{ qty: 88.03, price: 72.97 }],
    note: 'A successful 1-day swing trade: the position rose 20.6% for a $1,098 gain after Q4 earnings came in well above the company’s outlook.',
  },
  {
    ticker: 'BRUN',
    status: 'Closed',
    date: '2026-10-06',
    buys: [{ qty: 923.49, price: 19.88 }],
    sells: [{ qty: 923.49, price: 15.50 }],
  },
  {
    ticker: 'VIAV',
    status: 'Closed',
    date: '2026-10-02',
    buys: [{ qty: 157.6, price: 43.02 }],
    sells: [{ qty: 157.6, price: 47.21 }],
  },
  {
    ticker: 'BE',
    status: 'Closed',
    date: '2026-09-21',
    buys: [{ qty: 47.23, price: 213.90 }],
    sells: [{ qty: 47.23, price: 275.79 }],
  },
  {
    ticker: 'SILC',
    status: 'Closed',
    date: '2026-09-21',
    buys: [{ qty: 130.64, price: 49.81 }],
    sells: [{ qty: 130.64, price: 48.29 }],
  },
  {
    ticker: 'MRVL',
    status: 'Closed',
    date: '2026-09-09',
    buys: [{ qty: 70, price: 222.50 }],
    sells: [{ qty: 70, price: 232.46 }],
  },
  {
    ticker: 'BE',
    status: 'Trimmed',
    date: '2026-09-09',
    buys: [{ qty: 30, price: 213.90 }],
    sells: [{ qty: 30, price: 278.14 }],
  },
  {
    ticker: 'CRWD',
    status: 'Closed',
    date: '2026-09-08',
    buys: [
      { qty: 60.71, price: 215.07 },
      { qty: 0.01, price: 207.21 },
    ],
    sells: [{ qty: 60.72, price: 207.31 }],
  },
  {
    ticker: 'AMZN',
    status: 'Closed',
    date: '2026-08-28',
    buys: [{ qty: 68.35, price: 263.37 }],
    sells: [{ qty: 68.35, price: 266.57 }],
  },
  {
    ticker: 'VIAV',
    status: 'Trimmed',
    date: '2026-08-28',
    buys: [{ qty: 103, price: 43.02 }],
    sells: [{ qty: 103, price: 37.41 }],
  },
  {
    ticker: 'IREN',
    status: 'Closed',
    date: '2026-08-14',
    buys: [{ qty: 271.73, price: 36.60 }],
    sells: [{ qty: 271.73, price: 44.58 }],
  },
  {
    ticker: 'DRAM',
    status: 'Closed',
    date: '2026-08-14',
    buys: [{ qty: 158, price: 49.00 }],
    sells: [{ qty: 158, price: 58.02 }],
  },
  {
    ticker: 'MU',
    status: 'Closed',
    date: '2026-08-15',
    buys: [{ qty: 24.3, price: 783.26 }],
    sells: [
      { qty: 4.85, price: 975.58 },
      { qty: 19.45, price: 999.60 },
    ],
  },
  {
    ticker: 'MRVL',
    status: 'Closed',
    date: '2026-08-25',
    buys: [{ qty: 79.97, price: 181.30 }],
    sells: [
      { qty: 24.45, price: 222.25 },
      { qty: 55.52, price: 242.61 },
    ],
  },
  {
    ticker: 'LITE',
    status: 'Closed',
    date: '2026-08-28',
    buys: [{ qty: 15.4, price: 687.06 }],
    sells: [
      { qty: 4.21, price: 890.00 },
      { qty: 11.19, price: 915.07 },
    ],
  },
  {
    ticker: 'AXTI',
    status: 'Closed',
    date: '2026-08-15',
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
    date: '2026-08-15',
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

function formatClosedDate(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// --- Notes: the little bubbles under a position ---
// One or two short sentences about the latest move in a position: what was added or opened, what a close
// made, and why. Open positions are keyed by ticker and show for NOTE_DAYS after their date, then
// disappear by themselves. A closed position keeps its note on its CLOSED_POSITIONS entry, so it shows
// for as long as that entry is one of the most recent.
const NOTE_DAYS = 14;
const POSITION_NOTES = {
  MU: {
    date: '2026-10-07',
    text: 'Added 2.15 shares ($2,337) ahead of Samsung’s early Q3 figures on Thu 8 Oct, where the tone on memory prices and margins matters most for MU.',
  },
  SNDK: {
    date: '2026-10-07',
    text: 'Added 2.37 shares ($4,086) for the same Samsung read on Thu 8 Oct, as memory pricing and margins drive SanDisk too.',
  },
};

function activeNote(ticker) {
  const note = POSITION_NOTES[ticker];
  if (!note) return null;
  const ageDays = (Date.now() - new Date(`${note.date}T12:00:00Z`).getTime()) / 86400000;
  if (ageDays > NOTE_DAYS) return null;
  return { text: note.text, dateLabel: formatClosedDate(note.date) };
}

// A note on an open position leads with the date the change was made. A closed position already shows its
// date in the row, so its note doesn't need one.
function buildNote(text, dateLabel) {
  const el = document.createElement('div');
  // Held back until popNotes() lets it out, unless the first pop-out has already happened (a refresh
  // rebuilds the rows, and those bubbles should just be there).
  el.className = notesPopped ? 'note' : 'note note-wait';
  if (dateLabel) {
    const date = document.createElement('span');
    date.className = 'note-date';
    date.textContent = dateLabel;
    el.appendChild(date);
  }
  el.appendChild(document.createTextNode(text));
  return el;
}

// The bubbles pop out one by one after the page has loaded in, each on its own delay and speed so it never
// looks like a block. Runs once for the notes waiting; later rebuilds skip it.
let notesPopped = false;
const POP_JITTER_MS = [0, 240, 90, 420, 150];
const POP_DURATIONS_S = [0.7, 0.52, 0.85, 0.6];

function popNotes(startMs) {
  const waiting = [...document.querySelectorAll('.note.note-wait')];
  waiting.forEach((el, i) => {
    el.style.setProperty('--pop-delay', `${Math.round(startMs + i * 330 + POP_JITTER_MS[i % POP_JITTER_MS.length])}ms`);
    el.style.setProperty('--pop-dur', `${POP_DURATIONS_S[i % POP_DURATIONS_S.length]}s`);
    el.classList.remove('note-wait');
    el.classList.add('note-pop');
  });
  if (waiting.length > 0) notesPopped = true;
}

// On a wide screen (1100px and up) a note comes out beside its row, in the empty margin, alternating
// right, left, right... down the page so it feels even. On anything narrower it stays under the row.
// Notes for neighbouring positions could overlap, so each one is nudged down just enough to clear the one
// above it on its side, with its tail still pointing at its row. If neither margin has room, that note
// simply goes under its row instead.
function layoutSideNotes() {
  const wide = window.matchMedia('(min-width: 1100px)').matches;
  let turn = 0;
  ['positions', 'closedPositions'].forEach((id) => {
    const list = document.getElementById(id);
    if (!list) return;
    const rows = [...list.querySelectorAll('li.has-note')];
    rows.forEach((li) => {
      li.classList.remove('note-side', 'note-right', 'note-left');
      li.querySelector('.note').style.removeProperty('--note-shift');
    });
    if (!wide) return;

    const prevBottom = { right: -Infinity, left: -Infinity };
    rows.forEach((li) => {
      const note = li.querySelector('.note');
      const order = turn++ % 2 === 0 ? ['right', 'left'] : ['left', 'right'];
      for (const side of order) {
        li.classList.add('note-side', `note-${side}`);
        const r = note.getBoundingClientRect();
        const need = Math.max(0, prevBottom[side] + 8 - r.top);
        if (need <= Math.max(0, r.height / 2 - 16)) {
          if (need > 0) note.style.setProperty('--note-shift', `${need}px`);
          prevBottom[side] = r.top + need + r.height;
          return;
        }
        li.classList.remove('note-side', `note-${side}`);
      }
    });
  });
}

function renderClosedPositions() {
  const list = document.getElementById('closedPositions');
  if (!list) return;
  list.innerHTML = '';

  const MAX_SHOWN = 3;
  const ranked = CLOSED_POSITIONS.map((pos) => ({ pos, summary: computeClosedSummary(pos) }))
    .sort((a, b) => new Date(b.pos.date) - new Date(a.pos.date))
    .slice(0, MAX_SHOWN);

  ranked.forEach(({ pos, summary }) => {
    const { gainPct, gainUsd } = summary;
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'closed-name';

    const ticker = document.createElement('a');
    ticker.className = 'closed-ticker';
    ticker.href = `https://finance.yahoo.com/quote/${pos.ticker}`;
    ticker.target = '_blank';
    ticker.rel = 'noopener';
    ticker.textContent = pos.ticker;

    const status = document.createElement('span');
    status.className = 'closed-status';
    status.textContent = `${pos.status} \u00b7 ${formatClosedDate(pos.date)}`;

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
    if (pos.note) {
      li.classList.add('has-note');
      li.appendChild(buildNote(pos.note));
    }
    list.appendChild(li);
  });

  renderWinRate();
}

// Win rate over every entry in CLOSED_POSITIONS (closes and trims alike, each one a realized trade), not
// just the 3 shown. A win is a sale above the entry price.
function renderWinRate() {
  const el = document.getElementById('closedStats');
  if (!el || CLOSED_POSITIONS.length === 0) return;
  const total = CLOSED_POSITIONS.length;
  const wins = CLOSED_POSITIONS.filter((pos) => computeClosedSummary(pos).gainPct > 0).length;

  el.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'closed-stats-label';
  label.textContent = 'Win rate';
  const value = document.createElement('span');
  value.className = 'closed-stats-value';
  value.innerHTML = `${Math.round((wins / total) * 100)}% <span class="closed-usd">(${wins} of ${total} trades)</span>`;
  el.appendChild(label);
  el.appendChild(value);
}

// --- Allocation pie chart ---
// Outline-only pie drawn at a tilt, no colors. Slice size is the same entry-based weight as the
// positions list. Each ticker sits inside its slice when it fits; when a slice is too small, a
// leader line points from the slice to the ticker outside the pie.
const PIE_TILT = 0.7; // vertical squash of the circle (smaller = more tilted)
const PIE_DEPTH = 12; // thickness of the pie's edge in px

let pieState = null;
let pieHover = null;
let pieSignature = null;

function layoutPie(positions, width, height, ctx) {
  const total = positions.reduce((sum, p) => sum + p.weight, 0);
  if (!(total > 0)) return null;

  const k = PIE_TILT;
  const fontSize = width >= 440 ? 14 : 11.5;
  const font = `500 ${fontSize}px Raleway, sans-serif`;
  ctx.font = font;
  const textH = fontSize * 0.72;
  const textW = positions.map((p) => ctx.measureText(p.ticker).width);

  let angle = -Math.PI / 2;
  const slices = positions.map((p) => {
    const start = angle;
    angle += (p.weight / total) * Math.PI * 2;
    return { start, end: angle, mid: (start + angle) / 2 };
  });

  // Everything is laid out around the pie's centre at (0, 0) and shifted into the canvas at the end.
  const place = (R) => {
    // True when a padded ticker box centred on (x, y) lies entirely inside slice s.
    const fits = (s, x, y, hw, hh) =>
      [-1, 0, 1].every((ix) =>
        [-1, 0, 1].every((iy) => {
          const u = (x + ix * hw) / R;
          const v = (y + iy * hh) / (R * k);
          if (Math.hypot(u, v) > 0.97) return false;
          let a = Math.atan2(v, u);
          if (a < -Math.PI / 2) a += Math.PI * 2;
          return a >= s.start && a <= s.end;
        })
      );

    const labels = slices.map((s, i) => {
      const ux = Math.cos(s.mid);
      const uy = Math.sin(s.mid);
      const hw = textW[i] / 2 + 4;
      const hh = textH / 2 + 4;
      for (const f of [0.66, 0.74, 0.58, 0.82, 0.5]) {
        const x = ux * f * R;
        const y = uy * f * R * k;
        if (fits(s, x, y, hw, hh)) return { inside: true, align: 'center', tx: x, ty: y };
      }
      // Too small: a dot inside the slice, a line out past the rim, then the ticker.
      const ex = ux * 1.1 * R;
      const ey = uy * 1.1 * R * k + (uy > 0 ? PIE_DEPTH : 0);
      const label = { inside: false, w: textW[i], top: uy < 0, ax: ux * 0.82 * R, ay: uy * 0.82 * R * k, ex, ey };
      if (Math.abs(ux) < 0.25) {
        label.align = 'center';
        label.tx = ex;
        label.ty = ey + (uy < 0 ? -(textH / 2 + 4) : textH / 2 + 4);
      } else {
        label.align = ux > 0 ? 'left' : 'right';
        label.tx = ex + (ux > 0 ? 7 : -7);
        label.ty = ey;
        label.hx = ex + (ux > 0 ? 5 : -5);
      }
      return label;
    });

    // Keep stacked outside tickers on the same side from overlapping.
    ['left', 'right'].forEach((side) => {
      const group = labels.filter((l) => !l.inside && l.align === side).sort((a, b) => a.ty - b.ty);
      for (let j = 1; j < group.length; j++) {
        const minY = group[j - 1].ty + textH + 5;
        if (group[j].ty < minY) {
          group[j].ty = minY;
          group[j].ey = minY;
        }
      }
    });

    // Same for tickers above or below the pie: spread them sideways, keeping the group centred.
    [true, false].forEach((top) => {
      const group = labels
        .filter((l) => !l.inside && l.align === 'center' && l.top === top)
        .sort((a, b) => a.tx - b.tx);
      if (group.length < 2) return;
      const before = group.map((l) => l.tx);
      for (let j = 1; j < group.length; j++) {
        const minX = group[j - 1].tx + (group[j - 1].w + group[j].w) / 2 + 8;
        if (group[j].tx < minX) group[j].tx = minX;
      }
      const shift = group.reduce((sum, l, j) => sum + (l.tx - before[j]), 0) / group.length;
      group.forEach((l) => {
        l.tx -= shift;
        l.ex = l.tx;
      });
    });

    // Bounding box of the pie and any outside tickers.
    let x0 = -R;
    let x1 = R;
    let y0 = -R * k;
    let y1 = R * k + PIE_DEPTH;
    labels.forEach((l, i) => {
      if (l.inside) return;
      const w = textW[i];
      const lx = l.align === 'left' ? l.tx : l.align === 'right' ? l.tx - w : l.tx - w / 2;
      x0 = Math.min(x0, lx);
      x1 = Math.max(x1, lx + w);
      y0 = Math.min(y0, l.ty - textH / 2);
      y1 = Math.max(y1, l.ty + textH / 2);
    });
    return { labels, x0, x1, y0, y1, ok: x1 - x0 <= width - 4 && y1 - y0 <= height - 4 };
  };

  // Start as large as the canvas allows and shrink until any outside tickers fit too.
  let R = Math.min((width - 4) / 2, (height - PIE_DEPTH - 4) / (2 * k));
  let placed = place(R);
  while (!placed.ok && R > 60) {
    R -= 3;
    placed = place(R);
  }

  // Centre the whole drawing (pie plus outside tickers) in the canvas.
  const dx = (width - (placed.x1 - placed.x0)) / 2 - placed.x0;
  const dy = (height - (placed.y1 - placed.y0)) / 2 - placed.y0;
  placed.labels.forEach((l) => {
    l.tx += dx;
    l.ty += dy;
    if (!l.inside) {
      l.ax += dx;
      l.ay += dy;
      l.ex += dx;
      l.ey += dy;
      if (l.hx != null) l.hx += dx;
    }
  });
  return { cx: dx, cy: dy, R, k, font, textH, slices, labels: placed.labels };
}

function drawPie(positions, hoverIndex) {
  const canvas = document.getElementById('pie');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (width < 120 || height < 80) return;

  const layout = layoutPie(positions, width, height, ctx);
  if (!layout) return;
  const { cx, cy, R, k, font, textH, slices, labels } = layout;
  const rimX = (a) => cx + Math.cos(a) * R;
  const rimY = (a) => cy + Math.sin(a) * R * k;
  const dimmed = hoverIndex != null && slices[hoverIndex] != null;
  const { ink, muted } = themeColors();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = dimmed ? 0.45 : 1;

  // Edge of the pie: the front rim, both sides, and a short drop at each slice boundary on the front.
  ctx.beginPath();
  ctx.ellipse(cx, cy + PIE_DEPTH, R, R * k, 0, 0, Math.PI);
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx - R, cy + PIE_DEPTH);
  ctx.moveTo(cx + R, cy);
  ctx.lineTo(cx + R, cy + PIE_DEPTH);
  slices.forEach((s) => {
    if (Math.sin(s.start) > 0.02) {
      ctx.moveTo(rimX(s.start), rimY(s.start));
      ctx.lineTo(rimX(s.start), rimY(s.start) + PIE_DEPTH);
    }
  });
  ctx.stroke();

  // Top face: the outline and one divider per slice.
  ctx.beginPath();
  ctx.ellipse(cx, cy, R, R * k, 0, 0, Math.PI * 2);
  if (slices.length > 1) {
    slices.forEach((s) => {
      ctx.moveTo(cx, cy);
      ctx.lineTo(rimX(s.start), rimY(s.start));
    });
  }
  ctx.stroke();

  if (dimmed) {
    const s = slices[hoverIndex];
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(rimX(s.start), rimY(s.start));
    ctx.ellipse(cx, cy, R, R * k, 0, s.start, s.end);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  labels.forEach((l, i) => {
    ctx.globalAlpha = dimmed && i !== hoverIndex ? 0.45 : 1;
    if (!l.inside) {
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.ax, l.ay);
      ctx.lineTo(l.ex, l.ey);
      if (l.hx != null) ctx.lineTo(l.hx, l.ey);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(l.ax, l.ay, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ink;
    ctx.textAlign = l.align;
    ctx.fillText(positions[i].ticker, l.tx, l.ty + textH / 2);
  });
  ctx.globalAlpha = 1;

  pieState = { positions, slices, cx, cy, R, k };
}

function pieIndexAt(x, y) {
  if (!pieState) return null;
  const u = (x - pieState.cx) / pieState.R;
  const v = (y - pieState.cy) / (pieState.R * pieState.k);
  if (Math.hypot(u, v) > 1) return null;
  let a = Math.atan2(v, u);
  if (a < -Math.PI / 2) a += Math.PI * 2;
  const i = pieState.slices.findIndex((s) => a >= s.start && a < s.end);
  return i === -1 ? null : i;
}

function setPieHover(index, x, y) {
  if (!pieState) return;
  if (index !== pieHover) {
    pieHover = index;
    drawPie(pieState.positions, index);
  }

  const tooltip = document.getElementById('pieTooltip');
  if (!tooltip) return;
  if (index == null) {
    tooltip.style.opacity = '0';
    return;
  }
  const p = pieState.positions[index];
  tooltip.textContent = `${p.ticker} — ${p.weight.toFixed(1)}%`;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
  tooltip.style.opacity = '1';
}

function renderPie(positions) {
  const section = document.getElementById('allocation');
  const canvas = document.getElementById('pie');
  if (!section || !canvas) return;
  section.hidden = positions.length === 0;
  if (positions.length === 0) return;

  // Weights only change on a rebalance, so redraw only when the data, the canvas size or the font changes.
  const signature = [
    positions.map((p) => `${p.ticker}:${p.weight.toFixed(4)}`).join('|'),
    canvas.clientWidth,
    canvas.clientHeight,
    window.devicePixelRatio || 1,
    document.fonts && document.fonts.check ? document.fonts.check('500 13px Raleway') : '',
  ].join('/');
  if (signature === pieSignature) return;
  pieSignature = signature;

  canvas.setAttribute(
    'aria-label',
    'Pie chart of portfolio weights: ' + positions.map((p) => `${p.ticker} ${Math.round(p.weight)}%`).join(', ')
  );

  pieHover = null;
  const tooltip = document.getElementById('pieTooltip');
  if (tooltip) tooltip.style.opacity = '0';
  drawPie(positions, null);
}

function attachPieInteractivity() {
  const canvas = document.getElementById('pie');
  if (!canvas) return;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPieHover(pieIndexAt(x, y), x, y);
  });

  canvas.addEventListener('mouseleave', () => setPieHover(null));

  // Ticker widths decide what fits inside a slice, so redraw once the web font is in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (pieState) drawPie(pieState.positions, pieHover);
    });
  }
}

// --- Benchmarks and alpha ---
// Alpha is the portfolio's return since the Aug 1 start minus each benchmark's return over the same
// period, in percentage points. It is computed from the rounded figures shown, so the table adds up.
// Refreshed on the same 20 second tick as everything else, from the same /api/quotes snapshot.
let benchKey = null;

const benchRound = (x) => Math.round(x * 10) / 10;
const benchSigned = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

function buildBenchRow(row) {
  const li = document.createElement('li');
  if (row.alpha === null) li.className = 'self';

  const name = document.createElement('span');
  name.className = 'bench-name';

  let label;
  if (row.symbol) {
    label = document.createElement('a');
    label.href = `https://finance.yahoo.com/quote/${row.symbol}`;
    label.target = '_blank';
    label.rel = 'noopener';
  } else {
    label = document.createElement('span');
  }
  label.className = 'bench-label';
  label.textContent = row.label;
  name.appendChild(label);

  if (row.desc) {
    const desc = document.createElement('span');
    desc.className = 'bench-desc';
    desc.textContent = row.desc;
    name.appendChild(desc);
  }

  const right = document.createElement('span');
  right.className = 'bench-right';

  const ret = document.createElement('span');
  ret.className = 'bench-ret';

  const alpha = document.createElement('span');
  alpha.className = 'bench-alpha';
  const alphaValue = document.createElement('span');
  alphaValue.className = 'bench-alpha-val';
  alpha.appendChild(alphaValue);
  if (row.alpha === null) {
    alpha.classList.add('none');
    alphaValue.textContent = '—';
  } else {
    const unit = document.createElement('span');
    unit.className = 'bench-unit';
    unit.textContent = ' pts';
    alpha.appendChild(unit);
  }

  right.appendChild(ret);
  right.appendChild(alpha);
  li.appendChild(name);
  li.appendChild(right);
  return li;
}

function updateBenchRow(li, row) {
  const ret = li.querySelector('.bench-ret');
  ret.textContent = `${benchSigned(row.pct)}%`;
  ret.classList.toggle('negative', row.pct < 0);
  if (row.alpha !== null) {
    li.querySelector('.bench-alpha-val').textContent = benchSigned(row.alpha);
    li.querySelector('.bench-alpha').classList.toggle('negative', row.alpha < 0);
  }
}

function renderBenchmarks(data) {
  const section = document.getElementById('benchmarks');
  const list = document.getElementById('benchList');
  if (!section || !list) return;

  const benchmarks = data.benchmarks || [];
  if (benchmarks.length === 0 || !data.trueOriginValue) {
    section.hidden = true;
    return;
  }

  const portfolioPct = benchRound(((data.currentValue - data.trueOriginValue) / data.trueOriginValue) * 100);
  const rows = [
    { label: 'Portfolio', desc: '', pct: portfolioPct, alpha: null },
    ...benchmarks.map((b) => {
      const pct = benchRound(b.returnPct);
      return { label: b.symbol, symbol: b.symbol, desc: b.name, pct, alpha: benchRound(portfolioPct - pct) };
    }),
  ];

  // Rebuild the rows only when the set of benchmarks changes. Otherwise just update the numbers in
  // place, so the links keep keyboard focus and hover state through the 20 second refresh.
  const key = rows.map((r) => r.label).join('|');
  if (key !== benchKey) {
    benchKey = key;
    list.innerHTML = '';
    rows.forEach((row) => list.appendChild(buildBenchRow(row)));
  }
  rows.forEach((row, i) => updateBenchRow(list.children[i], row));

  section.hidden = false;
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

// A mover only counts if it moved the right way: the gainer has to be up and the loser has to be down.
// Otherwise (say, no position went down today) it shows a dash. Only the ticker is a link, like in the
// positions list, and the link is reused between refreshes so it keeps keyboard focus.
function setMover(el, position, direction) {
  if (!el) return;
  const change = position ? position.dayChangePct : null;
  const qualifies = direction === 'up' ? change > 0 : change < 0;

  if (!qualifies) {
    el.textContent = '—';
    el.classList.remove('negative');
    el.classList.add('none');
    return;
  }

  let link = el.querySelector('a');
  let pct = el.querySelector('.mover-pct');
  if (!link) {
    el.textContent = '';
    link = document.createElement('a');
    link.className = 'mover-link';
    link.target = '_blank';
    link.rel = 'noopener';
    pct = document.createElement('span');
    pct.className = 'mover-pct';
    el.appendChild(link);
    el.appendChild(document.createTextNode(' '));
    el.appendChild(pct);
  }
  link.href = `https://finance.yahoo.com/quote/${position.ticker}`;
  link.textContent = position.ticker;
  pct.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  el.classList.remove('none');
  el.classList.toggle('negative', change < 0);
}

function renderMovers(positions) {
  const best = positions.length > 0 ? positions.reduce((a, b) => (b.dayChangePct > a.dayChangePct ? b : a)) : null;
  const worst = positions.length > 0 ? positions.reduce((a, b) => (b.dayChangePct < a.dayChangePct ? b : a)) : null;
  setMover(document.getElementById('gainerValue'), best, 'up');
  setMover(document.getElementById('loserValue'), worst, 'down');
}

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
    lastEntryValue = (lastHistory[0] && lastHistory[0].value) || data.entryValue;
    lastCurrentValue = data.currentValue;
    lastTrueOriginValue = data.trueOriginValue || null;
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

      const dayChange = document.createElement('span');
      dayChange.className = 'pos-day-change';
      const dayChangeSign = p.dayChangePct >= 0 ? '+' : '';
      dayChange.textContent = `${dayChangeSign}${p.dayChangePct.toFixed(1)}%`;
      dayChange.classList.toggle('negative', p.dayChangePct < 0);

      const change = document.createElement('span');
      change.className = 'pos-change';
      const changeSign = p.returnPct >= 0 ? '+' : '';
      change.textContent = `${changeSign}${p.returnPct.toFixed(1)}%`;
      change.classList.toggle('negative', p.returnPct < 0);

      const weight = document.createElement('span');
      weight.className = 'pos-weight';
      weight.textContent = `${Math.round(p.weight)}%`;

      right.appendChild(dayChange);
      right.appendChild(change);
      right.appendChild(weight);
      li.appendChild(name);
      li.appendChild(right);
      const note = activeNote(p.ticker);
      if (note) {
        li.classList.add('has-note');
        li.appendChild(buildNote(note.text, note.dateLabel));
      }
      list.appendChild(li);
    });

    renderMovers(data.positions);

    try {
      layoutSideNotes();
    } catch (noteErr) {
      console.error(noteErr);
    }

    try {
      renderPie(data.positions);
    } catch (pieErr) {
      console.error(pieErr);
    }

    try {
      renderBenchmarks(data);
    } catch (benchErr) {
      console.error(benchErr);
    }

    document.getElementById('updated').textContent =
      'Updated ' + new Date(data.updatedAt).toLocaleString();
    if (dataRevealed) popNotes(300); // bubbles that only turned up after the page was already revealed
  } catch (err) {
    valueEl.textContent = 'Unable to load prices';
    console.error(err);
  }
}

async function tick() {
  await init();
  updateMarketStatus();
}

// --- Load-in ---
// The same fade-up as the main site, top to bottom. The title block plays as soon as the font is in.
// Everything that depends on prices waits until the first data is on the page (or 3 seconds, whichever
// comes first), so nothing fills in while it is already visible. It runs once: the 20 second refreshes
// afterwards just update the numbers.
const REVEAL_STEP_MS = 50;
let headerRevealedAt = null;
let headerSlots = 0;
let dataRevealed = false;

function revealHeader() {
  if (headerRevealedAt !== null) return;
  headerRevealedAt = performance.now();
  document.querySelectorAll('.rise-now').forEach((el, i) => {
    el.style.setProperty('--d', `${i * REVEAL_STEP_MS}ms`);
    el.classList.add('in');
    headerSlots = i + 1;
  });
}

function revealData() {
  if (dataRevealed) return;
  dataRevealed = true;
  revealHeader();
  renderChart(); // redraw now the font is in, so the axis labels use it

  // Carry on from the title block, never starting earlier than now.
  let delay = Math.max(0, headerSlots * REVEAL_STEP_MS - (performance.now() - headerRevealedAt));
  document.querySelectorAll('.rise:not(.rise-now)').forEach((el) => {
    if (el.hidden) {
      el.classList.add('in'); // a section that shows up later must not be stuck invisible
      return;
    }
    el.style.setProperty('--d', `${delay}ms`);
    el.classList.add('in');
    delay += REVEAL_STEP_MS;
  });
  popNotes(delay + 450);
}

const fontsReady = Promise.race([
  Promise.all(
    document.fonts && document.fonts.load
      ? [document.fonts.load('400 16px Raleway'), document.fonts.load('500 16px Raleway')]
      : []
  ).catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 800)),
]);

const firstTick = tick();
attachThemeToggle();
attachChartInteractivity();
attachPieInteractivity();
attachRangeButtons();
renderClosedPositions();
layoutSideNotes();
window.addEventListener('resize', layoutSideNotes);

fontsReady.then(revealHeader);
fontsReady.then(layoutSideNotes);
Promise.allSettled([firstTick, fontsReady]).then(revealData);
setTimeout(revealData, 3000);

setInterval(tick, 20000);
