import { City, BUILDINGS, DIRECTIONS, UTILITY_BITS, ZONES } from './world.js';
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
const state = { tool:'road', direction:'e', heatmap:false, utility:null, hover:null, dragCells:[] };
const undoStack = [];
let painting = null, panning = false, spaceHeld = false, dragBefore = null, lastCell = null;
let lastPoint = null, speed = 1, paused = false, lastFrame = performance.now(), lastStats = 0;
let toastTimer;
let utilityPlacement = null;
const utilityLegend = $('#utility-legend');
const utilityBalance = $('#utility-balance');
const utilityToggles = document.querySelectorAll('[data-utility]');

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
  cancelUtilityPlacement();
  const previous = undoStack.pop();
  if(!previous) {toast('Nothing to undo yet');return;}
  city=City.fromJSON(previous);
  sim.reset(city); save(); toast('Last edit undone');
}
function updateUtilityStats() {
  const { served } = city.utilityCoverage();
  const total = city.buildingCount();
  for (const service of Object.keys(UTILITY_BITS)) {
    const output = $(`#stat-${service}`);
    const count = `${served[service]} / ${total}`;
    if (output.textContent !== count) output.textContent = count;
  }
  if (!state.utility) return;
  const service = state.utility;
  const label = `${BUILDINGS[service].service} · ${served[service]} of ${total} buildings served`;
  if (utilityBalance.textContent !== label) utilityBalance.textContent = label;
}
function showUtility(service) {
  state.utility = service;
  utilityLegend.hidden = !service;
  utilityLegend.dataset.service = service ?? '';
  utilityToggles.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.utility === service)));
  if (service) updateUtilityStats();
}
utilityToggles.forEach(button => button.addEventListener('click', () => {
  const service = button.dataset.utility;
  showUtility(state.utility === service ? null : service);
}));
function setTool(tool) {
  if (tool !== state.tool) cancelUtilityPlacement();
  state.tool = tool;
  if (BUILDINGS[tool]?.service) showUtility(tool);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected',b.dataset.tool===tool));
  $('#rotate-btn').hidden = tool !== 'oneway';
  $('#road-hint').textContent = tool==='road' ? '✎  Click & drag to draw roads'
    : tool==='bulldoze' ? '⌫  Select a tile to remove it'
    : ZONES[tool] ? `Paint ${ZONES[tool].name.toLowerCase()} zones beside roads`
    : BUILDINGS[tool]?.service ? 'Drag to preview coverage · Release to place'
    : tool==='oneway' ? `➜  Select a road · Direction: ${state.direction.toUpperCase()}`
    : 'Select a road to apply the tool';
}
const trafficToggle = $('#traffic-toggle');
const trafficTools = $('#traffic-tools');
function setTrafficPanel(open) {
  trafficToggle.setAttribute('aria-expanded', String(open));
  trafficTools.classList.toggle('tools-open', open);
}
trafficToggle.addEventListener('click', () => setTrafficPanel(trafficToggle.getAttribute('aria-expanded') !== 'true'));
document.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>{
  setTool(btn.dataset.tool);
  setTrafficPanel(false);
}));
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
function paint(tile) {
  const changed = painting === 'road' ? city.addRoad(tile.x, tile.y) : city.paintZone(painting, tile.x, tile.y);
  if (changed) state.dragCells.push(tile);
}
function stroke(p) {
  for(const cell of between(lastCell,p)) {
    paint(cell);
  }
  lastCell=p;
}
function commit(action) {
  const before=city.serialize();
  const { x, y } = state.hover;
  let changed=false;
  if(action==='bulldoze') changed=city.demolish(x,y);
  else if(BUILDINGS[action]?.service) {
    if (city.zone(x,y) || city.road(x,y) || city.building(x,y)) { toast('That tile is occupied'); return; }
    changed=city.place(action,x,y);
    if (changed) showUtility(action);
  } else {
    if (!city.road(x,y)) { toast('Place modifiers on a road'); return; }
    changed=city.setModifier(x,y,action==='normal'?'none':action,state.direction);
  }
  if(changed){
    remember(before);
    if (!BUILDINGS[action]?.service) sim.networkChanged();
    updateStats();
  }
}
function utilityTile({ x, y }) {
  return x >= 0 && x < renderer.w && y >= 0 && y < renderer.h
    ? renderer.screenToGrid(x,y) : null;
}
function cancelUtilityPlacement() {
  if (!utilityPlacement) return;
  const { pointerId } = utilityPlacement;
  utilityPlacement = null;
  state.hover = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if (utilityPlacement || e.isPrimary === false) return;
  const p=pos(e);
  lastPoint=p;
  if(e.button===2 || spaceHeld || e.button===1){
    panning=true;
    state.hover=null;
    $('#canvas-shell').classList.add('panning');
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if(e.button!==0) return;
  const tile=renderer.screenToGrid(p.x,p.y);
  state.hover=tile;
  if (BUILDINGS[state.tool]?.service) {
    utilityPlacement = { pointerId:e.pointerId, tool:state.tool };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if(!tile) return;
  canvas.setPointerCapture(e.pointerId);
  if(state.tool==='road' || ZONES[state.tool]) {
    dragBefore=city.serialize();
    state.dragCells=[];painting=state.tool;lastCell=tile;
    paint(tile);
  } else commit(state.tool);
});
canvas.addEventListener('pointermove',e=>{
  const p=pos(e);
  if (utilityPlacement) {
    if (utilityPlacement.pointerId === e.pointerId) state.hover = utilityTile(p);
    return;
  }
  if (e.isPrimary === false) return;
  if(panning && lastPoint){
    renderer.camera.x+=p.x-lastPoint.x;
    renderer.camera.y+=p.y-lastPoint.y;
    lastPoint=p;
    return;
  }
  const tile=renderer.screenToGrid(p.x,p.y);
  state.hover=tile;
  if(painting && tile)stroke(tile);
  lastPoint=p;
});
function pointerEnd(event){
  if (utilityPlacement) {
    if (event && utilityPlacement.pointerId !== event.pointerId) return;
    const { tool } = utilityPlacement;
    const tile = event?.type === 'pointerup' ? utilityTile(pos(event)) : null;
    cancelUtilityPlacement();
    if (tile) {
      state.hover = tile;
      commit(tool);
      if (event.pointerType !== 'mouse') state.hover = null;
    }
    return;
  }
  if (event?.isPrimary === false) return;
  if(painting){
    if (event?.type === 'pointerup') {
      const p = pos(event);
      const tile = renderer.screenToGrid(p.x,p.y);
      if (tile) stroke(tile);
    }
    if(state.dragCells.length){
      remember(dragBefore);
      if (painting === 'road') sim.networkChanged();
      updateStats();
    }
    painting=null;lastCell=null;state.dragCells=[];
    dragBefore=null;
  }
  panning=false;lastPoint=null;$('#canvas-shell').classList.remove('panning');
}
canvas.addEventListener('pointerup',pointerEnd);
canvas.addEventListener('pointercancel',pointerEnd);
canvas.addEventListener('lostpointercapture',e=>{
  if (utilityPlacement?.pointerId === e.pointerId) cancelUtilityPlacement();
});
canvas.addEventListener('pointerleave',()=>{if(!painting&&!panning&&!utilityPlacement)state.hover=null;});
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
  cancelUtilityPlacement();
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
  cancelUtilityPlacement();
  remember(city.serialize());city=new City(false);sim.reset(city);save();renderer.fit();updateZoom();toast('New city! Draw your first road.');
});
function rotateOneWay() {
  const current=DIRECTIONS.findIndex(d=>d.id===state.direction);
  state.direction=DIRECTIONS[(current+1)%4].id;
  const arrows={n:'↑',e:'➜',s:'↓',w:'←'};
  $('.oneway-icon').textContent=arrows[state.direction];
  $('#rotate-btn').textContent=`Rotate one-way · ${state.direction.toUpperCase()}`;
  if(state.tool==='oneway')setTool('oneway');
}
$('#rotate-btn').addEventListener('click', rotateOneWay);
window.addEventListener('keydown',e=>{
  if(help.open || e.target instanceof HTMLElement && ['INPUT','TEXTAREA'].includes(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}
  if(e.key===' ' && !(e.target instanceof HTMLButtonElement && e.target.matches(':focus-visible'))){
    spaceHeld=true;e.preventDefault();return;
  }
  const mapping={'1':'road','2':'residential','3':'commercial','4':'industrial','5':'power','w':'water','6':'signal','7':'stop','8':'express','9':'oneway','0':'roundabout','x':'bulldoze'};
  if(mapping[e.key.toLowerCase()])setTool(mapping[e.key.toLowerCase()]);
  if(e.key.toLowerCase()==='r')rotateOneWay();
  if(e.key==='Escape' && !help.open)setTool('road');
});
window.addEventListener('keyup',e=>{if(e.key===' ')spaceHeld=false;});
window.addEventListener('blur',()=>{spaceHeld=false;pointerEnd();});

function updateStats(){
  const s=sim.stats();
  const cityStats=city.cityStats();
  const development=city.nextDevelopment(cityStats);
  $('#stat-flow').innerHTML=`${s.flow}<span>%</span>`;
  $('#stat-population').textContent=cityStats.population.toLocaleString();
  $('#stat-cars').textContent=s.vehicles;
  $('#stat-queued').textContent=s.queued;
  $('#stat-trips').textContent=s.trips.toLocaleString();
  for (const type of Object.keys(ZONES)) {
    const output=$(`#demand-${type}`);
    output.textContent=cityStats.demand[type];
    output.parentElement.classList.toggle('no-demand', !cityStats.demand[type]);
  }
  updateUtilityStats();
  $('#city-message').textContent = development.blocked ||
    (!s.roads ? 'Draw a road to start your city.'
      : development.zone ? `${ZONES[development.zone.type].name} development is ready.`
      : !cityStats.population ? 'Zone residential land beside a road.'
      : s.queued >= Math.max(4,s.active*.28) ? 'Traffic is backing up. Try a faster route or a new connection.'
      : 'Zone more land where there’s demand.');
}
function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
  if(!paused && !painting){for(let i=0;i<speed;i++)if(sim.update(dt))save();}
  renderer.draw(city,sim,state);
  if(now-lastStats>250){updateStats();lastStats=now;}
  requestAnimationFrame(frame);
}
new ResizeObserver(()=>{renderer.resize();updateZoom();}).observe($('#canvas-shell'));
setTool('road');updateZoom();updateStats();requestAnimationFrame(frame);
