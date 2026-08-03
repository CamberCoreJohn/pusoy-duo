// Camp Level: one shared progression for the campsite. XP comes from
// everything either camper does; levels gate camping spots and gear tiers.
// Pure functions — host applies awards, everyone renders them.

// Cumulative XP required to REACH each level (index = level - 1).
export const LEVEL_XP = [
  0, 100, 250, 450, 700, 1050, 1500, 2100, 2900, 3900,
  5100, 6600, 8400, 10500, 13000,
];
export const MAX_LEVEL = LEVEL_XP.length;

export function levelFromXp(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lvl = i + 1;
  return lvl;
}

/** Progress within the current level, 0..1 (1 at max level). */
export function levelProgress(xp) {
  const lvl = levelFromXp(xp);
  if (lvl >= MAX_LEVEL) return 1;
  const lo = LEVEL_XP[lvl - 1], hi = LEVEL_XP[lvl];
  return (xp - lo) / (hi - lo);
}

export const XP = {
  catch: { junk: 2, common: 5, uncommon: 10, rare: 25, epic: 60 },
  sellPerFish: 1,
  fireLit: 15,
  goldenMallow: 10,
  feast: 15,
  constellation: 40,
  decor: 5,
};

export const xpForCatch = (rarity) => XP.catch[rarity] ?? 3;
