import test from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/world.js';
import { Simulation } from '../src/simulation.js';

function neighborhood() {
  const city = new City(false);
  for (let x = 4; x <= 13; x++) city.addRoad(x, 4);
  assert.ok(city.paintZone('commercial', 7, 5));
  assert.ok(city.paintZone('industrial', 9, 5));
  assert.ok(city.paintZone('residential', 4, 5));
  assert.ok(city.paintZone('residential', 4, 8));
  return city;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.update(.05);
}

test('zoning waits for the simulation clock, demand and an adjacent road', () => {
  const city = neighborhood();
  const sim = new Simulation(city);
  assert.deepEqual(city.cityStats().demand, { residential: 1, commercial: 0, industrial: 0 });
  assert.equal(city.buildingCount(), 0);
  advance(sim, 2);
  assert.equal(city.buildingCount(), 0);
  advance(sim, 2);
  assert.equal(city.building(4, 5)?.type, 'house');
  assert.equal(city.buildingCount(), 1);
  assert.equal(sim.cars.length, 0);
  assert.deepEqual(city.cityStats().demand, { residential: 0, commercial: 1, industrial: 1 });
  advance(sim, 6);
  assert.equal(city.building(7, 5)?.type, 'shop');
  assert.equal(city.building(9, 5)?.type, 'factory');
  assert.equal(city.building(4, 8), undefined);
  assert.equal(city.zone(4, 8)?.type, 'residential');
  assert.equal(city.nextDevelopment(city.cityStats()).blocked, 'Needs an adjacent road');
  assert.equal(city.cityStats().population, 4);
  assert.equal(city.cityStats().jobs, 5);
  assert.equal(city.cityStats().demand.residential, 2);
  assert.equal(city.cityStats().used, 3);
});

test('both utility services must have capacity for more than three new lots', () => {
  const city = neighborhood();
  const sim = new Simulation(city);
  advance(sim, 10);
  city.paintZone('residential', 11, 5);
  advance(sim, 3);
  assert.equal(city.building(11, 5), undefined);
  assert.equal(city.nextDevelopment(city.cityStats()).blocked, 'Needs more power and water capacity');

  city.place('power', 12, 3);
  advance(sim, 3);
  assert.equal(city.cityStats().power, 11);
  assert.equal(city.cityStats().water, 3);
  assert.equal(city.building(11, 5), undefined);
  assert.equal(city.nextDevelopment(city.cityStats()).blocked, 'Needs more water capacity');

  city.place('water', 13, 2);
  advance(sim, 3);
  assert.equal(city.cityStats().water, 3);
  assert.equal(city.building(11, 5), undefined);

  city.addRoad(13, 3);
  advance(sim, 3);
  assert.equal(city.cityStats().water, 11);
  assert.equal(city.cityStats().used, 4);
  assert.equal(city.building(11, 5)?.type, 'house');

  city.demolish(13, 3);
  city.paintZone('residential', 12, 5);
  advance(sim, 3);
  assert.equal(city.cityStats().water, 3);
  assert.equal(city.cityStats().used, 4);
  assert.equal(city.building(11, 5)?.type, 'house');
  assert.equal(city.building(12, 5), undefined);
});

test('new saves preserve queued zones, developed lots and service buildings', () => {
  const city = neighborhood();
  advance(new Simulation(city), 10);
  city.setModifier(5, 4, 'signal');
  city.place('power', 12, 3);
  city.place('water', 13, 3);
  const save = JSON.parse(JSON.stringify(city.serialize()));
  const loaded = City.fromJSON(save);
  assert.deepEqual(loaded.serialize(), save);
  assert.equal(loaded.road(5, 4).modifier, 'signal');
  assert.equal(loaded.zone(4, 8)?.type, 'residential');
  assert.equal(loaded.building(4, 8), undefined);
  assert.equal(loaded.building(9, 5)?.type, 'factory');
  assert.equal(loaded.cityStats().used, 3);
  assert.equal(loaded.cityStats().power, 11);
  assert.equal(loaded.cityStats().water, 11);

  loaded.demolish(9, 5);
  assert.equal(loaded.zone(9, 5), undefined);
  assert.equal(loaded.cityStats().used, 2);
  assert.equal(loaded.cityStats().demand.industrial, 1);
});

test('a vacant lot can be rezoned and roads and developed lots cannot be rezoned', () => {
  const city = neighborhood();
  assert.ok(city.paintZone('commercial', 4, 8));
  assert.equal(city.zone(4, 8)?.type, 'commercial');
  assert.equal(city.paintZone('industrial', 4, 4), false);
  advance(new Simulation(city), 4);
  assert.equal(city.paintZone('commercial', 4, 5), false);
  assert.ok(city.demolish(4, 8));
  assert.equal(city.zone(4, 8), undefined);
});
