export const CAPACITY_ML = 80;
export const DROP_INTERVAL_MS = 120;
const SERVING_DROPS = 4;
const WARNING_DROPS = 3;

export class Mission {
  constructor() { this.reset(); }
  reset() {
    this.ml = CAPACITY_ML;
    this.score = 0;
    this.squeeze = null;
    this.pending = new Set();
  }
  get finished() { return this.score > 0 || (this.ml === 0 && !this.pending.size); }
  start() {
    if (!this.squeeze && this.ml && !this.score) this.squeeze = {hits:0, misses:0};
  }
  stop() { this.squeeze = null; }
  dispense(aim) {
    if (!this.squeeze || !this.ml || this.score) return null;
    const drop = {squeeze:this.squeeze, aim};
    this.ml--;
    this.pending.add(drop);
    return drop;
  }
  land(drop, aim) {
    if (!this.pending.delete(drop) || this.score) return null;
    const chain = drop.squeeze;
    // A stale tracker sample at either end is inconclusive, never a player error.
    if (drop.aim === 'unknown' || aim === 'unknown') {
      chain.hits = chain.misses = 0;
      return 'unknown';
    }
    if (drop.aim !== 'hit' || aim !== 'hit') {
      chain.hits = 0;
      return ++chain.misses === WARNING_DROPS ? 'warn' : 'miss';
    }
    chain.misses = 0;
    if (++chain.hits < SERVING_DROPS) return 'hit';
    this.score = 400;
    this.stop();
    return 'served';
  }
}
