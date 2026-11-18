import test from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/world.js';
import { Simulation } from '../src/simulation.js';

test('starter city has connected roads, residents and destinations', () => {
  const city = new City();
  assert.ok(city.roadCount() > 70);
  assert.ok(city.buildingCount() > 10);
  assert.ok(city.cityStats().population > 0);
  assert.ok(city.cityStats().jobs > 0);
  assert.ok([...city.buildings.values()].every(building => city.connected(building)));
});

test('roads route between connections, and one-ways constrain pathfinding', () => {
  const city = new City(false);
  for (let x = 1; x <= 4; x++) city.addRoad(x, 1);
  assert.equal(city.findRoute(city.road(1, 1), city.road(4, 1)).length, 4);
  city.setModifier(2, 1, 'oneway', 'w');
  assert.equal(city.findRoute(city.road(1, 1), city.road(4, 1)), null);
  assert.ok(city.findRoute(city.road(4, 1), city.road(1, 1)));
});

test('a legacy city save preserves roads, buildings and modifiers', () => {
  const city = new City();
  city.setModifier(8, 7, 'oneway', 'n');
  const { roads, buildings, nextId } = JSON.parse(JSON.stringify(city.serialize()));
  const loaded = City.fromJSON({ roads, buildings, nextId });
  assert.equal(loaded.road(8, 7).direction, 'n');
  assert.equal(loaded.buildingCount(), city.buildingCount());
  assert.equal(loaded.cityStats().population, city.cityStats().population);
  assert.equal(loaded.cityStats().used, 0);
  assert.equal(loaded.zones.size, 0);
});

test('snapshots keep the prior modifier when a road is edited', () => {
  const city = new City(false);
  city.addRoad(4, 4);
  const before = city.serialize();
  city.setModifier(4, 4, 'stop');
  assert.equal(City.fromJSON(before).road(4, 4).modifier, 'none');
});

test('traffic needs a developed home and a reachable destination', () => {
  const city = new City(false);
  for (let x = 4; x <= 7; x++) city.addRoad(x, 4);
  city.place('apartment', 4, 5);
  city.place('shop', 7, 5);
  city.setModifier(5, 4, 'oneway', 'w');
  const sim = new Simulation(city);
  for (let i = 0; i < 160; i++) sim.update(.05);
  assert.equal(sim.cars.length, 0);
  assert.equal(sim.completed, 0);

  city.setModifier(5, 4, 'stop');
  sim.networkChanged();
  let stopped = false;
  for (let i = 0; i < 320; i++) {
    sim.update(.05);
    stopped ||= sim.cars.some(car => car.stopCountdown > 0 && car.wait);
  }
  assert.ok(stopped, 'cars should stop for the sign');
  assert.ok(sim.completed > 0, 'cars should complete trips');
  assert.ok(sim.cars.every(car => car.home.type === 'apartment' && car.destination.type === 'shop'));

  city.demolish(7, 5);
  sim.networkChanged();
  assert.equal(sim.cars.length, 0);
  const trips = sim.completed;
  for (let i = 0; i < 160; i++) sim.update(.05);
  assert.equal(sim.cars.length, 0);
  assert.equal(sim.completed, trips);
});
