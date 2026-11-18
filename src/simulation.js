import { BUILDINGS, key } from './world.js';

const COLORS = ['#ffca79','#f1a1a7','#80d8e5','#b7a5ee','#f6f3d7','#7cd6b0','#ec975f','#9bb8ff'];
const pick = array => array[Math.floor(Math.random() * array.length)];
const GROWTH_INTERVAL = 3;
const DEPARTURE_INTERVAL = .65;
const HOME_INTERVAL = 5;

export class Simulation {
  constructor(city) {
    this.reset(city);
  }
  reset(city) {
    this.city = city; this.cars = []; this.nextId = 0; this.time = 0;
    this.completed = 0; this.totalTripTime = 0;
    this.occupancy = new Map();
    this.nextGrowth = GROWTH_INTERVAL;
    this.nextDeparture = DEPARTURE_INTERVAL;
    this.homes = [];
    this.pendingHomes = [];
    this.arrivalTargets = new Map();
    this.destinationRoads = new Map();
    this.homeIndex = 0;
    this.lastDeparture = new Map();
    this.cityVersion = -1;
  }
  networkChanged() {
    this.cars = this.cars.filter(car => {
      if (this.city.building(car.home.x, car.home.y) !== car.home ||
          this.city.building(car.destination.x, car.destination.y) !== car.destination) return false;
      const remaining = car.path.slice(car.node);
      return remaining.every((road, i) => road.offMap ||
        (this.city.road(road.x, road.y) === road &&
        (!i || remaining[i - 1].offMap || this.city.neighbors(remaining[i - 1]).includes(road))));
    });
    this.getOccupancy();
  }
  indexTripEndpoints() {
    if (this.cityVersion === this.city.version) return;
    this.homes = [];
    this.pendingHomes = [];
    this.destinationRoads.clear();
    for (const building of this.city.buildings.values()) {
      const type = BUILDINGS[building.type];
      if (building.awaitingResidents) this.pendingHomes.push(building);
      else if (type.population && this.city.connected(building)) this.homes.push(building);
      if (type.jobs) {
        for (const road of this.city.adjacentRoads(building.x, building.y)) {
          this.destinationRoads.set(road, building);
        }
      }
    }
    this.indexArrivalTargets();
    for (const id of this.lastDeparture.keys()) {
      if (this.time - this.lastDeparture.get(id) >= HOME_INTERVAL) this.lastDeparture.delete(id);
    }
    this.cityVersion = this.city.version;
  }
  indexArrivalTargets() {
    this.arrivalTargets.clear();
    const entry = this.city.highwayEntry();
    if (!entry || !this.pendingHomes.length) return;
    const queue = [entry];
    const reachable = new Set(queue);
    for (const road of queue) {
      for (const next of this.city.neighbors(road)) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    for (const home of this.pendingHomes) {
      const targets = this.city.adjacentRoads(home.x, home.y).filter(road => reachable.has(road));
      if (targets.length) this.arrivalTargets.set(home, targets);
    }
  }
  arrivalStatus() {
    this.indexTripEndpoints();
    const van = this.cars.find(car => car.arrival);
    const reachableVan = van && this.arrivalTargets.has(van.home);
    return {
      waiting: this.pendingHomes.length - this.arrivalTargets.size - Number(Boolean(van && !reachableVan)),
      ready: this.arrivalTargets.size - Number(Boolean(reachableVan)),
      inTransit: van ? 1 : 0,
    };
  }
  getOccupancy() {
    const occupancy = new Map();
    for (const car of this.cars) {
      const p = car.path[Math.min(car.node + (car.t >= .5 ? 1 : 0), car.path.length - 1)];
      if (p.offMap) continue;
      const k = key(p.x, p.y);
      occupancy.set(k, (occupancy.get(k) || 0) + 1);
    }
    this.occupancy = occupancy;
    return occupancy;
  }
  startTrip() {
    this.indexTripEndpoints();
    if (!this.homes.length || !this.destinationRoads.size) return;
    const home = this.homes[this.homeIndex % this.homes.length];
    this.homeIndex = (this.homeIndex + 1) % this.homes.length;
    if (this.time - (this.lastDeparture.get(home.id) ?? -Infinity) < HOME_INTERVAL ||
        this.cars.some(car => car.home === home)) return;

    // Find reachable destinations in one pass per departure. Route to only the chosen one.
    const origins = this.city.adjacentRoads(home.x, home.y)
      .filter(road => (this.occupancy.get(key(road.x, road.y)) || 0) < 2);
    const reachable = new Map(origins.map(road => [road, road]));
    const queue = [...origins];
    const targets = [];
    for (let i = 0; i < queue.length; i++) {
      const road = queue[i];
      if (this.destinationRoads.has(road) && reachable.get(road) !== road) targets.push(road);
      for (const next of this.city.neighbors(road)) {
        if (reachable.has(next)) continue;
        reachable.set(next, reachable.get(road));
        queue.push(next);
      }
    }
    if (!targets.length) return;
    const target = pick(targets);
    const path = this.city.findRoute(reachable.get(target), target, this.occupancy);
    if (!path) return;
    this.lastDeparture.set(home.id, this.time);
    this.cars.push({
      id: this.nextId++, home, destination: this.destinationRoads.get(target),
      path, node: 0, t: 0, speed: .85 + Math.random() * .38,
      color: pick(COLORS), facing: 0, wait: false, stopKey: null, stopCountdown: 0, tripTime: 0,
    });
  }
  startArrival() {
    this.indexTripEndpoints();
    if (this.cars.some(car => car.arrival) || !this.arrivalTargets.size) return;
    const [home, targets] = this.arrivalTargets.entries().next().value;
    const entry = this.city.highwayEntry();
    let path = null;
    for (const target of targets) {
      const route = this.city.findRoute(entry, target, this.occupancy);
      if (route && (!path || route.length < path.length)) path = route;
    }
    if (!path) return;
    const { dx, dy } = this.city.highway;
    const start = { x: entry.x - dx / 2, y: entry.y - dy / 2, offMap: true };
    this.cars.push({
      id: this.nextId++, home, destination: home, arrival: true,
      path: [start, ...path], node: 0, t: 0, speed: 1.25,
      color: '#d7eaff', facing: Math.atan2(dy, dx), wait: false, stopKey: null, stopCountdown: 0, tripTime: 0,
    });
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
    let changed = false;
    if (this.time >= this.nextGrowth) {
      this.nextGrowth += GROWTH_INTERVAL;
      changed = this.city.develop();
    }
    if (this.time >= this.nextDeparture) {
      this.nextDeparture += DEPARTURE_INTERVAL;
      this.startArrival();
      this.startTrip();
    }
    const occupancy = this.getOccupancy();
    const finished = new Set();
    for (const car of this.cars) {
      car.wait = false;
      const next = car.path[car.node + 1];
      if (!next) {
        if (car.arrival) changed = this.city.moveIn(car.home) || changed;
        this.completed++; this.totalTripTime += car.tripTime;
        finished.add(car);
        continue;
      }
      car.tripTime += dt;
      if (car.stopCountdown > 0) car.stopCountdown = Math.max(0, car.stopCountdown - dt);
      // Heading is calculated from the curved road trajectory in position().
      if (car.t < .42 && !this.canEnter(car, next, occupancy)) { car.wait = true; continue; }
      const multiplier = next.modifier === 'express' ? 1.65 : next.modifier === 'roundabout' ? 1.18 : 1;
      car.t += dt * car.speed * multiplier;
      if (car.t >= 1) {
        car.node++;
        car.t = 0;
        car.stopCountdown = 0;
      }
    }
    if (finished.size) this.cars = this.cars.filter(car => !finished.has(car));
    this.getOccupancy();
    return changed;
  }
  // Round corners by blending the incoming and outgoing road directions.
  // Each segment keeps its endpoints at tile centers, but uses continuous
  // Hermite tangents so cars steer into turns instead of snapping 90 degrees.
  position(car) {
    if (car.path.length) {
      const nodes = car.path;
      const i = Math.min(car.node, nodes.length - 1);
      const a = nodes[i], b = nodes[i + 1];
      if (a && b) {
        const prev = nodes[Math.max(0, i - 1)];
        const after = nodes[Math.min(nodes.length - 1, i + 2)];
        const tangent = (before, center, next) => {
          const inX = center.x - before.x, inY = center.y - before.y;
          const outX = next.x - center.x, outY = next.y - center.y;
          if (!inX && !inY) return { x: outX, y: outY };
          if (!outX && !outY) return { x: inX, y: inY };
          return { x: (inX + outX) * .5, y: (inY + outY) * .5 };
        };
        const m0 = tangent(prev, a, b);
        const m1 = tangent(a, b, after);
        const t = Math.max(0, Math.min(1, car.t));
        const t2 = t*t, t3 = t2*t;
        const h00 = 2*t3-3*t2+1, h10 = t3-2*t2+t;
        const h01 = -2*t3+3*t2, h11 = t3-t2;
        const x = h00*a.x + h10*m0.x + h01*b.x + h11*m1.x;
        const y = h00*a.y + h10*m0.y + h01*b.y + h11*m1.y;
        const dx = (6*t2-6*t)*a.x + (3*t2-4*t+1)*m0.x + (-6*t2+6*t)*b.x + (3*t2-2*t)*m1.x;
        const dy = (6*t2-6*t)*a.y + (3*t2-4*t+1)*m0.y + (-6*t2+6*t)*b.y + (3*t2-2*t)*m1.y;
        const angle = Math.atan2(dy, dx);
        car.facing = angle;
        return { x, y, angle };
      }
      if (a) return { x:a.x, y:a.y, angle:car.facing };
    }
    return null;
  }
  stats() {
    const queued = this.cars.filter(c => c.wait).length;
    const active = this.cars.length;
    return {
      vehicles: active, active, moving: active - queued, queued,
      buildings: this.city.buildingCount(), roads: this.city.roadCount(), trips: this.completed,
      flow: active ? Math.max(0, Math.round((1 - queued / active) * 100)) : 100,
      avgTrip: this.completed ? (this.totalTripTime / this.completed).toFixed(1) : '—',
    };
  }
}
