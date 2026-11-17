import { BUILDINGS, COLS, ROWS, TILE, key, inside } from './world.js';

const hash = (x,y) => {
  let a = (x * 374761393 + y * 668265263) | 0;
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967295;
};
const roundRect = (ctx, x,y,w,h,r,fill,stroke) => {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r);
  if (fill) {ctx.fillStyle=fill;ctx.fill();}
  if (stroke) {ctx.strokeStyle=stroke;ctx.stroke();}
};
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x:0, y:0, zoom:1 };
    this.w = 0; this.h = 0; this.initialized = false;
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.w = rect.width; this.h = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    if (!this.initialized) {this.fit(); this.initialized=true;}
  }
  fit() {
    const zoom = Math.min(this.w/(COLS*TILE + 100), this.h/(ROWS*TILE + 90), 1.18);
    this.camera.zoom = Math.max(.45, zoom);
    this.camera.x = (this.w - COLS*TILE*this.camera.zoom)/2;
    this.camera.y = (this.h - ROWS*TILE*this.camera.zoom)/2;
  }
  screenToGrid(px,py) {
    const x = Math.floor((px-this.camera.x)/this.camera.zoom/TILE);
    const y = Math.floor((py-this.camera.y)/this.camera.zoom/TILE);
    return inside(x,y) ? {x,y} : null;
  }
  zoomAt(px,py,delta) {
    const old = this.camera.zoom;
    const next = Math.max(.43,Math.min(2.6, old*delta));
    this.camera.x = px - ((px-this.camera.x)/old)*next;
    this.camera.y = py - ((py-this.camera.y)/old)*next;
    this.camera.zoom=next;
  }
  draw(city, sim, state) {
    const c=this.ctx, d=this.dpr;
    c.setTransform(d,0,0,d,0,0);
    c.clearRect(0,0,this.w,this.h);
    c.fillStyle='#152628';c.fillRect(0,0,this.w,this.h);
    c.save();
    c.translate(this.camera.x,this.camera.y);
    c.scale(this.camera.zoom,this.camera.zoom);
    this.ground();
    this.roads(city);
    if (state.heatmap) this.heatmap(sim);
    this.buildings(city,sim);
    this.cars(sim);
    this.preview(city,state);
    c.restore();
  }
  ground() {
    const c=this.ctx, S=TILE;
    c.fillStyle='#294d43';c.fillRect(0,0,COLS*S,ROWS*S);
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
      const h=hash(x,y), xx=x*S, yy=y*S;
      c.fillStyle=h>.64?'#30584a':h>.32?'#2c5246':'#2a4e43';
      c.fillRect(xx+.5,yy+.5,S-1,S-1);
      if(h>.75){
        c.fillStyle='rgba(15,54,41,.31)'; c.beginPath();c.arc(xx+12,yy+20,4+h*4,0,Math.PI*2);c.fill();
        c.fillStyle='#487b5d';c.beginPath();c.arc(xx+13,yy+14,4+h*3,0,Math.PI*2);c.fill();
        c.fillStyle='#5a8d67';c.beginPath();c.arc(xx+16,yy+12,2.2,0,Math.PI*2);c.fill();
      } else if(h<.13){
        c.fillStyle='rgba(147,200,126,.19)';c.fillRect(xx+7,yy+22,2,2);c.fillRect(xx+18,yy+10,2,2);
      }
    }
    c.strokeStyle='rgba(226,255,224,.055)';c.lineWidth=.7;
    for(let i=0;i<=COLS;i++){c.beginPath();c.moveTo(i*S,0);c.lineTo(i*S,ROWS*S);c.stroke();}
    for(let i=0;i<=ROWS;i++){c.beginPath();c.moveTo(0,i*S);c.lineTo(COLS*S,i*S);c.stroke();}
    c.strokeStyle='#87b393';c.lineWidth=2;c.strokeRect(0,0,COLS*S,ROWS*S);
  }
  roads(city) {
    const c=this.ctx,S=TILE;
    for (const r of city.roads.values()) {
      const x=r.x*S,y=r.y*S;
      c.fillStyle='#809087';c.fillRect(x,y,S,S);
      c.fillStyle='#273139';c.fillRect(x+2,y+2,S-4,S-4);
      for (const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) if(city.road(r.x+dx,r.y+dy)){
        c.fillStyle='#29353d';
        if(dx===1) c.fillRect(x+S-3,y+3,4,S-6);
        if(dx===-1) c.fillRect(x-1,y+3,4,S-6);
        if(dy===1) c.fillRect(x+3,y+S-3,S-6,4);
        if(dy===-1) c.fillRect(x+3,y-1,S-6,4);
      }
    }
    for (const r of city.roads.values()) {
      const {x,y}=r, xx=x*S,yy=y*S;
      const n=!!city.road(x,y-1),s=!!city.road(x,y+1),e=!!city.road(x+1,y),w=!!city.road(x-1,y);
      const horiz=e||w,vert=n||s;
      c.strokeStyle='rgba(236,207,122,.58)'; c.lineWidth=1.2;c.setLineDash([7,5]);
      if(horiz&&!vert){c.beginPath();c.moveTo(xx+3, yy+S/2);c.lineTo(xx+S-3,yy+S/2);c.stroke();}
      else if(vert&&!horiz){c.beginPath();c.moveTo(xx+S/2,yy+3);c.lineTo(xx+S/2,yy+S-3);c.stroke();}
      c.setLineDash([]);
      if(horiz&&vert){
        c.fillStyle='rgba(255,255,255,.15)';
        if(n){for(let j=0;j<3;j++) c.fillRect(xx+6+j*7,yy+3,4,2);}
        if(s){for(let j=0;j<3;j++) c.fillRect(xx+6+j*7,yy+S-5,4,2);}
        if(w){for(let j=0;j<3;j++) c.fillRect(xx+3,yy+6+j*7,2,4);}
        if(e){for(let j=0;j<3;j++) c.fillRect(xx+S-5,yy+6+j*7,2,4);}
      }
      if(r.modifier!=='none') this.roadModifier(r);
    }
  }
  roadModifier(r) {
    const c=this.ctx,x=r.x*TILE+16,y=r.y*TILE+16;
    c.save();c.lineWidth=1.8;
    if(r.modifier==='signal'){
      roundRect(c,x-4,y-9,8,18,3,'#151e23','#d3dad9');
      c.fillStyle='#ef6e65';c.beginPath();c.arc(x,y-4.8,2.3,0,Math.PI*2);c.fill();
      c.fillStyle='#ebc56c';c.beginPath();c.arc(x,y,2.3,0,Math.PI*2);c.fill();
      c.fillStyle='#7dd6a3';c.beginPath();c.arc(x,y+4.8,2.3,0,Math.PI*2);c.fill();
    }else if(r.modifier==='stop'){
      c.fillStyle='#dc685d';c.beginPath();for(let i=0;i<8;i++){let a=Math.PI/8+i*Math.PI/4;let px=x+8*Math.cos(a),py=y+8*Math.sin(a);i?c.lineTo(px,py):c.moveTo(px,py);}c.closePath();c.fill();
      c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.font='bold 8px system-ui';c.fillText('STOP',x,y+.5);
    }else if(r.modifier==='express'){
      roundRect(c,x-11,y-7,22,14,4,'#317a9e');c.fillStyle='#e9faff';c.font='bold 12px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText('»',x,y-1);
    }else if(r.modifier==='oneway'){
      const angles={e:0,s:Math.PI/2,w:Math.PI,n:-Math.PI/2};
      c.translate(x,y);c.rotate(angles[r.direction]||0);
      roundRect(c,-10,-8,20,16,4,'#7f72bd');c.strokeStyle='#fff';c.lineWidth=2.5;c.beginPath();c.moveTo(-5,0);c.lineTo(5,0);c.moveTo(1,-4);c.lineTo(5,0);c.lineTo(1,4);c.stroke();
    }else if(r.modifier==='roundabout'){
      c.fillStyle='#3b9587';c.beginPath();c.arc(x,y,11,0,Math.PI*2);c.fill();
      c.strokeStyle='#e4fff5';c.lineWidth=1.6;c.beginPath();c.arc(x,y,7,Math.PI*.2,Math.PI*1.72);c.stroke();
      c.fillStyle='#e4fff5';c.beginPath();c.moveTo(x+5,y-7);c.lineTo(x+11,y-7);c.lineTo(x+8,y-2);c.fill();
    }
    c.restore();
  }
  heatmap(sim) {
    const c=this.ctx,S=TILE;
    for (const [k,count] of sim.occupancy) {
      if(count<1) continue;
      const [x,y] = k.split(',').map(Number);
      c.fillStyle=count>2?'rgba(252,91,81,.5)':count===2?'rgba(247,165,72,.32)':'rgba(242,212,107,.1)';
      c.fillRect(x*S+2,y*S+2,S-4,S-4);
    }
  }
  buildings(city) {
    const c=this.ctx,S=TILE;
    for(const b of city.buildings.values()) {
      const x=b.x*S,y=b.y*S, connected=city.connected(b);
      c.fillStyle='#43624d';c.fillRect(x+1.5,y+1.5,S-3,S-3);
      c.fillStyle='rgba(12,31,30,.38)';roundRect(c,x+6,y+7,24,23,4,'rgba(12,31,30,.38)');
      if(b.type==='house'){
        roundRect(c,x+5,y+7,21,20,2,'#f1d5b0','#b38c73');
        c.fillStyle='#ba7660';c.beginPath();c.moveTo(x+3,y+13);c.lineTo(x+16,y+3);c.lineTo(x+29,y+13);c.closePath();c.fill();
        c.fillStyle='#d89376';c.beginPath();c.moveTo(x+7,y+14);c.lineTo(x+16,y+6);c.lineTo(x+25,y+14);c.closePath();c.fill();
        c.fillStyle='#fff1d5';c.fillRect(x+10,y+17,5,5);c.fillRect(x+19,y+17,4,5);
        c.fillStyle='#ab7050';c.fillRect(x+15,y+22,5,5);
      } else if(b.type==='apartment'){
        roundRect(c,x+4,y+4,24,25,3,'#8296b1','#b6c6d2');
        c.fillStyle='#aabbd5';c.fillRect(x+5,y+5,22,6);
        c.fillStyle='#e1ecfa';for(let i=0;i<3;i++)for(let j=0;j<3;j++)c.fillRect(x+7+j*7,y+13+i*5,4,3);
        c.fillStyle='#7189a5';roundRect(c,x+11,y+6,11,5,1,'#7189a5');
      }else if(b.type==='office'){
        roundRect(c,x+4,y+5,24,23,2,'#4a7983','#94d9d5');
        c.fillStyle='#94c9d0';for(let i=0;i<4;i++)c.fillRect(x+7+i*5,y+8,3,17);
        c.fillStyle='#c5eaeb';c.fillRect(x+8,y+8,11,3);
      }else if(b.type==='shop'){
        roundRect(c,x+4,y+6,24,22,2,'#e4b96d','#f5dca1');
        c.fillStyle='#6e9b98';c.fillRect(x+7,y+17,18,9);
        for(let i=0;i<5;i++) {c.fillStyle=i%2?'#e8f1e7':'#c46f5d';c.fillRect(x+5+i*4.5,y+10,4.5,7);}
        c.fillStyle='#ffedb0';c.fillRect(x+10,y+20,8,6);
      }
      if(!connected){
        c.fillStyle='#f2bc6c';c.beginPath();c.arc(x+27,y+5,6,0,Math.PI*2);c.fill();
        c.font='bold 10px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#3d2924';c.fillText('!',x+27,y+5);
      }
    }
  }
  cars(sim) {
    const c=this.ctx,S=TILE;
    for(const car of sim.cars){
      const p=sim.position(car);if(!p)continue;
      const angle=p.angle ?? car.facing;
      const lane=3.4;
      const x=(p.x+.5)*S + -Math.sin(angle)*lane;
      const y=(p.y+.5)*S + Math.cos(angle)*lane;
      c.save();c.translate(x,y);c.rotate(angle);
      c.fillStyle='rgba(8,18,25,.4)';roundRect(c,-7+1.3,-4+1.8,15,8,2,'rgba(8,18,25,.4)');
      roundRect(c,-7.5,-4.4,15,8.8,2.8,car.color);
      c.fillStyle='rgba(24,54,67,.82)';roundRect(c,-1.8,-3.1,5.5,6.2,1,'rgba(24,54,67,.82)');
      c.fillStyle='#fff1cc';c.fillRect(6,-3,1.6,1.6);c.fillRect(6,1.8,1.6,1.6);
      c.fillStyle='#f27c72';c.fillRect(-7.5,-3,1.2,1.6);c.fillRect(-7.5,1.8,1.2,1.6);
      if(car.wait){c.fillStyle='rgba(249,102,87,.6)';c.fillRect(-9,-4,1.6,8);}
      c.restore();
    }
  }
  preview(city,state) {
    const c=this.ctx,S=TILE;
    const point=state.hover;
    if (!point) return;
    const cells=state.tool==='road' && state.dragCells.length ? state.dragCells : [point];
    for(const p of cells){
      const occupied = !!city.road(p.x,p.y)||!!city.building(p.x,p.y);
      const isRoad = state.tool==='road';
      let valid = isRoad?!city.building(p.x,p.y) : state.tool==='bulldoze'?occupied : ['signal','stop','express','oneway','roundabout','normal'].includes(state.tool)?!!city.road(p.x,p.y):!occupied;
      c.fillStyle=valid?(isRoad?'rgba(104,210,197,.4)':'rgba(142,239,194,.32)'):'rgba(245,108,93,.25)';
      c.fillRect(p.x*S+1,p.y*S+1,S-2,S-2);
      c.strokeStyle=valid?'#adf3d8':'#f98f87';c.lineWidth=1.7;c.strokeRect(p.x*S+2,p.y*S+2,S-4,S-4);
      if(!isRoad && valid && BUILDINGS[state.tool]){
        c.fillStyle=BUILDINGS[state.tool].color;c.beginPath();c.arc((p.x+.5)*S,(p.y+.5)*S,5.5,0,Math.PI*2);c.fill();
      }
    }
  }
}
