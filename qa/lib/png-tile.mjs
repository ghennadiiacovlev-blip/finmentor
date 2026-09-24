// FINMENTOR — minimal PNG decode / encode / tile, no dependencies.
// Used by qa/mobile-motion-evidence.mjs to lay recording frames out as one reviewable sheet.
// Handles 8-bit RGB / RGBA / grey, non-interlaced PNGs (what ffmpeg and Chrome write).
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

export function decodePng(file) {
  const buf = Buffer.isBuffer(file) ? file : readFileSync(file);
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported png');
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * bpp;
      if (bpp >= 3) { rgba[o] = cur[s]; rgba[o + 1] = cur[s + 1]; rgba[o + 2] = cur[s + 2]; rgba[o + 3] = bpp === 4 ? cur[s + 3] : 255; }
      else { rgba[o] = rgba[o + 1] = rgba[o + 2] = cur[s]; rgba[o + 3] = bpp === 2 ? cur[s + 1] : 255; }
    }
    prev = cur;
  }
  return { width, height, rgba };
}

const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) { const i = (y * width + x) * 4, o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// Lays equally sized frames on a grid with a margin; frames are numbered in the caller's order.
export function tileFrames(files, { cols = 6, gap = 6, bg = [11, 22, 39] } = {}) {
  const frames = files.map(decodePng);
  const fw = Math.max(...frames.map((f) => f.width)), fh = Math.max(...frames.map((f) => f.height));
  const rows = Math.ceil(frames.length / cols);
  const width = cols * fw + (cols + 1) * gap, height = rows * fh + (rows + 1) * gap;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255; }
  frames.forEach((f, n) => {
    const ox = gap + (n % cols) * (fw + gap), oy = gap + Math.floor(n / cols) * (fh + gap);
    for (let y = 0; y < f.height; y++) f.rgba.copy(rgba, ((oy + y) * width + ox) * 4, y * f.width * 4, (y + 1) * f.width * 4);
  });
  return encodePng({ width, height, rgba });
}
