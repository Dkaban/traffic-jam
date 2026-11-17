import { BUILDINGS, key } from './world.js';

const COLORS = ['#ffca79','#f1a1a7','#80d8e5','#b7a5ee','#f6f3d7','#7cd6b0','#ec975f','#9bb8ff'];
const pick = array => array[Math.floor(Math.random() * array.length)];
const shuffle = array => [...array].sort(() => Math.random() - .5);

export class Simulation {
  constructor(city) {
    this.city = city;
    this.cars = [];
    this.nextId = 0;
    this.time = 0;
    this.completed = 0;
    this.totalTripTime = 0;
    this.occupancy = new Map();
    this.syncCars();
  }
  reset(city) {
    this.city = city; this.cars = []; this.nextId = 0; this.time = 0;
    this.completed = 0; this.totalTripTime = 0;
    this.syncCars();
  }
  syncCars() {
    const buildings = new Map([...this.city.buildings.values()].map(b => [b.id,b]));
    this.cars = this.cars.filter(c => buildings.has(c.owner) && c.slot < BUILDINGS[buildings.get(c.owner).type].cars);
    for (const b of buildings.values()) {
      const amount = BUILDINGS[b.type].cars;
      for (let slot = 0; slot < amount; slot++) {
        if (this.cars.some(c => c.owner === b.id && c.slot === slot)) continue;
        const available = this.city.adjacentRoads(b.x, b.y);
        const road = available.length ? pick(available) : null;
        this.cars.push({ id: this.nextId++, owner: b.id, slot, road: road ? key(road.x, road.y) : null,
          path: [], node: 0, t: 0, idle: Math.random() * 3.5, speed: .85 + Math.random() * .38,
          color: pick(COLORS), facing: 0, wait: false, stopKey: null, stopCountdown: 0, tripTime: 0 });
      }
    }
  }
  networkChanged() {
    this.syncCars();
    for (const car of this.cars) {
      const b = [...this.city.buildings.values()].find(b => b.id === car.owner);
      if (!b) continue;
      const at = car.path[car.node] || (car.road && this.city.roads.get(car.road));
      const road = (at && this.city.road(at.x, at.y)) || this.city.adjacentRoads(b.x, b.y)[0];
      car.road = road ? key(road.x, road.y) : null;
      car.path = []; car.node = 0; car.t = 0; car.idle = .2 + Math.random();
      car.stopKey = null; car.stopCountdown = 0;
    }
  }
  getOccupancy() {
    const occupancy = new Map();
    for (const car of this.cars) {
      const p = car.path.length ? car.path[Math.min(car.node + (car.t >= .5 ? 1 : 0), car.path.length - 1)] : (car.road && this.city.roads.get(car.road));
      if (p) { const k = key(p.x, p.y); occupancy.set(k, (occupancy.get(k) || 0) + 1); }
    }
    this.occupancy = occupancy;
    return occupancy;
  }
  planTrip(car, occupancy) {
    const start = this.city.roads.get(car.road);
    const home = [...this.city.buildings.values()].find(b => b.id === car.owner);
    const startRoad = start || (home && this.city.adjacentRoads(home.x, home.y)[0]);
    if (!startRoad) { car.road = null; car.idle = 2; return; }
    car.road = key(startRoad.x,startRoad.y);
    const destinations = shuffle([...this.city.buildings.values()].filter(b => b.id !== car.owner && this.city.connected(b)));
    for (const target of destinations) {
      let best = null;
      for (const destRoad of shuffle(this.city.adjacentRoads(target.x,target.y))) {
        const route = this.city.findRoute(startRoad, destRoad, occupancy);
        if (route && route.length >= 2 && (!best || route.length < best.length)) best = route;
      }
      if (best) {
        car.path = best; car.node = 0; car.t = 0; car.tripTime = 0; car.stopKey = null;
        return;
      }
    }
    car.path = []; car.idle = 2 + Math.random() * 2;
  }
  canEnter(car, next, occupancy) {
    const previous = car.path[car.node];
    const dx = next.x - previous.x, dy = next.y - previous.y;
    if (next.modifier === 'signal') {
      const phase = (this.time + (next.x * 3 + next.y * 5) % 3) % 12;
      const eastWestGreen = phase < 5;
      const northSouthGreen = phase >= 6 && phase < 11;
      if (dx && !eastWestGreen || dy && !northSouthGreen) return false;
    }
    const k = key(next.x, next.y);
    if (next.modifier === 'stop' && car.stopKey !== `${k}:${car.node}`) {
      if (car.stopCountdown <= 0) car.stopCountdown = .65;
      car.stopKey = `${k}:${car.node}`;
    }
    if (car.stopCountdown > 0) return false;
    // A short queue can form when a road segment fills up.
    if ((occupancy.get(k) || 0) >= 2 && car.t < .5) return false;
    return true;
  }
  update(dt) {
    dt = Math.min(Math.max(dt, 0), .08);
    this.time += dt;
    this.syncCars();
    const occupancy = this.getOccupancy();
    const cars = [...this.cars].sort(() => Math.random() - .5);
    for (const car of cars) {
      car.wait = false;
      if (!car.road) {
        const b = [...this.city.buildings.values()].find(b => b.id === car.owner);
        const available = b && this.city.adjacentRoads(b.x,b.y);
        if (available && available.length) car.road = key(available[0].x, available[0].y);
        else continue;
      }
      if (car.idle > 0) { car.idle -= dt; continue; }
      if (!car.path.length) { this.planTrip(car, occupancy); continue; }
      const next = car.path[car.node + 1];
      if (!next) {
        car.road = key(car.path[car.node].x,car.path[car.node].y);
        car.path = []; car.t = 0; car.idle = .9 + Math.random() * 1.2;
        this.completed++; this.totalTripTime += car.tripTime;
        continue;
      }
      if (!this.city.road(next.x,next.y)) { car.path = []; car.idle = .5; continue; }
      car.tripTime += dt;
      if (car.stopCountdown > 0) car.stopCountdown = Math.max(0, car.stopCountdown - dt);
      const from = car.path[car.node];
      const dirX = next.x - from.x, dirY = next.y - from.y;
      car.facing = Math.atan2(dirY, dirX);
      if (car.t < .42 && !this.canEnter(car, next, occupancy)) { car.wait = true; continue; }
      const multiplier = next.modifier === 'express' ? 1.65 : next.modifier === 'roundabout' ? 1.18 : 1;
      car.t += dt * car.speed * multiplier;
      if (car.t >= 1) {
        car.node++;
        car.t = 0;
        car.road = key(next.x,next.y);
        car.stopCountdown = 0;
      }
    }
    this.getOccupancy();
  }
  position(car) {
    if (car.path.length) {
      const a = car.path[car.node], b = car.path[car.node+1] || a;
      if (a) return { x: a.x + (b.x-a.x) * car.t, y: a.y + (b.y-a.y)*car.t };
    }
    const r = this.city.roads.get(car.road);
    return r ? {x:r.x,y:r.y} : null;
  }
  stats() {
    const active = this.cars.filter(c => c.road).length;
    const moving = this.cars.filter(c => c.path.length && !c.wait && c.idle <= 0).length;
    const queued = this.cars.filter(c => c.wait).length;
    return {
      vehicles: this.cars.length, active, moving, queued,
      buildings: this.city.buildingCount(), roads: this.city.roadCount(), trips: this.completed,
      flow: active ? Math.max(0, Math.round((1 - queued / active) * 100)) : 100,
      avgTrip: this.completed ? (this.totalTripTime / this.completed).toFixed(1) : '—',
    };
  }
}
