// Draws the sea chart: the height grid as an engraved paper chart, north up. Coast, hills, woods,
// shoals, names, a rose and a scale, and an anchor at the home harbour, where the voyage begins.
// `markChart` lays that drawing on the visible canvas and adds what changes: a red cross on each
// of the seven places (ringed and ticked once found). The boat is not shown: finding where she
// is, by compass and coastline, is the navigator's work (Lorentz, 2026-11-11).

import { START } from '#game/chart-data.js';
import { noise } from '#game/terrain.js';

/**
 * @typedef {import('#game/terrain.js').Terrain} Terrain
 * @typedef {import('#game/chart-data.js').Feature} Feature
 */

/** The chart is laid out on a square of this many design units; the canvas may be finer. */
const SHEET = 1200;
/** The border takes this much of each side. */
const MARGIN = 60;

const INK = '#2a2418';
const RED = '#7a2a1c';
const PAPER = '#e9dcbc';
const SERIF = '"IM Fell English", Georgia, "Times New Roman", serif';
const CAPS = '"IM Fell English SC", "IM Fell English", Georgia, serif';

/** Where the rose and the scale lie, in world units: open water on the eastern side. */
const ROSE = { x: 655, z: -520, radius: 118 };
const SCALE = { x: 610, z: -905, length: 500 };
/** The name of the sea and the warning at its far corner go in open water too. */
const SEA = { x: -128, z: -508 };
const DRAGONS = { x: -1020, z: 1090 };

/**
 * Which side of a feature its name goes: n, s, e or w (default s), and a nudge in world units.
 * @type {Record<string, { side?: string, dx?: number, dz?: number }>}
 */
const PLACE = {
  mainland: { dx: -600, dz: -92 },
  quickjs: { side: 'w', dz: -32 },
  unsafe: { side: 'e' },
  panic: { side: 'n' },
  plato: { side: 'n' },
  strand: { side: 'n' },
  veltliner: { side: 'w' },
  kaffee: { side: 'e' },
  graphql: { side: 'n' },
  lifetime: { side: 'n' },
};

/** A small repeatable random source, so the chart is the same every time it is drawn. */
function dice(/** @type {number} */ seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** @param {number} a @param {number} b @param {number} t */
function smoothstep(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * The height grid resampled to one value a map pixel, north at the top.
 * @param {Terrain} terrain
 * @param {number} size map pixels a side
 */
function resample(terrain, size) {
  const { n, heights } = terrain;
  const out = new Float32Array(size * size);
  const k = n / size;
  for (let py = 0; py < size; py++) {
    const gz = Math.min(n - 1.001, Math.max(0, (size - py - 0.5) * k - 0.5));
    const iz = Math.floor(gz);
    const fz = gz - iz;
    const row = iz * n;
    for (let px = 0; px < size; px++) {
      const gx = Math.min(n - 1.001, Math.max(0, (px + 0.5) * k - 0.5));
      const ix = Math.floor(gx);
      const fx = gx - ix;
      const i = row + ix;
      const south = heights[i] + (heights[i + 1] - heights[i]) * fx;
      const north = heights[i + n] + (heights[i + n + 1] - heights[i + n]) * fx;
      out[py * size + px] = south + (north - south) * fz;
    }
  }
  return out;
}

/**
 * The line where the ground crosses a level, as loose segments (marching squares).
 * @param {Float32Array} field @param {number} size @param {number} level @param {number} step
 */
function contour(field, size, level, step) {
  const path = new Path2D();
  const last = size - step - 1;
  for (let y = 0; y <= last; y += step) {
    const top = y * size;
    const bottom = (y + step) * size;
    for (let x = 0; x <= last; x += step) {
      const a = field[top + x] - level;
      const b = field[top + x + step] - level;
      const c = field[bottom + x + step] - level;
      const d = field[bottom + x] - level;
      const cell = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (cell === 0 || cell === 15) continue;
      const tx = x + (step * a) / (a - b);
      const ry = y + (step * b) / (b - c);
      const bx = x + (step * d) / (d - c);
      const ly = y + (step * a) / (a - d);
      const x1 = x + step;
      const y1 = y + step;
      switch (cell) {
        case 1:
        case 14:
          path.moveTo(x, ly);
          path.lineTo(tx, y);
          break;
        case 2:
        case 13:
          path.moveTo(tx, y);
          path.lineTo(x1, ry);
          break;
        case 3:
        case 12:
          path.moveTo(x, ly);
          path.lineTo(x1, ry);
          break;
        case 4:
        case 11:
          path.moveTo(x1, ry);
          path.lineTo(bx, y1);
          break;
        case 6:
        case 9:
          path.moveTo(tx, y);
          path.lineTo(bx, y1);
          break;
        case 7:
        case 8:
          path.moveTo(x, ly);
          path.lineTo(bx, y1);
          break;
        case 5:
          path.moveTo(x, ly);
          path.lineTo(tx, y);
          path.moveTo(x1, ry);
          path.lineTo(bx, y1);
          break;
        default:
          path.moveTo(tx, y);
          path.lineTo(x1, ry);
          path.moveTo(x, ly);
          path.lineTo(bx, y1);
      }
    }
  }
  return path;
}

/**
 * Old paper: mottled, a little foxed, darker towards the edges.
 * @param {CanvasRenderingContext2D} ctx @param {number} width
 */
function paper(ctx, width) {
  const small = 300;
  const blot = document.createElement('canvas');
  blot.width = blot.height = small;
  const bctx = blot.getContext('2d');
  if (bctx) {
    const image = bctx.createImageData(small, small);
    const data = image.data;
    for (let y = 0; y < small; y++) {
      for (let x = 0; x < small; x++) {
        const cloud =
          0.6 * noise(x / 60 + 3, y / 60 + 9) +
          0.3 * noise(x / 21 + 40, y / 21) +
          0.1 * noise(x / 6, y / 6 + 70);
        const edge = Math.min(x, y, small - 1 - x, small - 1 - y) / small;
        const worn = 1 - smoothstep(0, 0.11, edge);
        const fox = smoothstep(0.74, 0.86, noise(x / 9 + 100, y / 9 + 200)) * 0.5;
        const dark = Math.min(1, Math.max(0, (cloud - 0.42) * 0.5 + worn * 0.3 + fox * 0.25));
        const i = (y * small + x) * 4;
        data[i] = 122;
        data[i + 1] = 92;
        data[i + 2] = 48;
        data[i + 3] = dark * 150;
      }
    }
    bctx.putImageData(image, 0, 0);
  }
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, width);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blot, 0, 0, width, width);

  // The grain of the sheet.
  const grain = document.createElement('canvas');
  grain.width = grain.height = 128;
  const gctx = grain.getContext('2d');
  if (gctx) {
    const image = gctx.createImageData(128, 128);
    const roll = dice(7);
    for (let i = 0; i < image.data.length; i += 4) {
      const light = roll() > 0.5;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = light ? 255 : 60;
      image.data[i + 3] = roll() * (light ? 26 : 20);
    }
    gctx.putImageData(image, 0, 0);
    const pattern = ctx.createPattern(grain, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, width);
    }
  }
}

/**
 * Land as a wash of ochre with the hills shaded from the north-west, and a blue-green tint
 * over shallow water. Everything else stays clear so the paper shows through.
 * @param {Float32Array} field @param {number} size @param {number} perPixel world units a pixel
 */
function wash(field, size, perPixel) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const inv = 1 / (2 * perPixel);
  for (let py = 1; py < size - 1; py++) {
    for (let px = 1; px < size - 1; px++) {
      const i = py * size + px;
      const h = field[i];
      const o = i * 4;
      if (h <= 0) {
        const shallow = smoothstep(-5, -0.4, h);
        if (shallow <= 0) continue;
        data[o] = 104;
        data[o + 1] = 146;
        data[o + 2] = 142;
        data[o + 3] = Math.pow(shallow, 0.85) * 135;
        continue;
      }
      const east = (field[i + 1] - field[i - 1]) * inv;
      const south = (field[i + size] - field[i - size]) * inv;
      const lit = Math.max(-1, Math.min(1, (east + south) * 0.9));
      const high = smoothstep(2, 55, h);
      const mottle = 0.94 + 0.12 * noise(px / 7, py / 7);
      let r = (214 - 26 * high) * mottle;
      let g = (192 - 30 * high) * mottle;
      let b = (140 - 30 * high) * mottle;
      if (lit > 0) {
        r += (244 - r) * lit * 0.55;
        g += (232 - g) * lit * 0.55;
        b += (200 - b) * lit * 0.55;
      } else {
        r += (96 - r) * -lit * 0.6;
        g += (74 - g) * -lit * 0.6;
        b += (44 - b) * -lit * 0.6;
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255 * smoothstep(0, 0.35, h);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * A compass rose: sixteen points, a ring of degrees, north in red.
 * @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r
 */
function rose(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.lineWidth = 0.7;
  for (const ring of [0.9, 0.52]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const inner = deg % 45 === 0 ? 0.9 : deg % 15 === 0 ? 0.93 : 0.96;
    ctx.moveTo(Math.sin(a) * r * inner, -Math.cos(a) * r * inner);
    ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
  }
  ctx.stroke();

  // Points, the short ones first so the long ones lie over them. Each is a kite, half inked.
  const orders = [
    { every: 22.5, from: 11.25 * 2, length: 0.5, width: 0.07 },
    { every: 90, from: 45, length: 0.72, width: 0.11 },
    { every: 90, from: 0, length: 1.16, width: 0.15 },
  ];
  for (const { every, from, length, width } of orders) {
    for (let deg = from; deg < 360; deg += every) {
      if (every === 22.5 && deg % 45 === 0) continue;
      const a = (deg * Math.PI) / 180;
      ctx.save();
      ctx.rotate(a);
      const tip = -r * length;
      const waist = -r * width * 1.6;
      const half = r * width;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, tip);
      ctx.lineTo(half, waist);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = deg === 0 ? RED : INK;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, tip);
      ctx.lineTo(-half, waist);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${r * 0.36}px ${CAPS}`;
  ctx.fillText('N', 0, -r * 1.24);
  ctx.restore();
}

/**
 * Text with a little paper round it, so it reads over lines and stipple.
 * @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} x @param {number} y
 * @param {number} [halo] width of the paper edge
 */
function write(ctx, text, x, y, halo = 4) {
  if (halo > 0) {
    ctx.save();
    ctx.strokeStyle = PAPER;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
}

/** Breaks a long name in two at the space nearest its middle. @param {string} name */
function lines(name) {
  if (name.length < 14 || !name.includes(' ')) return [name];
  let best = -1;
  for (let i = name.indexOf(' '); i >= 0; i = name.indexOf(' ', i + 1)) {
    if (best < 0 || Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2)) best = i;
  }
  return [name.slice(0, best), name.slice(best + 1)];
}

/**
 * Draws the whole chart. The canvas must already have its backing size; it is square.
 * @param {HTMLCanvasElement} canvas
 * @param {Terrain} terrain
 * @param {readonly Feature[]} features
 */
export function drawChart(canvas, terrain, features) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const s = width / SHEET; // device pixels a design unit
  const margin = Math.round(MARGIN * s);
  const size = width - margin * 2; // map pixels a side
  const perPixel = terrain.extent / size;
  const half = terrain.extent / 2;
  const unit = (SHEET - MARGIN * 2) / terrain.extent; // design units a world unit
  /** World to design units. */
  const mapX = (/** @type {number} */ x) => MARGIN + (x + half) * unit;
  const mapY = (/** @type {number} */ z) => MARGIN + (half - z) * unit;
  const roll = dice(1911);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paper(ctx, width);

  const field = resample(terrain, size);

  // From here on, vector work is in design units.
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const inner = SHEET - MARGIN * 2;

  // Rhumb lines from the rose and a faint graticule, under the land.
  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGIN, MARGIN, inner, inner);
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16;
    ctx.moveTo(mapX(ROSE.x), mapY(ROSE.z));
    ctx.lineTo(mapX(ROSE.x) + Math.sin(a) * SHEET * 2, mapY(ROSE.z) - Math.cos(a) * SHEET * 2);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.setLineDash([1, 5]);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let at = -800; at <= 800; at += 400) {
    ctx.moveTo(mapX(at), MARGIN);
    ctx.lineTo(mapX(at), MARGIN + inner);
    ctx.moveTo(MARGIN, mapY(at));
    ctx.lineTo(MARGIN + inner, mapY(at));
  }
  ctx.stroke();
  ctx.restore();

  // The washes: land and shallows, one pixel to one pixel.
  const washed = wash(field, size, perPixel);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(washed, margin, margin);
  ctx.restore();
  washed.width = washed.height = 0;

  // Ink over the map: work in map pixels.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, margin, margin);
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;

  // Water lines hugging every coast, fainter as they go out.
  const waters = [
    { level: -0.85, width: 0.75, alpha: 0.6 },
    { level: -1.8, width: 0.6, alpha: 0.42 },
    { level: -2.9, width: 0.5, alpha: 0.28 },
  ];
  for (const { level, width: line, alpha } of waters) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = line * s;
    ctx.stroke(contour(field, size, level, 2));
  }
  ctx.globalAlpha = 1;

  // Hachures: short strokes running downhill, heavier on the side away from the light.
  const k = terrain.n / size;
  const woodAt = (/** @type {number} */ px, /** @type {number} */ py) => {
    const ix = Math.min(terrain.n - 1, Math.max(0, Math.floor((px + 0.5) * k)));
    const iz = Math.min(terrain.n - 1, Math.max(0, Math.floor((size - py - 0.5) * k)));
    return terrain.forest[iz * terrain.n + ix];
  };
  const strokes = [new Path2D(), new Path2D(), new Path2D()];
  const pitch = 3.3 * s;
  const inv = 1 / (2 * perPixel);
  for (let gy = 2; gy < size - 2; gy += pitch) {
    for (let gx = 2; gx < size - 2; gx += pitch) {
      const px = Math.min(size - 3, Math.round(gx + (roll() - 0.5) * pitch));
      const py = Math.min(size - 3, Math.round(gy + (roll() - 0.5) * pitch));
      const i = py * size + px;
      if (field[i] < 0.5) continue;
      const east = (field[i + 1] - field[i - 1]) * inv;
      const south = (field[i + size] - field[i - size]) * inv;
      const steep = Math.hypot(east, south);
      if (steep < 0.1) continue;
      const lit = (east + south) * 0.7071;
      const wooded = woodAt(px, py) > 0.45;
      if ((lit > 0.12 || wooded) && roll() < 0.55) continue;
      const reach = Math.min(6.5, Math.max(1.6, steep * 7)) * s;
      const path = strokes[lit < -0.12 ? 2 : lit > 0.12 ? 0 : 1];
      path.moveTo(px, py);
      path.lineTo(px - (east / steep) * reach, py - (south / steep) * reach);
    }
  }
  [0.4, 0.55, 0.8].forEach((line, weight) => {
    ctx.globalAlpha = 0.5 + weight * 0.14;
    ctx.lineWidth = line * s;
    ctx.stroke(strokes[weight]);
  });
  ctx.globalAlpha = 1;

  // Woods: a small round tree wherever the ground is wooded.
  const crowns = new Path2D();
  const trunks = new Path2D();
  const grove = 7 * s;
  for (let gy = 2; gy < size - 2; gy += grove) {
    for (let gx = 2; gx < size - 2; gx += grove) {
      const px = gx + (roll() - 0.5) * grove * 0.9;
      const py = gy + (roll() - 0.5) * grove * 0.9;
      const i = Math.round(py) * size + Math.round(px);
      if (!(field[i] > 1.4) || woodAt(px, py) < 0.42) continue;
      const r = (1.9 + roll() * 0.7) * s;
      crowns.moveTo(px + r, py);
      crowns.arc(px, py, r, 0, Math.PI * 2);
      trunks.moveTo(px, py + r);
      trunks.lineTo(px, py + r + 1.5 * s);
      // A stroke of shade on the lee of the crown.
      trunks.moveTo(px + r * 0.15, py + r * 0.55);
      trunks.lineTo(px + r * 0.62, py + r * 0.1);
    }
  }
  ctx.fillStyle = '#d9cf9c';
  ctx.fill(crowns);
  ctx.lineWidth = 0.6 * s;
  ctx.stroke(crowns);
  ctx.stroke(trunks);
  ctx.fillStyle = INK;

  // The coast itself.
  ctx.lineWidth = 1.25 * s;
  ctx.stroke(contour(field, size, 0, 2));

  // Shoals as stipple, with a cross on every rock that breaks the surface.
  const sand = new Path2D();
  const rocks = new Path2D();
  const dot = 3.1 * s;
  for (const f of features) {
    if (f.kind !== 'reef') continue;
    const cx = (f.x + half) / perPixel;
    const cy = (half - f.z) / perPixel;
    const reach = (f.radius * 1.5) / perPixel;
    const x0 = Math.max(4, Math.floor(cx - reach));
    const x1 = Math.min(size - 5, Math.ceil(cx + reach));
    const y0 = Math.max(4, Math.floor(cy - reach));
    const y1 = Math.min(size - 5, Math.ceil(cy + reach));
    for (let gy = y0; gy < y1; gy += dot) {
      for (let gx = x0; gx < x1; gx += dot) {
        const px = gx + (roll() - 0.5) * dot;
        const py = gy + (roll() - 0.5) * dot;
        const h = field[Math.round(py) * size + Math.round(px)];
        if (h > -0.3 || h < -3.1) continue;
        if (h < -1.6 && roll() < 0.55) continue;
        sand.moveTo(px + 0.5 * s, py);
        sand.arc(px, py, 0.5 * s, 0, Math.PI * 2);
      }
    }
    const span = Math.max(2, Math.round(3 / perPixel));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = py * size + px;
        const h = field[i];
        if (h < 0.1) continue;
        let peak = true;
        for (let dy = -span; dy <= span && peak; dy++) {
          for (let dx = -span; dx <= span; dx++) {
            const other = field[i + dy * size + dx];
            if (other > h || (other === h && (dy < 0 || (dy === 0 && dx < 0)))) {
              peak = false;
              break;
            }
          }
        }
        if (!peak) continue;
        const arm = 3.1 * s;
        rocks.moveTo(px - arm, py);
        rocks.lineTo(px + arm, py);
        rocks.moveTo(px, py - arm);
        rocks.lineTo(px, py + arm);
      }
    }
  }
  ctx.globalAlpha = 0.8;
  ctx.fill(sand);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 0.9 * s;
  ctx.stroke(rocks);
  ctx.restore();

  // The one mark on the chart: an anchor in the home harbour.
  ctx.save();
  ctx.translate(mapX(START.x), mapY(START.z));
  ctx.strokeStyle = RED;
  ctx.fillStyle = RED;
  ctx.lineWidth = 1.5 * s;
  ctx.lineCap = 'round';
  const a = 10 * s;
  ctx.beginPath();
  ctx.arc(0, -a, a * 0.28, 0, Math.PI * 2);
  ctx.moveTo(0, -a * 0.72);
  ctx.lineTo(0, a);
  ctx.moveTo(-a * 0.5, -a * 0.35);
  ctx.lineTo(a * 0.5, -a * 0.35);
  ctx.moveTo(-a * 0.8, a * 0.3);
  ctx.quadraticCurveTo(-a * 0.7, a, 0, a);
  ctx.quadraticCurveTo(a * 0.7, a, a * 0.8, a * 0.3);
  ctx.stroke();
  ctx.font = `italic ${18 * s}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  write(ctx, 'Home harbour', 0, -a * 2.1, 4 * s);
  ctx.restore();

  // The rose and the scale.
  rose(ctx, mapX(ROSE.x), mapY(ROSE.z), ROSE.radius * unit);

  ctx.save();
  ctx.translate(mapX(SCALE.x), mapY(SCALE.z));
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 0.8;
  const span = SCALE.length * unit;
  const band = 3.2;
  for (let i = 0; i < 5; i++) {
    const x = (i * span) / 5;
    ctx.fillStyle = i % 2 ? PAPER : INK;
    ctx.fillRect(x, 0, span / 5, band);
    ctx.fillStyle = i % 2 ? INK : PAPER;
    ctx.fillRect(x, band, span / 5, band);
  }
  ctx.strokeRect(0, 0, span, band * 2);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `13px ${SERIF}`;
  for (const mark of [0, 100, 200, 300, 400, 500]) {
    write(ctx, String(mark), (mark / SCALE.length) * span, band * 2 + 3, 3);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 17px ${SERIF}`;
  write(ctx, 'A Scale of five hundred Units', span / 2, -8, 3);
  ctx.restore();

  // Names. First the sea's own, spaced wide over open water, and a warning for the far corner.
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.72;
  ctx.font = `italic 22px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText('The Philosopher\u2019s', mapX(SEA.x), mapY(SEA.z) - 13);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '12px';
  ctx.fillText('Sea', mapX(SEA.x) + 6, mapY(SEA.z) + 13);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = `italic 16px ${SERIF}`;
  ctx.fillText('Here be Dragons', mapX(DRAGONS.x), mapY(DRAGONS.z));
  ctx.restore();
  for (const f of features) {
    const place = PLACE[f.id] ?? {};
    if (f.kind === 'mainland') {
      // The name of the land goes on a label of its own, clear of the woods.
      ctx.save();
      ctx.font = `24px ${CAPS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
      const title = f.name.toUpperCase();
      const x = mapX(f.x + (place.dx ?? 0));
      const y = mapY(f.z + (place.dz ?? 0));
      const wide = ctx.measureText(title).width + 34;
      ctx.fillStyle = '#eadbb2';
      ctx.fillRect(x - wide / 2, y - 19, wide, 38);
      ctx.lineWidth = 1.1;
      ctx.strokeRect(x - wide / 2, y - 19, wide, 38);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x - wide / 2 + 3.5, y - 15.5, wide - 7, 31);
      ctx.fillStyle = INK;
      ctx.fillText(title, x + 3, y + 1);
      ctx.restore();
      continue;
    }
    const reef = f.kind === 'reef';
    const px = reef ? 19 : f.radius >= 90 ? 25 : 22;
    const reachX = f.radius * (f.kind === 'strand' ? 2.7 : reef ? 1.3 : 1.2) * unit;
    const reachZ = f.radius * (reef ? 1.3 : 1.2) * unit;
    const text = lines(f.name);
    const leading = px * 1.02;
    const side = place.side ?? 's';
    let x = mapX(f.x + (place.dx ?? 0));
    let y = mapY(f.z + (place.dz ?? 0));
    ctx.font = `italic ${px}px ${SERIF}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    if (side === 's') y += reachZ + 4 + leading / 2;
    else if (side === 'n') y -= reachZ + 4 + leading * (text.length - 0.5);
    else {
      ctx.textAlign = side === 'e' ? 'left' : 'right';
      x += (side === 'e' ? 1 : -1) * (reachX + 5);
      y -= (leading * (text.length - 1)) / 2;
    }
    text.forEach((line, i) => write(ctx, line, x, y + i * leading));
  }

  // The border: a heavy line, a band of hundreds, a fine neat line, and the hundreds numbered.
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  const outer = MARGIN - 34;
  ctx.lineWidth = 2.4;
  ctx.strokeRect(outer, outer, SHEET - outer * 2, SHEET - outer * 2);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(outer + 5, outer + 5, SHEET - outer * 2 - 10, SHEET - outer * 2 - 10);
  const strip = 5;
  ctx.strokeRect(MARGIN - strip, MARGIN - strip, inner + strip * 2, inner + strip * 2);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(MARGIN, MARGIN, inner, inner);
  for (let at = -half; at < half; at += 100) {
    if (((at + half) / 100) % 2) continue;
    const a = mapX(at);
    const b = mapY(at + 100);
    const long = 100 * unit;
    ctx.fillRect(a, MARGIN - strip, long, strip);
    ctx.fillRect(a, MARGIN + inner, long, strip);
    ctx.fillRect(MARGIN - strip, b, strip, long);
    ctx.fillRect(MARGIN + inner, b, strip, long);
  }
  ctx.font = `13px ${SERIF}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const gutter = (outer + 5 + MARGIN - strip) / 2;
  for (let at = -800; at <= 800; at += 400) {
    const east = at === 0 ? '0' : `${Math.abs(at)} ${at > 0 ? 'E' : 'W'}`;
    const north = at === 0 ? '0' : `${Math.abs(at)} ${at > 0 ? 'N' : 'S'}`;
    ctx.fillText(east, mapX(at), gutter + 1);
    ctx.fillText(east, mapX(at), SHEET - gutter + 1);
    for (const [x, turn] of [
      [gutter, -Math.PI / 2],
      [SHEET - gutter, Math.PI / 2],
    ]) {
      ctx.save();
      ctx.translate(x, mapY(at));
      ctx.rotate(turn);
      ctx.fillText(north, 0, 1);
      ctx.restore();
    }
  }
}

/**
 * Copy the drawn chart onto the visible canvas and mark the places to find.
 * @param {HTMLCanvasElement} canvas the canvas on show
 * @param {HTMLCanvasElement} base the chart as drawChart left it, the same size
 * @param {Terrain} terrain
 * @param {readonly string[]} found ids of the places found
 */
export function markChart(canvas, base, terrain, found) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const s = canvas.width / SHEET;
  const half = terrain.extent / 2;
  const unit = (SHEET - MARGIN * 2) / terrain.extent;
  const mapX = (/** @type {number} */ x) => (MARGIN + (x + half) * unit) * s;
  const mapY = (/** @type {number} */ z) => (MARGIN + (half - z) * unit) * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const port of terrain.ports) {
    const x = mapX(port.x);
    const y = mapY(port.z);
    const arm = 9 * s;
    const done = found.includes(port.id);
    // Paper under the mark, so it shows on land and hatching alike.
    for (const [colour, width] of /** @type {const} */ ([
      [PAPER, 7 * s],
      [RED, 3 * s],
    ])) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      if (done) {
        ctx.arc(x, y, arm * 1.25, 0, Math.PI * 2);
        ctx.moveTo(x - arm * 0.6, y);
        ctx.lineTo(x - arm * 0.15, y + arm * 0.5);
        ctx.lineTo(x + arm * 0.65, y - arm * 0.55);
      } else {
        ctx.moveTo(x - arm, y - arm);
        ctx.lineTo(x + arm, y + arm);
        ctx.moveTo(x + arm, y - arm);
        ctx.lineTo(x - arm, y + arm);
      }
      ctx.stroke();
    }
  }
}
