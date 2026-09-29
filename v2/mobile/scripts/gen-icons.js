/* Generates the CounciLog icon set as raw PNGs — no native deps.
 * Design: brutalist "document" mark — white page card with a black offset
 * shadow, a yellow stamp bar, three ink text lines, folded corner.
 * Run: node scripts/gen-icons.js  →  writes into ../assets/
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const INK = [0x27, 0x14, 0x6e];      // #27146e brand indigo
const PAPER = [0xff, 0xff, 0xff];
const ACCENT = [0xf4, 0xbe, 0x04];   // #f4be04 yellow
const BLACK = [0x00, 0x00, 0x00];

/* minimal PNG writer: 8-bit RGBA, no interlace */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* canvas helper — rect/triangle fills only, colors as [r,g,b,a] */
function canvas(w, h, bg) {
  const px = Buffer.alloc(w * h * 4);
  if (bg) for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4);
  const rect = (x0, y0, x1, y1, [r, g, b, a = 255]) => {
    for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1); x++)
        px.set([r, g, b, a], (y * w + x) * 4);
  };
  // right triangle: top edge flat y=y0, hypotenuse falls to (x1,y1) — the fold
  const foldTri = (x0, y0, size, [r, g, b]) => {
    for (let y = 0; y < size; y++)
      for (let x = size - y - 1; x < size; x++)
        px.set([r, g, b, 255], (((y0 + y) * w) + (x0 + x)) * 4);
  };
  return { px, rect, foldTri };
}

/* The mark, drawn at a given scale within a canvas size.
 * s=1 → the mark spans the canvas; smaller leaves padding (foreground). */
function drawMark(px, W, s, { mono = false } = {}) {
  const u = W / 1024;                    // reference grid unit
  const cx = W / 2, cy = W / 2;
  const su = s * u;
  const pw = 400 * su, ph = 560 * su;           // page size
  const x0 = cx - pw / 2, y0 = cy - ph / 2;
  const fold = 96 * su, lineH = 26 * su, ink = mono ? PAPER : INK;
  const rect = (rx0, ry0, rx1, ry1, c) => {     // page-relative
    for (let y = Math.round(y0 + ry0); y < Math.round(y0 + ry1); y++)
      for (let x = Math.round(x0 + rx0); x < Math.round(x0 + rx1); x++)
        px.set([...c, 255], (y * W + x) * 4);
  };
  const tri = (size, c) => {
    for (let y = 0; y < size; y++)
      for (let x = size - y - 1; x < size; x++)
        px.set([...c, 255], ((Math.round(y0) + y) * W + Math.round(x0 + pw - size + x)) * 4);
  };
  if (!mono) rect(28 * su, 28 * su, pw + 28 * su, ph + 28 * su, BLACK);  // offset shadow
  rect(0, 0, pw, ph, PAPER);                                            // page
  if (!mono) { tri(fold, INK); }                                        // folded corner
  const lx = 68 * su;                                                   // text lines
  rect(lx, 170 * su, pw - 68 * su, 170 * su + lineH, ink);
  rect(lx, 250 * su, pw - 68 * su, 250 * su + lineH, ink);
  rect(lx, 330 * su, pw - 200 * su, 330 * su + lineH, ink);
  rect(0, ph - 120 * su, pw, ph - 40 * su, mono ? PAPER : ACCENT);      // stamp bar
}

const out = (name, buf) => {
  fs.writeFileSync(path.join(__dirname, '..', 'assets', name), buf);
  console.log('wrote assets/' + name);
};

// icon.png — 1024, ink background + full mark
{
  const W = 1024, c = canvas(W, W, INK);
  drawMark(c.px, W, 1);
  out('icon.png', png(W, W, c.px));
}
// android foreground — transparent 1024, mark at 62% (adaptive safe zone)
{
  const W = 1024, c = canvas(W, W, null);
  drawMark(c.px, W, 0.62);
  out('android-icon-foreground.png', png(W, W, c.px));
}
// android background — solid ink square
{
  const W = 1024, c = canvas(W, W, INK);
  out('android-icon-background.png', png(W, W, c.px));
}
// android monochrome — white silhouette on transparent
{
  const W = 1024, c = canvas(W, W, null);
  drawMark(c.px, W, 0.62, { mono: true });
  out('android-icon-monochrome.png', png(W, W, c.px));
}
// splash-icon.png — transparent 512, mark at 80%
{
  const W = 512, c = canvas(W, W, null);
  drawMark(c.px, W, 0.5);
  out('splash-icon.png', png(W, W, c.px));
}
// favicon.png — 64, ink bg + mark at 88%
{
  const W = 64, c = canvas(W, W, INK);
  drawMark(c.px, W, 0.88);
  out('favicon.png', png(W, W, c.px));
}
