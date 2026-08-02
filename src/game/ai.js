// AI player: enumerate legal plays, pick a sensible one.
//
// Strategy (deliberately beatable):
// - Following: play the *cheapest* combo that beats the pile; pass if none.
//   Holds the 2♦ back on cheap singles unless the hand is nearly empty.
// - Leading: dump the combo whose highest card is lowest, preferring longer
//   combos on ties (sheds more cards).
//
// Runs on the host only.

import { cardValue, sortCards, MAX_RANK } from './cards.js';
import { classify, beats, SHAPE, DEFAULT_RULES } from './combos.js';

function* combinations(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* combinations(arr, k, i + 1, acc);
    acc.pop();
  }
}

/** All classified combos of the given shapes present in `hand`. */
export function enumerateCombos(hand, shapes, rules = DEFAULT_RULES) {
  const sorted = sortCards(hand);
  const out = [];
  for (const k of shapes) {
    for (const cs of combinations(sorted, k)) {
      const combo = classify(cs, rules);
      if (combo) out.push(combo);
    }
  }
  return out;
}

const highestValue = (combo) => cardValue(combo.cards[combo.cards.length - 1]);

/**
 * Decide the AI's move.
 * @param {Array} hand        the AI's cards
 * @param {object|null} pile  classified combo to beat, or null on a fresh lead
 * @param {object} opts       { mustInclude: cardId|null, rules }
 * @returns {string[]|null}   card ids to play, or null to pass
 */
export function chooseAiPlay(hand, pile, { mustInclude = null, rules = DEFAULT_RULES } = {}) {
  const shapes = pile ? [pile.shape] : [SHAPE.FIVE, SHAPE.TRIPLE, SHAPE.PAIR, SHAPE.SINGLE];
  let candidates = enumerateCombos(hand, shapes, rules);
  if (pile) candidates = candidates.filter((c) => beats(c, pile));
  if (mustInclude) candidates = candidates.filter((c) => c.cards.some((x) => x.id === mustInclude));
  if (candidates.length === 0) return null;

  if (!pile) {
    // Leading: lowest top card wins; among ties shed as many cards as possible.
    candidates.sort((a, b) => highestValue(a) - highestValue(b) || b.cards.length - a.cards.length);
    return candidates[0].cards.map((c) => c.id);
  }

  // Following: cheapest combo that beats the pile.
  candidates.sort((a, b) => a.cat - b.cat || a.key - b.key);
  let pick = candidates[0];

  // Don't burn the 2♦ (or any deuce) on a cheap single early in the hand.
  if (pile.shape === SHAPE.SINGLE && hand.length > 4) {
    const pickIsDeuce = pick.cards[0].r === MAX_RANK;
    const pileIsCheap = cardValue(pile.cards[pile.cards.length - 1]) < cardValue({ r: 12, s: 0 });
    if (pickIsDeuce && pileIsCheap) {
      const alt = candidates.find((c) => c.cards[0].r < MAX_RANK);
      if (alt) pick = alt;
      else return null; // only deuces could beat it: save them, pass
    }
  }
  return pick.cards.map((c) => c.id);
}
