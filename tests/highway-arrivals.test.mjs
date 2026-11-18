import test from 'node:test';
import assert from 'node:assert/strict';
import { City, COLS, ROWS } from '../src/world.js';
import { Simulation } from '../src/simulation.js';

function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.update(.05);
}
function waitFor(sim, condition) {
  for (let i = 0; i < 1200 && !condition(); i++) sim.update(.05);
  assert.ok(condition(), 'condition should be reached within 60 simulation seconds');
}
function neighborhood() {
  const city = new City(false);
  city.addRoad(6, 7);
  city.addRoad(7, 7);
  city.place('power', 6, 5);
  city.place('water', 7, 5);
  city.paintZone('residential', 7, 8);
  return city;
}

test('the highway has an immutable edge route and one local junction', () => {
  const empty = new City(false);
  const entry = empty.highwayEntry();
  const junction = empty.highwayJunction();
  assert.deepEqual([entry.x, entry.y], [0, 7]);
  assert.deepEqual([junction.x, junction.y], [4, 7]);
  assert.equal(empty.findRoute(entry, junction).length, 5);
  assert.equal(empty.setModifier(4, 7, 'stop'), false);
  assert.equal(empty.demolish(4, 7), false);
  empty.addRoad(2, 8);
  assert.equal(empty.findRoute(entry, empty.road(2, 8)), null);
  empty.addRoad(5, 7);
  assert.ok(empty.findRoute(entry, empty.road(5, 7)));

  const starter = new City();
  assert.ok(starter.findRoute(starter.highwayEntry(), starter.road(5, 7)));
  assert.equal(starter.cityStats().population, 68);
});

test('a house waits without a legal route and earns its residents once when a van arrives', () => {
  const city = neighborhood();
  const sim = new Simulation(city);
  advance(sim, 4);
  const home = city.building(7, 8);
  assert.equal(home.awaitingResidents, true);
  assert.equal(city.cityStats().population, 0);
  assert.deepEqual(sim.arrivalStatus(), { waiting: 1, ready: 0, inTransit: 0 });
  assert.equal(sim.cars.length, 0);

  city.addRoad(5, 7);
  city.setModifier(5, 7, 'oneway', 'w');
  sim.networkChanged();
  advance(sim, 2);
  assert.deepEqual(sim.arrivalStatus(), { waiting: 1, ready: 0, inTransit: 0 });
  assert.equal(sim.cars.length, 0);

  city.setModifier(5, 7, 'oneway', 'e');
  sim.networkChanged();
  assert.deepEqual(sim.arrivalStatus(), { waiting: 0, ready: 1, inTransit: 0 });
  waitFor(sim, () => sim.cars.some(car => car.arrival));
  const van = sim.cars.find(car => car.arrival);
  assert.deepEqual([van.path[0].x, van.path[0].y], [-.5, 7]);
  assert.equal(van.path[1], city.highwayEntry());
  assert.equal(van.path.at(-1), city.road(7, 7));
  assert.ok(van.path.slice(2).every((road, index) => city.neighbors(van.path[index + 1]).includes(road)));
  assert.equal(city.cityStats().population, 0);
  assert.deepEqual(sim.arrivalStatus(), { waiting: 0, ready: 0, inTransit: 1 });

  waitFor(sim, () => city.cityStats().population === 4);
  assert.equal(city.building(7, 8).awaitingResidents, undefined);
  assert.equal(city.moveIn(home), false);
  assert.equal(sim.cars.length, 0);
  advance(sim, 12);
  assert.equal(city.cityStats().population, 4);
  assert.equal(sim.completed, 1);
});

test('an interrupted arrival retries and a save cannot credit the same house twice', () => {
  const city = neighborhood();
  city.addRoad(5, 7);
  const sim = new Simulation(city);
  waitFor(sim, () => sim.cars.some(car => car.arrival));
  city.demolish(5, 7);
  sim.networkChanged();
  assert.equal(sim.cars.length, 0);
  assert.equal(city.cityStats().population, 0);
  assert.equal(sim.arrivalStatus().waiting, 1);
  city.addRoad(5, 7);
  sim.networkChanged();
  waitFor(sim, () => sim.cars.some(car => car.arrival));

  const load = model => City.fromJSON(JSON.parse(JSON.stringify(model.serialize())));
  const reloaded = load(city);
  assert.equal(reloaded.cityStats().population, 0);
  const resumed = new Simulation(reloaded);
  waitFor(resumed, () => reloaded.cityStats().population === 4);
  assert.equal(resumed.completed, 1);

  const final = load(reloaded);
  const restarted = new Simulation(final);
  advance(restarted, 20);
  assert.equal(final.cityStats().population, 4);
  assert.equal(restarted.completed, 0);
});

test('legacy roads, buildings and zones survive a gateway location conflict', () => {
  const legacy = {
    roads: [{ x: 1, y: 7, modifier: 'stop', direction: 's' }],
    buildings: [{ id: 1, type: 'house', x: 0, y: 7 }],
    zones: [{ x: 2, y: 7, type: 'commercial' }],
    nextId: 2,
  };
  const city = City.fromJSON(legacy);
  assert.equal(city.cityStats().population, 4);
  assert.equal(city.highwayEntry().x, 0);
  assert.notEqual(city.highwayEntry().y, 7);
  const { roads, buildings, zones } = city.serialize();
  assert.deepEqual({ roads, buildings, zones }, {
    roads: legacy.roads, buildings: legacy.buildings, zones: legacy.zones,
  });
  assert.deepEqual(City.fromJSON(city.serialize()).serialize(), city.serialize());
});

test('a crowded legacy map can free one edge tile for a highway without losing existing roads', () => {
  const roads = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!x || x === COLS - 1 || !y || y === ROWS - 1) roads.push({x,y,modifier:'none',direction:'e'});
    }
  }
  roads.push({x:1,y:7,modifier:'stop',direction:'e'});
  const city = City.fromJSON({ roads, buildings: [] });
  assert.equal(city.highwayEntry(), null);
  assert.equal(city.roadCount(), roads.length);
  assert.ok(city.demolish(0, 7));
  assert.equal(city.highwayEntry(), city.highwayJunction());
  assert.equal(city.roadCount(), roads.length - 1);
});
