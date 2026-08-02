// Table-mode avatars.
//
// Humans: their live video feed, center-cover cropped into the circle (no
// background removal — cheaper on phones and more legible).
// Bots: a generic animated "feed" drawn on canvas.
// Humans with no video available: initial-letter avatar.
//
// Rendering is throttled (~15fps) and small (192px) so 2-4 feeds stay cheap.

const SIZE = 192;
const FPS_MS = 66;

export class AvatarSystem {
  constructor() {
    this.entries = [];      // {canvas, ctx, kind: 'video'|'bot'|'initial', video?, mirror, hue, label}
    this.running = false;
    this.lastTick = 0;
  }

  /** entries: [{canvas, kind, video, mirror, hue, label}] — canvas is the visible element. */
  setEntries(entries) {
    this.entries = entries.map((e) => {
      e.canvas.width = e.canvas.height = SIZE;
      return { ...e, ctx: e.canvas.getContext('2d') };
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame((t) => this._tick(t));
  }

  stop() { this.running = false; }

  _tick(t) {
    if (!this.running) return;
    if (t - this.lastTick >= FPS_MS) {
      this.lastTick = t;
      for (const e of this.entries) this._render(e, t);
    }
    requestAnimationFrame((tt) => this._tick(tt));
  }

  _render(e, t) {
    if (e.kind === 'bot') return this._renderBot(e, t);
    if (e.kind === 'video' && e.video && e.video.readyState >= 2 && e.video.videoWidth) {
      return this._renderVideo(e);
    }
    return this._renderInitial(e, t);
  }

  _renderVideo(e) {
    const c = e.ctx;
    const vw = e.video.videoWidth, vh = e.video.videoHeight;
    const s = Math.min(vw, vh); // center-cover square crop
    c.clearRect(0, 0, SIZE, SIZE);
    c.save();
    if (e.mirror) { c.translate(SIZE, 0); c.scale(-1, 1); }
    c.drawImage(e.video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SIZE, SIZE);
    c.restore();
  }

  _renderBot(e, t) {
    const c = e.ctx, m = SIZE / 2;
    const bob = Math.sin(t / 480) * 6;
    const tilt = Math.sin(t / 900) * 0.06;
    c.clearRect(0, 0, SIZE, SIZE);
    const g = c.createRadialGradient(m, m, 10, m, m, m);
    g.addColorStop(0, `hsl(${e.hue} 45% 32%)`);
    g.addColorStop(1, `hsl(${e.hue} 55% 14%)`);
    c.fillStyle = g;
    c.fillRect(0, 0, SIZE, SIZE);
    // scanline shimmer so it reads as a "feed", not a sticker
    c.fillStyle = 'rgba(255,255,255,0.05)';
    const ly = (t / 14) % SIZE;
    c.fillRect(0, ly, SIZE, 3);
    c.save();
    c.translate(m, m + bob);
    c.rotate(tilt);
    c.font = `${SIZE * 0.46}px system-ui`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('🤖', 0, 0);
    c.restore();
  }

  _renderInitial(e, t) {
    const c = e.ctx, m = SIZE / 2;
    c.clearRect(0, 0, SIZE, SIZE);
    c.fillStyle = `hsl(${e.hue} 40% 26%)`;
    c.fillRect(0, 0, SIZE, SIZE);
    c.fillStyle = '#e8eef7';
    c.font = `700 ${SIZE * 0.42}px system-ui`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText((e.label || '?')[0].toUpperCase(), m, m + Math.sin(t / 600) * 2);
  }
}
