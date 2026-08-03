// Camp decorating (P4): spend shared camp points on items, place them on the
// map. Placement validity is checked by the host; placements persist in the
// campsite doc and are painted into the background layer.

import { collides } from './world.js';

export const SHOP = [
  { item: 'lantern', name: 'Lantern', emoji: '🏮', cost: 10 },
  { item: 'chair', name: 'Camp Chair', emoji: '🪑', cost: 15 },
  { item: 'lights', name: 'String Lights', emoji: '💡', cost: 25 },
  { item: 'flag', name: 'Camp Flag', emoji: '🚩', cost: 8 },
];

export const shopItem = (id) => SHOP.find((s) => s.item === id);

export const MAX_DECOR = 60;

/** Host-side validation of a placement request. */
export function canPlace(campData, item, x, y) {
  const s = shopItem(item);
  if (!s) return { ok: false, reason: 'Unknown item' };
  if (campData.points < s.cost) return { ok: false, reason: 'Not enough camp points' };
  if (campData.decor.length >= MAX_DECOR) return { ok: false, reason: 'Camp is full!' };
  if (collides(x, y)) return { ok: false, reason: 'Cannot place there' };
  return { ok: true };
}

export class DecorUI {
  /** hooks: { points() -> n, requestPlace(item, x, y), toast, screenToWorld(sx, sy) } */
  constructor(els, hooks) {
    this.els = els; // {shop, shopList, shopPoints}
    this.hooks = hooks;
    this.placing = null; // item id while in placement mode
  }

  openShop() {
    this.els.shopPoints.textContent = `⭐ ${this.hooks.points()} camp points`;
    this.els.shopList.replaceChildren(...SHOP.map((s) => {
      const row = document.createElement('button');
      row.className = 'shop-row';
      row.innerHTML = `<span>${s.emoji} ${s.name}</span><span class="cost">⭐ ${s.cost}</span>`;
      row.disabled = this.hooks.points() < s.cost;
      row.onclick = () => {
        this.els.shop.classList.add('hidden');
        this.placing = s.item;
        this.hooks.toast(`Tap the ground to place your ${s.name} ${s.emoji}`, 3000, 'info');
      };
      return row;
    }));
    this.els.shop.classList.remove('hidden');
  }

  closeShop() { this.els.shop.classList.add('hidden'); }

  /** Canvas tap while in placement mode. Returns true if it consumed the tap. */
  onCanvasTap(sx, sy) {
    if (!this.placing) return false;
    const { x, y } = this.hooks.screenToWorld(sx, sy);
    this.hooks.requestPlace(this.placing, Math.round(x), Math.round(y));
    this.placing = null;
    return true;
  }
}
