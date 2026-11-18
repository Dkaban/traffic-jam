import test from 'node:test';
import assert from 'node:assert/strict';
import { City, COLS, ROWS, UTILITY_BITS, utilityArea } from '../src/world.js';

function services(city, x, y) {
  return city.utilityCoverage().cells[y * COLS + x];
}

test('service areas include their four-tile diagonals and clip to the map', () => {
  const city = new City(false);
  city.place('power', 9, 9);
  city.place('water', 0, 0);
  assert.deepEqual(utilityArea(9, 9), { left: 5, top: 5, right: 13, bottom: 13 });
  assert.deepEqual(utilityArea(0, 0), { left: 0, top: 0, right: 4, bottom: 4 });
  assert.deepEqual(utilityArea(COLS - 1, ROWS - 1), {
    left: COLS - 5, top: ROWS - 5, right: COLS - 1, bottom: ROWS - 1,
  });
  assert.equal(services(city, 5, 5), UTILITY_BITS.power);
  assert.equal(services(city, 13, 13), UTILITY_BITS.power);
  assert.equal(services(city, 14, 13), 0);
  assert.equal(services(city, 4, 4), UTILITY_BITS.water);
  assert.equal(services(city, 5, 4), 0);
  assert.equal(city.roadCount(), 0);
});

test('overlapping areas remain active independently when a provider is demolished', () => {
  const city = new City(false);
  city.place('power', 9, 9);
  city.place('power', 12, 12);
  city.place('water', 11, 10);
  city.place('apartment', 9, 11);
  assert.equal(services(city, 9, 11), UTILITY_BITS.power | UTILITY_BITS.water);
  assert.equal(city.utilityCoverage().served.power, 4);
  assert.equal(city.utilityCoverage().served.water, 4);

  city.demolish(9, 9);
  assert.equal(services(city, 9, 11), UTILITY_BITS.power | UTILITY_BITS.water);
  city.demolish(12, 12);
  assert.equal(services(city, 9, 11), UTILITY_BITS.water);
  assert.equal(city.building(9, 11).type, 'apartment');
  assert.equal(services(city, 11, 10), UTILITY_BITS.water, 'a provider always supplies its own service');
});

test('every ordinary building in a service area is covered regardless of number or zoning', () => {
  const city = new City(false);
  for (let x = 5; x <= 13; x++) city.place('house', x, 8);
  city.place('house', 14, 8);
  city.place('power', 9, 9);
  city.place('water', 9, 10);
  assert.deepEqual(city.utilityCoverage().served, { power: 11, water: 11 });
  assert.equal(services(city, 14, 8), 0);
});
