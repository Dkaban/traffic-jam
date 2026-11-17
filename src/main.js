import { City, BUILDINGS, DIRECTIONS, COLS, ROWS, key } from './world.js';
import { Simulation } from './simulation.js';
import { Renderer } from './render.js';

const SAVE_KEY = 'traffic-jam.city.v1';
const $ = selector => document.querySelector(selector);
const canvas = $('#game-canvas');
const renderer = new Renderer(canvas);
let city;
try {
  const data = localStorage.getItem(SAVE_KEY);
  city = data ? City.fromJSON(JSON.parse(data)) : new City();
} catch { city = new City(); }
const sim = new Simulation(city);
const state = { tool:'road', direction:'e', heatmap:false, hover:null, dragCells:[] };
const undoStack = [];
let painting = false, panning = false, spaceHeld = false, dragBefore = null, lastCell = null;
let lastPoint = null, speed = 1, paused = false, lastFrame = performance.now(), lastStats = 0;
let toastTimer;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(city.serialize())); } catch { /* Storage may be disabled */ } }
function remember(before) { undoStack.push(before); if(undoStack.length>40) undoStack.shift(); save(); }
function undo() {
  const previous = undoStack.pop();
  if(!previous) {toast('Nothing to undo yet');return;}
  city=City.fromJSON(previous);
  sim.reset(city); save(); toast('Last edit undone');
}
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected',b.dataset.tool===tool));
  $('#road-hint').textContent = tool==='road' ? '✎  Click & drag to draw roads'
    : tool==='bulldoze' ? '⌫  Click a tile to remove it'
    : BUILDINGS[tool] ? `✦  ${BUILDINGS[tool].name} · +${BUILDINGS[tool].cars} vehicle${BUILDINGS[tool].cars>1?'s':''}`
    : tool==='oneway' ? `➜  Click a road · R rotates (${state.direction.toUpperCase()})`
    : `✦  Click a road to apply ${tool==='normal'?'no modifier':tool}`;
}
document.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>setTool(btn.dataset.tool)));
const pos = event => {
  const r = canvas.getBoundingClientRect();
  return {x:event.clientX-r.left,y:event.clientY-r.top};
};
function between(a,b) {
  // Interpolate an orthogonal pencil stroke, even during quick mouse movement.
  const cells = [];
  let x=a.x,y=a.y;
  while(x!==b.x){x+=Math.sign(b.x-x);cells.push({x,y});}
  while(y!==b.y){y+=Math.sign(b.y-y);cells.push({x,y});}
  return cells;
}
function drawRoad(p) {
  if (!p || !lastCell) return;
  for(const cell of between(lastCell,p)) {
    if(city.addRoad(cell.x,cell.y)) state.dragCells.push(cell);
  }
  lastCell=p;
}
function commit(action) {
  const before=city.serialize();
  let changed=false;
  if(action==='bulldoze') changed=city.demolish(state.hover.x,state.hover.y);
  else if(BUILDINGS[action]) changed=city.place(action,state.hover.x,state.hover.y);
  else changed=city.setModifier(state.hover.x,state.hover.y,action,state.direction);
  if(changed){
    remember(before);
    if(action==='bulldoze' || !BUILDINGS[action]) sim.networkChanged();
    else sim.syncCars();
  } else if(BUILDINGS[action] && (city.road(state.hover.x,state.hover.y)||city.building(state.hover.x,state.hover.y))) toast('That tile is occupied');
  else if(!BUILDINGS[action] && action!=='bulldoze' && !city.road(state.hover.x,state.hover.y)) toast('Place modifiers on a road');
}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  const p=pos(e);
  lastPoint=p;
  if(e.button===2 || spaceHeld || e.button===1){panning=true;$('#canvas-shell').classList.add('panning');canvas.setPointerCapture(e.pointerId);return;}
  if(e.button!==0) return;
  const tile=renderer.screenToGrid(p.x,p.y);
  state.hover=tile;
  if(!tile) return;
  canvas.setPointerCapture(e.pointerId);
  if(state.tool==='road') {
    dragBefore=city.serialize();
    state.dragCells=[];painting=true;lastCell=tile;
    if(city.addRoad(tile.x,tile.y))state.dragCells.push(tile);
  } else commit(state.tool);
});
canvas.addEventListener('pointermove',e=>{
  const p=pos(e);
  if(panning && lastPoint){
    renderer.camera.x+=p.x-lastPoint.x;
    renderer.camera.y+=p.y-lastPoint.y;
    lastPoint=p;
    return;
  }
  const tile=renderer.screenToGrid(p.x,p.y);
  state.hover=tile;
  if(painting && tile)drawRoad(tile);
  lastPoint=p;
});
function pointerEnd(){
  if(painting){
    painting=false;lastCell=null;state.dragCells=[];
    if(dragBefore && JSON.stringify(dragBefore)!==JSON.stringify(city.serialize())){
      remember(dragBefore);sim.networkChanged();
    }
    dragBefore=null;
  }
  panning=false;lastPoint=null;$('#canvas-shell').classList.remove('panning');
}
canvas.addEventListener('pointerup',pointerEnd);
canvas.addEventListener('pointercancel',pointerEnd);
canvas.addEventListener('pointerleave',()=>{if(!painting&&!panning)state.hover=null;});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const p=pos(e);renderer.zoomAt(p.x,p.y,e.deltaY<0?1.12:1/1.12);
  updateZoom();
},{passive:false});
function updateZoom(){ $('#zoom-label').textContent=`${Math.round(renderer.camera.zoom*100)}%`; }
$('#zoom-in').addEventListener('click',()=>{renderer.zoomAt(renderer.w/2,renderer.h/2,1.2);updateZoom();});
$('#zoom-out').addEventListener('click',()=>{renderer.zoomAt(renderer.w/2,renderer.h/2,1/1.2);updateZoom();});
$('#fit-btn').addEventListener('click',()=>{renderer.fit();updateZoom();});
$('#heat-btn').addEventListener('click',()=>{state.heatmap=!state.heatmap;$('#heat-btn').classList.toggle('on',state.heatmap);toast(state.heatmap?'Traffic heatmap on':'Traffic heatmap off');});
$('#pause-btn').addEventListener('click',()=>{
  paused=!paused;
  $('#pause-btn').innerHTML=paused?'▶ <span>Play</span>':'Ⅱ <span>Pause</span>';
  $('.canvas-badge').classList.toggle('paused',paused);
  $('.canvas-badge span:last-child').textContent=paused?'SIMULATION PAUSED':'SIMULATION RUNNING';
});
document.querySelectorAll('[data-speed]').forEach(btn=>btn.addEventListener('click',()=>{
  speed=Number(btn.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',b===btn));
}));
const help=$('#help-dialog');
$('#help-btn').addEventListener('click',()=>help.showModal());
$('#close-help').addEventListener('click',()=>help.close());
$('#play-btn').addEventListener('click',()=>help.close());
$('#restart-btn').addEventListener('click',()=>{
  if(!window.confirm('Reset to the original starter city? Your current layout will be replaced.')) return;
  remember(city.serialize());
  city=new City();
  sim.reset(city);
  save();
  renderer.fit();
  updateZoom();
  toast('Starter city restored.');
});
$('#reset-btn').addEventListener('click',()=>{
  if(!window.confirm('Start a new empty city? This replaces your saved map.')) return;
  remember(city.serialize());city=new City(false);sim.reset(city);save();renderer.fit();updateZoom();toast('New city! Draw your first road.');
});
$('#grow-btn').addEventListener('click',()=>{
  const candidates=[];
  for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++)if(!city.road(x,y)&&!city.building(x,y)&&city.adjacentRoads(x,y).length){
    // Avoid packing every patch with a building. Plenty of room to breathe.
    const crowded=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>city.building(x+dx,y+dy)).length;
    if(!crowded)candidates.push({x,y});
  }
  if(!candidates.length){toast('No space nearby — draw more roads first!');return;}
  const before=city.serialize();let count=0;
  const types=['house','house','apartment','office','shop'];
  while(candidates.length && count<7){
    const index=Math.floor(Math.random()*candidates.length);
    const p=candidates.splice(index,1)[0];
    if(city.building(p.x,p.y))continue;
    const type=types[Math.floor(Math.random()*types.length)];
    if(city.place(type,p.x,p.y))count++;
    for(let i=candidates.length-1;i>=0;i--)if(Math.abs(candidates[i].x-p.x)+Math.abs(candidates[i].y-p.y)<=1)candidates.splice(i,1);
  }
  if(count){remember(before);sim.syncCars();toast(`${count} buildings added! Prepare for more traffic.`);}
});
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLElement && ['INPUT','TEXTAREA'].includes(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}
  if(e.key===' '){spaceHeld=true;e.preventDefault();return;}
  const mapping={'1':'road','2':'house','3':'apartment','4':'office','5':'shop','6':'signal','7':'stop','8':'express','9':'oneway','0':'roundabout','x':'bulldoze'};
  if(mapping[e.key.toLowerCase()])setTool(mapping[e.key.toLowerCase()]);
  if(e.key.toLowerCase()==='r'){
    const current=DIRECTIONS.findIndex(d=>d.id===state.direction);
    state.direction=DIRECTIONS[(current+1)%4].id;
    const arrows={n:'↑',e:'➜',s:'↓',w:'←'};
    $('.oneway-icon').textContent=arrows[state.direction];
    if(state.tool==='oneway')setTool('oneway');
  }
  if(e.key==='Escape' && !help.open)setTool('road');
});
window.addEventListener('keyup',e=>{if(e.key===' ')spaceHeld=false;});
window.addEventListener('blur',()=>{spaceHeld=false;pointerEnd();});

function updateStats(){
  const s=sim.stats();
  $('#stat-flow').innerHTML=`${s.flow}<span>%</span>`;
  $('#stat-buildings').textContent=s.buildings;
  $('#stat-cars').textContent=s.vehicles;
  $('#stat-queued').textContent=s.queued;
  $('#stat-trips').textContent=s.trips.toLocaleString();
  $('#city-message').textContent=!s.roads?'Start with a road. Click and drag to draw one.'
    :s.buildings<2?'Place a few buildings beside your roads to bring the city to life.'
    :s.queued>=Math.max(4,s.active*.28)?'Rush hour! Try fast lanes or new connections to reduce queues.'
    :s.active<s.vehicles?'Some buildings are disconnected. Connect them to the roads.'
    :s.trips<5?'The city is waking up. Cars are finding their way around.'
    :`${s.trips.toLocaleString()} completed trips. Keep your city flowing!`;
}
function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
  if(!paused){for(let i=0;i<speed;i++)sim.update(dt);}
  renderer.draw(city,sim,state);
  if(now-lastStats>250){updateStats();lastStats=now;}
  requestAnimationFrame(frame);
}
new ResizeObserver(()=>{renderer.resize();updateZoom();}).observe($('#canvas-shell'));
setTool('road');updateZoom();updateStats();requestAnimationFrame(frame);
