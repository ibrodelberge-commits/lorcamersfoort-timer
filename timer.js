/* timer.js — Winterspell Championship Timer
   Merged settings persistence + snow system + timer logic
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════════
     SECTION A — Config persistence (was settings.js)
     ════════════════════════════════════════════════════════════════════ */
  const STORAGE_KEY = 'lorcamersfoort-timer-config';

  const DEFAULTS = {
    eventName:    'Set Championship',
    theme:        'winterspell',
    mode:         'judge',
    format:       'swiss-top8',
    swissRounds:  5,
    topCutFormat: 'bo3',
    swissTime:    50,
    topCutTime:   60,
  };

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (_) { /* corrupt storage */ }
    return Object.assign({}, DEFAULTS);
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) { /* unavailable */ }
  }

  window.LTConfig = loadConfig();

  /* ════════════════════════════════════════════════════════════════════
     SECTION B — Snow system
     ════════════════════════════════════════════════════════════════════ */
  const canvas  = document.getElementById('snow-canvas');
  const snowCtx = canvas.getContext('2d');

  /* Resize canvas to match viewport */
  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  /* Intensity settings: 0=calm, 1=normal, 2=warning, 3=blizzard */
  const INTENSITY = [
    { count: 80,  speedMult: 0.55, alphaMult: 0.55 }, /* 0 calm   */
    { count: 130, speedMult: 1.0,  alphaMult: 0.80 }, /* 1 normal */
    { count: 190, speedMult: 1.45, alphaMult: 0.95 }, /* 2 warning*/
    { count: 280, speedMult: 2.2,  alphaMult: 1.0  }, /* 3 blizzard*/
  ];

  let snowLevel       = 1; /* current target intensity level */
  let activeSnowLevel = 1; /* smoothly interpolated */
  let burstDecay      = 0; /* for blizzard burst lerp back */

  /* Snowflake pool — over-allocated to cover blizzard peaks */
  const POOL_SIZE = 300;
  const flakes    = [];

  function randBetween(a, b) { return a + Math.random() * (b - a); }

  /* 4 crystal drawing styles */
  function drawCrystal(ctx, x, y, r, alpha, type) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    switch (type) {
      case 0: /* simple 6-pointed star */
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (i * Math.PI) / 3;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        }
        ctx.strokeStyle = '#b8d9f5';
        ctx.lineWidth   = Math.max(0.6, r * 0.18);
        ctx.stroke();
        /* centre dot */
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = '#d8eeff';
        ctx.fill();
        break;

      case 1: /* barbed 6-point crystal */
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (i * Math.PI) / 3;
          const blen = r * 0.45;
          const bang  = Math.PI / 8;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
          /* barbs */
          const mid = r * 0.62;
          ctx.moveTo(Math.cos(ang) * mid, Math.sin(ang) * mid);
          ctx.lineTo(
            Math.cos(ang) * mid + Math.cos(ang + bang) * blen,
            Math.sin(ang) * mid + Math.sin(ang + bang) * blen
          );
          ctx.moveTo(Math.cos(ang) * mid, Math.sin(ang) * mid);
          ctx.lineTo(
            Math.cos(ang) * mid + Math.cos(ang - bang) * blen,
            Math.sin(ang) * mid + Math.sin(ang - bang) * blen
          );
        }
        ctx.strokeStyle = '#9ecff0';
        ctx.lineWidth   = Math.max(0.5, r * 0.14);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = '#c8e8ff';
        ctx.fill();
        break;

      case 2: /* simple dot / rounded flake */
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
        grad.addColorStop(0,   'rgba(230,244,255,0.95)');
        grad.addColorStop(0.6, 'rgba(180,218,248,0.65)');
        grad.addColorStop(1,   'rgba(90,160,220,0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
        break;

      case 3: /* tiny hex plate */
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (i * Math.PI) / 3 - Math.PI / 6;
          const px  = Math.cos(ang) * r;
          const py  = Math.sin(ang) * r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(184,217,245,0.75)';
        ctx.lineWidth   = Math.max(0.5, r * 0.12);
        ctx.stroke();
        /* cross lines */
        for (let i = 0; i < 3; i++) {
          const ang = (i * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
          ctx.lineTo(Math.cos(ang + Math.PI) * r, Math.sin(ang + Math.PI) * r);
          ctx.stroke();
        }
        break;
    }
    ctx.restore();
  }

  function makeFlake(i) {
    return {
      x:       randBetween(0, canvas.width),
      y:       randBetween(-canvas.height, canvas.height * 0.2),
      r:       randBetween(2, 7),
      vy:      randBetween(0.22, 0.85),
      vx:      randBetween(-0.3, 0.3),
      alpha:   randBetween(0.35, 0.90),
      wobble:  randBetween(0, Math.PI * 2),
      wobbleSpeed: randBetween(0.008, 0.025),
      type:    Math.floor(Math.random() * 4),
      active:  i < INTENSITY[1].count,
    };
  }

  for (let i = 0; i < POOL_SIZE; i++) flakes.push(makeFlake(i));

  let lastSnowTime = 0;

  function tickSnow(timestamp) {
    const dt = Math.min(timestamp - lastSnowTime, 50); /* cap delta for tab blur */
    lastSnowTime = timestamp;

    /* Smoothly approach target active count */
    const targetCount = INTENSITY[snowLevel].count;
    const speedMult   = INTENSITY[snowLevel].speedMult;
    const alphaMult   = INTENSITY[snowLevel].alphaMult;
    const wind        = Math.sin(timestamp / 9000) * 0.35;

    const w = canvas.width;
    const h = canvas.height;

    snowCtx.clearRect(0, 0, w, h);

    let active = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const f = flakes[i];

      /* activate / deactivate based on target count */
      if (active < targetCount && !f.active) {
        /* re-spawn at top edge */
        f.x      = randBetween(0, w);
        f.y      = randBetween(-30, -5);
        f.active = true;
      }
      if (!f.active) continue;

      f.wobble += f.wobbleSpeed * dt * 0.06;
      f.y += f.vy * speedMult * (dt / 16);
      f.x += (f.vx + wind + Math.sin(f.wobble) * 0.18) * speedMult * (dt / 16);

      /* wrap horizontal */
      if (f.x < -10)  f.x = w + 10;
      if (f.x > w+10) f.x = -10;

      /* recycle when off bottom */
      if (f.y > h + 10) {
        if (active >= targetCount) {
          f.active = false;
        } else {
          f.x = randBetween(0, w);
          f.y = randBetween(-30, -5);
        }
      }

      drawCrystal(snowCtx, f.x, f.y, f.r, Math.min(f.alpha * alphaMult, 0.92), f.type);
      active++;
    }

    requestAnimationFrame(tickSnow);
  }
  requestAnimationFrame(tickSnow);

  function setSnowIntensity(level) {
    snowLevel = Math.max(0, Math.min(3, level));
  }

  function blizzardBurst() {
    setSnowIntensity(3);
    /* lerp back to driven level after 2.5 s */
    setTimeout(() => {
      setSnowIntensity(Math.max(snowLevel, 2));
      setTimeout(() => setSnowIntensity(Math.max(snowLevel, 1)), 1500);
    }, 2500);
  }

  /* ════════════════════════════════════════════════════════════════════
     SECTION C — SVG tick-mark generation
     ════════════════════════════════════════════════════════════════════ */
  function buildBezelTicks() {
    const g = document.getElementById('tick-marks');
    if (!g) return;
    const cx = 200, cy = 200, r = 188;
    const COUNT = 60; /* one tick per minute */

    for (let i = 0; i < COUNT; i++) {
      const ang      = (i / COUNT) * 2 * Math.PI - Math.PI / 2;
      const isHour   = i % 5 === 0;   /* 12 clock-hour positions */
      const isTwelve = i === 0;

      /* 12 o'clock: long gold tick. Hour marks: medium ice. Minutes: very faint */
      const len    = isTwelve ? 22 : isHour ? 13 : 6;
      const stroke = isTwelve ? 'rgba(201,168,76,0.95)'
                   : isHour   ? 'rgba(184,217,245,0.60)'
                   :            'rgba(130,180,220,0.18)';
      const width  = isTwelve ? 3.0 : isHour ? 1.8 : 0.8;

      const x1 = cx + Math.cos(ang) * (r - 1);
      const y1 = cy + Math.sin(ang) * (r - 1);
      const x2 = cx + Math.cos(ang) * (r - len - 1);
      const y2 = cy + Math.sin(ang) * (r - len - 1);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toFixed(2));
      line.setAttribute('y1', y1.toFixed(2));
      line.setAttribute('x2', x2.toFixed(2));
      line.setAttribute('y2', y2.toFixed(2));
      line.setAttribute('stroke', stroke);
      line.setAttribute('stroke-width', String(width));
      line.setAttribute('stroke-linecap', 'round');
      g.appendChild(line);

      /* Small ice-blue dot at each hour position (except 12) */
      if (isHour && !isTwelve) {
        const dotDist = r - len - 6;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', (cx + Math.cos(ang) * dotDist).toFixed(2));
        dot.setAttribute('cy', (cy + Math.sin(ang) * dotDist).toFixed(2));
        dot.setAttribute('r', '2.2');
        dot.setAttribute('fill', 'rgba(184,217,245,0.45)');
        g.appendChild(dot);
      }
    }

    /* 12-o'clock crown: upward-pointing gold diamond — uniquely clock-like */
    const ns = 'http://www.w3.org/2000/svg';
    const crown = document.createElementNS(ns, 'polygon');
    crown.setAttribute('points', '200,3 204.5,13 200,10.5 195.5,13');
    crown.setAttribute('fill', '#c9a84c');
    crown.setAttribute('opacity', '0.95');
    g.appendChild(crown);

    /* Tiny gold glow circle at 12 behind the crown */
    const glow = document.createElementNS(ns, 'circle');
    glow.setAttribute('cx', '200');
    glow.setAttribute('cy', '9');
    glow.setAttribute('r', '5');
    glow.setAttribute('fill', 'rgba(201,168,76,0.18)');
    g.insertBefore(glow, crown);
  }
  buildBezelTicks();

  /* ════════════════════════════════════════════════════════════════════
     SECTION D — Settings panel (was settings.js)
     ════════════════════════════════════════════════════════════════════ */
  const settingsPanel   = document.getElementById('settings-panel');
  const settingsOverlay = document.getElementById('settings-overlay');
  const btnSettingsOpen = document.getElementById('btn-settings');
  const btnSettingsClose= document.getElementById('settings-close');
  const btnSettingsCancel = document.getElementById('settings-cancel');
  const btnSettingsApply  = document.getElementById('settings-apply');

  const sEventName   = document.getElementById('s-event-name');
  const sTheme       = document.getElementById('s-theme');
  const sMode        = document.getElementById('s-mode');
  const sFormat      = document.getElementById('s-format');
  const sSwissRounds = document.getElementById('s-swiss-rounds');
  const sTopCutFmt   = document.getElementById('s-topcut-format');
  const sSwissTime   = document.getElementById('s-swiss-time');
  const sTopCutTime  = document.getElementById('s-topcut-time');

  function openSettings() {
    const c = window.LTConfig;
    sEventName.value   = c.eventName;
    sTheme.value       = c.theme;
    sMode.value        = c.mode;
    sFormat.value      = c.format;
    sSwissRounds.value = String(c.swissRounds);
    sTopCutFmt.value   = c.topCutFormat;
    sSwissTime.value   = String(c.swissTime);
    sTopCutTime.value  = String(c.topCutTime);

    settingsPanel.classList.remove('hidden');
    settingsOverlay.classList.remove('hidden');
    settingsPanel.setAttribute('aria-hidden', 'false');
    sEventName.focus();
  }

  function closeSettings() {
    settingsPanel.classList.add('hidden');
    settingsOverlay.classList.add('hidden');
    settingsPanel.setAttribute('aria-hidden', 'true');
  }

  function clampInt(raw, min, max, fallback) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function applySettingsUI() {
    const newConfig = {
      eventName:    (sEventName.value.trim() || DEFAULTS.eventName).slice(0, 60),
      theme:        ['winterspell', 'generic'].includes(sTheme.value)       ? sTheme.value       : DEFAULTS.theme,
      mode:         ['judge', 'spectator'].includes(sMode.value)            ? sMode.value        : DEFAULTS.mode,
      format:       ['swiss','swiss-top8','swiss-top4'].includes(sFormat.value) ? sFormat.value  : DEFAULTS.format,
      swissRounds:  clampInt(sSwissRounds.value, 1, 10,  DEFAULTS.swissRounds),
      topCutFormat: ['bo3', 'bo1'].includes(sTopCutFmt.value)               ? sTopCutFmt.value   : DEFAULTS.topCutFormat,
      swissTime:    clampInt(sSwissTime.value,   1, 120, DEFAULTS.swissTime),
      topCutTime:   clampInt(sTopCutTime.value,  1, 120, DEFAULTS.topCutTime),
    };

    window.LTConfig = newConfig;
    saveConfig(newConfig);
    if (typeof window.applyConfig === 'function') window.applyConfig();
    closeSettings();
  }

  btnSettingsOpen.addEventListener('click', openSettings);
  btnSettingsClose.addEventListener('click', closeSettings);
  btnSettingsCancel.addEventListener('click', closeSettings);
  btnSettingsApply.addEventListener('click', applySettingsUI);
  settingsOverlay.addEventListener('click', closeSettings);

  settingsPanel.addEventListener('keydown', function (e) {
    if (e.code === 'Escape') { e.stopPropagation(); closeSettings(); }
    if (e.code === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      applySettingsUI();
    }
  });

  window.openSettings = openSettings;

  /* ════════════════════════════════════════════════════════════════════
     SECTION E — Ink icons & schedule helpers
     ════════════════════════════════════════════════════════════════════ */
  const INK_ICONS = [
    'Assets/DisneyLorcana/Generic/Ink Icons In Frames/RGB/COLOR_AMBER_RGB.png',
    'Assets/DisneyLorcana/Generic/Ink Icons In Frames/RGB/COLOR_AMETHYST_RGB.png',
    'Assets/DisneyLorcana/Generic/Ink Icons In Frames/RGB/COLOR_EMERALD_RGB.png',
    'Assets/DisneyLorcana/Generic/Ink Icons In Frames/RGB/COLOR_RUBY_RGB.png',
    'Assets/DisneyLorcana/Generic/Ink Icons In Frames/RGB/COLOR_SAPPHIRE_RGB.png',
    'Assets/DisneyLorcana/Generic/Ink Icons In Frames/RGB/COLOR_STEEL_RGB.png',
  ];

  function cfg() { return window.LTConfig; }

  function isTopCutRound() {
    const c = cfg();
    if (c.format === 'swiss') return false;
    return currentRound > c.swissRounds;
  }

  function getRoundDuration() {
    return isTopCutRound()
      ? cfg().topCutTime * 60
      : cfg().swissTime  * 60;
  }

  function getMaxRound() {
    const c = cfg();
    if (c.format === 'swiss')       return c.swissRounds;
    if (c.format === 'swiss-top8')  return c.swissRounds + 3;
    if (c.format === 'swiss-top4')  return c.swissRounds + 2;
    return c.swissRounds;
  }

  function getRoundInfo() {
    const c = cfg();
    if (!isTopCutRound()) {
      return { number: String(currentRound), type: 'Swiss' };
    }
    const boLabel  = c.topCutFormat === 'bo3' ? 'Best of 3' : 'Best of 1';
    const cutIndex = currentRound - c.swissRounds - 1;
    const cutNames = c.format === 'swiss-top8'
      ? ['Quarter-Final', 'Semi-Final', 'Final']
      : ['Semi-Final', 'Final'];
    const name     = cutNames[cutIndex] || ('Top Cut R' + (cutIndex + 1));
    const topLabel = c.format === 'swiss-top8' ? 'Top 8' : 'Top 4';
    return { number: name, type: topLabel + ' · ' + boLabel };
  }

  /* ════════════════════════════════════════════════════════════════════
     SECTION F — Timer state
     ════════════════════════════════════════════════════════════════════ */
  let totalSeconds     = 0;
  let remainingSeconds = 0;
  let intervalId       = null;
  let currentRound     = 1;
  let warningFired     = false;
  let extraTurnsLeft   = 0;

  /* DOM refs */
  const body              = document.body;
  const timeDisplay       = document.getElementById('time-display');
  const statusText        = document.getElementById('status-text');
  const roundNumber       = document.getElementById('round-number');
  const roundTypeLabel    = document.getElementById('round-type-label');
  const roundInkIcon      = document.getElementById('round-ink-icon');
  const eventNameEl       = document.getElementById('event-name-display');
  const turnsLeftEl       = document.getElementById('turns-left');
  const extraTurnsOverlay = document.getElementById('extra-turns-overlay');
  const depletionArc      = document.getElementById('depletion-arc');

  const btnStart        = document.getElementById('btn-start');
  const btnPause        = document.getElementById('btn-pause');
  const btnReset        = document.getElementById('btn-reset');
  const btnPrevRound    = document.getElementById('btn-prev-round');
  const btnNextRound    = document.getElementById('btn-next-round');
  const btnTurnDone     = document.getElementById('btn-turn-done');
  const btnTurnsDismiss = document.getElementById('btn-turns-dismiss');

  /* Arc circumference */
  const ARC_CIRC = 2 * Math.PI * 160; /* 1005.31 */

  /* ── Display helpers ──────────────────────────────────────────────── */
  function fmtTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function renderTime() {
    timeDisplay.textContent = fmtTime(remainingSeconds);
    updateDepletionArc();
  }

  function updateDepletionArc() {
    if (!depletionArc || totalSeconds <= 0) return;
    const fraction = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
    /* dashoffset=0 → full arc; dashoffset=circ → empty arc */
    const offset = ARC_CIRC * (1 - fraction);
    depletionArc.setAttribute('stroke-dashoffset', offset.toFixed(2));
  }

  function renderRound() {
    const info     = getRoundInfo();
    const isTopCut = isTopCutRound();

    roundNumber.textContent     = info.number;
    roundNumber.style.fontSize  = isTopCut ? 'clamp(0.85rem, 2vw, 1.1rem)' : '';
    roundTypeLabel.textContent  = info.type;

    const iconIdx = (currentRound - 1) % INK_ICONS.length;
    roundInkIcon.src = INK_ICONS[iconIdx];
  }

  /* ── App state ────────────────────────────────────────────────────── */
  const STATE_MESSAGES = {
    idle:    'Ready to Start',
    running: 'Round in Progress',
    paused:  'Paused',
    warning: '10 Minutes Remaining',
    danger:  'Less Than 1 Minute!',
    ended:   'Time Called — 5 Additional Turns',
  };

  const STATE_SNOW = {
    idle: 1, running: 1, paused: 1, warning: 2, danger: 3, ended: 3,
  };

  function setState(state) {
    body.dataset.state        = state;
    statusText.textContent    = STATE_MESSAGES[state] ?? '';
    setSnowIntensity(STATE_SNOW[state] ?? 1);
  }

  /* ── Timer core ───────────────────────────────────────────────────── */
  function startTimer() {
    if (intervalId) return;
    if (body.dataset.state === 'ended') return;

    intervalId = setInterval(tick, 1000);

    if      (remainingSeconds <= 60)  setState('danger');
    else if (remainingSeconds <= 600) setState('warning');
    else                              setState('running');

    btnStart.disabled = true;
    btnPause.disabled = false;
  }

  function pauseTimer() {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;

    setState('paused');
    btnStart.disabled    = false;
    btnPause.disabled    = true;
    btnStart.textContent = '\u25BA Resume';
  }

  function resetTimer() {
    clearInterval(intervalId);
    intervalId   = null;
    warningFired = false;

    totalSeconds     = getRoundDuration();
    remainingSeconds = totalSeconds;

    extraTurnsOverlay.classList.add('hidden');
    setState('idle');
    renderTime();
    renderRound();

    btnStart.disabled    = false;
    btnPause.disabled    = true;
    btnStart.textContent = '\u25BA Start';
  }

  function tick() {
    remainingSeconds--;
    renderTime();

    if (remainingSeconds <= 0) {
      clearInterval(intervalId);
      intervalId       = null;
      remainingSeconds = 0;
      renderTime();
      setState('ended');
      btnStart.disabled = true;
      btnPause.disabled = true;
      blizzardBurst();
      showExtraTurns();
      return;
    }

    if (remainingSeconds <= 60 && body.dataset.state !== 'danger') {
      setState('danger');
    } else if (remainingSeconds <= 600 && body.dataset.state === 'running') {
      setState('warning');
      warningFired = true;
    }
  }

  /* ── Extra turns ──────────────────────────────────────────────────── */
  function showExtraTurns() {
    extraTurnsLeft = 5;
    turnsLeftEl.textContent = '5';
    btnTurnDone.disabled    = false;
    extraTurnsOverlay.classList.remove('hidden');
  }

  function completeTurn() {
    extraTurnsLeft = Math.max(0, extraTurnsLeft - 1);
    turnsLeftEl.textContent = String(extraTurnsLeft);
    if (extraTurnsLeft === 0) {
      btnTurnDone.disabled   = true;
      statusText.textContent = 'Round Complete!';
    }
  }

  function dismissExtraTurns() {
    extraTurnsOverlay.classList.add('hidden');
  }

  /* ── Round navigation ─────────────────────────────────────────────── */
  function goToRound(n) {
    currentRound = Math.max(1, Math.min(n, getMaxRound()));
    resetTimer();
  }

  /* ════════════════════════════════════════════════════════════════════
     SECTION G — Apply config  (called by settings panel + on boot)
     ════════════════════════════════════════════════════════════════════ */
  window.applyConfig = function applyConfig() {
    const c = cfg();

    eventNameEl.textContent = (c.eventName || 'Set Championship').slice(0, 60);

    const allowedThemes = ['winterspell', 'generic'];
    body.dataset.theme = allowedThemes.includes(c.theme) ? c.theme : 'winterspell';

    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    body.dataset.mode = modeParam === 'spectator' ? 'spectator'
      : (['judge','spectator'].includes(c.mode) ? c.mode : 'judge');

    currentRound = 1;
    renderRound();
    if (!intervalId) resetTimer();
  };

  /* ════════════════════════════════════════════════════════════════════
     SECTION H — Keyboard shortcuts
     ════════════════════════════════════════════════════════════════════ */
  document.addEventListener('keydown', function (e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        intervalId ? pauseTimer() : startTimer();
        break;
      case 'ArrowRight':
        e.preventDefault();
        goToRound(currentRound + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        goToRound(currentRound - 1);
        break;
      case 'KeyR':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); resetTimer(); }
        break;
      case 'KeyS':
        if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); openSettings(); }
        break;
    }
  });

  /* ════════════════════════════════════════════════════════════════════
     SECTION I — Wire up buttons
     ════════════════════════════════════════════════════════════════════ */
  btnStart.addEventListener('click', startTimer);
  btnPause.addEventListener('click', pauseTimer);
  btnReset.addEventListener('click', resetTimer);
  btnPrevRound.addEventListener('click',    () => goToRound(currentRound - 1));
  btnNextRound.addEventListener('click',    () => goToRound(currentRound + 1));
  btnTurnDone.addEventListener('click',     completeTurn);
  btnTurnsDismiss.addEventListener('click', dismissExtraTurns);

  /* ════════════════════════════════════════════════════════════════════
     SECTION J — Boot
     ════════════════════════════════════════════════════════════════════ */
  window.applyConfig();
}());
