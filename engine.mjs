export class Mission {
  constructor({cooldown = 3000} = {}) { this.cooldown = cooldown; this.sequence = 0; this.reset(); }
  reset() {
    this.ammo = 8;
    this.score = 0;
    this.exposed = true;
    this.tracked = true;
    this.destroyed = false;
    this.readyAt = [0, 0];
    this.pending = new Map();
  }
  setExposure(value) {
    if (this.destroyed) return false;
    this.exposed = Boolean(value);
    return true;
  }
  availableSlot(now) { return this.readyAt.findIndex(time => time <= now); }
  canFire(now) { return this.tracked && !this.destroyed && this.ammo > 0 && this.availableSlot(now) !== -1; }
  progress(slot, now) { return Math.max(0, Math.min(1, 1 - (this.readyAt[slot] - now) / this.cooldown)); }
  fire(now) {
    if (!this.canFire(now)) return null;
    const slot = this.availableSlot(now);
    const shot = {id: ++this.sequence, slot, hit: this.exposed};
    this.ammo--;
    this.readyAt[slot] = now + this.cooldown;
    this.pending.set(shot.id, shot);
    return {...shot};
  }
  resolve(id) {
    const shot = this.pending.get(id);
    if (!shot) return null;
    this.pending.delete(id);
    // Two missiles can be in flight toward the same core, but it scores once.
    if (this.destroyed) return null;
    if (!shot.hit) return 'miss';
    this.destroyed = true;
    this.score += 400;
    return 'destroyed';
  }
}
