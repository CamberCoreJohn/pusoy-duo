// Auth: Firebase email/password when configured, guest profile otherwise.
//
// Firebase is only imported when a config exists, so guest-only installs load
// zero auth code. The guest profile is a display name in localStorage.

import { firebaseConfig } from './firebase-config.js';

export const authAvailable = !!firebaseConfig;

const GUEST_KEY = 'kritzzz-guest-name';

let fb = null; // { auth, api } once initialized

/**
 * Initialize auth and subscribe to user changes.
 * @param {(user: {name: string, email: string|null, isGuest: boolean}|null) => void} onUser
 */
export async function initAuth(onUser) {
  if (!authAvailable) {
    const name = localStorage.getItem(GUEST_KEY);
    onUser(name ? { name, email: null, isGuest: true } : null);
    return;
  }
  const [{ initializeApp }, api] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  fb = { auth: api.getAuth(app), api };
  api.onAuthStateChanged(fb.auth, (u) => {
    if (u) onUser({ name: u.displayName || u.email.split('@')[0], email: u.email, isGuest: false });
    else {
      const name = localStorage.getItem(GUEST_KEY);
      onUser(name ? { name, email: null, isGuest: true } : null);
    }
  });
}

export async function register(name, email, password) {
  if (!fb) throw new Error('Registration is not set up on this install');
  const cred = await fb.api.createUserWithEmailAndPassword(fb.auth, email, password);
  await fb.api.updateProfile(cred.user, { displayName: name });
  // onAuthStateChanged fired before the profile update: re-emit with the name
  await cred.user.reload();
  return { name, email, isGuest: false };
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
  return { name, email: null, isGuest: true };
}

/** Friendly message for Firebase auth error codes. */
export function authErrorMessage(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'That email is already registered — sign in instead';
  if (code.includes('invalid-email')) return 'That does not look like an email address';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Wrong email or password';
  if (code.includes('too-many-requests')) return 'Too many attempts — try again in a minute';
  return e?.message || 'Something went wrong';
}
