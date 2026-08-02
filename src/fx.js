// In-game animation effects. All helpers are fire-and-forget: they spawn
// temporary fixed-position elements, animate with the Web Animations API,
// and clean up on a timeout fallback so a throttled tab can never leak
// elements or leave pile cards hidden.

const gone = (el, ms) => setTimeout(() => el.remove(), ms);

const centerOf = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/** A face-down card element matching the pile card size. */
function backEl(rect) {
  const b = document.createElement('div');
  b.className = 'back-card fly-card';
  b.style.width = rect.width + 'px';
  b.style.height = rect.height + 'px';
  return b;
}

/**
 * Fly the just-played cards from their owner's stack (or your hand) onto the
 * pile. `targets` are the freshly rendered pile card elements; they're hidden
 * until their flyer arrives. Returns total duration in ms (for sequencing).
 */
export function flyCards(fromRect, targets, { faceDown = false } = {}) {
  if (!fromRect || targets.length === 0) return 0;
  const from = centerOf(fromRect);
  const DUR = 330, STAG = 60;
  targets.forEach((t, i) => {
    const r = t.getBoundingClientRect();
    if (!r.width) return; // not laid out; skip the flight, just show the card
    const flyer = faceDown ? backEl(r) : t.cloneNode(true);
    flyer.classList.add('fly-card');
    flyer.style.left = r.left + 'px';
    flyer.style.top = r.top + 'px';
    if (!faceDown) { flyer.style.width = r.width + 'px'; flyer.style.height = r.height + 'px'; }
    document.body.appendChild(flyer);
    t.classList.add('await-flight');
    const dx = from.x - (r.left + r.width / 2);
    const dy = from.y - (r.top + r.height / 2);
    const spin = (Math.random() * 24 - 12).toFixed(1);
    flyer.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(0.3) rotate(${spin}deg)`, opacity: 0.85 },
      { transform: 'none', opacity: 1 },
    ], { duration: DUR, delay: i * STAG, easing: 'cubic-bezier(0.2, 0.75, 0.3, 1)', fill: 'both' });
    const reveal = () => {
      flyer.remove();
      t.classList.remove('await-flight');
      t.classList.add('land-pop');
    };
    setTimeout(reveal, DUR + i * STAG + 30);
  });
  return DUR + (targets.length - 1) * STAG;
}

/** "PASS" bubble floating up from a player's position. */
export function passBubble(anchorRect, label = 'PASS ✋') {
  const b = document.createElement('div');
  b.className = 'pass-bubble';
  b.textContent = label;
  const c = centerOf(anchorRect);
  b.style.left = c.x + 'px';
  b.style.top = c.y + 'px';
  document.body.appendChild(b);
  gone(b, 1300);
}

/** The dead trick swooshes away toward the winner's position. */
export function swooshPile(cardEls, targetRect) {
  const to = targetRect ? centerOf(targetRect) : { x: innerWidth / 2, y: -80 };
  cardEls.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const ghost = el.cloneNode(true);
    ghost.className = el.className + ' fly-card';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    document.body.appendChild(ghost);
    ghost.animate([
      { transform: 'none', opacity: 1 },
      {
        transform: `translate(${to.x - (r.left + r.width / 2)}px, ${to.y - (r.top + r.height / 2)}px) scale(0.15) rotate(${i % 2 ? 50 : -50}deg)`,
        opacity: 0,
      },
    ], { duration: 480, delay: i * 35, easing: 'cubic-bezier(0.5, 0, 0.8, 0.4)', fill: 'both' });
    gone(ghost, 600 + i * 35);
  });
}

/** Four-of-a-kind: the whole table quakes. */
export function shakeTable(el) {
  el.classList.remove('quake');
  void el.offsetWidth;
  el.classList.add('quake');
  setTimeout(() => el.classList.remove('quake'), 700);
}

/** Straight flush: a rainbow shimmer sweeps across the pile. */
export function rainbowSweep(container) {
  const s = document.createElement('div');
  s.className = 'rainbow-sweep';
  container.appendChild(s);
  gone(s, 1500);
}

const CONFETTI_COLORS = ['#8b7cf6', '#22d3ee', '#f472b6', '#ffd778', '#34d399', '#fdfdf8'];

/** Confetti burst from a point (defaults to the pile / screen center). */
export function confettiBurst(x = innerWidth / 2, y = innerHeight * 0.42, n = 44) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    if (i % 3 === 0) p.style.borderRadius = '50%';
    document.body.appendChild(p);
    const ang = Math.random() * Math.PI * 2;
    const v = 90 + Math.random() * 220;
    const dx = Math.cos(ang) * v;
    const dy = Math.sin(ang) * v - 130;
    p.animate([
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.7}px, ${dy}px) rotate(${180 + Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy + 340}px) rotate(${360 + Math.random() * 540}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(0.2, 0.6, 0.6, 1)', fill: 'both' });
    gone(p, 2100);
  }
}

/** Round won: a few staggered bursts across the top. */
export function confettiRain() {
  confettiBurst(innerWidth * 0.5, innerHeight * 0.35, 50);
  setTimeout(() => confettiBurst(innerWidth * 0.25, innerHeight * 0.25, 36), 220);
  setTimeout(() => confettiBurst(innerWidth * 0.75, innerHeight * 0.25, 36), 420);
}
