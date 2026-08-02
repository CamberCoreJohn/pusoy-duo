// Kritzzz — orchestrator. A video-calling app first; games overlay the call.
//
// Screens: auth -> home -> call. Games run inside the call as an overlay the
// host can start and anyone can dismiss. Seats: 0 = call host (or solo
// player); human guests take seats in join order at deal time; remaining
// seats up to the chosen table size are AI, which run on the host. The host
// runs PusoyEngine and is authoritative; guests send intents and render the
// snapshots the host sends them.

import { PusoyEngine } from './game/engine.js';
import { validatePlay, classify } from './game/combos.js';
import { parseCard, SUIT_GLYPH, SUIT_IS_RED, rankLabel, cardValue } from './game/cards.js';
import { chooseAiPlay } from './game/ai.js';
import { Party } from './net/peer.js';
import { HandInput } from './gestures/hands.js';
import { AvatarSystem } from './avatars.js';
import { initAuth, authAvailable, register, signIn, signOutUser, continueAsGuest, authErrorMessage, signInWithGoogle } from './auth/auth.js';
import { initSocial, stopSocial, myCode, addFriendByCode, respondRequest, sendInvite, answerInvite, getStats, recordGameResult } from './social/friends.js';
import { runIntro } from './intro.js';
import { flyCards, passBubble, swooshPile, shakeTable, rainbowSweep, confettiBurst, confettiRain } from './fx.js';

const $ = (id) => document.getElementById(id);
const els = [
  'authScreen', 'authTabs', 'authName', 'authEmail', 'authPassword', 'btnAuthSubmit',
  'authError', 'authOr', 'guestName', 'btnGuest', 'authNote', 'btnGoogle',
  'friendsCard', 'myCodePill', 'requestsList', 'friendsList', 'friendCode', 'btnAddFriend', 'friendsStatus',
  'ringModal', 'ringText', 'btnRingAccept', 'btnRingDecline',
  'homeScreen', 'greeting', 'myStats', 'btnCall', 'btnJoin', 'joinCode', 'btnPractice', 'homeStatus', 'btnSignOut',
  'callScreen', 'videoGrid', 'localVideo', 'tileStrip', 'videoPark', 'codeBanner', 'callCode', 'btnCopyCode', 'rosterInfo',
  'btnMute', 'btnCam', 'btnGames', 'btnHangup',
  'gamePicker', 'sizeSeg', 'pickerHint', 'btnStartGame', 'btnPickerCancel',
  'gameLayer', 'btnLeaveGame', 'btnControls', 'btnTableMode', 'tableLayer',
  'oppBar', 'pileLabel', 'pileArea', 'pileCards', 'turnBanner', 'handArea',
  'btnSort', 'btnPlay', 'btnPass', 'passRing', 'gameOver', 'gameOverText', 'btnRematch', 'btnEndGame',
  'toast', 'cursor',
].reduce((m, id) => (m[id] = $(id), m), {});

// ?demo — hotseat mode, no camera/network/auth: the screen always shows the
// hand of whichever seat is to act. For quick testing.
const DEMO = new URLSearchParams(location.search).has('demo');

const AI_NAMES = ['Bot Nina', 'Bot Migs', 'Bot Cai'];
const AI_DELAY_MS = [800, 1600];
const MAX_HUMANS = 4;

const hands = new HandInput();
const avatars = new AvatarSystem();
window.__kritzzz = { avatars }; // debug handle
let currentUser = null;    // {name, email, isGuest}
let party = null;          // Party instance, one per call
let engine = null;         // host/solo only
let iAmAuthority = false;  // host, solo, or demo: engine runs here
let solo = false;
let mySeat = 0;
let tableSize = 2;
let seats = [];            // [{isAI, name, peerId}] — fixed at deal time
const peers = new Map();   // peerId -> {name} — everyone in the call
let state = null;          // latest snapshot for my seat
let selected = new Set();
let gameActive = false;
let gesturesStarted = false;
let localStream = null;
let toastTimer = 0;
let aiTimer = 0;
const remoteVideos = new Map(); // peerId -> <video>

const show = (el, on = true) => el.classList.toggle('hidden', !on);
const showScreen = (which) => {
  for (const s of [els.authScreen, els.homeScreen, els.callScreen]) show(s, s === which);
};

// ================================================================ auth

let authTab = 'signin';

function renderAuthScreen() {
  const hasAccounts = authAvailable;
  show(els.btnGoogle, hasAccounts);
  show(els.authTabs, hasAccounts);
  show(els.authName, hasAccounts && authTab === 'register');
  show(els.authEmail, hasAccounts);
  show(els.authPassword, hasAccounts);
  show(els.btnAuthSubmit, hasAccounts);
  els.btnAuthSubmit.textContent = authTab === 'register' ? 'Create account' : 'Sign in';
  els.authPassword.autocomplete = authTab === 'register' ? 'new-password' : 'current-password';
  els.authOr.textContent = hasAccounts ? '— or play without an account —' : '— play as a guest —';
  els.authNote.textContent = hasAccounts ? '' :
    'Email accounts are not configured on this install (see src/auth/firebase-config.js)';
}

els.authTabs.onclick = (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  authTab = b.dataset.tab;
  for (const x of els.authTabs.children) x.classList.toggle('on', x === b);
  els.authError.textContent = '';
  renderAuthScreen();
};

els.btnAuthSubmit.onclick = async () => {
  els.authError.textContent = '';
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  try {
    if (authTab === 'register') {
      const name = els.authName.value.trim();
      if (!name) { els.authError.textContent = 'Enter your name'; return; }
      onUser(await register(name, email, password));
    } else {
      await signIn(email, password); // onAuthStateChanged fires onUser
    }
  } catch (e) {
    els.authError.textContent = authErrorMessage(e);
  }
};

els.btnGoogle.onclick = async () => {
  els.authError.textContent = '';
  try { await signInWithGoogle(); } // redirect flow returns via onAuthStateChanged
  catch (e) { els.authError.textContent = authErrorMessage(e); }
};

els.btnGuest.onclick = () => {
  const name = els.guestName.value.trim();
  if (!name) { els.authError.textContent = 'Enter your name first'; return; }
  onUser(continueAsGuest(name));
};

els.btnSignOut.onclick = async () => {
  stopSocial();
  await signOutUser();
  currentUser = null;
  show(els.friendsCard, false);
  showScreen(els.authScreen);
};

function onUser(user) {
  currentUser = user;
  if (!user) { renderAuthScreen(); showScreen(els.authScreen); return; }
  els.greeting.textContent = `Hi ${user.name}${user.isGuest ? ' (guest)' : ''} — who are we calling?`;
  show(els.btnSignOut, true);
  els.btnSignOut.textContent = user.isGuest ? 'Change name' : 'Sign out';
  showScreen(els.homeScreen);
  if (!user.isGuest && user.uid) startSocial();
  else { show(els.friendsCard, false); renderStats(loadGuestStats()); }
}

// ---------------------------------------------------------------- stats

const GUEST_STATS_KEY = 'kritzzz-stats';

function loadGuestStats() {
  try { return JSON.parse(localStorage.getItem(GUEST_STATS_KEY)) || { games: 0, wins: 0 }; }
  catch { return { games: 0, wins: 0 }; }
}

function renderStats(s) {
  els.myStats.textContent = s && s.games > 0 ? `🏆 ${s.wins} wins · ${s.games} games` : '';
}

async function recordResult(won) {
  if (DEMO) return;
  if (currentUser && !currentUser.isGuest) {
    renderStats((await recordGameResult(won)) || getStats());
  } else {
    const s = loadGuestStats();
    s.games += 1;
    if (won) s.wins += 1;
    localStorage.setItem(GUEST_STATS_KEY, JSON.stringify(s));
    renderStats(s);
  }
}

// ================================================================ friends & invites

let outgoingInvite = null;   // handle from sendInvite
let incomingInvite = null;   // latest ringing invite doc

async function startSocial() {
  try {
    await initSocial(currentUser, {
      onFriends: renderFriends,
      onRequests: renderRequests,
      onInvite: onIncomingInvite,
    });
    els.myCodePill.textContent = myCode();
    show(els.friendsCard, true);
    renderStats(getStats());
  } catch (e) {
    console.warn('social init failed', e);
    els.friendsStatus.textContent = 'Friends unavailable: ' + e.message;
    show(els.friendsCard, true);
  }
}

els.myCodePill.onclick = async () => {
  try {
    await navigator.clipboard.writeText(myCode() || '');
    showToastHome('Code copied — send it to a friend');
  } catch { /* visible anyway */ }
};

function showToastHome(msg) { els.friendsStatus.textContent = msg; setTimeout(() => { if (els.friendsStatus.textContent === msg) els.friendsStatus.textContent = ''; }, 2500); }

els.btnAddFriend.onclick = async () => {
  const code = els.friendCode.value.trim();
  if (code.length < 6) { showToastHome('Enter a 6-character code'); return; }
  try {
    const name = await addFriendByCode(code);
    els.friendCode.value = '';
    showToastHome(`Request sent to ${name}`);
  } catch (e) { showToastHome(e.message); }
};

function renderRequests(list) {
  els.requestsList.replaceChildren(...list.map((r) => {
    const row = document.createElement('div');
    row.className = 'request-row';
    row.innerHTML = `<span class="fname">🤝 ${r.name}</span>`;
    const ok = document.createElement('button');
    ok.className = 'ok-btn'; ok.textContent = 'Accept';
    ok.onclick = () => respondRequest(r.id, true).catch((e) => showToastHome(e.message));
    const no = document.createElement('button');
    no.className = 'no-btn'; no.textContent = 'Ignore';
    no.onclick = () => respondRequest(r.id, false).catch((e) => showToastHome(e.message));
    row.append(ok, no);
    return row;
  }));
}

function renderFriends(list) {
  if (list.length === 0) {
    els.friendsList.innerHTML = '<div class="hint">No friends yet — swap codes!</div>';
    return;
  }
  els.friendsList.replaceChildren(...list.map((f) => {
    const row = document.createElement('div');
    row.className = 'friend-row' + (f.online ? ' online' : '');
    row.innerHTML = `<span class="dot"></span><span class="fname">${f.name}</span>`;
    const call = document.createElement('button');
    call.className = 'call-btn';
    call.textContent = f.online ? '📞 Call' : 'Offline';
    call.disabled = !f.online;
    call.onclick = () => callFriend(f);
    row.appendChild(call);
    return row;
  }));
}

async function callFriend(f) {
  try {
    els.homeStatus.textContent = 'Starting camera…';
    await getCamera();
    newParty();
    const code = await party.host(localStream);
    iAmAuthority = true;
    solo = false;
    mySeat = 0;
    els.callCode.textContent = code;
    show(els.codeBanner, true);
    updateRoster([currentUser.name]);
    enterCall();
    showToast(`Ringing ${f.name}…`, 4000);
    outgoingInvite = await sendInvite(f.uid, code);
    outgoingInvite.watch((status) => {
      if (status === 'declined') showToast(`${f.name} can't talk right now`, 3500);
      if (status === 'accepted') showToast(`${f.name} is joining…`, 2500);
    });
    setTimeout(() => outgoingInvite?.cancel(), 50_000); // stop ringing eventually
  } catch (e) {
    els.homeStatus.textContent = 'Error: ' + e.message;
  }
}

function onIncomingInvite(inv) {
  incomingInvite = inv;
  // don't interrupt an active call with a ring
  const inCall = !els.callScreen.classList.contains('hidden');
  if (!inv || inCall) { show(els.ringModal, false); return; }
  els.ringText.textContent = `${inv.fromName} is calling`;
  show(els.ringModal, true);
}

els.btnRingAccept.onclick = async () => {
  const inv = incomingInvite;
  show(els.ringModal, false);
  if (!inv) return;
  try {
    await getCamera();
    await answerInvite(inv.id, true);
    newParty();
    iAmAuthority = false;
    solo = false;
    els.callCode.textContent = inv.room;
    show(els.codeBanner, true);
    await party.join(inv.room, localStream);
  } catch (e) {
    showToastHome('Could not join: ' + e.message);
    showScreen(els.homeScreen);
  }
};

els.btnRingDecline.onclick = () => {
  const inv = incomingInvite;
  show(els.ringModal, false);
  if (inv) answerInvite(inv.id, false).catch(() => {});
};

// ================================================================ camera

async function getCamera({ required = true } = {}) {
  if (localStream) return true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: true,
    });
    els.localVideo.srcObject = localStream;
    return true;
  } catch (e) {
    if (required) throw e;
    return false;
  }
}

function releaseCamera() {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  els.localVideo.srcObject = null;
}

// ================================================================ call setup

function newParty() {
  party = new Party();

  party.onRemoteStream = (peerId, stream) => {
    let v = remoteVideos.get(peerId);
    if (!v) {
      v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute('playsinline', ''); // iOS Safari needs the attribute form
      remoteVideos.set(peerId, v);
    }
    v.srcObject = stream;
    layout();
    if (gameActive) buildTableSpots(); // a feed just became available for an avatar
  };

  party.onPeerJoin = (peerId) => {
    if (peers.size >= MAX_HUMANS - 1) {
      party.send('full', 'This call is full', peerId);
      return;
    }
    peers.set(peerId, { name: 'Someone' });
    const others = [...peers.keys()].filter((id) => id !== peerId);
    party.send('peers', { ids: others }, peerId);
    broadcastRoster();
  };

  party.onPeerLeave = (peerId) => {
    const name = peers.get(peerId)?.name || 'Someone';
    peers.delete(peerId);
    remoteVideos.get(peerId)?.remove();
    remoteVideos.delete(peerId);
    layout();
    const seat = seats.findIndex((s) => s.peerId === peerId);
    if (engine && seat >= 0 && engine.winner < 0) {
      // A seated human dropped mid-round: an AI takes over their hand.
      seats[seat] = { isAI: true, name: `${name} (AI)`, peerId: null };
      showToast(`${name} left — AI plays their hand`, 3500);
      if (gameActive) buildTableSpots();
      if (iAmAuthority) { broadcastSeats(); broadcast(); }
    } else {
      showToast(`${name} left the call`, 2500);
    }
    broadcastRoster();
  };

  party.onOpen = () => {
    // guest: data channel to host ready
    party.send('hello', { name: currentUser.name });
    enterCall();
  };

  party.on('hello', ({ name }, fromPeer) => {
    if (peers.has(fromPeer)) peers.get(fromPeer).name = name;
    broadcastRoster();
  });

  party.on('roster', ({ names }) => updateRoster(names));
  party.on('peers', ({ ids }) => ids.forEach((id) => party.callPeer(id)));
  party.on('full', (msg) => { els.homeStatus.textContent = msg; party.destroy(); });

  party.on('setup', ({ seats: s, you }) => {
    seats = s.map((x) => ({ ...x, peerId: null }));
    mySeat = you;
    showGame();
  });
  party.on('state', (snap) => applyState(snap));
  party.on('reject', (reason) => showToast(reason));
  party.on('game-end', () => hideGame());
  party.on('table', ({ on }) => setTableMode(on, true));

  party.on('intent', ({ action, cards }, fromPeer) => {
    if (!iAmAuthority) return;
    if (action === 'end') { endGameEverywhere(); return; }
    const seat = seats.findIndex((s) => s.peerId === fromPeer);
    if (seat >= 0) hostAction(seat, action, cards);
  });
}

function broadcastRoster() {
  if (!party?.isHost) return;
  const names = [currentUser.name, ...[...peers.values()].map((p) => p.name)];
  party.send('roster', { names });
  updateRoster(names);
}

function updateRoster(names) {
  els.rosterInfo.textContent = names.length > 1 ? `· ${names.join(', ')}` : '· waiting…';
}

els.btnCall.onclick = async () => {
  try {
    els.homeStatus.textContent = 'Starting camera…';
    await getCamera();
    els.homeStatus.textContent = 'Creating call…';
    newParty();
    const code = await party.host(localStream);
    iAmAuthority = true;
    solo = false;
    mySeat = 0;
    els.callCode.textContent = code;
    show(els.codeBanner, true);
    updateRoster([currentUser.name]);
    enterCall();
  } catch (e) {
    els.homeStatus.textContent = 'Error: ' + e.message;
  }
};

els.btnJoin.onclick = async () => {
  const code = els.joinCode.value.trim();
  if (code.length !== 5) { els.homeStatus.textContent = 'Enter the 5-letter code'; return; }
  try {
    els.homeStatus.textContent = 'Starting camera…';
    await getCamera();
    els.homeStatus.textContent = 'Connecting…';
    newParty();
    iAmAuthority = false;
    solo = false;
    els.callCode.textContent = code.toUpperCase();
    show(els.codeBanner, true);
    await party.join(code, localStream);
    // enterCall happens in party.onOpen
  } catch (e) {
    els.homeStatus.textContent = 'Error: ' + e.message;
  }
};

els.btnPractice.onclick = async () => {
  els.homeStatus.textContent = '';
  const cam = await getCamera({ required: false });
  iAmAuthority = true;
  solo = true;
  mySeat = 0;
  show(els.codeBanner, false);
  enterCall();
  if (!cam) showToast('No camera found — mouse mode', 3000);
  openPicker();
};

function enterCall() {
  els.homeStatus.textContent = '';
  showScreen(els.callScreen);
  layout();
}

els.btnCopyCode.onclick = async () => {
  try {
    await navigator.clipboard.writeText(els.callCode.textContent);
    showToast('Code copied', 1200);
  } catch { /* iOS may deny outside a direct tap; the code is visible anyway */ }
};

// ---------------------------------------------------------------- call controls

els.btnMute.onclick = () => {
  const t = localStream?.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  els.btnMute.classList.toggle('off', !t.enabled);
};

els.btnCam.onclick = () => {
  const t = localStream?.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  els.btnCam.classList.toggle('off', !t.enabled);
};

els.btnHangup.onclick = () => {
  clearTimeout(aiTimer);
  outgoingInvite?.cancel();
  outgoingInvite = null;
  party?.destroy();
  party = null;
  peers.clear();
  for (const v of remoteVideos.values()) v.remove();
  remoteVideos.clear();
  hideGame();
  engine = null;
  releaseCamera();
  els.btnMute.classList.remove('off');
  els.btnCam.classList.remove('off');
  show(els.codeBanner, false);
  showScreen(els.homeScreen);
};

els.btnGames.onclick = () => {
  if (gameActive) return;
  if (!iAmAuthority) { showToast('Only the call creator can deal — ask them to start'); return; }
  openPicker();
};

// ---------------------------------------------------------------- layout

function feltEl() {
  const bg = document.createElement('div');
  bg.className = 'table-bg';
  bg.textContent = '🂡';
  return bg;
}

function allVideos() {
  return [els.localVideo, ...remoteVideos.values()];
}

// Re-parenting can pause media on iOS Safari; nudge everything back to playing.
function keepPlaying() {
  for (const v of allVideos()) if (v.srcObject) v.play?.().catch(() => {});
}

function layout() {
  if (gameActive) {
    // In-game, opponents live in their table-style spots (video circles with
    // card backs), so the strip and swap go away in both modes. Remote videos
    // move to the hidden park (NOT out of the DOM) so they keep decoding —
    // the spot avatars sample frames from them. Camera mode keeps your own
    // feed as the AR table; Table Mode swaps it for the felt.
    if (tableMode || !localStream) {
      els.videoGrid.replaceChildren(feltEl());
      els.videoGrid.dataset.count = 0;
      els.videoPark.replaceChildren(...allVideos());
    } else {
      els.videoGrid.replaceChildren(els.localVideo);
      els.videoGrid.dataset.count = 1;
      els.videoPark.replaceChildren(...remoteVideos.values());
    }
    keepPlaying();
    els.tileStrip.replaceChildren();
    show(els.tileStrip, false);
    return;
  }
  // Plain call: partners fullscreen, you in a corner tile (or just you, solo).
  const remotes = [...remoteVideos.values()];
  const haveCam = !!localStream;
  const main = remotes.length ? remotes : haveCam ? [els.localVideo] : [];
  const tiles = remotes.length && haveCam ? [els.localVideo] : [];

  if (main.length) {
    els.videoGrid.replaceChildren(...main);
    els.videoGrid.dataset.count = main.length;
  } else {
    els.videoGrid.replaceChildren(feltEl());
    els.videoGrid.dataset.count = 0;
  }
  els.tileStrip.replaceChildren(...tiles);
  show(els.tileStrip, tiles.length > 0);
  keepPlaying();
}

// ---------------------------------------------------------------- table mode
//
// Host-synced: the whole screen becomes the felt table and players appear as
// avatars seated around it — humans as background-removed video cutouts,
// bots as generic animated feeds. Positions are relative to YOUR seat: you
// always sit at the bottom.

let tableMode = false;

// Self spot is positioned by CSS (centered above the turn banner).
const SPOT_POS = {
  2: [{ x: '50%', y: '30%' }],
  3: [{ x: '24%', y: '32%' }, { x: '76%', y: '32%' }],
  4: [{ x: '16%', y: '44%' }, { x: '50%', y: '24%' }, { x: '84%', y: '44%' }],
};

els.btnTableMode.onclick = () => {
  if (!iAmAuthority) return;
  setTableMode(!tableMode);
};

function setTableMode(on, fromRemote = false) {
  if (tableMode === on) return;
  tableMode = on;
  els.btnTableMode.classList.toggle('on', on);
  layout();          // felt <-> your camera feed
  buildTableSpots(); // add/remove the self spot
  if (!fromRemote && !DEMO) party?.send('table', { on });
}

// Spots are shown for every opponent during ANY game (camera or table mode):
// avatar circle, name + count, and their hand as face-down card backs so
// plays visibly come from somewhere. Table mode adds your own self spot.
function buildTableSpots() {
  els.tableLayer.replaceChildren();
  if (!gameActive) return;
  const n = seats.length;
  if (!SPOT_POS[n]) return;
  const entries = [];
  for (let i = 0; i < n; i++) {
    const rel = (i - mySeat + n) % n;
    if (rel === 0 && !tableMode) continue; // self spot only on the felt
    const spot = document.createElement('div');
    spot.className = 'player-spot' + (rel === 0 ? ' self' : '');
    spot.dataset.seat = i;
    if (rel > 0) {
      const pos = SPOT_POS[n][rel - 1];
      spot.style.setProperty('--x', pos.x);
      spot.style.setProperty('--y', pos.y);
    }
    const canvas = document.createElement('canvas');
    const label = document.createElement('div');
    label.className = 'spot-label';
    spot.append(canvas, label);
    if (rel > 0) {
      const mini = document.createElement('div');
      mini.className = 'mini-cards';
      spot.append(mini);
    }
    els.tableLayer.appendChild(spot);
    const s = seats[i];
    const video = i === mySeat
      ? (localStream ? els.localVideo : null)
      : (s.peerId ? remoteVideos.get(s.peerId) : null);
    entries.push({
      canvas,
      kind: s.isAI ? 'bot' : video ? 'video' : 'initial',
      video,
      mirror: i === mySeat,
      hue: (i * 77 + 20) % 360,
      label: s.name,
    });
  }
  avatars.setEntries(entries);
  if (state) updateTableSpots(state);
}

function updateTableSpots(snap) {
  for (const spot of els.tableLayer.children) {
    const i = Number(spot.dataset.seat);
    spot.classList.toggle('turn', snap.turn === i && snap.winner < 0);
    spot.classList.toggle('control', !snap.pile && snap.turn === i && snap.winner < 0);
    const label = spot.querySelector('.spot-label');
    if (label) label.innerHTML = `${seatName(i)} · <span class="cnt">${snap.counts[i]}</span>`;
    const mini = spot.querySelector('.mini-cards');
    if (mini) {
      const want = Math.min(snap.counts[i], 13);
      if (mini.children.length !== want) {
        mini.replaceChildren(...Array.from({ length: want }, () => {
          const b = document.createElement('div');
          b.className = 'back-card';
          return b;
        }));
      }
    }
  }
}

// ================================================================ game lifecycle

els.sizeSeg.onclick = (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b) return;
  tableSize = Number(b.dataset.size);
  for (const x of els.sizeSeg.children) x.classList.toggle('on', x === b);
  updatePickerHint();
};

function openPicker() {
  updatePickerHint();
  show(els.gamePicker, true);
}

function updatePickerHint() {
  const humans = 1 + peers.size;
  const size = Math.min(4, Math.max(tableSize, humans));
  const bots = size - humans;
  els.pickerHint.textContent =
    `${humans} human${humans > 1 ? 's' : ''} in the call` +
    (bots > 0 ? ` — ${bots} AI bot${bots > 1 ? 's' : ''} will join` : '');
}

els.btnPickerCancel.onclick = () => {
  show(els.gamePicker, false);
  if (solo && !gameActive) els.btnHangup.onclick(); // nothing to do alone with no game
};

els.btnStartGame.onclick = () => {
  show(els.gamePicker, false);
  // Seats are fixed now: host, then humans in join order, then AI fill.
  seats = [{ isAI: false, name: currentUser?.name || 'Player 1', peerId: null }];
  for (const [peerId, p] of peers) seats.push({ isAI: false, name: p.name, peerId });
  const size = Math.min(4, Math.max(tableSize, seats.length));
  let b = 0;
  while (seats.length < size) seats.push({ isAI: true, name: AI_NAMES[b++], peerId: null });
  broadcastSeats();
  showGame();
  startRound();
};

function broadcastSeats() {
  for (const s of seats) {
    if (!s.peerId) continue;
    party.send('setup', {
      seats: seats.map((x) => ({ isAI: x.isAI, name: x.name })),
      you: seats.indexOf(s),
    }, s.peerId);
  }
}

// ---------------------------------------------------------------- control mode
//
// 'gesture' = MediaPipe hand tracking drives a cursor; 'touch' = tap/click
// only, no tracking at all. Phones/tablets default to touch (holding a phone
// and gesturing at it rarely works); desktops default to gestures.

const CONTROLS_KEY = 'kritzzz-controls';
let controlMode = localStorage.getItem(CONTROLS_KEY)
  || (matchMedia('(pointer: coarse)').matches ? 'touch' : 'gesture');

function renderControlsBtn() {
  const gesture = controlMode === 'gesture';
  els.btnControls.textContent = gesture ? '🖐️' : '👆';
  els.btnControls.classList.toggle('touch-on', !gesture);
  els.btnControls.title = gesture
    ? 'Hand gestures on — tap for touch controls'
    : 'Touch controls — tap for hand gestures';
}

els.btnControls.onclick = () => {
  controlMode = controlMode === 'gesture' ? 'touch' : 'gesture';
  localStorage.setItem(CONTROLS_KEY, controlMode);
  renderControlsBtn();
  showToast(controlMode === 'gesture' ? 'Hand gestures on 🖐️' : 'Touch controls 👆', 1500);
  if (controlMode === 'gesture') startGestures();
};

async function showGame() {
  gameActive = true;
  show(els.gameLayer, true);
  show(els.tableLayer, true);
  els.callScreen.classList.add('gaming');
  show(els.btnControls, !!localStream); // no camera -> nothing to toggle
  show(els.btnTableMode, iAmAuthority);
  renderControlsBtn();
  layout();
  buildTableSpots();
  avatars.start();
  if (controlMode === 'gesture') await startGestures();
}

function hideGame() {
  setTableMode(false, true); // each side ends table mode with its own game
  gameActive = false;
  clearTimeout(aiTimer);
  engine = null;
  state = null;
  selected.clear();
  avatars.stop();
  els.tableLayer.replaceChildren();
  show(els.tableLayer, false);
  show(els.gameLayer, false);
  show(els.gameOver, false);
  lastPileKey = '';
  lastLogN = 0;
  winnerCelebrated = false;
  els.callScreen.classList.remove('gaming');
  show(els.cursor, false);
  layout();
}

function endGameEverywhere() {
  party?.send('game-end', {});
  hideGame();
  if (solo) showScreen(els.homeScreen);
}

els.btnEndGame.onclick = els.btnLeaveGame.onclick = () => {
  if (iAmAuthority) endGameEverywhere();
  else party.send('intent', { action: 'end' });
};

async function startGestures() {
  if (!localStream || gesturesStarted) return;
  gesturesStarted = true;
  await hands.init();
  requestAnimationFrame(loop);
}

function startRound() {
  engine = new PusoyEngine({ players: seats.length });
  selected.clear();
  lastPileKey = ''; // first play of the round should animate
  lastLogN = 0;
  winnerCelebrated = false;
  customOrder = null;
  if (sortMode === 'custom') { sortMode = 'rank'; els.btnSort.textContent = SORTS.rank.label; }
  broadcast();
}

function broadcast() {
  if (DEMO) {
    mySeat = engine.winner >= 0 ? engine.winner : engine.turn;
    applyState(engine.snapshot(mySeat));
    return;
  }
  for (const [i, s] of seats.entries()) {
    if (s.peerId) party.send('state', engine.snapshot(i), s.peerId);
  }
  applyState(engine.snapshot(mySeat));
  scheduleAI();
}

function scheduleAI() {
  clearTimeout(aiTimer);
  if (!iAmAuthority || !engine || engine.winner >= 0) return;
  if (!seats[engine.turn]?.isAI) return;
  let delay = AI_DELAY_MS[0] + Math.random() * (AI_DELAY_MS[1] - AI_DELAY_MS[0]);
  // give the take-control celebration room to play out
  if (engine.log[engine.log.length - 1]?.type === 'control') delay += 2000;
  aiTimer = setTimeout(() => {
    if (!engine || !seats[engine.turn]?.isAI || engine.winner >= 0) return;
    const seat = engine.turn;
    const ids = chooseAiPlay(engine.hands[seat], engine.pile, {
      mustInclude: engine.mustIncludeLowest ? engine.lowestInPlay : null,
      rules: engine.rules,
      oppCounts: engine.hands.filter((_, i) => i !== seat).map((h) => h.length),
    });
    const res = ids ? engine.play(seat, ids) : engine.pass(seat);
    if (!res.ok) {
      console.error('AI move rejected:', res.reason);
      engine.pass(seat);
    }
    broadcast();
  }, delay);
}

function hostAction(player, action, cards) {
  if (!engine) return;
  let res;
  if (action === 'play') res = engine.play(player, cards);
  else if (action === 'pass') res = engine.pass(player);
  else if (action === 'rematch') { if (engine.winner >= 0 || DEMO) startRound(); return; }
  else return;
  if (!res.ok) {
    if (player === mySeat) showToast(res.reason);
    else party.send('reject', res.reason, seats[player].peerId);
    return;
  }
  broadcast();
}

function act(action, cards = []) {
  if (iAmAuthority) hostAction(mySeat, action, cards);
  else party.send('intent', { action, cards });
}

function tryPlay() {
  if (!state || state.turn !== state.you || selected.size === 0) return;
  act('play', [...selected]);
  selected.clear();
}

function tryPass() {
  if (!state || state.turn !== state.you || !state.pile) return;
  act('pass');
}

// Hand sorting is purely cosmetic and local: snapshots arrive rank-sorted and
// each mode re-orders the fan for display only. Dragging a card sideways
// switches to a manual arrangement ('custom') until SORT is tapped again.
const SORTS = {
  rank: { label: 'SORT: RANK', fn: (a, b) => cardValue(a) - cardValue(b) },  // pairs sit together
  suit: { label: 'SORT: SUIT', fn: (a, b) => a.s - b.s || a.r - b.r },       // flushes sit together
};
let sortMode = 'rank';
let customOrder = null; // card ids in the user's own arrangement

els.btnSort.onclick = () => {
  customOrder = null;
  sortMode = sortMode === 'rank' ? 'suit' : 'rank';
  els.btnSort.textContent = SORTS[sortMode].label;
  refreshHand();
};

// --- drag to rearrange (mouse + touch via pointer events) ---
let drag = null;          // { el, id, startX, active }
let suppressCardClick = false; // a drag shouldn't also toggle selection

els.handArea.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.card[data-id]');
  if (!card) return;
  drag = { el: card, id: card.dataset.id, startX: e.clientX, active: false };
});

els.handArea.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.abs(e.clientX - drag.startX) < 14) return;
    drag.active = true;
    drag.el.classList.add('dragging');
    try { drag.el.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
  }
  // live-reorder: slot the dragged card before the first sibling whose
  // midpoint is right of the pointer
  let before = null;
  for (const c of els.handArea.children) {
    if (c === drag.el) continue;
    const r = c.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) { before = c; break; }
  }
  els.handArea.insertBefore(drag.el, before);
});

const endDrag = () => {
  if (!drag) return;
  if (drag.active) {
    drag.el.classList.remove('dragging');
    customOrder = [...els.handArea.children].map((c) => c.dataset.id);
    sortMode = 'custom';
    els.btnSort.textContent = 'SORT: MINE';
    suppressCardClick = true;
    setTimeout(() => { suppressCardClick = false; }, 80);
  }
  drag = null;
};
els.handArea.addEventListener('pointerup', endDrag);
els.handArea.addEventListener('pointercancel', endDrag);

els.btnPlay.onclick = tryPlay;
els.btnPass.onclick = tryPass;
els.btnRematch.onclick = () => { show(els.gameOver, false); act('rematch'); };

// ================================================================ rendering

const seatName = (i) => (i === mySeat && !DEMO ? 'You' : seats[i]?.name ?? `Player ${i + 1}`);

function cardEl(card, { selectable = false } = {}) {
  const c = typeof card === 'string' ? parseCard(card) : card;
  const div = document.createElement('div');
  div.className = 'card' + (SUIT_IS_RED[c.s] ? ' red' : '');
  div.dataset.id = c.id;
  const glyph = SUIT_GLYPH[c.s];
  const label = rankLabel(c.r);
  div.innerHTML =
    `<div class="corner">${label}<br>${glyph}</div>` +
    `<div class="pip-glyph">${glyph}</div>` +
    `<div class="corner bottom">${label}<br>${glyph}</div>`;
  if (selectable) div.onclick = () => toggleCard(c.id); // tap/mouse fallback
  return div;
}

function toggleCard(id) {
  if (suppressCardClick) return;
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  refreshHand();
}

// The pile signature tells a fresh play apart from a mere re-render, so the
// landing animations only fire when cards were actually just put down.
let lastPileKey = '';
let lastLogN = 0;
let winnerCelebrated = false;

function spawnSunrays() {
  if (!gameActive) return;
  const rays = document.createElement('div');
  rays.className = 'sunrays';
  els.pileCards.appendChild(rays);
  setTimeout(() => rays.remove(), 1900);
}

/** Screen anchor for a seat: their spot's card stack, or your hand fan. */
function seatRect(seat) {
  if (seat === (state?.you ?? mySeat)) return els.handArea.getBoundingClientRect();
  const spot = els.tableLayer.querySelector(`.player-spot[data-seat="${seat}"]`);
  return (spot?.querySelector('.mini-cards') || spot)?.getBoundingClientRect() || null;
}

/**
 * Take-control sequence: the unbeatable card flies in and lands, god-rays
 * bloom, then the card sweeps off to its owner — who now holds the lead.
 */
function controlFx(log) {
  const owner = log.player;
  const you = state?.you ?? mySeat;
  const src = seatRect(owner);
  const temp = log.cards.map((id) => cardEl(id));
  temp.forEach((el) => el.classList.add('golden'));
  els.pileCards.append(...temp);
  const flightMs = src ? flyCards(src, temp, { faceDown: owner !== you }) : 0;
  setTimeout(() => spawnSunrays(), flightMs);
  setTimeout(() => {
    if (gameActive) {
      swooshPile(temp, seatRect(owner));
      showToast(owner === you ? 'You take control 👑' : `${seatName(owner)} takes control 👑`, 2200, 'info');
    }
    temp.forEach((el) => el.remove());
  }, flightMs + 1500);
}

function applyState(snap) {
  if (!gameActive) showGame(); // guest: first snapshot after setup
  state = snap;
  const ids = new Set(snap.yourHand.map((c) => c.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);

  const pileKey = snap.pile
    ? snap.pile.cards.map((c) => c.id).join(',') + '@' + snap.pileOwner
    : '';
  const isNewPlay = !!pileKey && pileKey !== lastPileKey;

  // trick conceded: the dead pile swooshes off toward whoever leads next
  if (!pileKey && lastPileKey && snap.winner < 0) {
    swooshPile([...els.pileCards.children], seatRect(snap.turn));
  }
  lastPileKey = pileKey;

  // someone passed since the last snapshot: float a bubble off their spot
  if (snap.logN !== lastLogN && snap.lastLog?.type === 'pass') {
    const r = seatRect(snap.lastLog.player);
    if (r) passBubble(r);
  }
  // unbeatable card: sunrays over the play, then it sweeps to its owner
  if (snap.logN !== lastLogN && snap.lastLog?.type === 'control') {
    controlFx(snap.lastLog);
  }
  lastLogN = snap.logN;

  els.oppBar.replaceChildren(...snap.counts.flatMap((count, i) => {
    if (i === snap.you) return [];
    const chip = document.createElement('div');
    chip.className = 'opp-chip' + (seats[i]?.isAI ? ' ai' : '') + (snap.turn === i && snap.winner < 0 ? ' turn' : '');
    chip.innerHTML = `${seatName(i)} · <span class="cnt">${count}</span>`;
    return [chip];
  }));

  els.pileCards.replaceChildren(...(snap.pile ? snap.pile.cards.map((c) => {
    const el = cardEl(c);
    if (isNewPlay && c.id === '2D') el.classList.add('golden'); // the boss card
    return el;
  }) : []));
  if (isNewPlay) {
    // cards fly in from the owner's stack (face-down for opponents) —
    // fall back to the drop-from-above land if we have no source anchor
    const src = seatRect(snap.pileOwner);
    const pileEls = [...els.pileCards.children];
    let flightMs = 0;
    if (src) {
      flightMs = flyCards(src, pileEls, { faceDown: snap.pileOwner !== snap.you });
    } else {
      pileEls.forEach((el, i) => { el.classList.add('land'); el.style.animationDelay = i * 50 + 'ms'; });
      flightMs = 400;
    }
    // impact + celebrations, timed to the last card's arrival
    els.pileCards.classList.remove('thump', 'thump-big');
    void els.pileCards.offsetWidth; // restart the animation
    els.pileCards.style.animationDelay = Math.max(0, flightMs - 90) + 'ms';
    els.pileCards.classList.add(snap.pile.cards.length >= 5 ? 'thump-big' : 'thump');
    const combo = snap.pile.name;
    setTimeout(() => {
      if (!gameActive) return;
      if (snap.pile.cards.some((c) => c.id === '2D')) spawnSunrays();
      if (combo === 'Four of a Kind') shakeTable(els.gameLayer);
      if (combo === 'Straight Flush') {
        rainbowSweep(els.pileCards);
        const r = els.pileCards.getBoundingClientRect();
        confettiBurst(r.left + r.width / 2, r.top + r.height / 2, 40);
      }
    }, flightMs);
  }
  els.pileLabel.textContent = snap.pile
    ? `${snap.pile.name} — ${snap.pileOwner === snap.you ? 'yours' : seatName(snap.pileOwner)}`
    : snap.mustIncludeLowest ? `Lead with the ${snap.lowestInPlay}`
    : snap.turn === snap.you ? '👑 You have control — play anything'
    : `👑 ${seatName(snap.turn)} has control`;

  const yourTurn = snap.turn === snap.you && snap.winner < 0;
  els.turnBanner.textContent = snap.winner >= 0 ? '' : yourTurn ? 'Your turn' : `${seatName(snap.turn)}'s turn…`;
  els.turnBanner.classList.toggle('yours', yourTurn);
  if (gameActive) updateTableSpots(snap);
  refreshHand();

  if (snap.winner >= 0) {
    els.gameOverText.textContent = snap.winner === snap.you ? 'You win! 🎉' : `${seatName(snap.winner)} wins! 💖`;
    if (!winnerCelebrated) {
      winnerCelebrated = true;
      confettiRain();
      recordResult(snap.winner === snap.you);
    }
    show(els.gameOver, true);
  } else {
    winnerCelebrated = false;
    show(els.gameOver, false);
  }
}

function refreshHand() {
  if (!state) return;
  const ordered = sortMode === 'custom' && customOrder
    ? state.yourHand.slice().sort((a, b) => customOrder.indexOf(a.id) - customOrder.indexOf(b.id))
    : state.yourHand.slice().sort(SORTS[sortMode === 'custom' ? 'rank' : sortMode].fn);
  els.handArea.replaceChildren(...ordered.map((c) => {
    const el = cardEl(c, { selectable: true });
    if (selected.has(c.id)) el.classList.add('selected');
    return el;
  }));
  updateButtons();
}

function updateButtons() {
  const yourTurn = state && state.turn === state.you && state.winner < 0;
  let playable = false;
  if (yourTurn && selected.size > 0) {
    const cards = state.yourHand.filter((c) => selected.has(c.id));
    const pileCombo = state.pile ? classify(state.pile.cards) : null;
    const v = validatePlay(cards, pileCombo);
    playable = v.ok && (!state.mustIncludeLowest || selected.has(state.lowestInPlay));
  }
  els.btnPlay.disabled = !playable;
  els.btnPass.disabled = !(yourTurn && state.pile);
}

function showToast(msg, ms = 2200, kind = 'error') {
  els.toast.textContent = msg;
  els.toast.classList.toggle('info', kind === 'info');
  show(els.toast, true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(els.toast, false), ms);
}

// ================================================================ gesture loop

let hoverEl = null;

function loop(nowMs) {
  if (!gameActive || controlMode !== 'gesture') {
    // Plain call or touch mode: skip hand tracking entirely (battery).
    show(els.cursor, false);
    els.passRing.style.setProperty('--p', 0);
    if (hoverEl) { hoverEl.classList.remove('hover'); hoverEl = null; }
    requestAnimationFrame(loop);
    return;
  }
  const ev = hands.update(els.localVideo, nowMs);

  if (ev.cursor) {
    const x = ev.cursor.x * innerWidth;
    const y = ev.cursor.y * innerHeight;
    show(els.cursor, true);
    els.cursor.style.left = x + 'px';
    els.cursor.style.top = y + 'px';
    els.cursor.classList.toggle('pinching', ev.pinching);

    const under = document.elementFromPoint(x, y);
    const card = under?.closest?.('.card[data-id]');
    const overHand = card && card.parentElement === els.handArea ? card : null;

    if (hoverEl && hoverEl !== overHand) hoverEl.classList.remove('hover');
    hoverEl = overHand;
    if (hoverEl) hoverEl.classList.add('hover');

    if (ev.pinchDown) {
      if (overHand) toggleCard(overHand.dataset.id);
      else if (under?.closest?.('#btnPlay') && !els.btnPlay.disabled) tryPlay();
      else if (under?.closest?.('#btnPass') && !els.btnPass.disabled) tryPass();
      else if (under?.closest?.('#btnSort')) els.btnSort.click();
      else if (under?.closest?.('#btnRematch')) els.btnRematch.click();
    }
  } else {
    show(els.cursor, false);
    if (hoverEl) { hoverEl.classList.remove('hover'); hoverEl = null; }
  }

  els.passRing.style.setProperty('--p', els.btnPass.disabled ? 0 : ev.fistProgress);
  if (ev.fistHeld) tryPass();

  requestAnimationFrame(loop);
}

// ================================================================ boot

if (DEMO) {
  currentUser = { name: 'Player 1', email: null, isGuest: true };
  iAmAuthority = true;
  solo = true;
  seats = [
    { isAI: false, name: 'Player 1', peerId: null },
    { isAI: false, name: 'Player 2', peerId: null },
  ];
  showScreen(els.callScreen);
  show(els.codeBanner, false);
  gameActive = true;
  show(els.gameLayer, true);
  layout();
  startRound();
} else {
  renderAuthScreen();
  // pencil-drawing intro, once per browser session; auth boots underneath it
  if (!sessionStorage.getItem('kritzzz-intro')) {
    sessionStorage.setItem('kritzzz-intro', '1');
    runIntro();
  } else {
    document.getElementById('introScreen')?.remove();
  }
  initAuth(onUser);
}
