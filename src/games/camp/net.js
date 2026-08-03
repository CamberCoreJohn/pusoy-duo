// Camp networking: everything multiplexes over ONE Party message type
// ('camp') with a `t` subtype, so Party and the existing protocol stay
// untouched. Star topology: the host relays guest positions to other guests.
//
// Host id on the wire is 'host'; each guest is identified by its peerId as
// seen by the host. Solo play never sends anything.

export class CampNet {
  constructor() {
    this.party = null;
    this.isHost = false;
    this.handlers = new Map(); // t -> fn(payload, fromPeer)
    this.lastPosSent = 0;
    this.lastPos = null;
  }

  /** Called from newParty() in app.js — safe to call when camp is inactive. */
  attach(party, isHost) {
    this.party = party;
    this.isHost = isHost;
    party.on('camp', (msg, fromPeer) => {
      const fn = this.handlers.get(msg.t);
      fn?.(msg, fromPeer);
      // host relays guest positions & events to the other guests
      if (this.isHost && msg.relay) {
        this.broadcastExcept(fromPeer, { ...msg, id: fromPeer, relay: undefined });
      }
    });
  }

  on(t, fn) { this.handlers.set(t, fn); }

  send(payload, to = null) {
    this.party?.send('camp', payload, to);
  }

  broadcastExcept(exceptPeer, payload) {
    if (!this.party) return;
    for (const id of this.party.conns.keys()) {
      if (id !== exceptPeer) this.party.send('camp', payload, id);
    }
  }

  /** Throttled own-position send (10Hz, only when it changed). */
  sendPos(p, now) {
    if (!this.party) return;
    if (now - this.lastPosSent < 100) return;
    const s = p.sit ? 1 : 0;
    const key = `${Math.round(p.x)},${Math.round(p.y)},${p.f},${p.m ? 1 : 0},${s}`;
    if (key === this.lastPos) return;
    this.lastPos = key;
    this.lastPosSent = now;
    // guests mark relay so the host forwards to other guests; the host's own
    // pos goes straight to everyone
    if (this.isHost) this.send({ t: 'pos', id: 'host', x: p.x, y: p.y, f: p.f, m: p.m, s });
    else this.send({ t: 'pos', x: p.x, y: p.y, f: p.f, m: p.m, s, relay: true });
  }

  detach() {
    this.handlers.clear();
    this.party = null;
  }
}

/** Interpolation buffer for a remote player: render ~150ms in the past. */
export class Interp {
  constructor(x, y) {
    this.samples = [{ t: 0, x, y, f: 0, m: false }];
  }

  push(now, x, y, f, m) {
    this.samples.push({ t: now, x, y, f, m });
    if (this.samples.length > 6) this.samples.shift();
  }

  at(now) {
    const target = now - 150;
    const s = this.samples;
    const last = s[s.length - 1];
    if (s.length === 1 || now - last.t > 1000) return last; // snap on gaps
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= target) {
        const a = s[i - 1], b = s[i];
        const span = b.t - a.t || 1;
        const k = Math.max(0, Math.min(1, (target - a.t) / span));
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, f: b.f, m: b.m };
      }
    }
    return last;
  }
}
