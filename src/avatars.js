// Table-mode avatars.
//
// Humans: their video feed with the background removed via MediaPipe selfie
// segmentation (all client-side — every client segments the feeds it already
// receives over the mesh; nothing extra crosses the network).
// Bots: a generic animated "feed" drawn on canvas.
// Humans with no video available: initial-letter avatar.
//
// Rendering is throttled (~15fps) and sized small (192px) so segmenting 2-4
// feeds stays cheap. While the segmenter model is still loading, video
// avatars show un-cut (full background) rather than blank.

import {
  FilesetResolver,
  ImageSegmenter,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const SIZE = 192;
const FPS_MS = 66;

export class AvatarSystem {
  constructor() {
    this.entries = [];      // {canvas, ctx, kind: 'video'|'bot'|'initial', video?, hue, label}
    this.segmenter = null;
    this.segmenterFailed = false;
    this.running = false;
    this.lastTick = 0;
    this.work = document.createElement('canvas');
    this.work.width = this.work.height = SIZE;
    this.workCtx = this.work.getContext('2d', { willReadFrequently: true });
  }

  async _initSegmenter() {
    if (this.segmenter || this.segmenterFailed || this._initing) return;
    this._initing = true;
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    } catch (e) {
      console.warn('Selfie segmentation unavailable — avatars keep their background', e);
      this.segmenterFailed = true;
    }
    this._initing = false;
  }

  /** entries: [{canvas, kind, video, hue, label}] — canvas is the visible element. */
  setEntries(entries) {
    this.entries = entries.map((e) => {
      e.canvas.width = e.canvas.height = SIZE;
      return { ...e, ctx: e.canvas.getContext('2d') };
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._initSegmenter();
    requestAnimationFrame((t) => this._tick(t));
  }

  stop() { this.running = false; }

  _tick(t) {
    if (!this.running) return;
    if (t - this.lastTick >= FPS_MS) {
      this.lastTick = t;
      for (const e of this.entries) this._render(e, t);
    }
    requestAnimationFrame((tt) => this._tick(tt));
  }

  _render(e, t) {
    if (e.kind === 'bot') return this._renderBot(e, t);
    if (e.kind === 'video' && e.video && e.video.readyState >= 2) return this._renderVideo(e);
    return this._renderInitial(e, t);
  }

  _renderVideo(e) {
    const { workCtx: w } = this;
    // center-cover crop of the video into the square work canvas, mirrored
    // for the local feed so it matches the self-view
    const vw = e.video.videoWidth, vh = e.video.videoHeight;
    if (!vw || !vh) return this._renderInitial(e, 0);
    const s = Math.min(vw, vh);
    w.clearRect(0, 0, SIZE, SIZE);
    w.save();
    if (e.mirror) { w.translate(SIZE, 0); w.scale(-1, 1); }
    w.drawImage(e.video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SIZE, SIZE);
    w.restore();

    if (this.segmenter) {
      try {
        const res = this.segmenter.segment(this.work);
        const mask = res.confidenceMasks[0].getAsFloat32Array();
        // The selfie model's confidence channel may be person-or-background
        // depending on model version. Corners are almost always background,
        // so sample them to auto-orient the mask.
        const c = (mask[0] + mask[SIZE - 1] + mask[(SIZE - 1) * SIZE] + mask[SIZE * SIZE - 1]) / 4;
        const personIsHigh = c < 0.5;
        const img = w.getImageData(0, 0, SIZE, SIZE);
        for (let i = 0; i < mask.length; i++) {
          const p = personIsHigh ? mask[i] : 1 - mask[i];
          img.data[i * 4 + 3] = p > 0.15 ? Math.min(255, p * 290) : 0;
        }
        res.close();
        e.ctx.clearRect(0, 0, SIZE, SIZE);
        e.ctx.putImageData(img, 0, 0);
        return;
      } catch { /* fall through to uncut frame */ }
    }
    e.ctx.clearRect(0, 0, SIZE, SIZE);
    e.ctx.drawImage(this.work, 0, 0);
  }

  _renderBot(e, t) {
    const c = e.ctx, m = SIZE / 2;
    const bob = Math.sin(t / 480) * 6;
    const tilt = Math.sin(t / 900) * 0.06;
    c.clearRect(0, 0, SIZE, SIZE);
    const g = c.createRadialGradient(m, m, 10, m, m, m);
    g.addColorStop(0, `hsl(${e.hue} 45% 32%)`);
    g.addColorStop(1, `hsl(${e.hue} 55% 14%)`);
    c.fillStyle = g;
    c.fillRect(0, 0, SIZE, SIZE);
    // scanline shimmer so it reads as a "feed", not a sticker
    c.fillStyle = 'rgba(255,255,255,0.05)';
    const ly = (t / 14) % SIZE;
    c.fillRect(0, ly, SIZE, 3);
    c.save();
    c.translate(m, m + bob);
    c.rotate(tilt);
    c.font = `${SIZE * 0.46}px system-ui`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('🤖', 0, 0);
    c.restore();
  }

  _renderInitial(e, t) {
    const c = e.ctx, m = SIZE / 2;
    c.clearRect(0, 0, SIZE, SIZE);
    c.fillStyle = `hsl(${e.hue} 40% 26%)`;
    c.fillRect(0, 0, SIZE, SIZE);
    c.fillStyle = '#e8eef7';
    c.font = `700 ${SIZE * 0.42}px system-ui`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText((e.label || '?')[0].toUpperCase(), m, m + Math.sin(t / 600) * 2);
  }
}
