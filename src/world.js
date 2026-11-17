export const COLS = 38;
export const ROWS = 26;
export const TILE = 32;
export const BUILDINGS = {
  house: { name: 'House', cars: 1, color: '#f1ac72', icon: '⌂', detail: 'A small household adds one commuter.' },
  apartment: { name: 'Apartments', cars: 5, color: '#a3b9f1', icon: '▦', detail: 'Dense living adds five vehicles.' },
  office: { name: 'Office', cars: 3, color: '#73d9cd', icon: '▥', detail: 'A busy workplace adds three vehicles.' },
  shop: { name: 'Shops', cars: 2, color: '#f2c970', icon: '▤', detail: 'Local businesses add two delivery and shopper vehicles.' },
};
export const DIRECTIONS = [
  { dx: 0, dy: -1, id: 'n' }, { dx: 1, dy: 0, id: 'e' },
  { dx: 0, dy: 1, id: 's' }, { dx: -1, dy: 0, id: 'w' },
];
export const key = (x, y) => `${x},${y}`;
export const coords = k => k.split(',').map(Number);
export const inside = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

export class City {
  constructor(seed = true) {
    this.roads = new Map();
    this.buildings = new Map();
    this.nextId = 1;
    this.version = 0;
    if (seed) this.makeStarter();
  }
  road(x, y) { return this.roads.get(key(x, y)); }
  building(x, y) { return this.buildings.get(key(x, y)); }
  addRoad(x, y) {
    if (!inside(x, y) || this.road(x, y) || this.building(x, y)) return false;
    this.roads.set(key(x, y), { x, y, modifier: 'none', direction: 'e' });
    this.version++;
    return true;
  }
  place(type, x, y) {
    if (!(type in BUILDINGS) || !inside(x, y) || this.road(x, y) || this.building(x, y)) return false;
    this.buildings.set(key(x, y), { id: this.nextId++, type, x, y });
    this.version++;
    return true;
  }
  demolish(x, y) {
    const k = key(x, y);
    const changed = this.roads.delete(k) || this.buildings.delete(k);
    if (changed) this.version++;
    return changed;
  }
  setModifier(x, y, modifier, direction = 'e') {
    const road = this.road(x, y);
    if (!road) return false;
    if (road.modifier === modifier && (modifier !== 'oneway' || road.direction === direction)) return false;
    road.modifier = modifier;
    road.direction = direction;
    this.version++;
    return true;
  }
  adjacentRoads(x, y) {
    return DIRECTIONS.map(d => this.road(x + d.dx, y + d.dy)).filter(Boolean);
  }
  connected(b) { return this.adjacentRoads(b.x, b.y).length > 0; }
  roadCount() { return this.roads.size; }
  buildingCount() { return this.buildings.size; }
  demand() { return [...this.buildings.values()].reduce((sum, b) => sum + BUILDINGS[b.type].cars, 0); }
  neighbors(road) {
    return DIRECTIONS.flatMap(dir => {
      const n = this.road(road.x + dir.dx, road.y + dir.dy);
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
    return { roads: [...this.roads.values()], buildings: [...this.buildings.values()], nextId: this.nextId };
  }
  static fromJSON(data) {
    if (!data || !Array.isArray(data.roads) || !Array.isArray(data.buildings)) throw new Error('Invalid city');
    const city = new City(false);
    for (const r of data.roads) if (inside(r.x, r.y)) city.roads.set(key(r.x, r.y), {
      x: r.x, y: r.y, modifier: ['none', 'signal', 'stop', 'express', 'oneway', 'roundabout'].includes(r.modifier) ? r.modifier : 'none',
      direction: DIRECTIONS.some(d => d.id === r.direction) ? r.direction : 'e',
    });
    for (const b of data.buildings) if (inside(b.x, b.y) && BUILDINGS[b.type] && !city.road(b.x, b.y)) city.buildings.set(key(b.x, b.y), { id: b.id, x: b.x, y: b.y, type: b.type });
    city.nextId = Math.max(Number(data.nextId) || 1, ...[...city.buildings.values()].map(b => b.id + 1), 1);
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
  }
}
