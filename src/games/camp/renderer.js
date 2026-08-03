// Renderer selection. Both renderers satisfy the same interface, so the sim,
// networking, and HUD never know which one is running:
//
//   paintBackground(map, decor, unlocked)   rebuild static scenery
//   frame(now, players, world, truckView)   draw one frame
//   addTransient(fx) / headlights           effects
//   screenToWorld(sx, sy) / worldToScreen   picking
//   resize() / destroy()
//
// 3D is lazy-loaded: a 2D session never downloads Three.js. Anything that
// goes wrong (no WebGL2, CDN blocked, context lost, sustained slow frames)
// falls back to the canvas renderer, which stays a first-class citizen.

import { CampRenderer } from './render2d.js';

const MODE_KEY = 'kritzzz-camp-renderer';

export const getPreferredMode = () => localStorage.getItem(MODE_KEY) || 'auto';
export const setPreferredMode = (m) => localStorage.setItem(MODE_KEY, m);

/** Rough capability tier from what the GPU reports about itself. */
export function deviceTier() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false, tier: 'none' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    const mem = navigator.deviceMemory || 4;
    const weak = /swiftshader|llvmpipe|software|mali-4|adreno \(tm\) [23]/i.test(gpu);
    const tier = weak || mem <= 2 ? 'low' : mem <= 4 ? 'med' : 'high';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, tier, gpu };
  } catch {
    return { webgl2: false, tier: 'none' };
  }
}

/**
 * Build a renderer for the canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{mode?: 'auto'|'3d'|'2d', onFallback?: (reason: string) => void}} opts
 */
export async function createRenderer(canvas, { mode = 'auto', onFallback } = {}) {
  const caps = deviceTier();
  const want3d = mode === '3d' || (mode === 'auto' && caps.webgl2 && caps.tier !== 'low');
  if (want3d && caps.webgl2) {
    try {
      const { CampRenderer3D } = await import('./render3d.js');
      const r = await CampRenderer3D.create(canvas, caps.tier);
      r.mode = '3d';
      r.caps = caps;
      return r;
    } catch (e) {
      console.warn('3D renderer unavailable, using 2D:', e);
      onFallback?.(e?.message || 'WebGL failed');
    }
  }
  const r = new CampRenderer(canvas);
  r.mode = '2d';
  r.caps = caps;
  return r;
}
