// Camp renderer: one full-screen canvas. The static scene is painted ONCE
// into an offscreen background canvas; each frame just crops it through the
// camera and draws the dynamic bits (players, fire, bobbers, night overlay).
//
// frame(now) is manually callable so the sim can be verified without rAF.

import { WORLD, LAKE, FIREPIT, TENT, TREES, nightFactor } from './world.js';

const DPR = Math.min(devicePixelRatio || 1, 2);

export class CampRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.bg.width = WORLD.w;
    this.bg.height = WORLD.h;
    this.cam = { x: WORLD.w / 2, y: WORLD.h / 2 };
    this.glow = makeGlowSprite();
    this.resize();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
  }

  destroy() { removeEventListener('resize', this._onResize); }

  resize() {
    this.canvas.width = Math.round(innerWidth * DPR);
    this.canvas.height = Math.round(innerHeight * DPR);
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
    // world units -> screen px; show ~900 world units across the short side
    this.scale = Math.max(innerWidth, innerHeight) * DPR / 1150;
  }

  /** Paint the static scene (grass, lake, trees, firepit, tent, decor). */
  paintBackground(decor = []) {
    const c = this.bg.getContext('2d');
    const { w, h } = WORLD;
    // grass
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#274a2b');
    g.addColorStop(1, '#1d3a22');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // grass speckle (deterministic)
    c.fillStyle = 'rgba(255,255,255,0.045)';
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w, y = rnd() * h;
      c.fillRect(x, y, 3, rnd() < 0.5 ? 6 : 3);
    }
    // dirt path: tent -> firepit -> shore
    c.strokeStyle = '#5c4a33';
    c.lineWidth = 56;
    c.lineCap = 'round';
    c.globalAlpha = 0.55;
    c.beginPath();
    c.moveTo(TENT.x + TENT.w / 2, TENT.y + TENT.h + 10);
    c.quadraticCurveTo(650, 640, FIREPIT.x, FIREPIT.y + 20);
    c.quadraticCurveTo(1150, 820, LAKE.cx - LAKE.rx + 60, LAKE.cy - 60);
    c.stroke();
    c.globalAlpha = 1;
    // lake: sand ring, then water
    c.fillStyle = '#c9b17c';
    ellipse(c, LAKE.cx, LAKE.cy, LAKE.rx * 1.12, LAKE.ry * 1.12);
    const wg = c.createRadialGradient(LAKE.cx, LAKE.cy, 60, LAKE.cx, LAKE.cy, LAKE.rx);
    wg.addColorStop(0, '#2e6f8e');
    wg.addColorStop(1, '#1d4a63');
    c.fillStyle = wg;
    ellipse(c, LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry);
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.lineWidth = 4;
    c.beginPath();
    c.ellipse(LAKE.cx, LAKE.cy, LAKE.rx - 8, LAKE.ry - 8, 0, 0, Math.PI * 2);
    c.stroke();
    // tent: base + canvas prism + door
    c.fillStyle = '#3d3357';
    c.fillRect(TENT.x - 12, TENT.y + TENT.h - 14, TENT.w + 24, 22);
    c.fillStyle = '#8b7cf6';
    c.beginPath();
    c.moveTo(TENT.x, TENT.y + TENT.h);
    c.lineTo(TENT.x + TENT.w / 2, TENT.y);
    c.lineTo(TENT.x + TENT.w, TENT.y + TENT.h);
    c.closePath();
    c.fill();
    c.fillStyle = '#5d4fb8';
    c.beginPath();
    c.moveTo(TENT.x + TENT.w / 2 - 34, TENT.y + TENT.h);
    c.lineTo(TENT.x + TENT.w / 2, TENT.y + 46);
    c.lineTo(TENT.x + TENT.w / 2 + 34, TENT.y + TENT.h);
    c.closePath();
    c.fill();
    // firepit: stone ring + char
    c.fillStyle = '#2b2b31';
    circle(c, FIREPIT.x, FIREPIT.y, FIREPIT.r);
    c.fillStyle = '#6e6e78';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      circle(c, FIREPIT.x + Math.cos(a) * FIREPIT.r, FIREPIT.y + Math.sin(a) * FIREPIT.r, 11);
    }
    // trees: shadow, trunk, canopy blobs
    for (const t of TREES) {
      c.fillStyle = 'rgba(0,0,0,0.25)';
      ellipse(c, t.x + 6, t.y + t.r * 0.8, t.r * 1.1, t.r * 0.45);
      c.fillStyle = '#5a4630';
      c.fillRect(t.x - 7, t.y - 6, 14, t.r);
      c.fillStyle = '#2f5d33';
      circle(c, t.x, t.y - t.r * 0.5, t.r);
      c.fillStyle = '#3a7241';
      circle(c, t.x - t.r * 0.4, t.y - t.r * 0.25, t.r * 0.62);
      circle(c, t.x + t.r * 0.45, t.y - t.r * 0.35, t.r * 0.55);
    }
    // decor (P4): painted into the background so it costs nothing per frame
    for (const d of decor) drawDecor(c, d);
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.cam.x) * this.scale + this.canvas.width / 2,
      y: (y - this.cam.y) * this.scale + this.canvas.height / 2,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx * DPR - this.canvas.width / 2) / this.scale + this.cam.x,
      y: (sy * DPR - this.canvas.height / 2) / this.scale + this.cam.y,
    };
  }

  /**
   * Draw one frame. players: [{x,y,f,m,name,hue,head,me,fishing}] sorted here
   * by y. world: {fire:{lvl,lit}, tod}.
   */
  frame(now, players, world, extras = {}) {
    const { ctx, canvas, scale } = this;
    const me = players.find((p) => p.me);
    if (me) {
      this.cam.x += (me.x - this.cam.x) * 0.12;
      this.cam.y += (me.y - this.cam.y) * 0.12;
    }
    // clamp camera to world
    const vw = canvas.width / scale, vh = canvas.height / scale;
    this.cam.x = Math.max(vw / 2, Math.min(WORLD.w - vw / 2, this.cam.x));
    this.cam.y = Math.max(vh / 2, Math.min(WORLD.h - vh / 2, this.cam.y));

    const sx = this.cam.x - vw / 2, sy = this.cam.y - vh / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, sx, sy, vw, vh, 0, 0, canvas.width, canvas.height);

    // water shimmer (cheap: two drifting highlight arcs)
    const lp = this.worldToScreen(LAKE.cx, LAKE.cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3 * scale;
    for (let i = 0; i < 2; i++) {
      const ph = now / 1400 + i * 2;
      ctx.beginPath();
      ctx.ellipse(lp.x, lp.y, (LAKE.rx * 0.5 + Math.sin(ph) * 30) * scale,
        (LAKE.ry * 0.5 + Math.cos(ph) * 18) * scale, 0, 0.3 + i, 1.6 + i);
      ctx.stroke();
    }

    // fire
    if (world.fire.lit && world.fire.lvl > 0) this.drawFire(now, world.fire.lvl);

    // players by depth
    for (const p of [...players].sort((a, b) => a.y - b.y)) this.drawPlayer(now, p);

    // bobbers
    for (const p of players) {
      if (p.fishing?.bobber) this.drawBobber(now, p.fishing.bobber, p.fishing.bite);
    }

    // night overlay + fire light
    const nf = nightFactor(world.tod);
    if (nf > 0.02) {
      ctx.fillStyle = `rgba(8, 10, 34, ${0.55 * nf})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (world.fire.lit && world.fire.lvl > 0) {
        const f = this.worldToScreen(FIREPIT.x, FIREPIT.y);
        const r = (120 + world.fire.lvl * 3.4) * scale;
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = nf;
        ctx.drawImage(this.glow, f.x - r, f.y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (extras.after) extras.after(ctx);
  }

  drawFire(now, lvl) {
    const { ctx, scale } = this;
    const f = this.worldToScreen(FIREPIT.x, FIREPIT.y);
    const s = (0.4 + lvl / 100) * scale;
    for (let i = 0; i < 3; i++) {
      const fl = Math.sin(now / 90 + i * 2.1) * 6;
      ctx.fillStyle = ['#ff8c2e', '#ffb52e', '#ffe08a'][i];
      ctx.beginPath();
      ctx.ellipse(f.x + (i - 1) * 9 * s, f.y - (18 + fl) * s * (1 - i * 0.22),
        (14 - i * 3.4) * s, (30 - i * 7 + fl) * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // logs
    ctx.strokeStyle = '#4a3826';
    ctx.lineWidth = 8 * scale;
    ctx.lineCap = 'round';
    for (const a of [0.5, 2.2]) {
      ctx.beginPath();
      ctx.moveTo(f.x - Math.cos(a) * 24 * scale, f.y + 8 * scale - Math.sin(a) * 8 * scale);
      ctx.lineTo(f.x + Math.cos(a) * 24 * scale, f.y + 8 * scale + Math.sin(a) * 8 * scale);
      ctx.stroke();
    }
  }

  drawPlayer(now, p) {
    const { ctx, scale } = this;
    const s = this.worldToScreen(p.x, p.y);
    const waddle = p.m ? Math.sin(now / 110) * 3 * scale : 0;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 24 * scale, 20 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    // legs
    ctx.strokeStyle = '#2c2f3c';
    ctx.lineWidth = 7 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - 7 * scale, s.y + 8 * scale);
    ctx.lineTo(s.x - 7 * scale + waddle, s.y + 24 * scale);
    ctx.moveTo(s.x + 7 * scale, s.y + 8 * scale);
    ctx.lineTo(s.x + 7 * scale - waddle, s.y + 24 * scale);
    ctx.stroke();
    // body
    ctx.fillStyle = `hsl(${p.hue} 45% 45%)`;
    roundRect(ctx, s.x - 15 * scale, s.y - 14 * scale, 30 * scale, 28 * scale, 10 * scale);
    // head: video/initial canvas in a circle
    const hr = 19 * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.x, s.y - 26 * scale, hr, 0, Math.PI * 2);
    ctx.clip();
    if (p.head) ctx.drawImage(p.head, s.x - hr, s.y - 26 * scale - hr, hr * 2, hr * 2);
    else { ctx.fillStyle = `hsl(${p.hue} 40% 30%)`; ctx.fillRect(s.x - hr, s.y - 26 * scale - hr, hr * 2, hr * 2); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.arc(s.x, s.y - 26 * scale, hr, 0, Math.PI * 2);
    ctx.stroke();
    // name
    ctx.font = `600 ${12 * scale}px Outfit, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(p.name, s.x, s.y - 50 * scale);
    // fishing rod
    if (p.fishing) {
      ctx.strokeStyle = '#caa96d';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(s.x + 12 * scale, s.y - 4 * scale);
      ctx.lineTo(s.x + 34 * scale, s.y - 34 * scale);
      ctx.stroke();
    }
  }

  drawBobber(now, bobber, biting) {
    const { ctx, scale } = this;
    const b = this.worldToScreen(bobber.x, bobber.y);
    const dip = biting ? Math.sin(now / 60) * 5 * scale : Math.sin(now / 500) * 2 * scale;
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(b.x, b.y + dip, 6 * scale, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#fdfdf8';
    ctx.beginPath();
    ctx.arc(b.x, b.y + dip, 6 * scale, 0, Math.PI);
    ctx.fill();
    if (biting) {
      ctx.font = `800 ${20 * scale}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd778';
      ctx.fillText('!', b.x, b.y - 14 * scale + dip);
    }
  }
}

// ---------------------------------------------------------------- helpers

function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
  c.fill();
}

function makeGlowSprite() {
  const g = document.createElement('canvas');
  g.width = g.height = 256;
  const c = g.getContext('2d');
  const grad = c.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 170, 60, 0.9)');
  grad.addColorStop(0.4, 'rgba(255, 140, 40, 0.45)');
  grad.addColorStop(1, 'rgba(255, 120, 30, 0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 256, 256);
  return g;
}

function drawDecor(c, d) {
  // P4 items; simple vector stamps keyed by item id
  if (d.item === 'lantern') {
    c.fillStyle = '#caa96d'; c.fillRect(d.x - 3, d.y - 26, 6, 26);
    c.fillStyle = '#ffd778'; circle(c, d.x, d.y - 30, 10);
  } else if (d.item === 'chair') {
    c.fillStyle = '#7c4dff'; c.fillRect(d.x - 16, d.y - 20, 32, 6);
    c.fillRect(d.x - 16, d.y - 20, 6, 30); c.fillRect(d.x + 10, d.y - 20, 6, 30);
    c.fillRect(d.x - 16, d.y - 34, 6, 16);
  } else if (d.item === 'lights') {
    c.strokeStyle = '#caa96d'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(d.x - 60, d.y); c.quadraticCurveTo(d.x, d.y + 26, d.x + 60, d.y); c.stroke();
    for (let i = -2; i <= 2; i++) {
      c.fillStyle = ['#f472b6', '#22d3ee', '#ffd778', '#34d399', '#8b7cf6'][i + 2];
      circle(c, d.x + i * 26, d.y + 18 - Math.abs(i) * 6, 5);
    }
  } else if (d.item === 'flag') {
    c.fillStyle = '#caa96d'; c.fillRect(d.x - 2, d.y - 44, 4, 44);
    c.fillStyle = '#f472b6';
    c.beginPath(); c.moveTo(d.x + 2, d.y - 44); c.lineTo(d.x + 30, d.y - 36); c.lineTo(d.x + 2, d.y - 28);
    c.closePath(); c.fill();
  }
}
