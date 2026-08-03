// Campfire activities: chopping wood, striking a cold fire, feeding it,
// roasting marshmallows (P3), grilling catches (P3). Fire *state* lives in
// the host's world sim; this module owns the local minigames + inventory.

export const FEED_AMOUNT = 20;
export const STRIKE_LIGHT_LVL = 35;
const CHOP_COOLDOWN_MS = 2500;
const AXE_COOLDOWN_MS = 1200;

export class FireActions {
  /**
   * hooks: { sendAct(kind, extra), toast(msg, ms, kind), setPrompt(l),
   *          fireState() -> {lvl, lit}, onWood(count) }
   */
  constructor(els, hooks) {
    this.els = els; // {strikeGame, strikeSpark, strikeZone, roastGame, roastMallow, roastFill}
    this.hooks = hooks;
    this.wood = 0;
    this.sessionFish = []; // catches this session, grillable
    this.lastChop = 0;
    this.mode = null; // null | 'strike' | 'roast' | 'grill'
    this.timers = [];
  }

  get active() { return this.mode !== null; }
  _t(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

  /** Label for the action button when near the firepit. Priority: light it,
   *  keep it alive when it's fading, then cook, then snack. */
  firepitLabel() {
    const f = this.hooks.fireState();
    if (!f.lit) return 'STRIKE 🔥';
    if (this.wood > 0 && f.lvl < 70) return 'ADD WOOD 🪵';
    if (this.sessionFish.length > 0) return 'GRILL 🐟';
    if (this.wood > 0) return 'ADD WOOD 🪵';
    return 'ROAST 🍡';
  }

  chop() {
    const hasAxe = this.hooks.hasGear?.('axe');
    const now = Date.now();
    if (now - this.lastChop < (hasAxe ? AXE_COOLDOWN_MS : CHOP_COOLDOWN_MS)) return;
    this.lastChop = now;
    const bonus = (this.hooks.mapWoodBonus?.() || 0) + (hasAxe ? 1 : 0);
    this.wood += 1 + bonus + (Math.random() < 0.3 ? 1 : 0);
    this.hooks.onWood(this.wood);
    this.hooks.toast(`${hasAxe ? '🪓' : ''}+ wood 🪵 (${this.wood})`, 1200, 'info');
  }

  /** Action pressed near the firepit — routes by the same priority as the label. */
  firepitAction() {
    const f = this.hooks.fireState();
    if (this.mode === 'strike') return this._strikeTap();
    if (!f.lit) return this._startStrike();
    if (this.wood > 0 && f.lvl < 70) return this._feed();
    if (this.sessionFish.length > 0) return this._grill();
    if (this.wood > 0) return this._feed();
    return this._startRoast();
  }

  actionUp() {
    if (this.mode === 'roast') this._roastRelease();
  }

  _feed() {
    this.wood -= 1;
    this.hooks.onWood(this.wood);
    this.hooks.sendAct('feed');
    this.hooks.toast('🔥 fed the fire', 1200, 'info');
  }

  // --- strike: tap when the spark crosses the zone, 3 hits lights it
  _startStrike() {
    this.mode = 'strike';
    this.strikeHits = 0;
    this.els.strikeGame.classList.remove('hidden');
    this.hooks.setPrompt('STRIKE! ⚡');
    this.sparkT = 0;
    this.strikeAnim = setInterval(() => {
      this.sparkT = (this.sparkT + 0.022) % 1;
      this.els.strikeSpark.style.left = this.sparkT * 100 + '%';
    }, 16);
  }

  _strikeTap() {
    // zone sits at 40-60%
    if (this.sparkT > 0.38 && this.sparkT < 0.62) {
      this.strikeHits += 1;
      this.els.strikeGame.classList.add('hit');
      this._t(() => this.els.strikeGame.classList.remove('hit'), 150);
      if (this.strikeHits >= 3) {
        this._endStrike();
        this.hooks.sendAct('strike');
        this.hooks.toast('🔥 Fire lit!', 1800, 'info');
      }
    } else {
      this.strikeHits = Math.max(0, this.strikeHits - 1);
    }
  }

  _endStrike() {
    clearInterval(this.strikeAnim);
    this.els.strikeGame.classList.add('hidden');
    this.mode = null;
    this.hooks.setPrompt(null);
  }

  // --- roast: hold to cook; release in the golden band
  _startRoast() {
    const f = this.hooks.fireState();
    this.mode = 'roast';
    this.roastP = 0;
    this.els.roastGame.classList.remove('hidden');
    this.hooks.setPrompt('HOLD… 🍡');
    const speed = 0.55 + (f.lvl / 100) * 0.75; // hotter fire cooks faster
    this.roastAnim = setInterval(() => {
      this.roastP += speed;
      this.els.roastFill.style.width = Math.min(100, this.roastP) + '%';
      const m = this.els.roastMallow;
      m.textContent = this.roastP < 55 ? '⚪' : this.roastP <= 82 ? '🟤' : '⬛';
      if (this.roastP >= 100) this._roastRelease();
    }, 50);
  }

  _roastRelease() {
    if (this.mode !== 'roast') return;
    clearInterval(this.roastAnim);
    this.els.roastGame.classList.add('hidden');
    this.mode = null;
    this.hooks.setPrompt(null);
    const p = this.roastP;
    const result = p < 55 ? 'raw' : p <= 82 ? 'golden' : 'burnt';
    this.hooks.sendAct('roastDone', { result });
    this.hooks.toast(result === 'golden' ? 'Perfect golden marshmallow! 🍡✨'
      : result === 'raw' ? 'Still raw… 🍡❄️' : 'Burnt to a crisp 🍡🔥', 2200, 'info');
  }

  // --- grill a session catch
  _grill() {
    const fish = this.sessionFish.shift();
    this.mode = 'grill';
    this.hooks.setPrompt('GRILLING…');
    this.hooks.toast('🐟 on the grill…', 1500, 'info');
    this._t(() => {
      this.mode = null;
      this.hooks.setPrompt(null);
      this.hooks.sendAct('grill', { species: fish.species, size: fish.size });
    }, 3500);
  }

  cancel() {
    clearInterval(this.strikeAnim);
    clearInterval(this.roastAnim);
    for (const t of this.timers.splice(0)) clearTimeout(t);
    this.els.strikeGame.classList.add('hidden');
    this.els.roastGame.classList.add('hidden');
    this.mode = null;
  }
}
