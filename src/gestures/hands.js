// Hand tracking -> UI events.
//
// One hand controls a cursor (index fingertip, mirrored to match the mirrored
// self-view). Events emitted per frame:
//   { cursor:{x,y}|null, pinching, pinchDown, pinchUp, fistProgress, fistHeld }
//
// - Pinch threshold is normalized by hand size (wrist -> middle MCP) so it
//   works at any distance from the camera.
// - Cursor is EMA-smoothed to kill landmark jitter.
// - Fist must be held ~900ms to fire (used for PASS) -- temporal gate instead
//   of an edge trigger so it can't happen by accident.

import {
  FilesetResolver,
  HandLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8, MIDDLE_MCP: 9, MIDDLE_TIP: 12, RING_MCP: 13, RING_TIP: 16, PINKY_MCP: 17, PINKY_TIP: 20 };

const PINCH_ON = 0.28;   // fraction of hand size to start a pinch
const PINCH_OFF = 0.38;  // hysteresis: release threshold
const SMOOTH = 0.45;     // EMA alpha (higher = snappier, lower = smoother)
const FIST_HOLD_MS = 900;

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class HandInput {
  constructor() {
    this.landmarker = null;
    this.cursor = null;      // smoothed, normalized [0..1], already mirrored
    this.pinching = false;
    this.fistSince = 0;
    this.fistFired = false;
    this.lastVideoTime = -1;
    this.landmarks = null;   // raw landmarks of the tracked hand (for drawing)
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  }

  /** Run one frame. Returns the event object described above. */
  update(video, nowMs) {
    const ev = { cursor: null, pinching: this.pinching, pinchDown: false, pinchUp: false, fistProgress: 0, fistHeld: false };
    if (!this.landmarker || video.readyState < 2) return this._noHand(ev, nowMs);
    if (video.currentTime === this.lastVideoTime) { ev.cursor = this.cursor; return ev; }
    this.lastVideoTime = video.currentTime;

    const res = this.landmarker.detectForVideo(video, nowMs);
    const lm = res.landmarks?.[0];
    if (!lm) return this._noHand(ev, nowMs);
    this.landmarks = lm;

    const handSize = d2(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
    if (handSize < 1e-4) return this._noHand(ev, nowMs);

    // --- cursor: mirrored index tip, EMA smoothed
    const raw = { x: 1 - lm[LM.INDEX_TIP].x, y: lm[LM.INDEX_TIP].y };
    this.cursor = this.cursor
      ? { x: this.cursor.x + SMOOTH * (raw.x - this.cursor.x), y: this.cursor.y + SMOOTH * (raw.y - this.cursor.y) }
      : raw;
    ev.cursor = this.cursor;

    // --- pinch with hysteresis, normalized by hand size
    const pinchRatio = d2(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / handSize;
    const wasPinching = this.pinching;
    if (!wasPinching && pinchRatio < PINCH_ON) this.pinching = true;
    else if (wasPinching && pinchRatio > PINCH_OFF) this.pinching = false;
    ev.pinching = this.pinching;
    ev.pinchDown = this.pinching && !wasPinching;
    ev.pinchUp = !this.pinching && wasPinching;

    // --- fist gate (all four fingertips curled inside their MCPs)
    const wrist = lm[LM.WRIST];
    let curled = 0;
    for (const [tip, mcp] of [
      [LM.INDEX_TIP, LM.INDEX_MCP], [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
      [LM.RING_TIP, LM.RING_MCP], [LM.PINKY_TIP, LM.PINKY_MCP],
    ]) {
      if (d2(lm[tip], wrist) < d2(lm[mcp], wrist)) curled++;
    }
    const isFist = curled >= 4 && !this.pinching;
    if (isFist) {
      if (!this.fistSince) this.fistSince = nowMs;
      ev.fistProgress = Math.min(1, (nowMs - this.fistSince) / FIST_HOLD_MS);
      if (ev.fistProgress >= 1 && !this.fistFired) {
        this.fistFired = true;
        ev.fistHeld = true;
      }
    } else {
      this.fistSince = 0;
      this.fistFired = false;
    }
    return ev;
  }

  _noHand(ev, nowMs) {
    this.landmarks = null;
    this.fistSince = 0;
    this.fistFired = false;
    if (this.pinching) { this.pinching = false; ev.pinchUp = true; ev.pinching = false; }
    return ev;
  }
}
