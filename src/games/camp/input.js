// Camp input: floating virtual joystick (touch) + WASD/arrows (desktop &
// headless testing) + the context action button. Consumers read vector()
// each frame and subscribe to action press/release.

export class CampInput {
  constructor(hudEl, actionBtn) {
    this.hud = hudEl;
    this.actionBtn = actionBtn;
    this.keys = new Set();
    this.joy = null; // {baseX, baseY, dx, dy, pointerId, baseEl, nubEl}
    this.onActionDown = null;
    this.onActionUp = null;
    this._listeners = [];

    const on = (el, ev, fn, opts) => {
      el.addEventListener(ev, fn, opts);
      this._listeners.push([el, ev, fn]);
    };

    // --- keyboard
    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === ' ' && !this.actionBtn.classList.contains('hidden')) {
        e.preventDefault();
        this.onActionDown?.();
      }
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key === ' ') this.onActionUp?.();
    });

    // --- floating joystick (left/bottom region, not over the action button)
    on(this.hud, 'pointerdown', (e) => {
      if (e.target.closest('button')) return;
      if (this.joy) return;
      const base = document.createElement('div');
      base.className = 'joy-base';
      const nub = document.createElement('div');
      nub.className = 'joy-nub';
      base.appendChild(nub);
      base.style.left = e.clientX + 'px';
      base.style.top = e.clientY + 'px';
      this.hud.appendChild(base);
      this.joy = { baseX: e.clientX, baseY: e.clientY, dx: 0, dy: 0, pointerId: e.pointerId, baseEl: base, nubEl: nub };
      try { this.hud.setPointerCapture(e.pointerId); } catch { /* ok */ }
    });
    on(this.hud, 'pointermove', (e) => {
      if (!this.joy || e.pointerId !== this.joy.pointerId) return;
      const R = 48;
      let dx = e.clientX - this.joy.baseX;
      let dy = e.clientY - this.joy.baseY;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      this.joy.dx = dx / R;
      this.joy.dy = dy / R;
      this.joy.nubEl.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const releaseJoy = (e) => {
      if (!this.joy || (e.pointerId !== undefined && e.pointerId !== this.joy.pointerId)) return;
      this.joy.baseEl.remove();
      this.joy = null;
    };
    on(this.hud, 'pointerup', releaseJoy);
    on(this.hud, 'pointercancel', releaseJoy);

    // --- action button (press & hold capable)
    on(this.actionBtn, 'pointerdown', (e) => { e.stopPropagation(); this.onActionDown?.(); });
    on(this.actionBtn, 'pointerup', (e) => { e.stopPropagation(); this.onActionUp?.(); });
    on(this.actionBtn, 'pointercancel', () => this.onActionUp?.());
  }

  /** Normalized movement vector from joystick + keys. */
  vector() {
    let x = this.joy?.dx || 0;
    let y = this.joy?.dy || 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  setAction(label) {
    if (label) {
      this.actionBtn.textContent = label;
      this.actionBtn.classList.remove('hidden');
    } else {
      this.actionBtn.classList.add('hidden');
    }
  }

  destroy() {
    for (const [el, ev, fn] of this._listeners) el.removeEventListener(ev, fn);
    this.joy?.baseEl.remove();
    this.joy = null;
  }
}
