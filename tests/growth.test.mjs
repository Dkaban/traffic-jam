import test from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/world.js';
import { Simulation } from '../src/simulation.js';

function neighborhood() {
  const city = new City(false);
  for (let x = 4; x <= 13; x++) city.addRoad(x, 4);
  city.paintZone('commercial', 7, 5);
  city.paintZone('industrial', 9, 5);
  city.paintZone('residential', 4, 5);
  city.paintZone('residential', 4, 8);
  return city;
}
function supplyUtilities(city) {
  city.place('power', 5, 2);
  city.place('water', 6, 2);
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.update(.05);
}

test('zoning waits for the simulation clock, demand and an adjacent road', () => {
  const city = neighborhood();
  supplyUtilities(city);
  const sim = new Simulation(city);
  assert.deepEqual(city.cityStats().demand, { residential: 1, commercial: 0, industrial: 0 });
  assert.equal(city.buildingCount(), 2);
  advance(sim, 2);
  assert.equal(city.buildingCount(), 2);
  advance(sim, 2);
  assert.equal(city.building(4, 5)?.type, 'house');
  assert.equal(city.buildingCount(), 3);
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
});

test('growth needs both services at the lot and skips uncovered zones', () => {
  const city = neighborhood();
  const sim = new Simulation(city);
  advance(sim, 4);
  assert.equal(city.building(4, 5), undefined);
  assert.equal(city.nextDevelopment(city.cityStats()).blocked, 'Needs power and water coverage');

  city.place('power', 5, 2);
  advance(sim, 3);
  assert.equal(city.building(4, 5), undefined);
  assert.equal(city.nextDevelopment(city.cityStats()).blocked, 'Needs water coverage');

  city.place('water', 13, 2);
  advance(sim, 3);
  assert.equal(city.building(4, 5), undefined, 'a distant tower does not supply the home');

  city.place('water', 6, 2);
  advance(sim, 9);
  assert.equal(city.building(4, 5)?.type, 'house');
  assert.equal(city.building(9, 5)?.type, 'factory');
  city.paintZone('residential', 13, 5);
  city.paintZone('residential', 5, 5);
  advance(sim, 3);
  assert.equal(city.building(13, 5), undefined);
  assert.equal(city.building(5, 5)?.type, 'house', 'uncovered zones do not block covered zones');
  assert.equal(city.nextDevelopment(city.cityStats()).blocked, 'Needs power coverage');

  city.demolish(6, 2);
  city.paintZone('residential', 6, 5);
  advance(sim, 3);
  assert.equal(city.building(5, 5)?.type, 'house', 'losing a source does not delete existing buildings');
  assert.equal(city.building(6, 5), undefined);
});

test('new saves preserve queued zones, developed lots, and service areas', () => {
  const city = neighborhood();
  supplyUtilities(city);
  advance(new Simulation(city), 10);
  city.setModifier(5, 4, 'signal');
  const save = JSON.parse(JSON.stringify(city.serialize()));
  const loaded = City.fromJSON(save);
  assert.deepEqual(loaded.serialize(), save);
  assert.equal(loaded.road(5, 4).modifier, 'signal');
  assert.equal(loaded.zone(4, 8)?.type, 'residential');
  assert.equal(loaded.building(4, 8), undefined);
  assert.equal(loaded.building(9, 5)?.type, 'factory');
  assert.deepEqual(loaded.utilityCoverage().served, { power: 5, water: 5 });

  loaded.demolish(9, 5);
  assert.equal(loaded.zone(9, 5), undefined);
  assert.deepEqual(loaded.utilityCoverage().served, { power: 4, water: 4 });
  assert.equal(loaded.cityStats().demand.industrial, 1);
});

test('a vacant lot can be rezoned and roads and developed lots cannot be rezoned', () => {
  const city = neighborhood();
  supplyUtilities(city);
  assert.ok(city.paintZone('commercial', 4, 8));
  assert.equal(city.zone(4, 8)?.type, 'commercial');
  assert.equal(city.paintZone('industrial', 4, 4), false);
  advance(new Simulation(city), 4);
  assert.equal(city.paintZone('commercial', 4, 5), false);
  assert.ok(city.demolish(4, 8));
  assert.equal(city.zone(4, 8), undefined);
});
