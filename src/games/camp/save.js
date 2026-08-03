// Campsite persistence. The HOST owns campsites/{hostUid} (it is already the
// network authority); catches append to a subcollection so the log can grow
// forever without hitting doc limits. Guests credit their own profile stats.
// Signed-out hosts fall back to localStorage so solo/guest play still keeps
// a campsite on-device.

import { getFirebase } from '../../auth/auth.js';

const LOCAL_KEY = 'kritzzz-campsite';
const LOCAL_STATS = 'kritzzz-camp-stats';

let fs = null;

async function ensureFirestore() {
  if (fs) return fs;
  const fb = getFirebase();
  if (!fb) return null;
  const api = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  fs = { db: api.getFirestore(fb.app), api };
  return fs;
}

export function emptyCampsite() {
  return {
    name: 'Our camp', points: 0, xp: 0, spot: 'lakeside',
    fire: { streak: 0, lastLitDay: null },
    bestCatches: {}, constellations: {}, decor: [], unlocked: [], members: {},
  };
}

export class CampSave {
  constructor(hostUid) {
    this.hostUid = hostUid; // null => localStorage only
    this.data = emptyCampsite();
    this.dirty = false;
    this.timer = 0;
  }

  async load() {
    if (this.hostUid) {
      const f = await ensureFirestore();
      if (f) {
        try {
          const snap = await f.api.getDoc(f.api.doc(f.db, 'campsites', this.hostUid));
          if (snap.exists()) this.data = { ...emptyCampsite(), ...snap.data() };
          return this.data;
        } catch (e) { console.warn('campsite load failed', e); }
      }
    }
    try { this.data = { ...emptyCampsite(), ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') }; }
    catch { /* fresh camp */ }
    return this.data;
  }

  /** Mutate-and-schedule. fn receives the data object. */
  update(fn) {
    fn(this.data);
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 2000);
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.hostUid) {
      const f = await ensureFirestore();
      if (f) {
        try {
          await f.api.setDoc(f.api.doc(f.db, 'campsites', this.hostUid),
            { ...this.data, owner: this.hostUid }, { merge: true });
          return;
        } catch (e) { console.warn('campsite save failed', e); }
      }
    }
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data)); } catch { /* full */ }
  }

  /** Append a catch to the log (host only). */
  async logCatch(entry) {
    if (this.hostUid) {
      const f = await ensureFirestore();
      if (f) {
        try {
          await f.api.addDoc(f.api.collection(f.db, 'campsites', this.hostUid, 'catches'),
            { ...entry, at: f.api.serverTimestamp() });
        } catch (e) { console.warn('catch log failed', e); }
      }
    }
    // best-catch tracking lives in the doc either way
    this.update((d) => {
      const best = d.bestCatches[entry.species];
      if (!best || entry.size > best.size) {
        d.bestCatches[entry.species] = { size: entry.size, byName: entry.byName, at: Date.now() };
      }
    });
  }

  async recentCatches(n = 20) {
    if (!this.hostUid) return [];
    const f = await ensureFirestore();
    if (!f) return [];
    try {
      const q = f.api.query(
        f.api.collection(f.db, 'campsites', this.hostUid, 'catches'),
        f.api.orderBy('at', 'desc'), f.api.limit(n));
      const qs = await f.api.getDocs(q);
      const out = [];
      qs.forEach((d) => out.push(d.data()));
      return out;
    } catch { return []; }
  }

  /** Daily campfire streak: call when the fire gets lit. */
  markFireLit() {
    const day = new Date().toISOString().slice(0, 10);
    this.update((d) => {
      if (d.fire.lastLitDay === day) return;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      d.fire.streak = d.fire.lastLitDay === yesterday ? d.fire.streak + 1 : 1;
      d.fire.lastLitDay = day;
    });
  }

  stop() {
    clearTimeout(this.timer);
    this.flush();
  }
}

/** Each player credits their own profile with their own catches. */
export async function creditMyCatch(user, fish, pts) {
  if (user?.uid) {
    const f = await ensureFirestore();
    if (f) {
      try {
        await f.api.updateDoc(f.api.doc(f.db, 'users', user.uid), {
          'stats.camp.catches': f.api.increment(1),
          'stats.camp.points': f.api.increment(pts),
        });
        return;
      } catch { /* fall through to local */ }
    }
  }
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_STATS) || '{"catches":0,"points":0}');
    s.catches += 1;
    s.points += pts;
    localStorage.setItem(LOCAL_STATS, JSON.stringify(s));
  } catch { /* ok */ }
}
