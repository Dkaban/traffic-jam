export const COLS = 38;
export const ROWS = 26;
export const TILE = 32;
export const BUILDINGS = {
  house: { population: 4 },
  apartment: { population: 12 },
  office: { jobs: 3, zone: 'industrial' },
  shop: { jobs: 2, zone: 'commercial' },
  factory: { jobs: 3, zone: 'industrial' },
  power: { service: 'Power', name: 'Power plant', color: '#f4bb6d' },
  water: { service: 'Water', name: 'Water tower', color: '#7ec9ed' },
};
export const ZONES = {
  residential: { label: 'R', name: 'Residential', type: 'house', color: '#9aeca4' },
  commercial: { label: 'C', name: 'Commercial', type: 'shop', color: '#8acaff' },
  industrial: { label: 'I', name: 'Industrial', type: 'factory', color: '#ffd284' },
};
export const UTILITY_BITS = { power: 1, water: 2 };
const UTILITY_RADIUS = 4;
export function utilityArea(x, y) {
  const left = Math.max(0, x - UTILITY_RADIUS);
  const top = Math.max(0, y - UTILITY_RADIUS);
  return {
    left, top,
    right: Math.min(COLS - 1, x + UTILITY_RADIUS),
    bottom: Math.min(ROWS - 1, y + UTILITY_RADIUS),
  };
}
export const DIRECTIONS = [
  { dx: 0, dy: -1, id: 'n' }, { dx: 1, dy: 0, id: 'e' },
  { dx: 0, dy: 1, id: 's' }, { dx: -1, dy: 0, id: 'w' },
];
export const key = (x, y) => `${x},${y}`;
export const coords = k => k.split(',').map(Number);
export const inside = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
const HIGHWAY_LENGTH = 5;
const rows = Array.from({ length: ROWS }, (_, y) => y).sort((a, b) => Math.abs(a - 7) - Math.abs(b - 7));
const columns = Array.from({ length: COLS }, (_, x) => x);
const highwayStarts = [
  ...rows.map(y => ({ x: 0, y, dx: 1, dy: 0 })),
  ...rows.map(y => ({ x: COLS - 1, y, dx: -1, dy: 0 })),
  ...columns.map(x => ({ x, y: 0, dx: 0, dy: 1 })),
  ...columns.map(x => ({ x, y: ROWS - 1, dx: 0, dy: -1 })),
];
const highwayTiles = ({ x, y, dx, dy, length }) =>
  Array.from({ length }, (_, i) => ({ x: x + i * dx, y: y + i * dy }));

export class City {
  constructor(seed = true, includeHighway = true) {
    this.roads = new Map();
    this.buildings = new Map();
    this.zones = new Map();
    this.nextId = 1;
    this.version = 0;
    this.highway = null;
    if (seed) this.makeStarter();
    if (includeHighway) this.addHighway();
  }
  road(x, y) { return this.roads.get(key(x, y)); }
  building(x, y) { return this.buildings.get(key(x, y)); }
  zone(x, y) { return this.zones.get(key(x, y)); }
  addHighway(saved) {
    if (this.highway) return;
    const preferred = highwayStarts.find(start => Object.keys(start).every(field => start[field] === saved?.[field]));
    const available = start => highwayTiles(start).every(({x,y}) => !this.road(x,y) && !this.building(x,y) && !this.zone(x,y));
    const candidates = [
      ...preferred && [1, HIGHWAY_LENGTH].includes(saved.length) ? [{ ...preferred, length: saved.length }] : [],
      ...highwayStarts.map(start => ({ ...start, length: HIGHWAY_LENGTH })),
      ...highwayStarts.map(start => ({ ...start, length: 1 })),
    ];
    this.highway = candidates.find(available) ?? null;
    if (!this.highway) return;
    const direction = DIRECTIONS.find(dir => dir.dx === this.highway.dx && dir.dy === this.highway.dy).id;
    highwayTiles(this.highway).forEach(({ x, y }, i) => {
      this.roads.set(key(x,y), {
        x, y, modifier: 'none', direction, highway: true, junction: i === this.highway.length - 1,
      });
    });
    this.version++;
  }
  highwayEntry() {
    return this.highway && this.road(this.highway.x, this.highway.y);
  }
  highwayJunction() {
    if (!this.highway) return null;
    const { x, y, dx, dy, length } = this.highway;
    return this.road(x + (length - 1) * dx, y + (length - 1) * dy);
  }
  addRoad(x, y) {
    if (!inside(x, y) || this.road(x, y) || this.building(x, y) || this.zone(x, y)) return false;
    this.roads.set(key(x, y), { x, y, modifier: 'none', direction: 'e' });
    this.version++;
    return true;
  }
  place(type, x, y, awaitingResidents = false) {
    if (!Object.hasOwn(BUILDINGS, type) || !inside(x, y) || this.road(x, y) || this.building(x, y)) return false;
    const zone = this.zone(x, y);
    if (zone && ZONES[zone.type].type !== type) return false;
    const building = { id: this.nextId++, type, x, y };
    if (awaitingResidents && BUILDINGS[type].population) building.awaitingResidents = true;
    this.buildings.set(key(x, y), building);
    this.version++;
    return true;
  }
  paintZone(type, x, y) {
    if (!Object.hasOwn(ZONES, type) || !inside(x, y) || this.road(x, y) || this.building(x, y)) return false;
    if (this.zone(x, y)?.type === type) return false;
    this.zones.set(key(x, y), { type, x, y });
    this.version++;
    return true;
  }
  demolish(x, y) {
    if (this.road(x,y)?.highway) return false;
    const k = key(x, y);
    const zone = this.zones.delete(k);
    const changed = this.roads.delete(k) || this.buildings.delete(k) || zone;
    if (changed) {
      this.version++;
      if (!this.highway) this.addHighway();
    }
    return changed;
  }
  setModifier(x, y, modifier, direction = 'e') {
    const road = this.road(x, y);
    if (!road || road.highway) return false;
    if (road.modifier === modifier && (modifier !== 'oneway' || road.direction === direction)) return false;
    road.modifier = modifier;
    road.direction = direction;
    this.version++;
    return true;
  }
  adjacentRoads(x, y) {
    return DIRECTIONS.map(d => this.road(x + d.dx, y + d.dy)).filter(road => road && (!road.highway || road.junction));
  }
  connected(b) { return this.adjacentRoads(b.x, b.y).length > 0; }
  roadCount() { return this.roads.size - (this.highway?.length ?? 0); }
  buildingCount() { return this.buildings.size; }
  cityStats() {
    let population = 0, jobs = 0, homes = 0, commercial = 0, industrial = 0;
    for (const b of this.buildings.values()) {
      const type = BUILDINGS[b.type];
      if (type.population) {
        if (!b.awaitingResidents) population += type.population;
        homes++;
      }
      if (type.jobs) jobs += type.jobs;
      if (type.zone === 'commercial') commercial++;
      if (type.zone === 'industrial') industrial++;
    }
    return {
      population, jobs,
      demand: {
        residential: Math.max(0, 1 + Math.floor(jobs / 2) - homes),
        commercial: Math.max(0, Math.ceil(population / 6) - commercial),
        industrial: Math.max(0, Math.ceil(population / 6) - industrial),
      },
    };
  }
  developmentBlock(zone, demand) {
    if (!this.connected(zone)) return 'Needs an adjacent road';
    if (!demand[zone.type]) return `Waiting for ${zone.type} demand`;
    return null;
  }
  utilityCoverage() {
    if (this.coverage?.version === this.version) return this.coverage;
    const cells = new Uint8Array(COLS * ROWS);
    const sources = { power: [], water: [] };
    const served = { power: 0, water: 0 };
    for (const building of this.buildings.values()) {
      const mask = UTILITY_BITS[building.type];
      if (!mask) continue;
      const area = utilityArea(building.x, building.y);
      sources[building.type].push(area);
      for (let y = area.top; y <= area.bottom; y++) {
        for (let x = area.left; x <= area.right; x++) cells[y * COLS + x] |= mask;
      }
    }
    for (const building of this.buildings.values()) {
      const mask = cells[building.y * COLS + building.x];
      if (mask & UTILITY_BITS.power) served.power++;
      if (mask & UTILITY_BITS.water) served.water++;
    }
    this.coverage = { version: this.version, cells, sources, served };
    return this.coverage;
  }
  nextDevelopment(stats) {
    let blocked = null, utilityBlocked = null;
    for (const zone of this.zones.values()) {
      if (this.building(zone.x, zone.y)) continue;
      const reason = this.developmentBlock(zone, stats.demand);
      if (reason) { blocked ??= reason; continue; }
      const mask = this.utilityCoverage().cells[zone.y * COLS + zone.x];
      const missing = Object.keys(UTILITY_BITS).filter(service => !(mask & UTILITY_BITS[service]));
      if (missing.length) {
        utilityBlocked ??= `Needs ${missing.join(' and ')} coverage`;
        continue;
      }
      return { zone };
    }
    return { blocked: utilityBlocked ?? blocked };
  }
  develop() {
    const { zone } = this.nextDevelopment(this.cityStats());
    return zone ? this.place(ZONES[zone.type].type, zone.x, zone.y, zone.type === 'residential') : false;
  }
  moveIn(home) {
    const { x, y, awaitingResidents, ...details } = home;
    if (!awaitingResidents || this.building(x,y) !== home) return false;
    this.buildings.set(key(x,y), { x, y, ...details });
    this.version++;
    return true;
  }
  roadLink(road, dx, dy) {
    const next = this.road(road.x + dx, road.y + dy);
    const sameKind = next && Boolean(next.highway) === Boolean(road.highway);
    return next && (sameKind || road.junction || next.junction) ? next : null;
  }
  neighbors(road) {
    return DIRECTIONS.flatMap(dir => {
      const n = this.roadLink(road, dir.dx, dir.dy);
      if (!n) return [];
      if (road.modifier === 'oneway' && road.direction !== dir.id) return [];
      if (n.modifier === 'oneway' && n.direction !== dir.id) return [];
      return [n];
    });
  }
  // A* routing over legal road connections. Cost favors express roads and avoids busy tiles.
  findRoute(start, end, occupancy = new Map()) {
    if (!start || !end) return null;
    const startKey = key(start.x, start.y), endKey = key(end.x, end.y);
    if (startKey === endKey) return [start];
    const open = [start];
    const distance = new Map([[startKey, 0]]);
    const parent = new Map();
    const heuristic = r => (Math.abs(r.x - end.x) + Math.abs(r.y - end.y)) * .7;
    const f = new Map([[startKey, heuristic(start)]]);
    const visited = new Set();
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if ((f.get(key(open[i].x, open[i].y)) ?? Infinity) < (f.get(key(open[best].x, open[best].y)) ?? Infinity)) best = i;
      const current = open.splice(best, 1)[0];
      const ck = key(current.x, current.y);
      if (ck === endKey) {
        const path = [current];
        let at = ck;
        while (parent.has(at)) { at = parent.get(at); path.push(this.roads.get(at)); }
        return path.reverse();
      }
      if (visited.has(ck)) continue;
      visited.add(ck);
      for (const n of this.neighbors(current)) {
        const nk = key(n.x, n.y);
        const congestion = Math.min(2, occupancy.get(nk) || 0) * .55;
        const cost = (n.modifier === 'express' ? .6 : 1) + congestion + (n.modifier === 'stop' ? .3 : 0);
        const next = distance.get(ck) + cost;
        if (next < (distance.get(nk) ?? Infinity)) {
          parent.set(nk, ck);
          distance.set(nk, next);
          f.set(nk, next + heuristic(n));
          if (!visited.has(nk)) open.push(n);
        }
      }
    }
    return null;
  }
  serialize() {
    return {
      roads: [...this.roads.values()].filter(road => !road.highway).map(road => ({ ...road })),
      buildings: [...this.buildings.values()], zones: [...this.zones.values()],
      nextId: this.nextId, highway: this.highway,
    };
  }
  static fromJSON(data) {
    if (!data || !Array.isArray(data.roads) || !Array.isArray(data.buildings)) throw new Error('Invalid city');
    const city = new City(false, false);
    for (const r of data.roads) if (inside(r.x, r.y)) city.roads.set(key(r.x, r.y), {
      x: r.x, y: r.y, modifier: ['none', 'signal', 'stop', 'express', 'oneway', 'roundabout'].includes(r.modifier) ? r.modifier : 'none',
      direction: DIRECTIONS.some(d => d.id === r.direction) ? r.direction : 'e',
    });
    for (const b of data.buildings) {
      if (!inside(b.x, b.y) || !Object.hasOwn(BUILDINGS, b.type) || city.road(b.x, b.y)) continue;
      const building = { id: b.id, x: b.x, y: b.y, type: b.type };
      if (b.awaitingResidents === true && BUILDINGS[b.type].population) building.awaitingResidents = true;
      city.buildings.set(key(b.x, b.y), building);
    }
    for (const zone of Array.isArray(data.zones) ? data.zones : []) {
      if (!zone || !inside(zone.x, zone.y) || !Object.hasOwn(ZONES, zone.type) || city.road(zone.x, zone.y)) continue;
      const building = city.building(zone.x, zone.y);
      if (!building || building.type === ZONES[zone.type].type) city.zones.set(key(zone.x, zone.y), { x: zone.x, y: zone.y, type: zone.type });
    }
    city.nextId = Math.max(Number(data.nextId) || 1, ...[...city.buildings.values()].map(b => b.id + 1), 1);
    city.addHighway(data.highway);
    city.version++;
    return city;
  }
  makeStarter() {
    const line = (ax, ay, bx, by) => {
      if (ax === bx) for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) this.addRoad(ax, y);
      else if (ay === by) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) this.addRoad(x, ay);
    };
    line(5, 7, 32, 7); line(6, 14, 32, 14); line(9, 21, 29, 21);
    line(8, 5, 8, 23); line(19, 5, 19, 23); line(29, 5, 29, 23);
    line(13, 7, 13, 14); line(24, 14, 24, 21);
    for (const [x, y] of [[8,7],[19,7],[29,7],[19,14],[29,14]]) this.setModifier(x, y, 'signal');
    this.setModifier(13, 14, 'stop');
    this.setModifier(24, 14, 'roundabout');
    for (let x = 20; x <= 28; x++) this.setModifier(x, 21, 'express');
    [ [10,6],[12,6],[15,6],[17,6],[10,13],[15,13],[9,20],[11,20] ].forEach(p => this.place('house', ...p));
    [[22,13],[26,13],[21,20]].forEach(p => this.place('apartment', ...p));
    [[20,6],[27,6]].forEach(p => this.place('office', ...p));
    [[12,15],[30,13]].forEach(p => this.place('shop', ...p));
    this.place('power', 10, 9);
    this.place('water', 12, 9);
    this.place('power', 22, 17);
    this.place('water', 24, 17);
  }
}
