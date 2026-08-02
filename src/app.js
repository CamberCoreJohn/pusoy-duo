// Pusoy Duo — orchestrator. A video-calling app first; games overlay the call.
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
import { initAuth, authAvailable, register, signIn, signOutUser, continueAsGuest, authErrorMessage } from './auth/auth.js';

const $ = (id) => document.getElementById(id);
const els = [
  'authScreen', 'authTabs', 'authName', 'authEmail', 'authPassword', 'btnAuthSubmit',
  'authError', 'authOr', 'guestName', 'btnGuest', 'authNote',
  'homeScreen', 'greeting', 'btnCall', 'btnJoin', 'joinCode', 'btnPractice', 'homeStatus', 'btnSignOut',
  'callScreen', 'videoGrid', 'localVideo', 'tileStrip', 'codeBanner', 'callCode', 'btnCopyCode', 'rosterInfo',
  'btnMute', 'btnCam', 'btnSwap', 'btnGames', 'btnHangup',
  'gamePicker', 'sizeSeg', 'pickerHint', 'btnStartGame', 'btnPickerCancel',
  'gameLayer', 'btnLeaveGame', 'oppBar', 'pileLabel', 'pileCards', 'turnBanner', 'handArea',
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

els.btnGuest.onclick = () => {
  const name = els.guestName.value.trim();
  if (!name) { els.authError.textContent = 'Enter your name first'; return; }
  onUser(continueAsGuest(name));
};

els.btnSignOut.onclick = async () => {
  await signOutUser();
  currentUser = null;
  showScreen(els.authScreen);
};

function onUser(user) {
  currentUser = user;
  if (!user) { renderAuthScreen(); showScreen(els.authScreen); return; }
  els.greeting.textContent = `Hi ${user.name}${user.isGuest ? ' (guest)' : ''} — who are we calling?`;
  show(els.btnSignOut, true);
  els.btnSignOut.textContent = user.isGuest ? 'Change name' : 'Sign out';
  showScreen(els.homeScreen);
}

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

// 'me' = your own mirrored feed is the game table and the cards overlay it
// (AR feel: you see your real hand pinch the cards). 'them' = partners
// fullscreen, you in a corner tile. The 🔁 button swaps.
let mainView = 'me';

els.btnSwap.onclick = () => {
  mainView = mainView === 'me' ? 'them' : 'me';
  layout();
};

function layout() {
  const remotes = [...remoteVideos.values()];
  const haveCam = !!localStream;
  // During a game your own feed is the table; in a plain call your partner is.
  const preferMe = gameActive ? mainView !== 'them' : mainView === 'me' && remotes.length === 0;
  const meMain = haveCam && (preferMe || remotes.length === 0);
  const main = meMain ? [els.localVideo] : remotes;
  const tiles = meMain ? remotes : haveCam ? [els.localVideo] : [];

  if (main.length) {
    els.videoGrid.replaceChildren(...main);
    els.videoGrid.dataset.count = main.length;
  } else {
    const bg = document.createElement('div');
    bg.className = 'table-bg';
    bg.textContent = '🂡';
    els.videoGrid.replaceChildren(bg);
    els.videoGrid.dataset.count = 0;
  }
  els.tileStrip.replaceChildren(...tiles);
  show(els.tileStrip, tiles.length > 0);
  show(els.btnSwap, haveCam && remotes.length > 0);
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

async function showGame() {
  gameActive = true;
  show(els.gameLayer, true);
  els.callScreen.classList.add('gaming');
  layout();
  await startGestures();
}

function hideGame() {
  gameActive = false;
  clearTimeout(aiTimer);
  engine = null;
  state = null;
  selected.clear();
  show(els.gameLayer, false);
  show(els.gameOver, false);
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
  const delay = AI_DELAY_MS[0] + Math.random() * (AI_DELAY_MS[1] - AI_DELAY_MS[0]);
  aiTimer = setTimeout(() => {
    if (!engine || !seats[engine.turn]?.isAI || engine.winner >= 0) return;
    const seat = engine.turn;
    const ids = chooseAiPlay(engine.hands[seat], engine.pile, {
      mustInclude: engine.mustIncludeLowest ? engine.lowestInPlay : null,
      rules: engine.rules,
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
// each mode re-orders the fan for display only.
const SORTS = {
  rank: { label: 'SORT: RANK', fn: (a, b) => cardValue(a) - cardValue(b) },  // pairs sit together
  suit: { label: 'SORT: SUIT', fn: (a, b) => a.s - b.s || a.r - b.r },       // flushes sit together
};
let sortMode = 'rank';

els.btnSort.onclick = () => {
  sortMode = sortMode === 'rank' ? 'suit' : 'rank';
  els.btnSort.textContent = SORTS[sortMode].label;
  refreshHand();
};

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
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  refreshHand();
}

function applyState(snap) {
  if (!gameActive) showGame(); // guest: first snapshot after setup
  state = snap;
  const ids = new Set(snap.yourHand.map((c) => c.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);

  els.oppBar.replaceChildren(...snap.counts.flatMap((count, i) => {
    if (i === snap.you) return [];
    const chip = document.createElement('div');
    chip.className = 'opp-chip' + (seats[i]?.isAI ? ' ai' : '') + (snap.turn === i && snap.winner < 0 ? ' turn' : '');
    chip.innerHTML = `${seatName(i)} · <span class="cnt">${count}</span>`;
    return [chip];
  }));

  els.pileCards.replaceChildren(...(snap.pile ? snap.pile.cards.map((c) => cardEl(c)) : []));
  els.pileLabel.textContent = snap.pile
    ? `${snap.pile.name} — ${snap.pileOwner === snap.you ? 'yours' : seatName(snap.pileOwner)}`
    : (snap.mustIncludeLowest ? `Lead with the ${snap.lowestInPlay}` : 'Fresh lead — play anything');

  const yourTurn = snap.turn === snap.you && snap.winner < 0;
  els.turnBanner.textContent = snap.winner >= 0 ? '' : yourTurn ? 'Your turn' : `${seatName(snap.turn)}'s turn…`;
  els.turnBanner.classList.toggle('yours', yourTurn);
  refreshHand();

  if (snap.winner >= 0) {
    els.gameOverText.textContent = snap.winner === snap.you ? 'You win! 🎉' : `${seatName(snap.winner)} wins! 💖`;
    show(els.gameOver, true);
  } else {
    show(els.gameOver, false);
  }
}

function refreshHand() {
  if (!state) return;
  const ordered = state.yourHand.slice().sort(SORTS[sortMode].fn);
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

function showToast(msg, ms = 2200) {
  els.toast.textContent = msg;
  show(els.toast, true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(els.toast, false), ms);
}

// ================================================================ gesture loop

let hoverEl = null;

function loop(nowMs) {
  if (!gameActive) {
    // Plain call: skip hand tracking entirely (saves battery on phones).
    show(els.cursor, false);
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
  initAuth(onUser);
}
