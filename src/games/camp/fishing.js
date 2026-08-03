// Fishing: cast (hold for power) -> wait -> bite window -> reel minigame ->
// catch. The HOST rolls all RNG (species/size/bite delay) and replies with a
// targeted 'fish' message; the minigame mechanics run entirely locally so
// they feel instant. This module owns the local player's fishing state and
// the DOM overlays (#castMeter, #reelGame, #catchCard).


const BOOT = { id: 'boot', name: 'Old Boot', emoji: '🥾', w: 5, min: 20, max: 30, rarity: 'junk', pts: 1 };

// Every camping spot has its own waters. Higher-tier spots pay better.
export const SPECIES_BY_MAP = {
  lakeside: [
    { id: 'tilapia', name: 'Tilapia', emoji: '🐟', w: 30, min: 15, max: 35, rarity: 'common', pts: 2 },
    { id: 'bangus', name: 'Bangus', emoji: '🐟', w: 24, min: 25, max: 50, rarity: 'common', pts: 3 },
    { id: 'catfish', name: 'Catfish', emoji: '🐡', w: 16, min: 30, max: 70, rarity: 'uncommon', pts: 5 },
    { id: 'bass', name: 'Bass', emoji: '🎣', w: 12, min: 25, max: 60, rarity: 'uncommon', pts: 5 },
    { id: 'carp', name: 'Golden Carp', emoji: '🟡', w: 8, min: 40, max: 85, rarity: 'rare', pts: 12 },
    { id: 'eel', name: 'Midnight Eel', emoji: '🐍', w: 6, min: 50, max: 110, rarity: 'rare', pts: 12 },
    { id: 'arowana', name: 'Arowana', emoji: '🐉', w: 3, min: 60, max: 120, rarity: 'epic', pts: 30 },
    BOOT,
  ],
  forest: [
    { id: 'perch', name: 'River Perch', emoji: '🐟', w: 28, min: 15, max: 35, rarity: 'common', pts: 4 },
    { id: 'salmon', name: 'Salmon', emoji: '🐟', w: 24, min: 40, max: 80, rarity: 'common', pts: 5 },
    { id: 'koi', name: 'Wild Koi', emoji: '🎏', w: 15, min: 25, max: 55, rarity: 'uncommon', pts: 9 },
    { id: 'sturgeon', name: 'Sturgeon', emoji: '🦕', w: 8, min: 80, max: 160, rarity: 'rare', pts: 18 },
    { id: 'dorado', name: 'Golden Dorado', emoji: '🌟', w: 3, min: 60, max: 110, rarity: 'epic', pts: 45 },
    BOOT,
  ],
  beach: [
    { id: 'sardine', name: 'Sardine', emoji: '🐟', w: 28, min: 10, max: 25, rarity: 'common', pts: 4 },
    { id: 'crab', name: 'Beach Crab', emoji: '🦀', w: 22, min: 12, max: 30, rarity: 'common', pts: 5 },
    { id: 'mackerel', name: 'Mackerel', emoji: '🐟', w: 15, min: 30, max: 60, rarity: 'uncommon', pts: 10 },
    { id: 'puffer', name: 'Pufferfish', emoji: '🐡', w: 12, min: 20, max: 50, rarity: 'uncommon', pts: 11 },
    { id: 'ray', name: 'Sunset Ray', emoji: '🪁', w: 7, min: 60, max: 130, rarity: 'rare', pts: 22 },
    { id: 'marlin', name: 'Blue Marlin', emoji: '🗡️', w: 3, min: 150, max: 300, rarity: 'epic', pts: 50 },
    BOOT,
  ],
  mountain: [
    { id: 'icefish', name: 'Icefish', emoji: '🧊', w: 28, min: 12, max: 30, rarity: 'common', pts: 6 },
    { id: 'trout', name: 'Frost Trout', emoji: '🐟', w: 24, min: 25, max: 60, rarity: 'common', pts: 7 },
    { id: 'char', name: 'Arctic Char', emoji: '🐟', w: 14, min: 35, max: 75, rarity: 'uncommon', pts: 13 },
    { id: 'ghostkoi', name: 'Ghost Koi', emoji: '👻', w: 7, min: 40, max: 90, rarity: 'rare', pts: 26 },
    { id: 'auroratrout', name: 'Aurora Trout', emoji: '✨', w: 3, min: 70, max: 140, rarity: 'epic', pts: 60 },
    BOOT,
  ],
};

export const SPECIES = Object.values(SPECIES_BY_MAP).flat()
  .filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);

const FIGHT = { common: 1, uncommon: 1.35, rare: 1.8, epic: 2.4, junk: 0.6 };

/** Host-side roll from the current map's waters. Lucky lure rerolls junk/common. */
export function rollFish(rand = Math.random, { lucky = false, mapId = 'lakeside' } = {}) {
  const pool = SPECIES_BY_MAP[mapId] || SPECIES_BY_MAP.lakeside;
  const pick = () => {
    const total = pool.reduce((s, f) => s + f.w, 0);
    let r = rand() * total;
    for (const f of pool) { r -= f.w; if (r <= 0) return f; }
    return pool[0];
  };
  let sp = pick();
  if (lucky && (sp.rarity === 'junk' || sp.rarity === 'common') && rand() < 0.5) sp = pick();
  const size = Math.round(sp.min + rand() * (sp.max - sp.min));
  const biteMs = 1500 + Math.round(rand() * 5000);
  return { species: sp.id, size, rarity: sp.rarity, biteMs };
}

export const speciesInfo = (id) => SPECIES.find((s) => s.id === id);

/** Market value: base by species, scaled up to ~2x by size within its range. */
export function sellPrice(species, size) {
  const sp = speciesInfo(species);
  if (!sp) return 1;
  const k = (size - sp.min) / Math.max(1, sp.max - sp.min); // 0..1
  return Math.max(1, Math.round(sp.pts * (1 + k)));
}

const HOOK_WINDOW_MS = 1600;   // generous — cozy game, not a reflex test
const SNAP_GRACE_MS = 600;     // tension must sit at an extreme this long to snap

export class Fishing {
  /**
   * hooks: { onCastRequest(), onOutcome({fish, ok}), setPrompt(label|null),
   *          toast(msg, ms, kind) }
   */
  constructor(els, hooks) {
    this.els = els; // {castMeter, castFill, reelGame, reelNeedle, reelZone, reelProgress, catchCard}
    this.hooks = hooks;
    this.state = 'idle'; // idle | casting | waiting | biting | reeling | reveal
    this.pending = null; // fish rolled by host
    this.bobber = null;
    this.timers = [];
    this.zone = [25, 80]; // safe tension band; the Pro Rod widens it
  }

  /** Apply owned gear (called when equipment changes). */
  setGear(unlocked) {
    this.zone = unlocked?.includes('rod2') ? [18, 87] : [25, 80];
    const z = this.els.reelGame?.querySelector('.reel-zone');
    if (z) { z.style.left = this.zone[0] + '%'; z.style.width = (this.zone[1] - this.zone[0]) + '%'; }
  }

  get active() { return this.state !== 'idle'; }
  get fishingView() {
    return this.state === 'idle' ? null
      : { bobber: this.bobber, bite: this.state === 'biting', reeling: this.state === 'reeling' };
  }

  _t(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

  /** Action button pressed while on the shore. */
  actionDown(playerPos) {
    if (this.state === 'idle') return this._startCast(playerPos);
    if (this.state === 'biting') return this._hook();
    if (this.state === 'reeling') { this.reelHold = true; return true; }
    return false;
  }

  actionUp() {
    if (this.state === 'casting') this._releaseCast();
    if (this.state === 'reeling') this.reelHold = false;
  }

  _startCast(playerPos) {
    this.state = 'casting';
    this.castPower = 0;
    this.castDir = 1;
    this.playerPos = playerPos;
    this.els.castMeter.classList.remove('hidden');
    this.castAnim = setInterval(() => {
      this.castPower += this.castDir * 0.04;
      if (this.castPower >= 1) { this.castPower = 1; this.castDir = -1; }
      if (this.castPower <= 0) { this.castPower = 0; this.castDir = 1; }
      this.els.castFill.style.width = this.castPower * 100 + '%';
    }, 30);
    return true;
  }

  _releaseCast() {
    clearInterval(this.castAnim);
    this.els.castMeter.classList.add('hidden');
    // bobber flies toward the water (map decides where that is), distance by
    // power, never past the target (so ice holes catch the bobber)
    const target = this.hooks.waterTarget?.(this.playerPos) || { x: this.playerPos.x, y: this.playerPos.y + 200 };
    const dx = target.x - this.playerPos.x, dy = target.y - this.playerPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.min(90 + this.castPower * 200, len);
    this.bobber = { x: this.playerPos.x + (dx / len) * dist, y: this.playerPos.y + (dy / len) * dist };
    this.state = 'waiting';
    this.hooks.setPrompt('…');
    this.hooks.onCastRequest(); // host replies with 'fish' -> this.onFishAssigned
  }

  /** Host's roll arrived (or was computed locally when solo/host). */
  onFishAssigned(fish) {
    if (this.state !== 'waiting') return;
    this.pending = fish;
    this._t(() => {
      if (this.state !== 'waiting') return;
      this.state = 'biting';
      this.hooks.setPrompt('HOOK! 🪝');
      this._t(() => {
        if (this.state === 'biting') {
          this.hooks.toast('It got away… 🫧', 2000, 'info');
          this._reset();
        }
      }, HOOK_WINDOW_MS);
    }, fish.biteMs);
  }

  _hook() {
    this.state = 'reeling';
    this.reelHold = false;
    this.tension = 50;
    this.progress = 0;
    this.snapMs = 0;
    const fight = FIGHT[this.pending.rarity] ?? 1;
    this.els.reelGame.classList.remove('hidden');
    this.hooks.setPrompt('REEL! 🎣');
    let pull = 0;
    this.reelAnim = setInterval(() => {
      // fish yanks the tension down in occasional bursts; holding reels it up.
      // Gentle drift both ways — losing should take sustained neglect, not a
      // moment's hesitation.
      if (Math.random() < 0.035 * fight) pull = 10 + Math.random() * 16 * fight;
      pull *= 0.92;
      this.tension += (this.reelHold ? 1.5 : -0.9) - pull * 0.06;
      this.tension = Math.max(0, Math.min(100, this.tension));
      const [zLo, zHi] = this.zone;
      const inZone = this.tension > zLo && this.tension < zHi;
      if (inZone) this.progress += 1.0;
      else this.progress = Math.max(0, this.progress - 0.15);
      // snapping requires sitting at an extreme for a while (with a warning)
      const atExtreme = this.tension <= 1 || this.tension >= 99;
      this.snapMs = atExtreme ? this.snapMs + 33 : 0;
      this.els.reelNeedle.style.left = this.tension + '%';
      this.els.reelProgress.style.width = Math.min(100, this.progress) + '%';
      this.els.reelGame.classList.toggle('danger', !inZone);
      if (this.snapMs >= SNAP_GRACE_MS) this._reelEnd(false);
      else if (this.progress >= 100) this._reelEnd(true);
    }, 33);
    return true;
  }

  _reelEnd(ok) {
    clearInterval(this.reelAnim);
    this.els.reelGame.classList.add('hidden');
    const fish = this.pending;
    if (!ok) {
      this.hooks.toast('The line snapped! 💥', 2200, 'info');
      this.hooks.onOutcome({ fish, ok: false });
      this._reset();
      return;
    }
    this.state = 'reveal';
    const sp = speciesInfo(fish.species);
    const card = this.els.catchCard;
    card.querySelector('.catch-emoji').textContent = sp.emoji;
    card.querySelector('.catch-name').textContent = sp.name;
    card.querySelector('.catch-size').textContent = fish.size + ' cm';
    card.dataset.rarity = fish.rarity;
    card.classList.remove('hidden');
    this.hooks.onOutcome({ fish, ok: true });
    this._t(() => { card.classList.add('hidden'); this._reset(); }, 2600);
  }

  _reset() {
    this.state = 'idle';
    this.bobber = null;
    this.pending = null;
    this.hooks.setPrompt(null);
  }

  cancel() {
    clearInterval(this.castAnim);
    clearInterval(this.reelAnim);
    for (const t of this.timers.splice(0)) clearTimeout(t);
    this.els.castMeter.classList.add('hidden');
    this.els.reelGame.classList.add('hidden');
    this.els.catchCard.classList.add('hidden');
    this._reset();
  }
}
