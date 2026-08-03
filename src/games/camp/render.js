// Camp renderer, map-driven. Static scenery paints ONCE per map/decor/gear
// change into an offscreen layer; each frame crops it through the camera and
// draws dynamics (players, truck, fire, bobbers, weather, night).
//
// frame(now, ...) is manually callable so the sim verifies without rAF.

import { WORLD, nightFactor } from './world.js';

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
    this.snow = null;     // lazily built particle arrays
    this.fireflies = null;
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
    this.scale = Math.max(innerWidth, innerHeight) * DPR / 1150;
  }

  /** Paint the static scene for a map. */
  paintBackground(map, decor = [], unlocked = []) {
    this.map = map;
    const c = this.bg.getContext('2d');
    const { w, h } = WORLD;
    const P = map.palette;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, P.grassTop);
    g.addColorStop(1, P.grassBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // speckle
    c.fillStyle = 'rgba(255,255,255,0.05)';
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 900; i++) c.fillRect(rnd() * w, rnd() * h, 3, rnd() < 0.5 ? 6 : 3);
    // path: tent -> firepit -> water-ish
    c.strokeStyle = P.path;
    c.lineWidth = 56;
    c.lineCap = 'round';
    c.globalAlpha = 0.55;
    c.beginPath();
    c.moveTo(map.tent.x + map.tent.w / 2, map.tent.y + map.tent.h + 10);
    c.quadraticCurveTo(650, 640, map.firepit.x, map.firepit.y + 20);
    c.quadraticCurveTo(1150, 860, 1250, 1000);
    c.stroke();
    c.globalAlpha = 1;

    this.drawWater(c, map);
    this.drawTent(c, map.tent);
    this.drawFirepit(c, map.firepit);
    this.drawMarket(c, map.market);
    this.drawRoadSign(c, map.roadSign);
    for (const t of map.trees) drawTree(c, t, P);
    if (unlocked.includes('truck')) drawTruckBody(c, map.truckSpot.x, map.truckSpot.y + map.truckSpot.h, 1);
    for (const d of decor) if (!d.spot || d.spot === map.id) drawDecor(c, d);
  }

  drawWater(c, map) {
    const wtr = map.water;
    if (wtr.type === 'lake' || wtr.type === 'frozen') {
      c.fillStyle = wtr.sand;
      ellipse(c, wtr.cx, wtr.cy, wtr.rx * 1.12, wtr.ry * 1.12);
      const wg = c.createRadialGradient(wtr.cx, wtr.cy, 60, wtr.cx, wtr.cy, wtr.rx);
      wg.addColorStop(0, wtr.colors[0]);
      wg.addColorStop(1, wtr.colors[1]);
      c.fillStyle = wg;
      ellipse(c, wtr.cx, wtr.cy, wtr.rx, wtr.ry);
      if (wtr.type === 'frozen') {
        // ice sheen + cracks + drilled holes
        c.strokeStyle = 'rgba(255,255,255,0.5)';
        c.lineWidth = 3;
        for (let i = 0; i < 5; i++) {
          c.beginPath();
          c.moveTo(wtr.cx - wtr.rx * 0.7 + i * 140, wtr.cy - 60 + (i % 2) * 90);
          c.lineTo(wtr.cx - wtr.rx * 0.4 + i * 150, wtr.cy + 40 + (i % 3) * 40);
          c.stroke();
        }
        for (const hle of wtr.holes) {
          c.fillStyle = '#0e2f44';
          circle(c, hle.x, hle.y, hle.r);
          c.strokeStyle = '#f0f6fa';
          c.lineWidth = 6;
          c.beginPath();
          c.arc(hle.x, hle.y, hle.r + 4, 0, Math.PI * 2);
          c.stroke();
        }
      }
    } else if (wtr.type === 'river') {
      c.lineCap = 'round';
      for (const [width, color] of [[wtr.halfW * 2 + 70, wtr.sand], [wtr.halfW * 2, wtr.colors[0]], [wtr.halfW * 1.2, wtr.colors[1]]]) {
        c.strokeStyle = color;
        c.lineWidth = width;
        c.beginPath();
        for (let x = -40; x <= WORLD.w + 40; x += 40) {
          const y = wtr.cy + Math.sin(x * wtr.k * Math.PI) * wtr.amp;
          x === -40 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
      }
    } else if (wtr.type === 'ocean') {
      // sand strip then sea to the bottom edge
      c.fillStyle = wtr.sand;
      c.fillRect(0, wtr.base - 160, WORLD.w, WORLD.h);
      const og = c.createLinearGradient(0, wtr.base, 0, WORLD.h);
      og.addColorStop(0, wtr.colors[0]);
      og.addColorStop(1, wtr.colors[1]);
      c.fillStyle = og;
      c.beginPath();
      c.moveTo(0, WORLD.h);
      for (let x = 0; x <= WORLD.w; x += 40) {
        c.lineTo(x, wtr.base + Math.sin(x * wtr.k * Math.PI) * wtr.amp);
      }
      c.lineTo(WORLD.w, WORLD.h);
      c.closePath();
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 5;
      c.beginPath();
      for (let x = 0; x <= WORLD.w; x += 40) {
        const y = wtr.base + Math.sin(x * wtr.k * Math.PI) * wtr.amp + 14;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    }
  }

  drawTent(c, t) {
    c.fillStyle = '#3d3357';
    c.fillRect(t.x - 12, t.y + t.h - 14, t.w + 24, 22);
    c.fillStyle = '#8b7cf6';
    tri(c, t.x, t.y + t.h, t.x + t.w / 2, t.y, t.x + t.w, t.y + t.h);
    c.fillStyle = '#5d4fb8';
    tri(c, t.x + t.w / 2 - 34, t.y + t.h, t.x + t.w / 2, t.y + 46, t.x + t.w / 2 + 34, t.y + t.h);
  }

  drawFirepit(c, f) {
    c.fillStyle = '#2b2b31';
    circle(c, f.x, f.y, f.r);
    c.fillStyle = '#6e6e78';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      circle(c, f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r, 11);
    }
  }

  drawMarket(c, M) {
    c.fillStyle = '#6b4f33';
    c.fillRect(M.x, M.y + 46, M.w, M.h - 46);
    c.fillStyle = '#4e3a26';
    c.fillRect(M.x - 6, M.y + 42, M.w + 12, 12);
    for (let i = 0; i <= 6; i++) {
      c.fillStyle = i % 2 ? '#c94f4f' : '#f0e6d2';
      c.fillRect(M.x - 10 + i * ((M.w + 20) / 7), M.y, (M.w + 20) / 7, 34);
    }
    c.fillStyle = '#2b2b31';
    c.fillRect(M.x + M.w / 2 - 34, M.y - 26, 68, 22);
    c.fillStyle = '#ffd778';
    c.font = '700 17px Outfit, system-ui';
    c.textAlign = 'center';
    c.fillText('🪙 MARKET', M.x + M.w / 2, M.y - 9);
  }

  drawRoadSign(c, s) {
    // dirt pull-off + signpost at the map edge
    c.fillStyle = 'rgba(90, 74, 51, 0.6)';
    c.fillRect(0, s.y - 90, 150, 180);
    c.fillStyle = '#caa96d';
    c.fillRect(s.x - 4, s.y - 60, 8, 60);
    c.fillStyle = '#2b2b31';
    c.fillRect(s.x - 42, s.y - 92, 84, 34);
    c.fillStyle = '#ffd778';
    c.font = '700 15px Outfit, system-ui';
    c.textAlign = 'center';
    c.fillText('🗺️ ROAD', s.x, s.y - 69);
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

  /** players view list; world {fire, tod}; truck {x,y,dir,driving,heads:[canvas]} | null. */
  frame(now, players, world, truck = null) {
    const { ctx, canvas, scale } = this;
    const map = this.map;
    if (!map) return;
    const me = players.find((p) => p.me);
    const focus = me?.driving && truck ? truck : me;
    if (focus) {
      this.cam.x += (focus.x - this.cam.x) * 0.12;
      this.cam.y += (focus.y - this.cam.y) * 0.12;
    }
    const vw = canvas.width / scale, vh = canvas.height / scale;
    this.cam.x = Math.max(vw / 2, Math.min(WORLD.w - vw / 2, this.cam.x));
    this.cam.y = Math.max(vh / 2, Math.min(WORLD.h - vh / 2, this.cam.y));

    const sx = this.cam.x - vw / 2, sy = this.cam.y - vh / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.bg, sx, sy, vw, vh, 0, 0, canvas.width, canvas.height);

    this.waterShimmer(now, map);
    if (world.fire.lit && world.fire.lvl > 0) this.drawFire(now, world.fire.lvl, map.firepit);

    // depth sort: players + (parked/driving truck occupants ride the sprite)
    for (const p of [...players].sort((a, b) => a.y - b.y)) {
      if (!p.hidden) this.drawPlayer(now, p);
    }
    if (truck && truck.driving) this.drawDrivingTruck(now, truck);

    for (const p of players) {
      if (p.fishing?.bobber) this.drawBobber(now, p.fishing.bobber, p.fishing.bite);
    }

    this.weather(now, map, world);
    this.nightAndLight(now, map, world);
  }

  waterShimmer(now, map) {
    const { ctx, scale } = this;
    const wtr = map.water;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3 * scale;
    if (wtr.type === 'lake') {
      const lp = this.worldToScreen(wtr.cx, wtr.cy);
      for (let i = 0; i < 2; i++) {
        const ph = now / 1400 + i * 2;
        ctx.beginPath();
        ctx.ellipse(lp.x, lp.y, (wtr.rx * 0.5 + Math.sin(ph) * 30) * scale,
          (wtr.ry * 0.5 + Math.cos(ph) * 18) * scale, 0, 0.3 + i, 1.6 + i);
        ctx.stroke();
      }
    } else if (wtr.type === 'ocean') {
      // rolling foam line
      ctx.beginPath();
      for (let x = 0; x <= WORLD.w; x += 60) {
        const y = wtr.base + Math.sin(x * wtr.k * Math.PI) * wtr.amp + 14 + Math.sin(now / 700 + x * 0.01) * 8;
        const p = this.worldToScreen(x, y);
        x === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  weather(now, map, world) {
    const { ctx, canvas } = this;
    if (map.features.snow) {
      if (!this.snow) {
        this.snow = Array.from({ length: 46 }, (_, i) => ({
          x: (i * 97) % 100 / 100, y: (i * 61) % 100 / 100, s: 1.5 + (i % 3), v: 22 + (i % 5) * 9,
        }));
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const f of this.snow) {
        const y = ((f.y + now / 1000 * f.v / 800) % 1) * canvas.height;
        const x = (f.x + Math.sin(now / 900 + f.s) * 0.01) * canvas.width;
        ctx.fillRect(x, y, f.s * DPR, f.s * DPR);
      }
    }
    if (map.features.fireflies && nightFactor(world.tod) > 0.4) {
      if (!this.fireflies) {
        this.fireflies = Array.from({ length: 14 }, (_, i) => ({
          x: (i * 137) % 100 / 100, y: (i * 83) % 100 / 100, p: i * 1.7,
        }));
      }
      for (const f of this.fireflies) {
        const a = 0.3 + 0.5 * Math.abs(Math.sin(now / 800 + f.p));
        ctx.fillStyle = `rgba(212, 255, 120, ${a})`;
        circle(ctx, (f.x + Math.sin(now / 2100 + f.p) * 0.02) * canvas.width,
          (f.y + Math.cos(now / 2600 + f.p) * 0.02) * canvas.height, 2.5 * DPR);
      }
    }
  }

  nightAndLight(now, map, world) {
    const { ctx, canvas, scale } = this;
    const nf = nightFactor(world.tod);
    if (nf <= 0.02) return;
    if (map.features.sunset && nf < 0.7) {
      // beach dusk glows orange before going dark
      ctx.fillStyle = `rgba(240, 110, 40, ${0.28 * (nf / 0.7)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = `rgba(8, 10, 34, ${0.55 * nf})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (map.features.aurora && nf > 0.6) {
      ctx.globalCompositeOperation = 'screen';
      for (let band = 0; band < 3; band++) {
        ctx.strokeStyle = `hsla(${140 + band * 40 + Math.sin(now / 3000) * 20}, 80%, 60%, 0.14)`;
        ctx.lineWidth = (26 - band * 6) * DPR;
        ctx.beginPath();
        for (let x = 0; x <= canvas.width; x += 30) {
          const y = canvas.height * (0.12 + band * 0.05)
            + Math.sin(x / 140 + now / 1600 + band * 2) * 34 * DPR;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (world.fire.lit && world.fire.lvl > 0) {
      const f = this.worldToScreen(map.firepit.x, map.firepit.y);
      const r = (120 + world.fire.lvl * 3.4) * scale;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = nf;
      ctx.drawImage(this.glow, f.x - r, f.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawFire(now, lvl, pit) {
    const { ctx, scale } = this;
    const f = this.worldToScreen(pit.x, pit.y);
    const s = (0.4 + lvl / 100) * scale;
    for (let i = 0; i < 3; i++) {
      const fl = Math.sin(now / 90 + i * 2.1) * 6;
      ctx.fillStyle = ['#ff8c2e', '#ffb52e', '#ffe08a'][i];
      ctx.beginPath();
      ctx.ellipse(f.x + (i - 1) * 9 * s, f.y - (18 + fl) * s * (1 - i * 0.22),
        (14 - i * 3.4) * s, (30 - i * 7 + fl) * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPlayer(now, p) {
    const { ctx, scale } = this;
    const s = this.worldToScreen(p.x, p.y);
    const waddle = p.m ? Math.sin(now / 110) * 3 * scale : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 24 * scale, 20 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2c2f3c';
    ctx.lineWidth = 7 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - 7 * scale, s.y + 8 * scale);
    ctx.lineTo(s.x - 7 * scale + waddle, s.y + 24 * scale);
    ctx.moveTo(s.x + 7 * scale, s.y + 8 * scale);
    ctx.lineTo(s.x + 7 * scale - waddle, s.y + 24 * scale);
    ctx.stroke();
    ctx.fillStyle = `hsl(${p.hue} 45% 45%)`;
    roundRect(ctx, s.x - 15 * scale, s.y - 14 * scale, 30 * scale, 28 * scale, 10 * scale);
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
    ctx.font = `600 ${12 * scale}px Outfit, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(p.name, s.x, s.y - 50 * scale);
    if (p.fishing) {
      ctx.strokeStyle = '#caa96d';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(s.x + 12 * scale, s.y - 4 * scale);
      ctx.lineTo(s.x + 34 * scale, s.y - 34 * scale);
      ctx.stroke();
    }
  }

  drawDrivingTruck(now, truck) {
    const { ctx, scale } = this;
    const s = this.worldToScreen(truck.x, truck.y);
    const bob = Math.sin(now / 120) * 2 * scale;
    ctx.save();
    ctx.translate(s.x, s.y + bob);
    if (truck.dir < 0) ctx.scale(-1, 1);
    ctx.scale(scale, scale);
    drawTruckBody(ctx, -115, 60, 1);
    // occupants' faces in the windows
    (truck.heads || []).forEach((head, i) => {
      const hx = 44 - i * 52, hy = -44;
      ctx.save();
      ctx.beginPath();
      ctx.arc(hx, hy, 16, 0, Math.PI * 2);
      ctx.clip();
      if (head) ctx.drawImage(head, hx - 16, hy - 16, 32, 32);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 16, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
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
function tri(c, x1, y1, x2, y2, x3, y3) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); c.fill();
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
  c.fill();
}

function drawTree(c, t, P) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  ellipse(c, t.x + 6, t.y + t.r * 0.8, t.r * 1.1, t.r * 0.45);
  if (t.palm) {
    c.strokeStyle = P.trunk;
    c.lineWidth = 12;
    c.beginPath();
    c.moveTo(t.x, t.y + t.r * 0.7);
    c.quadraticCurveTo(t.x + 14, t.y - t.r * 0.4, t.x + 4, t.y - t.r);
    c.stroke();
    c.strokeStyle = P.canopy[0];
    c.lineWidth = 9;
    c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * Math.PI - Math.PI * 0.05;
      c.beginPath();
      c.moveTo(t.x + 4, t.y - t.r);
      c.quadraticCurveTo(
        t.x + 4 + Math.cos(a) * t.r * 0.9, t.y - t.r - Math.sin(a) * t.r * 0.5 - 14,
        t.x + 4 + Math.cos(a) * t.r * 1.35, t.y - t.r - Math.sin(a) * t.r * 0.25 + 16);
      c.stroke();
    }
  } else {
    c.fillStyle = P.trunk;
    c.fillRect(t.x - 7, t.y - 6, 14, t.r);
    c.fillStyle = P.canopy[0];
    circle(c, t.x, t.y - t.r * 0.5, t.r);
    c.fillStyle = P.canopy[1];
    circle(c, t.x - t.r * 0.4, t.y - t.r * 0.25, t.r * 0.62);
    circle(c, t.x + t.r * 0.45, t.y - t.r * 0.35, t.r * 0.55);
  }
}

/** Truck drawn with its rear-left at (x, yBottom). Shared by parked + driving. */
export function drawTruckBody(c, x, yBottom, s = 1) {
  const w = 230 * s, h = 120 * s;
  const y = yBottom - h;
  c.fillStyle = '#3f6f8f';
  c.fillRect(x + 10, y + h - 58, w - 20, 34);
  c.fillStyle = '#345d78';
  c.fillRect(x + w - 74, y + h - 84, 60, 28);
  c.fillStyle = '#9fd3ee';
  c.fillRect(x + w - 66, y + h - 79, 34, 18);
  c.fillStyle = '#1b1b20';
  circle(c, x + 42, y + h - 20, 16);
  circle(c, x + w - 46, y + h - 20, 16);
  c.fillStyle = '#6e6e78';
  circle(c, x + 42, y + h - 20, 7);
  circle(c, x + w - 46, y + h - 20, 7);
  c.fillStyle = '#d97941';
  tri(c, x + 16, y + h - 58, x + 58, y + h - 96, x + 100, y + h - 58);
  c.fillStyle = '#b85f2e';
  tri(c, x + 40, y + h - 58, x + 58, y + h - 80, x + 76, y + h - 58);
}

function drawDecor(c, d) {
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
    tri(c, d.x + 2, d.y - 44, d.x + 30, d.y - 36, d.x + 2, d.y - 28);
  }
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
