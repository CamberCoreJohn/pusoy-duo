# Kritzzz

A **video-calling web app** for couples and friends, with games built in.
Sign in (or play as a guest), start a peer-to-peer video call, and deal a game
of **Pusoy Dos** into the call whenever you feel like it — cards controlled by
hand gestures over your own video. 1–4 players; AI bots fill empty seats.

No build step, no game server. Vanilla ES modules + MediaPipe HandLandmarker +
PeerJS, optional Firebase Auth for email accounts. Optimized for iOS/iPadOS
Safari (safe areas, dvh, touch targets, no-zoom viewport, lazy hand tracking).

## Run locally

```bash
python -m http.server 8741
```

Open http://localhost:8741 — camera and WebRTC work on localhost. For phones
and the internet, host on HTTPS (GitHub Pages works as-is).

## Flow

1. **Auth** — register / sign in with email (if Firebase is configured) or
   continue as a guest with just a name.
2. **Home** — start a call, join with a 5-letter code, or practice vs AI.
3. **Call** — plain video call first: mute, camera toggle, view swap, hang up.
   Up to 4 people (P2P mesh). The 🎮 button (call creator only) opens the game
   picker: choose a table size, empty seats get AI bots, cards are dealt into
   the call. ✕ or "Back to the call" ends the game for everyone; the call
   continues. People can join the call mid-game — they spectate until the next
   deal.
4. **Table Mode** (🎴, host toggle, synced to everyone) — the whole screen
   becomes the felt table with players seated around it as avatars: humans are
   their live video feeds with the background removed (MediaPipe selfie
   segmentation, fully client-side), bots get a generic animated feed. You
   always sit at the bottom; the green ring marks whose turn it is.

`?demo` = 2-player hotseat, no camera/network/auth (testing).

## Enabling email registration

Registration needs a (free) Firebase project — see the step-by-step comment in
[src/auth/firebase-config.js](src/auth/firebase-config.js). Paste your web app
config there and email accounts light up; while it's `null` the app is
guest-only. The config values are public identifiers, safe to commit.

## Gestures (during a game)

| Gesture | Action |
|---|---|
| Point (index finger) | Move the cursor |
| Pinch over a card | Pick up / put down |
| Pinch PLAY / SORT | Press the button |
| Hold a fist ~1s | Pass |

Touch/mouse works everywhere as a fallback. Hand tracking only runs while a
game is active (battery). SORT toggles rank order (pairs together) vs suit
order (flushes together) — display-only.

## Rules implemented

- Filipino suit order: ♦ > ♥ > ♠ > ♣; ranks 3…A, 2 highest
- Singles, pairs, triples, five-card hands (straight < flush < full house < quads < straight flush)
- No wrap-around straights; flushes compared suit-first (house rule, `flushBySuit` in `combos.js`)
- 13 cards each; holder of the lowest card in play leads and must include it
  (with fewer than 4 players the 3♣ may not be dealt)
- Passing moves the turn on; when everyone else has passed, the trick owner leads fresh
- First empty hand wins; if a human disconnects mid-round an AI takes over their hand

## AI

`src/game/ai.js` — enumerates every legal combo, plays the cheapest one that
beats the pile, dumps its lowest/longest combo on a fresh lead, and holds
deuces back on cheap singles. Decent but beatable, which is the point. Bots
run on the host with a randomized 0.8–1.6s think time.

## Architecture

```
index.html / css/styles.css   screens: auth -> home -> call (+ game overlay)
src/app.js                    orchestrator: auth, call, game lifecycle, gestures
src/auth/auth.js              Firebase email auth or localStorage guest profile
src/auth/firebase-config.js   your Firebase web config (null = guest-only)
src/game/cards.js             deck, Filipino ordering, dealing
src/game/combos.js            combination classification + comparison
src/game/engine.js            host-authoritative turn engine (2-4 players)
src/game/ai.js                bot player (runs on the host)
src/net/peer.js               PeerJS party: star data topology + video mesh
src/avatars.js                table-mode avatars: segmentation cutouts + bot feeds
src/gestures/hands.js         MediaPipe hand tracking -> cursor/pinch/fist events
```

The call creator (host) runs the engine and validates every move; guests send
intents and render snapshots — no state desync possible. Hands are private:
snapshots contain only your own cards and everyone's card counts.
