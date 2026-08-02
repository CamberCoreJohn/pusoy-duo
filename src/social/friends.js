// Friends & invites on Firestore. Requires a signed-in (non-guest) user.
//
// Data model (see firestore.rules):
//   users/{uid}                  profile: name, photo, code, lastSeen
//   codes/{CODE}                 friend-code lookup: { uid, name }
//   friendships/{uidA_uidB}      { users:[a,b], names:{...}, requestedBy, status }
//   invites/{id}                 { fromUid, fromName, toUid, room, status, createdAt }
//
// Presence is a lastSeen heartbeat while the app is open; a friend counts as
// online if their lastSeen is under 2 minutes old.

import { getFirebase } from '../auth/auth.js';

const HEARTBEAT_MS = 45_000;
const ONLINE_MS = 120_000;
const CODE_LEN = 6;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let fs = null;         // { db, api }
let me = null;         // { uid, name, photo, code }
let heartbeatTimer = 0;
const unsubs = [];     // active onSnapshot unsubscribers

const pairId = (a, b) => [a, b].sort().join('_');
const randomCode = () =>
  Array.from({ length: CODE_LEN }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

async function ensureFirestore() {
  if (fs) return fs;
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase not configured');
  const api = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  fs = { db: api.getFirestore(fb.app), api };
  return fs;
}

/**
 * Start the social layer for a signed-in user.
 * handlers: { onFriends(list), onRequests(list), onInvite(invite|null) }
 * Friends list items: { uid, name, online }.
 */
export async function initSocial(user, handlers) {
  const { db, api } = await ensureFirestore();
  const { doc, getDoc, setDoc, serverTimestamp, collection, query, where, onSnapshot, documentId } = api;

  // --- profile + friend code (claim the code doc once, retry on collision)
  const meRef = doc(db, 'users', user.uid);
  const snap = await getDoc(meRef);
  let code = snap.exists() ? snap.data().code : null;
  if (!code) {
    for (let tries = 0; tries < 5 && !code; tries++) {
      const candidate = randomCode();
      const codeRef = doc(db, 'codes', candidate);
      if (!(await getDoc(codeRef)).exists()) {
        await setDoc(codeRef, { uid: user.uid, name: user.name });
        code = candidate;
      }
    }
    if (!code) throw new Error('Could not allocate a friend code');
  }
  await setDoc(meRef, {
    name: user.name, photo: user.photo || null, code, lastSeen: serverTimestamp(),
  }, { merge: true });
  me = { ...user, code };

  // --- presence heartbeat
  clearInterval(heartbeatTimer);
  const beat = () => setDoc(meRef, { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
  heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

  // --- friendships watcher -> friends (accepted) + requests (pending, incoming)
  let presenceUnsub = null;
  const fq = query(collection(db, 'friendships'), where('users', 'array-contains', user.uid));
  unsubs.push(onSnapshot(fq, (qs) => {
    const friends = [], requests = [];
    qs.forEach((d) => {
      const f = d.data();
      const otherUid = f.users.find((u) => u !== user.uid);
      const otherName = f.names?.[otherUid] || 'Friend';
      if (f.status === 'accepted') friends.push({ uid: otherUid, name: otherName });
      else if (f.status === 'pending' && f.requestedBy !== user.uid) {
        requests.push({ id: d.id, uid: otherUid, name: otherName });
      }
    });
    handlers.onRequests?.(requests);

    // presence: one listener over all accepted friends' user docs
    presenceUnsub?.();
    presenceUnsub = null;
    if (friends.length === 0) { handlers.onFriends?.([]); return; }
    const uids = friends.slice(0, 30).map((f) => f.uid); // 'in' query cap
    const pq = query(collection(db, 'users'), where(documentId(), 'in', uids));
    presenceUnsub = onSnapshot(pq, (ps) => {
      const seen = new Map();
      ps.forEach((d) => seen.set(d.id, d.data().lastSeen?.toMillis?.() ?? 0));
      handlers.onFriends?.(friends.map((f) => ({
        ...f, online: Date.now() - (seen.get(f.uid) ?? 0) < ONLINE_MS,
      })));
    });
    unsubs.push(() => presenceUnsub?.());
  }));

  // --- incoming invite ring
  const iq = query(collection(db, 'invites'),
    where('toUid', '==', user.uid), where('status', '==', 'ringing'));
  unsubs.push(onSnapshot(iq, (qs) => {
    let latest = null;
    qs.forEach((d) => {
      const inv = { id: d.id, ...d.data() };
      const age = Date.now() - (inv.createdAt?.toMillis?.() ?? Date.now());
      if (age < 60_000 && (!latest || age < Date.now() - (latest.createdAt?.toMillis?.() ?? 0))) latest = inv;
    });
    handlers.onInvite?.(latest);
  }));

  return me;
}

export function myCode() { return me?.code ?? null; }

/** Send a friend request by code. Returns the friend's name. */
export async function addFriendByCode(rawCode) {
  const { db, api } = await ensureFirestore();
  const { doc, getDoc, setDoc, serverTimestamp } = api;
  const code = rawCode.trim().toUpperCase();
  if (code === me.code) throw new Error('That is your own code');
  const codeSnap = await getDoc(doc(db, 'codes', code));
  if (!codeSnap.exists()) throw new Error('No player with that code');
  const { uid: otherUid, name: otherName } = codeSnap.data();
  const id = pairId(me.uid, otherUid);
  const existing = await getDoc(doc(db, 'friendships', id));
  if (existing.exists()) {
    throw new Error(existing.data().status === 'accepted' ? 'Already friends' : 'Request already sent');
  }
  await setDoc(doc(db, 'friendships', id), {
    users: [me.uid, otherUid],
    names: { [me.uid]: me.name, [otherUid]: otherName },
    requestedBy: me.uid,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return otherName;
}

export async function respondRequest(id, accept) {
  const { db, api } = await ensureFirestore();
  if (accept) await api.updateDoc(api.doc(db, 'friendships', id), { status: 'accepted' });
  else await api.deleteDoc(api.doc(db, 'friendships', id));
}

/** Ring a friend with a room code. Returns {id, watch(cb), cancel()}. */
export async function sendInvite(toUid, room) {
  const { db, api } = await ensureFirestore();
  const { collection, addDoc, doc, onSnapshot, updateDoc, serverTimestamp } = api;
  const ref = await addDoc(collection(db, 'invites'), {
    fromUid: me.uid, fromName: me.name, toUid, room,
    status: 'ringing', createdAt: serverTimestamp(),
  });
  return {
    id: ref.id,
    watch(cb) {
      const un = onSnapshot(doc(db, 'invites', ref.id), (d) => cb(d.data()?.status));
      unsubs.push(un);
      return un;
    },
    cancel: () => updateDoc(doc(db, 'invites', ref.id), { status: 'cancelled' }).catch(() => {}),
  };
}

export async function answerInvite(id, accept) {
  const { db, api } = await ensureFirestore();
  await api.updateDoc(api.doc(db, 'invites', id), { status: accept ? 'accepted' : 'declined' });
}

export function stopSocial() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = 0;
  for (const un of unsubs.splice(0)) { try { un(); } catch { /* already gone */ } }
  me = null;
}
