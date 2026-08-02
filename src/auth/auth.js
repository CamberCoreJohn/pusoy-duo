// Auth: Firebase (Google + email/password) when configured, guest otherwise.
//
// Firebase is only imported when a config exists, so guest-only installs load
// zero auth code. The guest profile is a display name in localStorage.

import { firebaseConfig } from './firebase-config.js';

export const authAvailable = !!firebaseConfig;

const GUEST_KEY = 'kritzzz-guest-name';

let fb = null; // { app, auth, api } once initialized

/** Firebase handles for other modules (friends/Firestore). Null if not configured. */
export function getFirebase() { return fb; }

const toUser = (u) => ({
  uid: u.uid,
  name: u.displayName || u.email?.split('@')[0] || 'Player',
  email: u.email,
  photo: u.photoURL || null,
  isGuest: false,
});

/**
 * Initialize auth and subscribe to user changes.
 * @param {(user: {uid: string|null, name, email, photo, isGuest}|null) => void} onUser
 */
export async function initAuth(onUser) {
  if (!authAvailable) {
    const name = localStorage.getItem(GUEST_KEY);
    onUser(name ? { uid: null, name, email: null, photo: null, isGuest: true } : null);
    return;
  }
  const [{ initializeApp }, api] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  fb = { app, auth: api.getAuth(app), api };
  // Completes the round-trip after signInWithRedirect (iOS Safari path).
  api.getRedirectResult(fb.auth).catch(() => {});
  api.onAuthStateChanged(fb.auth, (u) => {
    if (u) onUser(toUser(u));
    else {
      const name = localStorage.getItem(GUEST_KEY);
      onUser(name ? { uid: null, name, email: null, photo: null, isGuest: true } : null);
    }
  });
}

export async function signInWithGoogle() {
  if (!fb) throw new Error('Sign-in is not set up on this install');
  const provider = new fb.api.GoogleAuthProvider();
  // Popups are unreliable on mobile Safari; redirect there, popup elsewhere.
  const mobile = /iP(hone|ad|od)|Android/i.test(navigator.userAgent);
  if (mobile) await fb.api.signInWithRedirect(fb.auth, provider);
  else await fb.api.signInWithPopup(fb.auth, provider);
}

export async function register(name, email, password) {
  if (!fb) throw new Error('Registration is not set up on this install');
  const cred = await fb.api.createUserWithEmailAndPassword(fb.auth, email, password);
  await fb.api.updateProfile(cred.user, { displayName: name });
  await cred.user.reload();
  return { ...toUser(cred.user), name };
}

export async function signIn(email, password) {
  if (!fb) throw new Error('Sign-in is not set up on this install');
  await fb.api.signInWithEmailAndPassword(fb.auth, email, password);
}

export async function signOutUser() {
  localStorage.removeItem(GUEST_KEY);
  if (fb) await fb.api.signOut(fb.auth);
}

export function continueAsGuest(name) {
  localStorage.setItem(GUEST_KEY, name);
  return { uid: null, name, email: null, photo: null, isGuest: true };
}

/** Friendly message for Firebase auth error codes. */
export function authErrorMessage(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'That email is already registered — sign in instead';
  if (code.includes('invalid-email')) return 'That does not look like an email address';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Wrong email or password';
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Sign-in cancelled';
  if (code.includes('too-many-requests')) return 'Too many attempts — try again in a minute';
  return e?.message || 'Something went wrong';
}
