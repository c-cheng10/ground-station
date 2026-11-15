const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const globeScript = readFileSync(path.join(__dirname, "../globe-view.js"), "utf8");
const palette = Array.from({ length: 9 }, (_, index) => [100 + index, 50 + index, 150 + index]);
const texture = (value, coverage = 255) => ({ width: 1, height: 1, data: [value, coverage, 0, 255] });

function globePixel(options) {
  let image;
  const ctx = {
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (result) => { image = result; },
    setTransform() {},
    clearRect() {},
    drawImage() {},
    stroke() {},
  };
  const canvas = { clientWidth: 9, clientHeight: 9, getContext: (type) => type === "2d" ? ctx : null };
  const window = {};
  runInNewContext(globeScript, { window, document: { createElement: () => ({ getContext: () => ctx }) }, Path2D: class {} });
  const globe = window.createGlobeView(canvas, []);
  globe.render({ latitude: 0, longitude: 0, surface: texture(255), palette, ...options });
  const centre = 4 * (4 * canvas.clientWidth + 4);
  return Array.from(image.data.slice(centre, centre + 3));
}

test("the comparison draws the palette cell for both signed slope classes", () => {
  const slopes = [0, 127, 255];
  for (let y = 0; y < slopes.length; y += 1) {
    for (let x = 0; x < slopes.length; x += 1) {
      assert.deepEqual(globePixel({ heat: texture(slopes[x]), comparisonHeat: texture(slopes[y]) }), palette[3 * y + x]);
    }
  }
});

test("comparison requires both data layers and preserves the single map during the wipe", () => {
  assert.deepEqual(globePixel({ heat: texture(255), comparisonHeat: texture(0, 0) }), globePixel({}));
  assert.deepEqual(globePixel({ heat: texture(0, 0), comparisonHeat: texture(255) }), globePixel({}));
  assert.deepEqual(globePixel({ heat: texture(0), comparisonHeat: texture(255),
    previous: { heat: texture(255), palette }, wipe: 0.5 }), palette[8]);
  assert.deepEqual(globePixel({ heat: texture(0), comparisonHeat: texture(255),
    previous: { heat: texture(255), palette }, wipe: 0.51 }), palette[6]);
});
