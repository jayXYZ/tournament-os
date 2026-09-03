// Renders the raster brand assets from the vector mark in
// assets/expo.icon/Assets/mark.svg — the same glyph as the web BrandMark and
// the iOS Icon Composer layer. Run from apps/native whenever the mark or the
// palette changes:
//
//   node scripts/render-brand-assets.mjs
//
// Zero dependencies on purpose: the mark is one flat-filled path, so a small
// nonzero-winding scanline rasteriser and a PNG encoder are enough. Every
// output carries a real alpha channel; macOS's quick-look and sips exporters
// flatten SVGs onto white, which is how these assets once shipped opaque.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

// Loaded through require rather than import: this package has no "type"
// field, so Node would otherwise warn while working out that palette.ts is ESM.
const { palette } = createRequire(import.meta.url)("../src/lib/palette.ts");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const markSvg = readFileSync(
  join(root, "assets/expo.icon/Assets/mark.svg"),
  "utf8",
);
const VIEWBOX = 480;
const mark = parsePath(/\sd="([^"]+)"/.exec(markSvg)[1]);
const markFill = /\sfill="(#[0-9a-fA-F]{6})"/.exec(markSvg)[1];

// Android's adaptive-icon safe zone is a circle spanning 66/108 of the canvas;
// the sheet's far corners fit inside it when the viewBox spans half the canvas.
const ADAPTIVE_SCALE = 0.5;

const assets = [
  // In-app mark and splash image: the full viewBox in paper white on
  // transparent, so they sit on the app's own dark background.
  { file: "brand-mark.png", size: 512, layers: [[mark, markFill, 1]] },
  { file: "splash-icon.png", size: 1024, layers: [[mark, markFill, 1]] },
  {
    file: "android-icon-foreground.png",
    size: 512,
    layers: [[mark, markFill, ADAPTIVE_SCALE]],
  },
  // Themed-icon mask: only the alpha matters, Android tints it.
  {
    file: "android-icon-monochrome.png",
    size: 512,
    layers: [[mark, "#FFFFFF", ADAPTIVE_SCALE]],
  },
  // Mirrors apps/web/public/favicon.svg: the mark on a rounded ink tile.
  {
    file: "favicon.png",
    size: 48,
    layers: [
      [roundedSquare(VIEWBOX, 96), palette.background, 1],
      [mark, markFill, 1],
    ],
  },
];

for (const { file, size, layers } of assets) {
  const rgba = compose(
    size,
    layers.map(([polys, hex, scale]) => ({
      color: hexToRgb(hex),
      coverage: rasterise(polys, size, fit(size, scale)),
    })),
  );
  writeFileSync(join(root, "assets/images", file), encodePng(size, rgba));
  console.log(`wrote assets/images/${file} (${size}×${size})`);
}

// Absolute M/L/H/V/C/Z only — all the mark uses. Curves are flattened into
// polylines; each closed subpath becomes one polygon.
function parsePath(d) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const polygons = [];
  let polygon = [];
  let command = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const next = () => Number(tokens[i++]);
  const close = () => {
    if (polygon.length) polygons.push(polygon);
    polygon = [];
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    switch (command) {
      case "M":
        close();
        x = next();
        y = next();
        polygon.push([x, y]);
        command = "L";
        break;
      case "L":
        x = next();
        y = next();
        polygon.push([x, y]);
        break;
      case "H":
        x = next();
        polygon.push([x, y]);
        break;
      case "V":
        y = next();
        polygon.push([x, y]);
        break;
      case "C": {
        const [x1, y1, x2, y2, x3, y3] = [
          next(),
          next(),
          next(),
          next(),
          next(),
          next(),
        ];
        const steps = 24;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          polygon.push([
            u * u * u * x +
              3 * u * u * t * x1 +
              3 * u * t * t * x2 +
              t ** 3 * x3,
            u * u * u * y +
              3 * u * u * t * y1 +
              3 * u * t * t * y2 +
              t ** 3 * y3,
          ]);
        }
        x = x3;
        y = y3;
        break;
      }
      case "Z":
        close();
        break;
      default:
        throw new Error(`Unsupported path command: ${command}`);
    }
  }
  close();
  return polygons;
}

// A square of `side` with corner radius `r`, as one polygon in path units.
function roundedSquare(side, r) {
  const points = [];
  const corners = [
    [side - r, r, -Math.PI / 2],
    [side - r, side - r, 0],
    [r, side - r, Math.PI / 2],
    [r, r, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let s = 0; s <= 16; s++) {
      const a = start + (s / 16) * (Math.PI / 2);
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return [points];
}

// Maps path units onto a canvas of `size` pixels, with the viewBox scaled to
// `scale` of the canvas and centred.
function fit(size, scale) {
  const k = (size * scale) / VIEWBOX;
  const offset = (size * (1 - scale)) / 2;
  return ([x, y]) => [x * k + offset, y * k + offset];
}

// Per-pixel coverage in [0, 1] under the nonzero winding rule (SVG's default):
// 4× vertical supersampling with exact horizontal span coverage.
function rasterise(polygons, size, transform) {
  const SUB = 4;
  const coverage = new Float32Array(size * size);
  const edges = [];
  for (const polygon of polygons) {
    for (let k = 0; k < polygon.length; k++) {
      const [ax, ay] = transform(polygon[k]);
      const [bx, by] = transform(polygon[(k + 1) % polygon.length]);
      if (ay === by) continue;
      edges.push(
        ay < by
          ? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 }
          : { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 },
      );
    }
  }
  const crossings = [];
  for (let sy = 0; sy < size * SUB; sy++) {
    const y = (sy + 0.5) / SUB;
    crossings.length = 0;
    for (const e of edges) {
      if (y >= e.y0 && y < e.y1) {
        crossings.push({
          x: e.x0 + ((y - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0),
          dir: e.dir,
        });
      }
    }
    crossings.sort((a, b) => a.x - b.x);
    const row = Math.floor(sy / SUB) * size;
    let winding = 0;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding += crossings[k].dir;
      if (winding !== 0) {
        addSpan(
          coverage,
          row,
          size,
          crossings[k].x,
          crossings[k + 1].x,
          1 / SUB,
        );
      }
    }
  }
  return coverage;
}

function addSpan(coverage, row, size, x0, x1, weight) {
  x0 = Math.max(0, x0);
  x1 = Math.min(size, x1);
  if (x1 <= x0) return;
  let px = Math.floor(x0);
  const last = Math.ceil(x1) - 1;
  if (px === last) {
    coverage[row + px] += (x1 - x0) * weight;
    return;
  }
  coverage[row + px] += (px + 1 - x0) * weight;
  for (px++; px < last; px++) coverage[row + px] += weight;
  coverage[row + last] += (x1 - last) * weight;
}

// Straight-alpha "over" compositing of solid-colour layers, bottom first.
function compose(size, layers) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (const layer of layers) {
      const c = Math.min(1, layer.coverage[i]);
      r = r * (1 - c) + layer.color[0] * c;
      g = g * (1 - c) + layer.color[1] * c;
      b = b * (1 - c) + layer.color[2] * c;
      a = a * (1 - c) + c;
    }
    if (a > 0) {
      rgba[i * 4] = Math.round(r / a);
      rgba[i * 4 + 1] = Math.round(g / a);
      rgba[i * 4 + 2] = Math.round(b / a);
      rgba[i * 4 + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// 8-bit RGBA PNG, one unfiltered scanline per row.
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
