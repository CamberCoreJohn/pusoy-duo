// Camp world: map data, collision, interactable lookup, and the host's
// simulation tick. Pure functions where possible so the scratchpad suite can
// assert them without a DOM.

export const WORLD = { w: 2000, h: 1500 };
export const PLAYER_R = 22;
export const SPEED = 250; // logical units / second

// Bottom-right lake (ellipse). Shore = the ring just outside it.
export const LAKE = { cx: 1480, cy: 1060, rx: 430, ry: 300 };
const SHORE_BAND = 1.32; // ellipse-test values in (1, SHORE_BAND] = fishable shore

export const FIREPIT = { x: 880, y: 660, r: 46 };
export const TENT = { x: 380, y: 360, w: 200, h: 160 };

export const TREES = [
  { x: 220, y: 820, r: 42 }, { x: 360, y: 1080, r: 48 }, { x: 150, y: 1240, r: 40 },
  { x: 620, y: 1250, r: 46 }, { x: 1650, y: 320, r: 44 }, { x: 1840, y: 540, r: 40 },
  { x: 1300, y: 190, r: 46 }, { x: 780, y: 170, r: 42 },
];

// Where players appear (near the firepit, offset per join order).
export const SPAWNS = [
  { x: 780, y: 760 }, { x: 990, y: 770 }, { x: 830, y: 560 }, { x: 960, y: 580 },
];

/** Ellipse test for the lake: <1 inside water, (1, SHORE_BAND] on the shore. */
export function lakeTest(x, y) {
  const dx = (x - LAKE.cx) / LAKE.rx;
  const dy = (y - LAKE.cy) / LAKE.ry;
  return dx * dx + dy * dy;
}

/** Solid-world collision for a player circle at (x, y). */
export function collides(x, y) {
  if (x < PLAYER_R || y < PLAYER_R || x > WORLD.w - PLAYER_R || y > WORLD.h - PLAYER_R) return true;
  if (lakeTest(x, y) < 1) return true; // no swimming
  for (const t of TREES) {
    const d = (x - t.x) ** 2 + (y - t.y) ** 2;
    if (d < (t.r + PLAYER_R - 6) ** 2) return true;
  }
  const fd = (x - FIREPIT.x) ** 2 + (y - FIREPIT.y) ** 2;
  if (fd < (FIREPIT.r + PLAYER_R - 8) ** 2) return true;
  if (x > TENT.x - PLAYER_R + 8 && x < TENT.x + TENT.w + PLAYER_R - 8
    && y > TENT.y - PLAYER_R + 8 && y < TENT.y + TENT.h + PLAYER_R - 8) return true;
  return false;
}

/** Move with wall-sliding: try full step, then each axis alone. */
export function clampMove(x, y, nx, ny) {
  if (!collides(nx, ny)) return { x: nx, y: ny };
  if (!collides(nx, y)) return { x: nx, y };
  if (!collides(x, ny)) return { x, y: ny };
  return { x, y };
}

const near = (x, y, px, py, r) => (x - px) ** 2 + (y - py) ** 2 < r * r;

/**
 * What can the player interact with here? Returns {kind, label} or null.
 * Firepit resolves to a state-dependent kind upstream (feed/strike/roast/grill).
 */
export function nearestInteractable(x, y, state = {}) {
  const lt = lakeTest(x, y);
  if (lt > 1 && lt <= SHORE_BAND) return { kind: 'shore', label: 'CAST 🎣' };
  if (near(x, y, FIREPIT.x, FIREPIT.y, FIREPIT.r + 76)) return { kind: 'firepit', label: null };
  for (const t of TREES) {
    if (near(x, y, t.x, t.y, t.r + 60)) return { kind: 'tree', label: 'CHOP 🌲' };
  }
  const tcx = TENT.x + TENT.w / 2, tcy = TENT.y + TENT.h / 2;
  if (near(x, y, tcx, tcy, 190) && state.night) return { kind: 'tent', label: 'STARGAZE ✨' };
  return null;
}

// ---------------------------------------------------------------- host sim

export const DAY_CYCLE_S = 600;        // full day/night loop: 10 minutes
export const FIRE_DECAY_PER_S = 0.35;  // full fire burns out in ~5 minutes

export function makeWorldState(todStart = 0.2) {
  return { fire: { lvl: 0, lit: false }, tod: todStart };
}

/** Advance the world by dt seconds (host only; pure). */
export function tickWorld(w, dt) {
  w.tod = (w.tod + dt / DAY_CYCLE_S) % 1;
  if (w.fire.lit) {
    w.fire.lvl = Math.max(0, w.fire.lvl - FIRE_DECAY_PER_S * dt);
    if (w.fire.lvl <= 0) { w.fire.lit = false; w.fire.lvl = 0; }
  }
  return w;
}

/** Night factor 0..1 (0 = noon, 1 = deep night). tod 0.5-1 is night-ish. */
export function nightFactor(tod) {
  // smooth curve: day until .45, dusk ramp, full night .6-.9, dawn ramp
  if (tod < 0.45) return 0;
  if (tod < 0.6) return (tod - 0.45) / 0.15;
  if (tod < 0.9) return 1;
  return 1 - (tod - 0.9) / 0.1;
}
