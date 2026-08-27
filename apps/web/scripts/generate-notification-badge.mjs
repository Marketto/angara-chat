import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const size = 96;
const scale = 4;
const scaledSize = size * scale;

function drawRect(mask, x, y, width, height) {
  for (let py = y * scale; py < (y + height) * scale; py += 1) {
    for (let px = x * scale; px < (x + width) * scale; px += 1) mask[py * scaledSize + px] = 1;
  }
}

function drawPolygon(mask, points) {
  const scaled = points.map(([x, y]) => [x * scale, y * scale]);
  for (let py = 0; py < scaledSize; py += 1) {
    for (let px = 0; px < scaledSize; px += 1) {
      let inside = false;
      for (let i = 0, j = scaled.length - 1; i < scaled.length; j = i, i += 1) {
        const [xi, yi] = scaled[i];
        const [xj, yj] = scaled[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[py * scaledSize + px] = 1;
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function notificationBadgeStats() {
  const mask = new Uint8Array(scaledSize * scaledSize);
  drawPolygon(mask, [[48, 9], [38, 24], [58, 24]]);
  drawPolygon(mask, [[28, 21], [20, 33], [36, 33]]);
  drawPolygon(mask, [[68, 21], [60, 33], [76, 33]]);
  drawRect(mask, 44, 23, 8, 17);
  drawRect(mask, 25, 31, 6, 10);
  drawRect(mask, 65, 31, 6, 10);
  drawPolygon(mask, [[24, 39], [72, 39], [79, 48], [17, 48]]);
  drawRect(mask, 20, 48, 12, 22);
  drawRect(mask, 42, 48, 12, 22);
  drawRect(mask, 64, 48, 12, 22);
  drawRect(mask, 15, 70, 66, 8);
  drawRect(mask, 22, 78, 52, 6);
  return mask;
}

export function renderNotificationBadge() {
  const mask = notificationBadgeStats();
  const raw = Buffer.alloc(size * (1 + size * 4));
  let transparentPixels = 0;
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 4);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let samples = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) samples += mask[(y * scale + sy) * scaledSize + x * scale + sx];
      }
      const alpha = Math.round(samples * 255 / (scale * scale));
      if (alpha === 0) transparentPixels += 1;
      const offset = row + 1 + x * 4;
      raw[offset] = 255;
      raw[offset + 1] = 255;
      raw[offset + 2] = 255;
      raw[offset + 3] = alpha;
    }
  }
  if (transparentPixels < size * size / 2) throw new Error('Notification badge requires a transparent background');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND'),
  ]);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeFileSync(new URL('../public/notification-badge.png', import.meta.url), renderNotificationBadge());
}
