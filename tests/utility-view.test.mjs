import test from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/world.js';

test('utility view reflects each service, road access and current growth demand', () => {
  const city = new City(false);
  for (let x = 2; x <= 9; x++) city.addRoad(x, 3);
  city.paintZone('residential', 2, 4);
  city.paintZone('commercial', 3, 4);
  city.paintZone('residential', 4, 5);
  city.place('power', 7, 2);
  city.place('power', 9, 1);
  city.place('water', 8, 2);

  const power = city.utilityView('power');
  assert.equal(power.capacity, 11);
  assert.equal(power.used, 0);
  assert.deepEqual(power.lots.map(lot => [lot.x, lot.y, lot.status]), [[2, 4, 'available']]);
  assert.deepEqual(power.sources.map(source => [source.x, source.y, source.active]), [
    [7, 2, true], [9, 1, false],
  ]);
  assert.deepEqual(city.utilityView('water').sources.map(source => source.type), ['water']);

  city.addRoad(9, 2);
  assert.equal(city.utilityView('power').capacity, 19);
  assert.equal(city.utilityView('water').capacity, 11);
});

test('consumer markers follow utility usage and waiting markers follow only the selected service', () => {
  const city = new City(false);
  for (let x = 2; x <= 9; x++) city.addRoad(x, 3);
  for (const [type, building, x] of [
    ['residential', 'house', 2], ['commercial', 'shop', 3], ['industrial', 'factory', 4],
  ]) {
    city.paintZone(type, x, 4);
    city.place(building, x, 4);
  }
  city.place('office', 5, 4);
  city.paintZone('residential', 6, 4);
  city.place('power', 7, 2);
  city.demolish(2, 3);

  const power = city.utilityView('power');
  const water = city.utilityView('water');
  assert.equal(power.spare, 8);
  assert.equal(water.spare, 0);
  assert.equal(water.used, 3);
  assert.deepEqual(water.lots.map(lot => [lot.x, lot.status]), [
    [2, 'used'], [3, 'used'], [4, 'used'], [6, 'waiting'],
  ]);
  assert.equal(power.lots.find(lot => lot.x === 6).status, 'available');

  city.place('water', 8, 2);
  assert.ok(city.develop());
  city.demolish(8, 3);
  const overloaded = city.utilityView('water');
  assert.equal(overloaded.spare, -1);
  assert.equal(overloaded.sources[0].active, false);
  assert.equal(overloaded.lots.length, 4);
  assert.ok(overloaded.lots.every(lot => lot.status === 'used'));
});
