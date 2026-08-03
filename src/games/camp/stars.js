// Stargazing (P4): a full-screen night-sky overlay where both players trace
// constellations with their finger/cursor. Star layouts are normalized 0-1;
// touching stars in order completes the constellation. Remote traces arrive
// as starTrace acts and paint a partner glow.

export const CONSTELLATIONS = [
  { id: 'heart', name: 'The Heart', stars: [[0.5, 0.30], [0.40, 0.22], [0.32, 0.30], [0.38, 0.42], [0.5, 0.52], [0.62, 0.42], [0.68, 0.30], [0.60, 0.22]] },
  { id: 'fish', name: 'The Fish', stars: [[0.2, 0.6], [0.32, 0.52], [0.45, 0.55], [0.55, 0.65], [0.45, 0.72], [0.32, 0.7], [0.62, 0.58], [0.68, 0.72]] },
  { id: 'tent', name: 'The Tent', stars: [[0.3, 0.8], [0.5, 0.55], [0.7, 0.8], [0.44, 0.8], [0.5, 0.68], [0.56, 0.8]] },
  { id: 'campfire', name: 'The Ember', stars: [[0.5, 0.35], [0.44, 0.45], [0.5, 0.55], [0.56, 0.45], [0.5, 0.25]] },
];

const HIT_R = 0.045;

export class StarView {
  /** hooks: { onTrace(x, y), onComplete(id), done(), toast } */
  constructor(el, hooks) {
    this.el = el; // #starView, contains a canvas #starCanvas + close btn
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.hooks = hooks;
    this.partner = null; // {x, y, at}
    this.open = false;
  }

  show(completedIds) {
    this.open = true;
    this.completed = new Set(completedIds);
    this.target = CONSTELLATIONS.find((c) => !this.completed.has(c.id)) || null;
    this.hit = new Set();
    this.el.classList.remove('hidden');
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
    // deterministic background stars
    this.bgStars = [];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 140; i++) this.bgStars.push({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.6 });
    this._move = (e) => this.trace(e.clientX / innerWidth, e.clientY / innerHeight, true);
    this.canvas.addEventListener('pointermove', this._move);
    this.canvas.addEventListener('pointerdown', this._move);
    this.paint(0);
  }

  hide() {
    this.open = false;
    this.canvas.removeEventListener('pointermove', this._move);
    this.canvas.removeEventListener('pointerdown', this._move);
    this.el.classList.add('hidden');
    this.hooks.done();
  }

  /** Local or remote (mine=false) cursor at normalized (x, y). */
  trace(x, y, mine) {
    if (!this.open) return;
    if (mine) this.hooks.onTrace(x, y);
    else this.partner = { x, y, at: Date.now() };
    if (mine && this.target) {
      this.target.stars.forEach(([sx, sy], i) => {
        if (!this.hit.has(i) && Math.hypot(x - sx, y - sy) < HIT_R) {
          this.hit.add(i);
          if (this.hit.size === this.target.stars.length) {
            const id = this.target.id;
            this.completed.add(id);
            this.hooks.onComplete(id);
            this.target = CONSTELLATIONS.find((c) => !this.completed.has(c.id)) || null;
            this.hit = new Set();
          }
        }
      });
    }
    this.paint(performance.now());
  }

  paint(now) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#05071f';
    ctx.fillRect(0, 0, W, H);
    for (const s of this.bgStars) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.3 * Math.sin(now / 900 + s.x * 20)})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // completed constellations: faint gold outlines
    for (const c of CONSTELLATIONS) {
      if (!this.completed.has(c.id)) continue;
      ctx.strokeStyle = 'rgba(255, 214, 110, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      c.stars.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.stroke();
    }
    // target constellation
    if (this.target) {
      this.target.stars.forEach(([x, y], i) => {
        const hitIt = this.hit.has(i);
        ctx.fillStyle = hitIt ? '#ffd778' : 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(x * W, y * H, hitIt ? 7 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
      // connect hit stars in order
      ctx.strokeStyle = 'rgba(255, 214, 110, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      this.target.stars.forEach(([x, y], i) => {
        if (!this.hit.has(i)) return;
        if (started) ctx.lineTo(x * W, y * H);
        else { ctx.moveTo(x * W, y * H); started = true; }
      });
      ctx.stroke();
      ctx.font = '300 16px Outfit, system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`trace ${this.target.name} together`, W / 2, H - 60);
    } else {
      ctx.font = '300 18px Outfit, system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('You found every constellation ✨', W / 2, H / 2);
    }
    // partner cursor glow
    if (this.partner && Date.now() - this.partner.at < 2500) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
      ctx.beginPath();
      ctx.arc(this.partner.x * W, this.partner.y * H, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
