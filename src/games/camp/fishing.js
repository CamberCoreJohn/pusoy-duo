// Fishing: cast (hold for power) -> wait -> bite window -> reel minigame ->
// catch. The HOST rolls all RNG (species/size/bite delay) and replies with a
// targeted 'fish' message; the minigame mechanics run entirely locally so
// they feel instant. This module owns the local player's fishing state and
// the DOM overlays (#castMeter, #reelGame, #catchCard).

import { LAKE } from './world.js';

export const SPECIES = [
  { id: 'tilapia', name: 'Tilapia', emoji: '🐟', w: 30, min: 15, max: 35, rarity: 'common', pts: 2 },
  { id: 'bangus', name: 'Bangus', emoji: '🐟', w: 24, min: 25, max: 50, rarity: 'common', pts: 3 },
  { id: 'catfish', name: 'Catfish', emoji: '🐡', w: 16, min: 30, max: 70, rarity: 'uncommon', pts: 5 },
  { id: 'bass', name: 'Bass', emoji: '🎣', w: 12, min: 25, max: 60, rarity: 'uncommon', pts: 5 },
  { id: 'carp', name: 'Golden Carp', emoji: '🟡', w: 8, min: 40, max: 85, rarity: 'rare', pts: 12 },
  { id: 'eel', name: 'Midnight Eel', emoji: '🐍', w: 6, min: 50, max: 110, rarity: 'rare', pts: 12 },
  { id: 'arowana', name: 'Arowana', emoji: '🐉', w: 3, min: 60, max: 120, rarity: 'epic', pts: 30 },
  { id: 'boot', name: 'Old Boot', emoji: '🥾', w: 5, min: 20, max: 30, rarity: 'junk', pts: 1 },
];

const FIGHT = { common: 1, uncommon: 1.35, rare: 1.8, epic: 2.4, junk: 0.6 };

/** Host-side roll. rand injectable for tests. */
export function rollFish(rand = Math.random) {
  const total = SPECIES.reduce((s, f) => s + f.w, 0);
  let r = rand() * total;
  let sp = SPECIES[0];
  for (const f of SPECIES) { r -= f.w; if (r <= 0) { sp = f; break; } }
  const size = Math.round(sp.min + rand() * (sp.max - sp.min));
  const biteMs = 2000 + Math.round(rand() * 8000);
  return { species: sp.id, size, rarity: sp.rarity, biteMs };
}

export const speciesInfo = (id) => SPECIES.find((s) => s.id === id);

const HOOK_WINDOW_MS = 750;

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
  }

  get active() { return this.state !== 'idle'; }
  get fishingView() {
    return this.state === 'idle' ? null
      : { bobber: this.bobber, bite: this.state === 'biting' };
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
    // bobber lands in the lake along the shore->center direction, distance by power
    const dx = LAKE.cx - this.playerPos.x, dy = LAKE.cy - this.playerPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const dist = 90 + this.castPower * 200;
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
    const fight = FIGHT[this.pending.rarity] ?? 1;
    this.els.reelGame.classList.remove('hidden');
    this.hooks.setPrompt('REEL! 🎣');
    let pull = 0;
    this.reelAnim = setInterval(() => {
      // fish yanks the tension down in bursts; holding reels it up
      if (Math.random() < 0.06 * fight) pull = 18 + Math.random() * 26 * fight;
      pull *= 0.9;
      this.tension += (this.reelHold ? 2.6 : -1.6) - pull * 0.09;
      this.tension = Math.max(0, Math.min(100, this.tension));
      const inZone = this.tension > 28 && this.tension < 78;
      if (inZone) this.progress += 0.9;
      this.els.reelNeedle.style.left = this.tension + '%';
      this.els.reelProgress.style.width = Math.min(100, this.progress) + '%';
      this.els.reelGame.classList.toggle('danger', !inZone);
      if (this.tension <= 0.5 || this.tension >= 99.5) this._reelEnd(false);
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
