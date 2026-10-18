// Recognition will provide exposed=true/false through setExposure later.
export class Mission {
  constructor(){this.reset();}
  reset(){this.ammo=8;this.score=0;this.exposed=true;this.destroyed=false;this.pending=null;this.sequence=(this.sequence||0)+1;}
  setExposure(value){if(this.pending||this.destroyed)return false;this.exposed=Boolean(value);return true;}
  fire(){if(this.pending||this.destroyed||this.ammo===0)return null;this.ammo--;this.pending={id:++this.sequence,hit:this.exposed};return {...this.pending};}
  resolve(id){if(!this.pending||this.pending.id!==id)return null;const hit=this.pending.hit;this.pending=null;if(hit){this.destroyed=true;this.score+=400;}return hit?'destroyed':'miss';}
}
