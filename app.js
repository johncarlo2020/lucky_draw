/* ============================================================
   app.js  –  Mari Home Mari Ong  Lucky Draw
============================================================ */

'use strict';

// ─────────────────────────────────────────────
// CONFIG  (edit this to change prizes / weights)
// ─────────────────────────────────────────────
const CONFIG = {
  shuffleIntervalMs:  80,    // speed of slot-machine highlight
  shuffleDuration:   3000,   // how long auto-shuffle runs before waiting for tap
  confettiCount:      60,
  qrBaseUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=',
  qrClaimUrl: 'https://gurney.ipropertyevents.com/prize/',
};

/**
 * Prize list – extend or replace freely.
 * `image` can be a file path or a data URI.
 * `emoji` is shown as a fallback when the image fails to load.
 * `weight` controls relative probability (higher = more likely).
 */
const prizes = [
  {
    id: 'aeon',
    dbId: 1,
    name: 'AEON RM10 Gift Voucher',
    image: 'gift/AEON RM 10 Gift Voucher_2x.webp',
    emoji: '🛒',
    color: '#E8F5E9',
    weight: 12,
  },
  {
    id: 'br',
    dbId: 2,
    name: 'Baskin Robbins Voucher',
    image: 'gift/Baskin Robbins Voucher_2x.webp',
    emoji: '🍦',
    color: '#FFF3E0',
    weight: 12,
  },
  {
    id: 'lanyard',
    dbId: 8,
    name: 'iProperty Phone Lanyard',
    image: 'gift/iProperty  Phone Lanyard_2x.webp',
    emoji: '📱',
    color: '#E8F0FF',
    weight: 12,
  },
  {
    id: 'notebook',
    dbId: 4,
    name: 'iProperty Notebook',
    image: 'gift/iProperty Notebook_2x.webp',
    emoji: '📓',
    color: '#EDE7F6',
    weight: 12,
  },
  {
    id: 'fan',
    dbId: 3,
    name: 'Neck Fan',
    image: 'gift/Neck Fan_2x.webp',
    emoji: '💨',
    color: '#E3F2FD',
    weight: 13,
  },
  {
    id: 'kopi',
    dbId: 5,
    name: 'Oriental Kopi RM10 Cash Voucher',
    image: 'gift/Oriental Kopi  RM 10 Cash Voucher_2x.webp',
    emoji: '☕',
    color: '#FFF8E1',
    weight: 13,
  },
  {
    id: 'texas',
    dbId: 6,
    name: 'Texas Chicken RM5 Cash Voucher',
    image: 'gift/Texas Chicken RM 5 Cash Voucher_2x.webp',
    emoji: '🍗',
    color: '#FFF3E0',
    weight: 13,
  },
  {
    id: 'watsons',
    dbId: 7,
    name: 'Watsons RM10 Gift Voucher',
    image: 'gift/Watsons RM 10 Gift Voucher _2x.webp',
    emoji: '🧴',
    color: '#E8F5E9',
    weight: 13,
  },
];

// ─────────────────────────────────────────────
// ACTIVE PRIZES  (populated from API before each draw)
// ─────────────────────────────────────────────
let activePrizes   = [...prizes]; // in-stock only – used for winner selection
let displayPrizes  = [...prizes]; // all prizes – used for carousel display

/**
 * Fetch current stock levels and rebuild activePrizes,
 * excluding any item with stock_level <= 0.
 * Falls back to the full static prizes list on error.
 */
async function fetchStocks() {
  try {
    const res = await fetch('https://gurney.ipropertyevents.com/api/gifts/stocks', {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log('Fetched stocks:', json);
    if (json.status !== 'success' || !Array.isArray(json.data)) throw new Error('Unexpected response');

    const stockMap = {};
    for (const item of json.data) {
      stockMap[item.id] = parseInt(item.stock_level, 10) || 0;
    }

    const filtered = prizes.filter(p => (stockMap[p.dbId] ?? 0) > 0);
    activePrizes  = filtered.length > 0 ? filtered : [...prizes]; // fallback if all out of stock
    displayPrizes = [...prizes]; // always show all prizes in the carousel
  } catch (err) {
    console.warn('fetchStocks failed, using full prize list:', err);
    activePrizes = [...prizes];
  }
}

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
const state = {
  currentScreen: 'start',
  shuffleTimer:   null,
  shuffleActive:  false,
  highlightIndex: 0,
  winnerPrize:    null,
  canTap:         false,
};

// ─────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ─────────────────────────────────────────────
// SCREEN TRANSITIONS
// ─────────────────────────────────────────────
function showScreen(id) {
  const current = document.querySelector('.screen.active');
  const next    = $(`screen-${id}`);
  if (!next || current === next) return;

  if (current) {
    current.classList.add('exit');
    current.classList.remove('active');
    current.addEventListener('transitionend', () => {
      current.classList.remove('exit');
    }, { once: true });
  }

  // slight delay so exit animation is visible
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      next.classList.add('active');
    });
  });

  state.currentScreen = id;
}

// ─────────────────────────────────────────────
// CAROUSEL SHUFFLE LOGIC
// ─────────────────────────────────────────────
const SLIDE_MS = 130; // duration must match CSS animation

/** Render a prize into the carousel card (no animation) */
function setCarouselCard(prize) {
  const imgWrap = $('carousel-img-wrap');
  const nameEl  = $('carousel-name');

  imgWrap.innerHTML = '';
  const img = document.createElement('img');
  img.src = prize.image;
  img.alt = prize.name;
  img.addEventListener('error', () => {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:64px;line-height:1';
    span.textContent = prize.emoji;
    imgWrap.innerHTML = '';
    imgWrap.appendChild(span);
  });
  imgWrap.appendChild(img);
  nameEl.textContent = prize.name;
}

/**
 * Slide out current card, call onDone to swap content,
 * then slide new card in. Uses setTimeout — NOT animationend —
 * so it always completes regardless of interruption.
 */
function slideToNext(onDone) {
  const card = $('carousel-card');
  // Clear any lingering classes
  card.classList.remove('slide-in', 'slide-out', 'flash-out');
  $('carousel-viewport').classList.remove('winner');
  void card.offsetWidth; // force reflow

  card.classList.add('slide-out');
  setTimeout(() => {
    onDone();                          // swap content while hidden
    card.classList.remove('slide-out');
    void card.offsetWidth;             // force reflow
    card.classList.add('slide-in');
    setTimeout(() => {
      card.classList.remove('slide-in');
    }, SLIDE_MS);
  }, SLIDE_MS);
}

function startShuffle() {
  state.shuffleActive  = true;
  state.canTap         = true;
  state.highlightIndex = 0;

  // Show first card immediately, no animation
  setCarouselCard(displayPrizes[0]);

  doFastStep();
}

/** Fast shuffle: quick opacity flash — no slide (faster than SLIDE_MS) */
function doFastStep() {
  if (!state.shuffleActive) return;

  state.highlightIndex = (state.highlightIndex + 1) % displayPrizes.length;
  const next = displayPrizes[state.highlightIndex];
  const card = $('carousel-card');

  card.classList.add('flash-out');
  setTimeout(() => {
    setCarouselCard(next);
    card.classList.remove('flash-out');
    state.shuffleTimer = setTimeout(doFastStep, CONFIG.shuffleIntervalMs);
  }, 40);
}

function stopShuffle() {
  state.canTap        = false;
  state.shuffleActive = false;
  clearTimeout(state.shuffleTimer);

  // Fetch fresh stocks in parallel with the deceleration animation
  // so the winner is always picked from up-to-date, in-stock prizes.
  const stocksPromise = fetchStocks();

  // Deceleration: 4 slowing slides, then land on winner
  const delays  = [220, 360, 500, 650];
  let   step    = 0;

  function decelStep() {
    if (step < delays.length) {
      const delay = delays[step++];
      state.shuffleTimer = setTimeout(() => {
        state.highlightIndex = (state.highlightIndex + 1) % displayPrizes.length;
        slideToNext(() => setCarouselCard(displayPrizes[state.highlightIndex]));
        setTimeout(decelStep, SLIDE_MS * 2); // wait for slide to finish
      }, delay);
    } else {
      // Wait for fresh stock data before selecting winner so that
      // prizes with 0 stock are never awarded.
      stocksPromise.then(() => {
        const winner      = pickWeightedRandom(activePrizes);
        state.winnerPrize = winner;

        state.shuffleTimer = setTimeout(() => {
          slideToNext(() => {
            setCarouselCard(winner);
            setTimeout(() => $('carousel-viewport').classList.add('winner'), SLIDE_MS + 20);
          });
          setTimeout(() => showResult(winner), SLIDE_MS * 2 + 800);
        }, 400);
      });
    }
  }

  decelStep();
}

function onCardTap() {
  if (!state.shuffleActive) return;
  stopShuffle();
}

// ─────────────────────────────────────────────
// WEIGHTED RANDOM
// ─────────────────────────────────────────────
function pickWeightedRandom(items) {
  const totalWeight = items.reduce((s, i) => s + (i.weight ?? 1), 0);
  let rand = Math.random() * totalWeight;
  for (const item of items) {
    rand -= (item.weight ?? 1);
    if (rand <= 0) return item;
  }
  return items[items.length - 1];
}

// ─────────────────────────────────────────────
// RESULT SCREEN
// ─────────────────────────────────────────────
function showResult(prize) {
  const img = $('result-img');
  img.src = prize.image;
  img.alt = prize.name;
  img.onerror = function () {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:80px;line-height:1';
    span.textContent = prize.emoji;
    img.replaceWith(span);
  };
  $('result-name').textContent = prize.name;

  spawnConfetti();
  showScreen('result');
}

// ─────────────────────────────────────────────
// CONFETTI
// ─────────────────────────────────────────────
function spawnConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';

  const colors = ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF922B','#CC5DE8','#F06595'];

  for (let i = 0; i < CONFIG.confettiCount; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${6 + Math.random() * 8}px;
      height: ${12 + Math.random() * 8}px;
      border-radius: 2px;
      animation-duration: ${3 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 1.5}s;
    `;
    container.appendChild(piece);
  }

  // Clean up after animations
  setTimeout(() => { container.innerHTML = ''; }, 7000);
}

// ─────────────────────────────────────────────
// QR SCREEN
// ─────────────────────────────────────────────
function showQR(prize) {
  const prizeUrl  = `${CONFIG.qrClaimUrl}${prize.dbId}`;
  const claimUrl  = encodeURIComponent(prizeUrl);
  const qrSrc     = `${CONFIG.qrBaseUrl}${claimUrl}`;

  const qrImg     = $('qr-image');
  const qrCanvas  = $('qr-canvas');

  // Try remote QR image first; fall back to inline canvas QR
  qrImg.style.display = 'block';
  qrCanvas.style.display = 'none';
  qrImg.src = qrSrc;
  qrImg.onerror = () => {
    qrImg.style.display = 'none';
    qrCanvas.style.display = 'block';
    drawCanvasQR(qrCanvas, prizeUrl);
  };

  showScreen('qr');
}

/**
 * Minimal QR-code-like placeholder drawn on canvas
 * (replace with a real QR library such as qrcode.js for production)
 */
function drawCanvasQR(canvas, text) {
  const size = 170;
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  // Deterministic-ish "QR-like" grid from text hash
  const hash = simpleHash(text);
  const cells = 21;
  const cell  = Math.floor(size / cells);

  ctx.fillStyle = '#111';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const isCorner = isFinderPattern(r, c, cells);
      const bit = isCorner || ((hash >> ((r * cells + c) % 32)) & 1);
      if (bit) ctx.fillRect(c * cell, r * cell, cell - 1, cell - 1);
    }
  }

  // Label
  ctx.fillStyle = '#333';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCAN TO CLAIM', size / 2, size - 3);
}

function isFinderPattern(r, c, n) {
  const inCorner = (rr, cc) =>
    (rr <= 6 && cc <= 6) ||
    (rr <= 6 && cc >= n - 7) ||
    (rr >= n - 7 && cc <= 6);
  return inCorner(r, c);
}

function simpleHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

// ─────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────
function resetGame() {
  clearTimeout(state.shuffleTimer);
  state.shuffleActive  = false;
  state.canTap         = false;
  state.winnerPrize    = null;
  state.highlightIndex = 0;
  $('carousel-viewport').classList.remove('winner');
  $('carousel-card').classList.remove('slide-in', 'slide-out', 'winner', 'flash-out');
  showScreen('start');
}

// ─────────────────────────────────────────────
// COUNTDOWN
// ─────────────────────────────────────────────
function startCountdown(seconds, onDone) {
  const overlay = $('countdown-overlay');
  const numEl   = $('countdown-number');
  const steps   = [];
  for (let i = seconds; i >= 1; i--) steps.push(String(i));
  steps.push('GO!');

  let i = 0;

  function showStep() {
    // restart animation
    numEl.style.animation = 'none';
    void numEl.offsetWidth;
    numEl.textContent = steps[i];
    numEl.style.animation = 'countPop 0.4s cubic-bezier(.4,0,.2,1) both';

    i++;
    if (i < steps.length) {
      setTimeout(showStep, 900);
    } else {
      // 'GO!' shown — wait briefly then finish
      setTimeout(() => {
        overlay.classList.add('hidden');
        setTimeout(onDone, 250);
      }, 600);
    }
  }

  overlay.classList.remove('hidden');
  showStep();
}

// ─────────────────────────────────────────────
// BUTTON WIRING
// ─────────────────────────────────────────────
function initEventListeners() {
  $('btn-start').addEventListener('click', () => {
    showScreen('guide');
  });

  $('btn-ready').addEventListener('click', () => {
    fetchStocks().then(() => {
      startCountdown(3, () => {
        showScreen('shuffle');
        setTimeout(startShuffle, 300);
      });
    });
  });

  // Tap the carousel card to stop the shuffle
  $('screen-shuffle').addEventListener('click', onCardTap);

  $('btn-continue').addEventListener('click', () => {
    showQR(state.winnerPrize);
  });

  $('btn-redraw').addEventListener('click', () => {
    fetchStocks().then(() => {
      showScreen('shuffle');
      setTimeout(startShuffle, 300);
    });
  });

  $('btn-finish').addEventListener('click', () => {
    resetGame();
  });
}

// ─────────────────────────────────────────────
// LOGO FALLBACK  (called from HTML onerror)
// ─────────────────────────────────────────────
/* global logoFallback */
window.logoFallback = function () {
  const span = document.createElement('span');
  span.className = 'logo-svg-fallback';
  span.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
    </svg>
    iProperty
  `;
  return span;
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
});
