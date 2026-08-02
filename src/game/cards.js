// Pusoy Dos card model.
//
// Suit strength (low -> high): clubs, spades, hearts, diamonds.
// Rank strength (low -> high): 3 4 5 6 7 8 9 10 J Q K A 2
//
// So 3C is the weakest card in the deck and 2D the strongest. Note this suit
// order is the Filipino one and is NOT the same as Chinese Big Two.

export const SUITS = ['C', 'S', 'H', 'D'];
export const SUIT_GLYPH = ['♣', '♠', '♥', '♦'];
export const SUIT_IS_RED = [false, false, true, true];

export const MIN_RANK = 3;
export const MAX_RANK = 15; // the deuce

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' };
const LABEL_RANK = { J: 11, Q: 12, K: 13, A: 14, 2: 15 };

export const rankLabel = (r) => RANK_LABEL[r] || String(r);
export const cardId = (r, s) => rankLabel(r) + SUITS[s];
export const makeCard = (r, s) => ({ r, s, id: cardId(r, s) });

/** Total order over the deck: rank dominates, suit breaks ties. */
export const cardValue = (c) => c.r * 4 + c.s;

/** The card that must be led on the very first play of a round. */
export const LOWEST_CARD = cardId(3, 0); // '3C'

export function parseCard(id) {
  const s = SUITS.indexOf(id.slice(-1));
  const label = id.slice(0, -1);
  const r = LABEL_RANK[label] ?? Number(label);
  if (s < 0 || !Number.isFinite(r)) throw new Error(`bad card id: ${id}`);
  return { r, s, id };
}

export function makeDeck() {
  const deck = [];
  for (let r = MIN_RANK; r <= MAX_RANK; r++) {
    for (let s = 0; s < 4; s++) deck.push(makeCard(r, s));
  }
  return deck;
}

export function shuffle(deck, rand = Math.random) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pusoy Dos always deals 13 cards per player regardless of headcount; with two
 * players the remaining 26 cards simply stay out of play.
 */
export function deal(players = 2, handSize = 13, rand = Math.random) {
  const deck = shuffle(makeDeck(), rand);
  const hands = [];
  for (let p = 0; p < players; p++) hands.push(sortCards(deck.slice(p * handSize, (p + 1) * handSize)));
  return hands;
}

export const sortCards = (cards) => cards.slice().sort((a, b) => cardValue(a) - cardValue(b));

export const byId = (cards) => new Map(cards.map((c) => [c.id, c]));

export const removeCards = (hand, ids) => {
  const drop = new Set(ids);
  return hand.filter((c) => !drop.has(c.id));
};
