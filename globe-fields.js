(() => {
  "use strict";

  const pixelsPerDegree = 4;
  const width = 360 * pixelsPerDegree;
  const height = 180 * pixelsPerDegree;
  const size = width * height;
  const radians = Math.PI / 180;
  const toX = (longitude) => (longitude + 180) * pixelsPerDegree;
  const toY = (latitude) => (90 - latitude) * pixelsPerDegree;
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const smooth = (value) => value * value * (3 - 2 * value);

  function texture() {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext("2d");
  }

  function makeSurface(countries) {
    const ctx = texture();
    const paths = countries.flatMap(({ polygons }) => polygons).map((rings) => {
      const path = new Path2D();
      for (const ring of rings) {
        if (!ring.length) continue;
        path.moveTo(toX(ring[0][0]), toY(ring[0][1]));
        for (const [lon, lat] of ring.slice(1)) path.lineTo(toX(lon), toY(lat));
        path.closePath();
      }
      return path;
    });
    ctx.fillStyle = "#fff";
    for (const path of paths) ctx.fill(path, "evenodd");
    const land = ctx.getImageData(0, 0, width, height).data;
    const surface = ctx.createImageData(width, height);
    for (let i = 0; i < surface.data.length; i += 4) {
      surface.data[i] = land[i + 3];
      surface.data[i + 3] = 255;
    }
    ctx.putImageData(surface, 0, 0);
    return { surface: ctx.canvas, land };
  }

  // Visit compact sample footprints in map coordinates, including both sides of the date line.
  function footprint(longitude, latitude, range, visit) {
    const cx = toX(longitude);
    const cy = toY(latitude);
    const radius = range * pixelsPerDegree;
    const radiusSquared = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y += 1) {
      const dySquared = (y + 0.5 - cy) ** 2;
      for (let x = Math.floor(cx - radius); x < Math.ceil(cx + radius); x += 1) {
        const squared = (x + 0.5 - cx) ** 2 + dySquared;
        if (squared < radiusSquared) visit(y * width + (x + width) % width, squared / radiusSquared);
      }
    }
  }

  function makeMeasurement(entry, points, land) {
    const weights = new Float32Array(size);
    const slopes = new Float32Array(size);
    const confidences = new Float32Array(size);
    const distances = new Float32Array(size);
    distances.fill(1);
    points.forEach(([lat, lon], index) => {
      const slope = entry.slope[index];
      if (!Number.isFinite(slope)) return;
      const ocean = index >= (entry.oceanStart ?? points.length);
      const spacing = ocean ? (entry.oceanSpacing ?? 5) : 3;
      const range = spacing * 1.2;
      const falloff = range ** 2 / (2 * (spacing * 0.55) ** 2);
      const confidence = entry.significant[index] ? 1 : 0;
      // Blend across the 3° sample spacing, with a soft cutoff before wider gaps.
      footprint(lon, lat, range, (pixel, distance) => {
        if ((land[pixel * 4 + 3] < 128) !== ocean) return;
        const weight = Math.exp(-falloff * distance) * (1 - smooth(clamp01((distance - 0.60) / 0.40)));
        weights[pixel] += weight;
        slopes[pixel] += weight * slope;
        confidences[pixel] += weight * confidence;
        distances[pixel] = Math.min(distances[pixel], distance);
      });
    });

    const heat = texture();
    const heights = texture();
    const values = heat.createImageData(width, height);
    const relief = heights.createImageData(width, height);
    const scale = entry.scale > 0 ? entry.scale : 1;
    for (let pixel = 0; pixel < size; pixel += 1) {
      const i = pixel * 4;
      values.data[i + 3] = 255;
      relief.data[i + 3] = 255;
      if (!weights[pixel]) continue;
      const trend = slopes[pixel] / weights[pixel] / scale;
      const magnitude = clamp01(Math.abs(trend));
      const coverage = 1 - smooth(clamp01((distances[pixel] - 0.34) / 0.66));
      const edge = entry.oceanStart === undefined ? land[i + 3] / 255 : 1;
      const opacity = coverage * edge * (0.68 + 0.32 * confidences[pixel] / weights[pixel]);
      // Weight the trend by opacity so texture filtering beside a gap preserves the rate of change.
      values.data[i] = 255 * opacity * clamp01((trend + 1) / 2);
      values.data[i + 1] = 255 * opacity;
      // A narrow island may sit between ocean vertices. Clip the surface after displacing the mesh.
      relief.data[i] = 255 * coverage * magnitude;
    }
    heat.putImageData(values, 0, 0);
    heights.putImageData(relief, 0, 0);
    return { heat: heat.canvas, heightMap: heights.canvas };
  }

  function featherOutline(ctx, outline, mask) {
    const vertices = [];
    for (const [lon, lat] of [...outline, outline[0]]) {
      const x = toX(lon);
      const previous = vertices.at(-1)?.[0];
      // Unwrap neighbouring vertices into the same copy of the longitude domain.
      const nearest = previous === undefined ? x : x + width * Math.round((previous - x) / width);
      vertices.push([nearest, toY(lat)]);
    }
    const [firstX] = vertices[0];
    const [lastX] = vertices.at(-1);
    if (Math.abs(lastX - firstX) > width / 2) {
      const pole = outline.reduce((total, [, latitude]) => total + latitude, 0) > 0 ? 0 : height;
      vertices.push([lastX, pole], [firstX, pole]);
    }
    const path = new Path2D();
    for (const shift of [-width, 0, width]) {
      vertices.forEach(([x, y], index) => {
        if (index) path.lineTo(x + shift, y);
        else path.moveTo(x + shift, y);
      });
      path.closePath();
    }
    ctx.fillStyle = "#fff";
    ctx.fill(path, "evenodd");
    const inside = ctx.getImageData(0, 0, width, height).data;
    const horizontal = new Uint8ClampedArray(size);
    const weights = [1, 4, 6, 4, 1];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let i = 0; i < weights.length; i += 1) {
          sum += weights[i] * inside[(y * width + (x + width + i - 2) % width) * 4 + 3];
        }
        horizontal[y * width + x] = sum / 16;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let i = 0; i < weights.length; i += 1) {
          sum += weights[i] * horizontal[Math.max(0, Math.min(height - 1, y + i - 2)) * width + x];
        }
        mask[(y * width + x) * 4] = sum / 16;
      }
    }
  }

  function softenCentres(site, pointsById, mask) {
    const centres = site.areaIds
      ? site.areaIds.map((id) => pointsById.get(id)).filter(Boolean)
      : [[site.latitude, site.longitude]];
    for (const [lat, lon] of centres) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      // Overlapping influences soften the spacing between nearby selected points.
      footprint(lon, lat, site.areaIds ? 3.25 : 3.8, (pixel, distance) => {
        const edge = smooth(clamp01((distance - 0.28) / 0.72));
        mask[4 * pixel] = 255 - (255 - mask[4 * pixel]) * edge;
      });
    }
  }

  function makeSelection(site, pointsById) {
    const ctx = texture();
    const mask = ctx.createImageData(width, height);
    if (site.outline?.length >= 3) featherOutline(ctx, site.outline, mask.data);
    else softenCentres(site, pointsById, mask.data);
    for (let pixel = 0; pixel < size; pixel += 1) mask.data[4 * pixel + 3] = 255;
    ctx.putImageData(mask, 0, 0);
    return ctx.canvas;
  }

  window.createGlobeFields = ({ countries, points }) => {
    const { surface, land } = makeSurface(countries);
    const pointsById = new Map(points.map((point) => [point.join(","), point]));
    const measurements = new Map();
    let selectedSite;
    let selection;
    let platformCountries;
    let platform;
    return {
      surface,
      measurement(entry) {
        if (!entry) return { heat: null, heightMap: null };
        const cached = measurements.get(entry);
        if (cached) {
          measurements.delete(entry);
          measurements.set(entry, cached);
          return cached;
        }
        const field = makeMeasurement(entry, points, land);
        measurements.set(entry, field);
        if (measurements.size > 3) measurements.delete(measurements.keys().next().value);
        return field;
      },
      select(site) {
        if (!site) return null;
        if (selectedSite !== site) {
          selectedSite = site;
          selection = makeSelection(site, pointsById);
        }
        return selection;
      },
      platform(selectedCountries) {
        if (!selectedCountries?.length) return null;
        if (platformCountries !== selectedCountries) {
          // The bundled country polygons are already split at the date line.
          platform = makeSurface(selectedCountries).surface;
          platformCountries = selectedCountries;
        }
        return platform;
      },
    };
  };
})();
