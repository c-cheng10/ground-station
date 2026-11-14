(() => {
  "use strict";

  const rad = Math.PI / 180;
  const turn = 2 * Math.PI;
  const focalScale = 1.19;
  const radiusScale = 0.398;
  const columns = 288;
  const rows = 144;
  const ocean = [55, 86, 105];
  const ground = [44, 52, 61];
  const rimColour = [8, 15, 20];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const point = (lon, lat) => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];

  const vertexShader = `
    precision highp float;
    attribute vec3 aPoint;
    attribute vec2 aUv;
    uniform vec3 uRight, uNorth, uFront;
    uniform vec2 uScale, uShift;
    uniform float uDistance, uRelief;
    uniform bool uBorders;
    uniform sampler2D uHeight, uSelection, uSurface;
    varying vec2 vUv;
    varying vec3 vPoint;
    float elevation(vec2 uv) {
      float height = 0.0;
      if (uRelief > 0.0) {
        float land = smoothstep(0.5, 1.0, texture2D(uSurface, uv).r);
        float selected = texture2D(uSelection, uv).r;
        height = texture2D(uHeight, uv).r * selected * land * uRelief;
      }
      return height;
    }
    const vec2 mesh = vec2(${columns}.0, ${rows}.0);
    vec3 meshVertex(vec2 cell) {
      vec2 uv = cell / mesh;
      float lon = (uv.x - 0.5) * 6.28318530718;
      float lat = (0.5 - uv.y) * 3.14159265359;
      return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)) * (1.0 + elevation(uv));
    }
    vec3 borderVertex(vec2 uv) {
      vec2 cell = uv * mesh;
      vec2 lo = floor(cell);
      vec2 t = fract(cell);
      vec3 east = meshVertex(lo + vec2(1.0, 0.0));
      vec3 south = meshVertex(lo + vec2(0.0, 1.0));
      if (t.x + t.y <= 1.0) {
        return meshVertex(lo) * (1.0 - t.x - t.y) + east * t.x + south * t.y;
      }
      return meshVertex(lo + vec2(1.0)) * (t.x + t.y - 1.0) + east * (1.0 - t.y) + south * (1.0 - t.x);
    }
    void main() {
      vec3 displaced = uBorders ? borderVertex(aUv) : aPoint * (1.0 + elevation(aUv));
      float w = uDistance - dot(displaced, uFront);
      vec2 xy = vec2(dot(displaced, uRight), dot(displaced, uNorth));
      // Perspective depth with near 0.012 and far 16 in units of Earth radii.
      float depth = w * 1.001501 - 0.024018 - (uBorders ? 0.00012 * w : 0.0);
      gl_Position = vec4(xy * uScale + w * uShift, depth, w);
      vUv = aUv;
      vPoint = displaced;
    }
  `;

  const fragmentShader = (palette) => `
    precision highp float;
    uniform vec3 uRight, uNorth, uFront;
    uniform float uDistance, uRelief;
    uniform bool uHeatVisible, uFocused, uBorders;
    uniform vec2 uTexel;
    uniform sampler2D uSurface, uHeat, uSelection, uHeight;
    varying vec2 vUv;
    varying vec3 vPoint;
    vec3 bandColour(float value) {
      ${palette.slice(0, -1).map((colour, index) =>
        `if (value < ${((index + 1) / palette.length).toFixed(8)}) return vec3(${colour}) / 255.0;`
      ).join("\n      ")}
      return vec3(${palette.at(-1)}) / 255.0;
    }
    float peak(vec2 uv) {
      return texture2D(uHeight, uv).r * texture2D(uSelection, uv).r;
    }
    void main() {
      vec3 bodyNormal = normalize(vPoint);
      vec3 screenNormal = vec3(dot(bodyNormal, uRight), dot(bodyNormal, uNorth), dot(bodyNormal, uFront));
      vec3 toEye = normalize(uDistance * uFront - vPoint);
      float facing = clamp(dot(bodyNormal, toEye), 0.0, 1.0);
      vec3 light = normalize(vec3(-0.48, 0.48, 0.73));
      float lambert = max(0.0, dot(screenNormal, light));
      vec4 surface = texture2D(uSurface, vUv);
      float land = smoothstep(0.48, 0.62, surface.r);
      float selected = uFocused ? texture2D(uSelection, vUv).r : 1.0;
      if (uBorders) {
        float heat = uHeatVisible ? texture2D(uHeat, vUv).g : 0.0;
        vec3 ink = mix(vec3(0.61, 0.77, 0.80), vec3(0.04, 0.08, 0.11), smoothstep(0.20, 0.66, heat));
        float contrast = mix(0.14, 0.54, smoothstep(0.02, 0.94, selected));
        gl_FragColor = vec4(ink, contrast * smoothstep(0.0, 0.09, facing));
        return;
      }
      vec3 color = mix(vec3(${ocean}), vec3(${ground}), land) / 255.0;
      color *= 0.70 + 0.49 * lambert;
      if (uHeatVisible && land > 0.0) {
        vec2 heat = texture2D(uHeat, vUv).rg;
        float grade = 0.86 + 0.14 * lambert;
        if (uRelief > 0.0 && selected > 0.01 && heat.g > 0.005) {
          vec2 dx = vec2(uTexel.x, 0.0);
          vec2 dy = vec2(0.0, uTexel.y);
          float longitude = (vUv.x - 0.5) * 6.2831853;
          vec3 east = vec3(-sin(longitude), 0.0, cos(longitude));
          vec3 north = cross(east, bodyNormal);
          float latitudeScale = max(0.25, length(bodyNormal.xz));
          float slopeX = (peak(vUv + dx) - peak(vUv - dx)) / (12.56637 * uTexel.x * latitudeScale);
          float slopeY = (peak(vUv - dy) - peak(vUv + dy)) / (6.2831853 * uTexel.y);
          vec3 normal = normalize(bodyNormal - (east * slopeX + north * slopeY) * uRelief);
          vec3 worldLight = uRight * light.x + uNorth * light.y + uFront * light.z;
          grade = 0.61 + 0.49 * max(0.0, dot(normal, worldLight));
        }
        float value = heat.r / max(heat.g, 1.0 / 255.0);
        color = mix(color, bandColour(value) * grade, heat.g * land);
      }
      color *= mix(0.34, 1.0, smoothstep(0.02, 0.94, selected));
      float edge = pow(1.0 - facing, 5.0);
      color += (vec3(${rimColour}) / 255.0) * edge * mix(0.40, 1.0, selected);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function shaderProgram(gl, palette) {
    const heightSupported = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) >= 3;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision ? "highp" : "mediump";
    const program = gl.createProgram();
    const vertex = heightSupported ? vertexShader : vertexShader.replace("uRelief > 0.0", "false");
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragmentShader(palette)]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source.replace("precision highp float", `precision ${precision} float`));
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    return program;
  }

  function borderSegments(countries) {
    const vertices = [];
    const unique = new Set();
    for (const { polygons } of countries) for (const rings of polygons) for (const ring of rings) {
      for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        const first = start.join(",");
        const last = end.join(",");
        if (first === last || (Math.abs(start[0]) === 180 && Math.abs(end[0]) === 180)) continue;
        const key = first < last ? first + "|" + last : last + "|" + first;
        if (unique.has(key)) continue;
        unique.add(key);
        const x = (start[0] + 180) * columns / 360;
        const y = (90 - start[1]) * rows / 180;
        const dx = ((end[0] - start[0] + 540) % 360 - 180) * columns / 360;
        const dy = (start[1] - end[1]) * rows / 180;
        const cuts = [0, 1];
        // Split the path at each grid and triangle edge so it sits flush on the raised mesh.
        for (const [origin, delta] of [[x, dx], [y, dy], [x + y, dx + dy]]) {
          const lower = Math.min(origin, origin + delta);
          const upper = Math.max(origin, origin + delta);
          for (let edge = Math.floor(lower) + 1; edge < upper; edge += 1) cuts.push((edge - origin) / delta);
        }
        cuts.sort((a, b) => a - b);
        for (let i = 1; i < cuts.length; i += 1) {
          if (cuts[i] - cuts[i - 1] < 1e-7) continue;
          const wrap = Math.floor((x + (cuts[i] + cuts[i - 1]) * dx / 2) / columns);
          for (const t of [cuts[i - 1], cuts[i]]) {
            const u = (x + t * dx) / columns - wrap;
            const v = (y + t * dy) / rows;
            vertices.push(...point((u - 0.5) * turn, (0.5 - v) * Math.PI), u, v);
          }
        }
      }
    }
    return new Float32Array(vertices);
  }

  function vertexBuffer(gl, vertices) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    return buffer;
  }

  function sphere(gl) {
    const vertices = [];
    const indices = [];
    for (let row = 0; row <= rows; row += 1) {
      for (let col = 0; col <= columns; col += 1) {
        const u = col / columns;
        const v = row / rows;
        vertices.push(...point((u - 0.5) * turn, (0.5 - v) * Math.PI), u, v);
        if (row === rows || col === columns) continue;
        const top = row * (columns + 1) + col;
        const bottom = top + columns + 1;
        indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
      }
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    return { buffer: vertexBuffer(gl, vertices), count: indices.length };
  }

  function webglRenderer(canvas, gl, borders, palette) {
    let program;
    try {
      program = shaderProgram(gl, palette);
    } catch (error) {
      console.warn("Globe shader unavailable:", error);
      return null;
    }

    const mesh = sphere(gl);
    const borderBuffer = borders.length ? vertexBuffer(gl, borders) : null;
    const position = gl.getAttribLocation(program, "aPoint");
    const uv = gl.getAttribLocation(program, "aUv");
    const lineWidth = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)[1];
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(uv);
    function bindVertices(buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);
    }
    const locations = new Map();
    const uniform = (name) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name);
    };
    const names = ["uSurface", "uHeat", "uSelection", "uHeight"];
    const textures = names.map((name, unit) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(uniform(name), unit);
      return { texture };
    });
    const blank = new Uint8Array([0, 0, 0, 255]);
    function setTexture(unit, source) {
      const entry = textures[unit];
      if (entry.source === source) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
      entry.source = source;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    return ({ frame, surface, heat, selection, heightMap, relief }) => {
      if (gl.isContextLost()) return;
      const { width, height, front, right, north, distance, focal, offsetX, offsetY } = frame;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      [surface, heat, selection, heightMap].forEach((texture, unit) => setTexture(unit, texture));
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.uniform3fv(uniform("uRight"), right);
      gl.uniform3fv(uniform("uNorth"), north);
      gl.uniform3fv(uniform("uFront"), front);
      gl.uniform2f(uniform("uScale"), 2 * focal / width, 2 * focal / height);
      gl.uniform2f(uniform("uShift"), 2 * offsetX / width, -2 * offsetY / height);
      gl.uniform1f(uniform("uDistance"), distance);
      gl.uniform1i(uniform("uHeatVisible"), heat !== null);
      gl.uniform1i(uniform("uFocused"), selection !== null);
      gl.uniform2f(uniform("uTexel"), 1 / (heightMap?.width || 1), 1 / (heightMap?.height || 1));
      gl.uniform1f(uniform("uRelief"), heat && selection && heightMap ? 0.030 * relief : 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      bindVertices(mesh.buffer);
      gl.uniform1i(uniform("uBorders"), 0);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      if (borderBuffer) {
        bindVertices(borderBuffer);
        gl.uniform1i(uniform("uBorders"), 1);
        gl.enable(gl.BLEND);
        gl.depthMask(false);
        gl.lineWidth(Math.min(lineWidth, dpr));
        gl.drawArrays(gl.LINES, 0, borders.length / 5);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    };
  }


  // shortcut: the Canvas fallback keeps the optical framing and data palette; vertex relief needs WebGL.
  function softwareRenderer(canvas, borders, palette) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const raster = document.createElement("canvas");
    const rasterContext = raster.getContext("2d");
    const textures = new WeakMap();
    function pixels(source) {
      if (!source) return null;
      if (source.data) return source;
      if (!textures.has(source)) {
        const textureContext = source.getContext("2d");
        textures.set(source, textureContext.getImageData(0, 0, source.width, source.height));
      }
      return textures.get(source);
    }

    return ({ frame, surface, heat, selection }) => {
      const { width, height, cx, cy, focal, distance, front, right, north } = frame;
      const scale = Math.min(1, 500 / Math.max(width, height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const screenWidth = Math.round(width * dpr);
      const screenHeight = Math.round(height * dpr);
      if (canvas.width !== screenWidth || canvas.height !== screenHeight) {
        Object.assign(canvas, { width: screenWidth, height: screenHeight });
      }
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      if (raster.width !== w || raster.height !== h) Object.assign(raster, { width: w, height: h });
      const image = rasterContext.createImageData(w, h);
      const landTexture = pixels(surface);
      const heatTexture = pixels(heat);
      const selectionTexture = pixels(selection);
      const textureIndex = (texture, u, v) =>
        4 * (Math.min(texture.width - 1, Math.floor(u * texture.width)) +
          texture.width * Math.min(texture.height - 1, Math.floor(v * texture.height)));
      const pxs = Array.from({ length: w }, (_, x) => ((x + 0.5) / scale - cx) / focal);
      for (let y = 0; y < h; y += 1) {
        const py = (cy - (y + 0.5) / scale) / focal;
        for (let x = 0; x < w; x += 1) {
          const px = pxs[x];
          const t = surfaceDistance(px, py, distance);
          if (t === null) continue;
          const z = distance - t;
          const localX = t * px;
          const localY = t * py;
          const worldX = front[0] * z + right[0] * localX + north[0] * localY;
          const worldY = front[1] * z + north[1] * localY;
          const worldZ = front[2] * z + right[2] * localX + north[2] * localY;
          const u = 0.5 + Math.atan2(worldZ, worldX) / turn;
          const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, worldY))) / Math.PI;
          const at = 4 * (y * w + x);
          const landI = landTexture ? textureIndex(landTexture, u, v) : 0;
          const land = (landTexture?.data[landI] ?? 0) / 255;
          const weight = selectionTexture ? 0.34 + 0.66 * selectionTexture.data[textureIndex(selectionTexture, u, v)] / 255 : 1;
          const light = 0.70 + 0.49 * Math.max(0, -0.48 * localX + 0.48 * localY + 0.73 * z);
          const heatI = heatTexture && land > 0.5 ? textureIndex(heatTexture, u, v) : 0;
          const coverage = heatTexture && land > 0.5 ? heatTexture.data[heatI + 1] : 0;
          const value = coverage ? heatTexture.data[heatI] / coverage : 0;
          const band = Math.min(palette.length - 1, Math.floor(value * palette.length));
          const heatColour = palette[band];
          const blend = land * coverage / 255;
          const facing = Math.max(0, (distance * z - 1) / (Math.sqrt(1 + px * px + py * py) * t));
          const rim = Math.max(0, 1 - facing) ** 5;
          for (let channel = 0; channel < 3; channel += 1) {
            const base = (ocean[channel] + (ground[channel] - ocean[channel]) * land) * light;
            image.data[at + channel] = (base * (1 - blend) + heatColour[channel] * blend) * weight +
              rimColour[channel] * rim * weight;
          }
          image.data[at + 3] = 255;
        }
      }
      rasterContext.putImageData(image, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(raster, 0, 0, width, height);
      const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const horizon = 1 / distance;
      const project = ([x, y, z]) => {
        const perspective = focal / (distance - z);
        return [cx + x * perspective, cy - y * perspective];
      };
      const visible = (first, second) => first[2] >= horizon ? first : first.map((value, index) =>
        value + (second[index] - value) * (horizon - first[2]) / (second[2] - first[2]));
      for (let i = 0; i < borders.length; i += 10) {
        const endpoints = [borders.subarray(i, i + 3), borders.subarray(i + 5, i + 8)];
        const points = endpoints.map((point) => [dot(point, right), dot(point, north), dot(point, front)]);
        const [a, b] = points;
        if (a[2] < horizon && b[2] < horizon) continue;
        const u = (borders[i + 3] + borders[i + 8]) / 2;
        const v = (borders[i + 4] + borders[i + 9]) / 2;
        const dark = heatTexture && heatTexture.data[textureIndex(heatTexture, u, v) + 1] > 120;
        const dim = selectionTexture && selectionTexture.data[textureIndex(selectionTexture, u, v)] < 128;
        const path = paths[(dim ? 2 : 0) + (dark ? 1 : 0)];
        path.moveTo(...project(visible(a, b)));
        path.lineTo(...project(visible(b, a)));
      }
      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      const inks = ["rgba(155,196,204,.54)", "rgba(10,20,28,.54)", "rgba(155,196,204,.14)", "rgba(10,20,28,.14)"];
      paths.forEach((path, index) => {
        ctx.strokeStyle = inks[index];
        ctx.stroke(path);
      });
    };
  }

  function surfaceDistance(px, py, distance) {
    const a = 1 + px * px + py * py;
    const discriminant = distance * distance - a * (distance * distance - 1);
    return discriminant < 0 ? null : (distance - Math.sqrt(discriminant)) / a;
  }

  window.createGlobeView = (canvas, countries, palette) => {
    const borders = borderSegments(countries);
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true, preserveDrawingBuffer: true });
    const draw = gl ? webglRenderer(canvas, gl, borders, palette) : softwareRenderer(canvas, borders, palette);
    if (!draw) return null;
    let frame;

    function render({ longitude, latitude, zoom = 1, lens = 1, offsetX = 0, offsetY = 0,
      surface = null, heat = null, selection = null, heightMap = null, relief = 0 }) {
      const { clientWidth: width, clientHeight: height } = canvas;
      if (!width || !height) return;
      const lon = longitude * rad;
      const lat = latitude * rad;
      const front = point(lon, lat);
      const right = [-Math.sin(lon), 0, Math.cos(lon)];
      const north = [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)];
      const shortSide = Math.min(width, height);
      const nominalFocal = focalScale * shortSide;
      const nominalRadius = radiusScale * shortSide * zoom;
      const distance = Math.hypot(1, nominalFocal / nominalRadius);
      const focal = nominalFocal * lens;
      frame = { front, right, north, distance, focal, cx: width / 2 + offsetX, cy: height / 2 + offsetY,
        width, height, offsetX, offsetY };
      draw({ frame, surface, heat, selection, heightMap, relief });
    }

    function project(longitude, latitude) {
      if (!frame) return null;
      const { front, right, north, distance, focal, cx, cy } = frame;
      const target = point(longitude * rad, latitude * rad);
      const z = dot(target, front);
      if (z * distance < 1) return null;
      const scale = focal / (distance - z);
      return [cx + scale * dot(target, right), cy - scale * dot(target, north)];
    }

    function invert(x, y) {
      if (!frame) return null;
      const { front, right, north, distance, focal, cx, cy } = frame;
      const px = (x - cx) / focal;
      const py = (cy - y) / focal;
      const t = surfaceDistance(px, py, distance);
      if (t === null) return null;
      const p = front.map((value, index) => value * (distance - t) + t * (right[index] * px + north[index] * py));
      return [Math.atan2(p[2], p[0]) / rad, Math.asin(Math.max(-1, Math.min(1, p[1]))) / rad];
    }

    function zoomFor(degrees, pixels) {
      const shortSide = Math.min(canvas.clientWidth, canvas.clientHeight);
      if (!shortSide || pixels <= 0 || degrees >= 90) return 1;
      if (degrees <= 0) return 8;
      const angle = degrees * rad;
      const cosine = Math.cos(angle);
      const distance = Math.max(1 / cosine, cosine + focalScale * shortSide * Math.sin(angle) / pixels);
      const zoom = focalScale / (radiusScale * Math.sqrt(distance ** 2 - 1));
      return Math.max(1, Math.min(8, zoom));
    }

    return { render, project, invert, zoomFor,
      reliefAvailable: Boolean(gl && gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) >= 3),
      get radius() {
      return frame ? frame.focal / Math.sqrt(frame.distance ** 2 - 1) : 0;
    } };
  };
})();
