// Camp worlds: data-driven map registry (four themed spots), collision,
// interactables, and the host sim tick. Pure functions — the scratchpad
// suite asserts them without a DOM.

export const WORLD = { w: 2000, h: 1500 };
export const PLAYER_R = 22;
export const SPEED = 250;       // walking, units/s
export const TRUCK_SPEED = 620; // driving, units/s
export const TRUCK_R = 60;      // truck collision radius

const SHORE_BAND = 1.32;

export const MAPS = {
  lakeside: {
    id: 'lakeside', name: 'Lakeside', emoji: '🏕️', minLevel: 1,
    palette: { grassTop: '#274a2b', grassBottom: '#1d3a22', path: '#5c4a33', trunk: '#5a4630', canopy: ['#2f5d33', '#3a7241'] },
    water: { type: 'lake', cx: 1480, cy: 1060, rx: 430, ry: 300, colors: ['#2e6f8e', '#1d4a63'], sand: '#c9b17c' },
    trees: [
      { x: 220, y: 820, r: 42 }, { x: 360, y: 1080, r: 48 }, { x: 150, y: 1240, r: 40 },
      { x: 620, y: 1250, r: 46 }, { x: 1650, y: 320, r: 44 }, { x: 1840, y: 540, r: 40 },
      { x: 1300, y: 190, r: 46 }, { x: 780, y: 170, r: 42 },
    ],
    firepit: { x: 880, y: 660, r: 46 },
    tent: { x: 380, y: 360, w: 200, h: 160 },
    market: { x: 1560, y: 430, w: 190, h: 120 },
    truckSpot: { x: 170, y: 480, w: 230, h: 120 },
    roadSign: { x: 90, y: 750 },
    spawns: [{ x: 780, y: 760 }, { x: 990, y: 770 }, { x: 830, y: 560 }, { x: 960, y: 580 }],
    features: { fireDecayMult: 1 },
  },
  forest: {
    id: 'forest', name: 'Pine Forest', emoji: '🌲', minLevel: 3,
    palette: { grassTop: '#1c3a24', grassBottom: '#12291a', path: '#4e4030', trunk: '#4a3a28', canopy: ['#1e4a2a', '#2a5e36'] },
    water: { type: 'river', cy: 1050, amp: 110, halfW: 130, k: 0.004, colors: ['#2a6a7e', '#1a4a5c'], sand: '#8a7a55' },
    trees: [
      { x: 200, y: 250, r: 50 }, { x: 420, y: 180, r: 44 }, { x: 640, y: 300, r: 52 },
      { x: 1120, y: 200, r: 48 }, { x: 1380, y: 330, r: 44 }, { x: 1650, y: 210, r: 52 },
      { x: 1850, y: 420, r: 44 }, { x: 260, y: 620, r: 46 }, { x: 1750, y: 700, r: 48 },
      { x: 1500, y: 560, r: 42 }, { x: 120, y: 980, r: 44 },
    ],
    firepit: { x: 900, y: 700, r: 46 },
    tent: { x: 520, y: 480, w: 200, h: 160 },
    market: { x: 1250, y: 480, w: 190, h: 120 },
    truckSpot: { x: 160, y: 420, w: 230, h: 120 },
    roadSign: { x: 90, y: 620 },
    spawns: [{ x: 820, y: 800 }, { x: 1000, y: 810 }, { x: 860, y: 600 }, { x: 980, y: 620 }],
    features: { fireflies: true, fireDecayMult: 1, woodBonus: 1 },
  },
  beach: {
    id: 'beach', name: 'Sunset Beach', emoji: '🏖️', minLevel: 5,
    palette: { grassTop: '#d9c68f', grassBottom: '#c9b478', path: '#b49b62', trunk: '#8a6a3c', canopy: ['#3e7a45', '#4f9455'] },
    water: { type: 'ocean', base: 1120, amp: 40, k: 0.005, colors: ['#2a8ab0', '#155a7e'], sand: '#efe0b2' },
    trees: [
      { x: 300, y: 380, r: 44, palm: true }, { x: 640, y: 250, r: 48, palm: true },
      { x: 1520, y: 300, r: 46, palm: true }, { x: 1800, y: 520, r: 42, palm: true },
      { x: 1150, y: 420, r: 44, palm: true }, { x: 180, y: 700, r: 42, palm: true },
    ],
    firepit: { x: 900, y: 760, r: 46 },
    tent: { x: 420, y: 520, w: 200, h: 160 },
    market: { x: 1480, y: 620, w: 190, h: 120 },
    truckSpot: { x: 170, y: 380, w: 230, h: 120 },
    roadSign: { x: 90, y: 560 },
    spawns: [{ x: 820, y: 860 }, { x: 1000, y: 870 }, { x: 860, y: 660 }, { x: 980, y: 680 }],
    features: { sunset: true, fireDecayMult: 1 },
  },
  mountain: {
    id: 'mountain', name: 'Snowy Summit', emoji: '🏔️', minLevel: 8,
    palette: { grassTop: '#dfe7ee', grassBottom: '#c3cfd9', path: '#9aa7b2', trunk: '#4a3a30', canopy: ['#4e6e60', '#e8eef3'] },
    water: {
      type: 'frozen', cx: 1450, cy: 1020, rx: 430, ry: 300,
      colors: ['#bfe0ef', '#9cc8de'], sand: '#e8eef3',
      holes: [{ x: 1330, y: 940, r: 36 }, { x: 1560, y: 1080, r: 36 }, { x: 1440, y: 1180, r: 36 }],
    },
    trees: [
      { x: 240, y: 260, r: 46 }, { x: 520, y: 180, r: 44 }, { x: 1700, y: 260, r: 48 },
      { x: 1880, y: 480, r: 42 }, { x: 200, y: 900, r: 46 }, { x: 420, y: 1150, r: 44 },
      { x: 760, y: 1280, r: 46 },
    ],
    firepit: { x: 880, y: 680, r: 46 },
    tent: { x: 400, y: 420, w: 200, h: 160 },
    market: { x: 1300, y: 380, w: 190, h: 120 },
    truckSpot: { x: 160, y: 500, w: 230, h: 120 },
    roadSign: { x: 90, y: 760 },
    spawns: [{ x: 800, y: 780 }, { x: 980, y: 790 }, { x: 840, y: 580 }, { x: 960, y: 600 }],
    features: { snow: true, aurora: true, fireDecayMult: 1.6, iceFishing: true },
  },
};

export const getMap = (id) => MAPS[id] || MAPS.lakeside;
export const SPOT_ORDER = ['lakeside', 'forest', 'beach', 'mountain'];

// ---------------------------------------------------------------- water

/** 'water' | 'shore' | 'ice' | null at (x, y). Frozen lakes are walkable ice;
 *  only the drilled holes count as water/shore. */
export function waterAt(map, x, y) {
  const w = map.water;
  if (w.type === 'lake') {
    const t = ((x - w.cx) / w.rx) ** 2 + ((y - w.cy) / w.ry) ** 2;
    return t < 1 ? 'water' : t <= SHORE_BAND ? 'shore' : null;
  }
  if (w.type === 'river') {
    const cy = w.cy + Math.sin(x * w.k * Math.PI) * w.amp;
    const d = Math.abs(y - cy);
    return d < w.halfW ? 'water' : d < w.halfW * 1.45 ? 'shore' : null;
  }
  if (w.type === 'ocean') {
    const yo = w.base + Math.sin(x * w.k * Math.PI) * w.amp;
    return y > yo ? 'water' : y > yo - 85 ? 'shore' : null;
  }
  if (w.type === 'frozen') {
    for (const h of w.holes) {
      const d = (x - h.x) ** 2 + (y - h.y) ** 2;
      if (d < h.r ** 2) return 'water';
      if (d < (h.r + 60) ** 2) return 'shore';
    }
    const t = ((x - w.cx) / w.rx) ** 2 + ((y - w.cy) / w.ry) ** 2;
    return t < 1 ? 'ice' : null;
  }
  return null;
}

const inBox = (x, y, b, pad) =>
  x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad;

/** Solid-world collision for a circle of radius r at (x, y). */
export function collides(map, x, y, r = PLAYER_R) {
  if (x < r || y < r || x > WORLD.w - r || y > WORLD.h - r) return true;
  if (waterAt(map, x, y) === 'water') return true;
  for (const t of map.trees) {
    if ((x - t.x) ** 2 + (y - t.y) ** 2 < (t.r + r - 6) ** 2) return true;
  }
  if ((x - map.firepit.x) ** 2 + (y - map.firepit.y) ** 2 < (map.firepit.r + r - 8) ** 2) return true;
  if (inBox(x, y, map.tent, r - 8)) return true;
  if (inBox(x, y, map.market, r - 8)) return true;
  return false;
}

export function clampMove(map, x, y, nx, ny, r = PLAYER_R) {
  if (!collides(map, nx, ny, r)) return { x: nx, y: ny };
  if (!collides(map, nx, y, r)) return { x: nx, y };
  if (!collides(map, x, ny, r)) return { x, y: ny };
  return { x, y };
}

const near = (x, y, px, py, r) => (x - px) ** 2 + (y - py) ** 2 < r * r;

/**
 * What can the player interact with here? state: {night, hasAuger}.
 * Ice fishing needs the auger; without it the shore is visibly locked.
 */
export function nearestInteractable(map, x, y, state = {}) {
  const wa = waterAt(map, x, y);
  if (wa === 'shore') {
    if (map.features.iceFishing && !state.hasAuger) {
      return { kind: 'locked', label: 'NEED AUGER 🥶', reason: 'The ice needs an Ice Auger 🕳️' };
    }
    return { kind: 'shore', label: 'CAST 🎣' };
  }
  const m = map.market;
  if (near(x, y, m.x + m.w / 2, m.y + m.h / 2, 175)) return { kind: 'market', label: 'MARKET 🪙' };
  if (near(x, y, map.firepit.x, map.firepit.y, map.firepit.r + 76)) return { kind: 'firepit', label: null };
  for (const t of map.trees) {
    if (near(x, y, t.x, t.y, t.r + 60)) return { kind: 'tree', label: 'CHOP 🌲' };
  }
  const tcx = map.tent.x + map.tent.w / 2, tcy = map.tent.y + map.tent.h / 2;
  if (near(x, y, tcx, tcy, 190) && state.night) return { kind: 'tent', label: 'STARGAZE ✨' };
  return null;
}

// ---------------------------------------------------------------- host sim

export const DAY_CYCLE_S = 600;
export const FIRE_DECAY_PER_S = 0.35;

export function makeWorldState(todStart = 0.2) {
  return { fire: { lvl: 0, lit: false }, tod: todStart };
}

/** Advance the world by dt seconds. decayMult: cold maps burn faster. */
export function tickWorld(w, dt, decayMult = 1) {
  w.tod = (w.tod + dt / DAY_CYCLE_S) % 1;
  if (w.fire.lit) {
    w.fire.lvl = Math.max(0, w.fire.lvl - FIRE_DECAY_PER_S * decayMult * dt);
    if (w.fire.lvl <= 0) { w.fire.lit = false; w.fire.lvl = 0; }
  }
  return w;
}

export function nightFactor(tod) {
  if (tod < 0.45) return 0;
  if (tod < 0.6) return (tod - 0.45) / 0.15;
  if (tod < 0.9) return 1;
  return 1 - (tod - 0.9) / 0.1;
}
