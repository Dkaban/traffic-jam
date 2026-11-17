import test from 'node:test';
import assert from 'node:assert/strict';
import { City, BUILDINGS } from '../src/world.js';
import { Simulation } from '../src/simulation.js';

test('starter city has connected roads and destinations', () => {
  const city = new City();
  assert.ok(city.roadCount() > 70);
  assert.ok(city.buildingCount() > 10);
  assert.equal(city.demand(), [...city.buildings.values()].reduce((n,b)=>n+BUILDINGS[b.type].cars,0));
  assert.ok([...city.buildings.values()].every(b=>city.connected(b)));
});
test('roads route between connections, and one-ways constrain pathfinding', () => {
  const city = new City(false);
  for (let x=1;x<=4;x++) city.addRoad(x,1);
  assert.equal(city.findRoute(city.road(1,1),city.road(4,1)).length,4);
  city.setModifier(2,1,'oneway','w');
  assert.equal(city.findRoute(city.road(1,1),city.road(4,1)),null);
  assert.ok(city.findRoute(city.road(4,1),city.road(1,1)));
});
test('building placement creates vehicle demand, and demolition removes it', () => {
  const city=new City(false);
  city.addRoad(4,4);city.addRoad(5,4);city.addRoad(6,4);city.addRoad(7,4);
  assert.ok(city.place('apartment',4,5));assert.ok(city.place('shop',7,5));
  const sim=new Simulation(city);
  assert.equal(sim.cars.length,7);
  for(let i=0;i<1200;i++)sim.update(.05);
  assert.ok(sim.completed>0, 'cars should complete trips on a connected network');
  assert.ok(sim.cars.every(c=>!c.path.length || c.path.every(r=>city.road(r.x,r.y))));
  city.demolish(4,5);sim.networkChanged();
  assert.equal(sim.cars.length,2);
});
test('saved cities preserve roads, buildings and modifiers',()=>{
  const city=new City();const chosen=city.road(8,7);
  city.setModifier(chosen.x,chosen.y,'oneway','n');
  const loaded=City.fromJSON(city.serialize());
  assert.equal(loaded.road(8,7).direction,'n');
  assert.equal(loaded.buildingCount(),city.buildingCount());
});
