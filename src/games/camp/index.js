// Campfire 🏕️ — orchestrator: lifecycle, the 30fps loop, host simulation &
// authority, XP/levels, the drivable truck, travel between themed spots,
// and the HUD. Created once by app.js via createCamp(ctx).

import { AvatarSystem } from '../../avatars.js';
import {
  WORLD, SPEED, TRUCK_SPEED, TRUCK_R, getMap, MAPS, SPOT_ORDER,
  clampMove, collides, nearestInteractable, waterAt,
  makeWorldState, tickWorld, nightFactor,
} from './world.js';
import { CampRenderer } from './render.js';
import { CampInput } from './input.js';
import { CampNet, Interp } from './net.js';
import { Fishing, rollFish, speciesInfo, sellPrice } from './fishing.js';
import { FireActions, FEED_AMOUNT, STRIKE_LIGHT_LVL } from './fire.js';
import { CampSave, creditMyCatch } from './save.js';
import { StarView } from './stars.js';
import { DecorUI, canPlace, shopItem, EQUIPMENT, equipItem, canBuy } from './decor.js';
import { levelFromXp, levelProgress, xpForCatch, XP, MAX_LEVEL } from './levels.js';

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
    market: $('campMarket'), marketCoins: $('marketCoins'), marketCreel: $('marketCreel'),
    btnSellAll: $('btnSellAll'), marketGear: $('marketGear'), btnMarketClose: $('btnMarketClose'),
    travel: $('travelModal'), travelList: $('travelList'), btnTravelClose: $('btnTravelClose'),
    transition: $('travelTransition'),
  };

  const net = new CampNet();
  const avatars = new AvatarSystem();
  let renderer = null, input = null, fishing = null, fireAct = null, save = null;
  let stars = null, decorUI = null;
  let active = false, isHost = false;
  let map = getMap('lakeside');
  let world = makeWorldState();
  let players = new Map();
  let me = null;
  let sessionLog = [];
  let rafId = 0, hostTick = 0, lastFrame = 0, frameFlip = false;
  let decorList = [], unlockedList = [];
  let guestPoints = 0, guestXp = 0, guestSpot = 'lakeside';
  // truck: parked at the map's spot until someone drives it
  let truck = null; // {x, y, dir, driverId, riders:Set, driving}
  let traveling = false;

  const toast = ctx.showToast;
  let wireId = null; // how the host addresses me on the wire (guests learn it via init)
  const myId = () => (isHost ? 'host' : wireId || 'me');

  // ------------------------------------------------------------ helpers

  const headCanvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    return c;
  };

  function addPlayer(id, name, hue, x, y) {
    const p = {
      id, name, hue, x, y, f: 0, m: false, head: headCanvas(),
      me: id === 'me', interp: id === 'me' ? null : new Interp(x, y),
      mode: 'walk',
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
      return { canvas: p.head, kind: video ? 'video' : 'initial', video, mirror: !!p.me, hue: p.hue, label: p.name };
    }));
  }

  function removePlayer(id) {
    if (truck) {
      truck.riders.delete(id);
      if (truck.driverId === id) truck.driverId = null;
    }
    players.delete(id);
    syncAvatars();
  }

  const isNight = () => nightFactor(world.tod) > 0.5;
  const pts = () => (isHost ? save?.data.points ?? 0 : guestPoints);
  const xp = () => (isHost ? save?.data.xp ?? 0 : guestXp);
  const level = () => levelFromXp(xp());
  const unlockedHas = (item) => (isHost ? save?.data.unlocked : unlockedList)?.includes(item);
  const spotId = () => (isHost ? save?.data.spot ?? 'lakeside' : guestSpot);
  const humanCount = () => players.size;
  const aboardCount = () => (truck ? truck.riders.size + (truck.driverId ? 1 : 0) : 0);

  function refreshStatus() {
    const creel = fireAct.sessionFish.length;
    const lvl = level();
    const prog = Math.round(levelProgress(xp()) * 4);
    const bar = '▓'.repeat(prog) + '░'.repeat(4 - prog);
    els.status.textContent =
      `${map.emoji} Lv ${lvl}${lvl < MAX_LEVEL ? ' ' + bar : ' ★'} · 🪵 ${fireAct.wood}${creel ? ` · 🐟 ${creel}` : ''} · 🪙 ${pts()}${save?.data.fire.streak ? ` · 🔥×${save.data.fire.streak}` : ''}`;
  }

  function xpFloater(n) {
    const f = document.createElement('div');
    f.className = 'xp-float';
    f.textContent = `+${n} XP`;
    f.style.left = 50 + (Math.random() * 20 - 10) + '%';
    els.hud.appendChild(f);
    setTimeout(() => f.remove(), 1600);
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

  function repaintBg() {
    renderer.paintBackground(map,
      (isHost ? save.data.decor : decorList).filter((d) => !d.spot || d.spot === map.id),
      isHost ? save.data.unlocked : unlockedList);
  }

  function setSpot(id, { silent = false } = {}) {
    map = getMap(id);
    if (isHost) save.update((d) => { d.spot = id; });
    else guestSpot = id;
    world.fire = { lvl: 0, lit: false };
    // everyone to spawns; truck parks at the new spot
    let i = 0;
    for (const p of players.values()) {
      const s = map.spawns[i++ % map.spawns.length];
      p.x = s.x; p.y = s.y; p.mode = 'walk';
      if (p.interp) p.interp = new Interp(s.x, s.y);
    }
    truck = null;
    repaintBg();
    renderer.snow = renderer.fireflies = null; // rebuild per-map particles
    refreshStatus();
    if (!silent) toast(`${map.emoji} Welcome to ${map.name}!`, 3000, 'info');
  }

  // ------------------------------------------------------------ XP (host)

  function awardXp(n) {
    if (!isHost || n <= 0) return;
    const before = level();
    save.update((d) => { d.xp = (d.xp || 0) + n; });
    const after = level();
    if (after > before) {
      broadcastEv({ kind: 'levelup', level: after, xp: xp() });
    }
  }

  // ------------------------------------------------------------ authority

  function handleAct(msg, fromPeer) {
    const who = fromPeer ?? 'host';
    const name = fromPeer ? (players.get(fromPeer)?.name ?? 'Camper') : me.name;
    switch (msg.kind) {
      case 'cast': {
        const fish = rollFish(Math.random, {
          lucky: save?.data.unlocked.includes('lure'), mapId: map.id,
        });
        if (fromPeer) net.send({ t: 'fish', ...fish }, fromPeer);
        else fishing.onFishAssigned(fish);
        break;
      }
      case 'caught': {
        save?.logCatch({ species: msg.fish.species, size: msg.fish.size, rarity: msg.fish.rarity, byName: name });
        const gain = xpForCatch(msg.fish.rarity);
        awardXp(gain);
        broadcastEv({ kind: 'catch', species: msg.fish.species, size: msg.fish.size, rarity: msg.fish.rarity, byName: name, by: who, xpGain: gain, xp: xp() });
        break;
      }
      case 'sell': {
        const mult = save?.data.unlocked.includes('cooler') ? 1.2 : 1;
        const total = Math.round((msg.creel || []).reduce((s, f) => s + sellPrice(f.species, f.size), 0) * mult);
        if (total <= 0) break;
        save?.update((d) => { d.points += total; });
        const gain = msg.creel.length * XP.sellPerFish;
        awardXp(gain);
        broadcastEv({ kind: 'sold', byName: name, count: msg.creel.length, total, points: pts(), xpGain: gain, xp: xp() });
        break;
      }
      case 'buy': {
        const v = canBuy(save.data, msg.item, level());
        if (!v.ok) {
          if (fromPeer) net.send({ t: 'ev', kind: 'reject', msg: v.reason }, fromPeer);
          else toast(v.reason);
          break;
        }
        save.update((d) => { d.points -= v.cost; d.unlocked.push(msg.item); });
        broadcastEv({ kind: 'gear', item: msg.item, byName: name, points: pts(), unlocked: save.data.unlocked });
        break;
      }
      case 'feed':
        if (world.fire.lit) { world.fire.lvl = Math.min(100, world.fire.lvl + FEED_AMOUNT); hostWorldChanged(); }
        break;
      case 'strike':
        if (!world.fire.lit) {
          world.fire.lit = true;
          world.fire.lvl = STRIKE_LIGHT_LVL;
          const firstToday = save?.data.fire.lastLitDay !== new Date().toISOString().slice(0, 10);
          save?.markFireLit();
          if (firstToday) awardXp(XP.fireLit + (save?.data.fire.streak || 0) * 2);
          hostWorldChanged();
          broadcastEv({ kind: 'fireLit', byName: name, xp: xp() });
        }
        break;
      case 'roastDone':
        if (msg.result === 'golden') { save?.update((d) => { d.points += 2; }); awardXp(XP.goldenMallow); }
        broadcastEv({ kind: 'roast', result: msg.result, byName: name, by: who, points: pts(), xpGain: msg.result === 'golden' ? XP.goldenMallow : 0, xp: xp() });
        break;
      case 'grill': {
        const bonus = save?.data.unlocked.includes('bbq') ? 15 : 5;
        save?.update((d) => { d.points += bonus; });
        awardXp(XP.feast);
        broadcastEv({ kind: 'feast', species: msg.species, byName: name, points: pts(), xpGain: XP.feast, xp: xp() });
        break;
      }
      case 'constellation':
        if (!save?.data.constellations[msg.id]) {
          const gain = Math.round(XP.constellation * (save?.data.unlocked.includes('telescope') ? 1.5 : 1));
          save?.update((d) => { d.constellations[msg.id] = { byName: name, at: Date.now() }; d.points += 15; });
          awardXp(gain);
          broadcastEv({ kind: 'constellation', id: msg.id, byName: name, points: pts(), xpGain: gain, xp: xp() });
        }
        break;
      case 'place': {
        const v = canPlace(save.data, msg.item, msg.x, msg.y, map);
        if (!v.ok) {
          if (fromPeer) net.send({ t: 'ev', kind: 'reject', msg: v.reason }, fromPeer);
          else toast(v.reason);
          break;
        }
        const cost = shopItem(msg.item).cost;
        save.update((d) => {
          d.points -= cost;
          d.decor.push({ id: Date.now().toString(36), item: msg.item, x: msg.x, y: msg.y, placedBy: name, spot: map.id });
        });
        awardXp(XP.decor);
        broadcastEv({ kind: 'decor', item: msg.item, x: msg.x, y: msg.y, byName: name, points: pts(), spot: map.id, xpGain: XP.decor, xp: xp() });
        break;
      }
      case 'drive': {
        if (!truck || truck.driverId) break;
        truck.driverId = who;
        broadcastEv({ kind: 'truck', driverId: truck.driverId, riders: [...truck.riders], x: truck.x, y: truck.y });
        break;
      }
      case 'ride': {
        if (!truck?.driverId || truck.riders.has(who) || aboardCount() >= 4) break;
        truck.riders.add(who);
        broadcastEv({ kind: 'truck', driverId: truck.driverId, riders: [...truck.riders], x: truck.x, y: truck.y });
        break;
      }
      case 'park': {
        if (!truck || truck.driverId !== who) break;
        truck.driverId = null;
        truck.riders.clear();
        truck.driving = false;
        broadcastEv({ kind: 'truck', driverId: null, riders: [], x: truck.x, y: truck.y });
        break;
      }
      case 'travel': {
        const dest = getMap(msg.spot);
        if (dest.minLevel > level()) {
          const r = `Camp Level ${dest.minLevel} needed for ${dest.name}`;
          if (fromPeer) net.send({ t: 'ev', kind: 'reject', msg: r }, fromPeer);
          else toast(r);
          break;
        }
        if (aboardCount() < humanCount()) {
          const r = 'Everyone needs to hop in first! 🛻';
          if (fromPeer) net.send({ t: 'ev', kind: 'reject', msg: r }, fromPeer);
          else toast(r);
          break;
        }
        broadcastEv({ kind: 'travel', spot: msg.spot, byName: name });
        break;
      }
      case 'honk':
        broadcastEv({ kind: 'honk', byName: name });
        break;
    }
  }

  function hostWorldChanged() {
    net.send({ t: 'world', fire: world.fire, tod: world.tod });
  }

  function broadcastEv(ev) {
    net.send({ t: 'ev', ...ev });
    applyEv(ev);
  }

  function act(kind, extra = {}) {
    if (isHost) handleAct({ kind, ...extra }, null);
    else net.send({ t: 'act', kind, ...extra, relay: false });
  }

  // ------------------------------------------------------------ events

  function applyEv(ev) {
    switch (ev.kind) {
      case 'catch': {
        const sp = speciesInfo(ev.species);
        logEntry(ev);
        toast(`${sp?.emoji || '🐟'} ${ev.byName} caught a ${sp?.name}! ${ev.size}cm`, 2600, 'info');
        if (RARE_TIERS.has(ev.rarity)) ctx.fx.confettiBurst(innerWidth / 2, innerHeight * 0.4, 36);
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
        if (!isHost) decorList.push({ item: ev.item, x: ev.x, y: ev.y, spot: ev.spot });
        repaintBg();
        break;
      case 'sold':
        toast(`🪙 ${ev.byName} sold ${ev.count} fish for ${ev.total} coins!`, 2600, 'info');
        break;
      case 'gear': {
        if (!isHost) unlockedList = ev.unlocked || [...unlockedList, ev.item];
        const e = equipItem(ev.item);
        toast(`${e?.emoji || '🎒'} ${ev.byName} bought the ${e?.name || ev.item}!`, 2800, 'info');
        ctx.fx.confettiBurst(innerWidth / 2, innerHeight * 0.45, 26);
        fishing.setGear(isHost ? save.data.unlocked : unlockedList);
        if (ev.item === 'truck') spawnTruck();
        repaintBg();
        break;
      }
      case 'levelup':
        if (!isHost) guestXp = ev.xp;
        toast(`🎉 Camp Level ${ev.level}! New things unlocked`, 3400, 'info');
        ctx.fx.confettiRain();
        break;
      case 'truck': {
        if (!truck) spawnTruck();
        truck.driverId = ev.driverId;
        truck.riders = new Set(ev.riders);
        truck.driving = !!ev.driverId;
        // update local modes
        for (const p of players.values()) {
          const wire = p.me ? myId() : p.id;
          p.mode = ev.driverId === wire ? 'drive' : truck.riders.has(wire) ? 'ride' : 'walk';
        }
        if (!ev.driverId && truck) { // parked: everyone hops out beside it
          let k = 0;
          for (const p of players.values()) {
            if (p.mode !== 'walk') p.mode = 'walk';
            if (Math.abs(p.x - truck.x) < 10) { p.x = truck.x + 90 + k * 50; p.y = truck.y + 40; k++; }
          }
        }
        break;
      }
      case 'travel': startTravel(ev.spot, ev.byName); break;
      case 'honk':
        toast('📯 HONK!', 900, 'info');
        break;
      case 'reject': toast(ev.msg); break;
    }
    if (typeof ev.points === 'number') { if (isHost) save.data.points = ev.points; else guestPoints = ev.points; }
    if (typeof ev.xp === 'number' && !isHost) guestXp = ev.xp;
    if (ev.xpGain > 0) xpFloater(ev.xpGain);
    refreshStatus();
  }

  // ------------------------------------------------------------ truck

  function spawnTruck() {
    const s = map.truckSpot;
    truck = { x: s.x + s.w / 2, y: s.y + s.h / 2, dir: 1, driverId: null, riders: new Set(), driving: false };
  }

  function myTruckRole() {
    if (!truck) return null;
    const wire = myId();
    if (truck.driverId === wire) return 'drive';
    if (truck.riders.has(wire)) return 'ride';
    return null;
  }

  function openTravel() {
    const lvl = level();
    els.travelList.replaceChildren(...SPOT_ORDER.map((id) => {
      const m = MAPS[id];
      const here = id === map.id;
      const locked = m.minLevel > lvl;
      const row = document.createElement('button');
      row.className = 'shop-row';
      row.innerHTML = `<span>${m.emoji} ${m.name}</span><span class="cost">${here ? 'here 📍' : locked ? `Lv ${m.minLevel} 🔒` : 'GO →'}</span>`;
      row.disabled = here || locked;
      row.onclick = () => {
        els.travel.classList.add('hidden');
        act('travel', { spot: id });
      };
      return row;
    }));
    els.travel.classList.remove('hidden');
  }

  function startTravel(spot, byName) {
    if (traveling) return;
    traveling = true;
    const dest = getMap(spot);
    els.transition.querySelector('.travel-dest').textContent = `${dest.emoji} ${dest.name}`;
    els.transition.classList.remove('hidden');
    setTimeout(() => {
      setSpot(spot);
      els.transition.classList.add('hidden');
      traveling = false;
    }, 2600);
  }

  // ------------------------------------------------------------ market

  function openMarket() {
    els.marketCoins.textContent = `🪙 ${pts()} coins · Camp Lv ${level()}`;
    const creel = fireAct.sessionFish;
    const mult = unlockedHas('cooler') ? 1.2 : 1;
    els.marketCreel.replaceChildren(...(creel.length ? creel.map((f) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const sp = speciesInfo(f.species);
      row.innerHTML = `${sp?.emoji || '🐟'} ${sp?.name} · ${f.size}cm <b style="float:right">🪙 ${Math.round(sellPrice(f.species, f.size) * mult)}</b>`;
      return row;
    }) : [(() => { const d = document.createElement('div'); d.className = 'log-row'; d.textContent = 'Empty — catch something first! 🎣'; return d; })()]));
    els.btnSellAll.disabled = creel.length === 0;
    els.marketGear.replaceChildren(...EQUIPMENT.map((e) => {
      const owned = unlockedHas(e.item);
      const locked = level() < e.minLevel;
      const row = document.createElement('button');
      row.className = 'shop-row';
      row.innerHTML = `<span>${e.emoji} ${e.name} <small style="opacity:.6">${e.desc}</small></span><span class="cost">${owned ? 'owned ✓' : locked ? `Lv ${e.minLevel} 🔒` : '🪙 ' + e.cost}</span>`;
      row.disabled = owned || locked || pts() < e.cost;
      row.onclick = () => { act('buy', { item: e.item }); els.market.classList.add('hidden'); };
      return row;
    }));
    els.market.classList.remove('hidden');
  }

  // ------------------------------------------------------------ net handlers

  function wireNet() {
    net.on('hi', (msg, fromPeer) => {
      if (!isHost || !fromPeer) return;
      const idx = players.size % map.spawns.length;
      const spawn = map.spawns[idx];
      const hue = (players.size * 77 + 140) % 360;
      addPlayer(fromPeer, msg.name || 'Camper', hue, spawn.x, spawn.y);
      net.send({
        t: 'init',
        yourId: fromPeer,
        spot: map.id,
        world: { fire: world.fire, tod: world.tod },
        decor: save.data.decor,
        unlocked: save.data.unlocked,
        points: pts(),
        xp: xp(),
        catches: sessionLog.slice(0, 10),
        truck: truck ? { x: truck.x, y: truck.y, driverId: truck.driverId, riders: [...truck.riders] } : null,
        players: [...players.values()].filter((p) => p.id !== fromPeer).map((p) => ({
          id: p.me ? 'host' : p.id, name: p.name, hue: p.hue, x: p.x, y: p.y,
        })),
        you: { x: spawn.x, y: spawn.y, hue },
      }, fromPeer);
      net.broadcastExcept(fromPeer, { t: 'join', id: fromPeer, name: msg.name, hue, x: spawn.x, y: spawn.y });
      toast(`${msg.name} arrived at camp 🏕️`, 2400, 'info');
    });

    net.on('init', (msg) => {
      if (isHost) return;
      wireId = msg.yourId || null;
      guestSpot = msg.spot || 'lakeside';
      map = getMap(guestSpot);
      world = { ...makeWorldState(), ...msg.world };
      decorList = msg.decor || [];
      unlockedList = msg.unlocked || [];
      guestPoints = msg.points || 0;
      guestXp = msg.xp || 0;
      sessionLog = msg.catches || [];
      if (msg.truck) { spawnTruck(); truck.x = msg.truck.x; truck.y = msg.truck.y; truck.driverId = msg.truck.driverId; truck.riders = new Set(msg.truck.riders); truck.driving = !!msg.truck.driverId; }
      else if (unlockedList.includes('truck')) spawnTruck();
      repaintBg();
      fishing.setGear(unlockedList);
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
      if (p) { p.x = msg.x; p.y = msg.y; }
    });

    net.on('tpos', (msg, fromPeer) => {
      if (!truck) spawnTruck();
      truck.x = msg.x; truck.y = msg.y; truck.dir = msg.d;
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
    if (frameFlip) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    const v = input.vector();
    const busy = fishing.active || fireAct.active || stars?.open || traveling;
    const role = myTruckRole();

    if (role === 'drive' && !busy) {
      // driving: joystick moves the truck; camera & my avatar follow
      if (v.x || v.y) {
        const nx = truck.x + v.x * TRUCK_SPEED * dt;
        const ny = truck.y + v.y * TRUCK_SPEED * dt;
        const step = clampMove(map, truck.x, truck.y, nx, ny, TRUCK_R);
        truck.x = step.x; truck.y = step.y;
        if (Math.abs(v.x) > 0.15) truck.dir = v.x > 0 ? 1 : -1;
        sendTpos(now);
      }
      me.x = truck.x; me.y = truck.y;
    } else if (role === 'ride') {
      me.x = truck.x; me.y = truck.y;
    } else if (!busy && (v.x || v.y)) {
      const step = clampMove(map, me.x, me.y, me.x + v.x * SPEED * dt, me.y + v.y * SPEED * dt);
      me.m = step.x !== me.x || step.y !== me.y;
      me.x = step.x;
      me.y = step.y;
      me.f = v.x < -0.2 ? -1 : v.x > 0.2 ? 1 : me.f;
      if (fishing.state === 'idle') net.sendPos(me, now);
    } else me.m = false;

    for (const p of players.values()) {
      if (p.interp && p.mode === 'walk') {
        const s = p.interp.at(now);
        p.rx = s.x; p.ry = s.y; p.rm = s.m;
      }
    }

    if (!busy) updateActionLabel(role);
    render(now);
  }

  let lastTposSent = 0;
  function sendTpos(now) {
    if (now - lastTposSent < 100) return;
    lastTposSent = now;
    net.send({ t: 'tpos', x: Math.round(truck.x), y: Math.round(truck.y), d: truck.dir, relay: !isHost });
  }

  function updateActionLabel(role) {
    if (role === 'drive') {
      const sign = map.roadSign;
      const nearSign = (truck.x - sign.x) ** 2 + (truck.y - sign.y) ** 2 < 220 ** 2;
      input.setAction(nearSign ? 'TRAVEL 🗺️' : 'PARK 🛻');
      return;
    }
    if (role === 'ride') { input.setAction('HONK 📯'); return; }
    if (truck && unlockedHas('truck')) {
      const nearTruck = (me.x - truck.x) ** 2 + (me.y - truck.y) ** 2 < 170 ** 2;
      if (nearTruck && !truck.driving) { input.setAction('DRIVE 🛻'); return; }
      if (nearTruck && truck.driving && !myTruckRole()) { input.setAction('RIDE 🛻'); return; }
    }
    const it = nearestInteractable(map, me.x, me.y, { night: isNight(), hasAuger: unlockedHas('auger') });
    if (!it) input.setAction(null);
    else if (it.kind === 'firepit') input.setAction(fireAct.firepitLabel());
    else input.setAction(it.label);
  }

  function render(now) {
    const view = [...players.values()].map((p) => ({
      x: p.me ? p.x : (p.rx ?? p.x),
      y: p.me ? p.y : (p.ry ?? p.y),
      m: p.me ? p.m : (p.rm ?? false),
      f: p.f, name: p.name, hue: p.hue, head: p.head, me: p.me,
      hidden: p.mode !== 'walk',
      driving: p.me && p.mode === 'drive',
      fishing: p.me ? fishing.fishingView : p.fishing,
    }));
    const truckView = truck ? {
      x: truck.x, y: truck.y, dir: truck.dir, driving: truck.driving,
      heads: truck.driving ? occupantHeads() : null,
    } : null;
    renderer.frame(now, view, world, truck?.driving ? truckView : null);
  }

  function occupantHeads() {
    const heads = [];
    const wireOf = (p) => (p.me ? myId() : p.id);
    for (const p of players.values()) {
      if (truck.driverId === wireOf(p)) heads[0] = p.head;
      else if (truck.riders.has(wireOf(p))) heads.push(p.head);
    }
    return heads.filter(Boolean);
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
    unlockedList = [];
    truck = null;
    traveling = false;

    renderer = new CampRenderer(els.canvas);
    map = getMap('lakeside');
    renderer.paintBackground(map, []);
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
      waterTarget: (pos) => {
        const w = map.water;
        if (w.type === 'lake') return { x: w.cx, y: w.cy };
        if (w.type === 'frozen') {
          let best = w.holes[0], bd = Infinity;
          for (const h of w.holes) {
            const d = (pos.x - h.x) ** 2 + (pos.y - h.y) ** 2;
            if (d < bd) { bd = d; best = h; }
          }
          return { x: best.x, y: best.y };
        }
        if (w.type === 'river') return { x: pos.x, y: w.cy + Math.sin(pos.x * w.k * Math.PI) * w.amp };
        return { x: pos.x, y: w.base + Math.sin(pos.x * w.k * Math.PI) * w.amp + 220 }; // ocean
      },
    });
    fireAct = new FireActions(els, {
      sendAct: (kind, extra) => act(kind, extra),
      toast,
      setPrompt: (l) => { els.prompt.textContent = l || ''; if (l) input.setAction(l); },
      fireState: () => world.fire,
      onWood: () => refreshStatus(),
      hasGear: (g) => unlockedHas(g),
      mapWoodBonus: () => map.features.woodBonus || 0,
    });
    stars = new StarView(els.starView, {
      onTrace: (x, y) => net.send({ t: 'trace', x, y, relay: true }),
      onComplete: (id) => act('constellation', { id }),
      done: () => {},
      toast,
    });
    decorUI = new DecorUI(els, {
      points: () => pts(),
      requestPlace: (item, x, y) => act('place', { item, x, y }),
      toast,
      screenToWorld: (sx, sy) => renderer.screenToWorld(sx, sy),
    });

    me = addPlayer('me', ctx.user()?.name || 'You', 20, map.spawns[0].x, map.spawns[0].y);

    // Wire the network BEFORE anything sends: the guest's 'hi' handshake was
    // once sent pre-attach and vanished — the two players ended up in
    // separate worlds.
    wireNet();
    if (!soloMode) net.attach(ctx.party(), isHost);

    save = new CampSave(isHost ? (ctx.user()?.uid ?? null) : null);
    if (isHost) {
      save.load().then(() => {
        map = getMap(save.data.spot || 'lakeside');
        me.x = map.spawns[0].x; me.y = map.spawns[0].y;
        if (save.data.unlocked.includes('truck')) spawnTruck();
        repaintBg();
        fishing.setGear(save.data.unlocked);
        refreshStatus();
      });
      hostTick = setInterval(() => {
        const wasLit = world.fire.lit;
        const decay = (map.features.fireDecayMult || 1) * (save.data.unlocked.includes('heater') ? 0.5 : 1);
        tickWorld(world, 1, decay);
        if (wasLit && !world.fire.lit) broadcastEv({ kind: 'fireOut' });
        net.send({ t: 'world', fire: world.fire, tod: world.tod });
      }, 1000);
    } else {
      net.send({ t: 'hi', name: ctx.user()?.name || 'Camper' });
    }

    input.onActionDown = () => {
      if (stars.open || traveling) return;
      if (fishing.active) return void fishing.actionDown({ x: me.x, y: me.y });
      if (fireAct.mode === 'strike') return void fireAct.firepitAction();
      const role = myTruckRole();
      if (role === 'drive') {
        const sign = map.roadSign;
        const nearSign = (truck.x - sign.x) ** 2 + (truck.y - sign.y) ** 2 < 220 ** 2;
        if (nearSign) openTravel();
        else act('park');
        return;
      }
      if (role === 'ride') return void act('honk');
      if (truck && unlockedHas('truck')) {
        const nearTruck = (me.x - truck.x) ** 2 + (me.y - truck.y) ** 2 < 170 ** 2;
        if (nearTruck && !truck.driving) return void act('drive');
        if (nearTruck && truck.driving) return void act('ride');
      }
      const it = nearestInteractable(map, me.x, me.y, { night: isNight(), hasAuger: unlockedHas('auger') });
      if (!it) return;
      if (it.kind === 'locked') return void toast(it.reason, 2400, 'info');
      if (it.kind === 'shore') fishing.actionDown({ x: me.x, y: me.y });
      else if (it.kind === 'firepit') fireAct.firepitAction();
      else if (it.kind === 'tree') fireAct.chop();
      else if (it.kind === 'market') openMarket();
      else if (it.kind === 'tent') stars.show(Object.keys(isHost ? save.data.constellations : {}));
    };
    input.onActionUp = () => { fishing.actionUp(); fireAct.actionUp(); };

    els.canvas.addEventListener('pointerdown', onCanvasTap);

    els.btnLeave.onclick = () => {
      if (isHost) { net.send({ t: 'end' }); stop('ended'); }
      else { net.send({ t: 'bye', relay: false }); stop('left'); }
    };
    els.btnLog.onclick = () => { renderLogPanel(); els.log.classList.toggle('hidden'); };
    els.btnShop.onclick = () => decorUI.openShop();
    els.btnShopClose.onclick = () => decorUI.closeShop();
    els.btnStarClose.onclick = () => stars.hide();
    els.btnMarketClose.onclick = () => els.market.classList.add('hidden');
    els.btnTravelClose.onclick = () => els.travel.classList.add('hidden');
    els.btnSellAll.onclick = () => {
      const creel = fireAct.sessionFish.splice(0);
      if (creel.length === 0) return;
      act('sell', { creel: creel.map((f) => ({ species: f.species, size: f.size })) });
      els.market.classList.add('hidden');
      refreshStatus();
    };

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
    wireId = null;
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
    for (const id of ['campLog', 'campShop', 'campMarket', 'travelModal', 'travelTransition']) $(id)?.classList.add('hidden');
    ctx.exitGameMode();
    ctx.onStopped?.(reason, fromRemote);
  }

  // ------------------------------------------------------------ controller

  const controller = {
    id: 'camp',
    get active() { return active; },
    start,
    stop,
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
    debug: {
      get world() { return world; },
      get map() { return map; },
      get players() { return players; },
      get save() { return save; },
      get truck() { return truck; },
      teleport(x, y) { me.x = x; me.y = y; },
      setFire(lvl, lit = true) { world.fire = { lvl, lit }; },
      forceBite() { fishing.onFishAssigned({ ...rollFish(Math.random, { mapId: map.id }), biteMs: 10 }); },
      setTod(t) { world.tod = t; },
      grantPoints(n) { if (isHost) save?.update((d) => { d.points += n; }); else guestPoints += n; refreshStatus(); },
      grantXp(n) { awardXp(n); refreshStatus(); },
      setSpot: (id) => setSpot(id, { silent: true }),
      spawnTruck,
      tick(dt) { tickWorld(world, dt, map.features.fireDecayMult || 1); },
      frame(t) { render(t); },
      act,
      input: () => input,
      fishing: () => fishing,
      fire: () => fireAct,
      stars: () => stars,
      decor: () => decorUI,
      level, xp,
      openTravel, openMarket,
    },
  };
  return controller;
}
