(() => {
  "use strict";

  const rad = Math.PI / 180;
  const turn = 2 * Math.PI;
  const focalScale = 1.19;
  const radiusScale = 0.398;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const point = (lon, lat) => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];

  const vertexShader = `
    precision highp float;
    attribute vec3 aPoint;
    attribute vec2 aUv;
    uniform vec3 uRight, uNorth, uFront;
    uniform vec2 uScale, uShift;
    uniform float uDistance, uRelief;
    uniform sampler2D uHeight, uSelection, uSurface;
    varying vec2 vUv;
    varying vec3 vPoint;
    void main() {
      float height = 0.0;
      if (uRelief > 0.0) {
        float land = smoothstep(0.5, 1.0, texture2D(uSurface, aUv).r);
        float selected = texture2D(uSelection, aUv).r;
        height = texture2D(uHeight, aUv).r * selected * land * uRelief;
      }
      vec3 displaced = aPoint * (1.0 + height);
      float w = uDistance - dot(displaced, uFront);
      vec2 xy = vec2(dot(displaced, uRight), dot(displaced, uNorth));
      // Perspective depth with near 0.012 and far 16 in units of Earth radii.
      gl_Position = vec4(xy * uScale + w * uShift, w * 1.001501 - 0.024018, w);
      vUv = aUv;
      vPoint = displaced;
    }
  `;

  const fragmentShader = `
    precision highp float;
    uniform vec3 uRight, uNorth, uFront;
    uniform float uDistance, uRelief;
    uniform bool uHeatVisible, uFocused;
    uniform vec2 uTexel;
    uniform sampler2D uSurface, uHeat, uSelection, uHeight;
    varying vec2 vUv;
    varying vec3 vPoint;
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
      vec3 color = mix(vec3(0.035, 0.046, 0.064), vec3(0.085, 0.102, 0.121), land);
      color *= 0.70 + 0.49 * lambert;
      color += vec3(0.108, 0.138, 0.158) * surface.g * (0.58 + 0.42 * lambert);
      if (uHeatVisible && land > 0.0) {
        vec4 heat = texture2D(uHeat, vUv);
        float grade = 0.86 + 0.14 * lambert;
        if (uRelief > 0.0 && selected > 0.01 && heat.a > 0.005) {
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
        color = mix(color, heat.rgb * grade, heat.a * land);
        color *= 1.0 - 0.15 * heat.a * surface.g;
      }
      color *= mix(0.34, 1.0, smoothstep(0.02, 0.94, selected));
      float edge = pow(1.0 - facing, 5.0);
      color += vec3(0.047, 0.084, 0.111) * edge * mix(0.40, 1.0, selected);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function shaderProgram(gl) {
    const heightSupported = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) >= 3;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision ? "highp" : "mediump";
    const program = gl.createProgram();
    const vertex = heightSupported ? vertexShader : vertexShader.replace("uRelief > 0.0", "false");
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragmentShader]]) {
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

  function sphere(gl, program) {
    const columns = 288;
    const rows = 144;
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

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    for (const [attribute, count, offset] of [["aPoint", 3, 0], ["aUv", 2, 12]]) {
      const location = gl.getAttribLocation(program, attribute);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, count, gl.FLOAT, false, 20, offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    return indices.length;
  }

  function webglRenderer(canvas, gl) {
    let program;
    try {
      program = shaderProgram(gl);
    } catch (error) {
      console.warn("Globe shader unavailable:", error);
      return null;
    }

    const indexCount = sphere(gl, program);
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
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    };
  }


  // shortcut: the Canvas fallback keeps the optical framing and data palette; vertex relief needs WebGL.
  function softwareRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const textures = new WeakMap();
    const ocean = [9, 12, 16];
    const ground = [22, 26, 31];
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
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
      const image = ctx.createImageData(w, h);
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
          const coast = (landTexture?.data[landI + 1] ?? 0) / 255;
          const weight = selectionTexture ? 0.34 + 0.66 * selectionTexture.data[textureIndex(selectionTexture, u, v)] / 255 : 1;
          const light = 0.70 + 0.49 * Math.max(0, -0.48 * localX + 0.48 * localY + 0.73 * z);
          const heatI = heatTexture && land > 0.5 ? textureIndex(heatTexture, u, v) : 0;
          const blend = heatTexture && land > 0.5 ? land * heatTexture.data[heatI + 3] / 255 : 0;
          const facing = Math.max(0, (distance * z - 1) / (Math.sqrt(1 + px * px + py * py) * t));
          const rim = Math.max(0, 1 - facing) ** 5;
          for (let channel = 0; channel < 3; channel += 1) {
            const base = (ocean[channel] + (ground[channel] - ocean[channel]) * land) * light + (28 + 6 * channel) * coast;
            image.data[at + channel] = (base * (1 - blend) + (heatTexture?.data[heatI + channel] ?? 0) * blend) * weight +
              (12 + 8 * channel) * rim * weight;
          }
          image.data[at + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };
  }

  function surfaceDistance(px, py, distance) {
    const a = 1 + px * px + py * py;
    const discriminant = distance * distance - a * (distance * distance - 1);
    return discriminant < 0 ? null : (distance - Math.sqrt(discriminant)) / a;
  }

  window.createGlobeView = (canvas) => {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true, preserveDrawingBuffer: true });
    const draw = gl ? webglRenderer(canvas, gl) : softwareRenderer(canvas);
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
