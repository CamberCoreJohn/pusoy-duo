// Combination detection and comparison -- the actual rules of Pusoy Dos.
//
// A play is legal if it is a recognised combination, has the same shape (card
// count) as the combination it is answering, and outranks it.

import { cardValue, sortCards } from './cards.js';

export const SHAPE = { SINGLE: 1, PAIR: 2, TRIPLE: 3, FIVE: 5 };

// Five-card categories, low -> high.
export const FIVE = {
  STRAIGHT: 1,
  FLUSH: 2,
  FULL_HOUSE: 3,
  QUADS: 4,
  STRAIGHT_FLUSH: 5,
};

export const FIVE_NAME = {
  1: 'Straight',
  2: 'Flush',
  3: 'Full House',
  4: 'Four of a Kind',
  5: 'Straight Flush',
};

export const DEFAULT_RULES = {
  // House rule: compare flushes by suit first (a diamond flush beats any heart
  // flush). Set false to compare by highest card instead.
  flushBySuit: true,
  // House rule: allow a bare three-of-a-kind as its own shape.
  allowTriples: true,
};

const groupByRank = (cards) => {
  const m = new Map();
  for (const c of cards) m.set(c.r, (m.get(c.r) || []).concat(c));
  return m;
};

const isConsecutive = (ranks) => ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);

/**
 * Classify a set of cards into a comparable combination descriptor, or null if
 * the cards do not form a legal combination.
 *
 * Returned shape: { shape, cat, key, name, cards }
 *   shape - card count, must match across a trick
 *   cat   - category within the shape (only meaningful for five-card hands)
 *   key   - tiebreak within the category
 */
export function classify(cards, rules = DEFAULT_RULES) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const sorted = sortCards(cards);
  const n = sorted.length;
  const high = sorted[n - 1];
  const groups = groupByRank(sorted);

  if (n === 1) {
    return { shape: SHAPE.SINGLE, cat: 0, key: cardValue(high), name: 'Single', cards: sorted };
  }

  if (n === 2) {
    if (sorted[0].r !== sorted[1].r) return null;
    return { shape: SHAPE.PAIR, cat: 0, key: cardValue(high), name: 'Pair', cards: sorted };
  }

  if (n === 3) {
    if (!rules.allowTriples) return null;
    if (groups.size !== 1) return null;
    return { shape: SHAPE.TRIPLE, cat: 0, key: cardValue(high), name: 'Three of a Kind', cards: sorted };
  }

  if (n !== 5) return null;

  const ranks = sorted.map((c) => c.r);
  const uniqueRanks = [...new Set(ranks)];
  const flush = sorted.every((c) => c.s === sorted[0].s);
  // Straights, low -> high:
  //   3-4-5-6-7 ... 10-J-Q-K-A   (ranked by highest card)
  //   A-2-3-4-5                  (second highest)
  //   J-Q-K-A-2                  (the highest straight)
  // Other wrap-arounds (e.g. 2-3-4-5-6) are not straights. Ranks: 3=3 ... A=14, 2=15.
  const consecutive = uniqueRanks.length === 5 && isConsecutive(uniqueRanks);
  const a2345 = uniqueRanks.length === 5
    && uniqueRanks[0] === 3 && uniqueRanks[1] === 4 && uniqueRanks[2] === 5
    && uniqueRanks[3] === 14 && uniqueRanks[4] === 15;
  const jqka2 = consecutive && uniqueRanks[0] === 11;
  const straightTier = jqka2 ? 2 : a2345 ? 1 : consecutive ? 0 : -1;
  const straight = straightTier >= 0;
  // Tiebreak within a tier by the deck-highest card (covers suit): in both
  // special straights that is the 2.
  const straightKey = straightTier * 1000 + cardValue(high);

  const five = (cat, key) => ({ shape: SHAPE.FIVE, cat, key, name: FIVE_NAME[cat], cards: sorted });

  if (straight && flush) return five(FIVE.STRAIGHT_FLUSH, straightKey);

  const counts = [...groups.entries()].map(([r, cs]) => ({ r, n: cs.length })).sort((a, b) => b.n - a.n);

  if (counts[0].n === 4) return five(FIVE.QUADS, counts[0].r);
  if (counts[0].n === 3 && counts[1]?.n === 2) return five(FIVE.FULL_HOUSE, counts[0].r);

  if (flush) {
    const key = rules.flushBySuit ? sorted[0].s * 100 + high.r : cardValue(high);
    return five(FIVE.FLUSH, key);
  }
  if (straight) return five(FIVE.STRAIGHT, straightKey);

  return null;
}

/** Does combination `a` beat combination `b`? Both must already be classified. */
export function beats(a, b) {
  if (!a) return false;
  if (!b) return true; // leading a fresh trick
  if (a.shape !== b.shape) return false;
  if (a.cat !== b.cat) return a.cat > b.cat;
  return a.key > b.key;
}

/** Human-readable reason a play is rejected, or null if it is legal. */
export function validatePlay(cards, pileCombo, rules = DEFAULT_RULES) {
  const combo = classify(cards, rules);
  if (!combo) return { ok: false, reason: 'Not a valid combination' };
  if (!pileCombo) return { ok: true, combo };
  if (combo.shape !== pileCombo.shape) {
    return { ok: false, reason: `Must play ${pileCombo.shape} card${pileCombo.shape > 1 ? 's' : ''}` };
  }
  if (!beats(combo, pileCombo)) return { ok: false, reason: `${combo.name} does not beat ${pileCombo.name}` };
  return { ok: true, combo };
}
