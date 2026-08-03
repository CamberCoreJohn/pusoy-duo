// Host-authoritative Pusoy Dos engine for 2-4 players.
//
// The host runs this; guests only send intents ({play, cards} | {pass}) and
// render snapshots. One instance per round.
//
// Trick flow: after a play, the turn moves clockwise over players who still
// hold cards. Passing moves the turn on; when everyone else still in the
// round has passed, the trick clears and its owner leads fresh. Emptying
// your hand earns the next place in `rankings` and closes the trick — the
// next active player takes control. The round continues until a single
// player is left holding cards.

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
    this.rankings = [];      // seats in finishing order; last place appended at round end
    this.roundOver = false;
    this.log = [];
  }

  _activeCount() { return this.hands.filter((h) => h.length > 0).length; }

  _nextActive(from) {
    let next = (from + 1) % this.n;
    while (this.hands[next].length === 0) next = (next + 1) % this.n;
    return next;
  }

  /** @returns {{ok: boolean, reason?: string}} */
  play(player, cardIds) {
    if (this.roundOver) return { ok: false, reason: 'Round is over' };
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
      this.rankings.push(player);
      this.log.push({ player, type: 'finish', place: this.rankings.length });
      if (this._activeCount() <= 1) {
        // last player standing takes last place; the round is over
        const last = this.hands.findIndex((h) => h.length > 0);
        if (last >= 0) this.rankings.push(last);
        this.roundOver = true;
        return { ok: true };
      }
      // A finishing play closes the trick: the next active player takes
      // control with a fresh lead (nobody has to beat a ghost's cards).
      this.pile = null;
      this.pileOwner = -1;
      this.turn = this._nextActive(player);
      // carry the final play's cards so clients can still animate it
      this.log.push({ player: this.turn, type: 'handover', by: player, cards: cardIds, combo: v.combo.name });
      return { ok: true };
    }

    if (v.combo.shape === 1 && this._isUnbeatableSingle(v.combo, player)) {
      // The highest card still in play cannot be answered: instant control.
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
    if (this.roundOver) return { ok: false, reason: 'Round is over' };
    if (player !== this.turn) return { ok: false, reason: 'Not your turn' };
    if (!this.pile) return { ok: false, reason: 'Cannot pass on a fresh lead' };
    this.log.push({ player, type: 'pass' });
    this._advance(player);
    return { ok: true };
  }

  _advance(from) {
    this.turn = this._nextActive(from);
    // Everyone else passed: the trick is won, its owner leads fresh. (A
    // finished player never owns a live pile — finishing closes the trick.)
    if (this.pile && this.turn === this.pileOwner) {
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
      winner: this.rankings[0] ?? -1,
      rankings: [...this.rankings],
      roundOver: this.roundOver,
      lastLog: this.log[this.log.length - 1] || null,
      logN: this.log.length,
    };
  }
}

export { classify, validatePlay };
