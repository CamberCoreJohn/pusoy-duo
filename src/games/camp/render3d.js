// Low-poly 3D renderer (Three.js). Satisfies the same interface as
// render2d.js, so the sim/net/HUD are unchanged.
//
// Mapping: world x -> scene x, world y -> scene z, height is scene y.
// Everything is procedural geometry — no external assets, no build step.
// Flat-shaded lambert materials give the cozy Animal-Crossing-ish look
// cheaply enough to run beside a live video call.

import { nightFactor } from './world.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

let THREE = null;

const TIER = {
  low: { shadows: false, treeSeg: 5, pixelRatio: 1, particles: 0 },
  med: { shadows: false, treeSeg: 6, pixelRatio: 1.25, particles: 40 },
  high: { shadows: true, treeSeg: 8, pixelRatio: 1.5, particles: 80 },
};

const hex = (s) => new THREE.Color(s);

export class CampRenderer3D {
  static async create(canvas, tier = 'med') {
    THREE = await import(THREE_URL);
    return new CampRenderer3D(canvas, tier);
  }

  constructor(canvas, tier) {
    this.canvas = canvas;
    this.q = TIER[tier] || TIER.med;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: tier === 'high', alpha: false,
      powerPreference: 'low-power', preserveDrawingBuffer: true, // debug pixel probes
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.shadowMap.enabled = this.q.shadows;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fc4d8, 900, 2600);
    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 6000);
    this.camGoal = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    // lighting: hemisphere ambient + a sun that swings with the clock
    // bright and cheerful: cozy games want an overexposed midday, not realism
    this.hemi = new THREE.HemisphereLight(0xdcefff, 0x6b7d55, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.5);
    this.sun.castShadow = this.q.shadows;
    if (this.q.shadows) {
      this.sun.shadow.mapSize.set(1024, 1024);
      const c = this.sun.shadow.camera;
      c.left = -900; c.right = 900; c.top = 900; c.bottom = -900; c.far = 3000;
    }
    this.scene.add(this.sun);
    this.sun.target = new THREE.Object3D();
    this.scene.add(this.sun.target);
    this.fireLight = new THREE.PointLight(0xff8c2e, 0, 900, 2);
    this.scene.add(this.fireLight);

    this.staticRoot = new THREE.Group();   // rebuilt on paintBackground
    this.dynamicRoot = new THREE.Group();  // players, bobbers, truck, fx
    this.scene.add(this.staticRoot, this.dynamicRoot);

    this.playerNodes = new Map();  // name -> {group, head, tex, body, rod}
    this.transients = [];
    this.headlights = null;
    this.truckNode = null;
    this.bobbers = [];
    this.decor = [];
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.resize();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
  }

  destroy() {
    removeEventListener('resize', this._onResize);
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose?.();
    });
    this.renderer.dispose();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- static

  /** Rebuild the world's scenery. Same signature as the 2D renderer. */
  paintBackground(map, decor = [], unlocked = []) {
    this.map = map;
    this.decor = decor;
    this.unlocked = unlocked;
    const root = this.staticRoot;
    root.clear();
    const P = map.palette;

    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000, 1, 1),
      new THREE.MeshLambertMaterial({ color: hex(P.grassTop) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(1000, 0, 750);
    ground.receiveShadow = this.q.shadows;
    root.add(ground);

    this.addWater(root, map);
    this.addPath(root, map, P);
    for (const t of map.trees) this.addTree(root, t, P, map.features);
    this.addTent(root, map.tent);
    this.addFirepit(root, map.firepit);
    this.addMarket(root, map.market);
    this.addRoadSign(root, map.roadSign);
    if (unlocked.includes('truck')) {
      this.parkedTruck = this.buildTruck();
      this.parkedTruck.position.set(map.truckSpot.x + map.truckSpot.w / 2, 0, map.truckSpot.y + map.truckSpot.h / 2);
      root.add(this.parkedTruck);
    } else this.parkedTruck = null;
    this.addGear(root, map, unlocked);
    this.decorLights = [];
    for (const d of decor) {
      if (d.spot && d.spot !== map.id) continue;
      this.addDecor(root, d);
    }
  }

  addWater(root, map) {
    const w = map.water;
    const mat = new THREE.MeshLambertMaterial({
      color: hex(w.colors[0]), transparent: true, opacity: 0.9,
    });
    this.waterMat = mat;
    const sandMat = new THREE.MeshLambertMaterial({ color: hex(w.sand) });
    const put = (mesh, x, z, y = 0) => {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, z);
      root.add(mesh);
      return mesh;
    };
    if (w.type === 'lake' || w.type === 'frozen') {
      put(new THREE.Mesh(new THREE.CircleGeometry(1, 40), sandMat), w.cx, w.cy, 0.4)
        .scale.set(w.rx * 1.12, w.ry * 1.12, 1);
      const surface = put(new THREE.Mesh(new THREE.CircleGeometry(1, 40),
        w.type === 'frozen' ? new THREE.MeshLambertMaterial({ color: hex(w.colors[0]) }) : mat), w.cx, w.cy, 0.8);
      surface.scale.set(w.rx, w.ry, 1);
      if (w.type === 'frozen') {
        const holeMat = new THREE.MeshBasicMaterial({ color: 0x0e2f44 });
        for (const h of w.holes) put(new THREE.Mesh(new THREE.CircleGeometry(h.r, 16), holeMat), h.x, h.y, 1.1);
      }
    } else if (w.type === 'river') {
      // a ribbon of quads following the sine centerline
      const pts = [];
      for (let x = -100; x <= 2100; x += 50) {
        pts.push(new THREE.Vector2(x, w.cy + Math.sin(x * w.k * Math.PI) * w.amp));
      }
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].x, pts[0].y - w.halfW);
      for (const p of pts) shape.lineTo(p.x, p.y - w.halfW);
      for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(pts[i].x, pts[i].y + w.halfW);
      shape.closePath();
      const bankShape = new THREE.Shape();
      bankShape.moveTo(pts[0].x, pts[0].y - w.halfW * 1.45);
      for (const p of pts) bankShape.lineTo(p.x, p.y - w.halfW * 1.45);
      for (let i = pts.length - 1; i >= 0; i--) bankShape.lineTo(pts[i].x, pts[i].y + w.halfW * 1.45);
      bankShape.closePath();
      put(new THREE.Mesh(new THREE.ShapeGeometry(bankShape), sandMat), 0, 0, 0.4);
      put(new THREE.Mesh(new THREE.ShapeGeometry(shape), mat), 0, 0, 0.8);
    } else if (w.type === 'ocean') {
      put(new THREE.Mesh(new THREE.PlaneGeometry(4000, 1400), sandMat), 1000, w.base + 200, 0.4);
      put(new THREE.Mesh(new THREE.PlaneGeometry(4000, 1800), mat), 1000, w.base + 900, 0.8);
    }
  }

  addPath(root, map, P) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(map.tent.x + map.tent.w / 2, 0.6, map.tent.y + map.tent.h + 20),
      new THREE.Vector3(650, 0.6, 640),
      new THREE.Vector3(map.firepit.x, 0.6, map.firepit.y + 30),
      new THREE.Vector3(1150, 0.6, 860),
      new THREE.Vector3(1250, 0.6, 1000),
    ]);
    const geo = new THREE.TubeGeometry(curve, 24, 28, 4, false);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: hex(P.path) }));
    mesh.scale.y = 0.06;
    root.add(mesh);
  }

  addTree(root, t, P, features = {}) {
    const g = new THREE.Group();
    const trunkH = t.r * 1.5;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(t.r * 0.13, t.r * 0.18, trunkH, 6),
      new THREE.MeshLambertMaterial({ color: hex(P.trunk), flatShading: true }),
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = this.q.shadows;
    g.add(trunk);
    if (t.palm) {
      const frondMat = new THREE.MeshLambertMaterial({ color: hex(P.canopy[0]), side: THREE.DoubleSide, flatShading: true });
      for (let i = 0; i < 6; i++) {
        const frond = new THREE.Mesh(new THREE.PlaneGeometry(t.r * 1.6, t.r * 0.5), frondMat);
        frond.position.set(Math.cos(i) * t.r * 0.7, trunkH, Math.sin(i) * t.r * 0.7);
        frond.rotation.set(-0.5, i * 1.05, 0.2);
        g.add(frond);
      }
    } else {
      const mat = new THREE.MeshLambertMaterial({ color: hex(P.canopy[0]), flatShading: true });
      const mat2 = new THREE.MeshLambertMaterial({ color: hex(P.canopy[1]), flatShading: true });
      // stacked cones read as conifers; the snowy palette caps them white
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(t.r * (1 - i * 0.22), t.r * 1.15, this.q.treeSeg),
          i === 2 ? mat2 : mat,
        );
        cone.position.y = trunkH + i * t.r * 0.62;
        cone.castShadow = this.q.shadows;
        g.add(cone);
      }
    }
    g.position.set(t.x, 0, t.y);
    root.add(g);
  }

  addTent(root, t) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.001, t.w * 0.62, t.h * 0.95, 4),
      new THREE.MeshLambertMaterial({ color: 0x8b7cf6, flatShading: true }),
    );
    body.rotation.y = Math.PI / 4;
    body.position.y = t.h * 0.47;
    body.castShadow = this.q.shadows;
    g.add(body);
    const door = new THREE.Mesh(
      new THREE.CylinderGeometry(0.001, t.w * 0.24, t.h * 0.6, 4),
      new THREE.MeshLambertMaterial({ color: 0x5d4fb8, flatShading: true }),
    );
    door.rotation.y = Math.PI / 4;
    door.position.set(0, t.h * 0.3, t.h * 0.42);
    g.add(door);
    g.position.set(t.x + t.w / 2, 0, t.y + t.h / 2);
    root.add(g);
  }

  addFirepit(root, f) {
    const g = new THREE.Group();
    const pit = new THREE.Mesh(
      new THREE.CylinderGeometry(f.r, f.r, 8, 12),
      new THREE.MeshLambertMaterial({ color: 0x2b2b31 }),
    );
    pit.position.y = 4;
    g.add(pit);
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6e6e78, flatShading: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(11), stoneMat);
      s.position.set(Math.cos(a) * f.r, 6, Math.sin(a) * f.r);
      s.castShadow = this.q.shadows;
      g.add(s);
    }
    // flames live here and get scaled per frame
    this.flames = new THREE.Group();
    const flameColors = [0xff8c2e, 0xffb52e, 0xffe08a];
    for (let i = 0; i < 3; i++) {
      const fl = new THREE.Mesh(
        new THREE.ConeGeometry(14 - i * 3.4, 46 - i * 10, 6),
        new THREE.MeshBasicMaterial({ color: flameColors[i] }),
      );
      fl.position.set((i - 1) * 8, 24 - i * 4, 0);
      this.flames.add(fl);
    }
    g.add(this.flames);
    g.position.set(f.x, 0, f.y);
    root.add(g);
    this.firepitPos = { x: f.x, y: f.y };
  }

  addMarket(root, M) {
    const g = new THREE.Group();
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(M.w, 60, M.h * 0.6),
      new THREE.MeshLambertMaterial({ color: 0x6b4f33, flatShading: true }),
    );
    counter.position.y = 30;
    counter.castShadow = this.q.shadows;
    g.add(counter);
    for (let i = 0; i < 7; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(M.w / 7, 6, M.h * 0.8),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0xc94f4f : 0xf0e6d2 }),
      );
      stripe.position.set(-M.w / 2 + (i + 0.5) * (M.w / 7), 96, -10);
      g.add(stripe);
    }
    for (const sx of [-M.w / 2 + 10, M.w / 2 - 10]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 96, 6),
        new THREE.MeshLambertMaterial({ color: 0x4e3a26 }));
      post.position.set(sx, 48, -40);
      g.add(post);
    }
    g.position.set(M.x + M.w / 2, 0, M.y + M.h / 2);
    root.add(g);
  }

  addRoadSign(root, s) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 70, 6),
      new THREE.MeshLambertMaterial({ color: 0xcaa96d }));
    post.position.y = 35;
    g.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(84, 34, 5),
      new THREE.MeshLambertMaterial({ color: 0x2b2b31 }));
    board.position.y = 82;
    g.add(board);
    g.position.set(s.x, 0, s.y);
    root.add(g);
  }

  addGear(root, map, unlocked) {
    const f = map.firepit;
    const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, flatShading: true }));
    if (unlocked.includes('bbq')) {
      const g = box(52, 30, 34, 0x2b2b31);
      g.position.set(f.x + 100, 40, f.y);
      root.add(g);
    }
    if (unlocked.includes('cooler')) {
      const c = box(44, 30, 30, 0x2a8ab0);
      c.position.set(f.x - 100, 15, f.y + 40);
      root.add(c);
    }
    if (unlocked.includes('telescope')) {
      const g = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 46, 8),
        new THREE.MeshLambertMaterial({ color: 0x4a4a58 }));
      tube.rotation.z = 0.9;
      tube.position.y = 60;
      g.add(tube);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 5),
          new THREE.MeshLambertMaterial({ color: 0xcaa96d }));
        leg.position.set(Math.cos(i * 2.1) * 12, 30, Math.sin(i * 2.1) * 12);
        leg.rotation.set(Math.sin(i * 2.1) * 0.25, 0, -Math.cos(i * 2.1) * 0.25);
        g.add(leg);
      }
      g.position.set(map.tent.x + map.tent.w + 50, 0, map.tent.y + map.tent.h - 10);
      root.add(g);
    }
    if (unlocked.includes('heater') && map.features.snow) {
      const h = box(26, 40, 26, 0x8a2f2f);
      h.position.set(f.x - 90, 20, f.y - 40);
      root.add(h);
    }
  }

  addDecor(root, d) {
    const g = new THREE.Group();
    if (d.item === 'lantern') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 30, 6),
        new THREE.MeshLambertMaterial({ color: 0xcaa96d }));
      post.position.y = 15;
      const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(10, 0),
        new THREE.MeshBasicMaterial({ color: 0xffd778 }));
      bulb.position.y = 36;
      g.add(post, bulb);
      const light = new THREE.PointLight(0xffd778, 0, 260, 2);
      light.position.set(0, 40, 0);
      g.add(light);
      this.decorLights.push(light);
    } else if (d.item === 'chair') {
      const mat = new THREE.MeshLambertMaterial({ color: 0x7c4dff, flatShading: true });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(34, 6, 32), mat);
      seat.position.y = 24;
      const back = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 6), mat);
      back.position.set(0, 40, -14);
      g.add(seat, back);
      for (const [lx, lz] of [[-14, -12], [14, -12], [-14, 12], [14, 12]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 24, 5), mat);
        leg.position.set(lx, 12, lz);
        g.add(leg);
      }
    } else if (d.item === 'lights') {
      const colors = [0xf472b6, 0x22d3ee, 0xffd778, 0x34d399, 0x8b7cf6];
      for (let i = -2; i <= 2; i++) {
        const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0),
          new THREE.MeshBasicMaterial({ color: colors[i + 2] }));
        bulb.position.set(i * 26, 60 - Math.abs(i) * 6, 0);
        g.add(bulb);
      }
      for (const sx of [-60, 60]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 76, 5),
          new THREE.MeshLambertMaterial({ color: 0xcaa96d }));
        post.position.set(sx, 38, 0);
        g.add(post);
      }
      const light = new THREE.PointLight(0xffe0b0, 0, 300, 2);
      light.position.set(0, 60, 0);
      g.add(light);
      this.decorLights.push(light);
    } else if (d.item === 'flag') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 90, 5),
        new THREE.MeshLambertMaterial({ color: 0xcaa96d }));
      pole.position.y = 45;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(40, 24),
        new THREE.MeshLambertMaterial({ color: 0xf472b6, side: THREE.DoubleSide }));
      cloth.position.set(20, 78, 0);
      g.add(pole, cloth);
    }
    g.position.set(d.x, 0, d.y);
    root.add(g);
  }

  buildTruck() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(210, 46, 96),
      new THREE.MeshLambertMaterial({ color: 0x3f6f8f, flatShading: true }));
    body.position.y = 44;
    body.castShadow = this.q.shadows;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(70, 40, 88),
      new THREE.MeshLambertMaterial({ color: 0x345d78, flatShading: true }));
    cab.position.set(58, 82, 0);
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 62, 46, 4),
      new THREE.MeshLambertMaterial({ color: 0xd97941, flatShading: true }));
    tent.rotation.y = Math.PI / 4;
    tent.position.set(-46, 90, 0);
    g.add(body, cab, tent);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1b1b20 });
    for (const [wx, wz] of [[-70, 52], [-70, -52], [66, 52], [66, -52]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 16, 10), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 22, wz);
      g.add(wheel);
    }
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff5c8, transparent: true, opacity: 0 });
    this.truckBeam = new THREE.Mesh(new THREE.ConeGeometry(90, 300, 8, 1, true), beamMat);
    this.truckBeam.rotation.z = Math.PI / 2;
    this.truckBeam.position.set(250, 60, 0);
    g.add(this.truckBeam);
    return g;
  }

  // ---------------------------------------------------------------- dynamic

  addTransient(fx) {
    this.transients.push({ t0: performance.now(), ...fx });
    if (this.transients.length > 12) this.transients.shift();
  }

  playerNode(p) {
    let n = this.playerNodes.get(p.name);
    if (n) return n;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(15, 22, 3, 8),
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(p.hue / 360, 0.45, 0.45), flatShading: true }),
    );
    body.position.y = 34;
    body.castShadow = this.q.shadows;
    const tex = p.head ? new THREE.CanvasTexture(p.head) : null;
    const head = new THREE.Mesh(
      new THREE.CircleGeometry(21, 20),
      tex ? new THREE.MeshBasicMaterial({ map: tex })
        : new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(p.hue / 360, 0.4, 0.3) }),
    );
    head.position.y = 74;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 70, 4),
      new THREE.MeshLambertMaterial({ color: 0xcaa96d }));
    rod.position.set(16, 60, 0);
    rod.rotation.z = -0.8;
    rod.visible = false;
    group.add(body, head, rod);
    this.dynamicRoot.add(group);
    n = { group, head, tex, body, rod };
    this.playerNodes.set(p.name, n);
    return n;
  }

  /** Same signature as the 2D renderer. */
  frame(now, players, world, truckView = null) {
    if (!this.map) return;
    const me = players.find((p) => p.me);
    const focus = truckView && me?.driving ? truckView : me;

    // --- camera: third-person, behind and above
    if (focus) {
      this.camGoal.set(focus.x - 300, 430, focus.y + 430);
      this.camLook.set(focus.x, 40, focus.y);
    }
    this.camera.position.lerp(this.camGoal, 0.1);
    this.camera.lookAt(this.camLook);

    // --- clock: sun swings, colors warm at dusk, night dims everything
    const nf = nightFactor(world.tod);
    const ang = world.tod * Math.PI * 2 - Math.PI / 2;
    this.sun.position.set(
      this.camLook.x + Math.cos(ang) * 1200, 400 + Math.sin(ang) * 900, this.camLook.z - 500);
    this.sun.target.position.copy(this.camLook);
    this.sun.intensity = 1.5 * (1 - nf * 0.9);
    const warm = this.map.features.sunset && nf > 0.05 && nf < 0.75;
    this.sun.color.setHex(warm ? 0xff9a4a : 0xfff2d0);
    this.hemi.intensity = 1.55 - nf * 1.1;
    this.hemi.color.setHex(nf > 0.6 ? 0x2a3a6a : 0xdcefff);
    const skyDay = this.map.features.snow ? 0xcfe0ee : 0x9fc4d8;
    const sky = new THREE.Color(skyDay).lerp(new THREE.Color(0x080a22), nf);
    this.scene.background = sky;
    this.scene.fog.color = sky;

    // --- fire
    const lit = world.fire.lit && world.fire.lvl > 0;
    if (this.flames) {
      this.flames.visible = lit;
      const s = lit ? 0.45 + world.fire.lvl / 100 : 0;
      this.flames.scale.set(s, s + Math.sin(now / 90) * 0.12, s);
      this.flames.rotation.y = now / 900;
    }
    this.fireLight.position.set(this.firepitPos.x, 60, this.firepitPos.y);
    this.fireLight.intensity = lit ? 2.2 * (0.4 + world.fire.lvl / 100) : 0;
    for (const l of this.decorLights || []) l.intensity = nf * 1.6;

    // --- players
    const seen = new Set();
    for (const p of players) {
      if (p.hidden) { const n = this.playerNodes.get(p.name); if (n) n.group.visible = false; continue; }
      seen.add(p.name);
      const n = this.playerNode(p);
      n.group.visible = true;
      n.group.position.set(p.x, p.sit ? -8 : 0, p.y);
      // gentle waddle while walking; billboard the face at the camera
      n.body.rotation.z = p.m ? Math.sin(now / 110) * 0.12 : 0;
      n.body.position.y = p.sit ? 26 : 34;
      n.head.position.y = p.sit ? 64 : 74;
      n.head.quaternion.copy(this.camera.quaternion);
      if (n.tex) n.tex.needsUpdate = true;
      n.rod.visible = !!p.fishing;
    }
    for (const [name, n] of this.playerNodes) {
      if (!seen.has(name)) { n.group.visible = false; }
    }

    // --- truck
    if (this.parkedTruck) this.parkedTruck.visible = !truckView;
    if (truckView) {
      if (!this.truckNode) { this.truckNode = this.buildTruck(); this.dynamicRoot.add(this.truckNode); }
      this.truckNode.visible = true;
      this.truckNode.position.set(truckView.x, 0, truckView.y);
      this.truckNode.rotation.y = truckView.dir > 0 ? 0 : Math.PI;
      if (this.truckBeam) this.truckBeam.material.opacity = this.headlights ? 0.22 * Math.max(nf, 0.3) : 0;
    } else if (this.truckNode) this.truckNode.visible = false;

    // --- bobbers
    this.syncBobbers(players, now);
    this.drawTransients(now);
    this.renderer.render(this.scene, this.camera);
  }

  syncBobbers(players, now) {
    const active = players.filter((p) => p.fishing?.bobber);
    while (this.bobbers.length < active.length) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
      this.dynamicRoot.add(b);
      this.bobbers.push(b);
    }
    this.bobbers.forEach((b, i) => {
      const p = active[i];
      b.visible = !!p;
      if (!p) return;
      const dip = p.fishing.bite ? Math.sin(now / 60) * 6 : Math.sin(now / 500) * 2;
      b.position.set(p.fishing.bobber.x, 10 - dip, p.fishing.bobber.y);
    });
  }

  drawTransients(now) {
    if (!this.fxGroup) { this.fxGroup = new THREE.Group(); this.dynamicRoot.add(this.fxGroup); }
    this.fxGroup.clear();
    this.transients = this.transients.filter((fx) => {
      const dur = fx.type === 'fishArc' ? 750 : 1000;
      const t = (now - fx.t0) / dur;
      if (t >= 1) return false;
      if (fx.type === 'fishArc') {
        const x = fx.from.x + (fx.to.x - fx.from.x) * t;
        const z = fx.from.y + (fx.to.y - fx.from.y) * t;
        const y = 20 + Math.sin(t * Math.PI) * 190;
        const fish = new THREE.Mesh(new THREE.ConeGeometry(11, 34, 5),
          new THREE.MeshLambertMaterial({ color: 0xbfe0ef, flatShading: true }));
        fish.position.set(x, y, z);
        fish.rotation.set(Math.PI / 2, 0, now / 80);
        this.fxGroup.add(fish);
      } else if (fx.type === 'poof' || fx.type === 'notes') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(14 + t * 46, 3, 6, 14),
          new THREE.MeshBasicMaterial({ color: fx.type === 'notes' ? 0xffd778 : 0xffffff, transparent: true, opacity: 1 - t }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(fx.at.x, fx.type === 'notes' ? 110 + t * 70 : 20, fx.at.y);
        this.fxGroup.add(ring);
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- picking

  worldToScreen(x, y) {
    const v = new THREE.Vector3(x, 0, y).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.canvas.width,
      y: (-v.y * 0.5 + 0.5) * this.canvas.height,
    };
  }

  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    return hit ? { x: hit.x, y: hit.z } : { x: 0, y: 0 };
  }

  /** Debug: scene stats for headless assertions. */
  stats() {
    let meshes = 0;
    this.scene.traverse((o) => { if (o.isMesh) meshes++; });
    return {
      meshes, players: this.playerNodes.size,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
