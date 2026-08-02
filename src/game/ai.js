// AI player: enumerate legal plays, then pick with a bit of actual strategy.
//
// The bot understands its hand's structure (quads/triples/pairs it would
// rather not break), hoards its power cards while the table is calm, plays
// denial when an opponent is nearly out, and will strategically PASS on
// cheap tricks rather than shred a good hand. Still beatable on purpose:
// it never counts cards beyond "what beats what", and a pinch of
// randomness keeps it from being a solved machine.
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
const ACE = 12; // rank index of A (3=0 ... A=12, 2=13)

/** cardId -> size of the rank group it belongs to (pair/triple/quad). */
function rankUnits(hand) {
  const byRank = new Map();
  for (const c of hand) byRank.set(c.r, (byRank.get(c.r) || 0) + 1);
  const unit = new Map();
  for (const c of hand) unit.set(c.id, byRank.get(c.r));
  return unit;
}

/**
 * Score a candidate: lower = better to play. Base cost is the combo key
 * (cheapness), plus penalties for shredding pairs/triples/quads and for
 * spending deuces/aces when nothing is urgent.
 */
function scoreCandidate(combo, unit, { urgent }) {
  let s = combo.key;
  for (const c of combo.cards) {
    const u = unit.get(c.id) || 1;
    if (u > combo.cards.length) s += [0, 0, 3000, 6000, 10000][u] || 0; // breaking a set
    if (!urgent) {
      if (c.r === MAX_RANK) s += 8000;      // deuce
      else if (c.r === ACE) s += 2500;      // ace
    }
  }
  return s;
}

/**
 * Decide the AI's move.
 * @param {Array} hand        the AI's cards
 * @param {object|null} pile  classified combo to beat, or null on a fresh lead
 * @param {object} opts       { mustInclude, rules, oppCounts }
 * @returns {string[]|null}   card ids to play, or null to pass
 */
export function chooseAiPlay(hand, pile, { mustInclude = null, rules = DEFAULT_RULES, oppCounts = [], rand = Math.random } = {}) {
  const shapes = pile ? [pile.shape] : [SHAPE.FIVE, SHAPE.TRIPLE, SHAPE.PAIR, SHAPE.SINGLE];
  let candidates = enumerateCombos(hand, shapes, rules);
  if (pile) candidates = candidates.filter((c) => beats(c, pile));
  if (mustInclude) candidates = candidates.filter((c) => c.cards.some((x) => x.id === mustInclude));
  if (candidates.length === 0) return null;

  const unit = rankUnits(hand);
  const minOpp = oppCounts.length ? Math.min(...oppCounts) : 13;
  const urgent = minOpp <= 2;               // someone is about to go out
  const finisher = candidates.find((c) => c.cards.length === hand.length);
  if (finisher) return finisher.cards.map((c) => c.id); // win on the spot

  if (!pile) {
    // Leading. Denial mode: with an opponent at 1-2 cards, don't feed them
    // cheap singles — lead sets, or our highest single if sets are gone.
    if (urgent) {
      const sets = candidates.filter((c) => c.cards.length > 1);
      if (sets.length) {
        sets.sort((a, b) => scoreCandidate(a, unit, { urgent }) - scoreCandidate(b, unit, { urgent }));
        return sets[0].cards.map((c) => c.id);
      }
      const singles = candidates.filter((c) => c.cards.length === 1);
      singles.sort((a, b) => highestValue(b) - highestValue(a));
      return singles[0].cards.map((c) => c.id);
    }
    // Calm table: shed the weakest stuff, preferring longer combos, without
    // shredding sets for singles.
    candidates.sort((a, b) =>
      scoreCandidate(a, unit, { urgent }) - scoreCandidate(b, unit, { urgent })
      || highestValue(a) - highestValue(b)
      || b.cards.length - a.cards.length);
    return candidates[0].cards.map((c) => c.id);
  }

  // Following: cheapest sensible beat.
  candidates.sort((a, b) => scoreCandidate(a, unit, { urgent }) - scoreCandidate(b, unit, { urgent }));
  const pick = candidates[0];
  const pickScore = scoreCandidate(pick, unit, { urgent });

  // Strategic pass: the trick is cheap, nobody is threatening, and our only
  // answers would shred a set or burn a power card. Roll the dice a bit so
  // the bot stays human-flavoured.
  if (!urgent && minOpp >= 5) {
    const pileCheap = cardValue(pile.cards[pile.cards.length - 1]) < cardValue({ r: 9, s: 0 }); // < Q
    const expensive = pickScore >= 2500;
    if (pileCheap && expensive && rand() < 0.75) return null;
    // Occasionally duck even a fair fight to mix up reads.
    if (pileCheap && hand.length > 9 && rand() < 0.08) return null;
  }
  return pick.cards.map((c) => c.id);
}
