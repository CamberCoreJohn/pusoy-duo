// Campfire 🏕️ — orchestrator. Wires world/render/input/net/activities into
// the app: lifecycle, the 30fps loop, host simulation + authority, and the
// HUD. Created once by app.js via createCamp(ctx); start()/stop() per play.

import { AvatarSystem } from '../../avatars.js';
import {
  WORLD, SPEED, SPAWNS, clampMove, nearestInteractable,
  makeWorldState, tickWorld, nightFactor, FIREPIT,
} from './world.js';
import { CampRenderer } from './render.js';
import { CampInput } from './input.js';
import { CampNet, Interp } from './net.js';
import { Fishing, rollFish, speciesInfo } from './fishing.js';
import { FireActions, FEED_AMOUNT, STRIKE_LIGHT_LVL } from './fire.js';
import { CampSave, creditMyCatch } from './save.js';
import { StarView } from './stars.js';
import { DecorUI, canPlace, shopItem } from './decor.js';

const RARE_TIERS = new Set(['rare', 'epic']);

export function createCamp(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    layer: $('campLayer'), canvas: $('campCanvas'), hud: $('campHud'),
    action: $('campAction'), prompt: $('campPrompt'), status: $('campStatus'),
    castMeter: $('castMeter'), castFill: $('castFill'),
    reelGame: $('reelGame'), reelNeedle: $('reelNeedle'), reelProgress: $('reelProgress'),
    strikeGame: $('strikeGame'), strikeSpark: $('strikeSpark'),
    roastGame: $('roastGame'), roastMallow: $('roastMallow'), roastFill: $('roastFill'),
    catchCard: $('catchCard'), log: $('campLog'), logList: $('campLogList'),
    btnLog: $('btnCampLog'), btnShop: $('btnCampShop'), btnLeave: $('btnLeaveCamp'),
    shop: $('campShop'), shopList: $('campShopList'), shopPoints: $('campShopPoints'),
    btnShopClose: $('btnShopClose'), starView: $('starView'), btnStarClose: $('btnStarClose'),
  };

  const net = new CampNet();
  const avatars = new AvatarSystem();
  let renderer = null, input = null, fishing = null, fireAct = null, save = null;
  let stars = null, decorUI = null;
  let active = false, isHost = false;
  let world = makeWorldState();
  let players = new Map(); // id -> {id,x,y,f,m,name,hue,head,me,interp?,fishing?}
  let me = null;
  let sessionLog = [];     // [{species,size,byName,rarity}]
  let rafId = 0, hostTick = 0, lastFrame = 0, frameFlip = false;
  let worldDirty = false;

  const toast = ctx.showToast;

  // ------------------------------------------------------------ helpers

  const headCanvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    return c;
  };

  function addPlayer(id, name, hue, x, y, videoEl, mirror) {
    const head = headCanvas();
    const p = {
      id, name, hue, x, y, f: 0, m: false, head,
      me: id === 'me', interp: id === 'me' ? null : new Interp(x, y),
    };
    players.set(id, p);
    syncAvatars();
    return p;
  }

  function syncAvatars() {
    avatars.setEntries([...players.values()].map((p) => {
      const video = p.me
        ? (ctx.hasStream() ? ctx.localVideo : null)
        : (p.id !== 'host' && ctx.remoteVideos.get(p.id)) || (p.id === 'host' ? [...ctx.remoteVideos.values()][0] : null);
      return {
        canvas: p.head,
        kind: video ? 'video' : 'initial',
        video, mirror: !!p.me, hue: p.hue, label: p.name,
      };
    }));
    // head canvases were recreated by setEntries sizing; keep references fresh
  }

  function removePlayer(id) {
    players.delete(id);
    syncAvatars();
  }

  const isNight = () => nightFactor(world.tod) > 0.5;
  const pts = () => save?.data.points ?? 0;

  function refreshStatus() {
    els.status.textContent = `🪵 ${fireAct.wood} · ⭐ ${pts()}${save?.data.fire.streak ? ` · 🔥×${save.data.fire.streak}` : ''}`;
  }

  function logEntry(e) {
    sessionLog.unshift(e);
    if (sessionLog.length > 30) sessionLog.pop();
  }

  function renderLogPanel() {
    const best = save?.data.bestCatches || {};
    const bestRows = Object.entries(best).map(([sp, b]) =>
      `<div class="log-row best">${speciesInfo(sp)?.emoji || '🐟'} <b>${speciesInfo(sp)?.name || sp}</b> record: ${b.size}cm — ${b.byName}</div>`);
    const rows = sessionLog.map((e) =>
      `<div class="log-row" data-rarity="${e.rarity}">${speciesInfo(e.species)?.emoji || '🐟'} ${e.byName} caught a ${speciesInfo(e.species)?.name || e.species} · ${e.size}cm</div>`);
    els.logList.innerHTML =
      (bestRows.length ? `<div class="log-head">Camp records</div>${bestRows.join('')}` : '')
      + `<div class="log-head">Recent catches</div>`
      + (rows.length ? rows.join('') : '<div class="log-row">Nothing yet — go fish! 🎣</div>');
  }

  // ------------------------------------------------------------ authority

  function hostWorldChanged() {
    worldDirty = true; // broadcast on next tick (≤1s); immediate feel is local
    net.send({ t: 'world', fire: world.fire, tod: world.tod });
  }

  function handleAct(msg, fromPeer) {
    // runs on the HOST for both remote acts and (via localAct) its own
    const who = fromPeer ?? 'host';
    const name = fromPeer ? (players.get(fromPeer)?.name ?? 'Camper') : me.name;
    switch (msg.kind) {
      case 'cast': {
        const fish = rollFish();
        if (fromPeer) net.send({ t: 'fish', ...fish }, fromPeer);
        else fishing.onFishAssigned(fish);
        break;
      }
      case 'caught': {
        const sp = speciesInfo(msg.fish.species);
        save?.update((d) => { d.points += sp?.pts ?? 1; });
        save?.logCatch({ species: msg.fish.species, size: msg.fish.size, rarity: msg.fish.rarity, byName: name });
        broadcastEv({ kind: 'catch', species: msg.fish.species, size: msg.fish.size, rarity: msg.fish.rarity, byName: name, by: who, points: pts() });
        break;
      }
      case 'feed':
        if (world.fire.lit) { world.fire.lvl = Math.min(100, world.fire.lvl + FEED_AMOUNT); hostWorldChanged(); }
        break;
      case 'strike':
        if (!world.fire.lit) {
          world.fire.lit = true;
          world.fire.lvl = STRIKE_LIGHT_LVL;
          save?.markFireLit();
          hostWorldChanged();
          broadcastEv({ kind: 'fireLit', byName: name });
        }
        break;
      case 'roastDone':
        if (msg.result === 'golden') save?.update((d) => { d.points += 2; });
        broadcastEv({ kind: 'roast', result: msg.result, byName: name, by: who, points: pts() });
        break;
      case 'grill':
        save?.update((d) => { d.points += 5; });
        broadcastEv({ kind: 'feast', species: msg.species, byName: name, points: pts() });
        break;
      case 'constellation':
        if (!save?.data.constellations[msg.id]) {
          save?.update((d) => { d.constellations[msg.id] = { byName: name, at: Date.now() }; d.points += 15; });
          broadcastEv({ kind: 'constellation', id: msg.id, byName: name, points: pts() });
        }
        break;
      case 'place': {
        const v = canPlace(save.data, msg.item, msg.x, msg.y);
        if (!v.ok) {
          if (fromPeer) net.send({ t: 'ev', kind: 'reject', msg: v.reason }, fromPeer);
          else toast(v.reason);
          break;
        }
        const cost = shopItem(msg.item).cost;
        save.update((d) => {
          d.points -= cost;
          d.decor.push({ id: Date.now().toString(36), item: msg.item, x: msg.x, y: msg.y, placedBy: name });
        });
        broadcastEv({ kind: 'decor', item: msg.item, x: msg.x, y: msg.y, byName: name, points: pts() });
        break;
      }
    }
  }

  function broadcastEv(ev) {
    net.send({ t: 'ev', ...ev });
    applyEv(ev); // host reacts too
  }

  /** Either send an act to the host or, as authority, handle it directly. */
  function act(kind, extra = {}) {
    if (isHost) handleAct({ kind, ...extra }, null);
    else net.send({ t: 'act', kind, ...extra, relay: false });
  }

  // ------------------------------------------------------------ events (all clients)

  function applyEv(ev) {
    switch (ev.kind) {
      case 'catch': {
        const sp = speciesInfo(ev.species);
        logEntry(ev);
        if (ev.by !== (isHost ? 'host' : undefined) || isHost) { /* toast for everyone */ }
        toast(`${sp?.emoji || '🐟'} ${ev.byName} caught a ${sp?.name}! ${ev.size}cm`, 2600, 'info');
        if (RARE_TIERS.has(ev.rarity)) {
          ctx.fx.confettiBurst(innerWidth / 2, innerHeight * 0.4, 36);
        }
        break;
      }
      case 'fireLit': toast(`🔥 ${ev.byName} lit the campfire!`, 2400, 'info'); break;
      case 'roast':
        if (ev.result === 'golden') toast(`🍡 ${ev.byName} roasted a perfect marshmallow!`, 2400, 'info');
        break;
      case 'feast':
        toast(`🍽️ ${ev.byName} grilled ${speciesInfo(ev.species)?.name || 'a fish'} — feast!`, 2800, 'info');
        ctx.fx.confettiBurst(innerWidth / 2, innerHeight * 0.5, 24);
        break;
      case 'constellation':
        toast(`✨ ${ev.byName} traced a constellation!`, 2600, 'info');
        ctx.fx.confettiBurst(innerWidth / 2, innerHeight * 0.3, 30);
        if (stars?.open) stars.completed.add(ev.id);
        break;
      case 'decor':
        if (!isHost) decorList.push({ item: ev.item, x: ev.x, y: ev.y });
        renderer.paintBackground(isHost ? save.data.decor : decorList);
        break;
      case 'reject': toast(ev.msg); break;
    }
    if (typeof ev.points === 'number' && save) save.data.points = ev.points;
    if (typeof ev.points === 'number' && !isHost) guestPoints = ev.points;
    refreshStatus();
  }

  let decorList = []; // guest-side mirror of placed decor
  let guestPoints = 0;

  // ------------------------------------------------------------ net handlers

  function wireNet() {
    net.on('hi', (msg, fromPeer) => {
      if (!isHost || !fromPeer) return;
      const idx = players.size % SPAWNS.length;
      const spawn = SPAWNS[idx];
      const hue = (players.size * 77 + 140) % 360;
      addPlayer(fromPeer, msg.name || 'Camper', hue, spawn.x, spawn.y);
      // newcomer gets the full picture
      net.send({
        t: 'init',
        world: { fire: world.fire, tod: world.tod },
        decor: save.data.decor,
        points: pts(),
        catches: sessionLog.slice(0, 10),
        players: [...players.values()].filter((p) => p.id !== fromPeer).map((p) => ({
          id: p.me ? 'host' : p.id, name: p.name, hue: p.hue, x: p.x, y: p.y,
        })),
        you: { x: spawn.x, y: spawn.y, hue },
      }, fromPeer);
      // everyone else meets them
      net.broadcastExcept(fromPeer, { t: 'join', id: fromPeer, name: msg.name, hue, x: spawn.x, y: spawn.y });
      toast(`${msg.name} arrived at camp 🏕️`, 2400, 'info');
    });

    net.on('init', (msg) => {
      if (isHost) return;
      world = { ...makeWorldState(), ...msg.world };
      decorList = msg.decor || [];
      guestPoints = msg.points || 0;
      sessionLog = msg.catches || [];
      renderer.paintBackground(decorList);
      if (me && msg.you) { me.x = msg.you.x; me.y = msg.you.y; me.hue = msg.you.hue; }
      for (const p of msg.players || []) addPlayer(p.id, p.name, p.hue, p.x, p.y);
      syncAvatars();
      refreshStatus();
    });

    net.on('join', (msg) => {
      if (!players.has(msg.id)) addPlayer(msg.id, msg.name, msg.hue, msg.x, msg.y);
    });

    net.on('left', (msg) => removePlayer(msg.id));

    net.on('pos', (msg, fromPeer) => {
      const id = msg.id ?? fromPeer;
      const p = players.get(id);
      p?.interp?.push(performance.now(), msg.x, msg.y, msg.f, msg.m);
      if (p) { p.x = msg.x; p.y = msg.y; } // raw for host relaying/logic
    });

    net.on('world', (msg) => {
      if (isHost) return;
      world.fire = msg.fire;
      world.tod = msg.tod;
    });

    net.on('act', (msg, fromPeer) => { if (isHost && fromPeer) handleAct(msg, fromPeer); });
    net.on('fish', (msg) => fishing.onFishAssigned(msg));
    net.on('ev', (msg) => { if (!isHost) applyEv(msg); });
    net.on('trace', (msg) => stars?.trace(msg.x, msg.y, false));
    net.on('end', () => stop('host-ended', true));
    net.on('bye', (msg, fromPeer) => {
      if (!isHost || !fromPeer) return;
      const name = players.get(fromPeer)?.name;
      removePlayer(fromPeer);
      net.send({ t: 'left', id: fromPeer });
      if (name) toast(`${name} left camp`, 2000, 'info');
    });
  }

  // ------------------------------------------------------------ loop

  function loop(now) {
    if (!active) return;
    rafId = requestAnimationFrame(loop);
    frameFlip = !frameFlip;
    if (frameFlip) return; // 30fps world render
    const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    // move self
    const v = input.vector();
    const busy = fishing.active || fireAct.active || stars?.open;
    if (!busy && (v.x || v.y)) {
      const step = clampMove(me.x, me.y, me.x + v.x * SPEED * dt, me.y + v.y * SPEED * dt);
      me.m = step.x !== me.x || step.y !== me.y;
      me.x = step.x;
      me.y = step.y;
      me.f = v.x < -0.2 ? -1 : v.x > 0.2 ? 1 : me.f;
      if (fishing.state === 'idle') net.sendPos(me, now);
    } else me.m = false;

    // remote interpolation
    for (const p of players.values()) {
      if (p.interp) {
        const s = p.interp.at(now);
        p.rx = s.x; p.ry = s.y; p.rm = s.m;
      }
    }

    // context action label (activities own the prompt while active)
    if (!busy) {
      const it = nearestInteractable(me.x, me.y, { night: isNight() });
      if (!it) input.setAction(null);
      else if (it.kind === 'firepit') input.setAction(fireAct.firepitLabel());
      else input.setAction(it.label);
    }

    render(now);

    // host: immediate world push when the sim flipped something big
    if (isHost && worldDirty) worldDirty = false;
  }

  function render(now) {
    const view = [...players.values()].map((p) => ({
      x: p.me ? p.x : (p.rx ?? p.x),
      y: p.me ? p.y : (p.ry ?? p.y),
      m: p.me ? p.m : (p.rm ?? false),
      f: p.f, name: p.name, hue: p.hue, head: p.head, me: p.me,
      fishing: p.me ? fishing.fishingView : p.fishing,
    }));
    renderer.frame(now, view, world);
  }

  // ------------------------------------------------------------ lifecycle

  function start({ soloMode }) {
    if (active) return;
    active = true;
    isHost = ctx.iAmAuthority();
    world = makeWorldState(0.2);
    players = new Map();
    sessionLog = [];
    decorList = [];

    renderer = new CampRenderer(els.canvas);
    renderer.paintBackground([]); // instant scene; decor repaints when loaded
    input = new CampInput(els.hud, els.action);
    fishing = new Fishing(els, {
      onCastRequest: () => act('cast'),
      onOutcome: ({ fish, ok }) => {
        if (!ok) return;
        fireAct.sessionFish.push(fish);
        act('caught', { fish });
        creditMyCatch(ctx.user(), fish, speciesInfo(fish.species)?.pts ?? 1);
      },
      setPrompt: (l) => { els.prompt.textContent = l || ''; if (l) input.setAction(l); },
      toast,
    });
    fireAct = new FireActions(els, {
      sendAct: (kind, extra) => act(kind, extra),
      toast,
      setPrompt: (l) => { els.prompt.textContent = l || ''; if (l) input.setAction(l); },
      fireState: () => world.fire,
      onWood: () => refreshStatus(),
    });
    stars = new StarView(els.starView, {
      onTrace: (x, y) => net.send({ t: 'trace', x, y, relay: true }),
      onComplete: (id) => act('constellation', { id }),
      done: () => {},
      toast,
    });
    decorUI = new DecorUI(els, {
      points: () => (isHost ? pts() : guestPoints),
      requestPlace: (item, x, y) => act('place', { item, x, y }),
      toast,
      screenToWorld: (sx, sy) => renderer.screenToWorld(sx, sy),
    });

    // self
    me = addPlayer('me', ctx.user()?.name || 'You', 20, SPAWNS[0].x, SPAWNS[0].y);

    // authority setup
    save = new CampSave(isHost ? (ctx.user()?.uid ?? null) : null);
    if (isHost) {
      save.load().then(() => {
        renderer.paintBackground(save.data.decor);
        refreshStatus();
      });
      hostTick = setInterval(() => {
        const wasLit = world.fire.lit;
        tickWorld(world, 1);
        if (wasLit && !world.fire.lit) broadcastEv({ kind: 'fireOut' });
        net.send({ t: 'world', fire: world.fire, tod: world.tod });
      }, 1000);
    } else {
      renderer.paintBackground([]);
      net.send({ t: 'hi', name: ctx.user()?.name || 'Camper' });
    }

    wireNet();
    if (!soloMode) net.attach(ctx.party(), isHost);

    // input routing
    input.onActionDown = () => {
      if (stars.open) return;
      if (fishing.active) return void fishing.actionDown({ x: me.x, y: me.y });
      if (fireAct.mode === 'strike') return void fireAct.firepitAction();
      const it = nearestInteractable(me.x, me.y, { night: isNight() });
      if (!it) return;
      if (it.kind === 'shore') fishing.actionDown({ x: me.x, y: me.y });
      else if (it.kind === 'firepit') fireAct.firepitAction();
      else if (it.kind === 'tree') fireAct.chop();
      else if (it.kind === 'tent') stars.show(Object.keys(isHost ? save.data.constellations : {}));
    };
    input.onActionUp = () => { fishing.actionUp(); fireAct.actionUp(); };

    // canvas taps: decor placement mode
    els.canvas.addEventListener('pointerdown', onCanvasTap);

    // HUD buttons
    els.btnLeave.onclick = () => {
      if (isHost) { net.send({ t: 'end' }); stop('ended'); }
      else { net.send({ t: 'bye', relay: false }); stop('left'); }
    };
    els.btnLog.onclick = () => { renderLogPanel(); els.log.classList.toggle('hidden'); };
    els.btnShop.onclick = () => decorUI.openShop();
    els.btnShopClose.onclick = () => decorUI.closeShop();
    els.btnStarClose.onclick = () => stars.hide();

    document.addEventListener('visibilitychange', onVis);

    avatars.start();
    ctx.enterGameMode('camp');
    els.layer.classList.remove('hidden');
    refreshStatus();
    lastFrame = 0;
    rafId = requestAnimationFrame(loop);
    toast(soloMode ? 'Welcome to camp 🏕️ (solo)' : 'Welcome to camp 🏕️', 2600, 'info');
  }

  function onCanvasTap(e) {
    decorUI?.onCanvasTap(e.clientX, e.clientY);
  }

  function onVis() {
    if (document.hidden) cancelAnimationFrame(rafId);
    else if (active) rafId = requestAnimationFrame(loop);
  }

  function stop(reason, fromRemote = false) {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    clearInterval(hostTick);
    document.removeEventListener('visibilitychange', onVis);
    els.canvas.removeEventListener('pointerdown', onCanvasTap);
    fishing.cancel();
    fireAct.cancel();
    if (stars.open) stars.hide();
    avatars.stop();
    input.destroy();
    renderer.destroy();
    net.detach();
    save?.stop();
    els.layer.classList.add('hidden');
    for (const id of ['campLog', 'campShop']) $(id)?.classList.add('hidden');
    ctx.exitGameMode();
    ctx.onStopped?.(reason, fromRemote);
  }

  // ------------------------------------------------------------ controller

  const controller = {
    id: 'camp',
    get active() { return active; },
    start,
    stop,
    attachParty(party, hostFlag) { if (active) net.attach(party, hostFlag); },
    netAttach(party, hostFlag) { net.attach(party, hostFlag); },
    onPeerLeave(peerId) {
      if (!active || !isHost) return;
      if (players.has(peerId)) {
        const name = players.get(peerId).name;
        removePlayer(peerId);
        net.send({ t: 'left', id: peerId });
        toast(`${name} left camp`, 2000, 'info');
      }
    },
    // ---- debug / verification handles
    debug: {
      get world() { return world; },
      get players() { return players; },
      get save() { return save; },
      teleport(x, y) { me.x = x; me.y = y; },
      setFire(lvl, lit = true) { world.fire = { lvl, lit }; },
      forceBite() { fishing.onFishAssigned({ ...rollFish(), biteMs: 10 }); },
      setTod(t) { world.tod = t; },
      grantPoints(n) { save?.update((d) => { d.points += n; }); guestPoints += n; refreshStatus(); },
      tick(dt) { tickWorld(world, dt); },
      frame(t) { render(t); },
      input: () => input,
      fishing: () => fishing,
      fire: () => fireAct,
      stars: () => stars,
      decor: () => decorUI,
    },
  };
  return controller;
}
