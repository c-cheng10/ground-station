const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const script = readFileSync(path.join(__dirname, "../globe-fields.js"), "utf8");

function coastalMeasurement(entry, longitude = -0.5) {
  const imageData = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) });
  const document = { createElement() {
    const canvas = {};
    const context = {
      canvas,
      fillRect() {},
      getImageData(_, __, width, height) {
        const image = imageData(width, height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width / 2; x += 1) image.data[4 * (y * width + x)] = 255;
        }
        return image;
      },
      createImageData: imageData,
      putImageData(image) { canvas.pixels = image.data; },
    };
    canvas.getContext = () => context;
    return canvas;
  } };
  const window = {};
  runInNewContext(script, { window, document });
  return window.createGlobeFields({ countries: [], points: [[0, longitude]] }).measurement({ slope: [1], scale: 1, ...entry });
}

function pixel(texture, longitude, channel = 0) {
  const column = Math.floor((longitude + 180) / 360 * texture.width);
  return texture.pixels[4 * (Math.floor(texture.height / 2) * texture.width + column) + channel];
}

test("coastal relief stays continuous across the mask and tapers at the end of coverage", () => {
  const { heightMap } = coastalMeasurement({});
  assert.equal(pixel(heightMap, -0.125), 255);
  assert.equal(pixel(heightMap, 0.125), 255);
  const tapered = pixel(heightMap, 2.375);
  assert.ok(tapered > 0 && tapered < 255);
  assert.equal(pixel(heightMap, 3.375), 0);
});

test("heat coverage still follows Land and Water masks, while Air crosses the coast", () => {
  const land = coastalMeasurement({}).heat;
  const water = coastalMeasurement({ water: true, oceanStart: 0 }, 0.5).heat;
  const air = coastalMeasurement({ blend: true }).heat;
  for (const channel of [0, 1]) {
    assert.deepEqual([pixel(land, -0.125, channel), pixel(land, 0.125, channel)], [255, 0]);
    assert.deepEqual([pixel(water, -0.125, channel), pixel(water, 0.125, channel)], [0, 255]);
    assert.deepEqual([pixel(air, -0.125, channel), pixel(air, 0.125, channel)], [255, 255]);
  }
});
