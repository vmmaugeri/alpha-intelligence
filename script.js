// --- Stars (easter egg) ---
// In dark mode while the market is closed, a faint field of stars across the top of the page: thickest at the
// left and right edges, thinning out toward the middle where the title and chart are, twinkling very gently.
// They arrive by coming down from above the top edge, one after another, and at market open each one climbs
// back up and out through the top of the page. Switching to light mode just fades them quickly.
const SKY_HEIGHT = 440;
let skyItems = [];
let skyWidth = -1;
let skyState = 'off'; // 'off' | 'in' | 'on' | 'out'
let skyStart = 0;
let skyFast = false;
let skyInk = '#EEE7D6';
let skyFrame = null;
let skyLast = 0;

// The occasional shooting star: the first one SHOOT_FIRST_MS after the stars appear, then one every
// SHOOT_EVERY_MS for as long as they are up. A quick, faint streak, never while the stars are leaving.
const SHOOT_FIRST_MS = 30000;
const SHOOT_EVERY_MS = 90000;
const SHOOT_LENGTH_MS = 1900;
let nextShootAt = 0;
let shoot = null;
let shootSide = 0;

function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The same stars every time (fixed seed), laid out for the current width.
function buildStars(width) {
  const rand = seededRandom(20261008);
  const count = Math.round(Math.min(240, Math.max(60, width / 5)));
  const list = [];
  for (let tries = 0; list.length < count && tries < count * 60; tries++) {
    const x = rand();
    const edge = Math.abs(x * 2 - 1); // 0 in the middle, 1 at either edge
    if (rand() > 0.06 + 0.94 * Math.pow(edge, 1.7)) continue;
    const y = Math.pow(rand(), 1.5) * SKY_HEIGHT;
    list.push({
      x: x * width,
      y,
      r: 0.5 + rand() * 0.9,
      a: 0.2 + rand() * 0.4,
      phase: rand() * 6.28,
      speed: 0.4 + rand() * 0.9,
      inDelay: rand() * 1400,
      outDelay: rand() * 1500,
      fly: y + 30 + rand() * 70, // how far above its spot it starts, and how far up it goes to leave the page
    });
  }
  return list;
}

// One meteor: where it starts, which way and how far it falls, and how long its tail is. Alternates sides and
// starts in the outer thirds so the title and chart stay clear.
function makeMeteor(start, width, fromLeft) {
  const angle = ((18 + Math.random() * 20) * Math.PI) / 180;
  const dir = fromLeft ? 1 : -1;
  return {
    x: width * (fromLeft ? 0.04 + Math.random() * 0.3 : 0.66 + Math.random() * 0.3),
    y: 25 + Math.random() * 110,
    vx: Math.cos(angle) * dir,
    vy: Math.sin(angle),
    dist: 280 + Math.random() * 110,
    tail: 150 + Math.random() * 70,
    start,
    dur: SHOOT_LENGTH_MS,
  };
}

function drawMeteor(ctx, m, now) {
  const p = (now - m.start) / m.dur;
  if (p < 0 || p >= 1) return;
  const head = m.dist * (1 - Math.pow(1 - p, 1.6));
  const hx = m.x + m.vx * head;
  const hy = m.y + m.vy * head;
  const tail = m.tail * Math.min(1, p * 3) * (1 - 0.5 * p);
  const env = Math.min(1, p / 0.1) * Math.min(1, (1 - p) / 0.6);
  const g = ctx.createLinearGradient(hx - m.vx * tail, hy - m.vy * tail, hx, hy);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, skyInk);
  ctx.globalAlpha = 0.6 * env;
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - m.vx * tail, hy - m.vy * tail);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = skyInk;
  ctx.beginPath();
  ctx.arc(hx, hy, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawShootingStar(ctx, now, width) {
  if (!shoot && skyState === 'on' && now >= nextShootAt) shoot = makeMeteor(now, width, shootSide++ % 2 === 0);
  if (!shoot) return;
  if (now - shoot.start >= shoot.dur || skyState === 'off' || skyState === 'out') {
    shoot = null;
    nextShootAt = now + SHOOT_EVERY_MS;
    return;
  }
  drawMeteor(ctx, shoot, now);
}

// The Konami code, with an A I at the end for Alpha Intelligence (up up down down left right left right a i), sets off a meteor shower: about ten seconds of
// shooting stars, dark mode only. If the stars are not already up (the market is open) they come down for it
// and leave again afterwards.
// Smooth scroll that we drive ourselves, so the caller knows how long it takes (0 when nothing needs to move or
// the visitor prefers reduced motion). Returns the duration in ms.
function scrollPageTo(target) {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const to = Math.max(0, Math.min(max, Math.round(target)));
  const from = window.scrollY;
  const dist = to - from;
  if (Math.abs(dist) < 4) return 0;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    window.scrollTo(0, to);
    return 0;
  }
  const dur = Math.min(1100, 400 + Math.abs(dist) * 0.25);
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, from + dist * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return dur;
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'a', 'i'];
const SHOWER_METEORS = 8;
let konamiAt = 0;
let showerMeteors = [];
let skyForcedUntil = 0;
let showerTimer = null;

function startShower() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('sky');
  if (!dark || reduce || !canvas) return;
  // The sky sits at the very top, so the page glides up there first and the shower starts once it arrives.
  const lift = scrollPageTo(0);
  const now = performance.now() + lift;
  skyForcedUntil = now + 13000;
  if (skyState === 'off' || skyState === 'out') setSky('in');
  showerMeteors = [];
  for (let i = 0; i < SHOWER_METEORS; i++) {
    showerMeteors.push(makeMeteor(now + 1300 + i * 850 + Math.random() * 300, canvas.clientWidth, i % 2 === 0));
  }
  clearTimeout(showerTimer);
  showerTimer = setTimeout(() => {
    skyForcedUntil = 0;
    updateSky(false); // leaves again if the market is open
  }, 13000 + lift);
}

// How far along one star is. Coming in, it slides down from above the page and settles. Going out, it speeds up
// and leaves through the top of the page, and only fades in its last moments. A quick fade is used instead when
// switching to light mode, and with reduced motion.
const skyClamp = (v) => Math.max(0, Math.min(1, v));

function skyPose(s, t, reduce) {
  if (skyState === 'in') {
    const p = reduce ? 1 : skyClamp((t - s.inDelay) / 2000);
    return { p, k: reduce ? 1 : skyClamp(p * 5), dy: -s.fly * Math.pow(1 - p, 3) };
  }
  if (skyState === 'out') {
    if (skyFast || reduce) {
      const p = skyClamp(t / 350);
      return { p, k: 1 - p, dy: 0 };
    }
    const p = skyClamp((t - s.outDelay) / 1900);
    return { p, k: 1 - skyClamp((p - 0.82) / 0.18), dy: -s.fly * p * p };
  }
  return { p: 1, k: 1, dy: 0 };
}

function drawSky(now) {
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  if (width !== skyWidth) {
    skyWidth = width;
    skyItems = buildStars(width);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = now - skyStart;
  let finished = true;

  ctx.fillStyle = skyInk;
  skyItems.forEach((s) => {
    const { p, k, dy } = skyPose(s, t, reduce);
    if (p < 1) finished = false;
    if (k <= 0) return;
    const twinkle = reduce ? 1 : 0.8 + 0.2 * Math.sin((now / 1000) * s.speed * 2 + s.phase);
    ctx.globalAlpha = s.a * twinkle * k * (1 - 0.85 * (s.y / SKY_HEIGHT));
    ctx.beginPath();
    ctx.arc(s.x, s.y + dy, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  if (!reduce) {
    drawShootingStar(ctx, now, width);
    if (skyState === 'in' || skyState === 'on') showerMeteors.forEach((m) => drawMeteor(ctx, m, now));
    showerMeteors = showerMeteors.filter((m) => now < m.start + m.dur);
  }

  if (skyState === 'in' && finished) skyState = 'on';
  if (skyState === 'out' && finished) {
    skyState = 'off';
    ctx.clearRect(0, 0, width, height);
  }
}

function skyLoop(now) {
  skyFrame = null;
  if (skyState === 'off') return;
  if (now - skyLast >= 33) {
    skyLast = now;
    drawSky(now);
  }
  if (skyState !== 'off') skyFrame = requestAnimationFrame(skyLoop);
}

function setSky(state, fast) {
  skyState = state;
  skyFast = !!fast;
  skyStart = performance.now();
  skyInk = themeColors().ink;
  if (state === 'in') {
    shoot = null;
    nextShootAt = skyStart + SHOOT_FIRST_MS;
  }
  if (skyFrame === null) skyFrame = requestAnimationFrame(skyLoop);
}

// Called on every refresh, and when the theme changes.
function updateSky(fast) {
  if (!document.getElementById('sky')) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const want = dark && (performance.now() < skyForcedUntil || !isMarketOpen());
  if (want && (skyState === 'off' || skyState === 'out')) setSky('in');
  else if (!want && (skyState === 'on' || skyState === 'in')) setSky('out', fast);
}

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
    if (pieState) drawPie(pieState.positions, pieHighlight());
    canvases.forEach((c) => (c.style.opacity = ''));
  };
  clearTimeout(themeRedrawTimer);
  if (animate) themeRedrawTimer = setTimeout(redraw, 170);
  else redraw();
  updateSky(true);
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
// Days the NYSE is closed, with their names, and the two early (1pm) closes, for 2026. Add next year's before
// it starts.
const NYSE_HOLIDAYS = {
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'MLK Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
};
const NYSE_CLOSED = Object.keys(NYSE_HOLIDAYS);
const NYSE_EARLY_CLOSE = { '2026-11-27': 13 * 60, '2026-12-24': 13 * 60 };

function getNYParts(at = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  return {
    weekday: map.weekday,
    date: `${map.year}-${map.month}-${map.day}`,
    hour: parseInt(map.hour, 10) % 24,
    minute: parseInt(map.minute, 10),
  };
}

function isMarketOpen(at = new Date()) {
  const { weekday, date, hour, minute } = getNYParts(at);
  if (weekday === 'Sat' || weekday === 'Sun' || NYSE_CLOSED.includes(date)) return false;
  const minutesNow = hour * 60 + minute;
  return minutesNow >= 9 * 60 + 30 && minutesNow < (NYSE_EARLY_CLOSE[date] || 16 * 60);
}

let statusPeekUntil = 0;
function updateMarketStatus() {
  const text = document.getElementById('marketStatusText');
  const dot = document.getElementById('statusDot');
  if (!text) return;
  const open = isMarketOpen();
  if (performance.now() < statusPeekUntil) {
    if (dot) dot.classList.toggle('open', open);
    return; // the m shortcut is showing the countdown
  }
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
    opened: '2026-10-06',
    buys: [{ qty: 88.03, price: 60.50 }],
    sells: [{ qty: 88.03, price: 72.97 }],
    note: 'A successful 1-day swing trade: the position rose 20.6% for a $1,098 gain after Q4 earnings came in well above the company’s outlook.',
  },
  {
    ticker: 'BRUN',
    status: 'Closed',
    date: '2026-10-06',
    opened: '2026-08-03',
    buys: [{ qty: 923.49, price: 19.88 }],
    sells: [{ qty: 923.49, price: 15.50 }],
  },
  {
    ticker: 'VIAV',
    status: 'Closed',
    date: '2026-10-02',
    opened: '2026-08-14',
    buys: [{ qty: 157.6, price: 43.02 }],
    sells: [{ qty: 157.6, price: 47.21 }],
  },
  {
    ticker: 'BE',
    status: 'Closed',
    date: '2026-09-21',
    opened: '2026-08-25',
    buys: [{ qty: 47.23, price: 213.90 }],
    sells: [{ qty: 47.23, price: 275.79 }],
  },
  {
    ticker: 'SILC',
    status: 'Closed',
    date: '2026-09-21',
    opened: '2026-08-17',
    buys: [{ qty: 130.64, price: 49.81 }],
    sells: [{ qty: 130.64, price: 48.29 }],
  },
  {
    ticker: 'MRVL',
    status: 'Closed',
    date: '2026-09-09',
    opened: '2026-08-28',
    buys: [{ qty: 70, price: 222.50 }],
    sells: [{ qty: 70, price: 232.46 }],
  },
  {
    ticker: 'BE',
    status: 'Trimmed',
    date: '2026-09-09',
    opened: '2026-08-25',
    buys: [{ qty: 30, price: 213.90 }],
    sells: [{ qty: 30, price: 278.14 }],
  },
  {
    ticker: 'NBIS',
    status: 'Trimmed',
    date: '2026-09-09',
    opened: '2026-08-03',
    buys: [{ qty: 50, price: 208.63 }],
    sells: [{ qty: 50, price: 246.28 }],
  },
  {
    ticker: 'CRWD',
    status: 'Closed',
    date: '2026-09-08',
    opened: '2026-08-28',
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
    opened: '2026-08-17',
    buys: [{ qty: 68.35, price: 263.37 }],
    sells: [
      { qty: 68.34, price: 266.57 },
      { qty: 0.01, price: 266.64 },
    ],
  },
  {
    ticker: 'VIAV',
    status: 'Trimmed',
    date: '2026-08-28',
    opened: '2026-08-14',
    buys: [{ qty: 103, price: 43.02 }],
    sells: [{ qty: 103, price: 37.41 }],
  },
  {
    ticker: 'CIEN',
    status: 'Trimmed',
    date: '2026-08-28',
    opened: '2026-08-14',
    buys: [{ qty: 16, price: 429.61 }],
    sells: [{ qty: 16, price: 389.5 }],
  },
  {
    ticker: 'IREN',
    status: 'Closed',
    date: '2026-08-14',
    opened: '2026-08-03',
    buys: [{ qty: 271.73, price: 36.60 }],
    sells: [{ qty: 271.73, price: 44.58 }],
  },
  {
    ticker: 'DRAM',
    status: 'Closed',
    date: '2026-08-14',
    opened: '2026-08-03',
    buys: [{ qty: 158, price: 49.00 }],
    sells: [{ qty: 158, price: 58.02 }],
  },
  {
    ticker: 'MU',
    status: 'Closed',
    date: '2026-08-17',
    opened: '2026-08-03',
    buys: [{ qty: 19.45, price: 783.26 }],
    sells: [{ qty: 19.45, price: 999.60 }],
  },
  {
    ticker: 'MU',
    status: 'Trimmed',
    date: '2026-08-14',
    opened: '2026-08-03',
    buys: [{ qty: 4.85, price: 783.26 }],
    sells: [{ qty: 4.85, price: 975.58 }],
  },
  {
    ticker: 'MRVL',
    status: 'Closed',
    date: '2026-08-25',
    opened: '2026-08-03',
    buys: [{ qty: 55.52, price: 181.30 }],
    sells: [{ qty: 55.52, price: 242.61 }],
  },
  {
    ticker: 'MRVL',
    status: 'Trimmed',
    date: '2026-08-14',
    opened: '2026-08-03',
    buys: [{ qty: 24.45, price: 181.30 }],
    sells: [{ qty: 24.45, price: 222.25 }],
  },
  {
    ticker: 'LITE',
    status: 'Closed',
    date: '2026-08-28',
    opened: '2026-08-03',
    buys: [{ qty: 11.19, price: 687.06 }],
    sells: [{ qty: 11.19, price: 915.07 }],
  },
  {
    ticker: 'LITE',
    status: 'Trimmed',
    date: '2026-08-14',
    opened: '2026-08-03',
    buys: [{ qty: 4.21, price: 687.06 }],
    sells: [{ qty: 4.21, price: 890.00 }],
  },
  {
    ticker: 'AXTI',
    status: 'Closed',
    date: '2026-08-17',
    opened: '2026-08-03',
    buys: [
      { qty: 49.64, price: 57.79 },
      { qty: 10.32, price: 77.66 },
    ],
    sells: [{ qty: 59.96, price: 88.01 }],
  },
  {
    ticker: 'AXTI',
    status: 'Trimmed',
    date: '2026-08-14',
    opened: '2026-08-03',
    buys: [{ qty: 115.84, price: 57.79 }],
    sells: [
      { qty: 69.4, price: 78.25 },
      { qty: 46.44, price: 77.68 },
    ],
  },
  {
    ticker: 'NBIS',
    status: 'Trimmed',
    date: '2026-08-17',
    opened: '2026-08-03',
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

// Every buy on record for the positions still open, including the buys behind trades since closed (sells live
// in CLOSED_POSITIONS). One row per fill (same-day fills at one price are added together): date, Opened or
// Added, shares, price, and an optional comment. The comment is the little bubble: it shows beside the
// position for NOTE_DAYS after its date, and stays in the ticker's history (click its slice in the allocation
// pie) for good. Dates and prices are the exact fills from the TradingView paper trading export of 2026-10-08.
const TRADE_LOG = {
  INTC: [
    { date: '2026-08-17', kind: 'Opened', qty: 176.28, price: 102.16 },
    { date: '2026-08-28', kind: 'Added', qty: 10, price: 91.62 },
  ],
  NBIS: [
    { date: '2026-08-03', kind: 'Opened', qty: 78.77, price: 185.5 },
    { date: '2026-08-28', kind: 'Added', qty: 9, price: 210.98 },
    { date: '2026-09-08', kind: 'Added', qty: 52.57, price: 239.4 },
  ],
  AAOI: [{ date: '2026-09-09', kind: 'Opened', qty: 136.64, price: 111.21 }],
  MU: [
    { date: '2026-08-03', kind: 'Opened', qty: 24.3, price: 783.26 },
    { date: '2026-09-09', kind: 'Opened', qty: 21.48, price: 1011.6 },
    {
      date: '2026-10-07', kind: 'Added', qty: 2.15, price: 1087.0,
      comment: 'Added 2.15 shares ($2,337) ahead of Samsung’s early Q3 figures on Thu 8 Oct, where the tone on memory prices and margins matters most for MU.',
    },
  ],
  CIEN: [{ date: '2026-08-14', kind: 'Opened', qty: 40.42, price: 429.61 }],
  SNDK: [
    { date: '2026-09-21', kind: 'Opened', qty: 5.77, price: 1780.99 },
    { date: '2026-10-06', kind: 'Added', qty: 0.59, price: 1676.5 },
    {
      date: '2026-10-07', kind: 'Added', qty: 2.37, price: 1724.08,
      comment: 'Added 2.37 shares ($4,086) for the same Samsung read on Thu 8 Oct, as memory pricing and margins drive SanDisk too.',
    },
  ],
  META: [{ date: '2026-09-21', kind: 'Opened', qty: 12.06, price: 708.13 }],
  MRVL: [
    { date: '2026-08-03', kind: 'Opened', qty: 79.97, price: 181.3 },
    { date: '2026-08-28', kind: 'Opened', qty: 70, price: 222.5 },
    { date: '2026-10-02', kind: 'Opened', qty: 27.34, price: 272.42 },
  ],
  LITE: [
    { date: '2026-08-03', kind: 'Opened', qty: 15.4, price: 687.06 },
    { date: '2026-10-06', kind: 'Opened', qty: 7.16, price: 1117.08 },
  ],
};

// Every fill on the portfolio, one row each: [date, ticker, 'B' buy or 'S' sell, shares, price]. This is the exact
// export from TradingView paper trading (2026-10-08), minus CBOE:RAM and OMXSTO:SIVE, which the portfolio tracker
// does not cover. The replay rebuilds the portfolio on any date from these. Replaying them in order, with a
// blended average cost, gives exactly the current POSITIONS. Every new trade (buy and sell) gets a row here.
const TRADE_FILLS = [
  ['2026-08-03', 'BRUN', 'B', 548.9, 20],
  ['2026-08-03', 'DRAM', 'B', 158, 49],
  ['2026-08-03', 'AXTI', 'B', 165.48, 57.79],
  ['2026-08-03', 'IREN', 'B', 271.73, 36.6],
  ['2026-08-03', 'LITE', 'B', 15.4, 687.06],
  ['2026-08-03', 'MRVL', 'B', 79.97, 181.3],
  ['2026-08-03', 'NBIS', 'B', 78.77, 185.5],
  ['2026-08-03', 'MU', 'B', 24.3, 783.26],
  ['2026-08-03', 'BRUN', 'B', 144.69, 20.98],
  ['2026-08-03', 'BRUN', 'B', 0.55, 20.99],
  ['2026-08-14', 'AXTI', 'S', 69.4, 78.25],
  ['2026-08-14', 'MU', 'S', 4.85, 975.58],
  ['2026-08-14', 'DRAM', 'S', 158, 58.02],
  ['2026-08-14', 'LITE', 'S', 4.21, 890],
  ['2026-08-14', 'IREN', 'S', 271.73, 44.58],
  ['2026-08-14', 'MRVL', 'S', 24.45, 222.25],
  ['2026-08-14', 'AXTI', 'S', 46.44, 77.68],
  ['2026-08-14', 'CIEN', 'B', 40.42, 429.61],
  ['2026-08-14', 'VIAV', 'B', 260.6, 43.02],
  ['2026-08-14', 'AXTI', 'B', 10.32, 77.66],
  ['2026-08-17', 'MU', 'S', 19.45, 999.6],
  ['2026-08-17', 'AXTI', 'S', 59.96, 88.01],
  ['2026-08-17', 'NBIS', 'S', 7.9, 272.82],
  ['2026-08-17', 'AMZN', 'B', 68.35, 263.37],
  ['2026-08-17', 'INTC', 'B', 176.28, 102.16],
  ['2026-08-17', 'SILC', 'B', 125.64, 49.99],
  ['2026-08-25', 'MRVL', 'S', 55.52, 242.61],
  ['2026-08-25', 'BE', 'B', 63.23, 213.05],
  ['2026-08-28', 'AMZN', 'S', 68.34, 266.57],
  ['2026-08-28', 'AMZN', 'S', 0.01, 266.64],
  ['2026-08-28', 'LITE', 'S', 11.19, 915.07],
  ['2026-08-28', 'CIEN', 'S', 16, 389.5],
  ['2026-08-28', 'VIAV', 'S', 103, 37.41],
  ['2026-08-28', 'INTC', 'B', 10, 91.62],
  ['2026-08-28', 'SILC', 'B', 5, 45.24],
  ['2026-08-28', 'BRUN', 'B', 200, 19.12],
  ['2026-08-28', 'BE', 'B', 14, 217.74],
  ['2026-08-28', 'NBIS', 'B', 9, 210.98],
  ['2026-08-28', 'MRVL', 'B', 70, 222.5],
  ['2026-08-28', 'CRWD', 'B', 60.7, 215.07],
  ['2026-08-28', 'CRWD', 'B', 0.01, 215.05],
  ['2026-09-08', 'CRWD', 'S', 60.72, 207.31],
  ['2026-09-08', 'CRWD', 'B', 0.01, 207.21],
  ['2026-09-08', 'NBIS', 'B', 52.57, 239.4],
  ['2026-09-09', 'MRVL', 'S', 70, 232.46],
  ['2026-09-09', 'NBIS', 'S', 50, 246.28],
  ['2026-09-09', 'BE', 'S', 30, 278.14],
  ['2026-09-09', 'AAOI', 'B', 136.64, 111.21],
  ['2026-09-09', 'MU', 'B', 21.48, 1011.6],
  ['2026-09-21', 'BE', 'S', 47.23, 275.79],
  ['2026-09-21', 'SILC', 'S', 130.64, 48.29],
  ['2026-09-21', 'SNDK', 'B', 5.77, 1780.99],
  ['2026-09-21', 'BRUN', 'B', 29.35, 17.58],
  ['2026-09-21', 'META', 'B', 12.06, 708.13],
  ['2026-10-02', 'VIAV', 'S', 157.6, 47.21],
  ['2026-10-02', 'MRVL', 'B', 27.34, 272.42],
  ['2026-10-06', 'BRUN', 'S', 923.49, 15.5],
  ['2026-10-06', 'LITE', 'B', 7.16, 1117.08],
  ['2026-10-06', 'SNDK', 'B', 0.59, 1676.5],
  ['2026-10-06', 'PENG', 'B', 88.03, 60.5],
  ['2026-10-07', 'PENG', 'S', 88.03, 72.97],
  ['2026-10-07', 'MU', 'B', 2.15, 1087],
  ['2026-10-07', 'SNDK', 'B', 2.37, 1724.08],
];

function activeNote(ticker) {
  const latest = (TRADE_LOG[ticker] || [])
    .filter((t) => t.comment)
    .sort((x, y) => new Date(y.date) - new Date(x.date))[0];
  if (!latest) return null;
  const ageDays = (Date.now() - new Date(`${latest.date}T12:00:00Z`).getTime()) / 86400000;
  if (ageDays > NOTE_DAYS) return null;
  return { text: latest.comment, dateLabel: formatClosedDate(latest.date) };
}

// A note on an open position leads with the date the change was made. A closed position already shows its
// date in the row, so its note doesn't need one.
function buildNote(text, dateLabel, key) {
  const el = document.createElement('div');
  el.className = 'note';
  if (dateLabel) {
    const date = document.createElement('span');
    date.className = 'note-date';
    date.textContent = dateLabel;
    el.appendChild(date);
  }
  el.appendChild(document.createTextNode(text));
  // A bubble with a key waits, invisible, until it has been scrolled into view, then pops. A refresh rebuilds
  // the rows, so a bubble that has already popped (its key is remembered) is just shown.
  if (key && !poppedNotes.has(key)) {
    el.classList.add('note-wait');
    el.dataset.noteKey = key;
    if (noteObserver && notesEnabled) noteObserver.observe(el);
  }
  return el;
}

// The bubbles pop out one at a time, each with its own delay and speed, and only once they are properly on
// screen: they have to be scrolled up from the bottom edge first, so ones below the fold stay hidden until
// you get to them. Bubbles already in view when the page finishes loading pop one after another once the
// load-in is done.
const POP_JITTER_MS = [0, 260, 110, 420, 180];
const POP_DURATIONS_S = [1.1, 0.95, 1.3, 1.05];
const poppedNotes = new Set();
let notesEnabled = false;
let notesReadyAt = 0;
let notePopCount = 0;
const noteObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && notesEnabled && entry.target.classList.contains('note-wait')) {
              noteObserver.unobserve(entry.target);
              popNote(entry.target);
            }
          });
        },
        { threshold: 0.9, rootMargin: '0px 0px -14% 0px' }
      )
    : null;

function popNote(el) {
  if (el.dataset.noteKey) poppedNotes.add(el.dataset.noteKey);
  const i = notePopCount++;
  const lead = Math.max(0, notesReadyAt - performance.now()); // wait for the load-in to finish first
  const delay = lead + (lead > 0 ? (i % 4) * 420 : 0) + POP_JITTER_MS[i % POP_JITTER_MS.length];
  el.style.setProperty('--pop-delay', `${Math.round(delay)}ms`);
  el.style.setProperty('--pop-dur', `${POP_DURATIONS_S[i % POP_DURATIONS_S.length]}s`);
  el.classList.remove('note-wait');
  el.classList.add('note-pop');
}

// Called once the page has loaded in: from now on a bubble may pop as soon as it is in view.
function popNotes(startMs) {
  if (!notesEnabled) {
    notesEnabled = true;
    notesReadyAt = performance.now() + startMs;
  }
  const waiting = [...document.querySelectorAll('.note.note-wait')];
  if (!noteObserver) {
    waiting.forEach(popNote);
    return;
  }
  noteObserver.disconnect(); // watching again makes it report what is in view right now
  waiting.forEach((el) => noteObserver.observe(el));
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
      li.appendChild(buildNote(pos.note, undefined, `closed:${pos.ticker}:${pos.date}`));
    }
    list.appendChild(li);
  });

  renderTrackRecord();
}

// --- Track record ---
// Five figures under Recently Closed, all from CLOSED_POSITIONS (every closed and trimmed entry is one
// realized trade; open positions are not in any of them). Avg hold needs each entry's `opened` date.
function computeTrackRecord() {
  const rows = CLOSED_POSITIONS.map((pos) => {
    const { gainPct, gainUsd } = computeClosedSummary(pos);
    const days = pos.opened ? Math.round((Date.parse(pos.date) - Date.parse(pos.opened)) / 86400000) : null;
    return { pct: gainPct, usd: gainUsd, days };
  });
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const wins = rows.filter((r) => r.pct > 0);
  const losses = rows.filter((r) => r.pct < 0);
  const grossWin = wins.reduce((s, r) => s + r.usd, 0);
  const grossLoss = -losses.reduce((s, r) => s + r.usd, 0);
  return {
    total: rows.length,
    wins: wins.length,
    winRate: rows.length ? (wins.length / rows.length) * 100 : null,
    avgWin: mean(wins.map((r) => r.pct)),
    avgLoss: mean(losses.map((r) => r.pct)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgHold: mean(rows.filter((r) => r.days != null).map((r) => r.days)),
  };
}

function renderTrackRecord() {
  const el = document.getElementById('trackRow');
  if (!el || CLOSED_POSITIONS.length === 0) return;
  const tr = computeTrackRecord();
  const pct = (n, plus) => (n == null ? '\u2014' : `${plus && n > 0 ? '+' : ''}${n.toFixed(1)}%`);
  const cells = [
    { label: 'Win rate', value: tr.winRate == null ? '\u2014' : `${Math.round(tr.winRate)}%`, title: `${tr.wins} of ${tr.total} trades` },
    { label: 'Profit factor', value: tr.profitFactor == null ? '\u2014' : `${tr.profitFactor.toFixed(1)}x`, title: 'Total won divided by total lost, on closed trades' },
    { label: 'Avg win', value: pct(tr.avgWin, true), tone: 'pos' },
    { label: 'Avg loss', value: pct(tr.avgLoss), tone: 'neg' },
    { label: 'Avg hold', value: tr.avgHold == null ? '\u2014' : `${Math.round(tr.avgHold)} days`, title: 'Average days a position was held, from its first buy' },
  ];

  el.innerHTML = '';
  cells.forEach((c) => {
    const cell = document.createElement('div');
    cell.className = 'track-cell';
    if (c.title) cell.title = c.title;
    const label = document.createElement('span');
    label.className = 'track-label';
    label.textContent = c.label;
    const value = document.createElement('span');
    value.className = `track-value ${c.tone || ''}`;
    value.textContent = c.value;
    cell.appendChild(label);
    cell.appendChild(value);
    el.appendChild(cell);
  });
}

// --- Allocation pie chart ---
// Outline-only pie drawn at a tilt, no colors. Slice size is the same entry-based weight as the
// positions list. Each ticker sits inside its slice when it fits; when a slice is too small, a
// leader line points from the slice to the ticker outside the pie.
const PIE_TILT = 0.7; // vertical squash of the circle (smaller = more tilted)
const PIE_DEPTH = 12; // thickness of the pie's edge in px

let pieState = null;
let pieHover = null;
let pieSelected = null; // ticker whose history panel is open
let pieSignature = null;

function layoutPie(positions, width, height, ctx, insideOnly) {
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
      if (insideOnly) {
        // The replay: the ticker sits at one fixed spot in the middle of its slice, so it never hops about. It is
        // invisible until the slice has nearly enough room, fades in as the slice grows until the name fits, and fades
        // out as it shrinks. (The room is how big the label's box could be and still fit in the slice.)
        const x = ux * 0.66 * R;
        const y = uy * 0.66 * R * k;
        if (!fits(s, x, y, hw * 0.5, hh * 0.5)) return { inside: true, hidden: true, align: 'center', tx: x, ty: y };
        let lo = 0.5;
        let hi = 2.4;
        for (let n = 0; n < 8; n++) {
          const mid = (lo + hi) / 2;
          if (fits(s, x, y, hw * mid, hh * mid)) lo = mid;
          else hi = mid;
        }
        // fully visible exactly when the name fits (that is what the real pie shows), starting to show only once it is
        // nearly there, so the names of two small neighbouring slices never overlap
        const room = Math.max(0, Math.min(1, (lo - 0.9) / 0.09));
        return { inside: true, hidden: room <= 0.01, alpha: room * room * (3 - 2 * room), align: 'center', tx: x, ty: y };
      }
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

function drawPie(positions, hoverIndex, insideOnly, fade) {
  const canvas = document.getElementById('pie');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // Resizing the canvas throws its pixels away and reallocates them, so only do it when the size really changed.
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (width < 120 || height < 80) return;

  const layout = layoutPie(positions, width, height, ctx, insideOnly);
  if (!layout) return;
  const { cx, cy, R, k, font, textH, slices, labels } = layout;
  const rimX = (a) => cx + Math.cos(a) * R;
  const rimY = (a) => cy + Math.sin(a) * R * k;
  const dimmed = hoverIndex != null && slices[hoverIndex] != null;
  const { ink, muted } = themeColors();

  // The replay: how visible each slice's name is, and how solid its divider lines are. A slice that is too small to
  // hold its name melts into its neighbour (faint lines) instead of showing as an empty wedge, and gains a name and
  // solid lines together as it grows.
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  let nameDraw = null;
  if (fade) {
    nameDraw = labels.map((l, i) => {
      const key = positions[i].ticker;
      const fits = l.hidden ? 0 : l.alpha == null ? 1 : l.alpha;
      return { key, fits, alpha: fits, x: l.tx, y: l.ty, w: ctx.measureText(key).width };
    });
    // If two names would touch, the one on the smaller slice steps aside until there is room.
    for (let a = 0; a < nameDraw.length; a++) {
      for (let b = a + 1; b < nameDraw.length; b++) {
        const A = nameDraw[a];
        const B = nameDraw[b];
        if (A.alpha < 0.05 || B.alpha < 0.05) continue;
        if (Math.abs(A.x - B.x) - (A.w + B.w) / 2 - 4 < 0 && Math.abs(A.y - B.y) - textH - 3 < 0) {
          if (positions[a].weight < positions[b].weight) A.alpha = 0;
          else B.alpha = 0;
        }
      }
    }
    // Ease everything over time so nothing flicks (fading out is a little quicker than fading in).
    nameDraw.forEach((n) => {
      const ease = (store, target) => {
        const now = store[n.key];
        const rate = target < (now == null ? target : now) ? fade.kDown || fade.k : fade.k;
        const value = now == null ? target : now + (target - now) * rate;
        store[n.key] = value;
        return value;
      };
      n.alpha = ease(fade.state, n.alpha);
      n.fits = ease(fade.room, n.fits);
    });
  }
  const lineAlpha = (i) => (nameDraw && i > 0 ? Math.max(0.1, nameDraw[i].fits) : 1);
  const baseAlpha = dimmed ? 0.45 : 1;

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
  if (!nameDraw) {
    slices.forEach((s) => {
      if (Math.sin(s.start) > 0.02) {
        ctx.moveTo(rimX(s.start), rimY(s.start));
        ctx.lineTo(rimX(s.start), rimY(s.start) + PIE_DEPTH);
      }
    });
  }
  ctx.stroke();
  if (nameDraw) {
    slices.forEach((s, i) => {
      if (Math.sin(s.start) <= 0.02) return;
      ctx.globalAlpha = baseAlpha * lineAlpha(i);
      ctx.beginPath();
      ctx.moveTo(rimX(s.start), rimY(s.start));
      ctx.lineTo(rimX(s.start), rimY(s.start) + PIE_DEPTH);
      ctx.stroke();
    });
    ctx.globalAlpha = baseAlpha;
  }

  // Top face: the outline and one divider per slice.
  ctx.beginPath();
  ctx.ellipse(cx, cy, R, R * k, 0, 0, Math.PI * 2);
  if (slices.length > 1 && !nameDraw) {
    slices.forEach((s) => {
      ctx.moveTo(cx, cy);
      ctx.lineTo(rimX(s.start), rimY(s.start));
    });
  }
  ctx.stroke();
  if (nameDraw && slices.length > 1) {
    slices.forEach((s, i) => {
      ctx.globalAlpha = baseAlpha * lineAlpha(i);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(rimX(s.start), rimY(s.start));
      ctx.stroke();
    });
    ctx.globalAlpha = baseAlpha;
  }

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

  labels.forEach((l, i) => {
    let nameAlpha;
    if (nameDraw) {
      nameAlpha = nameDraw[i].alpha;
      if (nameAlpha < 0.01) return;
    } else {
      if (l.hidden) return;
      nameAlpha = l.alpha == null ? 1 : l.alpha;
    }
    const nameX = l.tx;
    const nameY = l.ty;
    ctx.globalAlpha = (dimmed && i !== hoverIndex ? 0.45 : 1) * nameAlpha;
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
    ctx.fillText(positions[i].ticker, nameX, nameY + textH / 2);
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

// The slice to emphasise: the one under the cursor, else the one whose history is open.
function pieHighlight() {
  if (pieHover != null) return pieHover;
  if (!pieSelected || !pieState) return null;
  const i = pieState.positions.findIndex((p) => p.ticker === pieSelected);
  return i === -1 ? null : i;
}

function setPieHover(index, x, y) {
  if (!pieState || replay) return;
  if (index !== pieHover) {
    pieHover = index;
    drawPie(pieState.positions, pieHighlight());
  }
  const canvas = document.getElementById('pie');
  if (canvas) canvas.style.cursor = index != null ? 'pointer' : '';

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
  if (replay) return; // a replay is drawing the pie
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
  const selected = pieSelected ? positions.findIndex((p) => p.ticker === pieSelected) : -1;
  drawPie(positions, selected === -1 ? null : selected);
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

  // Clicking a slice opens that ticker's trade history under the pie; clicking it again closes it.
  canvas.addEventListener('click', (e) => {
    if (!pieState || replay) return;
    const rect = canvas.getBoundingClientRect();
    const index = pieIndexAt(e.clientX - rect.left, e.clientY - rect.top);
    if (index == null) return;
    const ticker = pieState.positions[index].ticker;
    if (ticker === pieSelected) closeHistory();
    else openHistory(ticker);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pieSelected) closeHistory();
  });
  ['wheel', 'touchstart'].forEach((type) =>
    window.addEventListener(type, () => cancelAnimationFrame(historyScrollFrame), { passive: true })
  );

  // Ticker widths decide what fits inside a slice, so redraw once the web font is in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (pieState) drawPie(pieState.positions, pieHighlight());
    });
  }
}

// --- Ticker history (click a slice in the pie) ---
// Opens under the pie with everything on record for that ticker: each buy and sell with its date, the P&L
// of the sells, and the comments that went with them. Buys come from TRADE_LOG, sells from CLOSED_POSITIONS,
// so there is nothing extra to maintain. The three figures at the top follow the live prices.
let lastPositions = [];
let lastApiEntryValue = null;
let historyEls = null;

const fmtQty = (q) => String(+q.toFixed(2));
const fmtPrice = (p) => '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSignedUsd = (n) => `${n >= 0 ? '+' : ''}${formatCurrency(n)}`;
const fmtSignedPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// The open position's size, backed out of its weight (entry price x quantity over total entry value).
function openPosition(ticker) {
  const p = lastPositions.find((x) => x.ticker === ticker);
  if (!p || !lastApiEntryValue) return null;
  const qty = ((p.weight / 100) * lastApiEntryValue) / p.entryPrice;
  return { p, qty, unrealized: qty * (p.currentPrice - p.entryPrice) };
}

function historyEvents(ticker) {
  const events = [];
  CLOSED_POSITIONS.filter((pos) => pos.ticker === ticker).forEach((pos) => {
    const { soldQty, gainPct, gainUsd } = computeClosedSummary(pos);
    const soldValue = pos.sells.reduce((sum, x) => sum + x.qty * x.price, 0);
    const boughtQty = pos.buys.reduce((sum, x) => sum + x.qty, 0);
    const boughtValue = pos.buys.reduce((sum, x) => sum + x.qty * x.price, 0);
    events.push({
      date: pos.date,
      title: `${pos.status} · ${fmtQty(soldQty)} sh`,
      sub: `sold at ${fmtPrice(soldValue / soldQty)}, bought at ${fmtPrice(boughtValue / boughtQty)}`,
      result: { pct: gainPct, usd: gainUsd },
      comment: pos.note,
    });
  });
  (TRADE_LOG[ticker] || []).forEach((t) => {
    events.push({
      date: t.date,
      title: `${t.kind} · ${fmtQty(t.qty)} sh`,
      sub: t.price == null ? 'sale price not recorded' : `at ${fmtPrice(t.price)} (${formatCurrency(t.qty * t.price)})`,
      comment: t.comment,
    });
  });
  return events.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function historyStat(label) {
  const box = document.createElement('div');
  box.className = 'history-stat';
  const l = document.createElement('span');
  l.className = 'history-stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'history-stat-value';
  box.appendChild(l);
  box.appendChild(v);
  return { box, value: v };
}

function setStat(el, usd) {
  el.textContent = usd == null ? '—' : fmtSignedUsd(usd);
  el.classList.toggle('negative', usd != null && usd < 0);
  el.classList.toggle('none', usd == null);
}

// The three figures, from the live prices. Called on open and on every refresh.
function refreshHistory() {
  if (!historyEls || !pieSelected) return;
  const open = openPosition(pieSelected);
  if (!open) {
    closeHistory();
    return;
  }
  const realized = CLOSED_POSITIONS.filter((pos) => pos.ticker === pieSelected).reduce(
    (sum, pos) => sum + computeClosedSummary(pos).gainUsd,
    0
  );
  const hasRealized = CLOSED_POSITIONS.some((pos) => pos.ticker === pieSelected);
  setStat(historyEls.realized, hasRealized ? realized : null);
  setStat(historyEls.open, open.unrealized);
  setStat(historyEls.net, realized + open.unrealized);
  historyEls.weight.textContent = `${Math.round(open.p.weight)}%`;
  historyEls.holding.textContent = `Holding ${fmtQty(open.qty)} sh at ${fmtPrice(open.p.entryPrice)} · now ${fmtPrice(open.p.currentPrice)}`;
}

function openHistory(ticker) {
  const panel = document.getElementById('tickerHistory');
  const inner = document.getElementById('tickerHistoryInner');
  const open = openPosition(ticker);
  if (!panel || !inner || !open) return;

  pieSelected = ticker;
  inner.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'history-card';

  const head = document.createElement('div');
  head.className = 'history-head';
  const title = document.createElement('div');
  title.className = 'history-title';
  const link = document.createElement('a');
  link.className = 'history-ticker';
  link.href = `https://finance.yahoo.com/quote/${ticker}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = ticker;
  const name = document.createElement('span');
  name.className = 'history-name';
  name.textContent = open.p.name || '';
  title.appendChild(link);
  title.appendChild(name);
  const close = document.createElement('button');
  close.className = 'history-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close history');
  close.textContent = '×';
  close.addEventListener('click', closeHistory);
  const weight = document.createElement('span');
  weight.className = 'history-weight';
  const headRight = document.createElement('span');
  headRight.className = 'history-head-right';
  headRight.appendChild(weight);
  headRight.appendChild(close);
  head.appendChild(title);
  head.appendChild(headRight);

  const holding = document.createElement('div');
  holding.className = 'history-holding';

  const stats = document.createElement('div');
  stats.className = 'history-stats';
  const realized = historyStat('Realized');
  const openStat = historyStat('Open');
  const net = historyStat('Net P&L');
  net.box.classList.add('net');
  [realized, openStat, net].forEach((x) => stats.appendChild(x.box));

  const list = document.createElement('ul');
  list.className = 'history-list';
  const events = historyEvents(ticker);
  events.forEach((ev) => {
    const li = document.createElement('li');
    const date = document.createElement('span');
    date.className = 'history-date';
    date.textContent = formatClosedDate(ev.date);
    const main = document.createElement('span');
    main.className = 'history-main';
    const t = document.createElement('span');
    t.className = 'history-event';
    t.textContent = ev.title;
    const sub = document.createElement('span');
    sub.className = 'history-sub';
    sub.textContent = ev.sub;
    main.appendChild(t);
    main.appendChild(sub);
    li.appendChild(date);
    li.appendChild(main);
    if (ev.result) {
      const res = document.createElement('span');
      res.className = 'history-result';
      res.classList.toggle('negative', ev.result.pct < 0);
      res.innerHTML = `${fmtSignedPct(ev.result.pct)} <span class="closed-usd">(${fmtSignedUsd(ev.result.usd)})</span>`;
      li.appendChild(res);
    }
    if (ev.comment) {
      const bubble = buildNote(ev.comment);
      bubble.classList.add('history-note');
      li.appendChild(bubble);
    }
    list.appendChild(li);
  });
  card.append(head, holding, stats);
  if (events.length > 0) card.appendChild(list);

  inner.appendChild(card);
  [...card.querySelectorAll('.history-head, .history-holding, .history-stats, .history-list > li')].forEach((el, i) => {
    el.style.setProperty('--d', `${120 + i * 50}ms`);
  });
  historyEls = { realized: realized.value, open: openStat.value, net: net.value, holding, weight };
  refreshHistory();

  panel.classList.add('open');
  if (pieState) drawPie(pieState.positions, pieHighlight());
  scrollHistoryIntoView(card);
}

// Brings the whole card into view as it opens. The page grows while the card opens, so the scroll steps
// along with it rather than jumping once to a spot that is not there yet. A manual scroll cancels it.
let historyScrollFrame = null;

function scrollHistoryIntoView(card) {
  const margin = 20;
  const rect = card.getBoundingClientRect();
  const delta = Math.min(rect.bottom - (window.innerHeight - margin), rect.top - margin);
  if (!(delta > 4)) return;
  const from = window.scrollY;
  const to = from + delta;
  cancelAnimationFrame(historyScrollFrame);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo(0, to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 600);
    window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) historyScrollFrame = requestAnimationFrame(step);
  };
  historyScrollFrame = requestAnimationFrame(step);
}

function closeHistory() {
  pieSelected = null;
  historyEls = null;
  const panel = document.getElementById('tickerHistory');
  if (panel) panel.classList.remove('open');
  if (pieState) drawPie(pieState.positions, pieHighlight());
}

// --- Little shortcut quirks ---
// All hidden, none of them scrolls the page except t. Each only changes something for a few seconds.
//   m      the market status shows how long until the market opens or closes
//   t      glides back to the top
//   g      the headline tints sage or rust for a second, by whether today is up or down
//   l      the pie melts like lava and sets again (l again stops it)
//   alpha  the alpha figures pulse     worth  the subtitle whispers     best  the best closed trade is outlined
const QUIRK_WORDS = ['alpha', 'worth', 'best'];
let quirkTyped = '';
let quirkTimer = null;
const quirkReduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function flashClass(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation if it is already running
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// Held, not toggled: the countdown shows while m is down and the status comes back the moment it is released.
function quirkMarket(on) {
  const text = document.getElementById('marketStatusText');
  if (!text) return;
  if (!on) {
    statusPeekUntil = 0;
    updateMarketStatus();
    return;
  }
  const open = isMarketOpen();
  let mins = 0;
  for (let i = 1; i <= 60 * 24 * 6; i++) {
    if (isMarketOpen(new Date(Date.now() + i * 60000)) !== open) {
      mins = i;
      break;
    }
  }
  if (!mins) return;
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const span = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  text.textContent = `${open ? 'Closes' : 'Opens'} in ${span}`;
  statusPeekUntil = Infinity;
}

function quirkTint() {
  const el = document.getElementById('currentValue');
  if (!el) return;
  const today = etDateFormat.format(new Date());
  let base = null;
  for (let i = lastHistory.length - 1; i >= 0; i--) {
    if (etDateFormat.format(new Date(lastHistory[i].t)) !== today) {
      base = lastHistory[i].value;
      break;
    }
  }
  if (base == null || lastCurrentValue == null) return;
  flashClass(el, lastCurrentValue >= base ? 'tint-up' : 'tint-down', 1600);
}

let meltFrame = null;
function quirkMelt() {
  const canvas = document.getElementById('pie');
  const section = document.getElementById('allocation');
  if (!canvas || !section || section.hidden || replay || quirkReduce()) return;
  if (meltFrame) {
    cancelAnimationFrame(meltFrame);
    meltFrame = null;
    canvas.style.filter = '';
    return;
  }
  const t0 = performance.now();
  const total = 4200;
  canvas.style.filter = 'url(#melt)';
  const step = (now) => {
    const p = Math.min(1, (now - t0) / total);
    // Ease in and out. Slow noise pushes every line of the pie around, so the outlines wobble and flow like lava
    // while staying thin. At both ends the push is zero, so the pie never pops.
    const env = Math.sin(Math.PI * p) ** 1.2;
    const tt = now / 1000;
    document.getElementById('meltNoise').setAttribute('baseFrequency', `${(0.009 + 0.003 * Math.sin(tt * 1.3)).toFixed(4)} ${(0.013 + 0.004 * Math.sin(tt * 0.9 + 1)).toFixed(4)}`);
    document.getElementById('meltDisp').setAttribute('scale', (46 * env).toFixed(2));
    if (p < 1) meltFrame = requestAnimationFrame(step);
    else {
      meltFrame = null;
      canvas.style.filter = '';
    }
  };
  meltFrame = requestAnimationFrame(step);
}

function quirkAlpha() {
  document.querySelectorAll('.bench-alpha-val').forEach((el) => flashClass(el, 'pulse', 1400));
}

function quirkWorth() {
  const el = document.querySelector('.subtitle');
  if (!el || el.dataset.whisper) return;
  const original = el.textContent;
  el.dataset.whisper = '1';
  el.classList.add('whisper'); // fades out
  setTimeout(() => {
    el.textContent = 'Worth knowing.';
    el.classList.remove('whisper'); // fades the new line in
  }, 400);
  setTimeout(() => el.classList.add('whisper'), 2200);
  setTimeout(() => {
    el.textContent = original;
    el.classList.remove('whisper');
    delete el.dataset.whisper;
  }, 2600);
}

function quirkBest() {
  let best = null;
  let bestPct = -Infinity;
  document.querySelectorAll('#closedPositions li').forEach((li) => {
    const m = /([+-]?\d+(?:\.\d+)?)%/.exec((li.querySelector('.closed-change') || {}).textContent || '');
    if (m && parseFloat(m[1]) > bestPct) {
      bestPct = parseFloat(m[1]);
      best = li;
    }
  });
  if (best) flashClass(best.querySelector('.closed-change'), 'pulse', 1400);
}

// Returns true when the key belongs to a word being typed, so single-key shortcuts such as r, t and p stay quiet
// while someone types "worth", "best" or "alpha".
function quirkWordTyping(key) {
  if (!/^[a-z]$/.test(key)) {
    quirkTyped = '';
    return false;
  }
  clearTimeout(quirkTimer);
  quirkTimer = setTimeout(() => (quirkTyped = ''), 1500);
  quirkTyped = (quirkTyped + key).slice(-5);
  for (const word of QUIRK_WORDS) {
    if (quirkTyped.endsWith(word)) {
      quirkTyped = '';
      ({ alpha: quirkAlpha, worth: quirkWorth, best: quirkBest })[word]();
      return true;
    }
  }
  return QUIRK_WORDS.some((word) => {
    for (let n = Math.min(word.length - 1, quirkTyped.length); n >= 2; n--) {
      if (quirkTyped.endsWith(word.slice(0, n))) return true;
    }
    return false;
  });
}

document.addEventListener('keyup', (e) => {
  if (e.key === 'm' || e.key === 'M') quirkMarket(false);
});
window.addEventListener('blur', () => quirkMarket(false));

// --- Hidden keyboard shortcuts ---
// No hint anywhere on the page. None of them scrolls the page or jumps anywhere.
//   d          switch dark and light
//   r          replay the portfolio (again, or Esc, stops it)
//   m t g l    and the words alpha, worth, best: see "Little shortcut quirks" above
//   up up down down left right left right a i   the Konami code: a meteor shower (dark mode only)
// The arrow keys do nothing else, so they keep scrolling the page as normal.
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

  const typed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.repeat && konamiAt > 0) return; // a held key must not break the code
  if (typed === KONAMI[konamiAt]) {
    konamiAt++;
    if (konamiAt === KONAMI.length) {
      konamiAt = 0;
      startShower();
      return;
    }
  } else {
    konamiAt = typed === KONAMI[0] ? 1 : 0;
  }

  if (e.repeat) return;
  if (quirkWordTyping(typed)) return;
  if (typed === 'm') quirkMarket(true);
  else if (typed === 't') scrollPageTo(0);
  else if (typed === 'g') quirkTint();
  else if (typed === 'l') quirkMelt();

  if (e.key === 'd' || e.key === 'D') {
    if (e.repeat) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(dark ? 'light' : 'dark', true);
  } else if (e.key === 'r' || e.key === 'R') {
    if (e.repeat) return;
    toggleReplay();
  } else if (e.key === 'Escape') {
    stopReplay();
  }
});

// Used by the replay and the market clock. (The daily returns calendar was removed on 2026-10-08, see CLAUDE.md.)
const etDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

// --- Replay ---
// Press r and the pie goes back in time and plays the portfolio forward to today.
//  1. A date at the top left ticks back from today to Aug 1, fast and slowing to land on it, while the pie slips
//     back to its first positions.
//  2. It holds on Aug 1 for a moment, then the pie sets off and the date counts forward alongside it.
//  3. The pie then moves at one constant pace through every trade up to today: always the same size, only its
//     proportions change, never a pause on a trading day.
//  4. At the end the date carries on to today, rests for a moment, and fades out.
// Built from TRADE_FILLS with the same entry-cost weights the pie normally shows, so the last frame is the real pie.
const REPLAY_BACK_MS = 4200; // the date ticking back, and the pie slowly slipping back to its first positions
const REPLAY_HOLD_MS = 1500; // holding on Aug 1
const REPLAY_PLAY_MS = 42000; // the slow, constant journey forward
const REPLAY_END_MS = 3000; // today's date fading in and out
const REPLAY_START_DATE = '2026-08-01';
let replay = null;

function replaySteps() {
  const dates = [...new Set(TRADE_FILLS.map((f) => f[0]))].sort();
  const hold = {};
  return dates.map((date) => {
    TRADE_FILLS.filter((f) => f[0] === date).forEach(([, ticker, side, qty, price]) => {
      const h = hold[ticker] || (hold[ticker] = { qty: 0, cost: 0 });
      if (side === 'B') {
        h.qty += qty;
        h.cost += qty * price;
      } else {
        const avg = h.cost / h.qty;
        h.qty -= qty;
        h.cost = h.qty * avg;
      }
    });
    const total = Object.values(hold).reduce((sum, h) => sum + (h.qty > 0.005 ? h.cost : 0), 0);
    const weights = {};
    Object.entries(hold).forEach(([ticker, h]) => {
      if (h.qty > 0.005) weights[ticker] = (h.cost / total) * 100;
    });
    return { date, weights };
  });
}

// Slices keep the order the real pie has, so nothing jumps when the replay ends: today's holdings first, in
// today's order, then the ones that were closed along the way.
function replayOrder(steps) {
  const order = lastPositions.map((p) => p.ticker);
  steps.forEach((s) => Object.keys(s.weights).forEach((t) => order.includes(t) || order.push(t)));
  return order;
}

// A smooth curve through one slice's size on each trading day (a monotone cubic, so it never swings below zero or
// overshoots).
function replayCurve(ys) {
  const n = ys.length;
  const d = ys.slice(1).map((y, i) => y - ys[i]);
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    m[k] = d[k - 1] * d[k] <= 0 ? 0 : (2 * d[k - 1] * d[k]) / (d[k - 1] + d[k]);
  }
  return (x) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(x)));
    const u = x - i;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * m[i + 1]
    );
  };
}

// Speeding up and slowing down at the two ends only: 0..1 in, 0..1 out, constant speed in between.
function replayPace(u, a) {
  const v = 1 / (1 - a);
  if (u < a) return (v * u * u) / (2 * a);
  if (u > 1 - a) return 1 - (v * (1 - u) * (1 - u)) / (2 * a);
  return v * (u - a / 2);
}

const replayEase = (p) => p * p * (3 - 2 * p); // gentle: half the peak speed of a cubic ease
const replayClamp = (v) => Math.max(0, Math.min(1, v));

function replayPositions(weightsAt, order) {
  // Slices keep their place for the whole replay (today's order, then the ones that were closed), so a name stays on
  // its own slice and never has to move to another one.
  return order.map((ticker) => ({ ticker, weight: Math.max(0, weightsAt(ticker)) })).filter((p) => p.weight > 0.0005);
}

// The pie moves at a constant pace measured in what the eye follows: how fast the slice edges sweep round the pie
// (not in trading days, and not in how much each slice's size changes, because a change in a big slice at the front
// moves every edge behind it). This maps "how far along the journey" (0..1) to a position on the trading-day curves.
// The lookup interpolates between its samples: snapping to the nearest one made the pie stand still for a frame or two
// and then lurch, which looked like speeding up and slowing down.
function replayEdges(weights) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let run = 0;
  return weights.map((w) => (run += (w / total) * 100));
}

function replayPath(curves, last) {
  const SAMPLES = 3000;
  const cum = [0];
  let prev = null;
  for (let i = 0; i <= SAMPLES; i++) {
    const x = (i / SAMPLES) * last;
    const edges = replayEdges(curves.map((c) => Math.max(0, c.at(x))));
    if (prev) cum.push(cum[cum.length - 1] + edges.reduce((acc, e, j) => acc + Math.abs(e - prev[j]), 0));
    prev = edges;
  }
  const length = cum[cum.length - 1];
  return {
    length,
    xAt(fraction) {
      const target = Math.max(0, Math.min(1, fraction)) * length;
      let lo = 0;
      let hi = SAMPLES;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return 0;
      const span = cum[lo] - cum[lo - 1] || 1;
      return ((lo - 1 + (target - cum[lo - 1]) / span) / SAMPLES) * last;
    },
  };
}

const replayDayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function startReplay() {
  const section = document.getElementById('allocation');
  const wrap = document.querySelector('.pie-wrap');
  if (replay || !section || section.hidden || !wrap || lastPositions.length === 0) return;
  closeHistory();
  const steps = replaySteps();
  const order = replayOrder(steps);
  const curves = order.map((ticker) => ({ ticker, at: replayCurve(steps.map((st) => st.weights[ticker] || 0)) }));
  const last = steps.length - 1;
  const today = steps[last].weights;
  const first = steps[0].weights;
  const utcMs = (str) => new Date(`${str}T12:00:00Z`).getTime();
  // Where each trading day sits on the journey, so the date can count forward with the pie. The first stretch
  // carries the date from Aug 1 on to the first trades on Aug 3.
  const dateKeys = [
    { x: 0, ms: utcMs(REPLAY_START_DATE) },
    { x: 0.12, ms: utcMs(steps[0].date) },
    ...steps.slice(1).map((st, i) => ({ x: i + 1, ms: utcMs(st.date) })),
  ];

  const hud = document.createElement('div');
  hud.className = 'replay-date';
  wrap.appendChild(hud);


  const utc = (str) => new Date(`${str}T12:00:00Z`).getTime();
  replay = {
    hud,
    order,
    curves,
    today,
    first,
    last,
    path: replayPath(curves, last),
    todayMs: utc(etDateFormat.format(new Date())),
    startMs: utc(REPLAY_START_DATE),
    dateKeys,
    lastMs: utcMs(steps[last].date),
    start: performance.now() + 400,
    frame: null,
    text: '',
    fade: { state: {}, room: {}, k: 1, kDown: 1, dt: 16 },
    lastNow: null,
  };
  pieHover = null;
  const tooltip = document.getElementById('pieTooltip');
  if (tooltip) tooltip.style.opacity = '0';
  replay.frame = requestAnimationFrame(replayLoop);
}

// Everything on screen at time t (ms since the replay began): the pie's weights, and the date with its opacity and blur.
function replayState(t) {
  const R = replay;
  const total = REPLAY_BACK_MS + REPLAY_HOLD_MS + REPLAY_PLAY_MS + REPLAY_END_MS;
  let weights;
  let date = { text: '', opacity: 0, blur: 0 };

  if (t < REPLAY_BACK_MS) {
    // going back: the date ticks back fast and slows to land on Aug 1, the pie slips back with it
    const p = replayClamp(t / REPLAY_BACK_MS);
    const ease = 1 - Math.pow(1 - p, 3);
    // Slices that are not in the first portfolio shrink away first, the new ones grow in a little later (the two
    // overlap, so it never pauses), and the rest adjust throughout. That keeps the number of half-grown slivers low.
    weights = (ticker) => {
      const a = R.today[ticker] || 0;
      const b = R.first[ticker] || 0;
      const w = a && !b ? replayClamp(p / 0.6) : !a && b ? replayClamp((p - 0.4) / 0.6) : p;
      return a + (b - a) * replayEase(w);
    };
    date = {
      text: replayDayLabel(R.todayMs - (R.todayMs - R.startMs) * ease),
      opacity: replayClamp(p / 0.1),
      blur: 2.4 * Math.pow(1 - p, 2),
    };
  } else if (t < REPLAY_BACK_MS + REPLAY_HOLD_MS) {
    weights = (ticker) => R.first[ticker] || 0;
    date = { text: replayDayLabel(R.startMs), opacity: 1, blur: 0 };
  } else if (t < REPLAY_BACK_MS + REPLAY_HOLD_MS + REPLAY_PLAY_MS) {
    // the journey forward: one constant pace, with the date counting forward alongside it
    const u = (t - REPLAY_BACK_MS - REPLAY_HOLD_MS) / REPLAY_PLAY_MS;
    const x = R.path.xAt(replayPace(u, 0.025));
    weights = (ticker) => R.curves.find((c) => c.ticker === ticker).at(x);
    const keys = R.dateKeys;
    let k = 0;
    while (k < keys.length - 2 && x > keys[k + 1].x) k++;
    const span = keys[k + 1].x - keys[k].x || 1;
    const ms = keys[k].ms + (keys[k + 1].ms - keys[k].ms) * replayClamp((x - keys[k].x) / span);
    date = { text: replayDayLabel(ms), opacity: 1, blur: 0 };
  } else {
    // arrived: the date carries on to today, rests for a moment, and fades out
    const e = (t - REPLAY_BACK_MS - REPLAY_HOLD_MS - REPLAY_PLAY_MS) / REPLAY_END_MS;
    weights = (ticker) => R.today[ticker] || 0;
    date = {
      text: replayDayLabel(R.lastMs + (R.todayMs - R.lastMs) * replayClamp(e / 0.25)),
      opacity: replayClamp((1 - e) / 0.3),
      blur: 0,
    };
  }
  return { weights, date, done: t >= total };
}

function replayLoop(now) {
  if (!replay) return;
  const t = Math.max(0, now - replay.start);
  const state = replayState(t);
  if (state.done) {
    stopReplay();
    return;
  }
  const dt = replay.lastNow == null ? 16 : Math.min(100, now - replay.lastNow);
  replay.lastNow = now;
  replay.fade.k = 1 - Math.exp(-dt / 350);
  replay.fade.dt = dt;
  replay.fade.kDown = 1 - Math.exp(-dt / 120);
  drawPie(replayPositions(state.weights, replay.order), null, true, replay.fade);
  const hud = replay.hud;
  if (replay.text !== state.date.text) {
    replay.text = state.date.text;
    hud.textContent = state.date.text;
  }
  hud.style.opacity = state.date.opacity.toFixed(3);
  hud.style.filter = state.date.blur > 0.05 ? `blur(${state.date.blur.toFixed(2)}px)` : 'none';
  replay.frame = requestAnimationFrame(replayLoop);
}

function stopReplay() {
  if (!replay) return;
  cancelAnimationFrame(replay.frame);
  replay.hud.remove();
  replay = null;
  pieSignature = null; // draw the real pie again
  if (lastPositions.length) renderPie(lastPositions);
}

function toggleReplay() {
  if (replay) stopReplay();
  else startReplay();
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
    // If the rows are already showing, keep the last ones rather than collapsing the section for a refresh.
    if (benchKey === null) section.hidden = true;
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

// True once a refresh has put real numbers on the page. After that, a failed refresh leaves them alone:
// swapping the headline for an error message changes the page's height above the reader and drags their
// scroll position with it.
let hasLoaded = false;

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
        li.appendChild(buildNote(note.text, note.dateLabel, `pos:${p.ticker}:${note.dateLabel}`));
      }
      list.appendChild(li);
    });

    lastPositions = data.positions;
    lastApiEntryValue = data.entryValue;
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
      refreshHistory();
    } catch (histErr) {
      console.error(histErr);
    }

    try {
      renderBenchmarks(data);
    } catch (benchErr) {
      console.error(benchErr);
    }

    document.getElementById('updated').textContent =
      'Updated ' + new Date(data.updatedAt).toLocaleString();
    if (dataRevealed) popNotes(300); // bubbles that only turned up after the page was already revealed
    hasLoaded = true;
  } catch (err) {
    if (!hasLoaded) valueEl.textContent = 'Unable to load prices';
    console.error(err);
  }
}

async function tick() {
  await init();
  updateMarketStatus();
  updateSky(false);
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

// The refresh above only looks every 20 seconds, so this checks the market clock every second: the status label
// and the stars change on the exact second the market opens or closes. (There is no bell, by Valerio's choice.)
let lastMarketOpen = isMarketOpen();

setInterval(() => {
  const open = isMarketOpen();
  if (open === lastMarketOpen) return;
  lastMarketOpen = open;
  updateMarketStatus();
  updateSky(false);
}, 1000);
