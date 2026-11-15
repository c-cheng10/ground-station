(() => {
  "use strict";

  const epsilon = 1e-7;
  const boundsOf = (points) => points.reduce(([left, bottom, right, top], [x, y]) =>
    [Math.min(left, x), Math.min(bottom, y), Math.max(right, x), Math.max(top, y)],
  [Infinity, Infinity, -Infinity, -Infinity]);
  const segmentKey = (a, b) => [a, b].map((point) =>
    point.map((value) => Math.round(value / epsilon)).join(",")).sort().join(";");

  function spatialIndex(records, size) {
    const bins = new Map();
    const keys = function* ([left, bottom, right, top]) {
      for (let y = Math.floor(bottom / size); y <= Math.floor(top / size); y += 1) {
        for (let x = Math.floor(left / size); x <= Math.floor(right / size); x += 1) yield `${x},${y}`;
      }
    };
    for (const record of records) {
      for (const key of keys(record.bounds)) {
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(record);
      }
    }
    return {
      at(x, y) {
        return (bins.get(`${Math.floor(x / size)},${Math.floor(y / size)}`) ?? [])
          .filter(({ bounds: [left, bottom, right, top] }) => left <= x && x <= right && bottom <= y && y <= top);
      },
      overlapping(bounds) {
        const results = new Set();
        const [left, bottom, right, top] = bounds;
        for (const key of keys(bounds)) {
          for (const record of bins.get(key) ?? []) {
            const [x0, y0, x1, y1] = record.bounds;
            if (x0 <= right && left <= x1 && y0 <= top && bottom <= y1) results.add(record);
          }
        }
        return results;
      },
    };
  }

  function containsLand({ rings }, x, y) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [ax, ay] = ring[j];
        const [bx, by] = ring[i];
        if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
      }
    }
    return inside;
  }

  function addCuts(edge, other, cuts) {
    const { a: [ax, ay], dx, dy } = edge;
    const { a: [bx, by], dx: sx, dy: sy } = other;
    const x = bx - ax;
    const y = by - ay;
    const det = dx * sy - dy * sx;
    const cross = x * dy - y * dx;
    const add = (t) => { if (t > epsilon && t < 1 - epsilon) cuts.push(t); };
    if (Math.abs(det) > epsilon) {
      const alongOther = cross / det;
      if (alongOther >= -epsilon && alongOther <= 1 + epsilon) add((x * sy - y * sx) / det);
    } else if (Math.abs(cross) < epsilon) {
      // Coincident edges can share only part of their length, especially at study points off the grid.
      const length = dx * dx + dy * dy;
      add((x * dx + y * dy) / length);
      add(((x + sx) * dx + (y + sy) * dy) / length);
    }
  }

  window.selectionOutline = (cells, countries, spacing) => {
    const radius = spacing / 2;
    const boxes = cells.flatMap(([lat, lon]) => [-360, 0, 360].map((shift) => ({
      bounds: [Math.max(-180, lon - radius + shift), Math.max(-90, lat - radius),
        Math.min(180, lon + radius + shift), Math.min(90, lat + radius)],
    })).filter(({ bounds: [left, bottom, right, top] }) => left < right && bottom < top));
    if (!boxes.length) return [];
    const grid = spatialIndex(boxes, spacing * 2);
    const polygons = countries.flatMap(({ polygons }) => polygons).map((rings) =>
      ({ rings, bounds: boundsOf(rings[0]) })).filter(({ bounds }) => grid.overlapping(bounds).size);
    const land = spatialIndex(polygons, spacing * 2);
    const inside = (lon, lat) => {
      const x = lon < -180 ? lon + 360 : lon > 180 ? lon - 360 : lon;
      return grid.at(x, lat).length && land.at(x, lat).some((polygon) => containsLand(polygon, x, lat));
    };

    const edges = new Map();
    function collect(ring, index) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const a = ring[j];
        const b = ring[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        if (Math.hypot(dx, dy) <= epsilon) continue;
        const bounds = boundsOf([a, b]);
        if (index.overlapping(bounds).size) edges.set(segmentKey(a, b), { a, b, dx, dy, bounds });
      }
    }
    for (const { bounds: [left, bottom, right, top] } of boxes) {
      collect([[left, bottom], [right, bottom], [right, top], [left, top]], land);
    }
    for (const { rings } of polygons) {
      for (const ring of rings) collect(ring, grid);
    }

    const nearbyEdges = spatialIndex(edges.values(), spacing * 2);
    const outline = new Map();
    for (const edge of edges.values()) {
      const cuts = [0, 1];
      for (const other of nearbyEdges.overlapping(edge.bounds)) {
        if (other !== edge) addCuts(edge, other, cuts);
      }
      cuts.sort((a, b) => a - b);
      const { a: [x, y], dx, dy } = edge;
      const at = (t) => [x + dx * t, y + dy * t];
      const length = Math.hypot(dx, dy);
      const nx = -dy / length * epsilon;
      const ny = dx / length * epsilon;
      for (let i = 1; i < cuts.length; i += 1) {
        const start = cuts[i - 1];
        const end = cuts[i];
        if ((end - start) * length <= epsilon) continue;
        const [mx, my] = at((start + end) / 2);
        // Keep only edges separating covered land from water or unselected land.
        if (Boolean(inside(mx + nx, my + ny)) === Boolean(inside(mx - nx, my - ny))) continue;
        const a = at(start);
        const b = at(end);
        outline.set(segmentKey(a, b), [a, b]);
      }
    }
    return [...outline.values()];
  };
})();
