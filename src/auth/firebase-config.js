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

export const firebaseConfig = null;

// Example shape:
// export const firebaseConfig = {
//   apiKey: 'AIza...',
//   authDomain: 'kritzzz.firebaseapp.com',
//   projectId: 'kritzzz',
//   storageBucket: 'kritzzz.appspot.com',
//   messagingSenderId: '1234567890',
//   appId: '1:1234567890:web:abc123',
// };
