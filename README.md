# Kritzzz

A **video-calling web app** for couples and friends, with games built in.
Sign in (or play as a guest), start a peer-to-peer video call, and launch a
game into it: **Pusoy Dos** (cards controlled by hand gestures, AI bots fill
seats) or **Campfire 🏕️** — a persistent co-op campsite where you walk
around together as campers with your live video faces, fish, keep a fire
going, roast marshmallows, stargaze, and decorate.

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

`?demo` = 2-player Pusoy hotseat; `?camp` = straight into solo Campfire —
both need no camera/network/auth (testing).

## Campfire 🏕️

Top-down walkable campsite rendered on canvas; your camper's head is your
live video feed. Virtual joystick (or WASD) + one context action button:
CAST on the shore, CHOP at trees, STRIKE/ADD WOOD/GRILL/ROAST at the fire,
STARGAZE at the tent after dark (10-minute day/night cycle). Fishing =
hold-to-cast power, tap the bite, keep the reel needle in the zone; rarities
up to the Arowana 🐉 (and the Old Boot). The campsite **persists**: fish log
+ records, campfire streak, traced constellations, camp points, and placed
decorations live in Firestore under `campsites/{hostUid}` (host is the
authority and sole writer; localStorage fallback for signed-out play). The
host relays guest positions (10Hz, interpolated ~150ms); minigames run
locally so they feel instant. All camp traffic multiplexes over one `camp`
message type — the existing protocol is untouched.

## Accounts, friends & invites

Needs a (free) Firebase project — the full checklist is in
[src/auth/firebase-config.js](src/auth/firebase-config.js): enable Google
sign-in (+ optional email/password), create Firestore, publish
[firestore.rules](firestore.rules), paste the web config. While the config is
`null` the app is guest-only.

Signed-in users get a 6-character friend code. Add a friend by code → they
accept → both see each other with an online dot (45s presence heartbeat).
Tap 📞 Call and their app rings — accepting drops them straight into your
call, no room code to copy. Invites, requests, and presence all live in
Firestore behind the published security rules; calls and games remain P2P.

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
- Straights low→high: 3-4-5-6-7 … 10-J-Q-K-A, then **A-2-3-4-5**, then
  **J-Q-K-A-2** (highest). Other wrap-arounds (2-3-4-5-6) are invalid.
  Flushes compared suit-first (house rule, `flushBySuit` in `combos.js`)
- Finishing your hand closes the trick — the next player takes control
- An unbeatable single (highest card left in play) takes control instantly
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
src/avatars.js                avatar canvases: video crops / bot feeds / initials
src/games/registry.js         game picker metadata
src/games/camp/               Campfire: world, render, input, net, fishing,
                              fire, stars, decor, save (+ index orchestrator)
src/gestures/hands.js         MediaPipe hand tracking -> cursor/pinch/fist events
```

The call creator (host) runs the engine and validates every move; guests send
intents and render snapshots — no state desync possible. Hands are private:
snapshots contain only your own cards and everyone's card counts.
