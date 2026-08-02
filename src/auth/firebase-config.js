// Firebase project config — fill this in to enable accounts, friends & invites.
//
// 1. https://console.firebase.google.com → Add project "Kritzzz" (Analytics off)
// 2. Build → Authentication → Get started → Sign-in method:
//      enable Google (recommended) and, optionally, Email/Password
// 3. Build → Firestore Database → Create database (production mode) →
//      Rules tab → paste the contents of firestore.rules (repo root) → Publish
// 4. Project settings → General → Your apps → Web app (</>) → copy config here
// 5. Authentication → Settings → Authorized domains → add:
//      kritzzz.com  (and cambercorejohn.github.io while it's still in use)
//
// These values are public identifiers, not secrets — committing them is fine.
// While this is null the app runs in guest-only mode (no friends/invites).

export const firebaseConfig = {
  apiKey: 'AIzaSyDQUUmTfo3vVslF8xVEvj6rr3keXYBJy8g',
  authDomain: 'kritzzz-580af.firebaseapp.com',
  projectId: 'kritzzz-580af',
  storageBucket: 'kritzzz-580af.firebasestorage.app',
  messagingSenderId: '738688918250',
  appId: '1:738688918250:web:73873807112f23cd1a6d93',
};
