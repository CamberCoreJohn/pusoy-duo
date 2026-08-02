// PeerJS wrapper: a small star-topology party. Every guest opens a data
// connection to the host (game traffic), and video is a full mesh -- each
// peer answers any incoming call with its local stream, and guests call the
// peer ids the host tells them about.
//
// Loaded from CDN in index.html as a global `Peer`.

const ROOM_PREFIX = 'pineapple-';

const randomCode = () => {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easily-confused chars
  let s = '';
  for (let i = 0; i < 5; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
};

export class Party {
  constructor() {
    this.peer = null;
    this.conns = new Map();    // peerId -> DataConnection (host: all guests; guest: just host)
    this.isHost = false;
    this.localStream = null;
    this.handlers = new Map(); // type -> fn(payload, fromPeerId)
    this.onRemoteStream = null; // (peerId, MediaStream)
    this.onPeerJoin = null;     // (peerId) -- host only
    this.onPeerLeave = null;    // (peerId)
    this.onOpen = null;         // guest only: data connection to host ready
  }

  on(type, fn) { this.handlers.set(type, fn); }

  /** Send to one peer, or broadcast to all open connections. */
  send(type, payload, to = null) {
    const msg = { type, payload };
    if (to) { const c = this.conns.get(to); if (c?.open) c.send(msg); return; }
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  async host(localStream) {
    this.isHost = true;
    this.localStream = localStream;
    const code = randomCode();
    this.peer = new Peer(ROOM_PREFIX + code);
    await this._peerReady();
    this.peer.on('connection', (conn) => this._wireConn(conn));
    this._answerCalls();
    return code;
  }

  async join(code, localStream) {
    this.isHost = false;
    this.localStream = localStream;
    this.peer = new Peer();
    await this._peerReady();
    this._answerCalls();
    const hostId = ROOM_PREFIX + code.toUpperCase();
    const conn = this.peer.connect(hostId, { reliable: true });
    this._wireConn(conn, () => this.onOpen?.());
    this.callPeer(hostId);
  }

  /** Place a media call to a peer (video mesh edge). */
  callPeer(peerId) {
    if (!this.localStream) return;
    const call = this.peer.call(peerId, this.localStream);
    call.on('stream', (s) => this.onRemoteStream?.(peerId, s));
  }

  _answerCalls() {
    this.peer.on('call', (call) => {
      call.answer(this.localStream);
      call.on('stream', (s) => this.onRemoteStream?.(call.peer, s));
    });
  }

  _peerReady() {
    return new Promise((resolve, reject) => {
      this.peer.on('open', resolve);
      this.peer.on('error', (e) => reject(e));
    });
  }

  _wireConn(conn, onOpen) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      onOpen?.();
      if (this.isHost) this.onPeerJoin?.(conn.peer);
    });
    conn.on('data', (msg) => {
      if (msg && typeof msg === 'object') this.handlers.get(msg.type)?.(msg.payload, conn.peer);
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.onPeerLeave?.(conn.peer);
    });
  }

  destroy() {
    for (const c of this.conns.values()) c.close();
    this.peer?.destroy();
  }
}
