// First-visit intro: the photo is "drawn" onto the page by a pencil.
//
// A serpentine scribble path progressively unmasks the pencil-sketch version
// (assets/intro-sketch.png), a pencil rides the stroke tip, then the color
// cutout (assets/intro.png) crossfades in and the overlay dissolves.
// Not skippable by design; if assets fail or anything stalls, a failsafe
// still dismisses the overlay so the app is never blocked.

const DRAW_MS = 2600;
const COLOR_MS = 900;
const HOLD_MS = 350;
const FAILSAFE_MS = 9000;

export function runIntro(onDone) {
  const screen = document.getElementById('introScreen');
  const canvas = document.getElementById('introCanvas');
  if (!screen || !canvas) { onDone?.(); return; }
  screen.classList.remove('hidden');

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(failsafe);
    screen.style.transition = 'opacity 0.45s ease';
    screen.style.opacity = '0';
    setTimeout(() => { screen.remove(); onDone?.(); }, 470);
  };
  const failsafe = setTimeout(finish, FAILSAFE_MS);

  const load = (src) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

  Promise.all([load('assets/intro-sketch.png'), load('assets/intro.png')])
    .then(([sketch, color]) => {
      if (done) return;
      const scale = Math.min(
        Math.min(innerHeight * 0.68, 900) / sketch.height,
        (innerWidth * 0.86) / sketch.width
      );
      const W = (canvas.width = Math.round(sketch.width * scale));
      const H = (canvas.height = Math.round(sketch.height * scale));
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');

      // scribble mask that accumulates strokes
      const mask = document.createElement('canvas');
      mask.width = W; mask.height = H;
      const mctx = mask.getContext('2d');
      mctx.lineCap = mctx.lineJoin = 'round';
      mctx.strokeStyle = '#fff';

      const ROWS = 14;
      const rowH = H / ROWS;
      // serpentine: sweep right, drop a row, sweep left… with hand wobble
      const pathPoint = (t) => {
        const ft = Math.min(0.9999, t) * ROWS;
        const row = Math.floor(ft);
        const frac = ft - row;
        const x = (row % 2 === 0 ? frac : 1 - frac) * W;
        const y = row * rowH + rowH * 0.5 + Math.sin(frac * Math.PI * 6) * rowH * 0.18;
        return { x, y };
      };

      const composite = (tip, colorAlpha) => {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(sketch, 0, 0, W, H);
        ctx.restore();
        if (colorAlpha > 0) {
          ctx.globalAlpha = colorAlpha;
          ctx.drawImage(color, 0, 0, W, H);
          ctx.globalAlpha = 1;
        }
        if (tip) {
          ctx.save();
          ctx.translate(tip.x, tip.y);
          ctx.rotate(-0.5);
          ctx.font = `${Math.round(rowH * 1.7)}px system-ui`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText('✏️', -4, 4);
          ctx.restore();
        }
      };

      let prevT = 0;
      const advanceMask = (p) => {
        mctx.lineWidth = rowH * 1.4;
        mctx.beginPath();
        let q = pathPoint(prevT);
        mctx.moveTo(q.x, q.y);
        for (let s = prevT; s <= p; s += 0.002) { q = pathPoint(s); mctx.lineTo(q.x, q.y); }
        q = pathPoint(p); mctx.lineTo(q.x, q.y);
        mctx.stroke();
        prevT = p;
        return q;
      };

      // immediate first paint so something shows before the first rAF
      composite(advanceMask(0.015), 0);

      let start = 0;
      const frame = (now) => {
        if (done) return;
        if (!start) start = now;
        const t = now - start;
        if (t < DRAW_MS) {
          composite(advanceMask(Math.min(1, t / DRAW_MS)), 0);
        } else if (t < DRAW_MS + COLOR_MS) {
          if (prevT < 1) advanceMask(1);
          composite(null, (t - DRAW_MS) / COLOR_MS);
        } else {
          composite(null, 1);
          setTimeout(finish, HOLD_MS);
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    })
    .catch(finish); // missing assets: skip straight to the app
}
