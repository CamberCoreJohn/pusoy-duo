// Host-authoritative Pusoy Dos engine for 2-4 players.
//
// The host runs this; guests only send intents ({play, cards} | {pass}) and
// render snapshots. One instance per round.
//
// Trick flow: after a play, the turn moves clockwise. Passing moves the turn
// on; when the turn comes back around to the pile owner (everyone else has
// passed), the pile clears and the owner leads fresh. First empty hand wins.

import { deal, removeCards, byId, sortCards, cardValue } from './cards.js';
import { classify, validatePlay, DEFAULT_RULES } from './combos.js';

export class PusoyEngine {
  constructor({ players = 2, rules = DEFAULT_RULES, rand = Math.random } = {}) {
    if (players < 2 || players > 4) throw new Error('players must be 2-4');
    this.n = players;
    this.rules = rules;
    this.hands = deal(players, 13, rand);
    // With fewer than 4 players not all 52 cards are dealt, so the 3♣ may not
    // be in play. The holder of the lowest card actually in play leads and
    // must include that card in the opening play.
    const all = this.hands.flat();
    this.lowestInPlay = all.reduce((a, b) => (cardValue(a) <= cardValue(b) ? a : b)).id;
    this.turn = this.hands.findIndex((h) => h.some((c) => c.id === this.lowestInPlay));
    this.pile = null;        // classified combo currently on the table
    this.pileOwner = -1;     // who played it
    this.mustIncludeLowest = true;
    this.winner = -1;
    this.log = [];
  }

  /** @returns {{ok: boolean, reason?: string}} */
  play(player, cardIds) {
    if (this.winner >= 0) return { ok: false, reason: 'Round is over' };
    if (player !== this.turn) return { ok: false, reason: 'Not your turn' };

    const hand = byId(this.hands[player]);
    const cards = [];
    for (const id of cardIds) {
      const c = hand.get(id);
      if (!c) return { ok: false, reason: 'Card not in hand' };
      cards.push(c);
    }
    if (new Set(cardIds).size !== cardIds.length) return { ok: false, reason: 'Duplicate cards' };

    if (this.mustIncludeLowest && !cardIds.includes(this.lowestInPlay)) {
      return { ok: false, reason: `First play must include the ${this.lowestInPlay}` };
    }

    const v = validatePlay(cards, this.pile, this.rules);
    if (!v.ok) return v;

    this.hands[player] = removeCards(this.hands[player], cardIds);
    this.pile = v.combo;
    this.pileOwner = player;
    this.mustIncludeLowest = false;
    this.log.push({ player, type: 'play', combo: v.combo.name, cards: cardIds });

    if (this.hands[player].length === 0) {
      this.winner = player;
    } else if (v.combo.shape === 1 && this._isUnbeatableSingle(v.combo, player)) {
      // The highest card still in play cannot be answered: the player takes
      // control immediately instead of waiting for everyone to pass.
      this.log.push({ player, type: 'control', cards: cardIds, combo: v.combo.name });
      this.pile = null;
      this.pileOwner = -1;
      // turn stays with the player: fresh lead
    } else {
      this._advance(player);
    }
    return { ok: true };
  }

  /** True when no card left in any other hand outranks this single. */
  _isUnbeatableSingle(combo, player) {
    const v = cardValue(combo.cards[0]);
    for (let i = 0; i < this.n; i++) {
      if (i === player) continue;
      for (const c of this.hands[i]) if (cardValue(c) > v) return false;
    }
    return true;
  }

  pass(player) {
    if (this.winner >= 0) return { ok: false, reason: 'Round is over' };
    if (player !== this.turn) return { ok: false, reason: 'Not your turn' };
    if (!this.pile) return { ok: false, reason: 'Cannot pass on a fresh lead' };
    this.log.push({ player, type: 'pass' });
    this._advance(player);
    return { ok: true };
  }

  _advance(from) {
    this.turn = (from + 1) % this.n;
    // Everyone else passed: the trick is won, its owner leads fresh.
    if (this.turn === this.pileOwner && this.pile) {
      this.pile = null;
      this.pileOwner = -1;
    }
  }

  /** Snapshot for a given seat: full own hand, card counts for everyone. */
  snapshot(forPlayer) {
    return {
      you: forPlayer,
      n: this.n,
      turn: this.turn,
      yourHand: sortCards(this.hands[forPlayer]),
      counts: this.hands.map((h) => h.length),
      pile: this.pile ? { name: this.pile.name, cards: this.pile.cards, shape: this.pile.shape } : null,
      pileOwner: this.pileOwner,
      mustIncludeLowest: this.mustIncludeLowest,
      lowestInPlay: this.lowestInPlay,
      winner: this.winner,
      lastLog: this.log[this.log.length - 1] || null,
      logN: this.log.length,
    };
  }
}

export { classify, validatePlay };
